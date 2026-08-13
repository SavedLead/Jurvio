import type postgres from "postgres";
import { getFleetHeartbeat, type FleetHeartbeat } from "./get-fleet-heartbeat";

type Sql = ReturnType<typeof postgres>;

/**
 * Read-only "Pulse" snapshot for the command center. Composes the per-court fleet
 * heartbeat with three extra SELECT-only surfaces that the heartbeat does not
 * carry: SCOTUS U.S. Reports volume coverage (derived from the citation text,
 * since there is no volume column), corpus totals, and the publish backlog. Every
 * section is isolated so one failing query degrades that section to a default
 * instead of breaking the page. Never writes, ingests, or publishes; never
 * exposes secrets, hosts, or raw source addresses.
 */

export interface ScotusVolumeCoverage {
  volumesWithCandidates: number;
  minVolume: number | null;
  maxVolume: number | null;
  // The nominative-era gap (volumes 2-90) and the modern range (91-608) missing
  // any candidate, so the Pulse page can show the historical backfill closing.
  missingNominative: number;
  missingModern: number;
}

export interface PulseCorpus {
  cases: number;
  published: number;
  needsReview: number;
  documents: number;
  opinions: number;
  readableOpinions: number;
  databaseBytes: number;
}

export interface PulsePublishing {
  outboxUnpublished: number;
  oldestUnpublished: string | null;
  scotusApproved: number;
  scotusPendingReview: number;
}

export interface PulseSnapshot {
  generatedAt: string;
  corpus: PulseCorpus;
  scotusVolumes: ScotusVolumeCoverage;
  publishing: PulsePublishing;
  fleet: FleetHeartbeat;
}

function numberValue(value: number | string | bigint | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function getScotusVolumeCoverage(sql: Sql): Promise<ScotusVolumeCoverage> {
  const fallback: ScotusVolumeCoverage = {
    volumesWithCandidates: 0,
    minVolume: null,
    maxVolume: null,
    missingNominative: 0,
    missingModern: 0,
  };
  return safe(async () => {
    // The U.S. Reports volume lives in the leading integer of the citation
    // ("602 U.S. 123"); there is no volume column. Derive coverage by parsing it.
    const [row] = await sql<{
      volumes: string;
      min_volume: string | null;
      max_volume: string | null;
      missing_nominative: string;
      missing_modern: string;
    }[]>`
      WITH v AS (
        SELECT DISTINCT ((regexp_match(citation, '^([0-9]+) U'))[1])::int AS vol
        FROM official_opinion_candidate
        WHERE citation ~ '^[0-9]+ U'
      )
      SELECT
        (SELECT count(*) FROM v)::text AS volumes,
        (SELECT min(vol) FROM v)::text AS min_volume,
        (SELECT max(vol) FROM v)::text AS max_volume,
        (SELECT count(*) FROM generate_series(2, 90) g WHERE g NOT IN (SELECT vol FROM v))::text AS missing_nominative,
        (SELECT count(*) FROM generate_series(91, 608) g WHERE g NOT IN (SELECT vol FROM v))::text AS missing_modern
    `;
    if (!row) return fallback;
    return {
      volumesWithCandidates: numberValue(row.volumes),
      minVolume: optionalNumber(row.min_volume),
      maxVolume: optionalNumber(row.max_volume),
      missingNominative: numberValue(row.missing_nominative),
      missingModern: numberValue(row.missing_modern),
    };
  }, fallback);
}

async function getPulseCorpus(sql: Sql): Promise<PulseCorpus> {
  const fallback: PulseCorpus = {
    cases: 0, published: 0, needsReview: 0, documents: 0, opinions: 0, readableOpinions: 0, databaseBytes: 0,
  };
  return safe(async () => {
    const [row] = await sql<{
      cases: string; published: string; needs_review: string; documents: string;
      opinions: string; readable_opinions: string; database_bytes: string;
    }[]>`
      SELECT
        (SELECT count(*) FROM legal_case)::text AS cases,
        (SELECT count(*) FROM legal_case WHERE publication = 'published')::text AS published,
        (SELECT count(*) FROM legal_case WHERE verification = 'needs_review')::text AS needs_review,
        (SELECT count(*) FROM document)::text AS documents,
        (SELECT count(*) FROM judicial_opinion)::text AS opinions,
        (SELECT count(*) FROM document_content)::text AS readable_opinions,
        pg_database_size(current_database())::text AS database_bytes
    `;
    if (!row) return fallback;
    return {
      cases: numberValue(row.cases),
      published: numberValue(row.published),
      needsReview: numberValue(row.needs_review),
      documents: numberValue(row.documents),
      opinions: numberValue(row.opinions),
      readableOpinions: numberValue(row.readable_opinions),
      databaseBytes: numberValue(row.database_bytes),
    };
  }, fallback);
}

async function getPulsePublishing(sql: Sql): Promise<PulsePublishing> {
  const fallback: PulsePublishing = {
    outboxUnpublished: 0, oldestUnpublished: null, scotusApproved: 0, scotusPendingReview: 0,
  };
  return safe(async () => {
    const [outbox] = await safe(
      () => sql<{ unpublished: string; oldest: string | null }[]>`
        SELECT count(*)::text AS unpublished, min(created_at)::text AS oldest
        FROM outbox_event WHERE published_at IS NULL
      `,
      [] as { unpublished: string; oldest: string | null }[],
    );
    const candidates = await safe(
      () => sql<{ review_status: string; count: string }[]>`
        SELECT review_status, count(*)::text AS count
        FROM official_opinion_candidate GROUP BY review_status
      `,
      [] as { review_status: string; count: string }[],
    );
    const byStatus = new Map(candidates.map((row) => [row.review_status, numberValue(row.count)]));
    return {
      outboxUnpublished: outbox ? numberValue(outbox.unpublished) : 0,
      oldestUnpublished: outbox?.oldest ?? null,
      scotusApproved: byStatus.get("approved") ?? 0,
      scotusPendingReview: byStatus.get("pending_review") ?? 0,
    };
  }, fallback);
}

export async function getPulseSnapshot(sql: Sql): Promise<PulseSnapshot> {
  const [corpus, scotusVolumes, publishing, fleet] = await Promise.all([
    getPulseCorpus(sql),
    getScotusVolumeCoverage(sql),
    getPulsePublishing(sql),
    getFleetHeartbeat(sql),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    corpus,
    scotusVolumes,
    publishing,
    fleet,
  };
}
