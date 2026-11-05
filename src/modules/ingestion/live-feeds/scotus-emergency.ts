/**
 * Supreme Court emergency docket lane ("scotus-emergency", every 10 minutes).
 *
 * Re-reads the public docket page of each open emergency application
 * (https://www.supremecourt.gov/docket/docketfiles/html/public/26a624.html)
 * with a conditional request (If-Modified-Since), so an unchanged page costs
 * one small 304. It never touches /rss/ (robots.txt disallows it) and stays
 * under one request per second with a user agent naming jurvio.com and a
 * contact address; an HTTP 429 stops the run and the Retry-After time is
 * honoured by the next runs.
 *
 * Each run:
 *   1. Probes the next few application numbers past the highest known one
 *      (new applications usually appear within one run of the Court docketing them).
 *   2. Re-reads every due application page: hot and open serious applications
 *      every run, pending extensions and recently decided ones daily, older
 *      decided ones never.
 *   3. Seeds a small batch of applications Jurvio holds but has not read here
 *      yet (newest first), so the lane fills in without a burst.
 *
 * Light by design (it runs on the production box): one connection, about
 * 10 to 40 small requests a run, no PDFs. Only docket lines that pass the
 * strict sealed/restricted filter are stored or shown; a case whose caption
 * trips it is skipped entirely.
 */
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { ArtifactStore } from "../application/artifact-store";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { classifyEvent, entryImportance, parseOfficialDocket } from "../providers/scotus/official-docket";
import { readDocketTitle } from "../providers/scotus/docket-status";
import { FetchBudget, RateLimitedError } from "./polite-fetcher";
import { matchOrCreateDraftCase, providerId, resolveCourt, storeFeedArtifact } from "./persist";
import { scotusDocketYear } from "./scotus-docket-feed";
import {
  administrationOn, classifyApplicant, deriveApplicationState, easternDate, expectedJusticeFor, justiceSlugForRef,
  normalizeApplicationNumber, parseApplicationNumber, pollTier, TIER_INTERVAL_MINUTES, EMERGENCY_PARSER_VERSION,
  type DocketLine, type PollTier,
} from "@/modules/scotus/domain/emergency-application";

type Sql = ReturnType<typeof postgres>;

export const SCOTUS_DOCKET_PAGE_ORIGIN = "https://www.supremecourt.gov/docket/docketfiles/html/public";
/** Sentinel poll row that carries a host-wide Retry-After from a 429. */
const HOST_BACKOFF_URL = "https://www.supremecourt.gov/";
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

/** Extra strict wording the alert filter also refuses (entity-alerts RESTRICTED_TEXT); a line tripping either is withheld. */
const ALERT_RESTRICTED = /\b(seal|seals|sealed|sealing|unseal|unsealed|under seal|ex parte|in camera|grand jury|juvenile|restricted|suppressed|redacted)\b/i;
/** The follow rule's caption filter (follows.ts SEALED_CAPTION). */
const SEALED_CAPTION = /\b(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\b/i;

export function isWithheldLine(text: string): boolean {
  return isRestrictedDocketText(text) || ALERT_RESTRICTED.test(text);
}

export function isWithheldCaption(caption: string): boolean {
  return isRestrictedDocketText(caption) || SEALED_CAPTION.test(caption) || ALERT_RESTRICTED.test(caption);
}

export function docketPageUrl(docketNumber: string): string {
  return `${SCOTUS_DOCKET_PAGE_ORIGIN}/${docketNumber.toLowerCase()}.html`;
}

export interface EmergencyRunOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  maxRequests?: number;
  maxMs?: number;
  minIntervalMs?: number;
  /** Numbers probed past the highest known application. */
  frontierProbes?: number;
  /** Never-read applications read per run (newest first). */
  seedPerRun?: number;
  /** Pages stored by an older parser version to read again per run (default 10). */
  reparsePerRun?: number;
  /** Docket years to seed (two-digit). Default: this docket year and the one before. */
  seedYears?: number[];
  /**
   * Numbers below the frontier of this docket year that Jurvio holds no row for
   * (never seeded because the JSON discovery lane never had them) to read per run,
   * newest first. Read like seeds (lines are history, not news). Default 5.
   */
  gapPerRun?: number;
}

export interface EmergencyRunResult {
  ok: boolean;
  requests: number;
  notModified: number;
  changed: number;
  discovered: string[];
  seeded: number;
  /** Numbers below the frontier read by the gap sweep. */
  gapsRead: number;
  newEvents: number;
  withheldLines: number;
  skippedRestricted: number;
  errors: string[];
  retryAfterUntil: string | null;
  skippedReason?: string;
}

/** What one docket page says, privacy-filtered. Exported for tests. */
export interface ParsedApplicationPage {
  docketNumber: string;
  caption: string;
  applicant: string | null;
  capital: boolean;
  solicitorGeneral: boolean;
  linkedDocket: string | null;
  docketedOn: string | null;
  lowerCourt: string | null;
  lowerCaseNumbers: string[];
  lines: DocketLine[];
  withheldLines: number;
  restricted: boolean;
}

export function parseApplicationPage(html: string, docketNumber: string): ParsedApplicationPage {
  const url = docketPageUrl(docketNumber);
  const docket = parseOfficialDocket(html, docketNumber, url);
  const title = readDocketTitle(html);
  const caption = [title.petitioner, title.respondent].filter(Boolean).join(" v. ") || docketNumber;
  // Counsel of record for the applicant: the block between "Attorneys for Petitioner" and the next "Attorneys for".
  // Read only to tell whether the Solicitor General filed; nothing from it is kept.
  const counsel = /Attorneys\s+for\s+(?:Petitioner|Applicant)s?([\s\S]{0,3000}?)(?:Attorneys\s+for|Other\s+Attorneys|<\/table>|$)/i.exec(html)?.[1] ?? "";
  const linked = /Linked\s+with:\s*(?:<[^>]+>\s*)*([0-9]{2}-[0-9]+|[0-9]{2}A[0-9]+)/i.exec(html)?.[1] ?? null;
  // Shown text drops the document link labels ("Main Document Proof of Service"). Event ids are
  // positional, so both parses line up. The filter checks the full text, link titles included.
  const clean = parseOfficialDocket(html.replace(/<span\s+class="documentlinks">[\s\S]*?<\/span>/gi, ""), docketNumber, url);
  const cleanText = new Map(clean.events.map((event) => [event.sourceRecordId, event.description]));
  const lines: DocketLine[] = [];
  let withheld = 0;
  for (const event of docket.events) {
    const text = cleanText.get(event.sourceRecordId) || event.description;
    if (isWithheldLine(event.description) || isWithheldLine(text)) { withheld += 1; continue; }
    lines.push({ sourceRecordId: event.sourceRecordId, filedOn: event.filedOn, description: text.slice(0, 6000) });
  }
  return {
    docketNumber, caption: caption.slice(0, 600), applicant: title.petitioner,
    capital: /\*{3}\s*CAPITAL\s+CASE\s*\*{3}/i.test(html),
    solicitorGeneral: /\bSolicitor\s+General\b/i.test(counsel) && /United\s+States\s+Department\s+of\s+Justice/i.test(counsel),
    linkedDocket: linked, docketedOn: docket.docketedOn, lowerCourt: docket.lowerCourtName,
    lowerCaseNumbers: docket.lowerCourtCaseNumbers.slice(0, 6), lines, withheldLines: withheld,
    restricted: isWithheldCaption(caption),
  };
}

function emptyResult(): EmergencyRunResult {
  return { ok: false, requests: 0, notModified: 0, changed: 0, discovered: [], seeded: 0, gapsRead: 0, newEvents: 0, withheldLines: 0,
    skippedRestricted: 0, errors: [], retryAfterUntil: null };
}

function addMinutes(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/** Next check time for a tier; `retired` = far future (never, in practice). */
export function nextCheckAt(tier: PollTier, now: Date): Date {
  const minutes = TIER_INTERVAL_MINUTES[tier];
  return minutes === null ? new Date("9999-01-01T00:00:00Z") : addMinutes(now, minutes);
}

export async function runScotusEmergency(sql: Sql, store: ArtifactStore, options: EmergencyRunOptions = {}): Promise<EmergencyRunResult> {
  const result = emptyResult();
  const now = options.now?.() ?? new Date();
  const [backoff] = await sql<{ until: Date }[]>`
    SELECT next_check_at AS until FROM scotus_source_poll WHERE url = ${HOST_BACKOFF_URL} AND next_check_at > ${now}`;
  if (backoff) {
    result.skippedReason = `supremecourt.gov asked us to wait until ${new Date(backoff.until).toISOString()}`;
    result.retryAfterUntil = new Date(backoff.until).toISOString();
    return result;
  }
  const budget = new FetchBudget({
    source: "scotus_emergency", maxRequests: options.maxRequests ?? 60, maxMs: options.maxMs ?? 5 * 60_000,
    minIntervalMs: options.minIntervalMs ?? 1_000, fetchImpl: options.fetchImpl, now: options.now ? () => options.now!().getTime() : undefined,
  });
  const provider = await providerId(sql, "scotus_official");
  const today = easternDate(now);

  /** One conditional GET; returns the page body, 'not-modified', 'missing' or throws. */
  const fetchPage = async (docketNumber: string, lastModified: string | null) => {
    const url = docketPageUrl(docketNumber);
    const response = await budget.get(url, "text/html", { headers: lastModified ? { "If-Modified-Since": lastModified } : {} });
    if (response.status === 304) return { kind: "not-modified" as const, url };
    if (response.status === 404) return { kind: "missing" as const, url };
    if (!response.ok) throw new Error(`${docketNumber}: HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_PAGE_BYTES) throw new Error(`${docketNumber}: page too large`);
    const body = await response.text();
    if (body.length > MAX_PAGE_BYTES) throw new Error(`${docketNumber}: page too large`);
    return { kind: "page" as const, url, body, lastModified: response.headers.get("last-modified") };
  };

  const recordPoll = async (docketNumber: string, update: { status: number; lastModified?: string | null; changed: boolean; tier: PollTier | null; failed?: boolean }) => {
    const url = docketPageUrl(docketNumber);
    const next = update.failed ? addMinutes(now, 60) : update.tier ? nextCheckAt(update.tier, now) : addMinutes(now, 6 * 60);
    await sql`
      INSERT INTO scotus_source_poll (url, docket_number, last_status, last_modified, checked_at, changed_at, next_check_at, failures, updated_at)
      VALUES (${url}, ${docketNumber}, ${update.status}, ${update.lastModified ?? null}, ${now}, ${update.changed ? now : null}, ${next},
        ${update.failed ? 1 : 0}, now())
      ON CONFLICT (url) DO UPDATE SET last_status = EXCLUDED.last_status,
        last_modified = COALESCE(EXCLUDED.last_modified, scotus_source_poll.last_modified),
        checked_at = EXCLUDED.checked_at, changed_at = COALESCE(EXCLUDED.changed_at, scotus_source_poll.changed_at),
        next_check_at = EXCLUDED.next_check_at,
        failures = CASE WHEN ${Boolean(update.failed)} THEN scotus_source_poll.failures + 1 ELSE 0 END, updated_at = now()`;
  };

  /** Store one application page. `discovered` = first seen past the frontier (its lines are news, not history). */
  const storePage = async (docketNumber: string, page: { body: string; lastModified: string | null; url: string }, mode: "discovered" | "seed" | "poll") => {
    const parsed = parseApplicationPage(page.body, docketNumber);
    result.withheldLines += parsed.withheldLines;
    if (parsed.restricted) {
      result.skippedRestricted += 1;
      await recordPoll(docketNumber, { status: 200, lastModified: page.lastModified, changed: false, tier: "retired" });
      return;
    }
    const state = deriveApplicationState(parsed.lines, { capital: parsed.capital });
    const tier = pollTier(state, today);
    const expected = expectedJusticeFor(parsed.lowerCourt);
    const applicantKind = classifyApplicant(parsed.applicant, parsed.solicitorGeneral);
    const submittedOn = state.submittedOn ?? parsed.lines[0]?.filedOn ?? null;
    await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const artifactId = await storeFeedArtifact(db, store, {
        providerId: provider, sourceUri: page.url, sourceRecordId: `docket:${docketNumber}`,
        keyPrefix: `scotus/dockets/${docketNumber}`, body: page.body, mediaType: "text/html",
        metadata: { docketNumber, eventCount: parsed.lines.length + parsed.withheldLines, lane: "scotus-emergency" },
      });
      const courtId = await resolveCourt(db, { providerId: provider, courtCode: "scotus",
        name: "Supreme Court of the United States", shortName: "SCOTUS", jurisdiction: "Federal Supreme", artifactId });
      const match = await matchOrCreateDraftCase(db, {
        providerId: provider, courtId, courtCode: "scotus", docketNumber, caption: parsed.caption,
        filedOn: parsed.docketedOn ?? submittedOn, artifactId, identifierType: "scotus_docket", identifierValue: docketNumber,
      });
      const caseId = match.kind === "existing" || match.kind === "created" ? match.caseId : null;
      const [existing] = await db<{ docket_number: string }[]>`SELECT docket_number FROM scotus_application WHERE docket_number = ${docketNumber}`;
      await db`
        INSERT INTO scotus_application (docket_number, case_id, caption, applicant, kind, capital, applicant_kind, administration,
          lower_court, lower_case_numbers, linked_docket, expected_justice, submitted_justice, submitted_justice_slug,
          submitted_on, docketed_on, referred_on, response_due_on, response_due_text, response_requested_by,
          admin_stay_on, admin_stay_justice, status, ruling_on, ruled_by, written_reasons, noted_votes, amicus_count,
          entry_count, withheld_lines, last_entry_on, poll_tier, source_url, parser_version, changed_at, updated_at)
        VALUES (${docketNumber}, ${caseId}, ${parsed.caption}, ${parsed.applicant}, ${state.kind}, ${parsed.capital}, ${applicantKind},
          ${administrationOn(submittedOn)}, ${parsed.lowerCourt}, ${db.json(parsed.lowerCaseNumbers)}, ${parsed.linkedDocket},
          ${expected?.justiceRef ?? null}, ${state.submittedJustice}, ${justiceSlugForRef(state.submittedJustice)},
          ${submittedOn}, ${parsed.docketedOn}, ${state.referredOn}, ${state.responseDueOn}, ${state.responseDueText},
          ${state.responseRequestedBy}, ${state.adminStayOn}, ${state.adminStayJustice}, ${state.status}, ${state.rulingOn},
          ${state.ruledBy}, ${state.writtenReasons}, ${db.json(state.notedVotes as unknown as postgres.JSONValue)}, ${state.amicusCount},
          ${parsed.lines.length}, ${parsed.withheldLines}, ${state.lastEntryOn}, ${tier}, ${page.url}, ${EMERGENCY_PARSER_VERSION}, now(), now())
        ON CONFLICT (docket_number) DO UPDATE SET case_id = COALESCE(EXCLUDED.case_id, scotus_application.case_id),
          caption = EXCLUDED.caption, applicant = EXCLUDED.applicant, kind = EXCLUDED.kind, capital = EXCLUDED.capital,
          applicant_kind = EXCLUDED.applicant_kind, administration = EXCLUDED.administration, lower_court = EXCLUDED.lower_court,
          lower_case_numbers = EXCLUDED.lower_case_numbers, linked_docket = EXCLUDED.linked_docket,
          expected_justice = EXCLUDED.expected_justice, submitted_justice = EXCLUDED.submitted_justice,
          submitted_justice_slug = EXCLUDED.submitted_justice_slug, submitted_on = EXCLUDED.submitted_on,
          docketed_on = EXCLUDED.docketed_on, referred_on = EXCLUDED.referred_on, response_due_on = EXCLUDED.response_due_on,
          response_due_text = EXCLUDED.response_due_text, response_requested_by = EXCLUDED.response_requested_by,
          admin_stay_on = EXCLUDED.admin_stay_on, admin_stay_justice = EXCLUDED.admin_stay_justice, status = EXCLUDED.status,
          ruling_on = EXCLUDED.ruling_on, ruled_by = EXCLUDED.ruled_by, written_reasons = EXCLUDED.written_reasons,
          noted_votes = EXCLUDED.noted_votes, amicus_count = EXCLUDED.amicus_count, entry_count = EXCLUDED.entry_count,
          withheld_lines = EXCLUDED.withheld_lines, last_entry_on = EXCLUDED.last_entry_on, poll_tier = EXCLUDED.poll_tier,
          source_url = EXCLUDED.source_url, parser_version = EXCLUDED.parser_version, source_lane = 'live', changed_at = now(), updated_at = now()`;
      // A line is history (not news) when this is the first time this lane reads a docket Jurvio already knew.
      const backfilled = !existing && mode === "seed";
      const known = await db<{ source_record_id: string; filed_on: string | null; description: string }[]>`
        SELECT source_record_id, filed_on::text AS filed_on, description FROM scotus_application_event WHERE docket_number = ${docketNumber}`;
      const knownIds = new Set(known.map((row) => row.source_record_id));
      const knownText = new Set(known.map((row) => `${row.filed_on}|${row.description}`));
      for (const [position, event] of state.events.entries()) {
        if (knownIds.has(event.sourceRecordId) || knownText.has(`${event.filedOn}|${event.description}`)) {
          // Known line: keep its first-seen time (no new alert) but refresh what a newer parser reads in it.
          await db`
            UPDATE scotus_application_event SET kind = ${event.kind}, plain_line = ${event.plain}, justices = ${event.justices}
            WHERE docket_number = ${docketNumber}
              AND (source_record_id = ${event.sourceRecordId} OR (filed_on IS NOT DISTINCT FROM ${event.filedOn}::date AND description = ${event.description}))
              AND (kind IS DISTINCT FROM ${event.kind} OR plain_line IS DISTINCT FROM ${event.plain} OR justices IS DISTINCT FROM ${event.justices}::text[])`;
          continue;
        }
        await db`
          INSERT INTO scotus_application_event (source_record_id, docket_number, position, filed_on, kind, description, plain_line, justices, backfilled)
          VALUES (${event.sourceRecordId}, ${docketNumber}, ${position + 1}, ${event.filedOn}, ${event.kind}, ${event.description},
            ${event.plain}, ${event.justices}, ${backfilled})
          ON CONFLICT (source_record_id) DO NOTHING`;
        if (!backfilled) result.newEvents += 1;
        if (!caseId) continue;
        const entryType = classifyEvent(event.description);
        const [entry] = await db<{ id: string }[]>`
          INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number,
            filed_on, description, entry_type, importance, source_artifact_id)
          VALUES (${createPublicId("docketEntry")}, ${caseId}, ${provider}, ${event.sourceRecordId}, ${String(position + 1)},
            ${event.filedOn}, ${event.description}, ${entryType}, ${entryImportance(entryType, event.description, docketNumber)}, ${artifactId})
          ON CONFLICT (provider_id, provider_entry_id) DO NOTHING
          RETURNING id`;
        // Another lane may have stored the same public line first without a decision.
        const [existing] = entry ? [entry] : await db<{ id: string }[]>`
          SELECT e.id FROM docket_entry e
          WHERE e.provider_id = ${provider} AND e.provider_entry_id = ${event.sourceRecordId} AND e.case_id = ${caseId}
            AND NOT EXISTS (SELECT 1 FROM publication_decision pd WHERE pd.object_type = 'docket_entry' AND pd.object_id = e.id)`;
        if (existing) {
          // Same decision the official docket lane records for every public Supreme Court docket line.
          await db`
            INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version)
            VALUES ('docket_entry', ${existing.id}, true, true, true, false, false,
              'verified_official_scotus_docket', 'official-scotus-docket-v1')`;
        }
      }
    });
    if (mode === "discovered") result.discovered.push(docketNumber);
    if (mode === "seed") result.seeded += 1;
    result.changed += 1;
    await recordPoll(docketNumber, { status: 200, lastModified: page.lastModified, changed: true, tier });
  };

  const handle = async (docketNumber: string, lastModified: string | null, mode: "discovered" | "seed" | "poll") => {
    try {
      const page = await fetchPage(docketNumber, lastModified);
      if (page.kind === "not-modified") {
        result.notModified += 1;
        const [row] = await sql<{ tier: PollTier }[]>`SELECT poll_tier AS tier FROM scotus_application WHERE docket_number = ${docketNumber}`;
        // Tiers move with the calendar too (a response deadline passing makes an application "hot").
        const [fresh] = await sql<{ kind: string; status: string; admin_stay_on: string | null; response_due_on: string | null; ruling_on: string | null; last_entry_on: string | null }[]>`
          SELECT kind, status, admin_stay_on::text, response_due_on::text, ruling_on::text, last_entry_on::text FROM scotus_application WHERE docket_number = ${docketNumber}`;
        const tier = fresh ? pollTier({ kind: fresh.kind as never, status: fresh.status as never, adminStayOn: fresh.admin_stay_on,
          responseDueOn: fresh.response_due_on, rulingOn: fresh.ruling_on, lastEntryOn: fresh.last_entry_on }, today) : row?.tier ?? "open";
        if (fresh && tier !== row?.tier) await sql`UPDATE scotus_application SET poll_tier = ${tier} WHERE docket_number = ${docketNumber}`;
        await recordPoll(docketNumber, { status: 304, changed: false, tier });
        return "ok" as const;
      }
      if (page.kind === "missing") {
        if (mode !== "discovered") await recordPoll(docketNumber, { status: 404, changed: false, tier: null, failed: true });
        return "missing" as const;
      }
      await storePage(docketNumber, page, mode);
      return "ok" as const;
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      if (error instanceof Error && /budget exhausted/.test(error.message)) throw error;
      result.errors.push(error instanceof Error ? error.message.slice(0, 200) : String(error));
      if (mode !== "discovered") await recordPoll(docketNumber, { status: 0, changed: false, tier: null, failed: true });
      return "error" as const;
    }
  };

  try {
    // 1. Frontier: the next numbers past the highest application known for this docket year.
    const year = scotusDocketYear(now);
    const yy = String(year).padStart(2, "0");
    const [frontier] = await sql<{ high: number | null }[]>`
      SELECT max(n) AS high FROM (
        SELECT substring(docket_number FROM 4)::int AS n FROM scotus_application WHERE docket_number LIKE ${`${yy}A%`}
        UNION ALL
        SELECT substring(legal_case.docket_number FROM 4)::int FROM legal_case JOIN court ON court.id = legal_case.court_id
        WHERE lower(court.provider_court_id) = 'scotus' AND legal_case.docket_number ~ ${`^${yy}A[0-9]{1,4}$`}
      ) numbers`;
    let misses = 0;
    let probe = (frontier?.high ?? 0) + 1;
    const probes = options.frontierProbes ?? 5;
    for (let i = 0; i < probes && misses < 3 && budget.canFetch; i += 1, probe += 1) {
      const docketNumber = `${yy}A${probe}`;
      const outcome = await handle(docketNumber, null, "discovered");
      misses = outcome === "missing" ? misses + 1 : 0;
    }

    // 2. Due pages, hottest first. History rows of earlier docket years (loaded by the
    // one-off backfill) are never polled here: re-reading them would flip them to
    // source_lane 'live' and pull them into the list, counts, follows and feeds.
    // History rows of the current docket year are current applications this lane
    // missed, so it adopts them (its upsert marks them live).
    const due = await sql<{ docket_number: string; last_modified: string | null }[]>`
      SELECT p.docket_number, p.last_modified
      FROM scotus_source_poll p JOIN scotus_application a ON a.docket_number = p.docket_number
      WHERE p.next_check_at <= ${now} AND a.poll_tier <> 'retired' AND (a.source_lane = 'live' OR a.docket_number LIKE ${`${yy}A%`})
      ORDER BY CASE a.poll_tier WHEN 'hot' THEN 0 WHEN 'open' THEN 1 WHEN 'closed' THEN 2 ELSE 3 END, p.next_check_at
      LIMIT 200`;
    for (const row of due) {
      if (!budget.canFetch) break;
      await handle(row.docket_number, row.last_modified, "poll");
    }

    // 2b. Pages stored by an older parser: read them again in full (no If-Modified-Since,
    // since the page itself may not have changed), pending first, a few per run.
    const reparseLimit = Math.min(options.reparsePerRun ?? 10, budget.remainingRequests);
    if (reparseLimit > 0 && budget.canFetch) {
      const stale = await sql<{ docket_number: string }[]>`
        SELECT a.docket_number FROM scotus_application a
        WHERE a.parser_version <> ${EMERGENCY_PARSER_VERSION} AND a.poll_tier <> 'retired' AND (a.source_lane = 'live' OR a.docket_number LIKE ${`${yy}A%`})
        ORDER BY (a.status = 'pending') DESC, a.last_entry_on DESC NULLS LAST
        LIMIT ${reparseLimit}`;
      for (const row of stale) {
        if (!budget.canFetch) break;
        await handle(row.docket_number, null, "poll");
      }
    }

    // 3. Seed: applications Jurvio holds (from the JSON discovery lane) that this lane has not read yet.
    const years = (options.seedYears ?? [year, year - 1]).map((value) => String(value).padStart(2, "0"));
    const seedLimit = Math.min(options.seedPerRun ?? 15, budget.remainingRequests);
    if (seedLimit > 0 && budget.canFetch) {
      const seeds = await sql<{ docket_number: string }[]>`
        SELECT lc.docket_number,
          bool_or(e.description ~* 'extend the time') AS extension
        FROM legal_case lc JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
        LEFT JOIN docket_entry e ON e.case_id = lc.id
        WHERE lc.docket_number ~ '^[0-9]{2}A[0-9]{1,4}$' AND substring(lc.docket_number FROM 1 FOR 2) = ANY(${years}::text[])
          AND NOT EXISTS (SELECT 1 FROM scotus_application a WHERE a.docket_number = lc.docket_number)
          AND NOT EXISTS (SELECT 1 FROM scotus_source_poll p WHERE p.docket_number = lc.docket_number AND p.next_check_at > ${now})
        GROUP BY lc.docket_number
        ORDER BY coalesce(bool_or(e.description ~* 'extend the time'), false),
          substring(lc.docket_number FROM 1 FOR 2) DESC, substring(lc.docket_number FROM 4)::int DESC
        LIMIT ${seedLimit}`;
      for (const seed of seeds) {
        if (!budget.canFetch) break;
        const docketNumber = normalizeApplicationNumber(seed.docket_number);
        if (!docketNumber || !parseApplicationNumber(docketNumber)) continue;
        await handle(docketNumber, null, "seed");
      }
    }
    // 4. Gaps: numbers below the frontier this lane never read (no row, no pending
    // re-check). Read like seeds; a missing page is tried again in a week.
    const gapLimit = Math.min(options.gapPerRun ?? 5, budget.remainingRequests);
    const high = frontier?.high ?? 0;
    if (gapLimit > 0 && high > 1 && budget.canFetch) {
      const gaps = await sql<{ docket_number: string }[]>`
        SELECT ${`${yy}A`} || n AS docket_number FROM generate_series(1, ${high}::int) n
        WHERE NOT EXISTS (SELECT 1 FROM scotus_application a WHERE a.docket_number = ${`${yy}A`} || n)
          AND NOT EXISTS (SELECT 1 FROM scotus_source_poll p WHERE p.docket_number = ${`${yy}A`} || n AND p.next_check_at > ${now})
        ORDER BY n DESC LIMIT ${gapLimit}`;
      for (const gap of gaps) {
        if (!budget.canFetch) break;
        const outcome = await handle(gap.docket_number, null, "seed");
        result.gapsRead += 1;
        if (outcome === "missing") {
          await sql`UPDATE scotus_source_poll SET next_check_at = ${addMinutes(now, 7 * 24 * 60)}, updated_at = now()
            WHERE url = ${docketPageUrl(gap.docket_number)}`;
        }
      }
    }
    result.ok = result.errors.length === 0;
  } catch (error) {
    if (error instanceof RateLimitedError) {
      const until = error.retryAfterUntil ?? addMinutes(now, 30);
      result.retryAfterUntil = until.toISOString();
      result.errors.push(error.message);
      await sql`
        INSERT INTO scotus_source_poll (url, docket_number, last_status, checked_at, next_check_at, updated_at)
        VALUES (${HOST_BACKOFF_URL}, NULL, 429, ${now}, ${until}, now())
        ON CONFLICT (url) DO UPDATE SET last_status = 429, checked_at = EXCLUDED.checked_at, next_check_at = EXCLUDED.next_check_at, updated_at = now()`;
    } else if (error instanceof Error && /budget exhausted/.test(error.message)) {
      result.ok = result.errors.length === 0;
    } else {
      result.errors.push(error instanceof Error ? error.message.slice(0, 300) : String(error));
    }
  }
  result.requests = budget.requests;
  return result;
}
