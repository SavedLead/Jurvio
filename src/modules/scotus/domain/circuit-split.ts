/**
 * Circuit splits: when federal courts of appeals disagree on the same legal question, the Supreme
 * Court often takes a case to settle it. This reads the opinion's (or the question presented's)
 * own sentences that say so. Fixed patterns only; no sentence, no claim.
 */

import { joinLineBreakHyphens, splitSentences } from "@/modules/cases/domain/reporter-text";

export interface CircuitSplitSentence { sentence: string; circuits: string[] }

const SPLIT = new RegExp([
  String.raw`\bcircuit\s+split\b`,
  String.raw`\bsplit\s+(?:of\s+authority\s+)?(?:among|between|in|within)\s+the\s+(?:federal\s+)?(?:courts\s+of\s+appeals|circuits|lower\s+courts)\b`,
  String.raw`\b(?:conflict|disagreement|division)\s+(?:among|between|in)\s+the\s+(?:federal\s+)?(?:courts\s+of\s+appeals|circuits)\b`,
  String.raw`\b(?:courts\s+of\s+appeals|circuits)\s+(?:are|have\s+been|were)\s+(?:divided|split|in\s+conflict)\b`,
  String.raw`\bthe\s+circuits\s+(?:disagree|have\s+disagreed)\b`,
].join("|"), "i");

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh"];

/** "the Fifth and Ninth Circuits", "the D. C. Circuit", "CA7" → ["Fifth", "Ninth", "D.C.", "Seventh"]. */
export function circuitsNamed(text: string): string[] {
  const found = new Set<string>();
  const group = /\b((?:(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|D\.\s?C\.|Federal)(?:,\s*|\s*,?\s*(?:and|or)\s+)?)+)\s+Circuits?\b/g;
  for (const match of text.matchAll(group)) {
    for (const name of match[1]!.split(/\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/)) {
      const clean = name.replace(/\s+/g, "").trim();
      if (!clean) continue;
      found.add(clean === "D.C." ? "D.C." : clean);
    }
  }
  for (const match of text.matchAll(/\bCA(\d{1,2})\b/g)) {
    const index = Number(match[1]) - 1;
    if (ORDINALS[index]) found.add(ORDINALS[index]!);
  }
  const order = [...ORDINALS, "D.C.", "Federal"];
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Up to `limit` sentences that say the courts of appeals disagree, with the next sentence when it names the circuits. */
export function readCircuitSplit(text: string | null | undefined, limit = 2): CircuitSplitSentence[] {
  if (!text) return [];
  const all = splitSentences(joinLineBreakHyphens(text.slice(0, 60_000)));
  const out: CircuitSplitSentence[] = [];
  for (let index = 0; index < all.length && out.length < limit; index += 1) {
    const sentence = all[index]!;
    if (!SPLIT.test(sentence) || sentence.length > 700) continue;
    // Skip sentences that deny a split ("there is no circuit split").
    if (/\b(?:no|not\s+a|any)\s+(?:real\s+|genuine\s+)?(?:circuit\s+)?(?:split|conflict)\b/i.test(sentence)) continue;
    const next = all[index + 1] ?? "";
    const withNext = circuitsNamed(sentence).length === 0 && circuitsNamed(next).length > 0 && next.length < 600 ? `${sentence} ${next}` : sentence;
    out.push({ sentence: withNext.trim(), circuits: circuitsNamed(withNext) });
  }
  return out;
}
