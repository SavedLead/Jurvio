import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * Read-only per-court "heartbeat" for the full federal fleet
 * (1 Supreme Court + 13 Courts of Appeals + 94 District Courts).
 *
 * This module ONLY reads. Every section is isolated so a single failing query
 * degrades that section to an empty/default result instead of throwing, and one
 * court with no ingestion rows never breaks the whole page.
 *
 * The queries and column names are mirrored from scripts/report-fleet-status.ts,
 * which is the source of truth for the underlying schema.
 */

export interface ScotusHeartbeat {
  court: string;
  source: string;
  lastCheck: string | null;
  lastNewItem: string | null;
  lastPublication: string | null;
  publishedCases: number;
  backlog: number;
  candidatesByStatus: Array<{ status: string; count: number }>;
  errors: number;
  available: boolean;
}

export interface CircuitHeartbeat {
  courtCode: string;
  courtName: string;
  circuit: string;
  healthState: string;
  lastCheck: string | null;
  lastNewItem: string | null;
  lastPublication: string | null;
  backlog: number;
  publishedCount: number;
  errors: number;
  govinfoStatus: string | null;
  govinfoRecordsDiscovered: number;
  // Most common machine blocker code among items stuck in the "blocked" state,
  // plus how many items carry it. This is a short category code (e.g.
  // "pdf_unavailable"), never a URL, credential, or host name.
  blockerCode: string | null;
  blockedCount: number;
}

export interface DistrictHeartbeat {
  courtCode: string;
  courtName: string;
  circuit: string | null;
  rssAvailable: boolean;
  healthState: string;
  lastCheck: string | null;
  lastNewItem: string | null;
  lastPublication: string | null;
  backlog: number;
  publishedCount: number;
  errors: number;
  // Count of events awaiting editorial review for this court. Used to explain a
  // delayed/stalled state when there are no outright retrieval failures.
  needsReview: number;
}

export interface FleetHeartbeat {
  generatedAt: string;
  scotus: ScotusHeartbeat;
  circuits: CircuitHeartbeat[];
  districts: DistrictHeartbeat[];
}

function numberValue(value: number | string | bigint | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: string | null | undefined): string | null {
  return value == null ? null : String(value);
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const APPELLATE_TERMINAL_STATES = new Set(["published", "dead_letter"]);

async function getScotusHeartbeat(sql: Sql): Promise<ScotusHeartbeat> {
  const base: ScotusHeartbeat = {
    court: "Supreme Court of the United States",
    source: "scotus_official",
    lastCheck: null,
    lastNewItem: null,
    lastPublication: null,
    publishedCases: 0,
    backlog: 0,
    candidatesByStatus: [],
    errors: 0,
    available: false,
  };

  return safe(async () => {
    const candidates = await sql<{ review_status: string; count: string }[]>`
      SELECT review_status, count(*)::text AS count
      FROM official_opinion_candidate GROUP BY review_status ORDER BY review_status
    `;
    const rows = await sql<{
      last_ingested_artifact: string | null;
      last_candidate_seen: string | null;
      published_cases: string;
      last_published_update: string | null;
    }[]>`
      SELECT
        (SELECT max(ra.retrieved_at) FROM raw_artifact ra
           JOIN provider p ON p.id = ra.provider_id
           WHERE p.code = 'scotus_official')::text AS last_ingested_artifact,
        (SELECT max(last_seen_at) FROM official_opinion_candidate)::text AS last_candidate_seen,
        (SELECT count(*) FROM legal_case lc JOIN court co ON co.id = lc.court_id
           WHERE co.provider_court_id = 'scotus' AND lc.publication = 'published')::text AS published_cases,
        (SELECT max(lc.updated_at) FROM legal_case lc JOIN court co ON co.id = lc.court_id
           WHERE co.provider_court_id = 'scotus' AND lc.publication = 'published')::text AS last_published_update
    `;
    const [freshness] = rows;
    const candidatesByStatus = candidates.map((row) => ({
      status: String(row.review_status),
      count: numberValue(row.count),
    }));
    const backlog = candidatesByStatus
      .filter((row) => row.status !== "published")
      .reduce((sum, row) => sum + row.count, 0);
    if (!freshness) {
      return { ...base, candidatesByStatus, backlog, available: true };
    }
    return {
      ...base,
      lastCheck: textValue(freshness.last_ingested_artifact),
      lastNewItem: textValue(freshness.last_candidate_seen),
      lastPublication: textValue(freshness.last_published_update),
      publishedCases: numberValue(freshness.published_cases),
      backlog,
      candidatesByStatus,
      available: true,
    };
  }, base);
}

async function getCircuitHeartbeats(sql: Sql): Promise<CircuitHeartbeat[]> {
  return safe(async () => {
    const registry = await sql<{
      court_code: string;
      court_name: string;
      circuit: string;
      health_state: string;
      last_successful_retrieval: string | null;
      consecutive_failures: number;
      next_poll_at: string | null;
    }[]>`
      SELECT court_code, court_name, circuit, health_state,
             last_successful_retrieval::text, consecutive_failures, next_poll_at::text
      FROM appellate_source_registry ORDER BY court_code
    `;
    const govinfo = await safe(
      () => sql<{
        court_code: string;
        status: string;
        records_discovered: string;
        last_successful_retrieval: string | null;
      }[]>`
        SELECT court_code, status, records_discovered::text, last_successful_retrieval::text
        FROM govinfo_appellate_checkpoint
      `,
      [] as { court_code: string; status: string; records_discovered: string; last_successful_retrieval: string | null }[],
    );
    const items = await safe(
      () => sql<{ court_code: string; state: string; count: string; last_seen_at: string | null }[]>`
        SELECT court_code, state, count(*)::text AS count, max(last_seen_at)::text AS last_seen_at
        FROM appellate_ingestion_item GROUP BY court_code, state
      `,
      [] as { court_code: string; state: string; count: string; last_seen_at: string | null }[],
    );
    // Blocker categories for items stuck in the "blocked" state. Only the short
    // machine code is selected (never blocker_detail, which may carry URLs).
    const blockers = await safe(
      () => sql<{ court_code: string; blocker_code: string | null; count: string }[]>`
        SELECT court_code, blocker_code, count(*)::text AS count
        FROM appellate_ingestion_item
        WHERE state = 'blocked'
        GROUP BY court_code, blocker_code
      `,
      [] as { court_code: string; blocker_code: string | null; count: string }[],
    );

    const govinfoByCourt = new Map(govinfo.map((row) => [row.court_code, row]));
    const blockersByCourt = new Map<string, typeof blockers>();
    for (const row of blockers) {
      const bucket = blockersByCourt.get(row.court_code) ?? [];
      bucket.push(row);
      blockersByCourt.set(row.court_code, bucket);
    }
    const itemsByCourt = new Map<string, typeof items>();
    for (const row of items) {
      const bucket = itemsByCourt.get(row.court_code) ?? [];
      bucket.push(row);
      itemsByCourt.set(row.court_code, bucket);
    }

    return registry.map((row) => {
      const courtItems = itemsByCourt.get(row.court_code) ?? [];
      let backlog = 0;
      let publishedCount = 0;
      let lastNewItem: string | null = null;
      let lastPublication: string | null = null;
      for (const item of courtItems) {
        const count = numberValue(item.count);
        const seenAt = textValue(item.last_seen_at);
        if (seenAt && (!lastNewItem || seenAt > lastNewItem)) lastNewItem = seenAt;
        if (item.state === "published") {
          publishedCount += count;
          if (seenAt && (!lastPublication || seenAt > lastPublication)) lastPublication = seenAt;
        } else if (!APPELLATE_TERMINAL_STATES.has(item.state)) {
          backlog += count;
        }
      }
      const govinfoRow = govinfoByCourt.get(row.court_code);
      const courtBlockers = blockersByCourt.get(row.court_code) ?? [];
      let blockerCode: string | null = null;
      let blockedCount = 0;
      let topBlocker = 0;
      for (const blocker of courtBlockers) {
        const blockerN = numberValue(blocker.count);
        blockedCount += blockerN;
        if (blocker.blocker_code && blockerN > topBlocker) {
          topBlocker = blockerN;
          blockerCode = String(blocker.blocker_code);
        }
      }
      return {
        courtCode: String(row.court_code),
        courtName: String(row.court_name),
        circuit: String(row.circuit),
        healthState: String(row.health_state),
        lastCheck: textValue(row.last_successful_retrieval),
        lastNewItem,
        lastPublication,
        backlog,
        publishedCount,
        errors: numberValue(row.consecutive_failures),
        govinfoStatus: govinfoRow ? String(govinfoRow.status) : null,
        govinfoRecordsDiscovered: govinfoRow ? numberValue(govinfoRow.records_discovered) : 0,
        blockerCode,
        blockedCount,
      };
    });
  }, []);
}

async function getDistrictHeartbeats(sql: Sql): Promise<DistrictHeartbeat[]> {
  return safe(async () => {
    const registry = await sql<{
      court_code: string;
      court_name: string;
      circuit: string | null;
      rss_available: boolean;
      health_state: string;
      last_successful_retrieval: string | null;
      consecutive_failures: number;
    }[]>`
      SELECT court_code, court_name, circuit, rss_available, health_state,
             last_successful_retrieval::text, consecutive_failures
      FROM direct_court_registry WHERE court_type = 'district' ORDER BY court_code
    `;
    const events = await safe(
      () => sql<{
        court_code: string;
        total: string;
        published: string;
        pending: string;
        needs_review: string;
        last_event_at: string | null;
        last_published_at: string | null;
      }[]>`
        SELECT court_code,
               count(*)::text AS total,
               count(*) FILTER (WHERE publication_state = 'published')::text AS published,
               count(*) FILTER (WHERE publication_state = 'pending')::text AS pending,
               count(*) FILTER (WHERE publication_state = 'needs_review')::text AS needs_review,
               max(last_seen_at)::text AS last_event_at,
               max(published_at)::text AS last_published_at
        FROM direct_court_event GROUP BY court_code
      `,
      [] as {
        court_code: string;
        total: string;
        published: string;
        pending: string;
        needs_review: string;
        last_event_at: string | null;
        last_published_at: string | null;
      }[],
    );

    const eventsByCourt = new Map(events.map((row) => [row.court_code, row]));

    return registry.map((row) => {
      const event = eventsByCourt.get(row.court_code);
      return {
        courtCode: String(row.court_code),
        courtName: String(row.court_name),
        circuit: textValue(row.circuit),
        rssAvailable: Boolean(row.rss_available),
        healthState: String(row.health_state),
        lastCheck: textValue(row.last_successful_retrieval),
        lastNewItem: event ? textValue(event.last_event_at) : null,
        lastPublication: event ? textValue(event.last_published_at) : null,
        backlog: event ? numberValue(event.pending) : 0,
        publishedCount: event ? numberValue(event.published) : 0,
        errors: numberValue(row.consecutive_failures),
        needsReview: event ? numberValue(event.needs_review) : 0,
      };
    });
  }, []);
}

export async function getFleetHeartbeat(sql: Sql): Promise<FleetHeartbeat> {
  const [scotus, circuits, districts] = await Promise.all([
    getScotusHeartbeat(sql),
    getCircuitHeartbeats(sql),
    getDistrictHeartbeats(sql),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    scotus,
    circuits,
    districts,
  };
}
