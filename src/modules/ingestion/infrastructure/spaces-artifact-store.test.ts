import { describe, expect, it } from "vitest";
import { SpacesArtifactStore, type SpacesConfig } from "./spaces-artifact-store";

const config: SpacesConfig = {
  bucket: "jurvio-raw-evidence",
  region: "nyc3",
  host: "nyc3.digitaloceanspaces.com",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretexamplekey",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

function recorder(statuses: number[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: Uint8Array },
  ) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const status = statuses[i++] ?? 500;
    return { status, text: async () => "" };
  };
  return { calls, fetch };
}

const now = () => new Date("2026-08-10T00:45:00Z");

describe("SpacesArtifactStore.putIfAbsent", () => {
  it("PUTs when the object is absent (HEAD 404 → PUT 200), with provenance metadata", async () => {
    const { calls, fetch } = recorder([404, 200]);
    const store = new SpacesArtifactStore(config, { fetch, now });
    const result = await store.putIfAbsent({
      key: "/courtlistener/docket/123.json",
      mediaType: "application/json",
      body: "{}",
      contentHash: "deadbeef",
    });
    expect(result.objectKey).toBe("courtlistener/docket/123.json"); // leading slash sanitized
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT"]);
    expect(calls[1]?.url).toBe(
      "https://nyc3.digitaloceanspaces.com/jurvio-raw-evidence/courtlistener/docket/123.json",
    );
    expect(calls[1]?.headers["x-amz-meta-content-hash"]).toBe("deadbeef");
    expect(calls[1]?.headers["content-type"]).toBe("application/json");
    expect(calls[1]?.headers["authorization"]).toContain("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE");
  });

  it("does NOT rewrite when the object already exists (HEAD 200 → no PUT)", async () => {
    const { calls, fetch } = recorder([200]);
    const store = new SpacesArtifactStore(config, { fetch, now });
    const result = await store.putIfAbsent({
      key: "courtlistener/docket/123.json",
      mediaType: "application/json",
      body: "{}",
      contentHash: "deadbeef",
    });
    expect(result.objectKey).toBe("courtlistener/docket/123.json");
    expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
  });

  it("throws on an unexpected HEAD status", async () => {
    const { fetch } = recorder([403]);
    const store = new SpacesArtifactStore(config, { fetch, now });
    await expect(
      store.putIfAbsent({ key: "k", mediaType: "text/plain", body: "x", contentHash: "h" }),
    ).rejects.toThrow(/HEAD .* status 403/);
  });

  it("throws on a failed PUT", async () => {
    const { fetch } = recorder([404, 500]);
    const store = new SpacesArtifactStore(config, { fetch, now });
    await expect(
      store.putIfAbsent({ key: "k", mediaType: "text/plain", body: "x", contentHash: "h" }),
    ).rejects.toThrow(/PUT .* status 500/);
  });

  it("tolerates a concurrent create (PUT 412) as success", async () => {
    const { calls, fetch } = recorder([404, 412]);
    const store = new SpacesArtifactStore(config, { fetch, now });
    const result = await store.putIfAbsent({
      key: "k",
      mediaType: "text/plain",
      body: "x",
      contentHash: "h",
    });
    expect(result.objectKey).toBe("k");
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT"]);
  });
});
