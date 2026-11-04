import type { Sql } from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { CADENCE_INTERVAL_MS, effectivePlan, planLimits, type AlertCadence } from "../domain/plans";
import { escapeHtml, type EmailProvider } from "../infrastructure/email";
import { citationCaseVisibleSql, citationDocumentVisibleSql } from "@/modules/citations/application/citation-edges";
import { alertEligibleSql, followEligibleSql } from "./follows";

// Docket-entry and citation alert digests for followed cases. Runs every 10 minutes from
// the production scheduler; each user is emailed at most once per their plan
// cadence (Free daily, Plus hourly, Pro/Team every 10 minutes; the internal
// cadence key is "instant", but customer copy never promises instant alerts).
// No provider or no postal address configured = the whole run is a no-op and
// nothing is marked as sent, so the first digest after email is turned on
// still covers what was filed.

export const MAX_ENTRIES_PER_CASE = 10;
export const MAX_CITATIONS_PER_CASE = 10;
/**
 * Citation alerts fire only for edges Jurvio's own parser found in a newly
 * ingested, recently filed opinion: the citing document reached Jurvio at most
 * this long before the edge appeared...
 */
const CITATION_NEW_DOCUMENT_DAYS = 14;
/** ...and was filed at most this long before (backlog parsing of old opinions is not news). */
const CITATION_RECENT_FILING_DAYS = 60;
/** Entries created this recently are left for the next run (in-flight ingestion transactions). */
const SETTLE_INTERVAL = "2 minutes";
/** A newly ingested entry filed long before the follow is history, not news. */
const BACKFILL_GRACE_DAYS = 14;
/** Small slack so a 10-minute tick does not drift a daily digest by a whole tick. */
const CADENCE_SLACK_MS = 2 * 60_000;

export interface AlertDeps {
  provider: EmailProvider | null;
  siteUrl: string;
  postalAddress: string | null | undefined;
  maxUsers?: number;
  now?: Date;
}

export interface AlertRunSummary {
  status: "skipped" | "done";
  reason?: string;
  candidates: number;
  due: number;
  sent: number;
  failed: number;
  emptyAdvanced: number;
}

export interface DigestEntry {
  casePublicId: string;
  caption: string;
  docketNumber: string;
  courtName: string | null;
  entryNumber: string | null;
  filedOn: string | null;
  description: string;
  /** Supreme Court emergency application docket number, when the case is one (links to its emergency page). */
  emergencyDocket?: string | null;
}

export interface CitationDigestEntry {
  casePublicId: string;
  caption: string;
  citingPublicId: string;
  citingCaption: string;
  citingCourtName: string | null;
  citingFiledOn: string | null;
  citationLabel: string | null;
}

/**
 * SQL condition: case_citation_edge `e` (citing document `d`) is a new
 * citation worth alerting on. Excludes edges from the first full sweep,
 * CourtListener-map-only edges and backlog parsing of old documents.
 */
export function alertableCitationEdgeSql(e = "e", d = "d"): string {
  for (const alias of [e, d]) if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  return `(
    (${e}.sources & 1) = 1
    AND ${e}.first_seen_at > (SELECT b.first_completed_at FROM citation_edge_build b)
    AND ${d}.created_at >= ${e}.first_seen_at - make_interval(days => ${CITATION_NEW_DOCUMENT_DAYS})
    AND (${e}.citing_filed_on IS NULL OR ${e}.citing_filed_on >= (${e}.first_seen_at - make_interval(days => ${CITATION_RECENT_FILING_DAYS}))::date)
  )`;
}

export function isDue(cadence: AlertCadence, lastDigestAt: Date | null, now: Date): boolean {
  if (!lastDigestAt) return true;
  return now.getTime() - lastDigestAt.getTime() >= CADENCE_INTERVAL_MS[cadence] - CADENCE_SLACK_MS;
}

function truncate(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function unsubscribeUrl(siteUrl: string, token: string) {
  const url = new URL("/alerts/unsubscribe", siteUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function oneClickUnsubscribeUrl(siteUrl: string, token: string) {
  const url = new URL("/api/alerts/unsubscribe", siteUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildDigestEmail(input: {
  entries: DigestEntry[];
  citations?: CitationDigestEntry[];
  siteUrl: string;
  unsubscribeToken: string;
  postalAddress: string;
  cadence: AlertCadence;
}) {
  const byCase = new Map<string, DigestEntry[]>();
  for (const entry of input.entries) byCase.set(entry.casePublicId, [...(byCase.get(entry.casePublicId) ?? []), entry]);
  const citations = input.citations ?? [];
  const citedCases = new Map<string, CitationDigestEntry[]>();
  for (const cite of citations) citedCases.set(cite.casePublicId, [...(citedCases.get(cite.casePublicId) ?? []), cite]);
  const total = input.entries.length;
  const citeTotal = citations.length;
  const citeSubject = citedCases.size === 1
    ? `${citeTotal} new ${citeTotal === 1 ? "opinion cites" : "opinions cite"} ${truncate(citations[0]!.caption, 70)}`
    : `${citeTotal} new citing opinions for ${citedCases.size} cases you follow`;
  const docketSubject = total === 0 ? "" : byCase.size === 1
    ? `${total} new docket ${total === 1 ? "entry" : "entries"}: ${truncate(input.entries[0]!.caption, 70)}`
    : `${total} new docket entries in ${byCase.size} cases you follow`;
  const subject = !citeTotal ? docketSubject
    : !total ? citeSubject
    : `${docketSubject} · ${citeTotal} new citing ${citeTotal === 1 ? "opinion" : "opinions"}`;
  const citedUrl = (id: string) => new URL(`/case/${id}#cited-by`, input.siteUrl).toString();
  const citingUrl = (id: string) => new URL(`/case/${id}`, input.siteUrl).toString();
  const emergencyByCase = new Map(input.entries.filter((entry) => entry.emergencyDocket).map((entry) => [entry.casePublicId, entry.emergencyDocket!]));
  const caseUrl = (id: string) => new URL(emergencyByCase.has(id) ? `/supreme-court/emergency/${emergencyByCase.get(id)}` : `/case/${id}/docket`, input.siteUrl).toString();
  const accountUrl = new URL("/account", input.siteUrl).toString();
  const unsubscribe = unsubscribeUrl(input.siteUrl, input.unsubscribeToken);
  const cadenceLine = { daily: "daily digest", hourly: "hourly alerts", instant: "10-minute alerts" }[input.cadence];

  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];
  for (const [caseId, entries] of byCase) {
    const head = entries[0]!;
    const shown = entries.slice(0, MAX_ENTRIES_PER_CASE);
    const more = entries.length - shown.length;
    const meta = [head.courtName, head.docketNumber].filter(Boolean).join(" · ");
    textBlocks.push([
      truncate(head.caption, 160),
      meta,
      ...shown.map((entry) => `- ${[entry.filedOn, entry.entryNumber ? `#${entry.entryNumber}` : null].filter(Boolean).join(" ")} ${truncate(entry.description, 300)}`.trim()),
      more > 0 ? `- and ${more} more` : null,
      caseUrl(caseId),
    ].filter(Boolean).join("\n"));
    htmlBlocks.push(`<div style="margin:0 0 22px">
<p style="margin:0 0 2px;font-weight:700"><a href="${escapeHtml(caseUrl(caseId))}" style="color:#084cc8;text-decoration:none">${escapeHtml(truncate(head.caption, 160))}</a></p>
<p style="margin:0 0 8px;color:#5b6678;font-size:13px">${escapeHtml(meta)}</p>
<ul style="margin:0;padding-left:18px">${shown.map((entry) => `<li style="margin:0 0 6px"><span style="color:#5b6678">${escapeHtml([entry.filedOn, entry.entryNumber ? `#${entry.entryNumber}` : null].filter(Boolean).join(" "))}</span> ${escapeHtml(truncate(entry.description, 300))}</li>`).join("")}${more > 0 ? `<li>and ${more} more</li>` : ""}</ul>
</div>`);
  }
  const citeTextBlocks: string[] = [];
  const citeHtmlBlocks: string[] = [];
  for (const [caseId, cites] of citedCases) {
    const shown = cites.slice(0, MAX_CITATIONS_PER_CASE);
    const more = cites.length - shown.length;
    const line = (cite: CitationDigestEntry) => [cite.citingFiledOn, cite.citingCourtName].filter(Boolean).join(" · ");
    citeTextBlocks.push([
      `Newly cited: ${truncate(cites[0]!.caption, 160)}`,
      ...shown.map((cite) => `- ${truncate(cite.citingCaption, 160)}${line(cite) ? ` (${line(cite)})` : ""} ${citingUrl(cite.citingPublicId)}`),
      more > 0 ? `- and ${more} more` : null,
      citedUrl(caseId),
    ].filter(Boolean).join("\n"));
    citeHtmlBlocks.push(`<div style="margin:0 0 22px">
<p style="margin:0 0 8px;font-weight:700">Newly cited: <a href="${escapeHtml(citedUrl(caseId))}" style="color:#084cc8;text-decoration:none">${escapeHtml(truncate(cites[0]!.caption, 160))}</a></p>
<ul style="margin:0;padding-left:18px">${shown.map((cite) => `<li style="margin:0 0 6px"><a href="${escapeHtml(citingUrl(cite.citingPublicId))}" style="color:#084cc8;text-decoration:none">${escapeHtml(truncate(cite.citingCaption, 160))}</a>${line(cite) ? ` <span style="color:#5b6678">${escapeHtml(line(cite))}</span>` : ""}</li>`).join("")}${more > 0 ? `<li>and ${more} more</li>` : ""}</ul>
</div>`);
  }
  const heading = total && citeTotal ? "New activity on cases you follow"
    : citeTotal ? "New opinions citing cases you follow" : "New docket activity on cases you follow";
  const footerText = [
    `You get Jurvio ${cadenceLine} because you follow these cases. Docket text and opinions come from public court records; Jurvio is not legal advice.`,
    `Manage follows: ${accountUrl}`,
    `Unsubscribe from alerts: ${unsubscribe}`,
    input.postalAddress,
  ].join("\n");
  const text = `${heading}\n\n${[...textBlocks, ...citeTextBlocks].join("\n\n")}\n\n--\n${footerText}\n`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0b1730;max-width:640px">
<h1 style="font-size:20px">${escapeHtml(heading)}</h1>
${[...htmlBlocks, ...citeHtmlBlocks].join("\n")}
<hr style="border:0;border-top:1px solid #dfe4ec;margin:24px 0">
<p style="font-size:12px;color:#5b6678">You get Jurvio ${escapeHtml(cadenceLine)} because you follow these cases. Docket text and opinions come from public court records; Jurvio is not legal advice.<br>
<a href="${escapeHtml(accountUrl)}">Manage follows</a> · <a href="${escapeHtml(unsubscribe)}">Unsubscribe from alerts</a><br>
${escapeHtml(input.postalAddress)}</p>
</body></html>`;
  return { subject, text, html };
}

interface CandidateUser {
  id: string;
  email: string;
  unsubscribeToken: string;
  lastDigestAt: Date | null;
  plan: string | null;
  status: string | null;
}

export async function runAlertDigests(sql: Sql, deps: AlertDeps): Promise<AlertRunSummary> {
  const empty = { candidates: 0, due: 0, sent: 0, failed: 0, emptyAdvanced: 0 };
  if (!deps.provider) return { status: "skipped", reason: "email provider not configured (RESEND_API_KEY, EMAIL_FROM)", ...empty };
  const postalAddress = deps.postalAddress?.trim();
  if (!postalAddress) return { status: "skipped", reason: "EMAIL_POSTAL_ADDRESS not configured", ...empty };
  const now = deps.now ?? new Date();
  const summary: AlertRunSummary = { status: "done", ...empty };

  const [settle] = await sql<{ cutoff: Date }[]>`SELECT now() - ${SETTLE_INTERVAL}::interval AS cutoff`;
  const cutoff = settle!.cutoff;
  const candidates = await sql<CandidateUser[]>`
    SELECT u.id, u.email, u.unsubscribe_token AS "unsubscribeToken", u.last_digest_at AS "lastDigestAt",
      s.plan::text AS plan, s.status
    FROM app_user u
    LEFT JOIN account_subscription s ON s.user_id = u.id
    WHERE u.alerts_unsubscribed_at IS NULL
      AND u.email_verified_at IS NOT NULL
      AND (EXISTS (
        SELECT 1 FROM case_follow f
        JOIN docket_entry e ON e.case_id = f.case_id
        WHERE f.user_id = u.id AND f.activity AND e.created_at > f.last_alerted_entry_created_at AND e.created_at <= ${cutoff})
      OR EXISTS (
        SELECT 1 FROM case_follow f
        JOIN case_citation_edge ce ON ce.cited_case_id = f.case_id
        WHERE f.user_id = u.id AND f.citations AND ce.first_seen_at > f.last_alerted_citation_at AND ce.first_seen_at <= ${cutoff}))
    ORDER BY u.last_digest_at NULLS FIRST, u.id
    LIMIT ${(deps.maxUsers ?? 500) * 4}`;
  summary.candidates = candidates.length;

  for (const user of candidates) {
    if (summary.due >= (deps.maxUsers ?? 500)) break;
    const plan = effectivePlan(user.plan ? { plan: user.plan, status: user.status ?? "active" } : null);
    const cadence = planLimits(plan).alertCadence;
    if (!isDue(cadence, user.lastDigestAt ? new Date(user.lastDigestAt) : null, now)) continue;
    summary.due += 1;

    const entries = await sql<DigestEntry[]>`
      SELECT c.public_id AS "casePublicId", c.caption, c.docket_number AS "docketNumber", court.name AS "courtName",
        e.entry_number AS "entryNumber", e.filed_on::text AS "filedOn", e.description,
        (SELECT a.docket_number FROM scotus_application a WHERE a.case_id = c.id LIMIT 1) AS "emergencyDocket"
      FROM case_follow f
      JOIN legal_case c ON c.id = f.case_id
      LEFT JOIN court ON court.id = c.court_id
      JOIN docket_entry e ON e.case_id = f.case_id
      WHERE f.user_id = ${user.id} AND f.activity
        AND e.created_at > f.last_alerted_entry_created_at AND e.created_at <= ${cutoff}
        AND (e.filed_on IS NULL OR e.filed_on >= (f.created_at - make_interval(days => ${BACKFILL_GRACE_DAYS}))::date)
        AND ${sql.unsafe(alertEligibleSql("c"))}
        AND ${sql.unsafe(latestPublicationColumnSql("displayable", "docket_entry", "e.id"))}
      ORDER BY f.created_at, c.id, e.filed_on DESC NULLS LAST, e.created_at DESC
      LIMIT 2000`;

    const citations = await sql<CitationDigestEntry[]>`
      SELECT c.public_id AS "casePublicId", c.caption,
        citing.public_id AS "citingPublicId", citing.caption AS "citingCaption", citing_court.name AS "citingCourtName",
        ce.citing_filed_on::text AS "citingFiledOn", ce.citation_label AS "citationLabel"
      FROM case_follow f
      JOIN legal_case c ON c.id = f.case_id
      JOIN case_citation_edge ce ON ce.cited_case_id = f.case_id
      JOIN legal_case citing ON citing.id = ce.citing_case_id
      LEFT JOIN court citing_court ON citing_court.id = citing.court_id
      JOIN document d ON d.id = ce.citing_document_id
      WHERE f.user_id = ${user.id} AND f.citations
        AND ce.first_seen_at > f.last_alerted_citation_at AND ce.first_seen_at <= ${cutoff}
        AND ${sql.unsafe(alertableCitationEdgeSql("ce", "d"))}
        AND ${sql.unsafe(followEligibleSql("c"))}
        AND ${sql.unsafe(citationCaseVisibleSql("c"))}
        AND ${sql.unsafe(citationCaseVisibleSql("citing"))}
        AND ${sql.unsafe(citationDocumentVisibleSql("d"))}
      ORDER BY f.created_at, c.id, ce.citing_filed_on DESC NULLS LAST, ce.first_seen_at DESC
      LIMIT 1000`;

    const advance = async (db: Sql) => {
      await db`
        UPDATE case_follow f SET last_alerted_entry_created_at = GREATEST(f.last_alerted_entry_created_at, latest.max_created)
        FROM (
          SELECT f2.case_id, max(e.created_at) AS max_created
          FROM case_follow f2 JOIN docket_entry e ON e.case_id = f2.case_id
          WHERE f2.user_id = ${user.id} AND f2.activity AND e.created_at > f2.last_alerted_entry_created_at AND e.created_at <= ${cutoff}
          GROUP BY f2.case_id
        ) latest
        WHERE f.user_id = ${user.id} AND f.case_id = latest.case_id`;
      await db`
        UPDATE case_follow f SET last_alerted_citation_at = GREATEST(f.last_alerted_citation_at, latest.max_seen)
        FROM (
          SELECT f2.case_id, max(ce.first_seen_at) AS max_seen
          FROM case_follow f2 JOIN case_citation_edge ce ON ce.cited_case_id = f2.case_id
          WHERE f2.user_id = ${user.id} AND f2.citations AND ce.first_seen_at > f2.last_alerted_citation_at AND ce.first_seen_at <= ${cutoff}
          GROUP BY f2.case_id
        ) latest
        WHERE f.user_id = ${user.id} AND f.case_id = latest.case_id`;
    };

    if (entries.length === 0 && citations.length === 0) {
      // Only hidden, ineligible or backfilled-history entries: move past them silently.
      await advance(sql);
      summary.emptyAdvanced += 1;
      continue;
    }

    const message = buildDigestEmail({ entries, citations, siteUrl: deps.siteUrl, unsubscribeToken: user.unsubscribeToken, postalAddress, cadence });
    const result = await deps.provider.send({
      to: user.email,
      ...message,
      tag: "alert_digest",
      headers: {
        "List-Unsubscribe": `<${oneClickUnsubscribeUrl(deps.siteUrl, user.unsubscribeToken)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    await sql`
      INSERT INTO email_event (user_id, kind, provider, status, provider_message_id, detail)
      VALUES (${user.id}, 'alert_digest', ${deps.provider.name}, ${result.ok ? "sent" : "failed"}, ${result.providerMessageId ?? null},
        ${sql.json({ entries: entries.length, citations: citations.length, cadence, ...(result.error ? { error: result.error } : {}) })})`;
    if (!result.ok) {
      summary.failed += 1;
      continue;
    }
    await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      await advance(db);
      await db`UPDATE app_user SET last_digest_at = ${now}, updated_at = now() WHERE id = ${user.id}`;
    });
    summary.sent += 1;
  }
  return summary;
}

export async function unsubscribeByToken(sql: Sql, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) return false;
  const rows = await sql`
    UPDATE app_user SET alerts_unsubscribed_at = COALESCE(alerts_unsubscribed_at, now()), updated_at = now()
    WHERE unsubscribe_token = ${token} RETURNING id`;
  return rows.length > 0;
}

export async function resubscribe(sql: Sql, userId: string): Promise<void> {
  await sql`UPDATE app_user SET alerts_unsubscribed_at = NULL, updated_at = now() WHERE id = ${userId}`;
}
