import type { JusticeNoteContext, JusticeNoteKind } from "./docket-justice-notes";

/** The fields of a docket justice note the vote summary needs (see application/justice-notes.ts). */
export interface VoteNote {
  entryOn: string;
  context: JusticeNoteContext;
  kind: JusticeNoteKind;
  justiceRef: string;
  name: string;
  slug: string | null;
  sentence: string;
  entryText: string;
  opinionUrl: string | null;
  opinionOpening: string | null;
  opinionReason: string | null;
}

export interface BenchJustice { name: string; slug: string | null; surname: string }

/** A written opinion (dissent, statement, concurrence) with the justices who joined it. */
export interface WrittenOpinion { author: VoteNote; joiners: VoteNote[] }

/** One Court order on the docket (date + context) and what individual justices put on the record about it. */
export interface NoteGroup {
  entryOn: string;
  context: JusticeNoteContext;
  entryText: string;
  written: WrittenOpinion[];
  /** Positions with no writing of their own: would grant / would deny / sat out, and joins we could not tie to one opinion. */
  positions: VoteNote[];
}

const WRITTEN: ReadonlySet<JusticeNoteKind> = new Set(["dissent", "statement", "concurrence"]);
const JOINED_OF: Partial<Record<JusticeNoteKind, JusticeNoteKind>> = {
  joined_dissent: "dissent", joined_statement: "statement", joined_concurrence: "concurrence",
};

/** Docket refs are surnames ("Alito") or "The Chief Justice". */
export function shortName(note: Pick<VoteNote, "justiceRef">): string {
  return note.justiceRef === "The Chief Justice" ? "The Chief Justice" : note.justiceRef;
}

/** Groups notes by order, newest first, and merges each joiner into the opinion they joined. */
export function groupVoteNotes(notes: readonly VoteNote[]): NoteGroup[] {
  const byKey = new Map<string, VoteNote[]>();
  for (const note of notes) byKey.set(`${note.entryOn}|${note.context}`, [...(byKey.get(`${note.entryOn}|${note.context}`) ?? []), note]);
  return [...byKey.values()].map((group) => {
    const first = group[0]!;
    const written: WrittenOpinion[] = group.filter((note) => WRITTEN.has(note.kind)).map((author) => ({ author, joiners: [] }));
    const positions: VoteNote[] = [];
    for (const note of group) {
      if (WRITTEN.has(note.kind)) continue;
      const joinedKind = JOINED_OF[note.kind];
      if (!joinedKind) { positions.push(note); continue; }
      // Same official PDF, else the only opinion of that kind in this order; otherwise leave it as its own line.
      const sameKind = written.filter((opinion) => opinion.author.kind === joinedKind);
      const target = (note.opinionUrl ? sameKind.find((opinion) => opinion.author.opinionUrl === note.opinionUrl) : undefined)
        ?? (sameKind.length === 1 ? sameKind[0] : undefined);
      if (target) target.joiners.push(note); else positions.push(note);
    }
    return { entryOn: first.entryOn, context: first.context, entryText: first.entryText, written, positions };
  }).sort((left, right) => right.entryOn.localeCompare(left.entryOn));
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

const VERB: Record<"dissent" | "statement" | "concurrence", string> = {
  dissent: "dissented", statement: "wrote a statement", concurrence: "agreed and wrote separately",
};

function positionPhrase(note: VoteNote): string {
  switch (note.kind) {
    case "would_grant": return note.context === "application" ? "would have granted the request" : note.context === "rehearing" ? "would have granted rehearing" : "would have taken the case";
    case "would_deny": return note.context === "application" ? "would have denied the request" : "would not have taken the case";
    case "recused": return "did not take part";
    case "joined_dissent": return "joined a dissent";
    case "joined_statement": return "joined a statement";
    case "joined_concurrence": return "joined a separate writing";
    default: return VERB[note.kind as keyof typeof VERB] ?? "";
  }
}

/** Names of the justices this order shows a public position for. */
export function publicNames(group: NoteGroup): Set<string> {
  return new Set([...group.written.flatMap((opinion) => [opinion.author, ...opinion.joiners]), ...group.positions].map((note) => note.name));
}

/**
 * One plain line, e.g. "Alito dissented, joined by Thomas. The other 7 justices didn't say how they voted."
 * `benchSize` is the number of justices sitting on the order's date (null when unknown).
 */
export function voteSummaryLine(group: NoteGroup, benchSize: number | null): string {
  const clauses = group.written.map((opinion) => {
    const verb = VERB[opinion.author.kind as keyof typeof VERB];
    const joined = opinion.joiners.length ? `, joined by ${list(opinion.joiners.map(shortName))}` : "";
    return `${shortName(opinion.author)} ${verb}${joined}`;
  });
  const byPhrase = new Map<string, string[]>();
  for (const note of group.positions) byPhrase.set(positionPhrase(note), [...(byPhrase.get(positionPhrase(note)) ?? []), shortName(note)]);
  for (const [phrase, names] of byPhrase) clauses.push(`${list(names)} ${phrase}`);
  const sentences = clauses.map((clause) => `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`);
  const known = publicNames(group).size;
  if (benchSize && benchSize > known) {
    const others = benchSize - known;
    sentences.push(others === 1 ? "The other justice didn't say how they voted." : `The other ${others} justices didn't say how they voted.`);
  } else if (!benchSize) {
    sentences.push("The other justices didn't say how they voted.");
  }
  return sentences.join(" ");
}

export type ChipStatus = "dissented" | "would-grant" | "would-deny" | "statement" | "concurred" | "sat-out" | "not-public";

export const CHIP_LABEL: Record<ChipStatus, string> = {
  dissented: "Dissented", "would-grant": "Would grant", "would-deny": "Would deny", statement: "Statement",
  concurred: "Wrote separately", "sat-out": "Sat out", "not-public": "Not public",
};

const CHIP_FOR_KIND: Record<JusticeNoteKind, ChipStatus> = {
  dissent: "dissented", joined_dissent: "dissented", would_grant: "would-grant", would_deny: "would-deny",
  statement: "statement", joined_statement: "statement", concurrence: "concurred", joined_concurrence: "concurred", recused: "sat-out",
};
const CHIP_RANK: ChipStatus[] = ["dissented", "would-grant", "would-deny", "statement", "concurred", "sat-out", "not-public"];

/** One chip per sitting justice for this order; justices with no public position read "Not public". */
export function benchChips(group: NoteGroup, bench: readonly BenchJustice[]): Array<BenchJustice & { status: ChipStatus }> {
  const notes = [...group.written.flatMap((opinion) => [opinion.author, ...opinion.joiners]), ...group.positions];
  return bench.map((justice) => {
    const statuses = notes.filter((note) => note.name === justice.name).map((note) => CHIP_FOR_KIND[note.kind]);
    const status = CHIP_RANK.find((rank) => statuses.includes(rank)) ?? "not-public";
    return { ...justice, status };
  });
}
