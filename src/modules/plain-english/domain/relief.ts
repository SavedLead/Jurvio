/**
 * "What did each side ask for, and what did they get?" — the relief a party
 * requested and the court's answer on each point, read only from the record:
 *
 * - appeals: the opinion's opening ("He asks us to vacate his conviction and
 *   remand for a new trial", "Smith appeals his conviction and sentence") and
 *   the court's closing judgment words ("We affirm the conviction, vacate the
 *   sentence, and remand for resentencing");
 * - trial courts: motions on the public docket ("MOTION to Dismiss by Acme
 *   Corp.") matched to the orders that rule on them ("ORDER granting 12 Motion
 *   to Dismiss");
 * - the Supreme Court: the petition's questions presented (supremecourt.gov)
 *   and the Court's judgment.
 *
 * Nothing is inferred beyond what the words say. A request with no matching
 * ruling is reported as "the record doesn't say"; when no request is stated,
 * the summary says so instead of guessing. No LLM is involved.
 */
import type { CourtKind } from "@/modules/cases/domain/record-answers";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import { displayPartyName, ROLE_WORD, sideForName, type PartyRoles, type PartySide } from "./party-roles";

export type ReliefKind = "conviction" | "sentence" | "new-trial" | "resentencing" | "acquittal" | "dismissal" | "judgment";
export type ReliefResult = "granted" | "denied" | "partly" | "not-reached" | "not-shown" | "pending";

/** Overall disposition, as read by the case-standing summary. */
export type ReliefOutcomeKind = "affirmed" | "reversed" | "vacated" | "remanded" | "dismissed" | "mixed" | "review-granted" | "review-denied";

export interface ReliefItem {
  /** Plain-English request, e.g. "throw out the conviction". */
  asked: string;
  /** Who asked (display name with role), when the record says. */
  askedBy: string | null;
  result: ReliefResult;
  /** Plain-English result, e.g. "The court threw out the sentence." */
  outcome: string;
}

export interface ReliefQuote {
  text: string;
  sourceLabel: string;
  sourceHref: string | null;
}

export interface ReliefSummary {
  /** Plain-English sentences: who asked for what, and what the court did on each point. */
  text: string;
  items: ReliefItem[];
  quotes: ReliefQuote[];
}

const ASK: Record<ReliefKind, string> = {
  conviction: "throw out the conviction",
  sentence: "throw out the sentence",
  "new-trial": "order a new trial",
  resentencing: "order a new sentencing",
  acquittal: "enter a judgment of acquittal (a not-guilty ruling)",
  dismissal: "dismiss the charges or claims",
  judgment: "overturn the lower court's decision",
};

const DID: Record<ReliefKind, string> = {
  conviction: "threw out the conviction",
  sentence: "threw out the sentence",
  "new-trial": "ordered a new trial",
  resentencing: "ordered a new sentencing",
  acquittal: "ordered a judgment of acquittal",
  dismissal: "ordered the charges or claims dismissed",
  judgment: "overturned the lower court's decision",
};

/** What the court did when it turned the point down (used when nobody's request is stated). */
const KEPT: Record<ReliefKind, string> = {
  conviction: "kept the conviction in place",
  sentence: "kept the sentence in place",
  "new-trial": "refused a new trial",
  resentencing: "refused a new sentencing",
  acquittal: "refused a judgment of acquittal",
  dismissal: "refused to dismiss",
  judgment: "left the lower court's decision in place",
};

const ORDER: ReliefKind[] = ["conviction", "sentence", "acquittal", "dismissal", "new-trial", "resentencing", "judgment"];

function clean(text: string) {
  return text.replace(/\s+/g, " ").replace(/([a-z])- ([a-z])/g, "$1$2").trim();
}

function sentencesOf(text: string) {
  return clean(text)
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const SET_ASIDE = String.raw`(?:revers\w*|vacat\w*|set(?:ting)?\s+aside|overturn\w*|throw(?:ing)?\s+out|undo)`;
const OWNER = String.raw`(?:(?:the|his|her|their|its|all|both|each|of)\s+|[A-Z]?\w+['’]s?\s+|\w+\s+){0,3}`;

/** The kinds of relief a request clause names ("vacate his conviction and remand for a new trial"). */
export function requestedKinds(clause: string): ReliefKind[] {
  const text = clean(clause);
  const kinds = new Set<ReliefKind>();
  const objectSetAside = (object: string) =>
    new RegExp(String.raw`\b${SET_ASIDE}\s+${OWNER}(?:\w+\s+(?:and|or)\s+)?${object}`, "i").test(text)
    || new RegExp(String.raw`\b${SET_ASIDE}\s+of\s+${OWNER}${object}`, "i").test(text)
    || new RegExp(String.raw`${object}[^.;]{0,30}\b(?:be|are|is)\s+(?:reversed|vacated|set\s+aside|overturned)`, "i").test(text);
  if (objectSetAside(String.raw`convictions?\b`) || /\b(?:reversal|vacatur)\s+of\s+(?:\w+\s+){0,3}convictions?\b/i.test(text)) kinds.add("conviction");
  if (objectSetAside(String.raw`(?:convictions?\s+and\s+)?sentences?\b`) || /\b(?:reversal|vacatur)\s+of\s+(?:\w+\s+){0,4}sentences?\b/i.test(text)) kinds.add("sentence");
  if (/\bnew\s+trial\b/i.test(text)) kinds.add("new-trial");
  if (/\bre-?sentencing\b|\bnew\s+sentencing\b/i.test(text)) kinds.add("resentencing");
  if (/\bacquittal\b/i.test(text)) kinds.add("acquittal");
  if (/\bdismiss(?:al\s+of|ing|ed)?\s+(?:\w+\s+){0,2}(?:indictment|charges?|counts?|complaint|claims?)\b/i.test(text)) kinds.add("dismissal");
  if (kinds.size === 0 && new RegExp(String.raw`\b${SET_ASIDE}\s+${OWNER}(?:judgment|decision|order|ruling)\b|\b(?:reversal|vacatur)\s+of\s+${OWNER}(?:judgment|decision|order|ruling)\b`, "i").test(text)) {
    kinds.add("judgment");
  }
  return ORDER.filter((kind) => kinds.has(kind));
}

const ASK_VERB = /\b(?:asks?|asked|urges?|request(?:s|ed)?|seeks?|sought|prays?)\s+(?:(?:us|this\s+court|the\s+court|that\s+(?:we|this\s+court|the\s+court))\s+)?(?:to\s+)?(.{4,260})$/i;
const APPEAL_OF = /\b(?:appeals?|appealed|challenges?)\s+(?:from\s+)?(?:his|her|their|its|the)\s+(?:\w+\s+){0,2}?(convictions?|sentences?)(?:\s+and\s+(?:\w+\s+){0,2}?(sentences?|convictions?))?\b/i;
const NOT_ASKING = /\b(?:not|no\s+longer|never|nor)\s+(?:\w+\s+)?(?:ask|seek|request|urge|challenge|appeal)/i;
const NOT_PARTY = /(?:^|[\s"“(])I\s|\bdissent|\bamic(?:us|i)\b|\bwe\s+(?:decline|reject|deny|grant)\b/i;

export interface ReliefRequest {
  kinds: ReliefKind[];
  side: "up" | "down";
  quote: string;
}

/**
 * The request the opinion states near its start. The asking party must be
 * identifiable: named (matched to a side), "appellant"/"appellee", or a
 * pronoun right after a sentence about the appeal. Otherwise nothing is returned.
 */
export function readOpinionRequest(head: string | null | undefined, roles: PartyRoles | null): ReliefRequest | null {
  if (!head || !roles || roles.cross) return null;
  const sentences = sentencesOf(head.slice(0, 12000)).slice(0, 90);
  let challenge: ReliefRequest | null = null;
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    if (sentence.length < 20 || sentence.length > 420) continue;
    if (NOT_ASKING.test(sentence) || NOT_PARTY.test(sentence) || /\?$/.test(sentence)) continue;
    const ask = ASK_VERB.exec(sentence);
    const kinds = ask?.[1] ? requestedKinds(ask[1]) : [];
    if (ask && kinds.length) {
      const side = askingSide(sentence.slice(0, ask.index), roles, sentences[index - 1] ?? "", sentence);
      // A stated request ("He asks us to …") is the best evidence: use the first one.
      if (side) return { kinds, side, quote: sentence };
      continue;
    }
    if (challenge) continue;
    // "Smith appeals his conviction and sentence": what the appeal challenges, kept as a fallback.
    const appeal = APPEAL_OF.exec(sentence);
    if (!appeal) continue;
    const objects = [appeal[1], appeal[2]].filter(Boolean).map((word) => word!.toLowerCase());
    const appealed = ORDER.filter((kind) => objects.some((word) => word.startsWith(kind)));
    const side = appealed.length ? askingSide(sentence.slice(0, appeal.index), roles, sentences[index - 1] ?? "", sentence) : null;
    if (side === "up") challenge = { kinds: appealed, side, quote: sentence };
  }
  return challenge;
}

function askingSide(subjectText: string, roles: PartyRoles, previous: string, sentence: string): "up" | "down" | null {
  const subject = subjectText.replace(/[,;:]\s*$/, "").trim();
  // The subject is the last clause before the verb ("On appeal, Smith asks …", "In his brief, he urges …").
  let last = subject.split(/,\s*/).at(-1)?.trim() ?? subject;
  // "Defendant-Appellant John Smith": the role label names the side.
  const label = /^(?:(?:plaintiffs?|defendants?|petitioners?|respondents?)[\s\-‐‑–—]+)?(appellants?|appellees?)\s+(?=\S)/i.exec(last);
  if (label) {
    const labelled = /^appellant/i.test(label[1] ?? "") ? "up" : "down";
    const rest = last.slice(label[0].length);
    const named = sideForName(roles, rest);
    if ((labelled === "up" && roles.up.role === "appellant") || (labelled === "down" && roles.down.role === "appellee")) {
      return named === null || named === labelled ? labelled : null;
    }
    last = rest;
  }
  if (!last) return null;
  if (/^(?:the\s+)?appellants?$/i.test(last)) return roles.up.role === "appellant" ? "up" : null;
  if (/^(?:the\s+)?appellees?$/i.test(last)) return roles.down.role === "appellee" ? "down" : null;
  if (/^(?:the\s+)?petitioners?$/i.test(last)) return roles.up.role === "petitioner" ? "up" : null;
  if (/^(?:he|she|they)$/i.test(last)) {
    // A pronoun only counts right after a sentence naming the appealing side.
    const context = `${previous} ${sentence}`;
    const named = sideForName(roles, previous.split(/\s+(?:appeals?|appealed|challenges?)\b/i)[0] ?? "");
    return /\bappeal/i.test(context) && named === "up" ? "up" : null;
  }
  if (/^(?:the\s+)?(?:government|united\s+states)$/i.test(last)) {
    return sideForName(roles, "United States");
  }
  if (last.split(/\s+/).length > 8) return null;
  return sideForName(roles, last);
}

/** The court's answer on one kind of relief, from its closing judgment words. */
export function rulingFor(kind: ReliefKind, closing: string): "granted" | "denied" | null {
  const text = clean(closing);
  const affirmObject = (object: string) =>
    new RegExp(String.raw`\baffirm\w*\s+${OWNER}(?:judgment\s+of\s+|\w+\s+and\s+)?${object}`, "i").test(text)
    || new RegExp(String.raw`\b${object}[^.;]{0,30}\b(?:is|are)\s+(?:hereby\s+)?affirmed`, "i").test(text);
  const setAsideObject = (object: string) =>
    new RegExp(String.raw`\b(?:revers\w*|vacat\w*|set\s+aside)\s+${OWNER}(?:\w+\s+and\s+)?${object}`, "i").test(text)
    || new RegExp(String.raw`\b${object}[^.;]{0,30}\b(?:is|are)\s+(?:hereby\s+)?(?:reversed|vacated|set\s+aside)`, "i").test(text);
  switch (kind) {
    case "conviction":
      if (setAsideObject(String.raw`convictions?\b`)) return "granted";
      if (affirmObject(String.raw`convictions?\b`)) return "denied";
      return null;
    case "sentence":
      if (setAsideObject(String.raw`sentences?\b`)) return "granted";
      if (affirmObject(String.raw`sentences?\b`)) return "denied";
      return null;
    case "new-trial": {
      const denial = /\b(affirm\w*|revers\w*|vacat\w*)\s+(?:\w+['’]s?\s+|\w+\s+){0,3}denial\s+of\s+(?:\w+['’]s?\s+|\w+\s+){0,4}new\s+trial\b/i.exec(text);
      if (denial) return /^affirm/i.test(denial[1] ?? "") ? "denied" : "granted";
      if (/\b(?:remand\w*|order\w*|grant\w*|entitled\s+to)\b[^.;]{0,40}\bnew\s+trial\b/i.test(text)) return "granted";
      return null;
    }
    case "resentencing":
      if (/\bremand\w*\b[^.;]{0,60}\b(?:re-?sentencing|new\s+sentencing)\b/i.test(text)) return "granted";
      return null;
    case "acquittal":
      if (/\b(?:enter|direct\w*|order\w*)\s+(?:\w+\s+){0,2}(?:judgment\s+of\s+)?acquittal\b/i.test(text)) return "granted";
      return null;
    case "dismissal":
      if (/\b(?:instructions?|directions?)\s+to\s+dismiss\b|\b(?:indictment|charges?|counts?|complaint|claims?)\b[^.;]{0,30}\b(?:is|are|be)\s+(?:hereby\s+)?dismissed\b/i.test(text)) return "granted";
      return null;
    case "judgment":
      return null;
  }
}

/** What happens to a request the closing words don't address one by one, from the overall disposition. */
function fallbackResult(kind: ReliefKind, outcome: ReliefOutcomeKind, closing: string): ReliefResult {
  const partial = /\bin\s+part\b/i.test(closing);
  switch (outcome) {
    case "affirmed":
    case "review-denied":
      return partial ? "not-shown" : "denied";
    case "dismissed":
      return "not-reached";
    case "reversed":
    case "vacated":
    case "review-granted":
      // Setting aside the whole judgment sets aside the conviction and sentence it contains;
      // what happens next (new trial, acquittal …) has to be stated to be reported.
      return !partial && (kind === "judgment" || kind === "conviction" || kind === "sentence") ? "granted" : "not-shown";
    case "mixed":
      return kind === "judgment" ? "partly" : "not-shown";
    case "remanded":
      return "not-shown";
  }
}

export function joinList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function partyLabel(side: PartySide) {
  const role = side.role === "prosecution" ? "the prosecution" : `the ${ROLE_WORD[side.role]}`;
  return `${displayPartyName(side.name)} (${role})`;
}

function resultClause(court: string, granted: string[], denied: string[], notReached: string[], partly: string[]) {
  const positive = [granted.length ? joinList(granted) : "", partly.length ? `partly ${joinList(partly)}` : ""].filter(Boolean);
  const negative = [denied.length ? `refused to ${joinList(denied)}` : "", notReached.length ? `did not rule on whether to ${joinList(notReached)}` : ""].filter(Boolean);
  if (!positive.length && !negative.length) return "";
  const yes = joinList(positive);
  const no = joinList(negative);
  return `${court} ${yes && no ? `${yes} but ${no}` : yes || no}.`;
}

function scoreLine(items: ReliefItem[], who: string) {
  const decided = items.filter((item) => item.result === "granted" || item.result === "denied" || item.result === "partly");
  if (decided.length === 0 || decided.length !== items.length) return "";
  if (decided.every((item) => item.result === "granted")) return ` So ${who} won on ${items.length > 1 ? "every point" : "that point"}.`;
  if (decided.every((item) => item.result === "denied")) return ` So ${who} lost on ${items.length > 1 ? "every point" : "that point"}.`;
  return ` So ${who} won on some points and lost on others.`;
}

/**
 * Appeals courts: request from the opinion's opening, rulings from its closing.
 * `closing` is the court's judgment sentence(s) already read by the summary.
 */
export function buildAppealRelief(input: {
  courtKind: CourtKind;
  roles: PartyRoles | null;
  outcome: ReliefOutcomeKind;
  closing: string;
  closingSource: ReliefQuote | null;
  opinionHead: string | null;
  opinionPath: string | null;
}): ReliefSummary {
  const court = input.courtKind === "supreme" ? "The Supreme Court" : "The court";
  const request = readOpinionRequest(input.opinionHead, input.roles);
  const quotes: ReliefQuote[] = [];
  if (request && input.roles) {
    const asker = input.roles[request.side];
    const who = displayPartyName(asker.name);
    const items: ReliefItem[] = request.kinds.map((kind) => {
      const ruled = rulingFor(kind, input.closing);
      // A request made by the side defending the judgment is only reported when ruled on directly.
      const result: ReliefResult = ruled ?? (request.side === "up" ? fallbackResult(kind, input.outcome, input.closing) : "not-shown");
      return { asked: ASK[kind], askedBy: partyLabel(asker), result, outcome: outcomeSentence(court, kind, result) };
    });
    quotes.push({ text: request.quote, sourceLabel: "What was asked, from the court's opinion", sourceHref: input.opinionPath });
    if (input.closingSource) quotes.push(input.closingSource);
    const granted = items.filter((item) => item.result === "granted").map((item) => DID[kindOf(item.asked)]);
    const denied = items.filter((item) => item.result === "denied").map((item) => item.asked);
    const notReached = items.filter((item) => item.result === "not-reached").map((item) => item.asked);
    const partly = items.filter((item) => item.result === "partly").map((item) => DID[kindOf(item.asked)]);
    const unknown = items.filter((item) => item.result === "not-shown").map((item) => item.asked);
    const ruled = resultClause(court, granted, denied, notReached, partly);
    const missing = unknown.length ? ` The court's closing words don't say whether it agreed to ${joinList(unknown)}; the opinion has the details.` : "";
    return {
      text: `${partyLabel(asker)} asked the court to ${joinList(items.map((item) => item.asked))}.${ruled ? ` ${ruled}` : ""}${missing}${scoreLine(items, who)}`,
      items,
      quotes,
    };
  }
  // No stated request: give the court's answer point by point, without claiming what was asked.
  const pointRulings = ORDER.filter((kind) => kind !== "judgment")
    .map((kind): { kind: ReliefKind; ruled: "granted" | "denied" | null } => ({ kind, ruled: rulingFor(kind, input.closing) }))
    .filter((entry): entry is { kind: ReliefKind; ruled: "granted" | "denied" } => entry.ruled !== null);
  const appealing = input.roles && !input.roles.cross && (input.roles.up.role === "appellant" || input.roles.up.role === "petitioner") ? input.roles.up : null;
  const role = input.courtKind === "supreme" ? "petitioner" : "appellant";
  const what = input.courtKind === "supreme" ? "the Supreme Court to review and overturn the lower court's decision" : "the appeals court to overturn the lower court's decision";
  const general = appealing ? `As the ${role}, ${displayPartyName(appealing.name)} asked ${what}. ` : "";
  const notStated = appealing
    ? "The opinion text we have doesn't spell out the exact relief requested, so we don't list it."
    : "The opinion text we have doesn't say exactly what each side asked for, so we can't list wins and losses point by point.";
  if (input.closingSource) quotes.push(input.closingSource);
  if (pointRulings.length === 0) {
    const items: ReliefItem[] = appealing
      ? [{ asked: ASK.judgment, askedBy: partyLabel(appealing), result: fallbackResult("judgment", input.outcome, input.closing), outcome: "" }]
      : [];
    for (const item of items) item.outcome = outcomeSentence(court, "judgment", item.result);
    return { text: `${general}${notStated}${items[0] ? ` ${items[0].outcome}` : ""}`, items, quotes };
  }
  const items: ReliefItem[] = pointRulings.map(({ kind, ruled }) => ({
    asked: ASK[kind],
    askedBy: null,
    result: ruled,
    outcome: `${court} ${ruled === "granted" ? DID[kind] : KEPT[kind]}.`,
  }));
  return {
    text: `${general}${notStated} ${court}'s ruling, point by point: it ${joinList(pointRulings.map(({ kind, ruled }) => (ruled === "granted" ? DID[kind] : KEPT[kind])))}.`,
    items,
    quotes,
  };
}

function kindOf(asked: string): ReliefKind {
  return (Object.keys(ASK) as ReliefKind[]).find((kind) => ASK[kind] === asked) ?? "judgment";
}

function outcomeSentence(court: string, kind: ReliefKind, result: ReliefResult) {
  switch (result) {
    case "granted": return `${court} ${DID[kind]}.`;
    case "denied": return `${court} refused to ${ASK[kind]}.`;
    case "partly": return `${court} partly ${DID[kind]}.`;
    case "not-reached": return `${court} did not rule on it.`;
    case "pending": return "No ruling yet in the records we have.";
    case "not-shown": return "The record we have doesn't say.";
  }
}

/* ------------------------------------------------------------------ */
/* Trial courts: motions on the public docket and the orders on them. */
/* ------------------------------------------------------------------ */

export type MotionType =
  | "dismiss" | "summary-judgment" | "partial-summary-judgment" | "default-judgment" | "preliminary-injunction" | "tro"
  | "remand" | "transfer" | "pleadings" | "class-certification" | "new-trial" | "jmol" | "habeas" | "fees";

const MOTION_ASK: Record<MotionType, string> = {
  dismiss: "dismiss the case (a motion to dismiss)",
  "summary-judgment": "decide the case without a trial (summary judgment)",
  "partial-summary-judgment": "decide part of the case without a trial (partial summary judgment)",
  "default-judgment": "rule for it because the other side never responded (default judgment)",
  "preliminary-injunction": "order the other side to stop while the case goes on (a preliminary injunction)",
  tro: "issue an emergency order (a temporary restraining order)",
  remand: "send the case back to state court (remand)",
  transfer: "move the case to another court (transfer)",
  pleadings: "decide the case on the written pleadings alone (judgment on the pleadings)",
  "class-certification": "let the case go forward as a class action (class certification)",
  "new-trial": "order a new trial",
  jmol: "rule for it without a jury verdict (judgment as a matter of law)",
  habeas: "order release or a new proceeding (a writ of habeas corpus)",
  fees: "make the other side pay its attorney's fees",
};

/** Most decisive first: the summary lists at most four. */
const MOTION_RANK: MotionType[] = ["summary-judgment", "dismiss", "pleadings", "default-judgment", "habeas", "jmol", "new-trial", "partial-summary-judgment", "preliminary-injunction", "tro", "class-certification", "remand", "transfer", "fees"];

export function motionType(text: string): MotionType | null {
  const value = text.toLowerCase();
  if (/\bpartial\s+summary\s+judgment\b/.test(value)) return "partial-summary-judgment";
  if (/\bsummary\s+judgment\b/.test(value)) return "summary-judgment";
  if (/\bjudgment\s+on\s+the\s+pleadings\b/.test(value)) return "pleadings";
  if (/\bdefault\s+judgment\b/.test(value)) return "default-judgment";
  if (/\bjudgment\s+as\s+a\s+matter\s+of\s+law\b/.test(value)) return "jmol";
  if (/\bnew\s+trial\b/.test(value)) return "new-trial";
  if (/\bpreliminary\s+injunction\b/.test(value)) return "preliminary-injunction";
  if (/\btemporary\s+restraining\s+order\b|\btro\b/.test(value)) return "tro";
  if (/\bclass\s+certification\b|\bcertify\s+(?:a\s+|the\s+)?class\b/.test(value)) return "class-certification";
  if (/\bto\s+remand\b|\bremand\s+to\s+state\b/.test(value)) return "remand";
  if (/\bto\s+transfer\b|\bchange\s+(?:of\s+)?venue\b/.test(value)) return "transfer";
  if (/\battorney['’]?s?\s+fees\b/.test(value)) return "fees";
  if (/\bhabeas\s+corpus\b/.test(value)) return "habeas";
  if (/\bto\s+dismiss\b|\bdismissal\b/.test(value)) return "dismiss";
  return null;
}

export interface DocketMotion {
  entryNumber: number | null;
  filedOn: string | null;
  type: MotionType;
  by: string | null;
  quote: string;
}

export interface DocketRuling {
  entryNumber: number | null;
  refersTo: number | null;
  filedOn: string | null;
  type: MotionType | null;
  result: "granted" | "denied" | "partly" | "moot";
  quote: string;
}

export interface DocketEntryInput {
  /** Postgres numeric columns arrive as strings. */
  entryNumber?: number | string | null;
  filedOn: string | null;
  description: string;
}

function entryNumberOf(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

const RESTRICTED = /\bseal(?:ed|ing)?\b|\brestricted\b|\bex\s+parte\b|\bin\s+camera\b/i;

function shortQuote(text: string) {
  return text.length > 300 ? `${text.slice(0, 297).replace(/\s+\S*$/, "")}…` : text;
}

/** "MOTION to Dismiss for Failure to State a Claim by Acme Corp.. (Attachments: …)" */
export function readMotion(entry: DocketEntryInput): DocketMotion | null {
  const text = clean(entry.description ?? "");
  if (!text || text.length > 1200 || RESTRICTED.test(text)) return null;
  const head = /^(?:(?:joint|amended|renewed|second|third|partial|cross|emergency|unopposed|opposed|consent|supplemental)\s+)*MOTION\s+(?:for|to)\s+([^.(]{3,160})/i.exec(text)
    ?? /^PETITION\s+for\s+(?:a\s+)?writ\s+of\s+habeas\s+corpus\b([^(]{0,160})/i.exec(text);
  if (!head) return null;
  const type = motionType(head[0]);
  if (!type) return null;
  const byMatch = /\b(?:filed\s+)?by\s+(?:(?:plaintiffs?|defendants?|petitioners?|respondents?)\s+)?([A-Z][^()]{1,80}?)(\.{1,2}\s|\.{0,2}$|\s*\()/.exec(text.slice(head.index));
  const abbreviated = byMatch?.[1] && /\.$/.test(byMatch[2] ?? "") || /^\.\.?\s/.test(byMatch?.[2] ?? "");
  const rawBy = byMatch?.[1]?.trim().replace(/^(?:(?:plaintiffs?|defendants?|petitioners?|respondents?|movants?)\s+)(?=[A-Z])/i, "") ?? null;
  const by = rawBy && abbreviated && /\b(?:Inc|Corp|Co|Ltd|LLC|L\.L\.C|L\.P|N\.A|Jr|Sr|U\.S\.A?)$/.test(rawBy) ? `${rawBy}.` : rawBy;
  return { entryNumber: entryNumberOf(entry.entryNumber), filedOn: entry.filedOn, type, by: by && by.length >= 2 ? by.replace(/[,;]\s*$/, "") : null, quote: shortQuote(text) };
}

/** "ORDER granting 12 Motion to Dismiss; denying 15 Motion for Summary Judgment" and "Motion to Dismiss [12] is GRANTED". */
export function readRulings(entry: DocketEntryInput): DocketRuling[] {
  const text = clean(entry.description ?? "");
  if (!text || text.length > 1500 || RESTRICTED.test(text)) return [];
  if (!/^(?:(?:memorandum\s+)?(?:opinion|decision)(?:\s+(?:and|&)\s+order)?|(?:memorandum\s+)?order|judgment|minute\s+order|text\s+order|opinion\s+and\s+order)\b/i.test(text)) return [];
  const rulings: DocketRuling[] = [];
  const verb = /\b(granting\s+in\s+part\s+and\s+denying\s+in\s+part|denying\s+in\s+part\s+and\s+granting\s+in\s+part|granting(?:\s+in\s+part)?|denying(?:\s+as\s+moot)?|finding\s+as\s+moot|mooting)\s+(?:(?:the\s+|plaintiff['’]?s?\s+|defendants?['’]?s?\s+)?\[?(\d{1,5})\]?\s+)?([^;]{0,140}?\b(?:motion|petition)\b[^;]{0,90})/gi;
  for (const match of text.matchAll(verb)) {
    const word = (match[1] ?? "").toLowerCase();
    const result: DocketRuling["result"] = /in\s+part/.test(word) ? "partly" : /moot/.test(word) ? "moot" : word.startsWith("grant") ? "granted" : "denied";
    const refers = match[2] ? Number(match[2]) : Number(/\[?(\d{1,5})\]?\s+(?:\w+\s+){0,3}(?:motion|petition)\b/i.exec(match[3] ?? "")?.[1] ?? NaN);
    rulings.push({ entryNumber: entryNumberOf(entry.entryNumber), refersTo: Number.isFinite(refers) ? refers : null, filedOn: entry.filedOn, type: motionType(match[3] ?? ""), result, quote: shortQuote(text) });
  }
  if (rulings.length) return rulings;
  const passive = /\b((?:motion|petition)\b[^.;]{0,140}?)\s*\[?(\d{1,5})?\]?\s+(?:is|are)\s+(?:hereby\s+)?(GRANTED\s+IN\s+PART\s+AND\s+DENIED\s+IN\s+PART|GRANTED\s+IN\s+PART|GRANTED|DENIED(?:\s+AS\s+MOOT)?)\b/gi;
  for (const match of text.matchAll(passive)) {
    const word = (match[3] ?? "").toLowerCase();
    const refers = match[2] ? Number(match[2]) : Number(/\[(\d{1,5})\]/.exec(match[1] ?? "")?.[1] ?? NaN);
    rulings.push({
      entryNumber: entryNumberOf(entry.entryNumber),
      refersTo: Number.isFinite(refers) ? refers : null,
      filedOn: entry.filedOn,
      type: motionType(match[1] ?? ""),
      result: /in\s+part/.test(word) ? "partly" : /moot/.test(word) ? "moot" : word.startsWith("grant") ? "granted" : "denied",
      quote: shortQuote(text),
    });
  }
  return rulings;
}

/**
 * Trial courts: the main motions on the public docket and the court's ruling on
 * each. A ruling is tied to a motion by its docket number, or (with no number)
 * by type when exactly one motion of that type came before it.
 */
export function buildDocketRelief(input: {
  entries: DocketEntryInput[];
  roles: PartyRoles | null;
  docketPath: string | null;
}): ReliefSummary | null {
  const motions = input.entries.map(readMotion).filter((motion): motion is DocketMotion => Boolean(motion));
  if (motions.length === 0) return null;
  const rulings = input.entries.flatMap(readRulings);
  const used = new Set<DocketRuling>();
  const matched = motions.map((motion) => {
    let ruling = motion.entryNumber !== null ? rulings.find((item) => item.refersTo === motion.entryNumber && !used.has(item)) : undefined;
    if (!ruling && motion.type) {
      const sameType = motions.filter((other) => other.type === motion.type);
      const candidates = rulings.filter((item) => item.refersTo === null && item.type === motion.type && !used.has(item)
        && (!motion.filedOn || !item.filedOn || item.filedOn >= motion.filedOn));
      if (sameType.length === 1 && candidates.length === 1) ruling = candidates[0];
    }
    if (ruling) used.add(ruling);
    return { motion, ruling: ruling ?? null };
  });
  // Most decisive motion types first; one line per type (the latest motion of that type).
  const byType = new Map<MotionType, (typeof matched)[number]>();
  for (const entry of matched.sort((left, right) => (right.motion.filedOn ?? "").localeCompare(left.motion.filedOn ?? ""))) {
    const current = byType.get(entry.motion.type);
    if (!current || (!current.ruling && entry.ruling)) byType.set(entry.motion.type, entry);
  }
  const chosen = MOTION_RANK.map((type) => byType.get(type)).filter((entry): entry is (typeof matched)[number] => Boolean(entry)).slice(0, 4);
  const items: ReliefItem[] = [];
  const sentences: string[] = [];
  const quotes: ReliefQuote[] = [];
  for (const { motion, ruling } of chosen) {
    const asker = askerLabel(motion.by, input.roles);
    const result: ReliefResult = !ruling ? "pending" : ruling.result === "moot" ? "not-reached" : ruling.result;
    const ask = MOTION_ASK[motion.type];
    const outcome = !ruling ? "The records we have show no ruling on it yet."
      : ruling.result === "granted" ? "The court granted it."
      : ruling.result === "denied" ? "The court denied it."
      : ruling.result === "partly" ? "The court granted it in part and denied it in part."
      : "The court did not decide it (it called the request moot, meaning it no longer mattered).";
    items.push({ asked: ask, askedBy: asker, result, outcome });
    sentences.push(`${asker ? capitalize(asker) : "A party"} asked the court to ${ask}. ${outcome}`);
    quotes.push({ text: motion.quote, sourceLabel: `The request, from the court's docket${motion.filedOn ? `, ${formatPublicCaseDate(motion.filedOn) ?? motion.filedOn}` : ""}`, sourceHref: input.docketPath });
    if (ruling) quotes.push({ text: ruling.quote, sourceLabel: `The ruling, from the court's docket${ruling.filedOn ? `, ${formatPublicCaseDate(ruling.filedOn) ?? ruling.filedOn}` : ""}`, sourceHref: input.docketPath });
  }
  if (items.length === 0) return null;
  return { text: sentences.join(" "), items, quotes: quotes.slice(0, 4) };
}

function askerLabel(by: string | null, roles: PartyRoles | null) {
  if (!by) return null;
  const generic = /^(?:the\s+)?(?:all\s+)?(plaintiffs?|defendants?|petitioners?|respondents?)$/i.exec(by.trim());
  if (generic) return `the ${generic[1]!.toLowerCase()}`;
  const side = roles ? sideForName(roles, by) : null;
  const role = side && roles ? (roles[side].role === "prosecution" ? "the prosecution" : `the ${ROLE_WORD[roles[side].role]}`) : null;
  return `${displayPartyName(by)}${role ? ` (${role})` : ""}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* ----------------------------------------------------------- */
/* Supreme Court: the petition's questions and the judgment.   */
/* ----------------------------------------------------------- */

export interface QuestionsPresented {
  questions: string[];
  /** 1-based numbers of the questions the Court agreed to decide, when it limited the grant. */
  grantedLimitedTo: number[] | null;
  /** The Court's own rewording when it limited the grant, verbatim. */
  grantedQuestion?: string | null;
  sourceUrl: string;
}

export function buildSupremeRelief(input: {
  roles: PartyRoles | null;
  lowerCourt: string | null;
  questions: QuestionsPresented | null;
  status: "decided" | "denied" | "dismissed" | "granted-pending" | "pending";
  outcome: ReliefOutcomeKind | null;
}): ReliefSummary {
  const petitioner = input.roles && !input.roles.cross ? input.roles.up : null;
  const who = petitioner ? displayPartyName(petitioner.name) : "The petitioner";
  const lower = input.lowerCourt ? input.lowerCourt.replace(/^The\s/, "the ") : "the lower court";
  const quotes: ReliefQuote[] = [];
  const questions = input.questions?.questions ?? [];
  let asked = `${petitioner ? `${who} (the petitioner)` : "The petitioner (the side that asked the Supreme Court to take the case)"} asked the Supreme Court to review and overturn the decision of ${lower}.`;
  if (questions.length && input.questions) {
    asked += questions.length === 1 ? " The petition asked the Court to decide this question (quoted below)." : ` The petition asked the Court to decide ${questions.length} questions (quoted below).`;
    const limited = input.questions.grantedLimitedTo?.filter((number) => number >= 1 && number <= questions.length) ?? [];
    if (limited.length && limited.length < questions.length) {
      asked += ` The Court agreed to decide only question ${joinList(limited.map(String))}.`;
    } else if (input.questions.grantedQuestion) {
      asked += " The Court agreed to decide only a narrower question, in its own words (quoted below).";
    }
    questions.forEach((question, index) => quotes.push({
      text: question,
      sourceLabel: questions.length > 1 ? `Question ${index + 1}, from the questions presented (supremecourt.gov)` : "From the questions presented (supremecourt.gov)",
      sourceHref: input.questions!.sourceUrl,
    }));
    if (input.questions.grantedQuestion && !(limited.length && limited.length < questions.length)) {
      quotes.push({ text: input.questions.grantedQuestion, sourceLabel: "The question the Court agreed to decide (supremecourt.gov)", sourceHref: input.questions.sourceUrl });
    }
  } else if (input.status !== "denied" && input.status !== "dismissed") {
    asked += " We don't have the petition's questions presented for this case.";
  }
  let ruled: string;
  let result: ReliefResult;
  switch (input.status) {
    case "denied":
      result = "denied";
      ruled = `The Court refused to take the case (denied certiorari), so ${petitioner ? who : "the petitioner"} lost and the decision of ${lower} stands. The Court did not answer ${questions.length ? "the questions" : "any question in the case"}.`;
      break;
    case "dismissed":
      result = "not-reached";
      ruled = `The Court dismissed the petition without deciding it, so the decision of ${lower} stands.`;
      break;
    case "granted-pending":
      result = "pending";
      ruled = "The Court agreed to hear the case and has not ruled yet.";
      break;
    case "pending":
      result = "pending";
      ruled = "The Court has not yet said whether it will hear the case.";
      break;
    case "decided": {
      result = input.outcome ? fallbackResult("judgment", input.outcome, "") : "not-shown";
      const answers = questions.length ? " The opinion explains how the Court answered each question; we don't restate it." : "";
      ruled = result === "granted"
        ? `The Court ${input.outcome === "vacated" ? "canceled" : "overturned"} that decision, so ${petitioner ? who : "the petitioner"} won${input.outcome === "vacated" || input.outcome === "reversed" ? ", at least for now (the case may go back for more proceedings)" : ""}.${answers}`
        : result === "denied"
          ? `The Court refused to overturn that decision, so ${petitioner ? who : "the petitioner"} lost.${answers}`
          : result === "partly"
            ? `The Court overturned part of that decision and left part in place, so ${petitioner ? who : "the petitioner"} won on some points and lost on others.${answers}`
            : result === "not-reached"
              ? `The Court ended the case without deciding the questions, so the lower court's decision stands.`
              : `The record we have doesn't show the Court's judgment.`;
      break;
    }
  }
  return {
    text: `${asked} ${ruled}`,
    items: [{ asked: `review and overturn the decision of ${lower}`, askedBy: petitioner ? `${who} (the petitioner)` : null, result, outcome: ruled }],
    quotes,
  };
}

export const RESULT_BADGE: Record<ReliefResult, string> = {
  granted: "Won",
  denied: "Lost",
  partly: "Partly won",
  "not-reached": "Not decided",
  "not-shown": "Record doesn't say",
  pending: "No ruling yet",
};
