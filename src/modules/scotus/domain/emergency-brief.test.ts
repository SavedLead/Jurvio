import { describe, expect, it } from "vitest";
import {
  BRIEF_BUDGET_USD, acceptDescription, budgetAllows, buildBriefPacket, compareBriefOrder,
  costUsd, estimatedCost, exportPacketsSql, parseDescription, renderBriefUpsert, SERIOUS_MODEL,
  type BriefPacketSource,
} from "./emergency-brief";

function source(overrides: Partial<BriefPacketSource> = {}): BriefPacketSource {
  return {
    docketNumber: "26A100",
    caption: "Sample v. United States",
    applicant: "United States",
    kind: "stay",
    applicantKind: "federal",
    administration: "Second Trump administration",
    status: "pending",
    lowerCourt: "U.S. Court of Appeals for the Fifth Circuit",
    rulingOn: null,
    ruledBy: null,
    votes: [],
    withheldLines: 0,
    casePublicId: null,
    storedHash: null,
    events: [
      { filedOn: "2026-11-01", kind: "submitted", description: "Application for a stay of the Fifth Circuit's order pending a petition." },
      { filedOn: "2026-11-02", kind: "response_filed", description: "Respondent opposes the stay." },
    ],
    ...overrides,
  };
}

describe("emergency brief packets", () => {
  it("puts federal applications ahead of other serious ones, pending first, and extensions last", () => {
    const rows = [
      { kind: "extension", applicantKind: "private", status: "pending", lastEntryOn: "2026-11-10", docketNumber: "26A9" },
      { kind: "stay", applicantKind: "private", status: "denied", lastEntryOn: "2026-11-12", docketNumber: "26A3" },
      { kind: "stay", applicantKind: "federal", status: "denied", lastEntryOn: "2026-11-01", docketNumber: "26A2" },
      { kind: "stay", applicantKind: "private", status: "pending", lastEntryOn: "2026-11-02", docketNumber: "26A4" },
      { kind: "injunction", applicantKind: "federal", status: "pending", lastEntryOn: "2026-11-08", docketNumber: "26A1" },
    ].sort(compareBriefOrder);
    expect(rows.map((row) => row.docketNumber)).toEqual(["26A1", "26A2", "26A4", "26A3", "26A9"]);
  });

  it("leaves sealed lines out of the prompt and skips a sealed caption", () => {
    const built = buildBriefPacket(source({
      events: [
        { filedOn: "2026-11-01", kind: "submitted", description: "Application for a stay." },
        { filedOn: "2026-11-02", kind: "letter", description: "Filing is under seal." },
      ],
    }));
    expect(built.skipped).toBeNull();
    if (built.skipped) return;
    expect(built.user).toContain("[line withheld]");
    expect(built.user).not.toContain("under seal");
    expect(buildBriefPacket(source({ caption: "Sealed matter" })).skipped).toBe("restricted");
  });

  it("trims a long appendix and keeps the application and the response", () => {
    const built = buildBriefPacket(source({
      events: [
        { filedOn: "2026-11-01", kind: "submitted", description: "The application asks the Court to pause the injunction." },
        { filedOn: "2026-11-02", kind: "amicus_filed", description: `Appendix ${"A".repeat(20_000)}` },
        { filedOn: "2026-11-03", kind: "response_filed", description: "The other side asks the Court to leave the injunction in place." },
      ],
    }));
    expect(built.skipped).toBeNull();
    if (built.skipped) return;
    expect(built.trimmed).toBe(true);
    expect(built.user).toContain("pause the injunction");
    expect(built.user).toContain("leave the injunction in place");
    expect(built.user.length).toBeLessThan(20_000);
    expect(built.model.id).toBe(SERIOUS_MODEL.id);
  });

  it("uses the cheap model for a one-line extension request", () => {
    const built = buildBriefPacket(source({ kind: "extension", applicantKind: "private", administration: null }));
    expect(built.skipped).toBeNull();
    if (built.skipped) return;
    expect(built.briefKind).toBe("extension_line");
    expect(built.model.id).toBe("gpt-6-luna");
    expect(built.user).toContain("one sentence");
  });

  it("prices Sol at $2 / $10 per million and stops at $100", () => {
    expect(costUsd(2, 10, 1_000_000, 1_000_000)).toBe(12);
    expect(costUsd(0.1, 0.5, 10_000, 100)).toBe(0.00105);
    expect(budgetAllows(99.99, 0.02)).toBe(false);
    expect(budgetAllows(40, estimatedCost(SERIOUS_MODEL, 8_000))).toBe(true);
    expect(budgetAllows(BRIEF_BUDGET_USD, 0.000001)).toBe(false);
  });

  it("rejects invented-looking output that misses the docket or mentions sealed material", () => {
    expect(acceptDescription("Too short 26A100", "26A100", "full")).toBeNull();
    const ok = "No. 26A100 is an application by the United States to pause a Fifth Circuit order. The public docket does not say how the Court voted. https://jurvio.com/supreme-court/emergency/26A100";
    expect(acceptDescription(ok, "26A100", "full")).toContain("26A100");
    expect(acceptDescription(`${ok} The filing is under seal.`, "26A100", "full")).toBeNull();
    expect(acceptDescription("A short line about 26A100.", "26A100", "extension_line")).toContain("26A100");
    expect(parseDescription('{"description":"No. 26A100"}')).toBe("No. 26A100");
    expect(parseDescription("not json")).toBeNull();
  });

  it("keeps a hostile description inside one SQL statement", () => {
    const hash = "a".repeat(64);
    const body = "No. 26A100 stays put. '); DELETE FROM scotus_application_brief; -- $baaaaaaaaaaaaaaaa$";
    const sql = renderBriefUpsert({
      docketNumber: "26A100", briefKind: "full", body, model: "gpt-6.1-sol", promptVersion: "emergency-brief-v1",
      sourceHash: hash, inputTokens: 10, outputTokens: 20, costUsd: 0.00022,
      entryCount: 2, lastEntryOn: "2026-11-02", status: "pending", withheldLines: 0,
    });
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
    expect(sql).toContain(body);
    expect(sql).toContain("ai_generated");
    expect(exportPacketsSql()).toContain("applicant_kind = 'federal'");
    expect(exportPacketsSql()).toContain("emergency-brief-v1");
  });
});
