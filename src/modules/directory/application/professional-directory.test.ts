import { describe, expect, it } from "vitest";
import { canIndexProfessionalProfile, canPublishProfessionalIdentity } from "./professional-directory";

describe("professional directory publication", () => {
  it("requires verified identity and an authoritative source", () => {
    expect(canPublishProfessionalIdentity({ verification: "verified", authoritativeSourceUrl: "https://bar.example/profile" })).toBe(true);
    expect(canPublishProfessionalIdentity({ verification: "verified" })).toBe(false);
    expect(canPublishProfessionalIdentity({ verification: "not_verified", authoritativeSourceUrl: "https://bar.example/profile" })).toBe(false);
  });

  it("requires a separate positive indexing decision", () => {
    expect(canIndexProfessionalProfile({ verification: "verified", indexable: true, authoritativeSourceUrl: "https://bar.example/profile" })).toBe(true);
    expect(canIndexProfessionalProfile({ verification: "verified", indexable: false, authoritativeSourceUrl: "https://bar.example/profile" })).toBe(false);
  });
});

