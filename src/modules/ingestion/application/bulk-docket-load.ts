import os from "node:os";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { checkBulkDiskFloor } from "./bulk-disk-floor";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { matchesBulkFederalJurisdiction } from "./ingest-courtlistener-bulk-federal-dockets";
import {
  readBulkDockets,
  type CourtListenerBulkDocket,
} from "../providers/courtlistener/bulk-dockets";

type Sql = ReturnType<typeof postgres>;

export const BULK_DOCKET_CHUNK_SIZE = 5_000;
export const BULK_DOCKET_DISK_FLOOR = 0.3;
export const BULK_DOCKET_LOAD_PAUSE_MS = 30_000;
export const BULK_DOCKET_MAX_PAUSES = 10;

export interface BulkDocketCheckpoint {
  version: 1;
  snapshotDate: string;
  rowsConsumed: number;
  merged: number;
  inserted: number;
  matchedByDocketId: number;
  matchedByDocketNumber: number;
  ambiguous: number;
  stopped: string | null;
}

export function emptyBulkDocketCheckpoint(snapshotDate: string): BulkDocketCheckpoint {
  return {
    version: 1,
    snapshotDate,
    rowsConsumed: 0,
    merged: 0,
    inserted: 0,
    matchedByDocketId: 0,
    matchedByDocketNumber: 0,
    ambiguous: 0,
    stopped: null,
  };
}

export function decodeBulkDocketCheckpoint(value: string | null, snapshotDate: string): BulkDocketCheckpoint {
  if (!value) return emptyBulkDocketCheckpoint(snapshotDate);
  const parsed = JSON.parse(value) as Partial<BulkDocketCheckpoint>;
  if (parsed.version !== 1 || parsed.snapshotDate !== snapshotDate || typeof parsed.rowsConsumed !== "number") {
    return emptyBulkDocketCheckpoint(snapshotDate);
  }
  return {
    version: 1,
    snapshotDate,
    rowsConsumed: parsed.rowsConsumed,
    merged: parsed.merged ?? 0,
    inserted: parsed.inserted ?? 0,
    matchedByDocketId: parsed.matchedByDocketId ?? 0,
    matchedByDocketNumber: parsed.matchedByDocketNumber ?? 0,
    ambiguous: parsed.ambiguous ?? 0,
    stopped: parsed.stopped ?? null,
  };
}

/** 1:00 inclusive through 7:00 exclusive, America/New_York. */
export function isEasternQuietWindow(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now).find((part) => part.type === "hour")?.value);
  return hour >= 1 && hour < 7;
}

export function freeDiskRatio(blocks: number, available: number): number {
  if (!Number.isFinite(blocks) || blocks <= 0) return 0;
  return available / blocks;
}

export function shouldPauseForLoad(input: {
  loadAverage: number;
  cpuCount: number;
  slowPublicQueries: number;
}): boolean {
  if (input.cpuCount > 0 && input.loadAverage > input.cpuCount * 0.85) return true;
  return input.slowPublicQueries > 0;
}

export function rowsPerHour(rows: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round((rows * 3_600_000) / elapsedMs);
}

export function normalizeDocketKey(docketNumber: string): string {
  return docketNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function csvField(value: string | null): string {
  if (value === null) return "\\N";
  if (/[",\n\r\\]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

export interface StageDocket {
  docketId: string;
  courtCode: string;
  docketNumber: string;
  normalizedDocket: string;
  caption: string;
  filedOn: string | null;
  terminatedOn: string | null;
  natureOfSuit: string | null;
  cause: string | null;
  dateModified: string | null;
  publicId: string;
  publication: "draft" | "restricted";
}

export function stageDocket(docket: CourtListenerBulkDocket): StageDocket | null {
  const docketNumber = docket.docket_number.trim();
  const caption = (docket.case_name_short || docket.case_name).trim();
  const normalizedDocket = normalizeDocketKey(docketNumber);
  if (!docket.id || !docket.court_id.trim() || !docketNumber || !caption || !normalizedDocket) return null;
  const filedOn = isoDate(docket.date_filed);
  return {
    docketId: docket.id,
    courtCode: docket.court_id.trim(),
    docketNumber,
    normalizedDocket,
    caption: caption.slice(0, 2_000),
    filedOn,
    terminatedOn: isoDate(docket.date_terminated),
    natureOfSuit: blankToNull(docket.nature_of_suit),
    cause: blankToNull(docket.cause),
    dateModified: isoTimestamp(docket.date_modified),
    publicId: createPublicId("case"),
    publication: isRestrictedDocketText(`${caption} ${docketNumber}`) ? "restricted" : "draft",
  };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 2_000) : null;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function isoTimestamp(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function stageCsv(rows: readonly StageDocket[]): string {
  return rows.map((row) => [
    csvField(row.docketId),
    csvField(row.courtCode),
    csvField(row.docketNumber),
    csvField(row.normalizedDocket),
    csvField(row.caption),
    csvField(row.filedOn),
    csvField(row.terminatedOn),
    csvField(row.natureOfSuit),
    csvField(row.cause),
    csvField(row.dateModified),
    csvField(row.publicId),
    csvField(row.publication),
  ].join(",")).join("\n") + (rows.length ? "\n" : "");
}

export interface BulkDocketLoadOptions {
  filePath: string;
  snapshotDate: string;
  /** Rows to merge in this run (not cumulative across the checkpoint). */
  rowLimit: number;
  chunkSize?: number;
  budgetMs: number;
  allowAnytime?: boolean;
  includeBankruptcy?: boolean;
  resetCheckpoint?: boolean;
  diskPath?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Clock for budget checks; tests inject one. */
  now?: () => number;
}

export interface BulkDocketLoadResult extends BulkDocketCheckpoint {
  rowsSeen: number;
  /** Checkpoint row this run resumed from, and what this run alone did. */
  resumedFromRow: number;
  rowsReadThisRun: number;
  mergedThisRun: number;
  insertedThisRun: number;
  skippedNonFederal: number;
  skippedIdentity: number;
  elapsedMs: number;
  rowsPerHour: number;
  freeDiskRatio: number | null;
  pauses: number;
}

export async function loadCourtListenerBulkDockets(
  sql: Sql,
  options: BulkDocketLoadOptions,
): Promise<BulkDocketLoadResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  }
  if (!Number.isInteger(options.rowLimit) || options.rowLimit < 1) {
    throw new Error("--row-limit must be a positive integer");
  }
  const chunkSize = options.chunkSize ?? BULK_DOCKET_CHUNK_SIZE;
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + options.budgetMs;
  const diskPath = options.diskPath ?? options.filePath;
  const base = emptyBulkDocketCheckpoint(options.snapshotDate);
  if (!options.allowAnytime && !isEasternQuietWindow(new Date())) {
    return finish(base, base, { rowsSeen: 0, skippedNonFederal: 0, skippedIdentity: 0, started, ended: now(), pauses: 0, freeDiskRatio: null, stopped: "outside-quiet-window" });
  }

  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!provider) throw new Error("CourtListener provider seed is missing");
  const courts = await sql<{ code: string; jurisdiction: string | null }[]>`
    SELECT provider_court_id AS code, jurisdiction
    FROM court
    WHERE provider_id = ${provider.id} AND provider_court_id IS NOT NULL
  `;
  const courtJurisdiction = new Map(courts.map((court) => [court.code, court.jurisdiction]));
  const streamName = `courtlistener:bulk-dockets:v1:${options.snapshotDate}`;
  const [stored] = await sql<{ cursor_value: string }[]>`
    SELECT cursor_value FROM ingestion_checkpoint
    WHERE provider_id = ${provider.id} AND stream_name = ${streamName}
  `;
  let checkpoint = options.resetCheckpoint
    ? emptyBulkDocketCheckpoint(options.snapshotDate)
    : decodeBulkDocketCheckpoint(stored?.cursor_value ?? null, options.snapshotDate);
  // `stopped` describes the previous run. Clear it so this run's tail chunk is
  // flushed and a finished file is marked complete.
  checkpoint = { ...checkpoint, stopped: null };
  const initial = checkpoint;
  let rowsSeen = 0;
  let skippedNonFederal = 0;
  let skippedIdentity = 0;
  let pauses = 0;
  let freeRatio: number | null = null;
  const batch: StageDocket[] = [];
  const seenInBatch = new Set<string>();

  const flush = async (): Promise<boolean> => {
    if (!batch.length) return false;
    const gate = await gateChunk(sql, diskPath, options.sleep);
    pauses += gate.pauses;
    freeRatio = gate.freeDiskRatio;
    if (gate.stop) {
      checkpoint = { ...checkpoint, stopped: gate.stop };
      await writeCheckpoint(sql, provider.id, streamName, checkpoint);
      batch.length = 0;
      return true;
    }
    if (!options.allowAnytime && !isEasternQuietWindow(new Date())) {
      checkpoint = { ...checkpoint, stopped: "outside-quiet-window" };
      await writeCheckpoint(sql, provider.id, streamName, checkpoint);
      batch.length = 0;
      return true;
    }
    if (now() >= deadline) {
      checkpoint = { ...checkpoint, stopped: "budget" };
      await writeCheckpoint(sql, provider.id, streamName, checkpoint);
      batch.length = 0;
      return true;
    }
    const merged = await mergeDocketStage(sql, provider.id, stageCsv(batch));
    checkpoint = {
      ...checkpoint,
      rowsConsumed: rowsSeen,
      merged: checkpoint.merged + merged.inserted + merged.matchedByDocketId + merged.matchedByDocketNumber,
      inserted: checkpoint.inserted + merged.inserted,
      matchedByDocketId: checkpoint.matchedByDocketId + merged.matchedByDocketId,
      matchedByDocketNumber: checkpoint.matchedByDocketNumber + merged.matchedByDocketNumber,
      ambiguous: checkpoint.ambiguous + merged.ambiguous,
      stopped: null,
    };
    await writeCheckpoint(sql, provider.id, streamName, checkpoint);
    console.log(JSON.stringify({ bulkDockets: "chunk", ...checkpoint, elapsedMs: now() - started }));
    batch.length = 0;
    seenInBatch.clear();
    return false;
  };

  for await (const docket of readBulkDockets(options.filePath)) {
    if (now() >= deadline) {
      // Keep rowsConsumed at the last merged chunk: rows still in `batch` were
      // read but never merged, and the next run must read them again.
      checkpoint = { ...checkpoint, stopped: "budget" };
      await writeCheckpoint(sql, provider.id, streamName, checkpoint);
      break;
    }
    rowsSeen += 1;
    if (rowsSeen <= checkpoint.rowsConsumed) continue;
    if (checkpoint.merged - initial.merged >= options.rowLimit) {
      checkpoint = { ...checkpoint, rowsConsumed: rowsSeen - 1, stopped: "row-limit" };
      await writeCheckpoint(sql, provider.id, streamName, checkpoint);
      break;
    }
    const jurisdiction = courtJurisdiction.get(docket.court_id.trim());
    if (docket.court_id.trim().toLowerCase() === "scotus" || !courtJurisdiction.has(docket.court_id.trim())
      || !matchesBulkFederalJurisdiction(jurisdiction ?? null, options.includeBankruptcy === true)) {
      skippedNonFederal += 1;
      continue;
    }
    const staged = stageDocket(docket);
    if (!staged) {
      skippedIdentity += 1;
      continue;
    }
    if (seenInBatch.has(staged.docketId)) continue;
    seenInBatch.add(staged.docketId);
    batch.push(staged);
    const reachedLimit = checkpoint.merged - initial.merged + batch.length >= options.rowLimit;
    if (batch.length >= chunkSize || reachedLimit) {
      if (await flush()) break;
      if (checkpoint.stopped === null && reachedLimit) {
        checkpoint = { ...checkpoint, stopped: "row-limit" };
        await writeCheckpoint(sql, provider.id, streamName, checkpoint);
        break;
      }
    }
  }
  if (batch.length && checkpoint.stopped === null) {
    await flush();
    if (checkpoint.stopped === null && checkpoint.merged - initial.merged >= options.rowLimit) {
      checkpoint = { ...checkpoint, stopped: "row-limit" };
      await writeCheckpoint(sql, provider.id, streamName, checkpoint);
    }
  }
  if (checkpoint.stopped === null) {
    checkpoint = { ...checkpoint, rowsConsumed: rowsSeen, stopped: "complete" };
    await writeCheckpoint(sql, provider.id, streamName, checkpoint);
  }
  return finish(checkpoint, initial, {
    rowsSeen,
    ended: now(),
    skippedNonFederal,
    skippedIdentity,
    started,
    pauses,
    freeDiskRatio: freeRatio,
    stopped: checkpoint.stopped,
  });
}

function finish(
  checkpoint: BulkDocketCheckpoint,
  initial: BulkDocketCheckpoint,
  extra: {
    rowsSeen: number;
    ended: number;
    skippedNonFederal: number;
    skippedIdentity: number;
    started: number;
    pauses: number;
    freeDiskRatio: number | null;
    stopped: string | null;
  },
): BulkDocketLoadResult {
  const elapsedMs = extra.ended - extra.started;
  const mergedThisRun = checkpoint.merged - initial.merged;
  return {
    ...checkpoint,
    stopped: extra.stopped,
    rowsSeen: extra.rowsSeen,
    resumedFromRow: initial.rowsConsumed,
    rowsReadThisRun: Math.max(0, extra.rowsSeen - initial.rowsConsumed),
    mergedThisRun,
    insertedThisRun: checkpoint.inserted - initial.inserted,
    skippedNonFederal: extra.skippedNonFederal,
    skippedIdentity: extra.skippedIdentity,
    elapsedMs,
    rowsPerHour: rowsPerHour(mergedThisRun, elapsedMs),
    freeDiskRatio: extra.freeDiskRatio,
    pauses: extra.pauses,
  };
}

async function gateChunk(
  sql: Sql,
  diskPath: string,
  sleep: ((ms: number) => Promise<void>) | undefined,
): Promise<{ stop: string | null; pauses: number; freeDiskRatio: number | null }> {
  let pauses = 0;
  let ratio: number | null = null;
  for (;;) {
    const floor = await checkBulkDiskFloor(diskPath);
    ratio = floor.freeDiskRatio;
    if (!floor.ok) {
      return { stop: "disk", pauses, freeDiskRatio: ratio };
    }
    const [load] = await sql<{ slow: number }[]>`
      SELECT count(*)::int AS slow
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND application_name IN ('jurvio-web', 'jurvio-search')
        AND now() - query_start > interval '2 seconds'
        AND pid <> pg_backend_pid()
    `;
    const pause = shouldPauseForLoad({
      loadAverage: os.loadavg()[0] ?? 0,
      cpuCount: os.cpus().length,
      slowPublicQueries: load?.slow ?? 0,
    });
    if (!pause) return { stop: null, pauses, freeDiskRatio: ratio };
    pauses += 1;
    if (pauses > BULK_DOCKET_MAX_PAUSES) return { stop: "paused", pauses, freeDiskRatio: ratio };
    console.log(JSON.stringify({ bulkDockets: "pause", pauses, slowPublicQueries: load?.slow ?? 0 }));
    await (sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(BULK_DOCKET_LOAD_PAUSE_MS);
  }
}

async function writeCheckpoint(sql: Sql, providerId: string, streamName: string, checkpoint: BulkDocketCheckpoint): Promise<void> {
  await sql`
    INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
    VALUES (${providerId}, ${streamName}, ${JSON.stringify(checkpoint)})
    ON CONFLICT (provider_id, stream_name)
    DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
  `;
}

export interface DocketMergeCounts {
  inserted: number;
  matchedByDocketId: number;
  matchedByDocketNumber: number;
  ambiguous: number;
}

export async function mergeDocketStage(sql: Sql, providerId: string, csv: string): Promise<DocketMergeCounts> {
  await sql`TRUNCATE courtlistener_docket_stage`;
  const copy = sql.unsafe(
    "COPY courtlistener_docket_stage (docket_id, court_code, docket_number, normalized_docket, caption, filed_on, terminated_on, nature_of_suit, cause, date_modified, public_id, publication) FROM STDIN WITH (FORMAT csv, NULL '\\N')",
  );
  const stream = await copy.writable();
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", () => resolve());
    stream.end(csv);
  });
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '120s', true)`;
    const [byId] = await tx<{ n: number }[]>`
      WITH updated AS (
        UPDATE legal_case
        SET caption = CASE WHEN legal_case.publication = 'draft' THEN stage.caption ELSE legal_case.caption END,
          filed_on = CASE WHEN legal_case.publication = 'draft' THEN COALESCE(stage.filed_on, legal_case.filed_on) ELSE legal_case.filed_on END,
          terminated_on = CASE WHEN legal_case.publication = 'draft' THEN COALESCE(stage.terminated_on, legal_case.terminated_on) ELSE legal_case.terminated_on END,
          nature_of_suit_code = CASE WHEN legal_case.publication = 'draft' THEN COALESCE(stage.nature_of_suit, legal_case.nature_of_suit_code) ELSE legal_case.nature_of_suit_code END,
          cause_of_action = CASE WHEN legal_case.publication = 'draft' THEN COALESCE(stage.cause, legal_case.cause_of_action) ELSE legal_case.cause_of_action END,
          source_updated_at = GREATEST(legal_case.source_updated_at, stage.date_modified),
          last_fetched_at = now(),
          updated_at = now()
        FROM courtlistener_docket_stage stage
        JOIN case_identifier identifier
          ON identifier.provider_id = ${providerId}
         AND identifier.identifier_type = 'courtlistener_docket_id'
         AND identifier.identifier_value = stage.docket_id
        WHERE legal_case.id = identifier.case_id
        RETURNING legal_case.id
      )
      SELECT count(*)::int AS n FROM updated
    `;
    const [ambiguous] = await tx<{ n: number }[]>`
      WITH counts AS (
        SELECT stage.docket_id, count(*) AS n
        FROM courtlistener_docket_stage stage
        JOIN court ON court.provider_id = ${providerId} AND court.provider_court_id = stage.court_code
        JOIN legal_case
          ON legal_case.court_id = court.id
         AND legal_case.supreme_court_term IS NULL
         AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g')) = stage.normalized_docket
        WHERE NOT EXISTS (
          SELECT 1 FROM case_identifier identifier
          WHERE identifier.provider_id = ${providerId}
            AND identifier.identifier_type = 'courtlistener_docket_id'
            AND identifier.identifier_value = stage.docket_id
        )
        GROUP BY stage.docket_id
      )
      SELECT count(*)::int AS n FROM counts WHERE n > 1
    `;
    const [byNumber] = await tx<{ n: number }[]>`
      WITH unique_match AS (
        SELECT stage.docket_id, min(legal_case.id::text)::uuid AS case_id
        FROM courtlistener_docket_stage stage
        JOIN court ON court.provider_id = ${providerId} AND court.provider_court_id = stage.court_code
        JOIN legal_case
          ON legal_case.court_id = court.id
         AND legal_case.supreme_court_term IS NULL
         AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g')) = stage.normalized_docket
        WHERE NOT EXISTS (
          SELECT 1 FROM case_identifier identifier
          WHERE identifier.provider_id = ${providerId}
            AND identifier.identifier_type = 'courtlistener_docket_id'
            AND identifier.identifier_value = stage.docket_id
        )
        GROUP BY stage.docket_id
        HAVING count(*) = 1
      ), linked AS (
        INSERT INTO case_identifier (case_id, provider_id, identifier_type, identifier_value)
        SELECT case_id, ${providerId}, 'courtlistener_docket_id', docket_id
        FROM unique_match
        ON CONFLICT (provider_id, identifier_type, identifier_value) DO NOTHING
        RETURNING case_id
      ), refreshed AS (
        UPDATE legal_case
        SET caption = CASE WHEN legal_case.publication = 'draft' THEN stage.caption ELSE legal_case.caption END,
          filed_on = CASE WHEN legal_case.publication = 'draft' THEN COALESCE(stage.filed_on, legal_case.filed_on) ELSE legal_case.filed_on END,
          terminated_on = CASE WHEN legal_case.publication = 'draft' THEN COALESCE(stage.terminated_on, legal_case.terminated_on) ELSE legal_case.terminated_on END,
          source_updated_at = GREATEST(legal_case.source_updated_at, stage.date_modified),
          last_fetched_at = now(),
          updated_at = now()
        FROM linked
        JOIN unique_match ON unique_match.case_id = linked.case_id
        JOIN courtlistener_docket_stage stage ON stage.docket_id = unique_match.docket_id
        WHERE legal_case.id = linked.case_id
        RETURNING legal_case.id
      )
      SELECT count(*)::int AS n FROM refreshed
    `;
    const [inserted] = await tx<{ n: number }[]>`
      WITH created AS (
        INSERT INTO legal_case (
          public_id, court_id, docket_number, caption, filed_on, terminated_on,
          nature_of_suit_code, cause_of_action, verification, publication, source_updated_at, last_fetched_at
        )
        SELECT stage.public_id, court.id, stage.docket_number, stage.caption, stage.filed_on, stage.terminated_on,
          stage.nature_of_suit, stage.cause, 'not_verified', stage.publication::publication_state,
          stage.date_modified, now()
        FROM courtlistener_docket_stage stage
        JOIN court ON court.provider_id = ${providerId} AND court.provider_court_id = stage.court_code
        WHERE NOT EXISTS (
          SELECT 1 FROM case_identifier identifier
          WHERE identifier.provider_id = ${providerId}
            AND identifier.identifier_type = 'courtlistener_docket_id'
            AND identifier.identifier_value = stage.docket_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM legal_case existing
          WHERE existing.court_id = court.id
            AND existing.supreme_court_term IS NULL
            AND lower(regexp_replace(existing.docket_number, '[^a-zA-Z0-9]', '', 'g')) = stage.normalized_docket
        )
        ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL DO NOTHING
        RETURNING id, public_id
      ), linked AS (
        -- Join the stage through created.public_id (RETURNING output), never through
        -- legal_case: sibling data-modifying CTEs share one snapshot, so the rows
        -- just inserted into legal_case are invisible here. Joining legal_case wrote
        -- no identifier for any newly inserted case (only ~1.15M of 8.6M bulk cases
        -- had one on 2026-10-30), which left every pending cluster unresolvable.
        INSERT INTO case_identifier (case_id, provider_id, identifier_type, identifier_value)
        SELECT created.id, ${providerId}, 'courtlistener_docket_id', stage.docket_id
        FROM created
        JOIN courtlistener_docket_stage stage
          ON stage.public_id = created.public_id
        ON CONFLICT (provider_id, identifier_type, identifier_value) DO NOTHING
        RETURNING case_id
      )
      SELECT count(*)::int AS n FROM created
    `;
    // Per-court "last bulk load" for /internal/freshness (court_source_watermark).
    await tx`
      INSERT INTO court_source_watermark (
        source, court_code, last_attempt_at, last_success_at, items_fetched_last, items_fetched_total, updated_at
      )
      SELECT 'bulk', lower(court_code), now(), now(), count(*)::int, count(*), now()
      FROM courtlistener_docket_stage
      GROUP BY lower(court_code)
      ON CONFLICT (source, court_code) DO UPDATE SET
        last_attempt_at = now(), last_success_at = now(),
        items_fetched_last = EXCLUDED.items_fetched_last,
        items_fetched_total = court_source_watermark.items_fetched_total + EXCLUDED.items_fetched_last,
        consecutive_failures = 0, updated_at = now()
    `;
    return {
      inserted: inserted?.n ?? 0,
      matchedByDocketId: byId?.n ?? 0,
      matchedByDocketNumber: byNumber?.n ?? 0,
      ambiguous: ambiguous?.n ?? 0,
    };
  });
}
