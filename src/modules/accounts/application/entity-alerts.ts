import type { Sql } from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { escapeHtml, type EmailProvider } from "../infrastructure/email";
import { partyCaptionMatchSql } from "../domain/party-names";
import { TOPICS, topicMatchSql } from "../domain/topics";
import { KIND_LABEL, TIMING_NOTE, type EntityFrequency, type EntityKind } from "../domain/entity-follow";
import { alertEligibleSql, followEligibleSql } from "./follows";
import { oneClickUnsubscribeUrl, unsubscribeUrl } from "./alerts";
import { effectivePlan, planLimits, CADENCE_INTERVAL_MS, type AlertCadence } from "../domain/plans";
import { EMERGENCY_TIMING_NOTE, EVENT_LABEL as APPLICATION_EVENT_LABEL, easternWeekday, emergencyFeedConditionSql } from "@/modules/scotus/domain/emergency-application";

// Judge / topic / party alerts. Two steps, both run by the 10-minute
// "account-alerts" scheduler job:
//
// 1. matchEntityAlerts scans what arrived since its cursors (new docket
//    entries, new opinions, newly published cases, new judge assignments),
//    keeps what matches someone's follow and stores it in entity_alert_item
//    with a public-safe summary. Runs even while email is off, so My alerts
//    shows matches.
// 2. sendEntityAlerts emails queued matches: "asap" follows on the next tick,
//    "daily" follows once a day. No-op without an email provider.
//
// Privacy: only published, displayable, followable (not sealed or restricted)
// cases. Docket text is shown only for Supreme Court entries that are publicly
// displayable; every other court's entry is described as "New docket entry"
// with its date (the level the case page already shows). Entries whose text
// or publication decision signals sealing or restriction are never stored.

/** Leave rows this fresh for the next run (in-flight ingestion transactions). */
const SETTLE_INTERVAL = "2 minutes";
/** Most one run scans per source (a job outage catches up in steps). */
const MAX_WINDOW_HOURS = 6;
/** A docket entry filed longer before Jurvio picked it up is history, not news. */
const ENTRY_NEWS_DAYS = 14;
/** New cases and opinions: filed within this many days. */
const NEW_CASE_DAYS = 30;
const DECISION_DAYS = 30;
/** Bound what one run can store per follow (a broad topic on a busy day). */
const MAX_ITEMS_PER_FOLLOW_PER_RUN = 300;
/** Matches listed per follow in one email. */
export const MAX_ITEMS_PER_FOLLOW_IN_EMAIL = 15;
const CADENCE_SLACK_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Words that mark a sealed / restricted entry; such entries are never stored. */
export const RESTRICTED_TEXT = "\\m(seal|seals|sealed|sealing|unseal|unsealed|under seal|ex parte|in camera|grand jury|juvenile|restricted|suppressed|redacted)\\M";
/** Publication decision reasons that mean "hidden because restricted", not just "not shown by policy". */
const RESTRICTED_REASON = "(seal|restrict|sensitive|suppress|privacy|minor|juvenile)";


export interface EntityMatchSummary {
  status: "done" | "skipped";
  reason?: string;
  follows: number;
  windowFrom: string | null;
  windowTo: string | null;
  events: number;
  candidates: number;
  stored: number;
  byKind: Record<EntityKind, number>;
}

const SOURCES = ["docket_entry", "document", "legal_case", "judge_case_assignment"] as const;

/** SQL CASE turning an application event kind into its short label (fixed catalog, safe to inline). */
function applicationLabelSql(column: string): string {
  if (!/^[a-z_][a-z0-9_.]*$/.test(column)) throw new Error("invalid column");
  return `(CASE ${column} ${Object.entries(APPLICATION_EVENT_LABEL).map(([key, label]) => `WHEN '${key}' THEN '${label.replaceAll("'", "''")}'`).join(" ")} END)`;
}

function restrictedEntrySql(entryAlias: string): string {
  return `EXISTS (SELECT 1 FROM publication_decision restricted_decision
    WHERE restricted_decision.object_type = 'docket_entry' AND restricted_decision.object_id = ${entryAlias}.id
      AND NOT restricted_decision.displayable AND restricted_decision.reason_code ~* '${RESTRICTED_REASON}')`;
}

/** A SQL timestamp expression: an ISO literal or one of a few fixed now()-based forms. */
function timestampSql(value: Date | string): string {
  if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`;
  if (/^now\(\)( - interval '\d{1,3} (minutes|hours|days)')?$/.test(value)) return value;
  throw new Error(`unsupported timestamp expression: ${value}`);
}

export interface EntityMatchSqlOptions {
  from: Date | string;
  to: Date | string;
  /**
   * Relation with columns (id, kind, target_key, created_at) to match against.
   * Production: entity_follow. The dry-run report: the test account's follows
   * with created_at moved back to the window start.
   */
  follows: string;
  /** Topic slugs to build topic conditions for (default: the whole catalog). */
  topicSlugs?: readonly string[];
}

/**
 * The matching query as CTEs, ending in `kept` (one row per follow and item
 * with its public-safe summary) and `ranked` (row number per follow, newest
 * first). One source of truth for the job (INSERT ... SELECT FROM ranked) and
 * for the read-only dry-run report (scripts/diag/entity-alerts-dry-run.sql).
 * Contains no data-changing statement, so it runs in a READ ONLY transaction.
 */
export function entityMatchCtes(options: EntityMatchSqlOptions): string {
  const from = timestampSql(options.from);
  const to = timestampSql(options.to);
  const topics = TOPICS.filter((topic) => !options.topicSlugs || options.topicSlugs.includes(topic.slug));
  const topicCondition = topics.length
    ? topics.map((topic) => `(f.target_key = '${topic.slug}' AND ${topicMatchSql(topic, "c.nature_of_suit_code")})`).join("\n          OR ")
    : "false";
  const restricted = RESTRICTED_TEXT.replaceAll("'", "''");
  return `    match_follow AS MATERIALIZED (
      SELECT id, kind, target_key, created_at FROM ${options.follows}
      WHERE id NOT IN (
        SELECT paused.id FROM entity_follow paused
        LEFT JOIN account_subscription subscription
          ON subscription.user_id = paused.user_id
         AND subscription.plan IN ('plus', 'pro', 'team')
         AND subscription.status IN ('active', 'trialing', 'past_due')
        WHERE paused.kind IN ('judge', 'court', 'party', 'topic')
          AND (paused.status = 'needs_upgrade' OR subscription.user_id IS NULL)
      )
    ),
    match_event AS MATERIALIZED (
      SELECT 'entry:' || e.id AS item_key, e.case_id, 'docket_entry' AS event_kind, e.filed_on AS occurred_on,
        e.id AS entry_id, NULL::uuid AS document_id, e.created_at AS event_at
      FROM docket_entry e
      WHERE EXISTS (SELECT 1 FROM match_follow)
        AND e.created_at > ${from} AND e.created_at <= ${to}
        AND e.filed_on IS NOT NULL AND e.filed_on >= (${to} - interval '${ENTRY_NEWS_DAYS} days')::date
        AND e.description !~* '${restricted}'
      UNION ALL
      SELECT 'doc:' || d.id, d.case_id, 'decision', d.filed_on, NULL::uuid, d.id, d.created_at
      FROM document d
      WHERE EXISTS (SELECT 1 FROM match_follow)
        AND d.created_at > ${from} AND d.created_at <= ${to}
        AND d.document_type LIKE '%opinion%'
        AND d.filed_on IS NOT NULL AND d.filed_on >= (${to} - interval '${DECISION_DAYS} days')::date
        AND d.title !~* '${restricted}'
      UNION ALL
      SELECT 'case:' || c.id, c.id, 'new_case', c.filed_on, NULL::uuid, NULL::uuid, c.updated_at
      FROM legal_case c
      WHERE EXISTS (SELECT 1 FROM match_follow)
        AND c.publication = 'published' AND c.updated_at > ${from} AND c.updated_at <= ${to}
        AND c.filed_on IS NOT NULL AND c.filed_on >= (${to} - interval '${NEW_CASE_DAYS} days')::date
      UNION ALL
      SELECT 'case:' || c.id, c.id, 'new_case', c.filed_on, NULL::uuid, NULL::uuid, a.created_at
      FROM judge_case_assignment a JOIN legal_case c ON c.id = a.case_id
      WHERE EXISTS (SELECT 1 FROM match_follow WHERE kind = 'judge')
        AND a.created_at > ${from} AND a.created_at <= ${to}
        AND c.publication = 'published'
        AND c.filed_on IS NOT NULL AND c.filed_on >= (${to} - interval '${NEW_CASE_DAYS} days')::date
    ),
    match_candidate AS MATERIALIZED (
      SELECT f.id AS follow_id, f.kind, ev.*
      FROM match_follow f
      JOIN judge j ON j.public_id = f.target_key
      JOIN match_event ev ON ev.event_at > f.created_at
      WHERE f.kind = 'judge'
        AND (EXISTS (SELECT 1 FROM judge_case_assignment a WHERE a.case_id = ev.case_id AND a.judge_id = j.id)
          OR EXISTS (SELECT 1 FROM appeals_panel_seat s WHERE s.case_id = ev.case_id AND s.judge_id = j.id))
      UNION ALL
      SELECT f.id, f.kind, ev.*
      FROM match_follow f
      JOIN match_event ev ON ev.event_at > f.created_at
      JOIN legal_case c ON c.id = ev.case_id
      WHERE f.kind = 'party'
        AND (${partyCaptionMatchSql("c.caption", "f.target_key")}
          OR EXISTS (SELECT 1 FROM party_appearance pa JOIN entity en ON en.id = pa.entity_id
            WHERE pa.case_id = ev.case_id AND ${partyCaptionMatchSql("en.display_name", "f.target_key")}))
      UNION ALL
      SELECT f.id, f.kind, ev.*
      FROM match_follow f
      JOIN match_event ev ON ev.event_at > f.created_at
      JOIN legal_case c ON c.id = ev.case_id
      WHERE f.kind = 'topic'
        AND (${topicCondition})
      UNION ALL
      SELECT f.id, f.kind, ev.*
      FROM match_follow f
      JOIN match_event ev ON ev.event_at > f.created_at
      JOIN scotus_application a ON a.case_id = ev.case_id
      WHERE f.kind = 'emergency' AND ev.event_kind IN ('docket_entry', 'new_case')
        AND ${emergencyFeedConditionSql("a")}
      UNION ALL
      SELECT f.id, f.kind, ev.*
      FROM match_follow f
      JOIN match_event ev ON ev.event_at > f.created_at
      JOIN legal_case c ON c.id = ev.case_id
      JOIN court ON court.id = c.court_id AND court.public_id = f.target_key
      WHERE f.kind = 'court'
    ),
    kept AS (
      SELECT DISTINCT ON (cand.follow_id, cand.item_key)
        cand.follow_id, cand.kind, cand.item_key, cand.case_id, cand.event_kind, cand.occurred_on, cand.event_at,
        CASE WHEN cand.kind = 'emergency' THEN CASE cand.event_kind
            WHEN 'docket_entry' THEN left(coalesce(${applicationLabelSql("sae.kind")} || ': ', '') || regexp_replace(e.description, '\\s+', ' ', 'g'), 300)
            ELSE 'New emergency application' END
        ELSE CASE cand.event_kind
          WHEN 'new_case' THEN 'New case filed'
          WHEN 'decision' THEN left('Opinion: ' || regexp_replace(d.title, '\\s+', ' ', 'g'), 300)
          ELSE CASE WHEN lower(court.provider_court_id) = 'scotus'
            THEN left(regexp_replace(e.description, '\\s+', ' ', 'g'), 300)
            ELSE 'New docket entry' END
        END END AS summary
      FROM match_candidate cand
      JOIN legal_case c ON c.id = cand.case_id
      JOIN court ON court.id = c.court_id
      LEFT JOIN docket_entry e ON e.id = cand.entry_id
      LEFT JOIN document d ON d.id = cand.document_id
      LEFT JOIN scotus_application_event sae ON sae.source_record_id = e.provider_entry_id
      WHERE (CASE WHEN cand.kind = 'emergency' THEN ${alertEligibleSql("c")} ELSE ${followEligibleSql("c")} END)
        AND (cand.event_kind <> 'docket_entry' OR (
          e.id IS NOT NULL
          AND NOT ${restrictedEntrySql("e")}
          AND (lower(court.provider_court_id) <> 'scotus' OR ${latestPublicationColumnSql("displayable", "docket_entry", "e.id")})))
        AND (cand.event_kind <> 'decision' OR (
          d.id IS NOT NULL AND d.publication = 'published'
          AND ${latestPublicationColumnSql("displayable", "document", "d.id")}))
      ORDER BY cand.follow_id, cand.item_key, cand.event_at
    ),
    ranked AS (
      SELECT kept.*, row_number() OVER (PARTITION BY kept.follow_id ORDER BY kept.event_at DESC, kept.item_key) AS rn FROM kept
    )`;
}

/**
 * Finds new matches for every judge/topic/party follow and stores them, then
 * moves the cursors. `window` overrides the cursors (tests); `followIds`
 * limits matching to those follows; `dryRun` writes nothing and returns the
 * counts of what would be stored.
 */
export async function matchEntityAlerts(sql: Sql, options: {
  window?: { from: Date; to: Date };
  dryRun?: boolean;
  followIds?: string[];
} = {}): Promise<EntityMatchSummary> {
  const byKind: Record<EntityKind, number> = { judge: 0, topic: 0, party: 0, emergency: 0, court: 0 };
  return sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    if (options.followIds && !options.followIds.every((id) => /^[0-9a-f-]{36}$/.test(id))) throw new Error("invalid follow id");
    const followsRelation = options.followIds
      ? `(SELECT id, kind, target_key, created_at FROM entity_follow WHERE id IN (${options.followIds.map((id) => `'${id}'`).join(", ") || "NULL"})) scoped_follow`
      : "entity_follow";
    const [followRow] = await db<{ follows: number; topics: string[] | null }[]>`
      SELECT count(*)::int AS follows, array_agg(DISTINCT target_key) FILTER (WHERE kind = 'topic') AS topics
      FROM ${db.unsafe(followsRelation)}`;
    const follows = followRow?.follows ?? 0;

    const [bounds] = await db<{ settled: Date; oldest: Date | null }[]>`
      SELECT now() - ${SETTLE_INTERVAL}::interval AS settled,
        (SELECT min(scanned_to) FROM entity_alert_cursor) AS oldest`;
    const settled = new Date(bounds!.settled);
    let from: Date;
    let to: Date;
    if (options.window) {
      ({ from, to } = options.window);
    } else {
      from = bounds!.oldest ? new Date(bounds!.oldest) : settled;
      to = new Date(Math.min(settled.getTime(), from.getTime() + MAX_WINDOW_HOURS * 3_600_000));
    }
    const summary: EntityMatchSummary = {
      status: "done", follows, windowFrom: from.toISOString(), windowTo: to.toISOString(),
      events: 0, candidates: 0, stored: 0, byKind,
    };
    const advance = async () => {
      if (options.window || options.dryRun) return;
      await db`
        INSERT INTO entity_alert_cursor (source, scanned_to, updated_at)
        SELECT source, ${to}, now() FROM unnest(${db.array([...SOURCES])}::text[]) AS source
        ON CONFLICT (source) DO UPDATE SET scanned_to = GREATEST(entity_alert_cursor.scanned_to, EXCLUDED.scanned_to), updated_at = now()`;
    };
    if (to <= from) return { ...summary, status: "skipped", reason: "nothing new to scan" };
    if (follows === 0) {
      await advance();
      return { ...summary, status: "skipped", reason: "no judge, topic or party follows" };
    }

    const ctes = entityMatchCtes({ from, to, follows: followsRelation, topicSlugs: followRow?.topics ?? [] });
    if (options.dryRun) {
      const rows = await db<{ kind: EntityKind; n: number; events: number; candidates: number }[]>`
        WITH ${db.unsafe(ctes)}
        SELECT k.kind, k.n, (SELECT count(*)::int FROM match_event) AS events, (SELECT count(*)::int FROM match_candidate) AS candidates
        FROM (SELECT kind, count(*)::int AS n FROM ranked
          WHERE NOT EXISTS (SELECT 1 FROM entity_alert_item i WHERE i.follow_id = ranked.follow_id AND i.item_key = ranked.item_key)
          GROUP BY kind) k`;
      for (const row of rows) { byKind[row.kind] = row.n; summary.stored += row.n; summary.events = row.events; summary.candidates = row.candidates; }
      return summary;
    }
    const stored = await db<{ kind: EntityKind; events: number; candidates: number }[]>`
      WITH ${db.unsafe(ctes)},
      inserted AS (
        INSERT INTO entity_alert_item (follow_id, item_key, case_id, event_kind, occurred_on, summary)
        SELECT follow_id, item_key, case_id, event_kind, occurred_on, summary FROM ranked WHERE rn <= ${MAX_ITEMS_PER_FOLLOW_PER_RUN}
        ON CONFLICT (follow_id, item_key) DO NOTHING
        RETURNING follow_id
      )
      SELECT f.kind, (SELECT count(*)::int FROM match_event) AS events, (SELECT count(*)::int FROM match_candidate) AS candidates
      FROM inserted JOIN entity_follow f ON f.id = inserted.follow_id
      UNION ALL
      SELECT NULL, (SELECT count(*)::int FROM match_event), (SELECT count(*)::int FROM match_candidate)`;
    for (const row of stored) {
      summary.events = row.events;
      summary.candidates = row.candidates;
      if (row.kind) { byKind[row.kind] += 1; summary.stored += 1; }
    }
    await advance();
    return summary;
  });
}

export interface EntityDigestItem {
  followId: string;
  kind: EntityKind;
  label: string;
  casePublicId: string;
  caption: string;
  courtName: string | null;
  docketNumber: string;
  eventKind: "new_case" | "docket_entry" | "decision";
  occurredOn: string | null;
  summary: string;
}

export interface EntitySendSummary {
  status: "done" | "skipped";
  reason?: string;
  users: number;
  sent: number;
  failed: number;
  items: number;
}

function clean(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const EVENT_LABEL = { new_case: "New case", docket_entry: "Docket", decision: "Decision" } as const;

export function buildEntityDigestEmail(input: {
  items: EntityDigestItem[];
  more: Map<string, number>;
  siteUrl: string;
  unsubscribeToken: string;
  postalAddress: string;
  frequency: EntityFrequency | "mixed";
}) {
  const groups = new Map<string, EntityDigestItem[]>();
  for (const item of input.items) groups.set(item.followId, [...(groups.get(item.followId) ?? []), item]);
  const total = input.items.length + [...input.more.values()].reduce((sum, n) => sum + n, 0);
  const first = input.items[0]!;
  const subject = groups.size === 1
    ? `${total} new ${total === 1 ? "match" : "matches"} for ${KIND_LABEL[first.kind].toLowerCase()} ${clean(first.label, 60)}`
    : `${total} new matches for ${groups.size} alerts you follow`;
  const caseUrl = (id: string) => new URL(`/case/${id}`, input.siteUrl).toString();
  const itemUrl = (item: EntityDigestItem) => item.kind === "emergency" && /^\d{2}A\d{1,4}$/.test(item.docketNumber)
    ? new URL(`/supreme-court/emergency/${item.docketNumber}`, input.siteUrl).toString() : caseUrl(item.casePublicId);
  const hasEmergency = input.items.some((item) => item.kind === "emergency");
  const timing = hasEmergency ? `${EMERGENCY_TIMING_NOTE} ${TIMING_NOTE}` : TIMING_NOTE;
  const alertsUrl = new URL("/alerts", input.siteUrl).toString();
  const unsubscribe = unsubscribeUrl(input.siteUrl, input.unsubscribeToken);
  const how = input.frequency === "daily" ? "daily digest" : input.frequency === "asap" ? "alerts as matches are found" : "alerts";

  const text: string[] = [];
  const html: string[] = [];
  for (const [followId, items] of groups) {
    const head = `${KIND_LABEL[items[0]!.kind]}: ${clean(items[0]!.label, 120)}`;
    text.push(head, "");
    html.push(`<h2 style="font-size:16px;margin:20px 0 6px">${escapeHtml(head)}</h2><ul style="padding-left:18px;margin:0">`);
    for (const item of items) {
      const meta = [item.courtName, item.docketNumber, item.occurredOn ? `filed ${item.occurredOn}` : null].filter(Boolean).join(" · ");
      text.push(`- ${clean(item.caption, 140)}`, `  ${EVENT_LABEL[item.eventKind]}: ${clean(item.summary, 300)}`, `  ${meta}`, `  ${itemUrl(item)}`, "");
      html.push(`<li style="margin:0 0 10px"><a href="${escapeHtml(itemUrl(item))}">${escapeHtml(clean(item.caption, 140))}</a><br>`
        + `<strong>${escapeHtml(EVENT_LABEL[item.eventKind])}:</strong> ${escapeHtml(clean(item.summary, 300))}<br>`
        + `<span style="color:#5b6678">${escapeHtml(meta)}</span></li>`);
    }
    const more = input.more.get(followId) ?? 0;
    if (more > 0) {
      text.push(`  …and ${more} more on My alerts: ${alertsUrl}`, "");
      html.push(`<li style="list-style:none;color:#5b6678">…and ${more} more on <a href="${escapeHtml(alertsUrl)}">My alerts</a></li>`);
    }
    html.push("</ul>");
  }
  const footerText = [
    `You get Jurvio ${how} for what you follow. ${timing}`,
    "Only public court records are included; sealed or restricted filings are never sent. Jurvio is not legal advice.",
    `Manage alerts: ${alertsUrl}`,
    `Unsubscribe from all alerts: ${unsubscribe}`,
    input.postalAddress,
  ];
  return {
    subject,
    text: [...text, "--", ...footerText].join("\n"),
    html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#13202f;max-width:640px">
<h1 style="font-size:18px">${escapeHtml(subject)}</h1>
${html.join("\n")}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="font-size:12px;color:#5b6678">You get Jurvio ${escapeHtml(how)} for what you follow. ${escapeHtml(timing)}<br>
Only public court records are included; sealed or restricted filings are never sent. Jurvio is not legal advice.<br>
<a href="${escapeHtml(alertsUrl)}">Manage alerts</a> · <a href="${escapeHtml(unsubscribe)}">Unsubscribe from alerts</a><br>
${escapeHtml(input.postalAddress)}</p>
</body></html>`,
  };
}

/** True when a follow with this frequency and last send is due now. */
export function entityFollowDue(frequency: EntityFrequency, lastSentAt: Date | null, createdAt: Date, now: Date,
  options: { kind?: EntityKind; cadence?: AlertCadence } = {}): boolean {
  const dailyDue = () => now.getTime() - (lastSentAt ?? createdAt).getTime() >= DAY_MS - CADENCE_SLACK_MS;
  if (options.kind === "emergency") {
    // Emergency-docket feeds: the daily email goes out on weekdays only ("Emergency docket today");
    // "as found" follows the plan's cadence: Pro/Team every 10-minute tick, Plus at most hourly.
    const weekday = easternWeekday(now) >= 1 && easternWeekday(now) <= 5;
    const cadence = options.cadence ?? "daily";
    if (frequency === "daily" || cadence === "daily") return weekday && dailyDue();
    if (cadence === "hourly") return !lastSentAt || now.getTime() - lastSentAt.getTime() >= CADENCE_INTERVAL_MS.hourly - CADENCE_SLACK_MS;
    return true;
  }
  if (frequency === "asap") return true;
  return dailyDue();
}

export async function sendEntityAlerts(sql: Sql, deps: {
  provider: EmailProvider | null;
  siteUrl: string;
  postalAddress: string | null | undefined;
  maxUsers?: number;
  now?: Date;
}): Promise<EntitySendSummary> {
  const empty = { users: 0, sent: 0, failed: 0, items: 0 };
  if (!deps.provider) return { status: "skipped", reason: "email provider not configured (RESEND_API_KEY, EMAIL_FROM)", ...empty };
  const postalAddress = deps.postalAddress?.trim();
  if (!postalAddress) return { status: "skipped", reason: "EMAIL_POSTAL_ADDRESS not configured", ...empty };
  const now = deps.now ?? new Date();
  const summary: EntitySendSummary = { status: "done", ...empty };

  type DueFollow = { id: string; userId: string; email: string; token: string; kind: EntityKind; frequency: EntityFrequency;
    lastSentAt: Date | null; createdAt: Date; plan: string | null; planStatus: string | null };
  const follows = await sql<DueFollow[]>`
    SELECT f.id, f.user_id AS "userId", u.email, u.unsubscribe_token AS token, f.kind, f.frequency,
      f.last_sent_at AS "lastSentAt", f.created_at AS "createdAt", s.plan::text AS plan, s.status AS "planStatus"
    FROM entity_follow f JOIN app_user u ON u.id = f.user_id
    LEFT JOIN account_subscription s ON s.user_id = u.id
    WHERE u.alerts_unsubscribed_at IS NULL AND u.email_verified_at IS NOT NULL
      AND f.status = 'active'
      AND (
        f.kind NOT IN ('judge', 'court', 'party', 'topic')
        OR (
          s.plan IN ('plus', 'pro', 'team')
          AND s.status IN ('active', 'trialing', 'past_due')
        )
      )
      AND EXISTS (SELECT 1 FROM entity_alert_item i WHERE i.follow_id = f.id AND i.sent_at IS NULL)
    ORDER BY f.user_id, f.created_at
    LIMIT 20000`;
  const byUser = new Map<string, DueFollow[]>();
  for (const follow of follows) {
    const cadence = planLimits(effectivePlan(follow.plan ? { plan: follow.plan, status: follow.planStatus ?? "active" } : null)).alertCadence;
    if (!entityFollowDue(follow.frequency, follow.lastSentAt ? new Date(follow.lastSentAt) : null, new Date(follow.createdAt), now,
      { kind: follow.kind, cadence })) continue;
    byUser.set(follow.userId, [...(byUser.get(follow.userId) ?? []), follow]);
  }
  for (const [userId, due] of byUser) {
    if (summary.users >= (deps.maxUsers ?? 500)) break;
    summary.users += 1;
    const followIds = due.map((follow) => follow.id);
    // Re-check visibility at send time: a case can be sealed after a match was stored.
    const rows = await sql<Array<EntityDigestItem & { itemKey: string; rn: number; visible: boolean }>>`
      SELECT i.follow_id AS "followId", f.kind, f.label, i.item_key AS "itemKey", c.public_id AS "casePublicId", c.caption,
        court.name AS "courtName", c.docket_number AS "docketNumber", i.event_kind AS "eventKind",
        i.occurred_on::text AS "occurredOn", i.summary,
        row_number() OVER (PARTITION BY i.follow_id ORDER BY i.found_at DESC, i.item_key)::int AS rn,
        (CASE WHEN f.kind = 'emergency' THEN ${sql.unsafe(alertEligibleSql("c"))} ELSE ${sql.unsafe(followEligibleSql("c"))} END) AS visible
      FROM entity_alert_item i
      JOIN entity_follow f ON f.id = i.follow_id
      JOIN legal_case c ON c.id = i.case_id
      LEFT JOIN court ON court.id = c.court_id
      WHERE i.follow_id = ANY(${followIds}) AND i.sent_at IS NULL
      ORDER BY f.created_at, i.found_at DESC`;
    const visible = rows.filter((row) => row.visible);
    const keys = rows.map((row) => `${row.followId}|${row.itemKey}`);
    const markSent = async (db: Sql) => {
      await db`
        UPDATE entity_alert_item i SET sent_at = ${now}
        FROM unnest(${db.array(keys)}::text[]) AS k(key)
        WHERE i.follow_id::text || '|' || i.item_key = k.key AND i.sent_at IS NULL`;
      await db`UPDATE entity_follow SET last_sent_at = ${now} WHERE id = ANY(${followIds})`;
    };
    if (visible.length === 0) {
      await markSent(sql);
      continue;
    }
    const shown = visible.filter((row) => row.rn <= MAX_ITEMS_PER_FOLLOW_IN_EMAIL);
    const more = new Map<string, number>();
    for (const row of visible) if (row.rn > MAX_ITEMS_PER_FOLLOW_IN_EMAIL) more.set(row.followId, (more.get(row.followId) ?? 0) + 1);
    const frequencies = new Set(due.map((follow) => follow.frequency));
    const message = buildEntityDigestEmail({
      items: shown, more, siteUrl: deps.siteUrl, unsubscribeToken: due[0]!.token, postalAddress,
      frequency: frequencies.size === 1 ? [...frequencies][0]! : "mixed",
    });
    const result = await deps.provider.send({
      to: due[0]!.email,
      ...message,
      tag: "alert_digest",
      headers: {
        "List-Unsubscribe": `<${oneClickUnsubscribeUrl(deps.siteUrl, due[0]!.token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await sql`
      INSERT INTO email_event (user_id, kind, provider, status, provider_message_id, detail)
      VALUES (${userId}, 'alert_digest', ${deps.provider.name}, ${result.ok ? "sent" : "failed"}, ${result.providerMessageId ?? null},
        ${sql.json({ type: "entity", follows: followIds.length, items: visible.length, ...(result.error ? { error: result.error } : {}) })})`;
    if (!result.ok) { summary.failed += 1; continue; }
    await sql.begin(async (tx) => markSent(tx as unknown as Sql));
    summary.sent += 1;
    summary.items += visible.length;
  }
  return summary;
}

