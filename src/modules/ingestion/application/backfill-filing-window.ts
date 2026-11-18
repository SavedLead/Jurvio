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
/** A kill resumes at the last multiple of this many rows, not at the start of the file. */
export const FILING_CHECKPOINT_ROWS = 500_000;
/** Leave the host before the kernel OOM killer sends SIGKILL. */
export const FILING_RSS_LIMIT_BYTES = 768 * 1024 * 1024;
/** Docket columns this scan keeps. A longer cell is not retained. */
export const FILING_MAX_FIELD_CHARS = 8_000;

export function filingBackfillStreamName(family: FilingFamily, windowDays: number, snapshotDate: string): string {
  return `courtlistener:filing-backfill:v1:${family}:${windowDays}:${snapshotDate}`;
}

/** Separate from the insert scan, so a finished backfill can be read again to fill empty draft fields. */
export function filingFillStreamName(family: FilingFamily, windowDays: number, snapshotDate: string): string {
  return `courtlistener:filing-draft-fill:v1:${family}:${windowDays}:${snapshotDate}`;
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
  natureOfSuit: string | null;
  causeOfAction: string | null;
  publicId: string;
  family: FilingFamily;
}

/** The partial unique index is (court_id, docket_number). court_code resolves to one court. */
export interface FilingConflictRow {
  courtCode: string;
  docketNumber: string;
  caption: string;
  filedOn: string;
  natureOfSuit: string | null;
  causeOfAction: string | null;
}

function filingText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function preferText(kept: string | null, incoming: string | null): string | null {
  const left = kept?.trim() || null;
  const right = incoming?.trim() || null;
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

/**
 * One INSERT cannot propose the same conflict key twice. Keep the longer caption
 * and the earlier filing date when the snapshot lists a case more than once.
 */
export function dedupeFilingRows<T extends FilingConflictRow>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.courtCode}\0${row.docketNumber}`;
    const kept = byKey.get(key);
    byKey.set(key, kept ? mergeFilingRow(kept, row) : row);
  }
  return [...byKey.values()];
}

function filingDay(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function mergeFilingRow<T extends FilingConflictRow>(kept: T, incoming: T): T {
  const keptDay = filingDay(kept.filedOn);
  const incomingDay = filingDay(incoming.filedOn);
  const filedOn = !keptDay ? (incomingDay ?? kept.filedOn)
    : !incomingDay ? keptDay
    : keptDay <= incomingDay ? keptDay : incomingDay;
  const caption = incoming.caption.trim().length > kept.caption.trim().length ? incoming.caption : kept.caption;
  return {
    ...kept,
    caption,
    filedOn,
    natureOfSuit: preferText(kept.natureOfSuit, incoming.natureOfSuit),
    causeOfAction: preferText(kept.causeOfAction, incoming.causeOfAction),
  };
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
    // assigned_to_str is a free-text name. Judge links require an eligible
    // term and a unique roster match, which this scan does not do.
    natureOfSuit: filingText(docket.nature_of_suit),
    causeOfAction: filingText(docket.cause),
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
  /** Drafts whose empty nature of suit or cause was copied from the snapshot. */
  fieldsFilled: number;
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
    matched: 0, inserted: 0, filledDate: 0, fieldsFilled: 0, alreadyPresent: 0, noCourt: 0, skipped: 0, stopped: null,
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
  return {
    ...base,
    ...parsed,
    fieldsFilled: parsed.fieldsFilled ?? 0,
    stopped: parsed.stopped === "complete" ? "complete" : null,
  };
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
  if (stopped === "budget" || stopped === "pace" || stopped === "memory") return 75;
  if (!stopped || stopped === "complete" || stopped === "quiet-window" || stopped === "quota") return 0;
  return 1;
}

export async function persistFilingRows(
  sql: Sql,
  providerId: string,
  rows: BackfillRow[],
  options?: { fillDrafts?: boolean },
): Promise<{
  inserted: number; filledDate: number; alreadyPresent: number; noCourt: number; fieldsFilled: number;
}> {
  const fillDrafts = options?.fillDrafts === true;
  const unique = dedupeFilingRows(rows);
  if (unique.length === 0) return { inserted: 0, filledDate: 0, alreadyPresent: 0, noCourt: 0, fieldsFilled: 0 };
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '30s', true)`;
    const payload = unique.map((row) => ({
      public_id: row.publicId,
      court_code: row.courtCode,
      docket_number: row.docketNumber,
      caption: row.caption,
      filed_on: row.filedOn,
      nature_of_suit: row.natureOfSuit,
      cause: row.causeOfAction,
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
    const [counts] = await tx<{
      incoming: number; joined: number; inserted: number; filled: number; fields_filled: number;
    }[]>`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${tx.json(payload)}::jsonb)
          AS row(public_id text, court_code text, docket_number text, caption text, filed_on text, nature_of_suit text, cause text)
      ),
      joined AS (
        SELECT row.public_id, row.docket_number, row.caption, row.filed_on,
          NULLIF(btrim(row.nature_of_suit), '') AS nature_of_suit,
          NULLIF(btrim(row.cause), '') AS cause,
          court.id AS court_id
        FROM incoming row
        JOIN court ON court.provider_id = ${providerId} AND court.provider_court_id = row.court_code
      ),
      targets AS (
        SELECT joined.*, legal_case.id AS case_id,
          (legal_case.filed_on IS NULL AND joined.filed_on IS NOT NULL) AS filling_date,
          (
            (legal_case.nature_of_suit_code IS NULL AND joined.nature_of_suit IS NOT NULL)
            OR (legal_case.cause_of_action IS NULL AND joined.cause IS NOT NULL)
          ) AS filling_fields
        FROM joined
        JOIN legal_case
          ON legal_case.court_id = joined.court_id
         AND legal_case.docket_number = joined.docket_number
         AND legal_case.supreme_court_term IS NULL
        WHERE (${fillDrafts}::boolean = false OR legal_case.publication = 'draft')
          AND (
            (${fillDrafts}::boolean = false AND legal_case.filed_on IS NULL AND joined.filed_on IS NOT NULL)
            OR (legal_case.nature_of_suit_code IS NULL AND joined.nature_of_suit IS NOT NULL)
            OR (legal_case.cause_of_action IS NULL AND joined.cause IS NOT NULL)
          )
      ),
      patched AS (
        UPDATE legal_case
        SET filed_on = CASE
              WHEN ${fillDrafts}::boolean THEN legal_case.filed_on
              ELSE COALESCE(legal_case.filed_on, targets.filed_on::date)
            END,
            nature_of_suit_code = COALESCE(legal_case.nature_of_suit_code, targets.nature_of_suit),
            cause_of_action = COALESCE(legal_case.cause_of_action, targets.cause),
            updated_at = legal_case.updated_at
        FROM targets
        WHERE legal_case.id = targets.case_id
        RETURNING targets.filling_date, targets.filling_fields
      ),
      inserted AS (
        INSERT INTO legal_case (
          public_id, court_id, docket_number, caption, filed_on,
          nature_of_suit_code, cause_of_action,
          verification, publication, source_updated_at, created_at, updated_at
        )
        SELECT joined.public_id, joined.court_id, joined.docket_number, joined.caption, joined.filed_on::date,
          joined.nature_of_suit, joined.cause,
          'verified', 'draft', joined.filed_on::timestamptz, joined.filed_on::timestamptz, joined.filed_on::timestamptz
        FROM joined
        WHERE ${fillDrafts}::boolean = false
          AND NOT EXISTS (
            SELECT 1 FROM legal_case existing
            WHERE existing.court_id = joined.court_id
              AND existing.docket_number = joined.docket_number
              AND existing.supreme_court_term IS NULL
          )
        ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
        DO UPDATE SET
          filed_on = COALESCE(legal_case.filed_on, EXCLUDED.filed_on),
          nature_of_suit_code = COALESCE(legal_case.nature_of_suit_code, EXCLUDED.nature_of_suit_code),
          cause_of_action = COALESCE(legal_case.cause_of_action, EXCLUDED.cause_of_action),
          updated_at = legal_case.updated_at
        WHERE legal_case.filed_on IS NULL
          OR (legal_case.nature_of_suit_code IS NULL AND EXCLUDED.nature_of_suit_code IS NOT NULL)
          OR (legal_case.cause_of_action IS NULL AND EXCLUDED.cause_of_action IS NOT NULL)
        RETURNING (xmax = 0) AS inserted
      )
      SELECT
        (SELECT count(*)::int FROM incoming) AS incoming,
        (SELECT count(*)::int FROM joined) AS joined,
        (SELECT count(*) FILTER (WHERE inserted)::int FROM inserted) AS inserted,
        (SELECT count(*) FILTER (WHERE filling_date)::int FROM patched) AS filled,
        (SELECT count(*) FILTER (WHERE filling_fields)::int FROM patched) AS fields_filled
    `;
    return {
      ...filingWriteCounts({
        incoming: counts?.incoming ?? 0,
        joined: counts?.joined ?? 0,
        inserted: counts?.inserted ?? 0,
        filledDate: counts?.filled ?? 0,
      }),
      fieldsFilled: counts?.fields_filled ?? 0,
    };
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
  /** Read the snapshot again and copy nature of suit and cause onto existing drafts. No inserts. */
  fillDrafts?: boolean;
  diskPath?: string;
  log?: (event: Record<string, unknown>) => void;
}

export async function backfillFilingWindow(options: FilingBackfillOptions): Promise<FilingBackfillCheckpoint> {
  const budgetMs = options.budgetMs ?? FILING_BACKFILL_BUDGET_MS;
  const log = options.log ?? (() => undefined);
  const started = Date.now();
  const [provider] = await options.sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) throw new Error("courtlistener provider is missing");
  const fillDrafts = options.fillDrafts === true;
  const streamName = fillDrafts
    ? filingFillStreamName(options.family, options.windowDays, options.snapshotDate)
    : filingBackfillStreamName(options.family, options.windowDays, options.snapshotDate);
  const [stored] = await options.sql<{ cursor_value: string }[]>`
    SELECT checkpoint.cursor_value
    FROM ingestion_checkpoint checkpoint
    JOIN provider ON provider.id = checkpoint.provider_id
    WHERE provider.code = 'courtlistener' AND checkpoint.stream_name = ${streamName}
  `;
  const checkpoint = decodeFilingCheckpoint(stored?.cursor_value ?? null, options.snapshotDate, options.family, options.windowDays);
  if (checkpoint.stopped === "complete") return checkpoint;
  let seen = checkpoint.rowsConsumed;
  let yieldedForLoad = false;
  let batch: BackfillRow[] = [];
  const flush = async () => {
    const result = await persistFilingRows(options.sql, provider.id, batch, { fillDrafts });
    checkpoint.inserted += result.inserted;
    checkpoint.filledDate += result.filledDate;
    checkpoint.fieldsFilled += result.fieldsFilled;
    checkpoint.alreadyPresent += result.alreadyPresent;
    checkpoint.noCourt += result.noCourt;
    checkpoint.matched += result.inserted + result.filledDate + result.alreadyPresent + result.noCourt;
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
  for await (const docket of readBulkDockets(options.filePath, {
    skipRows: checkpoint.rowsConsumed,
    maxFieldChars: FILING_MAX_FIELD_CHARS,
  })) {
    seen += 1;
    checkpoint.rowsConsumed = seen;
    const row = selectBackfillRow(docket, options.family, options.today, options.windowDays);
    if (!row) checkpoint.skipped += 1;
    else if (fillDrafts && !row.natureOfSuit && !row.causeOfAction) checkpoint.skipped += 1;
    else batch.push(row);
    const elapsed = Date.now() - started;
    if (batch.length >= 200) await flush();
    if (seen % FILING_CHECKPOINT_ROWS === 0) {
      await flush();
      await save(null);
      log({
        rows: seen,
        checkpointRows: checkpoint.rowsConsumed,
        inserted: checkpoint.inserted,
        fieldsFilled: checkpoint.fieldsFilled,
        alreadyPresent: checkpoint.alreadyPresent,
        perHour: rowsPerHour(seen, elapsed),
      });
      if (process.memoryUsage().rss >= FILING_RSS_LIMIT_BYTES) {
        checkpoint.stopped = "memory";
        await save(checkpoint.stopped);
        log({ rows: seen, checkpointRows: checkpoint.rowsConsumed, stopped: "memory" });
        return checkpoint;
      }
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
