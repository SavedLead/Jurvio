import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FEDERAL_COURTS,
  FEDERAL_COURT_REGISTRY_IDS,
  federalCourtRegistrationVerification,
  getFederalCourtEntry,
  isRegisteredFederalCourt,
} from "./federal-court-registry";

describe("federal court registry", () => {
  it("verifies a current Article III court of appeals and district court", () => {
    expect(getFederalCourtEntry("ca9")).toMatchObject({
      category: "current", courtClass: "court_of_appeals", article: "III", status: "active",
    });
    expect(getFederalCourtEntry("nysd")).toMatchObject({
      category: "current", courtClass: "district", article: "III", status: "active",
    });
    expect(federalCourtRegistrationVerification("ca9")).toBe("verified");
    expect(federalCourtRegistrationVerification("nysd")).toBe("verified");
  });

  it("verifies current specialized federal courts with the right article", () => {
    expect(getFederalCourtEntry("tax")).toMatchObject({ category: "current", courtClass: "specialized", article: "I" });
    expect(getFederalCourtEntry("uscfc")).toMatchObject({ category: "current", courtClass: "specialized", article: "I" });
    expect(getFederalCourtEntry("cit")).toMatchObject({ category: "current", courtClass: "specialized", article: "III" });
  });

  it("labels territorial district courts as Article IV", () => {
    expect(getFederalCourtEntry("gud")).toMatchObject({ category: "current", courtClass: "district", article: "IV" });
    expect(getFederalCourtEntry("vid")?.article).toBe("IV");
  });

  it("verifies historical/predecessor courts and records their successor", () => {
    expect(getFederalCourtEntry("bta")).toMatchObject({
      category: "historical", courtClass: "specialized", status: "abolished", supersededBy: "tax",
    });
    expect(getFederalCourtEntry("cusc")?.supersededBy).toBe("cit");
    expect(getFederalCourtEntry("ccpa")?.supersededBy).toBe("cafc");
    expect(getFederalCourtEntry("cc")?.supersededBy).toBe("cafc");
    // Every recorded successor is itself a verified registry court.
    for (const id of FEDERAL_COURT_REGISTRY_IDS) {
      const successor = getFederalCourtEntry(id)?.supersededBy;
      if (successor) expect(isRegisteredFederalCourt(successor)).toBe(true);
    }
  });

  it("verifies historical U.S. circuit courts and original districts", () => {
    expect(getFederalCourtEntry("circtsdny")).toMatchObject({
      category: "historical", courtClass: "circuit_court", status: "abolished",
    });
    expect(getFederalCourtEntry("nyd")).toMatchObject({ category: "historical", courtClass: "district" });
  });

  it("verifies current bankruptcy courts and appellate panels", () => {
    expect(getFederalCourtEntry("nysb")?.courtClass).toBe("bankruptcy");
    expect(getFederalCourtEntry("bap9")?.courtClass).toBe("bankruptcy_appellate_panel");
  });

  it("never verifies on the provider label: unknown ids stay not_verified", () => {
    expect(getFederalCourtEntry("totally-not-a-court")).toBeNull();
    expect(isRegisteredFederalCourt("totally-not-a-court")).toBe(false);
    expect(federalCourtRegistrationVerification("totally-not-a-court")).toBe("not_verified");
    expect(federalCourtRegistrationVerification(null)).toBe("not_verified");
    expect(federalCourtRegistrationVerification("")).toBe("not_verified");
  });

  it("keeps administrative tribunals, state and ambiguous courts unverified and documented", () => {
    for (const id of ["mspb", "bia", "ptab", "ttab", "asbca", "bva", "ag"]) {
      expect(isRegisteredFederalCourt(id)).toBe(false);
      expect(federalCourtRegistrationVerification(id)).toBe("not_verified");
      expect(EXCLUDED_FEDERAL_COURTS[id]).toBe("administrative_tribunal");
    }
    expect(EXCLUDED_FEDERAL_COURTS.alactapp).toBe("state_or_mismatched");
    expect(EXCLUDED_FEDERAL_COURTS.scotus).toBe("supreme_court_separate_pipeline");
    // Genuinely ambiguous federal-code ids are flagged for review, not verified.
    expect(EXCLUDED_FEDERAL_COURTS.ctappindterr).toBe("ambiguous_pending_review");
    expect(isRegisteredFederalCourt("ctappindterr")).toBe(false);
  });

  it("has no id both registered and excluded, and a well-formed registry", () => {
    for (const id of FEDERAL_COURT_REGISTRY_IDS) {
      expect(EXCLUDED_FEDERAL_COURTS[id]).toBeUndefined();
    }
    // Sanity on scope sizes (13 circuits, 91 Art-III districts, etc.).
    expect(FEDERAL_COURT_REGISTRY_IDS.length).toBe(367);
    expect(FEDERAL_COURT_REGISTRY_IDS).toContain("cadc");
    expect(new Set(FEDERAL_COURT_REGISTRY_IDS).size).toBe(FEDERAL_COURT_REGISTRY_IDS.length);
  });
});
