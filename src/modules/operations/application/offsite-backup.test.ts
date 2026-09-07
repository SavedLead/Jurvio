import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupObjectKey,
  BACKUP_HEADER_BYTES,
  canonicalQuery,
  completeMultipartBody,
  decodeBackupHeader,
  encodeBackupHeader,
  firstXmlTagText,
  OffsiteBackupStore,
  parseEncryptionKey,
  parseListObjects,
  resolveOffsiteBackupConfig,
} from "./offsite-backup";

const KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");

const config = {
  bucket: "jurvio-db-backups",
  region: "nyc3",
  host: "nyc3.digitaloceanspaces.com",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret",
  encryptionKey: Buffer.alloc(32, 7),
};

/**
 * In-memory S3-compatible double. Records every request so the tests can assert
 * the multipart protocol, and concatenates parts the way S3 does so the stored
 * object can be read back through the real decryption path.
 */
function fakeSpaces(chunkSize = 8192) {
  const uploads = new Map<string, Buffer[]>();
  const objects = new Map<string, Buffer>();
  const requests: Array<{ method: string; url: string }> = [];

  const respond = (status: number, body = "", headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
    body: null as unknown,
  });

  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: Uint8Array },
  ) => {
    requests.push({ method: init.method, url });
    const parsed = new URL(url);
    const key = parsed.pathname.replace(`/${config.bucket}/`, "");
    const params = parsed.searchParams;

    if (init.method === "POST" && params.has("uploads")) {
      uploads.set(key, []);
      return respond(200, "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>");
    }
    if (init.method === "PUT" && params.has("partNumber")) {
      const parts = uploads.get(key);
      if (!parts) return respond(404, "<Error><Code>NoSuchUpload</Code></Error>");
      parts[Number(params.get("partNumber")) - 1] = Buffer.from(init.body ?? new Uint8Array());
      return respond(200, "", { etag: `"etag-${params.get("partNumber")}"` });
    }
    if (init.method === "POST" && params.has("uploadId")) {
      objects.set(key, Buffer.concat(uploads.get(key) ?? []));
      uploads.delete(key);
      return respond(200, "<CompleteMultipartUploadResult/>");
    }
    if (init.method === "DELETE" && params.has("uploadId")) {
      uploads.delete(key);
      return respond(204);
    }
    if (init.method === "HEAD") {
      return objects.has(key) ? respond(200) : respond(404);
    }
    if (init.method === "GET" && params.get("list-type") === "2") {
      const prefix = params.get("prefix") ?? "";
      const contents = [...objects.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, value], index) =>
          `<Contents><Key>${name}</Key><Size>${value.length}</Size>` +
          `<LastModified>2026-09-0${index + 1}T00:00:00.000Z</LastModified></Contents>`)
        .join("");
      return respond(200, `<ListBucketResult>${contents}</ListBucketResult>`);
    }
    if (init.method === "GET") {
      const stored = objects.get(key);
      if (!stored) return respond(404, "<Error><Code>NoSuchKey</Code></Error>");
      return {
        ...respond(200),
        body: (async function* () {
          // Chunk size is a knob so one test can hand the decoder a 7-byte
          // dribble -- exercising header assembly across chunks and the
          // tag holdback -- without slowing the large round-trip.
          for (let offset = 0; offset < stored.length; offset += chunkSize) {
            yield stored.subarray(offset, offset + chunkSize);
          }
        })(),
      };
    }
    return respond(400, "<Error><Code>Unexpected</Code></Error>");
  };

  return { fetch, objects, requests };
}

describe("backup encryption framing", () => {
  it("round-trips the initialization vector", () => {
    const iv = randomBytes(12);
    expect(decodeBackupHeader(encodeBackupHeader(iv)).iv).toEqual(iv);
  });

  it("rejects a foreign or truncated header", () => {
    expect(() => decodeBackupHeader(Buffer.alloc(4))).toThrow(/truncated/);
    expect(() => decodeBackupHeader(Buffer.alloc(BACKUP_HEADER_BYTES))).toThrow(/bad magic/);
  });

  it("accepts base64 and hex keys but never a short one", () => {
    expect(parseEncryptionKey(KEY_BASE64)).toHaveLength(32);
    expect(parseEncryptionKey(Buffer.alloc(32, 3).toString("hex"))).toHaveLength(32);
    expect(() => parseEncryptionKey("too-short")).toThrow(/exactly 32 bytes/);
  });
});

describe("configuration", () => {
  it("names every missing variable at once", () => {
    expect(() => resolveOffsiteBackupConfig({})).toThrow(/JURVIO_BACKUP_BUCKET/);
    expect(() => resolveOffsiteBackupConfig({})).toThrow(/JURVIO_BACKUP_ENCRYPTION_KEY/);
  });

  it("falls back to the Spaces credentials but never to the artifact bucket", () => {
    const resolved = resolveOffsiteBackupConfig({
      JURVIO_BACKUP_BUCKET: "jurvio-db-backups",
      JURVIO_BACKUP_ENCRYPTION_KEY: KEY_BASE64,
      JURVIO_SPACES_ACCESS_KEY_ID: "spaces-key",
      JURVIO_SPACES_SECRET_ACCESS_KEY: "spaces-secret",
    });
    expect(resolved.bucket).toBe("jurvio-db-backups");
    expect(resolved.accessKeyId).toBe("spaces-key");
    expect(resolved.region).toBe("nyc3");
    // A bucket is never inherited from the artifact store.
    expect(() =>
      resolveOffsiteBackupConfig({
        JURVIO_SPACES_BUCKET: "jurvio-raw-evidence",
        JURVIO_BACKUP_ENCRYPTION_KEY: KEY_BASE64,
        JURVIO_SPACES_ACCESS_KEY_ID: "k",
        JURVIO_SPACES_SECRET_ACCESS_KEY: "s",
      }),
    ).toThrow(/JURVIO_BACKUP_BUCKET/);
  });
});

describe("object keys and S3 encoding", () => {
  it("partitions keys by the dump's own timestamp", () => {
    expect(backupObjectKey("/opt/jurvio/backups/jurvio-20260907T130836Z.sql.gz")).toBe(
      "database/2026/09/jurvio-20260907T130836Z.sql.gz.enc",
    );
  });

  it("does not lose an unrecognized file name", () => {
    expect(backupObjectKey("adhoc-dump.sql.gz")).toBe("database/unknown/unknown/adhoc-dump.sql.gz.enc");
  });

  it("sorts and encodes the canonical query", () => {
    expect(canonicalQuery({ uploadId: "a b/c", partNumber: "2" })).toBe("partNumber=2&uploadId=a%20b%2Fc");
    expect(canonicalQuery({ uploads: "" })).toBe("uploads=");
  });

  it("parses list responses oldest first and reads single tags", () => {
    const parsed = parseListObjects(
      "<ListBucketResult>" +
        "<Contents><Key>database/b</Key><Size>2</Size><LastModified>2026-09-02T00:00:00Z</LastModified></Contents>" +
        "<Contents><Key>database/a</Key><Size>1</Size><LastModified>2026-09-01T00:00:00Z</LastModified></Contents>" +
        "</ListBucketResult>",
    );
    expect(parsed.map((object) => object.key)).toEqual(["database/a", "database/b"]);
    expect(firstXmlTagText("<UploadId>xyz</UploadId>", "UploadId")).toBe("xyz");
  });

  it("builds a complete-multipart body in part order", () => {
    expect(completeMultipartBody([{ partNumber: 1, etag: '"e1"' }])).toContain(
      "<Part><PartNumber>1</PartNumber><ETag>\"e1\"</ETag></Part>",
    );
  });
});

describe("encrypted upload and restore", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jurvio-backup-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a dump through encryption, storage and decryption", async () => {
    const plaintext = randomBytes(300_000);
    const source = join(dir, "jurvio-20260907T130836Z.sql.gz");
    await writeFile(source, plaintext);

    const spaces = fakeSpaces();
    const store = new OffsiteBackupStore(config, { fetch: spaces.fetch });
    const key = backupObjectKey(source);
    const uploaded = await store.uploadEncrypted(source, key);

    expect(uploaded.plaintextBytes).toBe(plaintext.length);
    expect(uploaded.plaintextSha256).toBe(createHash("sha256").update(plaintext).digest("hex"));
    // Header + ciphertext + GCM tag.
    expect(uploaded.uploadedBytes).toBe(plaintext.length + BACKUP_HEADER_BYTES + 16);

    // Nothing recognizable from the dump reaches storage.
    const stored = spaces.objects.get(key);
    expect(stored).toBeDefined();
    expect(stored?.subarray(BACKUP_HEADER_BYTES, BACKUP_HEADER_BYTES + 64)).not.toEqual(
      plaintext.subarray(0, 64),
    );

    const dest = join(dir, "restored.sql.gz");
    const restored = await store.downloadDecrypted(key, dest);
    expect(await readFile(dest)).toEqual(plaintext);
    expect(restored.sha256).toBe(uploaded.plaintextSha256);
    expect(restored.bytes).toBe(plaintext.length);
  });

  it("refuses a tampered object instead of returning corrupt plaintext", async () => {
    const source = join(dir, "jurvio-20260907T130836Z.sql.gz");
    await writeFile(source, randomBytes(20_000));

    const spaces = fakeSpaces(7);
    const store = new OffsiteBackupStore(config, { fetch: spaces.fetch });
    const key = backupObjectKey(source);
    await store.uploadEncrypted(source, key);

    const stored = spaces.objects.get(key) as Buffer;
    const flipAt = BACKUP_HEADER_BYTES + 100;
    stored.writeUInt8(stored.readUInt8(flipAt) ^ 0xff, flipAt);

    await expect(store.downloadDecrypted(key, join(dir, "restored.sql.gz"))).rejects.toThrow();
  });

  it("aborts the multipart upload when a part fails, leaving no partial object", async () => {
    const source = join(dir, "jurvio-20260907T130836Z.sql.gz");
    await writeFile(source, randomBytes(1_000));

    const spaces = fakeSpaces();
    const failing = async (
      url: string,
      init: { method: string; headers: Record<string, string>; body?: Uint8Array },
    ) => (init.method === "PUT"
      ? { status: 403, headers: { get: () => null }, text: async () => "<Error><Code>AccessDenied</Code></Error>", body: null }
      : spaces.fetch(url, init));

    const store = new OffsiteBackupStore(config, { fetch: failing });
    await expect(store.uploadEncrypted(source, "database/2026/09/x.sql.gz.enc")).rejects.toThrow(
      /AccessDenied/,
    );
    expect(spaces.objects.size).toBe(0);
    expect(spaces.requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("reports the newest stored backup", async () => {
    const spaces = fakeSpaces();
    const store = new OffsiteBackupStore(config, { fetch: spaces.fetch });
    for (const stamp of ["20260901T000000Z", "20260902T000000Z"]) {
      const file = join(dir, `jurvio-${stamp}.sql.gz`);
      await writeFile(file, randomBytes(64));
      await store.uploadEncrypted(file, backupObjectKey(file));
    }
    const newest = await store.latest("database/");
    expect(newest?.key).toContain("20260902T000000Z");
    expect(await store.exists(newest?.key ?? "")).toBe(true);
  });
});
