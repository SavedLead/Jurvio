import type { ItemDocument } from "./item";

export interface AgencyTimelineEvent {
  date: string;
  label: string;
}

interface AgencyTimelineSource {
  publisher: string;
  documents: ItemDocument[];
}

const DATED_LABEL = /^(\d{4}-\d{2}-\d{2}):\s+(.+)$/;

/**
 * Dated filings from official agency items linked to a case (FTC case pages list
 * each filing as "2026-10-13: Plaintiffs' Motion ..."). These feed the case
 * timeline and "What happened most recently?" so an agency-backed case never says
 * "No dated docket event" while listing dated filings further down the page.
 * Only the same documents the agency card shows (first 8 per item) are used.
 */
export function agencyTimelineEvents(items: AgencyTimelineSource[]): AgencyTimelineEvent[] {
  const events: AgencyTimelineEvent[] = [];
  for (const item of items) {
    for (const document of item.documents.slice(0, 8)) {
      const match = DATED_LABEL.exec(document.label.trim());
      if (!match?.[1] || !match[2] || Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`))) continue;
      events.push({ date: match[1], label: `${match[2].trim()} (per ${item.publisher})` });
    }
  }
  return events;
}
