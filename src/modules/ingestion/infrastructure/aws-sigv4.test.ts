import { describe, expect, it } from "vitest";
import { amzDate, deriveSigningKey, encodeRfc3986, sha256Hex, signRequest } from "./aws-sigv4";

describe("aws-sigv4", () => {
  it("derives the signing key matching AWS's published test vector", () => {
    // From AWS docs "Examples of how to derive a signing key for Signature Version 4".
    const key = deriveSigningKey(
      "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      "20120215",
      "us-east-1",
      "iam",
    );
    expect(key.toString("hex")).toBe(
      "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d",
    );
  });

  it("hashes an empty payload to the well-known SHA-256", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("encodes RFC-3986 reserved characters that encodeURIComponent leaves alone", () => {
    expect(encodeRfc3986("a b!*'()~")).toBe("a%20b%21%2A%27%28%29~");
  });

  it("formats amzDate in ISO basic form", () => {
    expect(amzDate(new Date("2026-08-10T00:45:00.123Z"))).toBe("20260810T004500Z");
  });

  it("produces a deterministic, well-formed Authorization header", () => {
    const signed = signRequest({
      method: "PUT",
      host: "nyc3.digitaloceanspaces.com",
      path: "/jurvio-raw-evidence/courtlistener/docket/123.json",
      payloadHashHex: sha256Hex("{}"),
      region: "nyc3",
      service: "s3",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretexamplekey",
      amzDate: "20260810T004500Z",
    });
    const auth = signed.headers["authorization"];
    expect(auth).toContain(
      "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/20260810/nyc3/s3/aws4_request",
    );
    // Host is signed; content-sha256 and date are signed; ordering is deterministic.
    expect(auth).toContain(
      "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
    );
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(signed.headers["x-amz-date"]).toBe("20260810T004500Z");
    expect(signed.headers["x-amz-content-sha256"]).toBe(sha256Hex("{}"));

    // Signing is stable across calls with identical inputs.
    const again = signRequest({
      method: "PUT",
      host: "nyc3.digitaloceanspaces.com",
      path: "/jurvio-raw-evidence/courtlistener/docket/123.json",
      payloadHashHex: sha256Hex("{}"),
      region: "nyc3",
      service: "s3",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secretexamplekey",
      amzDate: "20260810T004500Z",
    });
    expect(again.headers["authorization"]).toBe(auth);
  });
});
