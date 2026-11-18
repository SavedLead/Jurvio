import { createHash } from "node:crypto";
import os from "node:os";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { getFederalCourtEntry } from "../domain/federal-court-registry";
import { normalizeDocketKey, isEasternQuietWindow, rowsPerHour, shouldPauseForLoad } from "./bulk-docket-load";
import { checkBulkDiskFloor } from "./bulk-disk-floor";
import { readBulkDockets, type CourtListenerBulkDocket } from "../providers/courtlistener/bulk-dockets";

type Sql = ReturnType<typeof postgres>;

export type FilingFamily = "appeals" | "district";

export const FILING_BACKFILL_BUDGET_MS = 90 * 60_000;

export function filingBackfillStreamName(family: FilingFamily, windowDays: number, snapshotDate: string): string {
  return `courtlistener:filing-backfill:v1:${family}:${windowDays}:${snapshotDate}`;
}

export function bulkDocketFileUrl(snapshotDate: string): string {
  return `https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/dockets-${snapshotDate}.csv.bz2`;
}

/** Appeals circuits and district courts only. Bankruptcy and the Supreme Court stay out. */
export function filingFamilyForCourt(courtId: string): FilingFamily | null {
  const entry = getFederalCourtEntry(courtId);
  if (!entry || entry.category !== "current" || entry.status !== "active") return null;
  if (entry.courtClass === "court_of_appeals") return "appeals";
  if (entry.courtClass === "district") return "district";
  return null;
}

export function filingDateInWindow(filedOn: string | null | undefined, today: string, windowDays: number): boolean {
  if (!filedOn || !/^\d{4}-\d{2}-\d{2}/.test(filedOn)) return false;
  const day = filedOn.slice(0, 10);
  if (day >= today) return false;
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startDay = start.toISOString().slice(0, 10);
  return day >= startDay;
}

interface BackfillRow {
  courtCode: string;
  docketNumber: string;
  caption: string;
  filedOn: string;
  publicId: string;
  family: FilingFamily;
}

export function selectBackfillRow(
  docket: CourtListenerBulkDocket,
  family: FilingFamily,
  today: string,
  windowDays: number,
): BackfillRow | null {
  const rowFamily = filingFamilyForCourt(docket.court_id);
  if (rowFamily !== family) return null;
  const filedOn = docket.date_filed?.slice(0, 10) ?? null;
  if (!filingDateInWindow(filedOn, today, windowDays)) return null;
  const docketNumber = docket.docket_number.trim();
  const caption = (docket.case_name_full || docket.case_name || "").trim();
  if (docketNumber.length < 2 || caption.length < 3) return null;
  if (isRestrictedDocketText(`${caption} ${docketNumber}`)) return null;
  if (!normalizeDocketKey(docketNumber)) return null;
  return {
    courtCode: docket.court_id.toLowerCase(),
    docketNumber,
    caption: caption.slice(0, 500),
    filedOn: filedOn!,
    publicId: createPublicId("case"),
    family,
  };
}

export interface FilingBackfillCheckpoint {
  version: 1;
  snapshotDate: string;
  family: FilingFamily;
  windowDays: number;
  rowsConsumed: number;
  matched: number;
  inserted: number;
  filledDate: number;
  /** Candidates that were already stored with a filing date. */
  alreadyPresent: number;
  /** Candidates whose court row could not be resolved. */
  noCourt: number;
  skipped: number;
  stopped: string | null;
}

export function emptyFilingCheckpoint(snapshotDate: string, family: FilingFamily, windowDays: number): FilingBackfillCheckpoint {
  return {
    version: 1, snapshotDate, family, windowDays, rowsConsumed: 0,
    matched: 0, inserted: 0, filledDate: 0, alreadyPresent: 0, noCourt: 0, skipped: 0, stopped: null,
  };
}

export function decodeFilingCheckpoint(
  value: string | null,
  snapshotDate: string,
  family: FilingFamily,
  windowDays: number,
): FilingBackfillCheckpoint {
  const base = emptyFilingCheckpoint(snapshotDate, family, windowDays);
  if (!value) return base;
  const parsed = JSON.parse(value) as Partial<FilingBackfillCheckpoint>;
  if (parsed.version !== 1 || parsed.snapshotDate !== snapshotDate || parsed.family !== family || parsed.windowDays !== windowDays) {
    return base;
  }
  return { ...base, ...parsed, stopped: parsed.stopped === "complete" ? "complete" : null };
}

export function filingWriteCounts(input: { incoming: number; joined: number; inserted: number; filledDate: number }): {
  inserted: number;
  filledDate: number;
  alreadyPresent: number;
  noCourt: number;
} {
  return {
    inserted: input.inserted,
    filledDate: input.filledDate,
    alreadyPresent: Math.max(0, input.joined - input.inserted - input.filledDate),
    noCourt: Math.max(0, input.incoming - input.joined),
  };
}

/**
 * A high load average is this scan decompressing the snapshot. It is not a
 * reason to abandon the window. Disk, the quiet window, and the night budget
 * still stop the run, and the checkpoint is what the next dispatch resumes.
 */
export function filingBackfillStop(input: {
  allowAnytime: boolean;
  elapsedMs: number;
  budgetMs: number;
  outsideQuietWindow: boolean;
  diskOk: boolean;
}): "quiet-window" | "disk" | "budget" | null {
  if (!input.allowAnytime && input.outsideQuietWindow) return "quiet-window";
  if (!input.diskOk) return "disk";
  if (!input.allowAnytime && input.elapsedMs >= input.budgetMs) return "budget";
  return null;
}

/** 75 asks the workflow to start the same command again from the checkpoint. */
export function filingBackfillExitCode(stopped: string | null): 0 | 1 | 75 {
  if (stopped === "budget" || stopped === "pace") return 75;
  if (!stopped || stopped === "complete" || stopped === "quiet-window" || stopped === "quota") return 0;
  return 1;
}

export async function persistFilingRows(sql: Sql, providerId: string, rows: BackfillRow[]): Promise<{
  inserted: number; filledDate: number; alreadyPresent: number; noCourt: number;
}> {
  if (rows.length === 0) return { inserted: 0, filledDate: 0, alreadyPresent: 0, noCourt: 0 };
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '30s', true)`;
    const payload = rows.map((row) => ({
      public_id: row.publicId,
      court_code: row.courtCode,
      docket_number: row.docketNumber,
      caption: row.caption,
      filed_on: row.filedOn,
      family: row.family,
      court_public_id: createPublicId("court"),
    }));
    await tx`
      INSERT INTO court (public_id, provider_id, provider_court_id, name, short_name, jurisdiction, verification)
      SELECT DISTINCT ON (row.court_code)
        row.court_public_id, ${providerId}, row.court_code, row.court_code, upper(row.court_code),
        CASE WHEN row.family = 'appeals' THEN 'Federal Appellate' ELSE 'Federal District' END,
        'verified'
      FROM jsonb_to_recordset(${tx.json(payload)}::jsonb)
        AS row(court_code text, family text, court_public_id text)
      ORDER BY row.court_code
      ON CONFLICT (provider_id, provider_court_id) DO NOTHING
    `;
    const [counts] = await tx<{ incoming: number; joined: number; inserted: number; filled: number }[]>`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${tx.json(payload)}::jsonb)
          AS row(public_id text, court_code text, docket_number text, caption text, filed_on text)
      ),
      written AS (
        INSERT INTO legal_case (
          public_id, court_id, docket_number, caption, filed_on,
          verification, publication, source_updated_at, created_at, updated_at
        )
        SELECT row.public_id, court.id, row.docket_number, row.caption, row.filed_on::date,
          'verified', 'draft', row.filed_on::timestamptz, row.filed_on::timestamptz, row.filed_on::timestamptz
        FROM incoming row
        JOIN court ON court.provider_id = ${providerId} AND court.provider_court_id = row.court_code
        ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
        DO UPDATE SET
          filed_on = COALESCE(legal_case.filed_on, EXCLUDED.filed_on),
          updated_at = legal_case.updated_at
        WHERE legal_case.filed_on IS NULL AND EXCLUDED.filed_on IS NOT NULL
        RETURNING (xmax = 0) AS inserted
      )
      SELECT
        (SELECT count(*)::int FROM incoming) AS incoming,
        (SELECT count(*)::int FROM incoming row
          JOIN court ON court.provider_id = ${providerId} AND court.provider_court_id = row.court_code) AS joined,
        (SELECT count(*) FILTER (WHERE inserted)::int FROM written) AS inserted,
        (SELECT count(*) FILTER (WHERE NOT inserted)::int FROM written) AS filled
    `;
    return filingWriteCounts({
      incoming: counts?.incoming ?? 0,
      joined: counts?.joined ?? 0,
      inserted: counts?.inserted ?? 0,
      filledDate: counts?.filled ?? 0,
    });
  });
}

export interface FilingBackfillOptions {
  sql: Sql;
  filePath: string;
  snapshotDate: string;
  family: FilingFamily;
  windowDays: number;
  today: string;
  budgetMs?: number;
  allowAnytime?: boolean;
  diskPath?: string;
  log?: (event: Record<string, unknown>) => void;
}

export async function backfillFilingWindow(options: FilingBackfillOptions): Promise<FilingBackfillCheckpoint> {
  const budgetMs = options.budgetMs ?? FILING_BACKFILL_BUDGET_MS;
  const log = options.log ?? (() => undefined);
  const started = Date.now();
  const [provider] = await options.sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) throw new Error("courtlistener provider is missing");
  const streamName = filingBackfillStreamName(options.family, options.windowDays, options.snapshotDate);
  const [stored] = await options.sql<{ cursor_value: string }[]>`
    SELECT checkpoint.cursor_value
    FROM ingestion_checkpoint checkpoint
    JOIN provider ON provider.id = checkpoint.provider_id
    WHERE provider.code = 'courtlistener' AND checkpoint.stream_name = ${streamName}
  `;
  const checkpoint = decodeFilingCheckpoint(stored?.cursor_value ?? null, options.snapshotDate, options.family, options.windowDays);
  if (checkpoint.stopped === "complete") return checkpoint;
  let seen = 0;
  let yieldedForLoad = false;
  let batch: BackfillRow[] = [];
  const flush = async () => {
    const result = await persistFilingRows(options.sql, provider.id, batch);
    checkpoint.inserted += result.inserted;
    checkpoint.filledDate += result.filledDate;
    checkpoint.alreadyPresent += result.alreadyPresent;
    checkpoint.noCourt += result.noCourt;
    checkpoint.matched += batch.length;
    batch = [];
  };
  const save = async (stopped: string | null) => {
    checkpoint.stopped = stopped;
    const value = JSON.stringify(checkpoint);
    await options.sql`
      INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
      VALUES (${provider.id}, ${streamName}, ${value})
      ON CONFLICT (provider_id, stream_name)
      DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
    `;
  };
  for await (const docket of readBulkDockets(options.filePath)) {
    seen += 1;
    if (seen <= checkpoint.rowsConsumed) continue;
    checkpoint.rowsConsumed = seen;
    const row = selectBackfillRow(docket, options.family, options.today, options.windowDays);
    if (!row) checkpoint.skipped += 1;
    else batch.push(row);
    const elapsed = Date.now() - started;
    if (batch.length >= 200) await flush();
    if (seen % 20_000 === 0) {
      await flush();
      await save(null);
      log({
        rows: seen,
        inserted: checkpoint.inserted,
        alreadyPresent: checkpoint.alreadyPresent,
        perHour: rowsPerHour(seen, elapsed),
      });
      const floor = await checkBulkDiskFloor(options.diskPath ?? "/");
      const stop = filingBackfillStop({
        allowAnytime: options.allowAnytime === true,
        elapsedMs: elapsed,
        budgetMs,
        outsideQuietWindow: !isEasternQuietWindow(new Date()),
        diskOk: floor.ok,
      });
      if (stop) {
        checkpoint.stopped = stop;
        await save(checkpoint.stopped);
        return checkpoint;
      }
      if (!yieldedForLoad && shouldPauseForLoad({ loadAverage: os.loadavg()[0] ?? 0, cpuCount: os.cpus().length, slowPublicQueries: 0 })) {
        yieldedForLoad = true;
        log({ pace: "yielding", load: os.loadavg()[0] ?? 0 });
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    }
  }
  await flush();
  checkpoint.stopped = "complete";
  await save(checkpoint.stopped);
  log({ rows: seen, inserted: checkpoint.inserted, stopped: "complete" });
  return checkpoint;
}

export function filingContentHash(snapshotDate: string, docketId: string): string {
  return createHash("sha256").update(`${snapshotDate}:${docketId}`).digest("hex");
}
