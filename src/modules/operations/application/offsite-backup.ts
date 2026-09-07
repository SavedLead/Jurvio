import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DecipherGCM } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { amzDate, encodeRfc3986, sha256Hex, signRequest } from "@/modules/ingestion/infrastructure/aws-sigv4";

/**
 * Encrypted off-Droplet database backups.
 *
 * The production readiness checklist treats the local pre-migration dump as a
 * release-rollback aid, NOT disaster recovery: "a separate encrypted backup
 * location and a successful restore test are required before public launch".
 * This module is that location. It streams a `pg_dump | gzip` file through
 * AES-256-GCM and into S3-compatible object storage (DigitalOcean Spaces) with
 * a multipart upload, and reads it back the same way for restore rehearsals.
 *
 * Deliberately dependency-free (reusing the existing SigV4 signer) for the same
 * reason the artifact store is: these run as esbuild-bundled jobs inside the
 * production image, which carries no compiler or AWS SDK.
 *
 * Memory is bounded by the part size, never the dump size — the database is
 * ~19 GB and growing, so nothing here may buffer a whole file.
 */

/** Object-storage + encryption configuration for off-site backups. */
export interface OffsiteBackupConfig {
  readonly bucket: string;
  readonly region: string;
  /** Endpoint host for path-style addressing, e.g. "nyc3.digitaloceanspaces.com". */
  readonly host: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** 32-byte AES-256 key. */
  readonly encryptionKey: Buffer;
}

/** File framing: magic + version + IV, then ciphertext, then the GCM tag. */
const MAGIC = Buffer.from("JURVIODB", "ascii");
const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const BACKUP_HEADER_BYTES = MAGIC.length + 1 + IV_BYTES;

/**
 * S3 requires every part except the last to be at least 5 MiB. 64 MiB keeps the
 * part count for a multi-GB dump well under the 10,000 limit while bounding
 * resident memory to one part.
 */
export const PART_BYTES = 64 * 1024 * 1024;

export function encodeBackupHeader(iv: Buffer): Buffer {
  if (iv.length !== IV_BYTES) throw new Error(`backup IV must be ${IV_BYTES} bytes`);
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), iv]);
}

export function decodeBackupHeader(header: Buffer): { iv: Buffer } {
  if (header.length < BACKUP_HEADER_BYTES) throw new Error("backup header is truncated");
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("not a Jurvio encrypted backup (bad magic)");
  }
  const version = header[MAGIC.length];
  if (version !== FORMAT_VERSION) {
    throw new Error(`unsupported Jurvio backup format version ${version}`);
  }
  return { iv: header.subarray(MAGIC.length + 1, BACKUP_HEADER_BYTES) };
}

/**
 * Parses the AES-256 key. Accepts base64 or hex so the secret can be pasted from
 * whichever tool generated it; both must decode to exactly 32 bytes. A short or
 * malformed key fails loudly here rather than producing an unrecoverable backup.
 */
export function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      "JURVIO_BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes " +
        "(44-character base64 or 64-character hex). Generate one with: " +
        "openssl rand -base64 32",
    );
  }
  return decoded;
}

/**
 * Resolves configuration from the environment, naming every missing variable in
 * one error instead of failing one at a time across nightly runs.
 *
 * Credentials default to the Spaces keys the box already carries for the raw
 * artifact store, but the BUCKET deliberately does not: backups belong in a
 * separate bucket from `jurvio-raw-evidence` so a credential or lifecycle
 * mistake on one cannot take the other with it.
 */
export function resolveOffsiteBackupConfig(
  env: Record<string, string | undefined> = process.env,
): OffsiteBackupConfig {
  const accessKeyId = env.JURVIO_BACKUP_ACCESS_KEY_ID ?? env.JURVIO_SPACES_ACCESS_KEY_ID;
  const secretAccessKey =
    env.JURVIO_BACKUP_SECRET_ACCESS_KEY ?? env.JURVIO_SPACES_SECRET_ACCESS_KEY;
  const bucket = env.JURVIO_BACKUP_BUCKET;
  const rawKey = env.JURVIO_BACKUP_ENCRYPTION_KEY;

  const missing: string[] = [];
  if (!bucket) missing.push("JURVIO_BACKUP_BUCKET");
  if (!accessKeyId) missing.push("JURVIO_BACKUP_ACCESS_KEY_ID (or JURVIO_SPACES_ACCESS_KEY_ID)");
  if (!secretAccessKey) {
    missing.push("JURVIO_BACKUP_SECRET_ACCESS_KEY (or JURVIO_SPACES_SECRET_ACCESS_KEY)");
  }
  if (!rawKey) missing.push("JURVIO_BACKUP_ENCRYPTION_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Off-site database backup is not configured. Missing: ${missing.join(", ")}. ` +
        "Set these in /opt/jurvio/.env.production (mode 600) and in GitHub's " +
        "protected production environment.",
    );
  }

  const endpoint =
    env.JURVIO_BACKUP_ENDPOINT ??
    env.JURVIO_SPACES_ENDPOINT ??
    "https://nyc3.digitaloceanspaces.com";
  const host = new URL(endpoint).host;
  return {
    bucket: bucket as string,
    host,
    region: env.JURVIO_BACKUP_REGION ?? env.JURVIO_SPACES_REGION ?? host.split(".")[0] ?? "nyc3",
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    encryptionKey: parseEncryptionKey(rawKey as string),
  };
}

/** True when every off-site backup variable is present (used for fail-fast checks). */
export function offsiteBackupConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    resolveOffsiteBackupConfig(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Object key for a dump file. Date-partitioned so a bucket listing stays
 * navigable for years, and suffixed `.enc` so nobody mistakes the object for a
 * directly restorable dump.
 */
export function backupObjectKey(fileName: string, prefix = "database"): string {
  const base = fileName.replace(/^.*\//, "");
  const stamp = /(\d{4})(\d{2})\d{2}T\d{6}Z/.exec(base);
  const year = stamp?.[1] ?? "unknown";
  const month = stamp?.[2] ?? "unknown";
  return `${prefix}/${year}/${month}/${base}.enc`;
}

/** Canonical (sorted, RFC 3986-encoded) query string for SigV4. */
export function canonicalQuery(params: Readonly<Record<string, string>>): string {
  return Object.entries(params)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** Extracts the text of the first `<tag>` element. Sufficient for S3's flat replies. */
export function firstXmlTagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1] ?? null;
}

export interface BackupObjectSummary {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
}

/** Parses a ListObjectsV2 response body into summaries, newest last. */
export function parseListObjects(xml: string): BackupObjectSummary[] {
  const objects: BackupObjectSummary[] = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const body = match[1] ?? "";
    const key = firstXmlTagText(body, "Key");
    if (!key) continue;
    objects.push({
      key,
      size: Number(firstXmlTagText(body, "Size") ?? 0),
      lastModified: firstXmlTagText(body, "LastModified") ?? "",
    });
  }
  return objects.sort((a, b) => (a.lastModified < b.lastModified ? -1 : 1));
}

/** Builds the CompleteMultipartUpload body from the collected part ETags. */
export function completeMultipartBody(parts: ReadonlyArray<{ partNumber: number; etag: string }>): string {
  const body = parts
    .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  readonly body: unknown;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<FetchResponseLike>;

export interface OffsiteBackupDeps {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export interface UploadResult {
  readonly objectKey: string;
  readonly plaintextBytes: number;
  readonly uploadedBytes: number;
  readonly parts: number;
  /** SHA-256 of the plaintext file, so a restored dump can be proven identical. */
  readonly plaintextSha256: string;
}

/**
 * Encrypted, streaming backup store over S3-compatible object storage.
 * Never logs credentials, keys, or object contents.
 */
export class OffsiteBackupStore {
  private readonly fetch: FetchLike;
  private readonly now: () => Date;

  constructor(private readonly config: OffsiteBackupConfig, deps: OffsiteBackupDeps = {}) {
    const injected = deps.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!injected) throw new Error("OffsiteBackupStore requires a fetch implementation");
    this.fetch = injected;
    this.now = deps.now ?? (() => new Date());
  }

  private url(path: string, query: string): string {
    const encoded = path.split("/").map(encodeRfc3986).join("/");
    return `https://${this.config.host}${encoded}${query ? `?${query}` : ""}`;
  }

  private sign(
    method: string,
    path: string,
    query: string,
    payloadHashHex: string,
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    return signRequest({
      method,
      host: this.config.host,
      path,
      query,
      payloadHashHex,
      region: this.config.region,
      service: "s3",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate: amzDate(this.now()),
      extraHeaders,
    }).headers;
  }

  private async send(
    method: string,
    objectKey: string,
    params: Readonly<Record<string, string>>,
    body?: Uint8Array,
    extraHeaders?: Record<string, string>,
  ): Promise<FetchResponseLike> {
    const path = `/${this.config.bucket}${objectKey ? `/${objectKey}` : ""}`;
    const query = canonicalQuery(params);
    const payloadHash = body ? sha256Hex(body) : sha256Hex("");
    const headers = this.sign(method, path, query, payloadHash, extraHeaders);
    return this.fetch(this.url(path, query), { method, headers, ...(body ? { body } : {}) });
  }

  private async expectOk(res: FetchResponseLike, what: string): Promise<FetchResponseLike> {
    if (res.status >= 200 && res.status < 300) return res;
    // S3 error bodies name the condition (AccessDenied, NoSuchBucket, ...) and
    // contain no secrets, so surfacing the code turns a silent nightly red into
    // an actionable one.
    const detail = firstXmlTagText(await res.text().catch(() => ""), "Code");
    throw new Error(`${what} failed with status ${res.status}${detail ? ` (${detail})` : ""}`);
  }

  /** Lists objects under a prefix, oldest first. */
  async list(prefix: string): Promise<BackupObjectSummary[]> {
    const res = await this.expectOk(
      await this.send("GET", "", { "list-type": "2", prefix }),
      `Spaces LIST ${prefix}`,
    );
    return parseListObjects(await res.text());
  }

  /** Most recent object under a prefix, or null when the prefix is empty. */
  async latest(prefix: string): Promise<BackupObjectSummary | null> {
    const objects = await this.list(prefix);
    return objects.at(-1) ?? null;
  }

  /** True when the object exists. */
  async exists(objectKey: string): Promise<boolean> {
    const res = await this.send("HEAD", objectKey, {});
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(`Spaces HEAD ${objectKey} failed with status ${res.status}`);
  }

  /**
   * Encrypts `filePath` with AES-256-GCM and uploads it as a multipart object.
   * The file is read in chunks and each part is released before the next is
   * read, so peak memory is one part regardless of dump size. A failure aborts
   * the multipart upload so no partial object is billed or mistaken for a
   * usable backup.
   */
  async uploadEncrypted(filePath: string, objectKey: string): Promise<UploadResult> {
    const { size: plaintextBytes } = await stat(filePath);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.config.encryptionKey, iv);
    const plaintextDigest = createHash("sha256");

    const created = await this.expectOk(
      await this.send("POST", objectKey, { uploads: "" }, new Uint8Array(0), {
        "content-type": "application/octet-stream",
      }),
      `Spaces multipart create ${objectKey}`,
    );
    const uploadId = firstXmlTagText(await created.text(), "UploadId");
    if (!uploadId) throw new Error(`Spaces multipart create ${objectKey} returned no UploadId`);

    const parts: Array<{ partNumber: number; etag: string }> = [];
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let uploadedBytes = 0;

    // Uploads whole parts as they accumulate; `final` also flushes the short
    // trailing part. Buffered bytes never exceed one part plus one read chunk.
    const flush = async (final: boolean) => {
      while (pendingBytes >= PART_BYTES || (final && pendingBytes > 0)) {
        const buffer = Buffer.concat(pending, pendingBytes);
        const take = Math.min(PART_BYTES, buffer.length);
        const part = buffer.subarray(0, take);
        const rest = buffer.subarray(take);
        pending = rest.length > 0 ? [rest] : [];
        pendingBytes = rest.length;

        const partNumber = parts.length + 1;
        const res = await this.expectOk(
          await this.send("PUT", objectKey, { partNumber: String(partNumber), uploadId }, part),
          `Spaces upload part ${partNumber} of ${objectKey}`,
        );
        const etag = res.headers.get("etag");
        if (!etag) throw new Error(`Spaces part ${partNumber} of ${objectKey} returned no ETag`);
        parts.push({ partNumber, etag });
        uploadedBytes += part.length;
      }
    };

    try {
      pending.push(encodeBackupHeader(iv));
      pendingBytes += BACKUP_HEADER_BYTES;

      for await (const chunk of createReadStream(filePath)) {
        const plain = chunk as Buffer;
        plaintextDigest.update(plain);
        const encrypted = cipher.update(plain);
        if (encrypted.length > 0) {
          pending.push(encrypted);
          pendingBytes += encrypted.length;
        }
        await flush(false);
      }
      const tail = Buffer.concat([cipher.final(), cipher.getAuthTag()]);
      pending.push(tail);
      pendingBytes += tail.length;
      await flush(true);

      const body = new TextEncoder().encode(completeMultipartBody(parts));
      await this.expectOk(
        await this.send("POST", objectKey, { uploadId }, body, { "content-type": "application/xml" }),
        `Spaces multipart complete ${objectKey}`,
      );
    } catch (error) {
      // Best-effort abort: the upload already failed, and masking that failure
      // with a cleanup error would hide the real cause.
      await this.send("DELETE", objectKey, { uploadId }).catch(() => undefined);
      throw error;
    }

    return {
      objectKey,
      plaintextBytes,
      uploadedBytes,
      parts: parts.length,
      plaintextSha256: plaintextDigest.digest("hex"),
    };
  }

  /**
   * Downloads and decrypts an object to `destPath`, returning the plaintext
   * SHA-256 so it can be compared against the value recorded at upload time.
   * Throws if the GCM tag does not authenticate — a corrupted or tampered
   * backup fails here rather than halfway through a restore.
   */
  async downloadDecrypted(objectKey: string, destPath: string): Promise<{ bytes: number; sha256: string }> {
    const res = await this.expectOk(
      await this.send("GET", objectKey, {}),
      `Spaces GET ${objectKey}`,
    );
    const body = res.body as AsyncIterable<Uint8Array> | null;
    if (!body) throw new Error(`Spaces GET ${objectKey} returned no body`);

    const config = this.config;
    const digest = createHash("sha256");
    let bytes = 0;
    // Typed as the GCM variant so setAuthTag is available: the union that
    // createDecipheriv returns does not carry it.
    let decipher: DecipherGCM | null = null;
    let header = Buffer.alloc(0);
    // The GCM tag is the last 16 bytes of the object, and a stream cannot know
    // it has reached the end until it does — so always hold back a 16-byte tail.
    let tail = Buffer.alloc(0);

    const out = createWriteStream(destPath);
    const plaintext = async function* (): AsyncGenerator<Buffer> {
      for await (const chunk of body) {
        let buffer = Buffer.from(chunk);
        if (!decipher) {
          header = Buffer.concat([header, buffer]);
          if (header.length < BACKUP_HEADER_BYTES) continue;
          const { iv } = decodeBackupHeader(header);
          decipher = createDecipheriv("aes-256-gcm", config.encryptionKey, iv) as DecipherGCM;
          buffer = header.subarray(BACKUP_HEADER_BYTES);
          header = Buffer.alloc(0);
        }
        const combined = Buffer.concat([tail, buffer]);
        if (combined.length <= TAG_BYTES) {
          tail = combined;
          continue;
        }
        tail = combined.subarray(combined.length - TAG_BYTES);
        const decrypted = decipher.update(combined.subarray(0, combined.length - TAG_BYTES));
        if (decrypted.length > 0) {
          digest.update(decrypted);
          bytes += decrypted.length;
          yield decrypted;
        }
      }
      if (!decipher) throw new Error(`Spaces GET ${objectKey} returned a truncated backup header`);
      if (tail.length !== TAG_BYTES) throw new Error(`${objectKey} is truncated: missing authentication tag`);
      decipher.setAuthTag(tail);
      const final = decipher.final();
      if (final.length > 0) {
        digest.update(final);
        bytes += final.length;
        yield final;
      }
    };
    await pipeline(plaintext(), out);
    return { bytes, sha256: digest.digest("hex") };
  }
}
