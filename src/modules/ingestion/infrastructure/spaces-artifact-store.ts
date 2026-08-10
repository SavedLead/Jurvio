import type { ArtifactStore, ArtifactWrite } from "../application/artifact-store";
import { amzDate, sha256Hex, signRequest } from "./aws-sigv4";

export interface SpacesConfig {
  readonly bucket: string;
  readonly region: string;
  /** Endpoint host for path-style addressing, e.g. "nyc3.digitaloceanspaces.com". */
  readonly host: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

interface FetchResponseLike {
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Result of a read-only existence check against Spaces. */
export interface SpacesHeadResult {
  readonly exists: boolean;
  readonly status: number;
  /** The stored `x-amz-meta-content-hash` metadata, when present on the object. */
  readonly contentHash: string | null;
}
type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<FetchResponseLike>;

export interface SpacesDeps {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

function sanitizeKey(key: string): string {
  return key.replaceAll("..", "").replace(/^\/+/, "");
}

function toBytes(body: string | Uint8Array): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

/**
 * Immutable, content-addressed raw-artifact store backed by DigitalOcean Spaces
 * (S3-compatible), path-style. `putIfAbsent` is idempotent: it HEADs first and
 * only PUTs when the object is missing, so re-runs never rewrite or duplicate a
 * raw source artifact. The declared content hash is persisted as object metadata
 * (`x-amz-meta-content-hash`) so a stored artifact can be traced back to the
 * normalized/published record. Never logs credentials or bodies.
 */
export class SpacesArtifactStore implements ArtifactStore {
  private readonly fetch: FetchLike;
  private readonly now: () => Date;

  constructor(private readonly config: SpacesConfig, deps: SpacesDeps = {}) {
    const injected = deps.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!injected) throw new Error("SpacesArtifactStore requires a fetch implementation");
    this.fetch = injected;
    this.now = deps.now ?? (() => new Date());
  }

  private url(objectKey: string): string {
    return `https://${this.config.host}/${this.config.bucket}/${objectKey}`;
  }

  private sign(
    method: string,
    objectKey: string,
    payloadHashHex: string,
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    return signRequest({
      method,
      host: this.config.host,
      path: `/${this.config.bucket}/${objectKey}`,
      payloadHashHex,
      region: this.config.region,
      service: "s3",
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      amzDate: amzDate(this.now()),
      extraHeaders,
    }).headers;
  }

  /**
   * Read-only existence + content-hash check for a stored object. Used to verify
   * that a raw artifact recorded in the database is actually present in Spaces and
   * that its stored `x-amz-meta-content-hash` matches the normalized record's
   * content hash. Never writes.
   */
  async head(objectKey: string): Promise<SpacesHeadResult> {
    const key = sanitizeKey(objectKey);
    const res = await this.fetch(this.url(key), {
      method: "HEAD",
      headers: this.sign("HEAD", key, sha256Hex("")),
    });
    if (res.status !== 200 && res.status !== 404) {
      throw new Error(`Spaces HEAD ${key} failed with status ${res.status}`);
    }
    return {
      exists: res.status === 200,
      status: res.status,
      contentHash: res.headers?.get("x-amz-meta-content-hash") ?? null,
    };
  }

  async putIfAbsent(input: ArtifactWrite): Promise<{ objectKey: string }> {
    const objectKey = sanitizeKey(input.key);
    const emptyHash = sha256Hex("");

    const head = await this.fetch(this.url(objectKey), {
      method: "HEAD",
      headers: this.sign("HEAD", objectKey, emptyHash),
    });
    if (head.status === 200) return { objectKey }; // already stored — immutable, do not rewrite
    if (head.status !== 404) {
      throw new Error(`Spaces HEAD ${objectKey} failed with status ${head.status}`);
    }

    const bytes = toBytes(input.body);
    const payloadHashHex = sha256Hex(bytes);
    const put = await this.fetch(this.url(objectKey), {
      method: "PUT",
      headers: this.sign("PUT", objectKey, payloadHashHex, {
        "content-type": input.mediaType,
        "x-amz-meta-content-hash": input.contentHash,
      }),
      body: bytes,
    });
    // Treat a lost race (created concurrently) as success; the object is present either way.
    if (put.status !== 200 && put.status !== 201 && put.status !== 412) {
      throw new Error(`Spaces PUT ${objectKey} failed with status ${put.status}`);
    }
    return { objectKey };
  }
}
