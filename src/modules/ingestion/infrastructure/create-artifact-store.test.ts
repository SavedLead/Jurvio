import { describe, expect, it } from "vitest";
import { createArtifactStore, spacesConfigured } from "./create-artifact-store";
import { LocalArtifactStore } from "./local-artifact-store";
import { SpacesArtifactStore } from "./spaces-artifact-store";

describe("createArtifactStore", () => {
  it("returns the local store when Spaces credentials are absent", () => {
    const store = createArtifactStore({ localRoot: ".data/raw", env: {} });
    expect(store).toBeInstanceOf(LocalArtifactStore);
    expect(spacesConfigured({})).toBe(false);
  });

  it("returns the Spaces store when both credentials are present, with defaults", () => {
    const env = {
      JURVIO_SPACES_ACCESS_KEY_ID: "AKIAEXAMPLE",
      JURVIO_SPACES_SECRET_ACCESS_KEY: "secretexamplekey",
    };
    const store = createArtifactStore({ localRoot: ".data/raw", env });
    expect(store).toBeInstanceOf(SpacesArtifactStore);
    expect(spacesConfigured(env)).toBe(true);
  });

  it("does not select Spaces when only one credential is present", () => {
    const store = createArtifactStore({
      localRoot: ".data/raw",
      env: { JURVIO_SPACES_ACCESS_KEY_ID: "AKIAEXAMPLE" },
    });
    expect(store).toBeInstanceOf(LocalArtifactStore);
  });

  it("throws in production when Spaces credentials are absent (no silent local fallback)", () => {
    expect(() =>
      createArtifactStore({ localRoot: ".data/raw", env: { NODE_ENV: "production" } }),
    ).toThrow(/Spaces object storage is required in production/);
  });

  it("allows the local store in production only with the explicit override", () => {
    const store = createArtifactStore({
      localRoot: ".data/raw",
      env: { NODE_ENV: "production", JURVIO_ALLOW_LOCAL_ARTIFACT_STORE: "1" },
    });
    expect(store).toBeInstanceOf(LocalArtifactStore);
  });

  it("still returns Spaces in production when credentials are present", () => {
    const store = createArtifactStore({
      localRoot: ".data/raw",
      env: {
        NODE_ENV: "production",
        JURVIO_SPACES_ACCESS_KEY_ID: "AKIAEXAMPLE",
        JURVIO_SPACES_SECRET_ACCESS_KEY: "secretexamplekey",
      },
    });
    expect(store).toBeInstanceOf(SpacesArtifactStore);
  });
});
