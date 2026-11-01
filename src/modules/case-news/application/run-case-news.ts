import type { Sql } from "postgres";
import { FetchBudget, RateLimitedError } from "@/modules/ingestion/live-feeds/polite-fetcher";
import { caseNewsTerms, searchable, type CaseNewsTerms, type PartyTerm } from "../domain/case-terms";
import {
  CASE_NEWS_MATCH_RULE_VERSION, matchNewsItem, mentionsParty, reviewStatusFor, type MatchContext, type MatchResult, type NewsItem,
} from "../domain/match";
import { isEstablishedOutlet, outletDomain, outletName } from "../domain/outlets";
import { buildDocketQuery, buildPartiesQuery, GDELT_MIN_INTERVAL_MS, searchGdelt } from "../infrastructure/gdelt";
import { COURTHOUSE_NEWS_FEEDS, fetchRssFeeds } from "../infrastructure/rss";
import { captionLooksRestricted, caseNewsEligibleSql } from "./eligibility";
import { RECHECK_HOURS, selectCaseNewsCandidates, type CaseNewsCandidate, type PriorityTier } from "./select-candidates";

/** Non-allowlisted domains never auto-publish; they go to review at most. */
const UNKNOWN_OUTLET_CAP = 0.8;

export interface CaseNewsRunOptions {
  gdeltMaxRequests: number;
  gdeltMaxMs: number;
  candidateLimit: number;
  rss: boolean;
  gdelt: boolean;
  tiers?: PriorityTier[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rssFeeds?: readonly string[];
}

export interface SourceRunSummary {
  source: string;
  ok: boolean;
  requests: number;
  casesQueried: number;
  itemsSeen: number;
  linksPublished: number;
  linksReview: number;
  rejectedLowScore: number;
  skippedRestricted: number;
  rateLimited: boolean;
  error: string | null;
  detail: Record<string, unknown>;
}

function emptySummary(source: string): SourceRunSummary {
  return { source, ok: true, requests: 0, casesQueried: 0, itemsSeen: 0, linksPublished: 0, linksReview: 0,
    rejectedLowScore: 0, skippedRestricted: 0, rateLimited: false, error: null, detail: {} };
}

function likePart(party: PartyTerm | null): string | null {
  if (!party) return null;
  const value = party.kind === "organization" && party.anchor && party.anchorDistinctiveness === 1 ? party.anchor : party.key;
  if (!value) return null;
  return `%${value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/** Does another published case carry the same party pair? */
export async function nameAmbiguity(sql: Sql, caseId: string, courtCode: string | null, terms: CaseNewsTerms): Promise<MatchContext["ambiguity"]> {
  const left = likePart(terms.left);
  const right = likePart(terms.right);
  const usaLeft = !left && terms.left.aliases.length > 0;
  const usaRight = !right && (terms.right?.aliases.length ?? 0) > 0;
  if (!left && !usaLeft) return "same_court";
  if (!right && !usaRight) return "same_court";
  const conditions: string[] = [];
  const params: unknown[] = [caseId];
  for (const [like, usa] of [[left, usaLeft], [right, usaRight]] as const) {
    if (like) { params.push(like); conditions.push(`c.caption ILIKE $${params.length}`); }
    else if (usa) conditions.push(`c.caption ~* '^(usa|united states)\\M'`);
  }
  params.push(courtCode ?? "");
  const rows = await sql.unsafe<{ same: boolean }[]>(`
    SELECT (ct.provider_court_id = $${params.length}) AS same
    FROM legal_case c JOIN court ct ON ct.id = c.court_id
    WHERE c.id <> $1 AND c.publication = 'published' AND ${conditions.join(" AND ")}
    LIMIT 25`, params as never[]);
  if (rows.some((row) => row.same)) return "same_court";
  return rows.length ? "other_court" : "none";
}

interface UpsertInput {
  caseId: string;
  item: NewsItem;
  domain: string;
  source: string;
  match: MatchResult;
}

/** Returns the status written, or null when a reviewer already decided this link. */
async function upsertLink(sql: Sql, input: UpsertInput): Promise<"auto_published" | "pending_review" | null> {
  const status = reviewStatusFor(input.match.score);
  if (!status) return null;
  const [row] = await sql<{ review_status: string }[]>`
    INSERT INTO case_news_link (case_id, url, outlet, outlet_domain, title, snippet, published_at, source,
      match_method, match_score, match_evidence, match_rule_version, review_status)
    VALUES (${input.caseId}, ${input.item.url}, ${outletName(input.domain)}, ${input.domain}, ${input.item.title.slice(0, 400)},
      ${input.item.snippet}, ${input.item.publishedAt}, ${input.source}, ${input.match.method}, ${input.match.score},
      ${sql.json(input.match.evidence as never)}, ${CASE_NEWS_MATCH_RULE_VERSION}, ${status})
    ON CONFLICT (case_id, url) DO UPDATE SET
      match_method = EXCLUDED.match_method, match_score = EXCLUDED.match_score, match_evidence = EXCLUDED.match_evidence,
      match_rule_version = EXCLUDED.match_rule_version, review_status = EXCLUDED.review_status,
      snippet = COALESCE(EXCLUDED.snippet, case_news_link.snippet), updated_at = now()
    WHERE case_news_link.review_status IN ('auto_published', 'pending_review')
      AND EXCLUDED.match_score > case_news_link.match_score
    RETURNING review_status`;
  return (row?.review_status as "auto_published" | "pending_review" | undefined) ?? null;
}

async function scoreAndStore(sql: Sql, summary: SourceRunSummary, caseId: string, item: NewsItem, source: string, context: MatchContext, samples: unknown[], publicId: string) {
  const domain = outletDomain(item.url);
  const raw = matchNewsItem(item, context);
  if (!raw) { summary.rejectedLowScore += 1; return; }
  const match = isEstablishedOutlet(domain) ? raw : { ...raw, score: Math.min(raw.score, UNKNOWN_OUTLET_CAP), evidence: { ...raw.evidence, unknownOutlet: true } };
  const status = await upsertLink(sql, { caseId, item, domain, source, match });
  if (status === "auto_published") summary.linksPublished += 1;
  else if (status === "pending_review") summary.linksReview += 1;
  if (status && samples.length < 25) samples.push({ publicId, title: item.title, outlet: outletName(domain), method: match.method, score: match.score, status });
}

async function markQueried(sql: Sql, candidate: CaseNewsCandidate, now: Date, results: number, error: string | null, hours?: number) {
  const next = new Date(now.getTime() + (hours ?? RECHECK_HOURS[candidate.tier]) * 3_600_000);
  await sql`
    INSERT INTO case_news_query_state (case_id, priority_tier, last_queried_at, next_due_at, last_result_count, last_error, query_count)
    VALUES (${candidate.caseId}, ${candidate.tier}, ${now}, ${next}, ${results}, ${error}, 1)
    ON CONFLICT (case_id) DO UPDATE SET priority_tier = EXCLUDED.priority_tier, last_queried_at = EXCLUDED.last_queried_at,
      next_due_at = EXCLUDED.next_due_at, last_result_count = EXCLUDED.last_result_count, last_error = EXCLUDED.last_error,
      query_count = case_news_query_state.query_count + 1`;
}

async function runGdelt(sql: Sql, options: CaseNewsRunOptions): Promise<SourceRunSummary> {
  const summary = emptySummary("gdelt");
  const now = options.now ?? (() => new Date());
  const samples: unknown[] = [];
  const tierCounts: Record<string, number> = {};
  const budget = new FetchBudget({
    source: "gdelt", maxRequests: options.gdeltMaxRequests, maxMs: options.gdeltMaxMs, minIntervalMs: GDELT_MIN_INTERVAL_MS,
    fetchImpl: options.fetchImpl, sleep: options.sleep,
  });
  const backoff = { retries: 0 };
  const candidates = await selectCaseNewsCandidates(sql, { limit: options.candidateLimit, tiers: options.tiers });
  summary.detail.candidates = candidates.length;
  let unsearchable = 0;
  for (const candidate of candidates) {
    if (!budget.canFetch) break;
    if (captionLooksRestricted(candidate.caption, candidate.docketNumber)) { summary.skippedRestricted += 1; continue; }
    const terms = caseNewsTerms(candidate);
    const partiesQuery = searchable(terms) ? buildPartiesQuery(terms) : null;
    const docketQuery = candidate.tier !== "scotus" && candidate.tier !== "appeals" ? buildDocketQuery(candidate.docketNumber, terms) : null;
    if (!partiesQuery && !docketQuery) {
      unsearchable += 1;
      await markQueried(sql, candidate, now(), 0, "not searchable", 24 * 14);
      continue;
    }
    tierCounts[candidate.tier] = (tierCounts[candidate.tier] ?? 0) + 1;
    const filed = candidate.filedOn ? new Date(`${candidate.filedOn}T00:00:00Z`) : null;
    const threeMonths = new Date(now().getTime() - 89 * 86_400_000);
    const start = filed && filed.getTime() - 14 * 86_400_000 > threeMonths.getTime() ? new Date(filed.getTime() - 14 * 86_400_000) : threeMonths;
    let ambiguity: MatchContext["ambiguity"] | null = null;
    let found = 0;
    let error: string | null = null;
    try {
      for (const [query, kind] of [[partiesQuery, "parties"], [docketQuery, "docket"]] as const) {
        if (!query || !budget.canFetch) continue;
        const articles = await searchGdeltWithBackoff(budget, query, start, options.sleep, backoff);
        summary.itemsSeen += articles.length;
        found += articles.length;
        if (articles.length && ambiguity === null) ambiguity = await nameAmbiguity(sql, candidate.caseId, candidate.courtCode, terms);
        for (const article of articles) {
          if (article.language && article.language !== "English") continue;
          await scoreAndStore(sql, summary, candidate.caseId, { url: article.url, title: article.title, snippet: null, publishedAt: article.publishedAt }, "gdelt", {
            terms, filedOn: candidate.filedOn, decidedOn: candidate.decidedOn, ambiguity: ambiguity ?? "none",
            courtInFullText: kind === "parties", docketInFullText: kind === "docket", now: now(),
          }, samples, candidate.publicId);
        }
      }
      summary.casesQueried += 1;
    } catch (caught) {
      error = String(caught);
      if (caught instanceof RateLimitedError) { summary.rateLimited = true; break; }
      summary.detail.lastQueryError = error.slice(0, 300);
    }
    await markQueried(sql, candidate, now(), found, error);
  }
  summary.requests = budget.requests;
  summary.detail = { ...summary.detail, unsearchable, tierCounts, throttleRetries: backoff.retries, samples };
  return summary;
}

/** Max throttle notices tolerated per run, each followed by a growing pause. */
export const GDELT_MAX_THROTTLE_RETRIES = 4;

/**
 * GDELT answers bursts with a plain-text throttle notice. Pause (30 s, 60 s, ...)
 * and retry the same query a few times per run before giving up until the next run.
 */
async function searchGdeltWithBackoff(budget: FetchBudget, query: string, start: Date, sleep: CaseNewsRunOptions["sleep"], state: { retries: number }) {
  for (;;) {
    try {
      return await searchGdelt(budget, query, { start });
    } catch (error) {
      if (!(error instanceof RateLimitedError) || state.retries >= GDELT_MAX_THROTTLE_RETRIES) throw error;
      state.retries += 1;
      budget.rateLimited = null;
      await (sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(30_000 * state.retries);
    }
  }
}

/** Cases named in a news item ("X v. Y" in the headline or description), found through the caption trigram index. */
async function casesNamedIn(sql: Sql, text: string): Promise<CaseNewsCandidate[]> {
  const found: CaseNewsCandidate[] = [];
  for (const match of text.matchAll(/\b([A-Z][\w.&'’-]*(?:\s+[A-Z][\w.&'’-]*){0,3})\s+v\.?\s+([A-Z][\w.&'’-]*(?:\s+[A-Z][\w.&'’-]*){0,3})/g)) {
    const left = match[1]!.split(/\s+/).at(-1)!;
    const right = match[2]!.split(/\s+/)[0]!;
    if (left.length < 3 || right.length < 3) continue;
    const rows = await sql.unsafe<Omit<CaseNewsCandidate, "tier">[]>(`
      SELECT c.id AS "caseId", c.public_id AS "publicId", c.caption, c.docket_number AS "docketNumber",
        c.filed_on::text AS "filedOn", c.decided_on::text AS "decidedOn", ct.provider_court_id AS "courtCode", ct.name AS "courtName"
      FROM legal_case c JOIN court ct ON ct.id = c.court_id
      WHERE c.caption ILIKE $1 AND c.caption ILIKE $2 AND ${caseNewsEligibleSql("c")}
      ORDER BY COALESCE(c.decided_on, c.filed_on) DESC NULLS LAST
      LIMIT 10`, [`%${left}%`, `%${right}%`]);
    for (const row of rows) found.push({ ...row, tier: "cited" });
    if (found.length >= 20) break;
  }
  return found;
}

async function runCourthouseNews(sql: Sql, options: CaseNewsRunOptions): Promise<SourceRunSummary> {
  const summary = emptySummary("courthousenews_rss");
  const now = options.now ?? (() => new Date());
  const samples: unknown[] = [];
  const budget = new FetchBudget({ source: "courthousenews_rss", maxRequests: 8, maxMs: 120_000, minIntervalMs: 2_000, fetchImpl: options.fetchImpl, sleep: options.sleep });
  const { items, errors } = await fetchRssFeeds(budget, options.rssFeeds ?? COURTHOUSE_NEWS_FEEDS);
  summary.requests = budget.requests;
  summary.itemsSeen = items.length;
  if (errors.length) summary.detail.feedErrors = errors;
  if (items.length === 0 && errors.length) { summary.ok = false; summary.error = errors[0] ?? null; return summary; }
  // Active priority cases, regardless of their GDELT schedule.
  const active = await selectActiveForRss(sql);
  const activeTerms = active.map((candidate) => ({ candidate, terms: caseNewsTerms(candidate) }));
  for (const item of items) {
    const text = `${item.title}\n${item.snippet ?? ""}`;
    const pool = new Map<string, { candidate: CaseNewsCandidate; terms: CaseNewsTerms }>();
    for (const entry of activeTerms) {
      const hasDocket = entry.terms.docketPatterns.some((pattern) => pattern.test(text));
      const hasKeys = Boolean(entry.terms.right) && [entry.terms.left, entry.terms.right].every((party) => party && mentionsParty(text, party));
      if (hasDocket || hasKeys) pool.set(entry.candidate.caseId, entry);
    }
    for (const candidate of await casesNamedIn(sql, text)) {
      if (!pool.has(candidate.caseId)) pool.set(candidate.caseId, { candidate, terms: caseNewsTerms(candidate) });
    }
    for (const { candidate, terms } of pool.values()) {
      if (captionLooksRestricted(candidate.caption, candidate.docketNumber)) { summary.skippedRestricted += 1; continue; }
      const ambiguity = await nameAmbiguity(sql, candidate.caseId, candidate.courtCode, terms);
      await scoreAndStore(sql, summary, candidate.caseId, item, "courthousenews_rss", {
        terms, filedOn: candidate.filedOn, decidedOn: candidate.decidedOn, ambiguity,
        courtInFullText: false, docketInFullText: false, now: now(),
      }, samples, candidate.publicId);
    }
  }
  summary.casesQueried = active.length;
  summary.detail = { ...summary.detail, samples };
  return summary;
}

async function selectActiveForRss(sql: Sql): Promise<CaseNewsCandidate[]> {
  return sql.unsafe<CaseNewsCandidate[]>(`
    SELECT c.id AS "caseId", c.public_id AS "publicId", c.caption, c.docket_number AS "docketNumber",
      c.filed_on::text AS "filedOn", c.decided_on::text AS "decidedOn", ct.provider_court_id AS "courtCode", ct.name AS "courtName",
      s.priority_tier AS tier
    FROM case_news_query_state s
    JOIN legal_case c ON c.id = s.case_id
    JOIN court ct ON ct.id = c.court_id
    WHERE s.last_error IS DISTINCT FROM 'not searchable' AND ${caseNewsEligibleSql("c")}
    ORDER BY s.last_queried_at DESC NULLS LAST
    LIMIT 5000`);
}

async function recordRun(sql: Sql, startedAt: Date, summary: SourceRunSummary) {
  await sql`
    INSERT INTO case_news_run (source, started_at, ok, requests, cases_queried, items_seen, links_published, links_review,
      rejected_low_score, skipped_restricted, rate_limited, error, detail)
    VALUES (${summary.source}, ${startedAt}, ${summary.ok}, ${summary.requests}, ${summary.casesQueried}, ${summary.itemsSeen},
      ${summary.linksPublished}, ${summary.linksReview}, ${summary.rejectedLowScore}, ${summary.skippedRestricted},
      ${summary.rateLimited}, ${summary.error}, ${sql.json(summary.detail as never)})`;
}

export async function runCaseNews(sql: Sql, options: CaseNewsRunOptions): Promise<SourceRunSummary[]> {
  const summaries: SourceRunSummary[] = [];
  const steps: Array<[string, boolean, () => Promise<SourceRunSummary>]> = [
    ["gdelt", options.gdelt, () => runGdelt(sql, options)],
    ["courthousenews_rss", options.rss, () => runCourthouseNews(sql, options)],
  ];
  for (const [source, enabled, step] of steps) {
    if (!enabled) continue;
    const startedAt = (options.now ?? (() => new Date()))();
    let summary: SourceRunSummary;
    try {
      summary = await step();
    } catch (error) {
      summary = { ...emptySummary(source), ok: false, error: String(error).slice(0, 500) };
    }
    // A rate-limited GDELT pass is healthy (we stop and resume next run) unless it made no progress at all.
    if (summary.rateLimited && summary.casesQueried === 0) { summary.ok = false; summary.error ??= "rate limited before any case was queried"; }
    await recordRun(sql, startedAt, summary);
    summaries.push(summary);
  }
  return summaries;
}
