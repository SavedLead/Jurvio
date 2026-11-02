import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeScdbText, parseCsv, readSingleFileZip, scdbInt, scdbText, scdbDate } from "./scdb";
import { buildTermBreakdown, externalCheck, martinQuinnReleaseLabel, type TermCaseRow, type TermVoteRow } from "./term-breakdown";

/**
 * Guards the OT2025 numbers shown on /justices/terms/2025 against the committed
 * SCDB 2026_01 release file AND against the tallies checked by hand against
 * SCOTUSblog's final OT2025 Stat Pack: 66 decisions, 57 argued, 7 decided 5-4,
 * 17 argued 6-3, 29 unanimous.
 */
function loadTerm(term: number): { cases: TermCaseRow[]; votes: TermVoteRow[] } {
  const zip = readFileSync(path.join(process.cwd(), "data/scdb/2026_01/SCDB_2026_01_justiceCentered_Citation.csv.zip"));
  const rows = parseCsv(decodeScdbText(readSingleFileZip(zip).data).text).filter((row) => row.term === String(term));
  const cases = new Map<string, TermCaseRow>();
  const votes: TermVoteRow[] = [];
  for (const row of rows) {
    if (!cases.has(row.caseId!)) cases.set(row.caseId!, {
      scdbCaseId: row.caseId!, caseName: row.caseName!, docket: scdbText(row.docket), usCite: scdbText(row.usCite),
      decidedOn: scdbDate(row.dateDecision), decisionType: scdbInt(row.decisionType), issueArea: scdbInt(row.issueArea),
      decisionDirection: scdbInt(row.decisionDirection), majVotes: scdbInt(row.majVotes), minVotes: scdbInt(row.minVotes),
      majOpinWriter: scdbInt(row.majOpinWriter),
    });
    votes.push({
      scdbCaseId: row.caseId!, scdbJusticeId: scdbInt(row.justice)!, code: row.justiceName!, vote: scdbInt(row.vote),
      opinion: scdbInt(row.opinion), direction: scdbInt(row.direction), majority: scdbInt(row.majority),
    });
  }
  return { cases: [...cases.values()], votes };
}

describe("OT2025 term breakdown (SCDB 2026_01)", () => {
  const { cases, votes } = loadTerm(2025);
  const b = buildTermBreakdown(2025, cases, votes);
  const check = externalCheck(2025)!;
  const code = (id: number) => votes.find((v) => v.scdbJusticeId === id)!.code;

  it("matches the SCOTUSblog-verified OT2025 tallies", () => {
    expect(check).toMatchObject({ decisions: 66, argued: 57, fiveFour: 7, sixThreeArgued: 17, unanimous: 29 });
    expect(b.coverage.decisions).toBe(check.decisions);
    expect(b.coverage.argued).toBe(check.argued);
    expect(b.all.fiveFour).toBe(check.fiveFour);
    expect(b.argued.fiveFour).toBe(check.fiveFour);
    expect(b.argued.sixThree).toBe(check.sixThreeArgued);
    expect(b.all.unanimous).toBe(check.unanimous);
  });

  it("counts every split with its denominator", () => {
    expect(b.coverage.byDecisionType).toEqual({ "1": 56, "2": 9, "6": 1 });
    expect(Object.fromEntries(b.argued.splits.map((s) => [s.split, s.decisions]))).toEqual({ "9-0": 24, "8-0": 1, "8-1": 6, "7-2": 2, "6-3": 17, "5-4": 7 });
    expect(Object.fromEntries(b.all.splits.map((s) => [s.split, s.decisions]))).toEqual({ "9-0": 28, "8-0": 1, "8-1": 7, "7-2": 4, "6-3": 19, "5-4": 7 });
    expect(b.argued.splits.reduce((n, s) => n + s.decisions, 0) + b.argued.splitUnknown).toBe(57);
    expect(b.coverage.withoutDirection).toBe(0);
  });

  it("defines the usual 6-3 lines from SCDB-coded shares, not by name", () => {
    expect(b.usualLines!.minority.map(code).sort()).toEqual(["EKagan", "KBJackson", "SSotomayor"]);
    expect(b.usualLines).toMatchObject({ decisions: 13, sixThree: 17 });
  });

  it("lists all seven 5-4 decisions with both sides", () => {
    expect(b.fiveFourDecisions.map((d) => d.docket)).toEqual(["24-5438", "24-351", "24-872", "24-7351", "25-197", "25A312", "24-1260"]);
    for (const d of b.fiveFourDecisions) {
      expect(d.argued).toBe(true);
      expect([d.majority.length, d.dissent.length]).toEqual([5, 4]);
    }
    const gorsuch = votes.find((v) => v.code === "NMGorsuch")!.scdbJusticeId;
    expect(b.fiveFourDecisions.every((d) => d.dissent.includes(gorsuch))).toBe(true);
  });

  it("counts opinions by type the SCDB way (one vote per justice per case)", () => {
    const thomas = b.justices.find((j) => j.code === "CThomas")!;
    expect(thomas).toMatchObject({ votesCast: 57, majorityOpinions: 6, concurrencesWritten: 14, dissentsWritten: 6, liberal: 23, withDirection: 57 });
    const alito = b.justices.find((j) => j.code === "SAAlito")!;
    expect(alito).toMatchObject({ votesCast: 56, didNotVote: 1, majorityOpinions: 6, concurrencesWritten: 3, dissentsWritten: 7 });
    expect(b.justices).toHaveLength(9);
  });

  it("breaks liberal share down by SCDB issue area with denominators", () => {
    const roberts = b.justices.find((j) => j.code === "JGRoberts")!.scdbJusticeId;
    const total = Object.values(b.issues).reduce((n, byJustice) => n + (byJustice[roberts]?.withDirection ?? 0), 0);
    expect(total).toBe(57);
    const liberal = Object.values(b.issues).reduce((n, byJustice) => n + (byJustice[roberts]?.liberal ?? 0), 0);
    expect(liberal).toBe(30);
  });
});

describe("martinQuinnReleaseLabel", () => {
  it("does not nest the release's own coverage brackets", () => {
    const label = martinQuinnReleaseLabel("2024 (OT1937-OT2024)");
    expect(label).toBe("Martin-Quinn 2024 release, covering OT1937–OT2024");
    expect(`(${label})`).not.toMatch(/\)\)/);
  });

  it("handles plain and missing versions", () => {
    expect(martinQuinnReleaseLabel("2024")).toBe("Martin-Quinn 2024");
    expect(martinQuinnReleaseLabel(null)).toBe("Martin-Quinn release");
    expect(martinQuinnReleaseLabel("  ")).toBe("Martin-Quinn release");
  });
});
