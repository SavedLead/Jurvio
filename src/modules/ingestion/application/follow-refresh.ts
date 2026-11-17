import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { calendarDateInZone } from "@/lib/time/calendar-date";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { normalizeDocketNumber } from "../domain/direct-court";
import { fetchDocket, CourtListenerNotModified } from "../providers/courtlistener/client";
import { appellateRssUrl, APPELLATE_RSS_COURTS, parseAppellateRss } from "../providers/appellate/pacer-rss";
import { fetchCmecfRss } from "../providers/courts/cmecf-rss";
import { courtSourceFromRow, type DirectRegistryRow } from "./direct-court-rotation";
import { ingestCourtListenerDocketEntries } from "./ingest-courtlistener-docket-entries";
import { ingestOfficialScotusDockets } from "./ingest-official-scotus-dockets";
import type { ArtifactStore } from "./artifact-store";

type Sql = ReturnType<typeof postgres>;

/** Leave headroom under the documented 125-request CourtListener day. */
export const FOLLOW_CL_DAILY_BUDGET = 80;

export function signalHasNewFiling(input: {
  dateModified: string | null;
  dateLastFiling: string | null;
  storedModified: string | null;
  storedLastFiling: string | null;
}): boolean {
  const modified = input.dateModified ? Date.parse(input.dateModified) : NaN;
  const storedModified = input.storedModified ? Date.parse(input.storedModified) : NaN;
  if (Number.isFinite(modified) && (!Number.isFinite(storedModified) || modified > storedModified)) return true;
  const filing = input.dateLastFiling?.slice(0, 10) ?? "";
  const storedFiling = input.storedLastFiling?.slice(0, 10) ?? "";
  return Boolean(filing) && filing > storedFiling;
}

/** Unchanged signal is one call. A missing line is a second call. A free hit is none. */
export function courtListenerCallsForFollow(input: { freeFilled: boolean; changed: boolean; quotaRemaining: number }): 0 | 1 | 2 {
  if (input.freeFilled || input.quotaRemaining < 1) return 0;
  if (!input.changed) return 1;
  return input.quotaRemaining >= 2 ? 2 : 1;
}

export async function takeFollowQuota(sql: Sql, calls: number): Promise<boolean> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const stream = `courtlistener:follow-quota:${day}`;
  const [row] = await sql<{ n: number }[]>`
    INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
    SELECT id, ${stream}, ${String(calls)} FROM provider WHERE code = 'courtlistener'
    ON CONFLICT (provider_id, stream_name) DO UPDATE
      SET cursor_value = (ingestion_checkpoint.cursor_value::int + ${calls})::text, updated_at = now()
      WHERE ingestion_checkpoint.cursor_value::int + ${calls} <= ${FOLLOW_CL_DAILY_BUDGET}
    RETURNING cursor_value::int AS n
  `;
  return Boolean(row);
}

async function storeFreeLine(sql: Sql, input: {
  caseId: string;
  providerCode: string;
  entryId: string;
  filedOn: string | null;
  description: string;
  alert: boolean;
}): Promise<void> {
  if (isRestrictedDocketText(input.description)) return;
  const createdAt = input.alert ? null : input.filedOn;
  await sql`
    INSERT INTO docket_entry (
      public_id, case_id, provider_id, provider_entry_id, filed_on, description, created_at, updated_at
    )
    SELECT ${createPublicId("docketEntry")}, ${input.caseId}, provider.id, ${input.entryId},
      ${input.filedOn}::date, ${input.description.slice(0, 2000)},
      COALESCE(${createdAt}::timestamptz, now()), COALESCE(${createdAt}::timestamptz, now())
    FROM provider
    WHERE provider.code = ${input.providerCode}
    ON CONFLICT (provider_id, provider_entry_id) DO NOTHING
  `;
}

function sameDocket(left: string, right: string): boolean {
  return normalizeDocketNumber(left).toLowerCase().replace(/[^a-z0-9]/g, "")
    === normalizeDocketNumber(right).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function freeRssHasNewer(sql: Sql, input: {
  caseId: string;
  courtCode: string;
  docketNumber: string;
  storedLastFiling: string | null;
}): Promise<boolean> {
  const stored = input.storedLastFiling?.slice(0, 10) ?? "";
  const code = input.courtCode.toLowerCase();
  const lines: Array<{ entryId: string; filedOn: string | null; description: string }> = [];
  if ((APPELLATE_RSS_COURTS as readonly string[]).includes(code)) {
    const response = await fetch(appellateRssUrl(code), { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return false;
    for (const item of parseAppellateRss(await response.text(), code)) {
      if (!sameDocket(item.docketNumber, input.docketNumber)) continue;
      lines.push({
        entryId: `appellate-rss:${code}:${item.entryKey}`,
        filedOn: item.filedOn,
        description: item.entryText || item.caption,
      });
    }
  } else {
    const [registry] = await sql<DirectRegistryRow[]>`
      SELECT court_code, court_name, jurvio_court_code, court_type::text, circuit, official_website,
        cmecf_base_url, rss_url, rss_coverage_hours, included_event_categories, pacer_court_id, time_zone, polling_minutes
      FROM direct_court_registry
      WHERE lower(court_code) = ${code} OR lower(jurvio_court_code) = ${code}
      LIMIT 1
    `;
    if (!registry?.rss_url) return false;
    const court = courtSourceFromRow({ ...registry, court_type: registry.court_type as DirectRegistryRow["court_type"] });
    const feed = await Promise.race([
      fetchCmecfRss(court),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("court rss timed out")), 8_000)),
    ]);
    for (const event of feed.events) {
      if (!sameDocket(event.docketNumber, input.docketNumber) || event.restricted) continue;
      lines.push({
        entryId: `cmecf-rss:${event.deduplicationKey}`,
        filedOn: calendarDateInZone(event.filedAt, court.timeZone),
        description: event.exactText,
      });
    }
  }
  const newest = lines.map((line) => line.filedOn).filter((day): day is string => Boolean(day)).sort().at(-1) ?? null;
  if (!newest || (stored && newest <= stored)) return false;
  for (const line of lines) {
    const alert = line.filedOn != null && (stored ? line.filedOn > stored : line.filedOn === newest);
    await storeFreeLine(sql, {
      caseId: input.caseId,
      providerCode: "official_cmecf",
      entryId: line.entryId,
      filedOn: line.filedOn,
      description: line.description,
      alert,
    });
  }
  return true;
}

export interface FollowRefreshResult {
  outcome: "refreshed" | "not_modified" | "skipped" | "quota";
  courtListenerCalls: number;
  freeFilled: boolean;
  elapsedMs: number;
}

/** Free court sources, then one CourtListener signal, then one entry page only if the signal is newer. */
export async function refreshFollowedCase(
  sql: Sql,
  artifactStore: ArtifactStore,
  caseId: string,
): Promise<FollowRefreshResult> {
  const started = Date.now();
  const [row] = await sql<{
    docketNumber: string | null;
    courtCode: string | null;
    clId: string | null;
    sourceUpdatedAt: string | null;
    etag: string | null;
    lastModified: string | null;
    maxFiledOn: string | null;
  }[]>`
    SELECT c.docket_number AS "docketNumber", lower(court.provider_court_id) AS "courtCode",
      (SELECT identifier.identifier_value FROM case_identifier identifier
        WHERE identifier.case_id = c.id AND identifier.identifier_type = 'courtlistener_docket_id'
        LIMIT 1) AS "clId",
      c.source_updated_at::text AS "sourceUpdatedAt",
      c.source_http_etag AS "etag",
      c.source_http_last_modified AS "lastModified",
      (SELECT max(entry.filed_on)::text FROM docket_entry entry WHERE entry.case_id = c.id) AS "maxFiledOn"
    FROM legal_case c
    JOIN court ON court.id = c.court_id
    WHERE c.id = ${caseId}
  `;
  if (!row?.docketNumber || !row.courtCode) {
    return { outcome: "skipped", courtListenerCalls: 0, freeFilled: false, elapsedMs: Date.now() - started };
  }
  if (row.courtCode === "scotus") {
    await ingestOfficialScotusDockets(sql, artifactStore, { limit: 1, caseId, skipPdfs: true });
    return { outcome: "refreshed", courtListenerCalls: 0, freeFilled: true, elapsedMs: Date.now() - started };
  }
  let freeFilled = false;
  try {
    freeFilled = await freeRssHasNewer(sql, {
      caseId,
      courtCode: row.courtCode,
      docketNumber: row.docketNumber,
      storedLastFiling: row.maxFiledOn,
    });
  } catch {
    freeFilled = false;
  }
  if (freeFilled) {
    return { outcome: "refreshed", courtListenerCalls: 0, freeFilled: true, elapsedMs: Date.now() - started };
  }
  const docketId = Number(row.clId);
  if (!Number.isInteger(docketId) || docketId <= 0) {
    return { outcome: "skipped", courtListenerCalls: 0, freeFilled: false, elapsedMs: Date.now() - started };
  }
  if (!await takeFollowQuota(sql, 1)) {
    return { outcome: "quota", courtListenerCalls: 0, freeFilled: false, elapsedMs: Date.now() - started };
  }
  let changed = true;
  try {
    const retrieved = await fetchDocket(docketId, { etag: row.etag, lastModified: row.lastModified });
    changed = signalHasNewFiling({
      dateModified: retrieved.record.date_modified,
      dateLastFiling: retrieved.record.date_last_filing ?? null,
      storedModified: row.sourceUpdatedAt,
      storedLastFiling: row.maxFiledOn,
    });
    await sql`
      UPDATE legal_case SET
        source_updated_at = ${retrieved.record.date_modified}::timestamptz,
        last_fetched_at = now(),
        source_http_etag = COALESCE(${retrieved.responseMetadata.etag ?? null}, source_http_etag),
        source_http_last_modified = COALESCE(${retrieved.responseMetadata.lastModified ?? null}, source_http_last_modified)
      WHERE id = ${caseId}
    `;
  } catch (error) {
    if (error instanceof CourtListenerNotModified) {
      return { outcome: "not_modified", courtListenerCalls: 1, freeFilled: false, elapsedMs: Date.now() - started };
    }
    throw error;
  }
  if (!changed) {
    return { outcome: "not_modified", courtListenerCalls: 1, freeFilled: false, elapsedMs: Date.now() - started };
  }
  if (!await takeFollowQuota(sql, 1)) {
    return { outcome: "quota", courtListenerCalls: 1, freeFilled: false, elapsedMs: Date.now() - started };
  }
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) {
    return { outcome: "skipped", courtListenerCalls: 1, freeFilled: false, elapsedMs: Date.now() - started };
  }
  await ingestCourtListenerDocketEntries(sql, artifactStore, {
    providerId: provider.id,
    caseId,
    docketId,
    maximumPages: 1,
    newestFirst: true,
    stampForFollow: true,
    previousMaxFiledOn: row.maxFiledOn,
  });
  return { outcome: "refreshed", courtListenerCalls: 2, freeFilled: false, elapsedMs: Date.now() - started };
}
