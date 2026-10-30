import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * Retention for the district CM/ECF RSS live feed.
 *
 * A district feed repeats its last 24 hours on every poll, so every item gets a
 * `direct_court_event` row (for deduplication and linking) and, when it lands on
 * a case, a `docket_entry` plus a `direct_court_alert_event`. Before this rule
 * nothing ever deleted the event or alert rows.
 *
 * What is kept and what is pruned:
 *   - `docket_entry` rows are never touched: the entries on cases are the product.
 *   - alert rows older than `alertDays` (default 90) are deleted.
 *   - event rows whose `last_seen_at` is older than `eventDays` (default 30) and
 *     that no longer have an alert row are deleted. A feed covers 24 hours
 *     (`rss_coverage_hours`), so an item last seen 30 days ago cannot come back
 *     through the feed; if it ever did, the docket_entry upsert on
 *     (provider_id, provider_entry_id = deduplication key) keeps it single.
 *     Linked events therefore live as long as their alert (90 days); unlinked
 *     (`needs_review`) and restricted (`suppressed`) events go after 30 days.
 *
 * Work per call is bounded (`batchSize` rows per statement, at most `maxBatches`
 * statements per table) so the pass can run at the end of every feed run.
 */
export interface DirectCourtRetentionOptions {
  eventDays?: number;
  alertDays?: number;
  batchSize?: number;
  maxBatches?: number;
}

export interface DirectCourtRetentionResult {
  alertsDeleted: number;
  eventsDeleted: number;
  eventDays: number;
  alertDays: number;
  /** True when a table still had rows past the cutoff after maxBatches. */
  backlog: boolean;
}

export const DIRECT_COURT_EVENT_RETENTION_DAYS = 30;
export const DIRECT_COURT_ALERT_RETENTION_DAYS = 90;
/** The feed covers 24h; never prune anything the next polls could still return. */
const MIN_EVENT_DAYS = 7;

export async function pruneDirectCourtEvents(
  sql: Sql,
  options: DirectCourtRetentionOptions = {},
): Promise<DirectCourtRetentionResult> {
  const eventDays = Math.max(MIN_EVENT_DAYS, Math.floor(options.eventDays ?? DIRECT_COURT_EVENT_RETENTION_DAYS));
  const alertDays = Math.max(eventDays, Math.floor(options.alertDays ?? DIRECT_COURT_ALERT_RETENTION_DAYS));
  const batchSize = Math.min(20_000, Math.max(1, Math.floor(options.batchSize ?? 5_000)));
  const maxBatches = Math.min(100, Math.max(1, Math.floor(options.maxBatches ?? 4)));

  let alertsDeleted = 0;
  let alertBacklog = false;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await sql`
      DELETE FROM direct_court_alert_event alert
      WHERE alert.id IN (
        SELECT id FROM direct_court_alert_event
        WHERE created_at < now() - make_interval(days => ${alertDays})
        ORDER BY created_at
        LIMIT ${batchSize}
      )
    `;
    alertsDeleted += deleted.count;
    alertBacklog = deleted.count === batchSize;
    if (!alertBacklog) break;
  }

  let eventsDeleted = 0;
  let eventBacklog = false;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await sql`
      DELETE FROM direct_court_event event
      WHERE event.id IN (
        SELECT candidate.id FROM direct_court_event candidate
        WHERE candidate.last_seen_at < now() - make_interval(days => ${eventDays})
          AND candidate.first_seen_at < now() - make_interval(days => ${eventDays})
          AND NOT EXISTS (
            SELECT 1 FROM direct_court_alert_event alert WHERE alert.direct_event_id = candidate.id
          )
        ORDER BY candidate.last_seen_at
        LIMIT ${batchSize}
      )
    `;
    eventsDeleted += deleted.count;
    eventBacklog = deleted.count === batchSize;
    if (!eventBacklog) break;
  }

  return { alertsDeleted, eventsDeleted, eventDays, alertDays, backlog: alertBacklog || eventBacklog };
}
