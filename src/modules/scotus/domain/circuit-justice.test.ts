import { describe, expect, it } from "vitest";
import { ALLOTMENT, circuitJusticeFor, circuitOfCourt, circuitOfCourtName } from "./circuit-justice";
import { FEDERAL_COURT_REGISTRY_IDS, getFederalCourtEntry } from "@/modules/ingestion/domain/federal-court-registry";

describe("circuit justice allotment (supremecourt.gov, effective 2022-09-28)", () => {
  it("lists all 13 circuits once, matching the published order", () => {
    expect(ALLOTMENT.map((row) => row.circuit).sort()).toEqual(["ca1", "ca10", "ca11", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "cadc", "cafc"]);
    const by = Object.fromEntries(ALLOTMENT.map((row) => [row.circuit, row.justiceName]));
    expect(by).toMatchObject({ cadc: "John G. Roberts, Jr.", ca1: "Ketanji Brown Jackson", ca2: "Sonia Sotomayor", ca3: "Samuel A. Alito, Jr.",
      ca4: "John G. Roberts, Jr.", ca5: "Samuel A. Alito, Jr.", ca6: "Brett M. Kavanaugh", ca7: "Amy Coney Barrett", ca8: "Brett M. Kavanaugh",
      ca9: "Elena Kagan", ca10: "Neil M. Gorsuch", ca11: "Clarence Thomas", cafc: "John G. Roberts, Jr." });
  });

  it("maps district, bankruptcy and appellate-panel ids to their circuit", () => {
    expect(circuitOfCourt("ilnd")).toBe("ca7");
    expect(circuitOfCourt("ILNB")).toBe("ca7");
    expect(circuitOfCourt("dcd")).toBe("cadc");
    expect(circuitOfCourt("prd")).toBe("ca1");
    expect(circuitOfCourt("vid")).toBe("ca3");
    expect(circuitOfCourt("gud")).toBe("ca9");
    expect(circuitOfCourt("nmid")).toBe("ca9");
    expect(circuitOfCourt("nmd")).toBe("ca10");
    expect(circuitOfCourt("cacd")).toBe("ca9");
    expect(circuitOfCourt("bap9")).toBe("ca9");
    expect(circuitOfCourt("ca7")).toBe("ca7");
    expect(circuitJusticeFor("txsd")?.justiceName).toBe("Samuel A. Alito, Jr.");
  });

  it("returns null for the Supreme Court, state and specialized courts", () => {
    for (const id of ["scotus", "tax", "uscfc", "cit", "cal", "nyappdiv", "", null]) expect(circuitOfCourt(id)).toBeNull();
  });

  it("maps every current district court in the federal registry", () => {
    const current = FEDERAL_COURT_REGISTRY_IDS.filter((id) => {
      const entry = getFederalCourtEntry(id);
      return entry?.category === "current" && ["court_of_appeals", "district", "bankruptcy", "bankruptcy_appellate_panel"].includes(entry.courtClass);
    });
    expect(current.length).toBeGreaterThan(200);
    const unmapped = current.filter((id) => circuitOfCourt(id) === null);
    expect(unmapped).toEqual([]);
  });
});

describe("circuitOfCourtName", () => {
  it("reads a court of appeals name", () => {
    expect(circuitOfCourtName("United States Court of Appeals for the Seventh Circuit")).toBe("ca7");
    expect(circuitOfCourtName("United States Court of Appeals for the District of Columbia Circuit")).toBe("cadc");
    expect(circuitOfCourtName("Supreme Court of Illinois")).toBeNull();
  });
});
