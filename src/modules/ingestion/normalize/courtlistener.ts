import type { CourtListenerDocket } from "../providers/courtlistener/schema";

export interface NormalizedCourtListenerCase {
  sourceCaseId: string;
  sourceCourtUri: string;
  sourceUri: string;
  docketNumber: string;
  caption: string;
  shortCaption?: string;
  filedOn?: string;
  terminatedOn?: string;
  sourceUpdatedAt: string;
  natureOfSuit?: string;
  causeOfAction?: string;
  assignedJudge?: string;
  referredJudge?: string;
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function required(value: string | null | undefined, field: string): string {
  const normalized = present(value);
  if (!normalized) throw new Error(`CourtListener docket is missing required field: ${field}`);
  return normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`CourtListener docket has invalid timestamp: ${field}`);
  }
  return parsed.toISOString();
}

export function normalizeCourtListenerDocket(
  source: CourtListenerDocket,
): NormalizedCourtListenerCase {
  const caption =
    present(source.case_name_full) ??
    present(source.case_name) ??
    present(source.case_name_short);

  if (!caption) throw new Error("CourtListener docket is missing a usable caption");

  return {
    sourceCaseId: String(source.id),
    sourceCourtUri: required(source.court, "court"),
    sourceUri: required(source.absolute_url, "absolute_url"),
    docketNumber: required(
      present(source.docket_number) ?? present(source.docket_number_core),
      "docket_number",
    ),
    caption,
    shortCaption: present(source.case_name_short),
    filedOn: dateOnly(source.date_filed),
    terminatedOn: dateOnly(source.date_terminated),
    sourceUpdatedAt: timestamp(source.date_modified, "date_modified"),
    natureOfSuit: present(source.nature_of_suit),
    causeOfAction: present(source.cause),
    assignedJudge: present(source.assigned_to_str),
    referredJudge: present(source.referred_to_str),
  };
}
