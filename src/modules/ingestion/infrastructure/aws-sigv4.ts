import { createHash, createHmac } from "node:crypto";

// Minimal AWS Signature Version 4 signer for S3-compatible object storage
// (DigitalOcean Spaces). Intentionally dependency-free: the jobs bundle with
// esbuild `--packages=bundle`, so pulling in @aws-sdk/client-s3 would inflate
// every job by tens of MB. We only need signed PUT/HEAD/GET of a single object,
// which is a small, exhaustively testable surface.

export interface SignRequestInput {
  readonly method: string;
  /** Host header, e.g. "nyc3.digitaloceanspaces.com" (path-style addressing). */
  readonly host: string;
  /** Already-decoded path, e.g. "/bucket/some/key". Each segment is URI-encoded here. */
  readonly path: string;
  /** Canonical (sorted) query string without leading "?". Default "". */
  readonly query?: string;
  /** Lowercased SHA-256 hex of the payload ("" body → hash of empty string). */
  readonly payloadHashHex: string;
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** ISO basic format, e.g. "20260810T004500Z". */
  readonly amzDate: string;
  /** Extra headers to sign (besides host/x-amz-content-sha256/x-amz-date). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

export interface SignedHeaders {
  readonly headers: Record<string, string>;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986 encoding: encode everything except unreserved chars. `/` handled by caller per-segment. */
export function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(path: string): string {
  // Preserve slashes, encode each segment. Leading slash preserved.
  return path
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

/** AWS-published derivation: HMAC chain "AWS4"+secret → date → region → service → aws4_request. */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export function signRequest(input: SignRequestInput): SignedHeaders {
  const dateStamp = input.amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  const headerMap: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": input.payloadHashHex,
    "x-amz-date": input.amzDate,
    ...Object.fromEntries(
      Object.entries(input.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
  };
  const sortedHeaderKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headerMap[k]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHashHex,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = deriveSigningKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    input.service,
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers: { ...headerMap, authorization } };
}

/** UTC timestamp in ISO basic format required by SigV4 (e.g. 20260810T004500Z). */
export function amzDate(date: Date): string {
  return `${date.toISOString().replace(/[:-]|\.\d{3}/g, "")}`;
}
