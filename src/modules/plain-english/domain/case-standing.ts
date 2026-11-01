/**
 * "Where this case stands": a deterministic plain-English summary built only
 * from structured record fields and sentences quoted from the court record.
 * Nothing here guesses. When a signal is missing the summary says so, or the
 * section is hidden. No LLM is involved.
 */
import type { CourtKind } from "@/modules/cases/domain/record-answers";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";

export type OutcomeKind = "affirmed" | "reversed" | "vacated" | "remanded" | "dismissed" | "mixed" | "review-granted" | "review-denied";

export interface OutcomeReading {
  kind: OutcomeKind;
  /** True when the case was also sent back to the lower court. */
  remanded: boolean;
  /** The exact words the reading came from, quoted on the page. */
  quote: string;
  source: "court-record" | "opinion" | "case-data";
}

const VERBS = "affirm|reverse|vacate|remand|dismiss";
const MODAL = /\b(?:should|would|could|ought|might|may)\s+(?:\w+\s+){0,2}(?:be\s+)?(?:affirm|revers|vacat|remand|dismiss|grant|den)/i;
const NEGATED = /\b(?:not|decline\s+to|declining\s+to|need\s+not|cannot|refuse\s+to|without)\s+(?:\w+\s+){0,2}(?:affirm|revers|vacat|remand|dismiss)/i;
const FIRST_PERSON = /(?:^|[\s"“(])I\s+(?:would|respectfully|dissent|concur|agree|join|write)/;

function words(text: string) {
  const lower = text.toLowerCase();
  return {
    affirm: /\baffirm(?:ed|s|ance)?\b/.test(lower),
    reverse: /\brevers(?:ed|e|es|al)\b/.test(lower),
    vacate: /\bvacat(?:ed|e|es|ur)\b/.test(lower) && !/\bremand without vacatur\b/.test(lower),
    remand: /\bremand(?:ed|s)?\b/.test(lower),
    dismiss: /\bdismiss(?:ed|es|al)?\b/.test(lower),
    inPart: /\bin part\b/.test(lower),
  };
}

function classify(raw: string): Omit<OutcomeReading, "quote" | "source"> | null {
  // "remand with instructions to vacate the sentence" orders the lower court to act;
  // the appeals court itself only remanded.
  const text = raw.replace(/\b(?:instructions?|directions?|direct(?:s|ing)?\s+(?:it|the\s+(?:\w+\s+)?court))\s+to\s+(?:\w+\s+){0,1}(?:vacate|dismiss|reverse|affirm)\w*/gi, "remand-directive");
  const lower = text.toLowerCase();
  const review = /\bpetitions?\s+for\s+review\s+(?:is|are)\s+(?:hereby\s+)?(granted|denied)\b/.exec(lower)
    ?? /\bwe\s+(?:therefore\s+|accordingly\s+)?(grant|deny)\s+(?:the|all|both|his|her|their|its)?\s*(?:\w+\s+){0,2}petitions?\s+for\s+review\b/.exec(lower);
  const w = words(text);
  if (review && !w.affirm && !w.reverse) {
    const granted = /^grant/.test(review[1] ?? "");
    return { kind: granted ? "review-granted" : "review-denied", remanded: w.remand };
  }
  const setAside = w.reverse || w.vacate;
  if (w.affirm && lower.includes("remand-directive")) return { kind: "mixed", remanded: true };
  if (w.affirm && setAside) return { kind: "mixed", remanded: w.remand };
  if (w.inPart && (w.affirm || setAside)) return { kind: "mixed", remanded: w.remand };
  if (w.reverse) return { kind: "reversed", remanded: w.remand };
  if (w.vacate) return { kind: "vacated", remanded: w.remand };
  if (w.affirm) return { kind: "affirmed", remanded: w.remand };
  if (w.dismiss) return { kind: "dismissed", remanded: w.remand };
  if (w.remand) return { kind: "remanded", remanded: true };
  return null;
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A short judgment line from the verified Supreme Court record or the provider
 * cluster disposition ("Judgment REVERSED and case REMANDED.", "Affirmed.").
 * Only the judgment part is read: text after "delivered the opinion" is the
 * author line, not the outcome.
 */
export function readDispositionLine(text: string | null | undefined, source: OutcomeReading["source"]): OutcomeReading | null {
  if (!text) return null;
  const line = clean(text).replace(/^\[|\]$/g, "");
  const judgment = line.split(/\b[A-Z][a-z]+,\s+(?:C\.\s*)?J\.,?\s+delivered\b|\(Opinion\b|\bdelivered the opinion\b/)[0]?.trim() ?? "";
  if (!judgment || judgment.length > 400) return null;
  if (MODAL.test(judgment) || NEGATED.test(judgment)) return null;
  // "Certiorari granted; 357 F. 2d 257;" with no outcome word: nothing to say.
  const reading = classify(judgment);
  if (!reading) return null;
  return { ...reading, quote: judgment.replace(/[;,]\s*$/, ""), source };
}

const STRONG = new RegExp(
  String.raw`\b(?:we|the\s+court|this\s+court)\s+(?:therefore\s+|thus\s+|accordingly\s+|hereby\s+|now\s+|must\s+|will\s+)?(?:${VERBS})\b`
  + String.raw`|\b(?:is|are|be|was)\s+(?:hereby\s+|therefore\s+|accordingly\s+)?(?:affirmed|reversed|vacated|remanded|dismissed)\b`
  + String.raw`|\bpetitions?\s+for\s+review\s+(?:is|are)\s+(?:hereby\s+)?(?:granted|denied)\b`
  + String.raw`|\bwe\s+(?:therefore\s+|accordingly\s+)?(?:grant|deny)\s+(?:the|all|both|his|her|their|its)?\s*(?:\w+\s+){0,2}petitions?\s+for\s+review\b`,
  "i",
);
const SHOUTED = /(?:^|[\s.;:])(AFFIRMED|REVERSED|VACATED|DISMISSED)(?:\s+(?:AND|in\s+part)\s+[A-Z]+)*\b/;

/** Split the end of an opinion into sentences, dropping page furniture. */
function closingSentences(tail: string) {
  const text = clean(tail)
    .replace(/USCA Case #\S+ Document #\S+ Filed: \S+ Page \d+ of \d+/g, " ")
    .replace(/\bPage \d+ of \d+\b/g, " ")
    .replace(/\s+\d{1,3}\s*$/, "");
  return text.split(/(?<=[.!?])\s+(?=[A-Z*"“(])/)
    .map((sentence) => sentence.trim().replace(/^(?:[IVX]+\.\s*)?(?:CONCLUSION|Conclusion)\s+/, "").replace(/^\*+\s*/, ""))
    .filter(Boolean);
}

/**
 * The court's own judgment sentence near the end of the majority opinion
 * ("We therefore affirm the judgment.", "REVERSED and REMANDED.").
 * Sentences in a dissent's voice, hedged, or negated are ignored.
 */
export function readOpinionClosing(tail: string | null | undefined): OutcomeReading | null {
  if (!tail) return null;
  const sentences = closingSentences(tail).slice(-10);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    if (!sentence) continue;
    if (sentence.length > 600 || FIRST_PERSON.test(sentence) || /\bdissent/i.test(sentence)) continue;
    if (MODAL.test(sentence) || NEGATED.test(sentence)) continue;
    if (!STRONG.test(sentence) && !SHOUTED.test(sentence)) continue;
    // "...is reversed. The case is remanded for further proceedings." reads as one judgment.
    const next = sentences[index + 1];
    const quote = next && /\bremand/i.test(next) && next.length < 300 && !FIRST_PERSON.test(next) ? `${sentence} ${next}` : sentence;
    const reading = classify(quote);
    if (!reading) continue;
    // "We affirm the conviction. We remand ... to resentence." reads as one judgment.
    const previous = sentences[index - 1];
    if (reading.kind === "remanded" && previous && previous.length < 600 && STRONG.test(previous) && !FIRST_PERSON.test(previous) && !MODAL.test(previous) && !NEGATED.test(previous)) {
      const joined = `${previous} ${quote}`;
      const combined = classify(joined);
      if (combined) return { ...combined, quote: joined, source: "opinion" };
    }
    return { ...reading, quote, source: "opinion" };
  }
  return null;
}

/** Strict "overruled by …" parenthetical: the leading words describe the cited case itself. */
export function readOverruledParenthetical(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = clean(text);
  if (!/^(?:(?:expressly|implicitly|partially)\s+)?(?:overruled|abrogated)(?:\s+(?:in\s+part|on\s+other\s+grounds))?\s+(?:by|in)\s+\S/i.test(value)) return null;
  return value.length > 260 ? `${value.slice(0, 257).replace(/\s+\S*$/, "")}…` : value;
}

export interface CaseStandingInput {
  courtKind: CourtKind;
  courtName: string;
  caption: string;
  decidedOn: string | null;
  filedOn: string | null;
  terminatedOn: string | null;
  /** Verified Supreme Court enum such as "reversed_and_remanded" (or "none"). */
  dispositionScope: string | null;
  verified: boolean;
  exactDisposition: string | null;
  dispositionSourceUrl: string | null;
  exactHolding: string | null;
  holdingSourceUrl: string | null;
  lowerCourtName: string | null;
  clusterDisposition: string | null;
  precedentialStatus: string | null;
  opinionTail: string | null;
  opinionPath: string | null;
  opinionIsMajority: boolean;
  overruled: { text: string; citingCaption: string | null; citingPath: string | null } | null;
  citedByCount: number;
  /** Public docket entries (already filtered for sealed/restricted), any order. */
  docketEntries?: Array<{ filedOn: string | null; description: string }>;
  docketPath?: string | null;
}

export interface StandingPoint {
  id: "who-won" | "decided" | "means" | "rule" | "good-law" | "status";
  label: string;
  text: string;
  quote?: string;
  sourceLabel?: string;
  sourceHref?: string | null;
}

export interface CaseStanding {
  headline: string;
  points: StandingPoint[];
}

const ENUM_LINES: Record<string, string> = {
  affirmed: "Affirmed.",
  reversed: "Reversed.",
  reversed_and_remanded: "Reversed and remanded.",
  vacated: "Vacated.",
  vacated_and_remanded: "Vacated and remanded.",
  dismissed: "Dismissed.",
  affirmed_in_part: "Affirmed in part and reversed in part.",
};

function firstParty(caption: string) {
  const parts = caption.split(/\s+v\.?\s+/i);
  if (parts.length !== 2) return null;
  const name = (parts[0] ?? "").trim();
  if (!name || name.length > 60 || /^(?:in re|ex parte|matter of)\b/i.test(name)) return null;
  return name;
}

function lowerCourtPhrase(input: CaseStandingInput) {
  if (input.courtKind === "supreme") return input.lowerCourtName ? `the ${input.lowerCourtName.replace(/^the\s+/i, "")}` : "the lower court";
  if (input.courtKind === "appellate") return "the lower court";
  return "the lower court";
}

function outcomeFor(input: CaseStandingInput): OutcomeReading | null {
  if (input.courtKind === "supreme" && input.verified) {
    const fromRecord = readDispositionLine(input.exactDisposition, "court-record");
    if (fromRecord) return fromRecord;
    const enumLine = input.dispositionScope ? ENUM_LINES[input.dispositionScope] : undefined;
    const fromEnum = readDispositionLine(enumLine, "court-record");
    if (fromEnum) return fromEnum;
  }
  const fromCluster = readDispositionLine(input.clusterDisposition, "case-data");
  if (fromCluster && input.courtKind !== "district") return fromCluster;
  if (input.opinionIsMajority) {
    const fromOpinion = readOpinionClosing(input.opinionTail);
    if (fromOpinion && input.courtKind !== "district") return fromOpinion;
  }
  return null;
}

function whoWon(input: CaseStandingInput, outcome: OutcomeReading): string {
  const supreme = input.courtKind === "supreme";
  const named = supreme ? firstParty(input.caption) : null;
  const who = supreme ? "the petitioner" : "the side that appealed";
  const explain = supreme
    ? ` The petitioner is the side that asked the Supreme Court to take the case, usually the party named first${named ? ` (here, ${named})` : ""}.`
    : "";
  const lower = lowerCourtPhrase(input);
  switch (outcome.kind) {
    case "reversed":
    case "vacated":
      return `${capitalize(who)} won${outcome.remanded ? ", at least for now" : ""}.${explain} The court ruled against ${lower}'s decision.`;
    case "affirmed":
      return `The side that won in ${lower} won again. The court left ${lower}'s decision in place.`;
    case "mixed":
      return `Neither side won outright. The court agreed with ${lower} on some points and disagreed on others.`;
    case "dismissed":
      return `No one won on the merits. The court dismissed the ${supreme ? "case" : "appeal"} without deciding who is right, which usually leaves ${lower}'s decision in place.`;
    case "remanded":
      return `No final winner yet. The court sent the case back to ${lower} for more work.`;
    case "review-granted":
      return "The challenger won. The court set aside or sent back the agency's decision, at least in part.";
    case "review-denied":
      return "The agency won. The court turned down the challenge and left the agency's decision in place.";
  }
}

function meaning(input: CaseStandingInput, outcome: OutcomeReading): string {
  const lower = lowerCourtPhrase(input);
  const back = outcome.remanded ? ` The case goes back to ${lower} to continue in line with this ruling.` : "";
  const reach = input.courtKind === "supreme"
    ? " Supreme Court decisions bind every court in the country on the federal-law questions they decide."
    : "";
  switch (outcome.kind) {
    case "reversed":
      return `${capitalize(lower)}'s ruling no longer stands.${back}${reach}`;
    case "vacated":
      return `${capitalize(lower)}'s ruling was wiped out, as if it had not been issued.${back}${reach}`;
    case "affirmed":
      return `${capitalize(lower)}'s ruling stands.${reach}`;
    case "mixed":
      return `Parts of ${lower}'s ruling stand and parts do not.${back} Read the opinion to see which.`;
    case "dismissed":
      return `The ${input.courtKind === "supreme" ? "Supreme Court" : "appeals court"} did not rule on the merits.`;
    case "remanded":
      return `The case continues in ${lower}.`;
    case "review-granted":
      return `The agency must revisit its decision.${back}`;
    case "review-denied":
      return "The agency's decision stays in effect.";
  }
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function precedentLine(status: string | null): string | null {
  const value = (status ?? "").toLowerCase();
  if (value === "published") return "This is a published opinion, so it is binding precedent for courts in this circuit.";
  if (value === "unpublished") return "This is an unpublished opinion. It settles this case but usually is not binding precedent for future cases.";
  return null;
}

const SOURCE_LABEL: Record<OutcomeReading["source"], string> = {
  "court-record": "From the Supreme Court's record",
  opinion: "From the court's opinion",
  "case-data": "From the court's published disposition",
};

const COURT_NAME: Record<CourtKind, string> = {
  supreme: "The Supreme Court",
  appellate: "The appeals court",
  district: "The court",
  bankruptcy: "The bankruptcy court",
  other: "The court",
};

function headlineFor(input: CaseStandingInput, outcome: OutcomeReading) {
  const court = COURT_NAME[input.courtKind];
  const lower = lowerCourtPhrase(input);
  const remand = outcome.remanded && outcome.kind !== "remanded" ? " and sent the case back" : "";
  switch (outcome.kind) {
    case "reversed": return `${court} reversed ${lower}${remand}.`;
    case "vacated": return `${court} threw out ${lower}'s decision${remand}.`;
    case "affirmed": return `${court} upheld ${lower}'s decision.`;
    case "mixed": return `${court} upheld part of ${lower}'s decision and overturned part.`;
    case "dismissed": return `${court} dismissed the ${input.courtKind === "supreme" ? "case" : "appeal"}.`;
    case "remanded": return `${court} sent the case back to ${lower}.`;
    case "review-granted": return `${court} ruled against the agency${remand}.`;
    case "review-denied": return `${court} upheld the agency's decision.`;
  }
}

function goodLaw(input: CaseStandingInput): StandingPoint | null {
  if (input.courtKind !== "supreme" && input.courtKind !== "appellate") return null;
  if (input.overruled) {
    return {
      id: "good-law",
      label: "Is it still good law?",
      text: "Probably not on the point that was overruled. A later opinion describes this decision as overruled:",
      quote: input.overruled.text,
      sourceLabel: input.overruled.citingCaption ? `Quoted in ${input.overruled.citingCaption}` : "Quoted in a later opinion",
      sourceHref: input.overruled.citingPath,
    };
  }
  if (!input.decidedOn) return null;
  const cited = input.citedByCount > 0
    ? ` ${input.citedByCount.toLocaleString("en-US")} later ${input.citedByCount === 1 ? "opinion" : "opinions"} on Jurvio ${input.citedByCount === 1 ? "cites" : "cite"} it.`
    : "";
  return {
    id: "good-law",
    label: "Is it still good law?",
    text: `Jurvio has no record of a later decision overruling it.${cited} Our citation records are not complete, so this is not a guarantee.`,
  };
}

export function buildCaseStanding(input: CaseStandingInput): CaseStanding | null {
  const points: StandingPoint[] = [];
  const decidedDate = input.decidedOn;
  if (input.courtKind === "supreme" || input.courtKind === "appellate") {
    const outcome = outcomeFor(input);
    if (!outcome) {
      if (!decidedDate) return null;
      points.push({
        id: "decided",
        label: "What did the court decide?",
        text: "Jurvio does not have the court's judgment line for this case yet, so we cannot say who won."
          + (input.opinionPath ? " The opinion is linked below." : ""),
      });
      const law = goodLaw(input);
      if (law) points.push(law);
      return { headline: `${COURT_NAME[input.courtKind]} has decided this case.`, points };
    }
    points.push({ id: "who-won", label: "Who won?", text: whoWon(input, outcome) });
    points.push({
      id: "decided",
      label: "What did the court decide?",
      text: "In the court's words:",
      quote: outcome.quote,
      sourceLabel: SOURCE_LABEL[outcome.source],
      sourceHref: outcome.source === "court-record" ? input.dispositionSourceUrl : outcome.source === "opinion" ? input.opinionPath : null,
    });
    const precedent = input.courtKind === "appellate" ? precedentLine(input.precedentialStatus) : null;
    points.push({ id: "means", label: "What does it mean?", text: [meaning(input, outcome), precedent].filter(Boolean).join(" ") });
    if (input.exactHolding) {
      points.push({
        id: "rule",
        label: "What rule did it set?",
        text: "The holding, quoted from the court:",
        quote: clean(input.exactHolding),
        sourceLabel: "Source",
        sourceHref: input.holdingSourceUrl,
      });
    }
    const law = goodLaw(input);
    if (law) points.push(law);
    return { headline: headlineFor(input, outcome), points };
  }

  // District, bankruptcy and other trial-level cases: report what the record shows, never a guess.
  if (!input.filedOn && !input.terminatedOn) return null;
  const docket = readDocketOutcome(input.docketEntries ?? []);
  const dismissal = !docket && input.opinionIsMajority ? readTrialDismissal(input.opinionTail) : null;
  points.push({
    id: "status",
    label: "Is the case still open?",
    text: input.terminatedOn
      ? `No. The court closed this case on ${formatPublicCaseDate(input.terminatedOn) ?? input.terminatedOn}.`
      : "Jurvio has no record of the case being closed. Check the docket for the latest activity.",
  });
  const docketSource = (date: string | null) => `From the court's docket${date ? `, ${formatPublicCaseDate(date) ?? date}` : ""}`;
  if (docket?.kind === "judgment") {
    points.push({
      id: "who-won",
      label: "Who won?",
      text: `The docket records a judgment in favor of ${docket.winner}${docket.winner.endsWith(".") ? "" : "."} In the docket's words:`,
      quote: docket.quote,
      sourceLabel: docketSource(docket.filedOn),
      sourceHref: input.docketPath ?? null,
    });
  } else if (docket?.kind === "voluntary") {
    points.push({
      id: "who-won",
      label: "Who won?",
      text: "No one won in court. The docket shows the case was voluntarily dismissed, which usually means the plaintiff dropped it or the parties settled. In the docket's words:",
      quote: docket.quote,
      sourceLabel: docketSource(docket.filedOn),
      sourceHref: input.docketPath ?? null,
    });
  } else if (docket?.kind === "dismissal" || dismissal) {
    const withPrejudice = docket?.kind === "dismissal" ? docket.withPrejudice : dismissal?.withPrejudice ?? null;
    points.push({
      id: "decided",
      label: "What did the court decide?",
      text: withPrejudice === true
        ? "The court dismissed claims with prejudice, which means they generally cannot be filed again. In the court's words:"
        : withPrejudice === false
          ? "The court dismissed claims without prejudice, which means they can usually be filed again. In the court's words:"
          : "The court dismissed claims. In the court's words:",
      quote: docket?.kind === "dismissal" ? docket.quote : dismissal?.quote,
      sourceLabel: docket?.kind === "dismissal" ? docketSource(docket.filedOn) : SOURCE_LABEL.opinion,
      sourceHref: docket?.kind === "dismissal" ? input.docketPath ?? null : input.opinionPath,
    });
  } else {
    const criminal = /^(?:USA|U\.S\.A?\.?|United States(?: of America)?)\s+v\.?\s/i.test(input.caption);
    points.push({
      id: "who-won",
      label: criminal ? "How did it end?" : "Who won?",
      text: criminal
        ? "Jurvio does not have the court's final ruling or judgment for this case, so we cannot say how it ended."
        : "Jurvio does not have the court's final ruling for this case, so we cannot say who won.",
    });
  }
  return {
    headline: input.terminatedOn
      ? "This case is closed."
      : docket || dismissal ? "The court has ruled in this case." : "No final ruling in Jurvio's records.",
    points,
  };
}

export type DocketOutcome =
  | { kind: "judgment"; winner: string; quote: string; filedOn: string | null }
  | { kind: "dismissal"; withPrejudice: boolean | null; quote: string; filedOn: string | null }
  | { kind: "voluntary"; quote: string; filedOn: string | null };

/**
 * The latest final-looking docket entry: "JUDGMENT entered in favor of X",
 * an order or opinion stating claims are dismissed, or a voluntary dismissal.
 * A motion asking for dismissal is not a dismissal and is ignored.
 */
export function readDocketOutcome(entries: Array<{ filedOn: string | null; description: string }>): DocketOutcome | null {
  const ordered = entries
    .map((entry, index) => ({ ...entry, index, text: clean(entry.description ?? "") }))
    .sort((left, right) => (right.filedOn ?? "").localeCompare(left.filedOn ?? "") || right.index - left.index);
  let fallback: DocketOutcome | null = null;
  for (const entry of ordered) {
    if (!entry.text || entry.text.length > 900) continue;
    if (fallback && entry.filedOn !== fallback.filedOn) break;
    const quote = entry.text.length > 320 ? `${entry.text.slice(0, 317).replace(/\s+\S*$/, "")}…` : entry.text;
    const favorAt = /^(?:(?:final|amended|clerk's|default)\s+)?judgment\b[^.;]{0,80}?\bin\s+favor\s+of\s+/i.exec(entry.text);
    // Case-sensitive on purpose: a period followed by a capitalized word ends the name.
    const favor = favorAt ? /^(.{2,80}?)(?:\s+(?:and\s+)?against\b|[;,(]|\.?\s*$|\.\s+(?=[A-Z][a-z]))/.exec(entry.text.slice(favorAt[0].length)) : null;
    if (favor?.[1] && !/\b(?:motion|proposed|request|vacat)/i.test(favorAt?.[0] ?? "")) {
      const winner = favor[1].trim().replace(/[,\s]+$/, "");
      return { kind: "judgment", winner: /\b(?:Inc|Corp|Co|Ltd|L\.L\.C|L\.P|Jr|Sr|U\.S\.A?)\.$/.test(winner) ? winner : winner.replace(/\.$/, ""), quote, filedOn: entry.filedOn };
    }
    if (fallback) continue;
    if (/^(?:joint\s+)?(?:notice|stipulation)\s+of\s+(?:voluntary\s+)?dismissal\b/i.test(entry.text)) {
      fallback = { kind: "voluntary", quote, filedOn: entry.filedOn };
      continue;
    }
    if (/^(?:(?:memorandum\s+)?(?:opinion|decision)|order|judgment)\b/i.test(entry.text)
      && /\b(?:is|are|be|hereby|case|action|complaint|claims?)\s+(?:hereby\s+)?dismissed\b/i.test(entry.text)
      && !/\bnot\s+(?:be\s+)?dismissed\b/i.test(entry.text)) {
      const lower = entry.text.toLowerCase();
      fallback = { kind: "dismissal", withPrejudice: /\bwithout prejudice\b/.test(lower) ? false : /\bwith prejudice\b/.test(lower) ? true : null, quote, filedOn: entry.filedOn };
    }
  }
  return fallback;
}

/** "The complaint is DISMISSED with prejudice." near the end of a trial-court opinion. */
export function readTrialDismissal(tail: string | null | undefined): { quote: string; withPrejudice: boolean | null } | null {
  if (!tail) return null;
  const sentences = closingSentences(tail).slice(-12);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    if (!sentence) continue;
    if (sentence.length > 500 || MODAL.test(sentence) || NEGATED.test(sentence)) continue;
    if (!/\b(?:case|action|complaint|claims?|petition|counts?|suit|indictment)\b[^.]{0,120}\b(?:is|are|be|hereby)\s+(?:hereby\s+)?dismissed\b/i.test(sentence)) continue;
    const lower = sentence.toLowerCase();
    const withPrejudice = /\bwithout prejudice\b/.test(lower) ? false : /\bwith prejudice\b/.test(lower) ? true : null;
    return { quote: sentence, withPrejudice };
  }
  return null;
}
