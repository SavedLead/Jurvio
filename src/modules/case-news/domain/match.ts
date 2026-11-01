import type { CaseNewsTerms, PartyTerm } from "./case-terms";

export const CASE_NEWS_MATCH_RULE_VERSION = "case-news-match-v1";
/** At or above: shown on the case page. */
export const PUBLISH_THRESHOLD = 0.85;
/** At or above (and below PUBLISH_THRESHOLD): internal review queue. Below: dropped. */
export const REVIEW_THRESHOLD = 0.6;

export type MatchMethod = "docket_number" | "case_name_court" | "parties_court_timeframe";

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
    if (!phrasePattern(phrase, single).test(text)) continue;
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
  const leftHit = mentionsParty(text, terms.left);
  const rightHit = terms.right ? mentionsParty(text, terms.right) : null;
  const courtHit = mentionsCourt(text, terms.courtTerms);
  const courtEvidence = Boolean(courtHit) || context.courtInFullText;
  const inWindow = withinTimeframe(item.publishedAt, context.filedOn, context.decidedOn, context.now);
  const base = { leftHit: leftHit?.phrase ?? null, rightHit: rightHit?.phrase ?? null, courtHit, courtInFullText: context.courtInFullText, inWindow };
  const results: MatchResult[] = [];
  const ambiguous = context.ambiguity === "same_court" || (context.ambiguity === "other_court" && !courtHit);

  const docketHit = terms.docketPatterns.find((pattern) => pattern.test(text));
  if (docketHit || context.docketInFullText) {
    let score = docketHit ? 0.88 : 0.6;
    if (leftHit || rightHit) score += 0.07;
    if (courtEvidence) score += terms.docketDistinctive ? 0.04 : 0.06;
    if (!terms.docketDistinctive && !courtEvidence) score = Math.min(score, 0.7);
    if (!docketHit && !(leftHit || rightHit)) score = Math.min(score, 0.75);
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
    } else if (courtEvidence && inWindow) {
      let score = 0.55 + 0.25 * Math.max(...sides) + 0.15 * Math.min(...sides) + (courtHit ? 0.05 : 0);
      if (ambiguous) score = Math.min(score, 0.8);
      results.push({ method: "parties_court_timeframe", score: round(score), evidence: { ...base, ambiguity: context.ambiguity } });
    }
  }

  const best = results.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < REVIEW_THRESHOLD) return null;
  return best;
}

export function reviewStatusFor(score: number): "auto_published" | "pending_review" | null {
  if (score >= PUBLISH_THRESHOLD) return "auto_published";
  if (score >= REVIEW_THRESHOLD) return "pending_review";
  return null;
}
