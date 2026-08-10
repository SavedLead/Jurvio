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
});
