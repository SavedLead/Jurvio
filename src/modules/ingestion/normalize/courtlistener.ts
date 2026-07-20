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

export function normalizeCourtListenerDocket(
  source: CourtListenerDocket,
): NormalizedCourtListenerCase {
  const caption =
    present(source.case_name_full) ??
    present(source.case_name) ??
    present(source.case_name_short) ??
    "Caption unavailable";

  return {
    sourceCaseId: String(source.id),
    sourceCourtUri: source.court,
    sourceUri: source.absolute_url,
    docketNumber: present(source.docket_number) ?? present(source.docket_number_core) ?? "Unknown",
    caption,
    shortCaption: present(source.case_name_short),
    filedOn: dateOnly(source.date_filed),
    terminatedOn: dateOnly(source.date_terminated),
    sourceUpdatedAt: new Date(source.date_modified).toISOString(),
    natureOfSuit: present(source.nature_of_suit),
    causeOfAction: present(source.cause),
    assignedJudge: present(source.assigned_to_str),
    referredJudge: present(source.referred_to_str),
  };
}
