/**
 * Precomputed emergency docket analytics (migration 0196).
 *
 * refreshEmergencyStats: rebuilds scotus_emergency_stat(_vote/_meta) from
 * scotus_application in one transaction. Called by the scotus-emergency job
 * after its run, only when applications changed since the last rebuild (at
 * most every 30 minutes) or the counts are over 6 hours old. One indexed read
 * of compact columns; a few thousand rows written.
 *
 * loadEmergencyStats: what the Pro page reads (the small count tables, cached
 * in memory for two minutes). Never touches applications or docket lines.
 */
import type postgres from "postgres";
import { visibleSql } from "./emergency-docket";
import { buildStatRows, type StatRow, type StatSourceRow, type VoteRow } from "@/modules/scotus/domain/emergency-stats";

type Sql = ReturnType<typeof postgres>;

export interface StatMeta {
  refreshedAt: string;
  applications: number;
  historyApplications: number;
  /** complete: the history backfill read this docket year end to end (migration 0197). */
  terms: Array<{ term: number; applications: number; serious: number; history: number; complete: boolean }>;
  /** First docket year the history backfill covers. */
  historyFrom: number;
  speed: { lines: number; medianMinutesAfterDocketDay: number | null };
}

export const HISTORY_FROM = 2017;

/** Docket years the history backfill has read end to end; none before migration 0197. */
async function completeTerms(sql: Sql): Promise<Set<number>> {
  try {
    const rows = await sql<{ term: number }[]>`SELECT term FROM scotus_emergency_history_coverage WHERE complete`;
    return new Set(rows.map((row) => Number(row.term)));
  } catch (error) {
    if (missingRelation(error)) return new Set();
    throw error;
  }
}

export interface RefreshResult { refreshed: boolean; reason: string; statRows?: number; voteRows?: number; applications?: number; elapsedMs?: number }

function missingRelation(error: unknown) {
  const code = (error as { code?: string }).code;
  return code === "42P01" || code === "42703";
}

export async function refreshEmergencyStats(sql: Sql, options: { force?: boolean; minIntervalMinutes?: number; maxAgeMinutes?: number } = {}): Promise<RefreshResult> {
  const started = Date.now();
  try {
    const [state] = await sql<{ changed: Date | null; refreshed: Date | null; source: Date | null }[]>`
      SELECT (SELECT max(updated_at) FROM scotus_application) AS changed,
        (SELECT refreshed_at FROM scotus_emergency_stat_meta WHERE id = 1) AS refreshed,
        (SELECT source_changed_at FROM scotus_emergency_stat_meta WHERE id = 1) AS source`;
    const ageMinutes = state?.refreshed ? (Date.now() - new Date(state.refreshed).getTime()) / 60_000 : Infinity;
    const changed = !state?.source || (state.changed && new Date(state.changed) > new Date(state.source));
    if (!options.force) {
      if (ageMinutes < (options.minIntervalMinutes ?? 30)) return { refreshed: false, reason: "refreshed recently" };
      if (!changed && ageMinutes < (options.maxAgeMinutes ?? 360)) return { refreshed: false, reason: "no changes" };
    }
    const complete = await completeTerms(sql);
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '60s'`;
      await tx`SET LOCAL lock_timeout = '5s'`;
      const source = await tx<Array<StatSourceRow & { history: boolean }>>`
        SELECT a.docket_number AS "docketNumber", a.kind, a.status, a.applicant_kind AS "applicantKind", a.administration,
          a.lower_court AS "lowerCourt", a.submitted_justice AS "submittedJustice", a.submitted_on::text AS "submittedOn",
          a.referred_on::text AS "referredOn", a.ruled_by AS "ruledBy", a.ruling_on::text AS "rulingOn",
          (a.response_due_on IS NOT NULL OR a.response_requested_by IS NOT NULL) AS "responseRequested",
          a.admin_stay_on::text AS "adminStayOn", a.written_reasons AS "writtenReasons", a.noted_votes AS "notedVotes",
          a.source_lane = 'history' AS history
        FROM scotus_application a
        WHERE ${tx.unsafe(visibleSql("a"))}`;
      const { stats, votes } = buildStatRows(source);
      const [speed] = await tx<StatMeta["speed"][]>`
        SELECT count(*)::int AS lines,
          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM detected_at - (filed_on::timestamp AT TIME ZONE 'America/New_York')) / 60))::int AS "medianMinutesAfterDocketDay"
        FROM scotus_application_event WHERE NOT backfilled AND filed_on IS NOT NULL AND detected_at > now() - interval '90 days'`;
      const terms = new Map<number, StatMeta["terms"][number]>();
      for (const row of source) {
        const term = 2000 + Number(row.docketNumber.slice(0, 2));
        const entry = terms.get(term) ?? { term, applications: 0, serious: 0, history: 0, complete: complete.has(term) };
        entry.applications += 1;
        if (row.kind !== "extension") entry.serious += 1;
        if (row.history) entry.history += 1;
        terms.set(term, entry);
      }
      await tx`DELETE FROM scotus_emergency_stat`;
      await tx`DELETE FROM scotus_emergency_stat_vote`;
      for (let index = 0; index < stats.length; index += 1000) {
        const chunk = stats.slice(index, index + 1000).map((row) => ({
          term: row.term, administration: row.administration, applicant_kind: row.applicantKind, lower_group: row.lowerGroup,
          justice: row.justice, extension: row.extension, kind: row.kind, outcome: row.outcome, referred: row.referred,
          response_requested: row.responseRequested, admin_stay: row.adminStay, written: row.written, days: row.days,
          applications: row.applications, with_votes: row.withVotes,
        }));
        await tx`INSERT INTO scotus_emergency_stat ${tx(chunk)}`;
      }
      for (let index = 0; index < votes.length; index += 1000) {
        const chunk = votes.slice(index, index + 1000).map((row) => ({
          term: row.term, applicant_kind: row.applicantKind, lower_group: row.lowerGroup, extension: row.extension,
          voter: row.voter, position: row.position, notes: row.notes,
        }));
        await tx`INSERT INTO scotus_emergency_stat_vote ${tx(chunk)}`;
      }
      const meta = {
        terms: [...terms.values()].sort((a, b) => a.term - b.term),
        historyFrom: HISTORY_FROM,
        speed: speed ?? { lines: 0, medianMinutesAfterDocketDay: null },
      };
      const elapsedMs = Date.now() - started;
      await tx`
        INSERT INTO scotus_emergency_stat_meta (id, refreshed_at, source_changed_at, applications, history_applications, terms, stat_rows, elapsed_ms)
        VALUES (1, now(), ${state?.changed ?? null}, ${source.length}, ${source.filter((row) => row.history).length},
          ${tx.json(meta as unknown as postgres.JSONValue)}, ${stats.length}, ${elapsedMs})
        ON CONFLICT (id) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at, source_changed_at = EXCLUDED.source_changed_at,
          applications = EXCLUDED.applications, history_applications = EXCLUDED.history_applications, terms = EXCLUDED.terms,
          stat_rows = EXCLUDED.stat_rows, elapsed_ms = EXCLUDED.elapsed_ms`;
      return { refreshed: true, reason: options.force ? "forced" : changed ? "applications changed" : "periodic", statRows: stats.length,
        voteRows: votes.length, applications: source.length, elapsedMs };
    });
  } catch (error) {
    if (missingRelation(error)) return { refreshed: false, reason: "tables missing (migration 0196 not applied)" };
    throw error;
  }
}

export interface EmergencyStats { stats: StatRow[]; votes: VoteRow[]; meta: StatMeta }

let cache: { at: number; value: EmergencyStats } | null = null;
const CACHE_MS = 120_000;

/** For tests and the refresh script: drop the in-memory copy. */
export function resetEmergencyStatsCache() { cache = null; }

export async function loadEmergencyStats(sql: Sql): Promise<EmergencyStats | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const value = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '4000ms'`;
      const [meta] = await tx<Array<{ refreshedAt: string; applications: number; historyApplications: number; terms: { terms: StatMeta["terms"]; speed: StatMeta["speed"]; historyFrom?: number } }>>`
        SELECT to_json(refreshed_at)#>>'{}' AS "refreshedAt", applications, history_applications AS "historyApplications", terms
        FROM scotus_emergency_stat_meta WHERE id = 1`;
      if (!meta) return null;
      const stats = await tx<StatRow[]>`
        SELECT term::int, administration, applicant_kind AS "applicantKind", lower_group AS "lowerGroup", justice, extension, kind,
          outcome, referred, response_requested AS "responseRequested", admin_stay AS "adminStay", written, days::int, applications, with_votes AS "withVotes"
        FROM scotus_emergency_stat`;
      const votes = await tx<VoteRow[]>`
        SELECT term::int, applicant_kind AS "applicantKind", lower_group AS "lowerGroup", extension, voter, position, notes
        FROM scotus_emergency_stat_vote`;
      return {
        stats: [...stats], votes: [...votes],
        meta: { refreshedAt: meta.refreshedAt, applications: meta.applications, historyApplications: meta.historyApplications,
          terms: (meta.terms?.terms ?? []).map((row) => ({ ...row, complete: row.complete === true })),
          historyFrom: meta.terms?.historyFrom ?? HISTORY_FROM, speed: meta.terms?.speed ?? { lines: 0, medianMinutesAfterDocketDay: null } },
      };
    });
    if (value) cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return null;
    throw error;
  }
}
