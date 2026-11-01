/**
 * "Where this case stands": a deterministic plain-English summary built only
 * from structured record fields and sentences quoted from the court record.
 * Nothing here guesses. When a signal is missing the summary says so, or the
 * section is hidden. No LLM is involved.
 */
import type { CourtKind } from "@/modules/cases/domain/record-answers";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import { displayPartyName, partyRolesFor, ROLE_WORD, sideForName, trialCaptionRoles, type PartyRoles, type PartySide } from "./party-roles";

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

export interface OverruledCandidate {
  text: string;
  citingCaption: string | null;
  citingPath: string | null;
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
  /** First few thousand characters of the court's own opinion (caption block, how the case came up). */
  opinionHead?: string | null;
  opinionTail: string | null;
  opinionPath: string | null;
  opinionIsMajority: boolean;
  /** "Overruled by …" parentheticals from later opinions; only ones naming a court that can overrule this case count. */
  overruled: OverruledCandidate[] | OverruledCandidate | null;
  citedByCount: number;
  /** Where the list of citing opinions is (e.g. "#cited-by"). */
  citedByPath?: string | null;
  /** Supreme Court Database vote counts, when known. */
  votes?: { majority: number; minority: number } | null;
  /** Public docket entries (already filtered for sealed/restricted), any order. */
  docketEntries?: Array<{ filedOn: string | null; description: string }>;
  docketPath?: string | null;
}

export interface StandingPoint {
  id: "who-won" | "decided" | "lower" | "means" | "rule" | "good-law" | "cited" | "status";
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

function voteText(votes: { majority: number; minority: number }) {
  return votes.minority === 0 ? `${votes.majority}–0 (unanimous)` : `${votes.majority}–${votes.minority}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function precedentLine(status: string | null): string | null {
  const value = (status ?? "").toLowerCase();
  if (value === "published") return "This is a published opinion, so it is binding precedent (a ruling other courts in this circuit must follow).";
  if (value === "unpublished") return "This is an unpublished opinion. It settles this case but usually is not binding precedent (other courts don't have to follow it).";
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

/** Plain-English meaning of each disposition, keeping the legal word. */
const ACTION: Record<OutcomeKind, string> = {
  affirmed: "affirmed (agreed with the lower court and left its ruling in place)",
  reversed: "reversed (overturned) the lower court's decision",
  vacated: "vacated (canceled) the lower court's decision",
  remanded: "remanded the case (sent it back to the lower court for more work)",
  mixed: "affirmed in part and reversed in part (agreed with some of the lower court's decision and overturned the rest)",
  dismissed: "dismissed the appeal (ended it without deciding who was right)",
  "review-granted": "granted the petition for review (ruled that the agency's decision must be set aside or redone, at least in part)",
  "review-denied": "denied the petition for review (turned down the challenge and left the agency's decision in place)",
};

const REMAND_TAIL = " and remanded the case (sent it back to the lower court for more proceedings)";

function roleDescription(side: PartySide, courtKind: CourtKind): string {
  const trial = side.trialRole && side.trialRole !== side.role ? `, and the ${ROLE_WORD[side.trialRole]} in the trial court` : "";
  switch (side.role) {
    case "appellant": return `the appellant, the side that appealed${trial}`;
    case "appellee": return `the appellee, the side that won in the lower court${trial}`;
    case "petitioner": return courtKind === "supreme"
      ? "the petitioner, the side that asked the Supreme Court to review the lower court's decision"
      : `the petitioner, the side that asked the court to review the decision${trial}`;
    case "respondent": return courtKind === "supreme"
      ? "the respondent, the side that won in the lower court"
      : `the respondent, the side defending the decision under review${trial}`;
    default: return `the ${ROLE_WORD[side.role]}`;
  }
}

function named(side: PartySide, courtKind: CourtKind) {
  return `${displayPartyName(side.name)} (${roleDescription(side, courtKind)})`;
}

function shortName(side: PartySide) {
  return displayPartyName(side.name);
}

function actionFor(outcome: OutcomeReading) {
  const remand = outcome.remanded && outcome.kind !== "remanded" && outcome.kind !== "dismissed" ? REMAND_TAIL : "";
  return `${ACTION[outcome.kind]}${remand}`;
}

/** The single side a disposition favors, when it favors one. */
function favoredSide(kind: OutcomeKind): "up" | "down" | null {
  switch (kind) {
    case "affirmed":
    case "review-denied":
      return "down";
    case "reversed":
    case "vacated":
    case "review-granted":
      return "up";
    default:
      return null;
  }
}

function whoWonText(input: CaseStandingInput, outcome: OutcomeReading, roles: PartyRoles | null): string {
  const court = COURT_NAME[input.courtKind];
  const action = actionFor(outcome);
  const stillOpen = outcome.remanded && outcome.kind !== "affirmed" ? " The case goes back to the lower court, so the final result can still change." : "";
  if (roles?.cross) {
    return `Both sides appealed (cross-appeals), so there is no single winner. ${court} ${action}. Read the opinion to see which side won on which issues.`;
  }
  const favored = favoredSide(outcome.kind);
  if (!roles) {
    const upWord = input.courtKind === "supreme" ? "the petitioner (the side that asked the Supreme Court to review the case)" : outcome.kind.startsWith("review") ? "the petitioner (the side challenging the agency)" : "the appellant (the side that appealed)";
    const downWord = input.courtKind === "supreme" ? "the respondent (the side that won in the lower court)" : outcome.kind.startsWith("review") ? "the agency" : "the appellee (the side that won in the lower court)";
    const unknown = " Our records don't say which party is on which side.";
    if (favored === "down") return `A win for ${downWord}. ${court} ${action}, so ${upWord.replace(/ \(.*/, "")} lost.${unknown}`;
    if (favored === "up") return `A win for ${upWord}${outcome.remanded ? ", at least for now" : ""}. ${court} ${action}.${stillOpen}${unknown}`;
    return `${noSingleWinner(outcome)} ${court} ${action}.${stillOpen}`;
  }
  const up = roles.up;
  const down = roles.down;
  if (favored === "down") {
    return `A win for ${named(down, input.courtKind)}. ${court} ${action}, so ${named(up, input.courtKind)} lost${outcome.kind === "review-denied" ? " its challenge" : " the appeal"}.`;
  }
  if (favored === "up") {
    return `A win for ${named(up, input.courtKind)}${outcome.remanded ? ", at least for now" : ""}. ${court} ${action}, a loss for ${named(down, input.courtKind)}.${stillOpen}`;
  }
  if (outcome.kind === "dismissed") {
    return `No winner on the merits. ${court} ${action}. The lower court's decision stays in place, so ${named(up, input.courtKind)} did not get the change it asked for.`;
  }
  return `${noSingleWinner(outcome)} ${court} ${action}. ${capitalize(shortName(up))} is the ${ROLE_WORD[up.role]}; ${shortName(down)} is the ${ROLE_WORD[down.role]}.${stillOpen}`;
}

function noSingleWinner(outcome: OutcomeReading) {
  if (outcome.kind === "mixed") return "Neither side won completely; each won on some points.";
  if (outcome.kind === "remanded") return "No final winner yet.";
  return "No winner on the merits.";
}

function headlineFor(input: CaseStandingInput, outcome: OutcomeReading, roles: PartyRoles | null) {
  const court = COURT_NAME[input.courtKind];
  const favored = roles && !roles.cross ? favoredSide(outcome.kind) : null;
  const winner = favored && roles ? displayPartyName(roles[favored].name) : null;
  const forWinner = winner ? ` — a win for ${winner}${outcome.remanded && favored === "up" ? ", at least for now" : ""}` : "";
  switch (outcome.kind) {
    case "affirmed": return `${court} agreed with the lower court${forWinner}.`;
    case "reversed": return `${court} overturned the lower court's decision${forWinner}.`;
    case "vacated": return `${court} canceled the lower court's decision${forWinner}.`;
    case "mixed": return `${court} agreed with part of the lower court's decision and overturned part.`;
    case "dismissed": return `${court} ended the ${input.courtKind === "supreme" ? "case" : "appeal"} without deciding who was right.`;
    case "remanded": return `${court} sent the case back to the lower court for more work.`;
    case "review-granted": return `${court} ruled against the agency${forWinner}.`;
    case "review-denied": return `${court} left the agency's decision in place${winner && roles ? ` — a loss for ${displayPartyName(roles.up.name)}` : ""}.`;
  }
}

function meaning(input: CaseStandingInput, outcome: OutcomeReading): string {
  const back = outcome.remanded && outcome.kind !== "remanded" ? " The case goes back to the lower court to continue in line with this ruling." : "";
  const reach = input.courtKind === "supreme"
    ? " Supreme Court decisions bind every court in the country on the federal-law questions they decide."
    : "";
  switch (outcome.kind) {
    case "reversed": return `The lower court's ruling no longer stands.${back}${reach}`;
    case "vacated": return `The lower court's ruling was wiped out, as if it had not been issued.${back}${reach}`;
    case "affirmed": return `The lower court's ruling stands.${reach}`;
    case "mixed": return `Parts of the lower court's ruling stand and parts do not.${back} Read the opinion to see which.`;
    case "dismissed": return `The ${input.courtKind === "supreme" ? "Supreme Court" : "appeals court"} did not rule on who was right, so the lower court's decision stays in place.`;
    case "remanded": return "The case continues in the lower court.";
    case "review-granted": return `The agency must revisit its decision.${back}`;
    case "review-denied": return "The agency's decision stays in effect.";
  }
}

/**
 * A sentence near the top of the opinion that says what the lower court did
 * ("This is an appeal from a Federal Tort Claims Act judgment in favor of the
 * plaintiff.", "The Court of Appeals reversed."). Quoted as-is; never inferred.
 */
export function readLowerRuling(head: string | null | undefined, courtKind: CourtKind, lowerCourt: string | null = null): string | null {
  if (!head) return null;
  const sentences = closingSentences(head.slice(0, 9000));
  const patterns = courtKind === "supreme"
    ? [/^(?:The|the)\s+(?:United\s+States\s+)?(?:Court\s+of\s+Appeals|District\s+Court|[A-Z][a-z]+\s+Supreme\s+Court|Supreme\s+Court\s+of\s+[A-Z][a-z]+|state\s+court|trial\s+court)\b[^.]{0,40}?\b(?:affirmed|reversed|held|vacated|granted|denied|dismissed|upheld|ruled|convicted|sentenced|entered)\b/]
    : [
      /^This\s+is\s+an?\s+appeal\s+from\s+(?:an?|the)\s+[^.]{0,160}?\b(?:judgment|order|decision|conviction|sentence|dismissal)\b/i,
      /^(?:The|the)\s+district\s+court\s+(?:then\s+|ultimately\s+|eventually\s+)?(?:granted|entered|denied|dismissed|convicted|sentenced|ruled|held|found|concluded|rejected|awarded)\b/,
      /^(?:A|The)\s+jury\s+(?:convicted|found|returned|awarded)\b/,
      /^[A-Z][A-Za-z.'’-]+\s+(?:pleaded|pled)\s+guilty\b/,
    ];
  // Supreme Court: the ruling under review is the immediate lower court's (the court named in "CERTIORARI TO …").
  const lowerKind = courtKind === "supreme" && lowerCourt
    ? /court of appeals/i.test(lowerCourt) ? /\bCourt\s+of\s+Appeals\b/ : /\bSupreme\s+Court\b|\bCourt\s+of\s+Appeals\b/
    : null;
  let fallback: string | null = null;
  for (const sentence of sentences.slice(0, 80)) {
    if (sentence.length < 25 || sentence.length > 360) continue;
    if (MODAL.test(sentence) || NEGATED.test(sentence) || FIRST_PERSON.test(sentence) || /\?$/.test(sentence)) continue;
    if (!patterns.some((pattern) => pattern.test(sentence))) continue;
    if (!lowerKind || lowerKind.test(sentence.slice(0, 80))) return sentence;
    fallback ??= sentence;
  }
  return lowerKind ? null : fallback;
}

/** Courts that can overrule this one, and whether an "overruled by …" parenthetical names one of them. */
function overrulingCourts(input: CaseStandingInput): { label: string; accepts: (text: string) => boolean } | null {
  const supremeCite = /\b\d{1,3}\s+U\.\s?S\.\s+\d|\b\d{1,3}\s+S\.\s?Ct\.\s+\d|\bL\.\s?Ed\.\s?(?:2d\s+)?\d/;
  if (input.courtKind === "supreme") {
    return { label: "later Supreme Court decision", accepts: (text) => supremeCite.test(text) };
  }
  if (input.courtKind === "appellate") {
    const circuit = /\bfor\s+the\s+(.+?)\s*$/i.exec(input.courtName)?.[1]?.replace(/^the\s+/i, "") ?? null;
    const full = circuit ? `the full ${circuit} (sitting en banc)` : "the full appeals court (sitting en banc)";
    return { label: `later decision by the Supreme Court or ${full}`, accepts: (text) => supremeCite.test(text) || /\ben\s+banc\b/i.test(text) };
  }
  return null;
}

function goodLaw(input: CaseStandingInput): StandingPoint | null {
  const courts = overrulingCourts(input);
  if (!courts || !input.decidedOn) return null;
  const candidates = input.overruled ? (Array.isArray(input.overruled) ? input.overruled : [input.overruled]) : [];
  const hit = candidates.find((candidate) => courts.accepts(candidate.text));
  if (hit) {
    return {
      id: "good-law",
      label: "Is it still good law?",
      text: "Probably not, at least on the point that was overruled. A later opinion says this decision was overruled:",
      quote: hit.text,
      sourceLabel: hit.citingCaption ? `Quoted in ${hit.citingCaption}` : "Quoted in a later opinion",
      sourceHref: hit.citingPath,
    };
  }
  const who = input.courtKind === "supreme"
    ? " Only the Supreme Court itself can overrule one of its decisions."
    : " Only those courts can overrule it.";
  return {
    id: "good-law",
    label: "Is it still good law?",
    text: `We found no ${courts.label} overruling this case in Jurvio's records.${who} Our records may be incomplete, so this is not a guarantee.`,
  };
}

function citedPoint(input: CaseStandingInput): StandingPoint | null {
  if (input.courtKind !== "supreme" && input.courtKind !== "appellate") return null;
  if (!input.citedByCount || input.citedByCount < 1) return null;
  const count = input.citedByCount.toLocaleString("en-US");
  return {
    id: "cited",
    label: "How often is it cited?",
    text: `At least ${count} later court ${input.citedByCount === 1 ? "opinion" : "opinions"} on Jurvio ${input.citedByCount === 1 ? "cites" : "cite"} this case. Our citation records aren't complete, so the real number is likely higher. Being cited often shows a case is influential, not that it is still good law.`,
    sourceLabel: input.citedByPath ? "See the opinions that cite it" : undefined,
    sourceHref: input.citedByPath ?? null,
  };
}

function lowerPoint(input: CaseStandingInput, lowerCourt: string | null): StandingPoint | null {
  const ruling = readLowerRuling(input.opinionHead, input.courtKind, lowerCourt);
  const courtLine = lowerCourt ? `The case came from ${lowerCourt.replace(/^The\s/, "the ")}.` : "";
  if (ruling) {
    return {
      id: "lower",
      label: "What had the lower court decided?",
      text: `${courtLine}${courtLine ? " " : ""}In the opinion's words:`,
      quote: ruling,
      sourceLabel: SOURCE_LABEL.opinion,
      sourceHref: input.opinionPath,
    };
  }
  if (courtLine) return { id: "lower", label: "Where did the case come from?", text: courtLine };
  return null;
}

export function buildCaseStanding(input: CaseStandingInput): CaseStanding | null {
  const points: StandingPoint[] = [];
  const decidedDate = input.decidedOn;
  if (input.courtKind === "supreme" || input.courtKind === "appellate") {
    const { roles, lowerCourt: parsedLower } = partyRolesFor(input.courtKind, { caption: input.caption, opinionHead: input.opinionHead ?? null, verifiedDocket: input.verified });
    const lowerCourt = input.courtKind === "supreme" ? (input.lowerCourtName ? `the ${input.lowerCourtName.replace(/^the\s+/i, "")}` : parsedLower) : parsedLower;
    const outcome = outcomeFor(input);
    if (!outcome) {
      if (!decidedDate) return null;
      points.push({
        id: "decided",
        label: "What did the court decide?",
        text: "The court records we have don't include the line that states the result, so we can't say yet who won."
          + (input.courtKind === "supreme" && input.votes ? ` The Justices voted ${voteText(input.votes)}, according to the Supreme Court Database.` : "")
          + (input.opinionPath ? " The opinion is linked below." : ""),
      });
      const lower = lowerPoint(input, lowerCourt);
      if (lower) points.push(lower);
      const law = goodLaw(input);
      if (law) points.push(law);
      const cited = citedPoint(input);
      if (cited) points.push(cited);
      return { headline: `${COURT_NAME[input.courtKind]} has decided this case.`, points };
    }
    const vote = input.courtKind === "supreme" && input.votes ? ` The Justices voted ${voteText(input.votes)}, according to the Supreme Court Database.` : "";
    points.push({ id: "who-won", label: "Who won?", text: `${whoWonText(input, outcome, roles)}${vote}` });
    const lower = lowerPoint(input, lowerCourt);
    if (lower) points.push(lower);
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
    const cited = citedPoint(input);
    if (cited) points.push(cited);
    return { headline: headlineFor(input, outcome, roles), points };
  }

  // District, bankruptcy and other trial-level cases: report what the record shows, never a guess.
  if (!input.filedOn && !input.terminatedOn) return null;
  const roles = trialCaptionRoles(input.caption);
  const docket = readDocketOutcome(input.docketEntries ?? []);
  const dismissal = !docket && input.opinionIsMajority ? readTrialDismissal(input.opinionTail) : null;
  const closedOn = input.terminatedOn ? formatPublicCaseDate(input.terminatedOn) ?? input.terminatedOn : null;
  points.push({
    id: "status",
    label: "Is the case still open?",
    text: closedOn
      ? `No. The court closed this case on ${closedOn}.`
      : docket || dismissal
        ? "Our records don't show a closing date. Check the docket for the latest activity."
        : "Yes, as far as our records show: the court records we have show no final decision and no closing date. Check the docket for the latest activity.",
  });
  const docketSource = (date: string | null) => `From the court's docket${date ? `, ${formatPublicCaseDate(date) ?? date}` : ""}`;
  let headline: string;
  if (docket?.kind === "judgment") {
    const generic = /^(?:the\s+)?(plaintiffs?|defendants?)$/i.exec(docket.winner.trim());
    const side = roles ? sideForName(roles, docket.winner) : null;
    const sideText = !generic && side && roles ? ` (${roles[side].role === "prosecution" ? "the prosecution" : `the ${ROLE_WORD[roles[side].role]}`})` : "";
    const loser = side && roles ? roles[side === "up" ? "down" : "up"] : null;
    const winnerName = generic ? `the ${generic[1]!.toLowerCase()}` : displayPartyName(docket.winner);
    const against = loser ? `, against ${displayPartyName(loser.name)}${generic ? ` (the ${roles![side === "up" ? "down" : "up"].role === "prosecution" ? "prosecution" : ROLE_WORD[loser.role]})` : ""}` : "";
    points.push({
      id: "who-won",
      label: "Who won?",
      text: `${capitalize(winnerName)}${sideText}${/\.$/.test(sideText || winnerName) ? "" : "."} The court entered judgment (its final decision) in favor of ${winnerName}${against}${/\.$/.test(against || winnerName) ? "" : "."} In the docket's words:`,
      quote: docket.quote,
      sourceLabel: docketSource(docket.filedOn),
      sourceHref: input.docketPath ?? null,
    });
    headline = `The court ruled for ${winnerName}${sideText}${/\.$/.test(sideText || winnerName) ? "" : "."}`;
  } else if (docket?.kind === "voluntary") {
    points.push({
      id: "who-won",
      label: "Who won?",
      text: `No one won in court. The case was voluntarily dismissed (dropped${roles && roles.up.role === "plaintiff" ? ` by ${displayPartyName(roles.up.name)}, the plaintiff,` : " by the plaintiff"} or ended by agreement, often a settlement) without a court decision on who was right. In the docket's words:`,
      quote: docket.quote,
      sourceLabel: docketSource(docket.filedOn),
      sourceHref: input.docketPath ?? null,
    });
    headline = "The case was dropped or settled without a court ruling.";
  } else if (docket?.kind === "dismissal" || dismissal) {
    const withPrejudice = docket?.kind === "dismissal" ? docket.withPrejudice : dismissal?.withPrejudice ?? null;
    const against = roles ? ` That is a loss for ${displayPartyName(roles.up.name)} (the ${roles.up.role === "prosecution" ? "prosecution" : "plaintiff"}) on the dismissed claims.` : "";
    points.push({
      id: "decided",
      label: "What did the court decide?",
      text: (withPrejudice === true
        ? "The court dismissed claims with prejudice (threw them out for good; they generally cannot be filed again)."
        : withPrejudice === false
          ? "The court dismissed claims without prejudice (threw them out for now; they can usually be filed again)."
          : "The court dismissed claims (threw them out).") + `${against} In the court's words:`,
      quote: docket?.kind === "dismissal" ? docket.quote : dismissal?.quote,
      sourceLabel: docket?.kind === "dismissal" ? docketSource(docket.filedOn) : SOURCE_LABEL.opinion,
      sourceHref: docket?.kind === "dismissal" ? input.docketPath ?? null : input.opinionPath,
    });
    headline = "The court dismissed the case or some of its claims.";
  } else {
    const criminal = roles?.up.role === "prosecution";
    points.push({
      id: "who-won",
      label: criminal ? "How did it end?" : "Who won?",
      text: closedOn
        ? `The court records we have don't say how it ended${criminal ? "" : " or who won"}. The docket may have more detail.`
        : `No one yet. There is no final decision in the court records we have.`,
    });
    headline = closedOn
      ? "This case is closed, but the court records we have don't say how it ended."
      : "This case is still open — no final decision yet.";
  }
  return { headline, points };
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
