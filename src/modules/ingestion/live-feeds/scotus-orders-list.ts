/**
 * Orders-list monitor. Fetches the official term index, then a few order-list
 * PDFs, and stores them. It does not create cases, does not write docket_entry,
 * and does not send mail. Backfilled lists are marked so a later notification
 * review still cannot email them.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type postgres from "postgres";
import type { ArtifactStore } from "../application/artifact-store";
import { providerId } from "./persist";
import { FetchBudget, RateLimitedError, BudgetExhaustedError } from "./polite-fetcher";
import {
  ORDERS_LIST_NOTIFICATIONS_ENABLED,
  ORDERS_LIST_PARSER_VERSION,
  assessOrdersListCoverage,
  linkOrdersListEntry,
  octoberTermYear,
  ordersEntryKey,
  ordersIndexUrl,
  parseOrdersIndex,
  parseOrdersListText,
  planOrdersListFetches,
  revisionForIncoming,
  shouldNotifyOrdersListEntry,
  type LinkStatus,
  type OrdersIndexLink,
  type OrdersListCoverage,
  type OrdersListEntryDraft,
  type OrdersRunStatus,
  type StoredOrdersList,
} from "../providers/scotus/orders-list";

const execFileAsync = promisify(execFile);
type Sql = ReturnType<typeof postgres>;

export interface OrdersListCycleResult {
  ok: boolean;
  skippedReason?: string;
  termYear: number;
  requests: number;
  stored: number;
  duplicates: number;
  withheld: number;
  unlinked: number;
  ambiguous: number;
  notifications: "disabled";
  emailsSent: 0;
  coverage: OrdersListCoverage;
}

export interface StoreListInput {
  termYear: number;
  indexDate: string;
  printedDate: string | null;
  sourceUrl: string;
  contentHash: string;
  backfilled: boolean;
  extractionStatus: "ok" | "failed";
  supersedeUrls: string[];
  artifactId: string | null;
  entries: Array<OrdersListEntryDraft & { linkStatus: LinkStatus; caseId: string | null; notify: boolean; backfilled: boolean }>;
}

export interface OrdersListCycleDeps {
  now: () => Date;
  termYear?: number;
  maxPdfs: number;
  notificationsEnabled?: boolean;
  fetchText: (url: string) => Promise<{ status: number; body?: string; retryAfter?: string | null; stopped?: "budget" }>;
  fetchBytes: (url: string) => Promise<{ status: number; body?: Uint8Array; retryAfter?: string | null; stopped?: "budget" }>;
  extractText: (bytes: Uint8Array) => Promise<string | null>;
  load: (termYear: number) => Promise<{ liveSince: string | null; lists: StoredOrdersList[] }>;
  rememberIndex: (termYear: number, links: OrdersIndexLink[], seenAt: string) => Promise<{ sourceUrl: string; firstSeenAt: string }[]>;
  storeList: (input: StoreListInput) => Promise<void>;
  storeCoverage: (termYear: number, coverage: OrdersListCoverage, liveSince: string | null) => Promise<void>;
  matchCases: (docketNumber: string) => Promise<string[]>;
  /** Test seam. Production stores the PDF bytes and returns the raw_artifact id. */
  storePdf?: (input: { sourceUrl: string; bytes: Uint8Array; contentHash: string }) => Promise<string | null>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function httpDate(header: string | null | undefined, now: Date): string | null {
  if (!header) return null;
  if (/^\d+$/.test(header.trim())) return new Date(now.getTime() + Number(header.trim()) * 1000).toISOString();
  const parsed = Date.parse(header);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function runOrdersListCycle(deps: OrdersListCycleDeps): Promise<OrdersListCycleResult> {
  const now = deps.now();
  const termYear = deps.termYear ?? octoberTermYear(now);
  const notificationsEnabled = deps.notificationsEnabled ?? false;
  let requests = 0;
  let stored = 0;
  let duplicates = 0;
  let withheld = 0;
  let unlinked = 0;
  let ambiguous = 0;
  let sawError = false;
  let sawRateLimit = false;
  let rateLimitUntil: string | null = null;
  let dateMismatch = false;
  const empty = (runStatus: OrdersRunStatus, links: OrdersIndexLink[] = [], lists: StoredOrdersList[] = []): OrdersListCycleResult => {
    const coverage = assessOrdersListCoverage({ runStatus, links, stored: lists, rateLimitUntil, dateMismatch });
    return {
      ok: runStatus === "succeeded" || runStatus === "partial" || runStatus === "rate_limited",
      termYear, requests, stored, duplicates, withheld, unlinked, ambiguous,
      notifications: "disabled", emailsSent: 0, coverage,
    };
  };

  const indexResponse = await deps.fetchText(ordersIndexUrl(termYear));
  requests += 1;
  if (indexResponse.stopped === "budget") {
    const loaded = await deps.load(termYear);
    const coverage = empty("failed", [], loaded.lists).coverage;
    await deps.storeCoverage(termYear, coverage, loaded.liveSince);
    return { ...empty("failed", [], loaded.lists), skippedReason: "budget" };
  }
  if (indexResponse.status === 429) {
    sawRateLimit = true;
    rateLimitUntil = httpDate(indexResponse.retryAfter, now);
    const loaded = await deps.load(termYear);
    const result = empty("rate_limited", [], loaded.lists);
    await deps.storeCoverage(termYear, result.coverage, loaded.liveSince);
    return result;
  }
  if (indexResponse.status !== 200 || !indexResponse.body) {
    const loaded = await deps.load(termYear);
    const result = { ...empty("failed", [], loaded.lists), skippedReason: `index HTTP ${indexResponse.status}` };
    await deps.storeCoverage(termYear, result.coverage, loaded.liveSince);
    return result;
  }

  const links = parseOrdersIndex(indexResponse.body);
  const state = await deps.load(termYear);
  const seenAt = now.toISOString();
  const seen = await deps.rememberIndex(termYear, links, seenAt);
  const liveSince = state.liveSince ?? seenAt;
  let lists = state.lists.map((row) => ({ ...row, entryKeys: [...row.entryKeys] }));
  const knownKeys = () => new Set(lists.flatMap((row) => row.entryKeys));
  const backfilledFor = (url: string) => {
    if (state.liveSince === null) return true;
    const row = seen.find((item) => item.sourceUrl === url);
    if (!row) return true;
    return new Date(row.firstSeenAt).getTime() <= new Date(state.liveSince).getTime();
  };

  const plan = planOrdersListFetches({ links, stored: lists, maxPdfs: deps.maxPdfs });
  for (const item of plan) {
    const response = await deps.fetchBytes(item.link.sourceUrl);
    requests += 1;
    if (response.stopped === "budget") break;
    if (response.status === 429) {
      sawRateLimit = true;
      rateLimitUntil = httpDate(response.retryAfter, now);
      break;
    }
    if (response.status === 304) continue;
    if (response.status !== 200 || !response.body) {
      sawError = true;
      continue;
    }
    const contentHash = sha256(response.body);
    const existing = lists.find((row) => row.sourceUrl === item.link.sourceUrl && row.contentHash === contentHash);
    if (existing?.extractionStatus === "ok") {
      duplicates += 1;
      continue;
    }
    const text = await deps.extractText(response.body);
    const backfilled = backfilledFor(item.link.sourceUrl);
    if (!text) {
      sawError = true;
      const failed: StoredOrdersList = {
        sourceUrl: item.link.sourceUrl, contentHash, listDate: item.link.listDate, extractionStatus: "failed",
        backfilled, superseded: false, entryKeys: [], withheldEntries: 0, unlinkedEntries: 0, ambiguousEntries: 0,
      };
      if (!existing) {
        lists.push(failed);
        await deps.storeList({
          termYear, indexDate: item.link.listDate, printedDate: null, sourceUrl: item.link.sourceUrl, contentHash,
          backfilled, extractionStatus: "failed", supersedeUrls: [], artifactId: null, entries: [],
        });
      }
      continue;
    }
    const parsed = parseOrdersListText(text, item.link.listDate);
    if (parsed.dateMismatch) dateMismatch = true;
    const listDate = item.link.listDate;
    const decision = existing?.extractionStatus === "failed"
      ? { action: "store" as const, supersedeUrls: [] as string[] }
      : revisionForIncoming({ sourceUrl: item.link.sourceUrl, contentHash, listDate, stored: lists });
    if (decision.action === "duplicate") {
      duplicates += 1;
      continue;
    }
    const artifactId = deps.storePdf ? await deps.storePdf({ sourceUrl: item.link.sourceUrl, bytes: response.body, contentHash }) : null;
    const entries = [];
    let rowWithheld = 0;
    let rowUnlinked = 0;
    let rowAmbiguous = 0;
    const rowKeys: string[] = [];
    const seenKeys = knownKeys();
    for (const entry of parsed.entries) {
      const link = entry.withheld || !entry.docketNumber
        ? { status: (entry.withheld ? "withheld" : "unlinked") as LinkStatus, caseId: null as string | null }
        : linkOrdersListEntry(await deps.matchCases(entry.docketNumber));
      if (entry.withheld) link.status = "withheld";
      if (link.status === "withheld" || entry.withheld) link.caseId = null;
      const notify = shouldNotifyOrdersListEntry({
        backfilled, withheld: entry.withheld, superseded: false,
        duplicateOfExisting: seenKeys.has(ordersEntryKey(entry)),
        linkStatus: entry.withheld ? "withheld" : link.status,
        notificationsEnabled,
      });
      seenKeys.add(ordersEntryKey(entry));
      if (entry.withheld) { withheld += 1; rowWithheld += 1; }
      else if (link.status === "unlinked") { unlinked += 1; rowUnlinked += 1; }
      else if (link.status === "ambiguous") { ambiguous += 1; rowAmbiguous += 1; }
      rowKeys.push(ordersEntryKey(entry));
      entries.push({ ...entry, linkStatus: entry.withheld ? "withheld" as const : link.status, caseId: link.caseId, notify, backfilled });
    }
    lists = lists.map((row) => decision.supersedeUrls.includes(row.sourceUrl) ? { ...row, superseded: true } : row);
    if (existing?.extractionStatus === "failed") {
      lists = lists.filter((row) => !(row.sourceUrl === item.link.sourceUrl && row.contentHash === contentHash));
    }
    lists.push({
      sourceUrl: item.link.sourceUrl, contentHash, listDate, extractionStatus: "ok", backfilled, superseded: false,
      entryKeys: rowKeys, withheldEntries: rowWithheld, unlinkedEntries: rowUnlinked, ambiguousEntries: rowAmbiguous,
    });
    await deps.storeList({
      termYear, indexDate: listDate, printedDate: parsed.printedDate, sourceUrl: item.link.sourceUrl, contentHash,
      backfilled, extractionStatus: "ok", supersedeUrls: decision.supersedeUrls, artifactId, entries,
    });
    stored += 1;
  }

  const runStatus: OrdersRunStatus = sawRateLimit ? "rate_limited" : sawError ? "partial" : "succeeded";
  const coverage = assessOrdersListCoverage({ runStatus, links, stored: lists, rateLimitUntil, dateMismatch });
  await deps.storeCoverage(termYear, coverage, liveSince);
  return {
    ok: true,
    termYear, requests, stored, duplicates, withheld, unlinked, ambiguous,
    notifications: "disabled", emailsSent: 0, coverage,
  };
}

export interface ScotusOrdersListOptions {
  maxRequests?: number;
  maxPdfs?: number;
  maxMs?: number;
  minIntervalMs?: number;
  termYear?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  extractText?: (bytes: Uint8Array) => Promise<string | null>;
}

async function pdftotext(bytes: Uint8Array): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "scotus-orders-"));
  const file = join(dir, "order-list.pdf");
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    const text = stdout.replace(/\u0000/g, "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runScotusOrdersLists(
  sql: Sql,
  store: ArtifactStore,
  options: ScotusOrdersListOptions = {},
): Promise<OrdersListCycleResult> {
  const budget = new FetchBudget({
    source: "scotus-orders-lists",
    maxRequests: options.maxRequests ?? 8,
    maxMs: options.maxMs ?? 6 * 60_000,
    minIntervalMs: options.minIntervalMs ?? 1000,
    fetchImpl: options.fetchImpl,
    now: options.now ? () => options.now!().getTime() : undefined,
  });
  const provider = await providerId(sql, "scotus_official");

  const fetchText = async (url: string) => {
    if (!budget.canFetch) return { status: 0, stopped: "budget" as const };
    try {
      const response = await budget.get(url, "text/html");
      return { status: response.status, body: response.ok ? await response.text() : undefined };
    } catch (error) {
      if (error instanceof RateLimitedError) return { status: 429, retryAfter: error.retryAfterUntil?.toISOString() ?? null };
      if (error instanceof BudgetExhaustedError) return { status: 0, stopped: "budget" as const };
      throw error;
    }
  };
  const fetchBytes = async (url: string) => {
    if (!budget.canFetch) return { status: 0, stopped: "budget" as const };
    try {
      const response = await budget.get(url, "application/pdf");
      if (response.status === 304) return { status: 304 };
      const body = response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
      return { status: response.status, body };
    } catch (error) {
      if (error instanceof RateLimitedError) return { status: 429, retryAfter: error.retryAfterUntil?.toISOString() ?? null };
      if (error instanceof BudgetExhaustedError) return { status: 0, stopped: "budget" as const };
      throw error;
    }
  };

  return runOrdersListCycle({
    now: options.now ?? (() => new Date()),
    termYear: options.termYear,
    maxPdfs: options.maxPdfs ?? 3,
    notificationsEnabled: ORDERS_LIST_NOTIFICATIONS_ENABLED,
    fetchText,
    fetchBytes,
    extractText: options.extractText ?? pdftotext,
    load: (termYear) => loadOrdersState(sql, termYear),
    rememberIndex: (termYear, links, seenAt) => rememberOrdersIndex(sql, termYear, links, seenAt),
    storeList: (input) => storeOrdersList(sql, input),
    storeCoverage: (termYear, coverage, liveSince) => storeOrdersCoverage(sql, termYear, coverage, liveSince),
    matchCases: (docketNumber) => matchScotusDocket(sql, docketNumber),
    storePdf: async ({ sourceUrl, bytes, contentHash }) => {
      const stored = await store.putIfAbsent({
        key: `scotus-orders-list/${contentHash}.pdf`,
        mediaType: "application/pdf",
        body: bytes,
        contentHash,
      });
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key, media_type, retrieved_at, response_metadata)
        VALUES (${provider}, ${sourceUrl}, ${contentHash}, ${contentHash}, ${stored.objectKey}, 'application/pdf', now(), ${sql.json({ parser: ORDERS_LIST_PARSER_VERSION })})
        ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = raw_artifact.retrieved_at
        RETURNING id`;
      return artifact?.id ?? null;
    },
  });
}

function docketKey(docketNumber: string): string {
  return docketNumber.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

async function matchScotusDocket(sql: Sql, docketNumber: string): Promise<string[]> {
  const key = docketKey(docketNumber);
  if (!key) return [];
  const rows = await sql<{ id: string }[]>`
    SELECT DISTINCT id FROM (
      SELECT legal_case.id
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      WHERE lower(court.provider_court_id) = 'scotus'
        AND lower(regexp_replace(legal_case.docket_number, '[^A-Za-z0-9]', '', 'g')) = ${key}
      UNION
      SELECT case_identifier.case_id
      FROM case_identifier
      JOIN legal_case ON legal_case.id = case_identifier.case_id
      JOIN court ON court.id = legal_case.court_id
      WHERE lower(court.provider_court_id) = 'scotus'
        AND case_identifier.identifier_type = 'scotus_docket'
        AND lower(regexp_replace(case_identifier.identifier_value, '[^A-Za-z0-9]', '', 'g')) = ${key}
    ) matched`;
  return rows.map((row) => row.id);
}

async function loadOrdersState(sql: Sql, termYear: number): Promise<{ liveSince: string | null; lists: StoredOrdersList[] }> {
  const [coverage] = await sql<{ live_since: string | null }[]>`
    SELECT live_since::text FROM scotus_orders_list_coverage WHERE term_year = ${termYear}`;
  const lists = await sql<{
    source_url: string; content_hash: string; list_date: string; extraction_status: "ok" | "failed";
    backfilled: boolean; superseded: boolean; withheld_entries: number; unlinked_entries: number; ambiguous_entries: number;
    entry_keys: string[] | null;
  }[]>`
    SELECT list.source_url, list.content_hash, list.list_date::text, list.extraction_status, list.backfilled,
      list.superseded_at IS NOT NULL AS superseded,
      count(*) FILTER (WHERE entry.withheld)::int AS withheld_entries,
      count(*) FILTER (WHERE entry.link_status = 'unlinked')::int AS unlinked_entries,
      count(*) FILTER (WHERE entry.link_status = 'ambiguous')::int AS ambiguous_entries,
      array_remove(array_agg(CASE WHEN entry.id IS NULL THEN NULL ELSE COALESCE(entry.docket_number, '') || '|' || entry.action || '|' || entry.text_hash END), NULL) AS entry_keys
    FROM scotus_orders_list list
    LEFT JOIN scotus_orders_list_entry entry ON entry.list_id = list.id
    WHERE list.term_year = ${termYear}
    GROUP BY list.id`;
  return {
    liveSince: coverage?.live_since ?? null,
    lists: lists.map((row) => ({
      sourceUrl: row.source_url,
      contentHash: row.content_hash,
      listDate: row.list_date,
      extractionStatus: row.extraction_status,
      backfilled: row.backfilled,
      superseded: row.superseded,
      withheldEntries: row.withheld_entries,
      unlinkedEntries: row.unlinked_entries,
      ambiguousEntries: row.ambiguous_entries,
      entryKeys: row.entry_keys ?? [],
    })),
  };
}

async function rememberOrdersIndex(sql: Sql, termYear: number, links: OrdersIndexLink[], seenAt: string): Promise<{ sourceUrl: string; firstSeenAt: string }[]> {
  for (const link of links) {
    await sql`
      INSERT INTO scotus_orders_list_index (term_year, source_url, list_date, label, first_seen_at)
      VALUES (${termYear}, ${link.sourceUrl}, ${link.listDate}, ${link.label}, ${seenAt})
      ON CONFLICT (term_year, source_url) DO NOTHING`;
  }
  return sql<{ sourceUrl: string; firstSeenAt: string }[]>`
    SELECT source_url AS "sourceUrl", first_seen_at::text AS "firstSeenAt"
    FROM scotus_orders_list_index WHERE term_year = ${termYear}`;
}

async function storeOrdersList(sql: Sql, input: StoreListInput): Promise<void> {
  await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    if (input.supersedeUrls.length) {
      await db`
        UPDATE scotus_orders_list SET superseded_at = COALESCE(superseded_at, now())
        WHERE term_year = ${input.termYear} AND source_url = ANY(${input.supersedeUrls}) AND content_hash <> ${input.contentHash}`;
    }
    const [existing] = await db<{ id: string; extraction_status: string }[]>`
      SELECT id, extraction_status FROM scotus_orders_list
      WHERE source_url = ${input.sourceUrl} AND content_hash = ${input.contentHash}`;
    let listId = existing?.id ?? null;
    if (existing?.extraction_status === "ok") return;
    const [prior] = await db<{ revision: number }[]>`
      SELECT COALESCE(max(revision), 0) AS revision FROM scotus_orders_list
      WHERE term_year = ${input.termYear} AND list_date = ${input.indexDate}`;
    const revision = existing ? undefined : (prior?.revision ?? 0) + 1;
    if (!listId) {
      const [created] = await db<{ id: string }[]>`
        INSERT INTO scotus_orders_list (
          term_year, list_date, index_date, printed_date, source_url, content_hash, revision,
          extraction_status, backfilled, parser_version, artifact_id
        ) VALUES (
          ${input.termYear}, ${input.indexDate}, ${input.indexDate}, ${input.printedDate}, ${input.sourceUrl},
          ${input.contentHash}, ${revision ?? 1}, ${input.extractionStatus}, ${input.backfilled},
          ${ORDERS_LIST_PARSER_VERSION}, ${input.artifactId}
        )
        ON CONFLICT (source_url, content_hash) DO NOTHING
        RETURNING id`;
      listId = created?.id ?? null;
    } else if (input.extractionStatus === "ok") {
      await db`
        UPDATE scotus_orders_list
        SET extraction_status = 'ok', printed_date = ${input.printedDate}, artifact_id = COALESCE(${input.artifactId}, artifact_id)
        WHERE id = ${listId} AND extraction_status = 'failed'`;
    }
    if (!listId || input.extractionStatus !== "ok") return;
    for (const entry of input.entries) {
      await db`
        INSERT INTO scotus_orders_list_entry (
          list_id, ordinal, section_heading, docket_number, caption, action, exact_text, separate_writings,
          plain_headline, plain_detail, uncertainty, withheld, link_status, case_id, backfilled, notify, text_hash
        ) VALUES (
          ${listId}, ${entry.ordinal}, ${entry.sectionHeading}, ${entry.docketNumber}, ${entry.caption}, ${entry.action},
          ${entry.exactText}, ${db.json(JSON.parse(JSON.stringify(entry.separateWritings)) as postgres.JSONValue)}, ${entry.plainHeadline}, ${entry.plainDetail},
          ${entry.uncertainty}, ${entry.withheld}, ${entry.linkStatus}, ${entry.caseId}, ${entry.backfilled}, false, ${entry.textHash}
        )
        ON CONFLICT (list_id, ordinal) DO NOTHING`;
    }
  });
}

async function storeOrdersCoverage(sql: Sql, termYear: number, coverage: OrdersListCoverage, liveSince: string | null): Promise<void> {
  const success = coverage.runStatus === "succeeded" || coverage.runStatus === "partial" || (coverage.runStatus === "rate_limited" && coverage.storedWithText > 0);
  await sql`
    INSERT INTO scotus_orders_list_coverage (
      term_year, live_since, last_run_at, last_run_status, last_success_at, indexed_lists, stored_lists,
      stored_with_text, pending_lists, failed_lists, withheld_entries, unlinked_entries, ambiguous_entries,
      newest_indexed_on, newest_stored_on, backfill_remaining, rate_limit_until, completeness, note, updated_at
    ) VALUES (
      ${termYear}, ${liveSince}, now(), ${coverage.runStatus}, ${success ? sql`now()` : null},
      ${coverage.indexedLists}, ${coverage.storedLists}, ${coverage.storedWithText}, ${coverage.pendingLists},
      ${coverage.failedLists}, ${coverage.withheldEntries}, ${coverage.unlinkedEntries}, ${coverage.ambiguousEntries},
      ${coverage.newestIndexedOn}, ${coverage.newestStoredOn}, ${coverage.backfillRemaining}, ${coverage.rateLimitUntil},
      ${coverage.completeness}, ${coverage.note}, now()
    )
    ON CONFLICT (term_year) DO UPDATE SET
      live_since = COALESCE(scotus_orders_list_coverage.live_since, EXCLUDED.live_since),
      last_run_at = now(),
      last_run_status = EXCLUDED.last_run_status,
      last_success_at = COALESCE(EXCLUDED.last_success_at, scotus_orders_list_coverage.last_success_at),
      indexed_lists = EXCLUDED.indexed_lists,
      stored_lists = EXCLUDED.stored_lists,
      stored_with_text = EXCLUDED.stored_with_text,
      pending_lists = EXCLUDED.pending_lists,
      failed_lists = EXCLUDED.failed_lists,
      withheld_entries = EXCLUDED.withheld_entries,
      unlinked_entries = EXCLUDED.unlinked_entries,
      ambiguous_entries = EXCLUDED.ambiguous_entries,
      newest_indexed_on = EXCLUDED.newest_indexed_on,
      newest_stored_on = EXCLUDED.newest_stored_on,
      backfill_remaining = EXCLUDED.backfill_remaining,
      rate_limit_until = EXCLUDED.rate_limit_until,
      completeness = EXCLUDED.completeness,
      note = EXCLUDED.note,
      updated_at = now()`;
}

export async function assertPdftotextAvailable(): Promise<boolean> {
  try {
    await execFileAsync("pdftotext", ["-v"]);
    return true;
  } catch (error) {
    const failure = error as { code?: string; stderr?: string };
    if (failure.code === "ENOENT") return false;
    return /pdftotext version/i.test(failure.stderr ?? "");
  }
}
