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
export function historyLoadSql(applicationsTsv: string, eventsTsv: string): string {
  const appColumns = HISTORY_APPLICATION_COLUMNS.join(", ");
  const eventColumns = HISTORY_EVENT_COLUMNS.join(", ");
  const updates = HISTORY_APPLICATION_COLUMNS.filter((column) => column !== "docket_number")
    .map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SET LOCAL statement_timeout = '900s';",
    "SET LOCAL lock_timeout = '10s';",
    "CREATE TEMP TABLE in_app ON COMMIT DROP AS SELECT " + HISTORY_APPLICATION_COLUMNS.map((column) => column).join(", ") + " FROM scotus_application WITH NO DATA;",
    `COPY in_app (${appColumns}) FROM STDIN;`,
    applicationsTsv.replace(/\n?$/, "\n") + "\\.",
    "CREATE TEMP TABLE in_event ON COMMIT DROP AS SELECT " + eventColumns + " FROM scotus_application_event WITH NO DATA;",
    `COPY in_event (${eventColumns}) FROM STDIN;`,
    eventsTsv.replace(/\n?$/, "\n") + "\\.",
    "CREATE TEMP TABLE loaded (docket_number text PRIMARY KEY) ON COMMIT DROP;",
    `WITH upserted AS (
  INSERT INTO scotus_application (${appColumns}, case_id, source_lane, changed_at, updated_at)
  SELECT DISTINCT ON (i.docket_number) ${HISTORY_APPLICATION_COLUMNS.map((column) => `i.${column}`).join(", ")},
    (SELECT lc.id FROM legal_case lc JOIN court c ON c.id = lc.court_id
      WHERE lower(c.provider_court_id) = 'scotus' AND lc.docket_number = i.docket_number LIMIT 1),
    'history', now(), now()
  FROM in_app i ORDER BY i.docket_number
  ON CONFLICT (docket_number) DO UPDATE SET ${updates}, case_id = COALESCE(EXCLUDED.case_id, scotus_application.case_id),
    changed_at = now(), updated_at = now()
  WHERE scotus_application.source_lane = 'history'
  RETURNING docket_number)
INSERT INTO loaded SELECT docket_number FROM upserted;`,
    "DELETE FROM scotus_application_event e USING loaded l WHERE e.docket_number = l.docket_number;",
    `INSERT INTO scotus_application_event (${eventColumns}, backfilled)
SELECT ${HISTORY_EVENT_COLUMNS.map((column) => `e.${column}`).join(", ")}, true FROM in_event e JOIN loaded l USING (docket_number)
ON CONFLICT (source_record_id) DO NOTHING;`,
    `INSERT INTO scotus_source_poll (url, docket_number, last_status, checked_at, next_check_at, updated_at)
SELECT a.source_url, a.docket_number, 200, now(), now(), now() FROM scotus_application a JOIN loaded l USING (docket_number)
WHERE a.poll_tier <> 'retired'
ON CONFLICT (url) DO NOTHING;`,
    "SELECT 'loaded', count(*) FROM loaded;",
    "COMMIT;",
    "SELECT substring(docket_number FROM 1 FOR 2) AS docket_year, source_lane, count(*) AS applications, count(*) FILTER (WHERE kind <> 'extension') AS serious FROM scotus_application GROUP BY 1, 2 ORDER BY 1, 2;",
    "",
  ].join("\n");
}
