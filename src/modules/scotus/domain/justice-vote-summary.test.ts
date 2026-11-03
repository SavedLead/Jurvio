import { describe, expect, it } from "vitest";
import { benchChips, groupVoteNotes, voteSummaryLine, type VoteNote } from "./justice-vote-summary";

const base = { entryOn: "2025-02-24", context: "cert_denied" as const, slug: null, sentence: "", entryText: "Petition DENIED.", opinionOpening: null, opinionReason: null };
const pdf = "https://www.supremecourt.gov/opinions/24pdf/24-152_4g15.pdf";
const alito: VoteNote = { ...base, kind: "dissent", justiceRef: "Alito", name: "Samuel A. Alito, Jr.", opinionUrl: pdf, opinionReason: "I would grant." };
const thomas: VoteNote = { ...base, kind: "joined_dissent", justiceRef: "Thomas", name: "Clarence Thomas", opinionUrl: pdf };
const bench = ["John G. Roberts, Jr.|Roberts", "Clarence Thomas|Thomas", "Samuel A. Alito, Jr.|Alito", "Sonia Sotomayor|Sotomayor", "Elena Kagan|Kagan",
  "Neil M. Gorsuch|Gorsuch", "Brett M. Kavanaugh|Kavanaugh", "Amy Coney Barrett|Barrett", "Ketanji Brown Jackson|Jackson"]
  .map((value) => { const [name = "", surname = ""] = value.split("|"); return { name, surname, slug: null }; });

describe("justice vote summary", () => {
  it("merges a joiner into the author's opinion and writes one line", () => {
    const [group] = groupVoteNotes([alito, thomas]);
    expect(group?.written).toHaveLength(1);
    expect(group?.written[0]?.joiners.map((note) => note.justiceRef)).toEqual(["Thomas"]);
    expect(voteSummaryLine(group!, 9)).toBe("Alito dissented, joined by Thomas. The other 7 justices didn't say how they voted.");
  });

  it("lists would-grant positions and recusals as their own clauses", () => {
    const [group] = groupVoteNotes([
      { ...base, kind: "would_grant", justiceRef: "Alito", name: "Samuel A. Alito, Jr.", opinionUrl: null },
      { ...base, kind: "dissent", justiceRef: "Thomas", name: "Clarence Thomas", opinionUrl: pdf },
      { ...base, kind: "recused", justiceRef: "Kagan", name: "Elena Kagan", opinionUrl: null },
    ]);
    expect(voteSummaryLine(group!, 9)).toBe("Thomas dissented. Alito would have taken the case. Kagan did not take part. The other 6 justices didn't say how they voted.");
  });

  it("matches joiners by PDF when an order has two dissents", () => {
    const other = "https://www.supremecourt.gov/opinions/x.pdf";
    const [group] = groupVoteNotes([alito, { ...thomas, kind: "dissent", opinionUrl: other }, { ...thomas, justiceRef: "Gorsuch", name: "Neil M. Gorsuch", opinionUrl: other }]);
    expect(group?.written.find((opinion) => opinion.author.justiceRef === "Thomas")?.joiners.map((note) => note.justiceRef)).toEqual(["Gorsuch"]);
  });

  it("keeps a join it cannot tie to one opinion as its own line", () => {
    const [group] = groupVoteNotes([alito, { ...alito, justiceRef: "Thomas", name: "Clarence Thomas", opinionUrl: "b" }, { ...thomas, justiceRef: "Gorsuch", name: "Neil M. Gorsuch", opinionUrl: null }]);
    expect(group?.positions.map((note) => note.justiceRef)).toEqual(["Gorsuch"]);
  });

  it("gives each sitting justice a chip, 'not public' when the docket names no position", () => {
    const [group] = groupVoteNotes([alito, thomas]);
    const chips = benchChips(group!, bench);
    expect(chips.map((chip) => chip.status)).toEqual(["not-public", "dissented", "dissented", "not-public", "not-public", "not-public", "not-public", "not-public", "not-public"]);
  });

  it("says 'the other justices' when the bench is unknown", () => {
    const [group] = groupVoteNotes([alito]);
    expect(voteSummaryLine(group!, null)).toBe("Alito dissented. The other justices didn't say how they voted.");
  });
});
