import type { CaseReference } from "./extract";

export type AgencyKind = "doj" | "sec" | "ftc" | "state_ag" | "settlement_admin";

export interface AgencySourceDefinition {
  code: string;
  name: string;
  agencyKind: AgencyKind;
  jurisdiction: string | null;
  /** Shown as the attribution line, e.g. "U.S. Department of Justice". */
  publisher: string;
  homeUrl: string;
  feedUrl: string | null;
  enabled: boolean;
  /** Why a source is registered but not polled (no public index, blocks our User-Agent). */
  disabledReason?: string;
}

export interface ItemDocument { url: string; label: string; kind: string }
export interface KeyDate { label: string; date: string }

export interface AgencyItem {
  sourceCode: string;
  sourceRecordId: string;
  sourceUrl: string;
  title: string;
  itemKind: string;
  issuingOffice: string | null;
  publishedAt: string | null;
  /** Official text excerpt; null for privately written pages (settlement administrators). */
  officialExcerpt: string | null;
  documents: ItemDocument[];
  keyDates: KeyDate[];
  settlementAmount: string | null;
  references: CaseReference[];
  /** The item is not about a federal court case at all (e.g. an SEC administrative proceeding). */
  notCourt?: boolean;
  restrictedReason: string | null;
  /** Source-side version marker (e.g. FTC "Last Updated"); a change re-reads a known item. */
  changeKey?: string | null;
  /** District courts the item names even when it states no docket number (review queue context). */
  statedCourts?: string[];
  /** Full text the item was read from, used only to confirm a matched caption names a party it mentions (not stored). */
  matchText?: string;
}

const DOCUMENT_KINDS: Array<[RegExp, string]> = [
  [/plea agreement/i, "plea_agreement"],
  [/(?:superseding )?indictment/i, "indictment"],
  [/(?:criminal )?complaint/i, "complaint"],
  [/\binformation\b/i, "information"],
  [/consent decree/i, "consent_decree"],
  [/settlement agreement|\bsettlement\b/i, "settlement"],
  [/(?:final |default )?judgment/i, "judgment"],
  [/\bmemorandum\b|\bmotion\b|\bbrief\b/i, "motion"],
  [/(?:stipulated |proposed )?order\b/i, "order"],
  [/\bnotice\b/i, "notice"],
];

/**
 * A document's kind from its own label only, by whichever term comes first:
 * "Complaint for Permanent Injunction" → complaint, "Memorandum in Support of ... Motion" → motion,
 * "Stipulated Order for Permanent Injunction and Monetary Judgment" → order.
 */
export function documentKind(label: string, url = ""): string {
  const text = `${label} ${decodeURIComponent(url.split("/").at(-1) ?? "")}`;
  let best: { index: number; kind: string } | null = null;
  for (const [pattern, kind] of DOCUMENT_KINDS) {
    const match = pattern.exec(text);
    if (match && (!best || match.index < best.index)) best = { index: match.index, kind };
  }
  return best?.kind ?? "document";
}
