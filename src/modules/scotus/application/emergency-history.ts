/**
 * History backfill for the Supreme Court emergency docket: turns one public
 * docket page of an application from an earlier docket year (17A1 ...) into the
 * same scotus_application / scotus_application_event rows the live lane writes,
 * as COPY-ready TSV lines. Pure (no I/O); the builder script
 * scripts/backfill-scotus-emergency-history.ts fetches and caches the pages and
 * the workflow loads the TSV.
 *
 * The privacy rules are the live lane's own: parseApplicationPage applies the
 * strict sealed/restricted line filter and a page whose caption trips it is
 * skipped entirely (returns null).
 */
import { ALLOTMENT_EFFECTIVE } from "@/modules/scotus/domain/circuit-justice";
import { docketPageUrl, parseApplicationPage } from "@/modules/ingestion/live-feeds/scotus-emergency";
import {
  administrationOn, classifyApplicant, deriveApplicationState, EMERGENCY_PARSER_VERSION, expectedJusticeFor,
  justiceSlugForRef, pollTier,
} from "@/modules/scotus/domain/emergency-application";

/** Column order of the history TSVs (the load SQL lists the same columns). */
export const HISTORY_APPLICATION_COLUMNS = [
  "docket_number", "caption", "applicant", "kind", "capital", "applicant_kind", "administration", "lower_court",
  "lower_case_numbers", "linked_docket", "expected_justice", "submitted_justice", "submitted_justice_slug", "submitted_on",
  "docketed_on", "referred_on", "response_due_on", "response_due_text", "response_requested_by", "admin_stay_on",
  "admin_stay_justice", "status", "ruling_on", "ruled_by", "written_reasons", "noted_votes", "amicus_count", "entry_count",
  "withheld_lines", "last_entry_on", "poll_tier", "source_url", "parser_version",
] as const;

export const HISTORY_EVENT_COLUMNS = [
  "source_record_id", "docket_number", "position", "filed_on", "kind", "description", "plain_line", "justices",
] as const;

type Cell = string | number | boolean | null;

/** One value in PostgreSQL COPY text format. */
export function copyCell(value: Cell): string {
  if (value === null) return "\\N";
  const text = typeof value === "boolean" ? (value ? "t" : "f") : String(value);
  return text.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** A text[] literal ({"Kagan","The Chief Justice"}). */
export function textArrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

export interface HistoryRows {
  application: string;
  events: string[];
  /** For run stats. */
  kind: string;
  status: string;
}

/**
 * An old application whose own docket never shows a ruling (older pages often
 * end with "Application (17A145) completed." when the stay was decided on the
 * companion petition docket). The live lane must not poll it forever.
 */
function staleOpen(state: { status: string; lastEntryOn: string | null; submittedOn: string | null }, today: string): boolean {
  const last = state.lastEntryOn ?? state.submittedOn;
  return state.status === "pending" && Boolean(last) && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`) > 365 * 86_400_000;
}

/**
 * Rows for one cached docket page, or null when the caption is restricted.
 * `today` (Eastern, yyyy-mm-dd) only sets the poll tier: decided long ago =
 * retired (the live lane never re-reads it); anything still open stays pollable.
 */
export function historyRowsFromPage(html: string, docketNumber: string, today: string): HistoryRows | null {
  const parsed = parseApplicationPage(html, docketNumber);
  if (parsed.restricted) return null;
  const state = deriveApplicationState(parsed.lines, { capital: parsed.capital });
  const submittedOn = state.submittedOn ?? parsed.lines[0]?.filedOn ?? null;
  // The circuit-justice allotment the live lane uses took effect 2022-09-28; earlier
  // applications went to the justices of the allotment then in force, so no "expected" justice.
  const expected = submittedOn && submittedOn >= ALLOTMENT_EFFECTIVE ? expectedJusticeFor(parsed.lowerCourt) : null;
  const values: Record<(typeof HISTORY_APPLICATION_COLUMNS)[number], Cell> = {
    docket_number: docketNumber,
    caption: parsed.caption,
    applicant: parsed.applicant,
    kind: state.kind,
    capital: parsed.capital,
    applicant_kind: classifyApplicant(parsed.applicant, parsed.solicitorGeneral),
    administration: administrationOn(submittedOn),
    lower_court: parsed.lowerCourt,
    lower_case_numbers: JSON.stringify(parsed.lowerCaseNumbers),
    linked_docket: parsed.linkedDocket,
    expected_justice: expected?.justiceRef ?? null,
    submitted_justice: state.submittedJustice,
    submitted_justice_slug: justiceSlugForRef(state.submittedJustice),
    submitted_on: submittedOn,
    docketed_on: parsed.docketedOn,
    referred_on: state.referredOn,
    response_due_on: state.responseDueOn,
    response_due_text: state.responseDueText,
    response_requested_by: state.responseRequestedBy,
    admin_stay_on: state.adminStayOn,
    admin_stay_justice: state.adminStayJustice,
    status: state.status,
    ruling_on: state.rulingOn,
    ruled_by: state.ruledBy,
    written_reasons: state.writtenReasons,
    noted_votes: JSON.stringify(state.notedVotes),
    amicus_count: state.amicusCount,
    entry_count: parsed.lines.length,
    withheld_lines: parsed.withheldLines,
    last_entry_on: state.lastEntryOn,
    poll_tier: staleOpen(state, today) ? "retired" : pollTier(state, today),
    source_url: docketPageUrl(docketNumber),
    parser_version: EMERGENCY_PARSER_VERSION,
  };
  const application = HISTORY_APPLICATION_COLUMNS.map((column) => copyCell(values[column])).join("\t");
  const events = state.events.map((event, position) => [
    event.sourceRecordId, docketNumber, position + 1, event.filedOn, event.kind, event.description.slice(0, 6000),
    event.plain, textArrayLiteral(event.justices),
  ].map((value) => copyCell(value as Cell)).join("\t"));
  return { application, events, kind: state.kind, status: state.status };
}

/**
 * The psql script that loads applications.tsv and events.tsv in one
 * transaction. A row the live lane wrote (source_lane 'live') is never touched;
 * a history row is refreshed and its lines replaced. Applications link to the
 * Jurvio case with the same docket number when one exists (no case is created),
 * so a case hidden by a publication decision stays hidden. Anything still open
 * gets a poll row so the 10-minute lane keeps it current.
 */
export interface YearCoverage { term: number; complete: boolean; highest: number; pages: number }

/** Coverage upsert: complete stays true once a full scan finished; a partial rerun never clears it. */
export function coverageSql(coverage: readonly YearCoverage[]): string {
  const rows = coverage.filter((row) => Number.isInteger(row.term) && row.term >= 2000 && row.term <= 2099)
    .map((row) => `(${row.term}, ${row.complete ? "true" : "false"}, ${Math.max(0, Math.trunc(row.highest))}, ${Math.max(0, Math.trunc(row.pages))})`);
  if (!rows.length) return "";
  return `INSERT INTO scotus_emergency_history_coverage (term, complete, highest_number, pages, scanned_at, completed_at)
SELECT term, complete, highest_number, pages, now(), CASE WHEN complete THEN now() END
FROM (VALUES ${rows.join(", ")}) AS v(term, complete, highest_number, pages)
ON CONFLICT (term) DO UPDATE SET complete = scotus_emergency_history_coverage.complete OR EXCLUDED.complete,
  highest_number = greatest(scotus_emergency_history_coverage.highest_number, EXCLUDED.highest_number),
  pages = greatest(scotus_emergency_history_coverage.pages, EXCLUDED.pages), scanned_at = now(),
  completed_at = COALESCE(scotus_emergency_history_coverage.completed_at, EXCLUDED.completed_at);`;
}

/**
 * psql script for one docket year's rows, in its own transaction, so a large
 * backfill commits year by year and one slow year never rolls back the rest.
 * Jurvio case links are resolved once per load through the
 * (court_id, docket_number) index, not with a correlated subquery per row.
 */
function yearBlock(applicationsTsv: string, eventsTsv: string, coverage: readonly YearCoverage[], label: string): string[] {
  const appColumns = HISTORY_APPLICATION_COLUMNS.join(", ");
  const eventColumns = HISTORY_EVENT_COLUMNS.join(", ");
  const updates = HISTORY_APPLICATION_COLUMNS.filter((column) => column !== "docket_number")
    .map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  return [
    `\\echo 'loading ${label}'`,
    "BEGIN;",
    "SET LOCAL statement_timeout = '600s';",
    "SET LOCAL lock_timeout = '10s';",
    "CREATE TEMP TABLE in_app ON COMMIT DROP AS SELECT " + appColumns + " FROM scotus_application WITH NO DATA;",
    `COPY in_app (${appColumns}) FROM STDIN;`,
    copyData(applicationsTsv),
    "CREATE TEMP TABLE in_event ON COMMIT DROP AS SELECT " + eventColumns + " FROM scotus_application_event WITH NO DATA;",
    `COPY in_event (${eventColumns}) FROM STDIN;`,
    copyData(eventsTsv),
    "ANALYZE in_app;",
    "ANALYZE in_event;",
    // Join against the session's scotus_a_case (built once, below); a per-row
    // probe of legal_case has no usable index for SCOTUS rows in production.
    "CREATE TEMP TABLE case_link ON COMMIT DROP AS SELECT i.docket_number, s.case_id FROM (SELECT DISTINCT docket_number FROM in_app) i JOIN scotus_a_case s USING (docket_number);",
    "CREATE TEMP TABLE loaded (docket_number text PRIMARY KEY) ON COMMIT DROP;",
    `WITH upserted AS (
  INSERT INTO scotus_application (${appColumns}, case_id, source_lane, changed_at, updated_at)
  SELECT DISTINCT ON (i.docket_number) ${HISTORY_APPLICATION_COLUMNS.map((column) => `i.${column}`).join(", ")},
    cl.case_id, 'history', now(), now()
  FROM in_app i LEFT JOIN case_link cl USING (docket_number) ORDER BY i.docket_number
  ON CONFLICT (docket_number) DO UPDATE SET ${updates}, case_id = COALESCE(EXCLUDED.case_id, scotus_application.case_id),
    changed_at = now(), updated_at = now()
  WHERE scotus_application.source_lane = 'history'
  RETURNING docket_number)
INSERT INTO loaded SELECT docket_number FROM upserted;`,
    "ANALYZE loaded;",
    "DELETE FROM scotus_application_event e USING loaded l WHERE e.docket_number = l.docket_number;",
    `INSERT INTO scotus_application_event (${eventColumns}, backfilled)
SELECT ${HISTORY_EVENT_COLUMNS.map((column) => `e.${column}`).join(", ")}, true FROM in_event e JOIN loaded l USING (docket_number)
ON CONFLICT (source_record_id) DO NOTHING;`,
    `INSERT INTO scotus_source_poll (url, docket_number, last_status, checked_at, next_check_at, updated_at)
SELECT a.source_url, a.docket_number, 200, now(), now(), now() FROM scotus_application a JOIN loaded l USING (docket_number)
WHERE a.poll_tier <> 'retired'
ON CONFLICT (url) DO NOTHING;`,
    coverageSql(coverage),
    `SELECT 'loaded ${label}', count(*) FROM loaded;`,
    "COMMIT;",
  ];
}

/** COPY body: the rows then the end marker; no blank line when there are no rows. */
const copyData = (tsv: string) => (tsv.trim() ? `${tsv.replace(/\n+$/, "")}\n\\.` : "\\.");

const yearOf = (line: string) => line.slice(0, line.indexOf("A")).replace(/[^0-9]/g, "");

/** The load script: one transaction per docket year (rows and that year's coverage flag together). */
/**
 * SCOTUS legal_case rows with an emergency-style docket ("24A123"), resolved once
 * per load with a single scan. legal_case's SCOTUS indexes lead with citation, so a
 * per-application lookup scanned the table for every row and hit statement_timeout.
 */
function caseLinkPrelude(): string[] {
  return [
    "\\echo 'resolving case links'",
    "SET statement_timeout = '900s';",
    `CREATE TEMP TABLE scotus_a_case AS
SELECT DISTINCT ON (lc.docket_number) lc.docket_number, lc.id AS case_id
FROM legal_case lc
WHERE lc.court_id IN (SELECT id FROM court WHERE lower(provider_court_id) = 'scotus') AND lc.docket_number LIKE '__A%'
ORDER BY lc.docket_number, lc.id;`,
    "ANALYZE scotus_a_case;",
    "RESET statement_timeout;",
  ];
}

export function historyLoadSql(applicationsTsv: string, eventsTsv: string, coverage: readonly YearCoverage[] = []): string {
  const apps = new Map<string, string[]>();
  const events = new Map<string, string[]>();
  for (const line of applicationsTsv.split("\n")) if (line) apps.set(yearOf(line), [...(apps.get(yearOf(line)) ?? []), line]);
  for (const line of eventsTsv.split("\n")) if (line) events.set(yearOf(line), [...(events.get(yearOf(line)) ?? []), line]);
  const years = new Set<string>([...apps.keys(), ...coverage.map((row) => String(row.term % 100).padStart(2, "0"))]);
  const blocks = [...years].sort().flatMap((yy) => yearBlock((apps.get(yy) ?? []).join("\n"), (events.get(yy) ?? []).join("\n"),
    coverage.filter((row) => String(row.term % 100).padStart(2, "0") === yy), `${yy}A`));
  return [
    "\\set ON_ERROR_STOP on",
    "\\timing on",
    ...caseLinkPrelude(),
    ...(blocks.length ? blocks : yearBlock("", "", [], "nothing")),
    "SELECT substring(docket_number FROM 1 FOR 2) AS docket_year, source_lane, count(*) AS applications, count(*) FILTER (WHERE kind <> 'extension') AS serious FROM scotus_application GROUP BY 1, 2 ORDER BY 1, 2;",
    "",
  ].join("\n");
}
