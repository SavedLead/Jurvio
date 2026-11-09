/**
 * One card per recent Supreme Court opinion on /supreme-court.
 * A slip-index row and the published opinion of the same docket and PDF are
 * the same opinion. The case name always points at /case/<id>. The opinion
 * page is a second link, and only when that page can open.
 */
import { publicOpinionType } from "@/modules/cases/domain/public-labels";
import { scotusTermLabel } from "./term";

const CASE_ID = /^jv-[a-z0-9]{8,10}$/;
const DOCUMENT_ID = /^jd-[a-z0-9]{8,10}$/;

export function casePagePath(publicId: string | null | undefined): string | null {
  return publicId && CASE_ID.test(publicId) ? `/case/${publicId}` : null;
}

/** Null when the opinion page would 404 (missing or malformed ids). */
export function opinionPagePath(casePublicId: string | null | undefined, documentPublicId: string | null | undefined): string | null {
  const casePath = casePagePath(casePublicId);
  if (!casePath || !documentPublicId || !DOCUMENT_ID.test(documentPublicId)) return null;
  return `${casePath}/documents/${documentPublicId}`;
}

export function canonicalPdfUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeDocketKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PublishedOpinionCard {
  casePublicId: string;
  documentPublicId: string;
  caseCaption: string;
  docketNumber: string;
  filedOn: string | null;
  sourceDownloadUrl: string | null;
  wordCount: number;
  opinionType: string | null;
  perCuriam: boolean;
  authorName: string | null;
  precedentialStatus: string | null;
}

export interface SlipOpinionCard {
  sourceRecordId: string;
  filedOn: string;
  docketNumber: string;
  caseName: string;
  pdfUrl: string;
  casePublicId: string | null;
  documentPublicId: string | null;
}

export interface RecentOpinionCard {
  key: string;
  filedOn: string | null;
  docketNumber: string;
  caseName: string;
  /** /case/<id>, or null when Jurvio has no published case. Never a 404. */
  casePath: string | null;
  /** /case/<id>/documents/<id>, or null when that page would not open. */
  documentPath: string | null;
  pdfUrl: string | null;
  termLabel: string | null;
  wordCount: number;
  tags: string[];
}

function sameOpinion(left: { docketNumber: string; pdfUrl: string | null }, right: { docketNumber: string; pdfUrl: string | null }): boolean {
  const leftPdf = canonicalPdfUrl(left.pdfUrl);
  const rightPdf = canonicalPdfUrl(right.pdfUrl);
  if (leftPdf && rightPdf && leftPdf === rightPdf) return true;
  const leftDocket = normalizeDocketKey(left.docketNumber);
  const rightDocket = normalizeDocketKey(right.docketNumber);
  if (!leftDocket || leftDocket !== rightDocket) return false;
  // Same docket, and at least one side has no distinct PDF: one opinion listed twice.
  return !leftPdf || !rightPdf || leftPdf === rightPdf;
}

/**
 * Published opinions first. A slip row is kept only when it is a different
 * docket-and-PDF pair, and it links inward only when a published case exists.
 */
export function mergeRecentOpinions(published: readonly PublishedOpinionCard[], slips: readonly SlipOpinionCard[]): RecentOpinionCard[] {
  const cards: RecentOpinionCard[] = published.map((opinion) => ({
    key: `case:${opinion.documentPublicId}`,
    filedOn: opinion.filedOn,
    docketNumber: opinion.docketNumber,
    caseName: opinion.caseCaption,
    casePath: casePagePath(opinion.casePublicId),
    documentPath: opinionPagePath(opinion.casePublicId, opinion.documentPublicId),
    pdfUrl: opinion.sourceDownloadUrl?.startsWith("https://") ? opinion.sourceDownloadUrl : null,
    termLabel: scotusTermLabel(opinion.filedOn),
    wordCount: opinion.wordCount,
    tags: [publicOpinionType(opinion.opinionType), opinion.perCuriam ? "Per curiam" : null, opinion.authorName, opinion.precedentialStatus].filter((tag): tag is string => Boolean(tag)),
  }));
  for (const slip of slips) {
    const candidate = { docketNumber: slip.docketNumber, pdfUrl: slip.pdfUrl };
    if (cards.some((card) => sameOpinion(card, candidate))) continue;
    const casePath = casePagePath(slip.casePublicId);
    cards.push({
      key: `slip:${slip.sourceRecordId}`,
      filedOn: slip.filedOn,
      docketNumber: slip.docketNumber,
      caseName: slip.caseName,
      casePath,
      documentPath: opinionPagePath(slip.casePublicId, slip.documentPublicId),
      pdfUrl: slip.pdfUrl.startsWith("https://") ? slip.pdfUrl : null,
      termLabel: scotusTermLabel(slip.filedOn),
      wordCount: 0,
      tags: ["Slip opinion"],
    });
  }
  return cards;
}
