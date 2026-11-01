/**
 * One pass over the agency sources. Each source has its own polite budget
 * (FetchBudget from the live feeds), its own robots.txt check and its own
 * try/catch, so one blocked or failing source never stops the others. Every
 * attempt is written to agency_source_run and the source's health columns.
 */
import type postgres from "postgres";
import { BudgetExhaustedError, FetchBudget, RateLimitedError } from "@/modules/ingestion/live-feeds/polite-fetcher";
import type { SourceAdapter } from "../providers/context";
import { HttpStatusError, RobotsDisallowedError } from "../providers/context";
import { parseRobots, robotsAllows, type RobotsRules } from "./robots";
import { knownRecords, recheckUnmatched, registerSources, saveItem } from "./persist";

type Sql = ReturnType<typeof postgres>;

/** Extra requests per run for robots.txt (one per host). */
const ROBOTS_ALLOWANCE = 3;

export interface SourceRunReport {
  source: string;
  status: "ok" | "partial" | "failed" | "blocked" | "rate_limited" | "skipped";
  requests: number;
  itemsSeen: number;
  itemsNew: number;
  refs: number;
  matched: number;
  queued: number;
  restricted: number;
  error?: string;
}

export interface RunOptions { fetchImpl?: typeof fetch; now?: () => Date; userAgent?: string; sleep?: (ms: number) => Promise<void> }

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runAgencySource(sql: Sql, adapter: SourceAdapter, options: RunOptions = {}): Promise<SourceRunReport> {
  const { definition } = adapter;
  const startedAt = new Date();
  await registerSources(sql, [definition]);
  const report: SourceRunReport = { source: definition.code, status: "ok", requests: 0, itemsSeen: 0, itemsNew: 0, refs: 0, matched: 0, queued: 0, restricted: 0 };
  if (!definition.enabled || !adapter.run) {
    report.status = "skipped";
    report.error = definition.disabledReason ?? "not polled";
    await recordRun(sql, definition.code, startedAt, report);
    return report;
  }
  const robotsCache = new Map<string, RobotsRules>();
  let budget = new FetchBudget({ source: definition.code, ...adapter.budget, maxRequests: adapter.budget.maxRequests + ROBOTS_ALLOWANCE, fetchImpl: options.fetchImpl, userAgent: options.userAgent, sleep: options.sleep });
  const robotsFor = async (url: string) => {
    const origin = new URL(url).origin;
    const cached = robotsCache.get(origin);
    if (cached) return cached;
    let rules: RobotsRules = { allow: [], disallow: [], crawlDelayMs: null };
    const response = await budget.get(`${origin}/robots.txt`, "text/plain");
    if (response.status === 401 || response.status === 403) throw new HttpStatusError(`${origin}/robots.txt`, response.status);
    if (response.ok) rules = parseRobots(await response.text());
    robotsCache.set(origin, rules);
    // Honour a declared Crawl-delay above our own spacing for the rest of the run.
    if (rules.crawlDelayMs && rules.crawlDelayMs > adapter.budget.minIntervalMs) {
      const requests = budget.requests;
      budget = new FetchBudget({ source: definition.code, ...adapter.budget, minIntervalMs: rules.crawlDelayMs, maxRequests: adapter.budget.maxRequests + ROBOTS_ALLOWANCE - requests,
        fetchImpl: options.fetchImpl, userAgent: options.userAgent, sleep: options.sleep });
      report.requests += requests;
    }
    return rules;
  };
  const [stored] = await sql<{ count: number; cursor: string | null }[]>`
    SELECT (SELECT count(*)::int FROM agency_source_item WHERE source_code = ${definition.code}) AS count,
      (SELECT cursor_value FROM agency_source WHERE code = ${definition.code}) AS cursor`;
  const count = stored?.count ?? 0;
  let nextCursor: string | null | undefined;
  try {
    const outcome = await adapter.run({
      now: options.now?.() ?? new Date(),
      firstRun: count === 0,
      cursor: stored?.cursor ?? null,
      canFetch: () => budget.canFetch,
      known: (ids) => knownRecords(sql, definition.code, ids),
      fetchText: async (url, accept) => {
        const rules = await robotsFor(url);
        if (!robotsAllows(rules, url)) throw new RobotsDisallowedError(url);
        const response = await budget.get(url, accept);
        if (!response.ok) throw new HttpStatusError(url, response.status);
        return response.text();
      },
    });
    report.itemsSeen = outcome.itemsSeen;
    nextCursor = outcome.cursor;
    for (const item of outcome.items) {
      try {
        const saved = await saveItem(sql, item);
        if (saved.isNew) report.itemsNew += 1;
        report.refs += saved.refs;
        report.matched += saved.matched;
        if (saved.queued) report.queued += 1;
        if (saved.restricted) report.restricted += 1;
      } catch (error) {
        outcome.warnings.push(`${item.sourceRecordId}: ${message(error)}`);
      }
    }
    if (outcome.warnings.length) {
      report.status = "partial";
      report.error = outcome.warnings.slice(0, 5).join("; ").slice(0, 1000);
    }
  } catch (error) {
    report.error = message(error).slice(0, 1000);
    if (error instanceof RateLimitedError) report.status = "rate_limited";
    else if (error instanceof RobotsDisallowedError || (error instanceof HttpStatusError && [401, 403].includes(error.status))) report.status = "blocked";
    else if (error instanceof BudgetExhaustedError) report.status = "partial";
    else report.status = "failed";
  }
  report.requests += budget.requests;
  await recordRun(sql, definition.code, startedAt, report);
  if (nextCursor !== undefined && (report.status === "ok" || report.status === "partial")) {
    await sql`UPDATE agency_source SET cursor_value = ${nextCursor} WHERE code = ${definition.code}`;
  }
  return report;
}

async function recordRun(sql: Sql, source: string, startedAt: Date, report: SourceRunReport) {
  await sql`
    INSERT INTO agency_source_run (source_code, started_at, status, requests, items_seen, items_new, refs_found, matched, queued, restricted, error)
    VALUES (${source}, ${startedAt}, ${report.status}, ${report.requests}, ${report.itemsSeen}, ${report.itemsNew}, ${report.refs},
      ${report.matched}, ${report.queued}, ${report.restricted}, ${report.error ?? null})
  `;
  const success = report.status === "ok" || report.status === "partial";
  await sql`
    UPDATE agency_source SET last_attempt_at = now(), last_status = ${report.status}, last_error = ${report.error ?? null},
      last_success_at = CASE WHEN ${success} THEN now() ELSE last_success_at END,
      consecutive_failures = CASE WHEN ${success} OR ${report.status} = 'skipped' THEN 0 ELSE consecutive_failures + 1 END,
      updated_at = now()
    WHERE code = ${source}
  `;
}

export async function runAgencySources(sql: Sql, adapters: readonly SourceAdapter[], options: RunOptions = {}) {
  const reports: SourceRunReport[] = [];
  for (const adapter of adapters) reports.push(await runAgencySource(sql, adapter, options));
  const recheck = await recheckUnmatched(sql);
  return { reports, recheck };
}
