import { createHash } from "node:crypto";

export type DirectEventType =
  | "case_filed" | "complaint_or_petition_filed" | "summons_issued"
  | "service_completed" | "motion_filed" | "response_filed"
  | "hearing_scheduled" | "hearing_held" | "order_entered"
  | "judgment_entered" | "appeal_filed" | "case_transferred"
  | "case_dismissed" | "case_closed" | "filing";

export interface DirectCourtEvent {
  courtCode: string;
  docketNumber: string;
  caption: string;
  officialEventId: string | null;
  documentNumber: string | null;
  filedAt: string;
  exactText: string;
  eventType: DirectEventType;
  visitorDescription: string;
  sourceUrl: string;
  documentUrl: string | null;
  contentHash: string;
  deduplicationKey: string;
  restricted: boolean;
}

const restrictedPattern = /\b(sealed|restricted|under seal|minor|juvenile|grand jury|qui tam)\b/i;

export function normalizeDocketNumber(value: string): string {
  return value
    .trim()
    .replace(/^case\s*(?:no\.?|number)?\s*/i, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/^(\d{1,2}):(\d{2})-([a-z]{2})-(\d{1,7})(?:-[a-z0-9-]+)?$/i,
      (_all, office, year, kind, sequence) =>
        `${Number(office)}:${year}-${String(kind).toLowerCase()}-${String(sequence).padStart(5, "0")}`);
}

export function classifyDirectEvent(text: string): DirectEventType {
  const value = text.toLowerCase();
  if (/\b(judgment entered|final judgment)\b/.test(value)) return "judgment_entered";
  if (/\b(case dismissed|dismissed the case)\b/.test(value)) return "case_dismissed";
  if (/\b(case closed|terminated)\b/.test(value)) return "case_closed";
  if (/\b(notice of appeal|appeal filed)\b/.test(value)) return "appeal_filed";
  if (/\b(transferred|transfer of case)\b/.test(value)) return "case_transferred";
  if (/\b(order|memorandum opinion)\b/.test(value)) return "order_entered";
  if (/\b(hearing|conference|trial)\b.*\b(set|scheduled)\b/.test(value)) return "hearing_scheduled";
  if (/\b(hearing held|minutes of proceeding|proceedings held)\b/.test(value)) return "hearing_held";
  if (/\b(summons issued)\b/.test(value)) return "summons_issued";
  if (/\b(return of service|proof of service|service executed)\b/.test(value)) return "service_completed";
  if (/\b(answer|response|reply|opposition)\b.*\b(filed|to motion)\b/.test(value)) return "response_filed";
  if (/\bmotion\b/.test(value)) return "motion_filed";
  if (/\b(complaint|petition)\b.*\bfiled\b/.test(value)) return "complaint_or_petition_filed";
  if (/\b(case assigned|new case|case opened|initiating document)\b/.test(value)) return "case_filed";
  return "filing";
}

const friendly: Record<DirectEventType, string> = {
  case_filed: "Case filed",
  complaint_or_petition_filed: "Complaint or petition filed",
  summons_issued: "Summons issued",
  service_completed: "Service completed",
  motion_filed: "Motion filed",
  response_filed: "Response filed",
  hearing_scheduled: "Hearing scheduled",
  hearing_held: "Hearing held",
  order_entered: "Order entered",
  judgment_entered: "Judgment entered",
  appeal_filed: "Appeal filed",
  case_transferred: "Case transferred",
  case_dismissed: "Case dismissed",
  case_closed: "Case closed",
  filing: "Court filing added",
};

export function visitorFriendlyDescription(type: DirectEventType): string {
  return friendly[type];
}

export function stableDirectEventIdentity(input: {
  courtCode: string; docketNumber: string; officialEventId: string | null;
  filedAt: string; exactText: string; documentNumber: string | null;
}) {
  const contentHash = createHash("sha256").update(input.exactText.trim()).digest("hex");
  const identity = input.officialEventId?.trim() ||
    [normalizeDocketNumber(input.docketNumber), input.documentNumber ?? "", input.filedAt, contentHash].join("|");
  return {
    contentHash,
    deduplicationKey: createHash("sha256")
      .update(`${input.courtCode.toLowerCase()}|${identity}`).digest("hex"),
  };
}

export function isRestrictedDirectEvent(text: string): boolean {
  return restrictedPattern.test(text);
}

const DISTRICT_DOCKET = /^\d{1,2}:\d{2}-(?:cv|cr|mc|mj|md|bk|ap)-\d{5,7}$/i;
const APPELLATE_DOCKET = /^\d{2}-\d{1,6}$/;

/** Longest gap between polls. A court's own polling_minutes can be shorter. */
export const DIRECT_COURT_MAX_GAP_MINUTES = 30;

/**
 * How long a court may wait. The registry's polling_minutes is the polite
 * rate (5 for every district). Never wait longer than the 30-minute ceiling:
 * the public feeds only keep about 24 hours, and a 2-hour rotation was
 * dropping entries when a run did not reach every court.
 */
export function directCourtGapMinutes(pollingMinutes: number | null | undefined, maxGapMinutes = DIRECT_COURT_MAX_GAP_MINUTES): number {
  const ceiling = Math.max(0, maxGapMinutes);
  const polite = Math.max(2, pollingMinutes ?? ceiling);
  return Math.min(ceiling, polite);
}

export function shouldCreateCase(event: Pick<DirectCourtEvent, "docketNumber" | "caption" | "restricted">): boolean {
  return !event.restricted &&
    DISTRICT_DOCKET.test(event.docketNumber) &&
    event.caption.trim().length >= 3;
}

/** District or appellate docket numbers a feed entry may publish. Sealed text is a separate check. */
export function isPublishableFeedDocket(docketNumber: string): boolean {
  return DISTRICT_DOCKET.test(docketNumber) || APPELLATE_DOCKET.test(docketNumber);
}
