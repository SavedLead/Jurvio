/**
 * Justice-by-justice notes the Supreme Court publishes on its own docket when
 * it acts on a petition or application, read from the "Proceedings and Orders"
 * text, e.g.
 *
 *   "Petition DENIED. Justice Alito would grant the petition for a writ of
 *    certiorari. Justice Thomas, dissenting from the denial of certiorari.
 *    (Detached Opinion)"
 *
 * Only what the docket states is recorded. The Court does not publish how the
 * other justices voted on a petition, so nothing is inferred for them.
 * Pure functions; no I/O.
 */

export const DOCKET_JUSTICE_NOTES_PARSER_VERSION = "scotus-docket-justice-notes-v1";

export type JusticeNoteKind =
  | "would_grant"
  | "would_deny"
  | "dissent"
  | "joined_dissent"
  | "statement"
  | "joined_statement"
  | "concurrence"
  | "joined_concurrence"
  | "recused";

export type JusticeNoteContext = "cert_denied" | "cert_granted" | "application" | "rehearing" | "other";

export interface DocketJusticeNote {
  /** How the docket names the justice: a surname ("Alito") or "The Chief Justice". */
  justiceRef: string;
  kind: JusticeNoteKind;
  context: JusticeNoteContext;
  /** The sentence of the docket entry the note comes from, verbatim (whitespace collapsed). */
  sentence: string;
}

/** A written opinion (dissent, statement or concurrence) that goes with a note. */
export const WRITTEN_KINDS: ReadonlySet<JusticeNoteKind> = new Set(["dissent", "statement", "concurrence"]);

const NAME = String.raw`(?:The\s+Chief\s+Justice|Chief\s+Justice\s+[A-Z][A-Za-z'’\-]+|Justices?\s+[A-Z][A-Za-z'’\-]+(?:\s+Jr\.)?)`;
const SURNAME = String.raw`[A-Z][A-Za-z'’\-]+`;
const PLURAL = String.raw`Justices\s+${SURNAME}(?:\s*,\s*(?:and\s+)?${SURNAME}|\s+and\s+${SURNAME})+`;
const NAME_LIST = String.raw`(?:${PLURAL}|${NAME}(?:\s*,\s*(?:and\s+)?${NAME}|\s+and\s+${NAME})*)`;
const NAME_RE = new RegExp(NAME, "g");
// "Justices Thomas and Alito" -> ["Thomas", "Alito"]; plain surnames after "Justices".
const PLURAL_RE = /Justices\s+([A-Z][A-Za-z'’\-]+(?:\s*,\s*(?:and\s+)?[A-Z][A-Za-z'’\-]+|\s+and\s+[A-Z][A-Za-z'’\-]+)*)/g;

/** Every justice a phrase names, as docket refs ("Alito", "The Chief Justice"), in order, de-duplicated. */
export function justiceRefs(phrase: string): string[] {
  const refs: string[] = [];
  const push = (value: string) => { if (value && !refs.includes(value)) refs.push(value); };
  const text = phrase.replace(/\s+/g, " ");
  const plural = new Set<string>();
  for (const match of text.matchAll(PLURAL_RE)) {
    for (const surname of (match[1] ?? "").split(/\s*,\s*(?:and\s+)?|\s+and\s+/)) if (surname) plural.add(surname.trim());
  }
  for (const match of text.matchAll(NAME_RE)) {
    const value = match[0];
    if (/^The\s+Chief\s+Justice$/i.test(value) || /^Chief\s+Justice\s+/i.test(value)) { push("The Chief Justice"); continue; }
    if (/^Justices\s/.test(value)) {
      for (const surname of plural) push(surname);
      continue;
    }
    push(value.replace(/^Justice\s+/, "").replace(/\s+Jr\.$/, "").trim());
  }
  return refs;
}

export function entryContext(entry: string): JusticeNoteContext {
  const text = entry.replace(/\s+/g, " ");
  if (/\brehearing\b/i.test(text)) return "rehearing";
  if (/\bapplication\b/i.test(text) && !/\bpetition\s+(?:for\s+(?:a\s+)?writ\s+of\s+certiorari\s+)?(?:is\s+)?(?:DENIED|GRANTED)/i.test(text)) return "application";
  if (/\b(?:petition|certiorari)\b[^.]{0,80}\bDENIED\b/i.test(text) || /^Petition\s+DENIED/i.test(text)) return "cert_denied";
  if (/\b(?:petition|certiorari)\b[^.]{0,80}\bGRANTED\b/i.test(text) || /^Petition\s+GRANTED/i.test(text)) return "cert_granted";
  return "other";
}

/** Split a docket entry into sentences without breaking "v." or "U. S.". */
export function docketSentences(entry: string): string[] {
  // "(Detached Opinion) Justice Thomas, dissenting." starts a new sentence too.
  const text = entry.replace(/\s+/g, " ").replace(/\(\s*Detached\s+Opinion\s*\)/gi, "(Detached Opinion).").replace(/\.\./g, ".").trim();
  const out: string[] = [];
  let start = 0;
  const boundary = /\.\s+(?=(?:The\s+Chief|Justice|JUSTICE|Statement|Petition|Application|Motion|Judgment|The\s|[(]Detached|\(|[A-Z][a-z]+\s))/g;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + 1;
    const piece = text.slice(start, end).trim();
    // Keep "v." / "U. S." / "No." / single initials inside the sentence.
    if (/(?:\bv|\bU\.\s*S|\bNo|\b[A-Z]|\bJr|\bSt|\bInc|\bCo)\.$/.test(piece)) continue;
    if (piece) out.push(piece);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const WITH_WHOM = /,?\s*with\s+whom\s+(.+?)\s+joins?\b/i;

/** Parse one docket entry into justice notes. Empty when the entry names no justice's position. */
export function parseDocketJusticeNotes(entry: string): DocketJusticeNote[] {
  const context = entryContext(entry);
  const notes: DocketJusticeNote[] = [];
  const add = (refs: string[], kind: JusticeNoteKind, sentence: string) => {
    for (const justiceRef of refs) {
      if (!notes.some((note) => note.justiceRef === justiceRef && note.kind === kind)) notes.push({ justiceRef, kind, context, sentence });
    }
  };
  for (const raw of docketSentences(entry)) {
    const sentence = raw.replace(/\s*\(Detached\s+Opinion\)\.?\s*/gi, " ").replace(/\s+/g, " ").trim();
    if (!/Justice/i.test(sentence)) continue;
    // "Statement of Justice Sotomayor respecting the denial of certiorari."
    const statement = new RegExp(String.raw`^(?:Statement\s+of\s+)(${NAME_LIST})(.*?)\s+respecting\s+the\s+(?:denial|grant|dismissal|order)`, "i").exec(sentence)
      ?? new RegExp(String.raw`^(${NAME_LIST})(,?.*?),?\s+respecting\s+the\s+(?:denial|grant|dismissal|order)`, "i").exec(sentence);
    if (statement) {
      const joined = WITH_WHOM.exec(statement[2] ?? "");
      add(justiceRefs(statement[1] ?? ""), "statement", sentence);
      if (joined?.[1]) add(justiceRefs(joined[1]), "joined_statement", sentence);
      continue;
    }
    const opinion = new RegExp(String.raw`^(${NAME_LIST})(,?.*?),?\s+(dissenting|dissents|concurring|concurs)\b`, "i").exec(sentence);
    if (opinion) {
      const verb = (opinion[3] ?? "").toLowerCase();
      const kind: JusticeNoteKind = verb.startsWith("dissent") ? "dissent" : "concurrence";
      const lead = opinion[2] ?? "";
      const joined = WITH_WHOM.exec(lead);
      add(justiceRefs(opinion[1] ?? ""), kind, sentence);
      if (joined?.[1]) add(justiceRefs(joined[1]), kind === "dissent" ? "joined_dissent" : "joined_concurrence", sentence);
      continue;
    }
    const would = new RegExp(String.raw`^(${NAME_LIST})\s+would\s+(grant|deny|dismiss)\b`, "i").exec(sentence);
    if (would) {
      const verb = (would[2] ?? "").toLowerCase();
      add(justiceRefs(would[1] ?? ""), verb === "grant" ? "would_grant" : "would_deny", sentence);
      continue;
    }
    const recused = new RegExp(String.raw`^(${NAME_LIST})\s+(?:took|takes)\s+no\s+part\b`, "i").exec(sentence);
    if (recused) add(justiceRefs(recused[1] ?? ""), "recused", sentence);
  }
  return notes;
}

/** "Thomas, J., dissenting" style running heads and page furniture in opinion PDFs. */
function isFurniture(line: string): boolean {
  const value = line.trim();
  if (!value) return false;
  return /^Cite\s+as:/i.test(value)
    || /^\d+$/.test(value)
    || /^\d+\s+[A-Z0-9 .,'’&\-]+\s+v\.\s+[A-Z0-9 .,'’&\-]+$/.test(value)
    || /^[A-Z0-9 .,'’&\-]+\s+v\.\s+[A-Z0-9 .,'’&\-]+\s+\d+$/.test(value)
    || /^(?:Statement\s+of\s+)?[A-Z.,' ]+,\s+(?:C\.\s*)?J\.,?\s+(?:dissenting|concurring|respecting)/.test(value)
    || /^Statement\s+of\s+[A-Z.' ]+,\s+(?:C\.\s*)?J\.$/.test(value)
    || /^Opinion\s+of\s+the\s+Court$/i.test(value)
    || /^NOTICE:/.test(value)
    || /^SUPREME COURT OF THE UNITED STATES$/.test(value);
}

/** The text of one justice's written dissent, statement or concurrence, from its heading on; null when not found. */
export function opinionBody(text: string, justiceRef: string, kind: JusticeNoteKind): string | null {
  const lines = text.replace(/\r/g, "").replace(/\f/g, "\n").split("\n").filter((line) => !isFurniture(line));
  const flat = lines.join("\n").replace(/([a-z])-\n\s*([a-z])/g, "$1$2").replace(/\s+/g, " ").trim();
  const who = justiceRef === "The Chief Justice"
    ? String.raw`(?:THE\s+CHIEF\s+JUSTICE|CHIEF\s+JUSTICE\s+[A-Z]+)`
    : String.raw`JUSTICE\s+${justiceRef.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  const verb = kind === "statement" ? "respecting" : kind === "concurrence" ? "concurring" : "dissenting";
  const heading = kind === "statement"
    ? new RegExp(String.raw`Statement\s+of\s+${who}[^.]{0,200}?respecting\s+the\s+[a-z ]+?\.`, "i")
    : new RegExp(String.raw`${who}(?:\s*,\s*with\s+whom\s+[^.]{0,160}?joins?\s*,)?\s*,?\s*${verb}[^.]{0,120}?\.`);
  const match = heading.exec(flat);
  if (!match) return null;
  const body = flat.slice((match.index ?? 0) + match[0].length).trim();
  if (body.length < 40) return null;
  // Stop at the next opinion heading in the same PDF.
  const next = body.search(/\sJUSTICE\s+[A-Z]+(?:,\s+with\s+whom[^.]{0,160}?joins?,)?\s*,?\s*(?:dissenting|concurring)\b|\sStatement\s+of\s+(?:JUSTICE|THE\s+CHIEF)/);
  return next > 40 ? body.slice(0, next).trim() : body;
}

function cutAt(scope: string, maxChars: number): string {
  if (scope.length <= maxChars) return scope.trim();
  const cut = scope.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".” "), cut.lastIndexOf("? "));
  return (lastStop > 120 ? cut.slice(0, lastStop + 1) : `${cut.replace(/\s+\S*$/, "")} …`).trim();
}

/** The opening words of one justice's written dissent, statement or concurrence, quoted from the opinion text. */
export function openingOfOpinion(text: string, justiceRef: string, kind: JusticeNoteKind, maxChars = 480): string | null {
  const body = opinionBody(text, justiceRef, kind);
  if (!body) return null;
  // Stop at a Part numeral ("I", "II", "A") standing alone before the next paragraph.
  const stop = body.search(/\s(?:[IVX]{1,4}|[A-D])\s(?=[A-Z][a-z])/);
  return cutAt(stop > 40 ? body.slice(0, stop) : body, maxChars);
}

/**
 * The sentence where the justice says why, picked by rule: the first sentence in
 * the opening pages that says what the justice "would" do, what the Court
 * "should" have done, or why they "write". Quoted verbatim; null when none.
 */
export function reasonSentence(text: string, justiceRef: string, kind: JusticeNoteKind, opening: string | null): string | null {
  const body = opinionBody(text, justiceRef, kind);
  if (!body) return null;
  const sentences = body.slice(0, 60_000).split(/(?<=[.?!][”"]?)\s+(?=[A-Z“"])/);
  for (const sentence of sentences) {
    const value = sentence.trim();
    if (value.length < 50 || value.length > 420) continue;
    if (/\bI\s+(?:would\s+(?:grant|not|have|summarily|reverse|vacate)|write|dissent\s+because|respectfully\s+dissent\s+(?:from|because))\b|\b(?:the|this)\s+Court\s+(?:should|ought|errs|erred|declines|refuses)\b|\bwe\s+should\b|\bwarrants?\s+(?:our|this\s+Court[’']s)\s+review\b|\b(?:decision|refusal)\b[^.]{0,120}\b(?:is|was)\s+a\s+(?:\w+\s+)?(?:mistake|error)\b/i.test(value)) {
      return opening?.includes(value) ? null : value;
    }
  }
  return null;
}

/** A roster row the page uses to name and link the justice a docket ref means. */
export interface RosterJustice {
  scdbJusticeId: number;
  displayName: string;
  surname: string;
  slug: string;
  serviceStart: string;
  serviceEnd: string | null;
  chiefFrom: string | null;
  chiefTo: string | null;
}

/** Which justice a docket ref ("Alito", "The Chief Justice") names on a date; null when not exactly one. */
export function resolveJustice(ref: string, on: string | null, roster: readonly RosterJustice[]): RosterJustice | null {
  const date = on ?? "9999-12-31";
  const serving = roster.filter((justice) => justice.serviceStart <= date && (!justice.serviceEnd || justice.serviceEnd >= date));
  if (ref === "The Chief Justice") {
    const chiefs = serving.filter((justice) => justice.chiefFrom && justice.chiefFrom <= date && (!justice.chiefTo || justice.chiefTo >= date));
    return chiefs.length === 1 ? chiefs[0] ?? null : null;
  }
  const fold = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "'").toLowerCase();
  const matches = serving.filter((justice) => fold(justice.surname) === fold(ref));
  return matches.length === 1 ? matches[0] ?? null : null;
}

export const NOTE_KIND_LABEL: Record<JusticeNoteKind, string> = {
  would_grant: "Would have taken the case",
  would_deny: "Would not have taken the case",
  dissent: "Dissented (wrote an opinion)",
  joined_dissent: "Dissented (joined a colleague's opinion)",
  statement: "Wrote a statement",
  joined_statement: "Joined a colleague's statement",
  concurrence: "Agreed, and wrote separately",
  joined_concurrence: "Agreed, and joined a colleague's separate writing",
  recused: "Did not take part",
};
