import type { CaseNewsTerms, PartyTerm } from "./case-terms";

export const CASE_NEWS_MATCH_RULE_VERSION = "case-news-match-v2";
/** At or above: shown on the case page. */
export const PUBLISH_THRESHOLD = 0.85;
/** At or above (and below PUBLISH_THRESHOLD): internal review queue. Below: dropped. */
export const REVIEW_THRESHOLD = 0.6;

export type MatchMethod = "docket_number" | "case_name_court" | "parties_court_timeframe" | "single_party_court";

/** Score for a one-party match: always in the review band, never auto-published. */
export const SINGLE_PARTY_SCORE = 0.7;
export const SINGLE_PARTY_AMBIGUOUS_SCORE = 0.62;

/**
 * Surnames of the sitting Supreme Court justices. A party with one of these
 * names ("Barrett v. United States") cannot be matched on its name alone:
 * "Justice Barrett" headlines are about the justice. Lower-court judges come
 * from the judge table at run time (MatchContext.judgeSurnames).
 */
export const SITTING_JUSTICE_SURNAMES: ReadonlySet<string> = new Set([
  "roberts", "thomas", "alito", "sotomayor", "kagan", "gorsuch", "kavanaugh", "barrett", "jackson",
]);

export interface NewsItem {
  url: string;
  title: string;
  snippet: string | null;
  publishedAt: Date;
}

export interface MatchContext {
  terms: CaseNewsTerms;
  filedOn: string | null;
  decidedOn: string | null;
  /**
   * Another published case shares this party pair. "same_court": a name match
   * cannot tell them apart. "other_court": only a headline naming this court can.
   */
  ambiguity: "none" | "other_court" | "same_court";
  /** The source already guaranteed the article text names this court (a GDELT full-text query term). */
  courtInFullText: boolean;
  /** The source already guaranteed the article text contains this docket number (a GDELT docket query). */
  docketInFullText: boolean;
  /** Lower-case surnames of sitting judges; a party with such a name never matches on its name alone. */
  judgeSurnames?: ReadonlySet<string>;
  now?: Date;
}

export interface MatchResult {
  method: MatchMethod;
  score: number;
  evidence: Record<string, unknown>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string, caseSensitive: boolean): RegExp {
  const body = phrase.trim().split(/\s+/).map(escapeRegExp).join("[\\s-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, caseSensitive ? "u" : "iu");
}

/** Headline spellings for a party: its key, its anchor word, its aliases. */
export function partyPhrases(party: PartyTerm): string[] {
  return [party.key, party.anchor ?? null, ...party.aliases].filter((value): value is string => Boolean(value && value.length >= 2));
}

export interface PartyMention {
  phrase: string;
  /** Distinctiveness earned by this mention (an anchor-only mention can earn less). */
  distinctiveness: number;
}

export function mentionsParty(text: string, party: PartyTerm): PartyMention | null {
  for (const phrase of partyPhrases(party)) {
    // Single-word names must be capitalized as a name ("Rice", not "rice").
    const single = !/\s/.test(phrase);
    const found = phrasePattern(phrase, false).exec(text);
    if (!found) continue;
    if (single && !/^\p{Lu}/u.test(found[0])) continue;
    const viaAnchor = phrase === party.anchor && phrase !== party.key;
    return { phrase, distinctiveness: viaAnchor ? party.anchorDistinctiveness ?? 0.6 : party.distinctiveness };
  }
  return null;
}

export function mentionsCourt(text: string, courtTerms: string[]): string | null {
  for (const term of courtTerms) if (phrasePattern(term, false).test(text)) return term;
  return null;
}

function caseNamePattern(left: PartyTerm, right: PartyTerm): RegExp | null {
  const l = partyPhrases(left).map((phrase) => phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+"));
  const r = partyPhrases(right).map((phrase) => phrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+"));
  if (!l.length || !r.length) return null;
  return new RegExp(`(?<![\\p{L}])(?:${l.join("|")})(?:[\\w.,'’&\\s]{0,40}?)\\s+v(?:s)?\\.?\\s+(?:[\\w.'’&\\s]{0,20}?)(?:${r.join("|")})(?![\\p{L}])`, "iu");
}

// "Justice Amy Coney Barrett", "Chief Justice Roberts", "U.S. District Judge Jane Smith", "Justices Alito and Thomas".
const JUDGE_TITLE = String.raw`(?:Chief\s+Justice|Associate\s+Justice|Justice|Magistrate\s+Judge|Judge|Hon\.|Honorable)\s+(?:[A-Z][\p{L}.'’-]*\s+){0,2}|(?:Justices|Judges)\s+(?:[A-Z][\p{L}'’-]*\s+and\s+)?`;

/** The text with every titled-judge mention of this phrase removed ("Justice Barrett" is not the party Barrett). */
export function withoutJudgeMentions(text: string, phrase: string): string {
  const body = phrase.trim().split(/\s+/).map(escapeRegExp).join("[\\s-]+");
  return text.replace(new RegExp(`(?<![\\p{L}])(?:${JUDGE_TITLE})${body}(?![\\p{L}\\p{N}])`, "gu"), " ");
}

const COURT_NAME_PREFIX = /(?<![\p{L}])(?:U\.\s?S\.|United\s+States)(?=\s+(?:Supreme\s+Court|Court\s+of|District\s+(?:Court|Judge)|Circuit|Courts?\s+of\s+Appeals|Magistrate|Bankruptcy\s+Court|Tax\s+Court|Court\s+of\s+Federal\s+Claims|Judge|Justice\b(?!\s+Department)))/gu;

// "Ninth Circuit", "9th Circuit", "D.C. Circuit", "Federal Circuit": court names whose words must not count as a party mention.
const CIRCUIT_NAME = /(?<![\p{L}\p{N}])(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|11th|D\.\s?C\.|Federal)[\s-]+Circuit(?![\p{L}])/giu;

/** The text with "U.S." / "United States" removed where it only names a court or a judge, and circuit names removed. */
export function withoutCourtNames(text: string): string {
  return text.replace(COURT_NAME_PREFIX, " ").replace(CIRCUIT_NAME, " ");
}

/** A party mention that is not a judge's titled name. */
function mentionsPartyNotAsJudge(text: string, party: PartyTerm): PartyMention | null {
  let rest = text;
  for (const phrase of partyPhrases(party)) rest = withoutJudgeMentions(rest, phrase);
  return mentionsParty(rest, party);
}

/** Lower-case surname-like words a party is known by in headlines. */
function partyNameWords(party: PartyTerm): string[] {
  return partyPhrases(party).map((phrase) => phrase.toLowerCase());
}

/**
 * Can this party alone identify the case in a headline (with the court)?
 * Only a person or organization with a distinctive name: never a government
 * ("United States", "State of X", "City of Y"), an agency, a common or
 * serial-official surname, or a name shared with a sitting justice or judge.
 */
export function distinctiveForSingleParty(party: PartyTerm, judgeSurnames?: ReadonlySet<string>): boolean {
  if (!party.key) return false;
  if (party.kind !== "person" && party.kind !== "organization") return false;
  if (party.distinctiveness < 0.6) return false;
  return !partyNameWords(party).some((word) => SITTING_JUSTICE_SURNAMES.has(word) || judgeSurnames?.has(word));
}

// Words that show a headline is about litigation, for sources whose court evidence is only in the article body.
const LEGAL_CONTEXT = /(?<![\p{L}])(?:court|courts|justices?|judges?|appeals?|appellate|ruling|rules|ruled|lawsuit|suit|sues|sued|case|argument|arguments|oral|petition|certiorari|cert|verdict|conviction|sentence|sentencing|decision|opinion|docket|plaintiffs?|defendants?|lawyers?|attorneys?|litigation|legal|law|unconstitutional|constitutional|hearing|hears|heard|overturn(?:s|ed)?|uphold(?:s)?|upheld|reverse[sd]?|vacate[sd]?|remand(?:s|ed)?|injunction|block(?:s|ed)?)(?![\p{L}])/iu;

function dayDiff(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

/** Coverage window: from shortly before filing to well after the last decision. */
export function withinTimeframe(publishedAt: Date, filedOn: string | null, decidedOn: string | null, now = new Date()): boolean {
  if (publishedAt.getTime() > now.getTime() + 86_400_000) return false;
  const start = filedOn ? new Date(`${filedOn}T00:00:00Z`) : decidedOn ? new Date(new Date(`${decidedOn}T00:00:00Z`).getTime() - 3 * 365 * 86_400_000) : null;
  if (start && dayDiff(start, publishedAt) < -14) return false;
  if (decidedOn) {
    const decided = new Date(`${decidedOn}T00:00:00Z`);
    if (dayDiff(decided, publishedAt) > 365) return false;
  }
  return true;
}

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

/**
 * Scores one news item against one case. Returns the strongest method, or null
 * when nothing reaches the review threshold. Only the headline and the snippet
 * the source itself provides are read; article bodies are never fetched.
 */
export function matchNewsItem(item: NewsItem, context: MatchContext): MatchResult | null {
  const { terms } = context;
  const text = `${item.title}\n${item.snippet ?? ""}`;
  // "U.S. Supreme Court" / "United States Court of Appeals" name the court, not the United States as a party.
  const partyText = withoutCourtNames(text);
  const leftHit = mentionsParty(partyText, terms.left);
  const rightHit = terms.right ? mentionsParty(partyText, terms.right) : null;
  const courtHit = mentionsCourt(text, terms.courtTerms);
  const courtEvidence = Boolean(courtHit) || context.courtInFullText;
  const inWindow = withinTimeframe(item.publishedAt, context.filedOn, context.decidedOn, context.now);
  const base = { leftHit: leftHit?.phrase ?? null, rightHit: rightHit?.phrase ?? null, courtHit, courtInFullText: context.courtInFullText, inWindow };
  const results: MatchResult[] = [];
  const ambiguous = context.ambiguity === "same_court" || (context.ambiguity === "other_court" && !courtHit);
  // A party sharing a justice's or judge's surname never matches on its name alone; it needs a mention that is not "Justice X".
  const judgeNamed = (party: PartyTerm) => partyNameWords(party).some((word) => SITTING_JUSTICE_SURNAMES.has(word) || Boolean(context.judgeSurnames?.has(word)));
  const leftPlain = leftHit ? mentionsPartyNotAsJudge(partyText, terms.left) : null;
  const rightPlain = terms.right && rightHit ? mentionsPartyNotAsJudge(partyText, terms.right) : null;
  const leftUsable = judgeNamed(terms.left) ? leftPlain : leftHit;
  const rightUsable = terms.right && judgeNamed(terms.right) ? rightPlain : rightHit;

  const docketHit = terms.docketPatterns.find((pattern) => pattern.test(text));
  if (docketHit || context.docketInFullText) {
    let score = docketHit ? 0.88 : 0.6;
    if (leftUsable || rightUsable) score += 0.07;
    if (courtEvidence) score += terms.docketDistinctive ? 0.04 : 0.06;
    if (!terms.docketDistinctive && !courtEvidence) score = Math.min(score, 0.7);
    if (!docketHit && !(leftUsable || rightUsable)) score = Math.min(score, 0.75);
    if (!inWindow) score = Math.min(score, 0.8);
    results.push({ method: "docket_number", score: round(score), evidence: { ...base, docketInText: Boolean(docketHit), docketInFullText: context.docketInFullText } });
  }

  if (terms.right && leftHit && rightHit) {
    const namePattern = caseNamePattern(terms.left, terms.right);
    const sides = [leftHit.distinctiveness, rightHit.distinctiveness];
    if (namePattern?.test(text) && courtEvidence) {
      let score = 0.93;
      if (Math.max(...sides) < 0.6) score = 0.7;
      if (ambiguous) score = Math.min(score, 0.8);
      if (!inWindow) score = Math.min(score, 0.75);
      results.push({ method: "case_name_court", score: round(score), evidence: { ...base, caseName: true, ambiguity: context.ambiguity } });
    } else if (courtEvidence && inWindow && leftUsable && rightUsable) {
      let score = 0.55 + 0.25 * Math.max(...sides) + 0.15 * Math.min(...sides) + (courtHit ? 0.05 : 0);
      if (ambiguous) score = Math.min(score, 0.8);
      results.push({ method: "parties_court_timeframe", score: round(score), evidence: { ...base, ambiguity: context.ambiguity } });
    }
  }

  // One distinctive party plus the court, no docket: review queue only.
  if (!results.length && inWindow) {
    const single = singlePartyHit(terms, leftPlain, rightPlain, context.judgeSurnames);
    const courtShown = Boolean(courtHit) || (context.courtInFullText && LEGAL_CONTEXT.test(text));
    if (single && courtShown) {
      const score = Math.min(ambiguous ? SINGLE_PARTY_AMBIGUOUS_SCORE : SINGLE_PARTY_SCORE, PUBLISH_THRESHOLD - 0.01);
      results.push({ method: "single_party_court", score: round(score), evidence: { ...base, singleParty: single.phrase, ambiguity: context.ambiguity } });
    }
  }

  const best = results.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < REVIEW_THRESHOLD) return null;
  return best;
}

/** The one distinctive party a headline names, when it names exactly one usable side. */
function singlePartyHit(terms: CaseNewsTerms, left: PartyMention | null, right: PartyMention | null, judgeSurnames?: ReadonlySet<string>): PartyMention | null {
  const leftOk = left && distinctiveForSingleParty(terms.left, judgeSurnames) && left.distinctiveness >= 0.6 ? left : null;
  const rightOk = right && terms.right && distinctiveForSingleParty(terms.right, judgeSurnames) && right.distinctiveness >= 0.6 ? right : null;
  // Two distinctive sides both named is a two-party match, handled above.
  if (leftOk && rightOk) return null;
  return leftOk ?? rightOk;
}

export function reviewStatusFor(score: number): "auto_published" | "pending_review" | null {
  if (score >= PUBLISH_THRESHOLD) return "auto_published";
  if (score >= REVIEW_THRESHOLD) return "pending_review";
  return null;
}
