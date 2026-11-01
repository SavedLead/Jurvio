import { findCourtMentions, type CourtMention } from "./federal-courts";
import { findDistrictDockets, type DistrictDocket } from "./district-docket";

export interface CaseReference {
  docket: DistrictDocket;
  /** null when the document does not state which court; such references only go to review. */
  courtCode: string | null;
  courtEvidence: string | null;
}

const PARENTHETICAL_WINDOW = 60;
const NEAR_WINDOW = 250;
const ADJACENT_WINDOW = 120;

/**
 * Court + docket pairs a document states. A court is attached to a docket only by:
 *  1. a Bluebook parenthetical right after it ("6:26-cv-05267-JDA (D.S.C. filed ...)"),
 *  2. the document naming exactly one district court in total, or
 *  3. the closest court named in the 120 characters before it, in the same sentence and with no other
 *     docket in between, or
 *  4. exactly one district court named within 250 characters of it.
 * Anything else stays without a court (and so cannot be matched).
 */
export function extractCaseReferences(text: string, now?: Date): CaseReference[] {
  const dockets = findDistrictDockets(text, now);
  if (dockets.length === 0) return [];
  const mentions = findCourtMentions(text);
  const distinct = new Set(mentions.map((mention) => mention.code));
  return dockets.map((docket) => {
    const end = docket.index + docket.raw.length;
    const after = text.slice(end, end + PARENTHETICAL_WINDOW);
    const parenthetical = /^\s*,?\s*\(([^)]*)\)/.exec(after);
    if (parenthetical) {
      const inside = findCourtMentions(parenthetical[1]!);
      const codes = new Set(inside.map((mention) => mention.code));
      if (codes.size === 1) return { docket, courtCode: inside[0]!.code, courtEvidence: parenthetical[0].trim() };
    }
    if (distinct.size === 1) return { docket, courtCode: mentions[0]!.code, courtEvidence: mentions[0]!.text };
    // "in the Northern District of Texas, No. 3:26-cv-1979": the closest court named just
    // before the docket, with no other docket number in between.
    const before = mentions.filter((mention) => mention.index < docket.index && docket.index - mention.index <= ADJACENT_WINDOW).at(-1);
    const between = before ? text.slice(before.index + before.text.length, docket.index) : "";
    if (before && !/[.;!?]\s+[A-Z]/.test(between.replace(/\b(?:No|Nos|Case|U\.S|Civ|Cr|Crim)\.\s/g, ""))
      && !dockets.some((other) => other !== docket && other.index > before.index && other.index < docket.index)) {
      return { docket, courtCode: before.code, courtEvidence: before.text };
    }
    const near = mentions.filter((mention: CourtMention) => Math.abs(mention.index - docket.index) <= NEAR_WINDOW);
    const nearCodes = new Set(near.map((mention) => mention.code));
    if (nearCodes.size === 1) return { docket, courtCode: near[0]!.code, courtEvidence: near[0]!.text };
    return { docket, courtCode: null, courtEvidence: null };
  });
}

/** One structured pair (an agency's own "Federal Court" + "Civil Action Number" fields). */
export function structuredReference(docket: DistrictDocket | null, courtCode: string | null, evidence: string): CaseReference[] {
  return docket ? [{ docket, courtCode, courtEvidence: courtCode ? evidence : null }] : [];
}

const SEALED = /\b(?:filed under seal|under seal|(?<!un)sealed (?:complaint|indictment|information|filing|document|exhibit|order|docket|case|record|motion|affidavit)s?|remains? sealed|is sealed|was sealed|ordered sealed)\b/i;
const JUVENILE = /\b(?:juvenile (?:defendant|delinquen\w*|proceeding|offender)|a juvenile,? (?:was|has been) (?:charged|adjudicated))\b/i;

/**
 * Sealed or otherwise restricted material is never published. Checked on the item's
 * title and text and on each linked document's label. "Unsealed" is public.
 */
export function restrictedReason(...texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    const cleaned = text.replace(/\bunseal(?:ed|ing|s)?\b/gi, "");
    if (SEALED.test(cleaned)) return "sealed material referenced";
    if (JUVENILE.test(cleaned)) return "juvenile proceeding";
  }
  return null;
}
