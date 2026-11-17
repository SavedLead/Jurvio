/**
 * Read side of the Supreme Court emergency docket: the public list, one
 * application with its timeline, Pro analytics, the CSV export and the
 * response-deadline calendar. Reads only scotus_application(_event), which
 * hold docket lines that already passed the strict sealed/restricted filter.
 * An application whose Jurvio case was explicitly hidden by a publication
 * decision is never shown.
 */
import type postgres from "postgres";
import { redactPublicText } from "@/modules/privacy/application/active-redactions";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { casePagePath, opinionPagePath } from "@/modules/scotus/domain/recent-opinions";
import { alertEligibleSql } from "@/modules/accounts/application/follows";
import { circuitOfCourtName } from "@/modules/scotus/domain/circuit-justice";
import {
  easternDate, responseStatusFrom,
  type ApplicantKind, type ApplicationEventKind, type ApplicationKind, type ApplicationStatus, type NotedVote,
} from "@/modules/scotus/domain/emergency-application";

type Sql = ReturnType<typeof postgres>;

function missingRelation(error: unknown) {
  const code = (error as { code?: string }).code;
  return code === "42P01" || code === "42703";
}

/** A pending status cannot be trusted when the filter withheld lines: the ruling itself may be one of them. */
export function statusUncertain(row: { status: ApplicationStatus; withheldLines: number }): boolean {
  return row.status === "pending" && row.withheldLines > 0;
}

/**
 * The docket lines that decide the response deadline (requests, responses,
 * extensions), oldest first, so readers derive it from the timeline rather
 * than trusting the stored column, which only changes when the page does.
 */
function responseLinesSql(alias = "a"): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  return `(SELECT coalesce(jsonb_agg(jsonb_build_object('filedOn', e.filed_on::text, 'kind', e.kind, 'description', e.description) ORDER BY e.position), '[]'::jsonb)
    FROM scotus_application_event e WHERE e.docket_number = ${alias}.docket_number
      AND (e.kind IN ('response_requested', 'response_filed') OR e.description ~* '\\m(?:respon|extend|opposition|memorandum)'))`;
}

type ResponseLine = { filedOn: string | null; kind: string | null; description: string };

/** Replace the stored deadline with the one the timeline gives, and add when the response was filed. */
export function withResponseStatus<T extends { responseDueOn: string | null; responseDueText: string | null; responseRequestedBy?: string | null }>(
  row: T & { responseLines?: unknown },
): Omit<T, "responseLines"> & { responseFiledOn: string | null } {
  const { responseLines, ...rest } = row;
  const lines = (Array.isArray(responseLines) ? responseLines : []).filter((line): line is ResponseLine =>
    Boolean(line) && typeof (line as ResponseLine).description === "string");
  if (!lines.some((line) => line.kind === "response_requested")) return { ...rest, responseFiledOn: null };
  const status = responseStatusFrom(lines);
  return {
    ...rest,
    responseDueOn: status.dueOn,
    responseDueText: status.dueText,
    ...("responseRequestedBy" in rest ? { responseRequestedBy: status.requestedBy ?? rest.responseRequestedBy ?? null } : {}),
    responseFiledOn: status.filedOn,
  };
}

/** Not explicitly hidden: no decision (draft) counts as visible here; a "not displayable" decision hides it. */
export function visibleSql(alias = "a"): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  return `(${alias}.case_id IS NULL OR ${latestPublicationColumnSql("displayable", "legal_case", `${alias}.case_id`, true)})`;
}

export interface EmergencyListRow {
  docketNumber: string;
  caption: string;
  kind: ApplicationKind;
  capital: boolean;
  applicantKind: ApplicantKind;
  status: ApplicationStatus;
  submittedJustice: string | null;
  expectedJustice: string | null;
  submittedOn: string | null;
  docketedOn: string | null;
  referredOn: string | null;
  responseDueOn: string | null;
  responseDueText: string | null;
  /** A response filed on or after the latest request: the deadline was met. */
  responseFiledOn: string | null;
  adminStayOn: string | null;
  rulingOn: string | null;
  lastEntryOn: string | null;
  lowerCourt: string | null;
  notedVotes: number;
  amicusCount: number;
  /** Docket lines withheld by the sealed/restricted filter. With any, a "pending" status may be stale. */
  withheldLines: number;
  lastEvent: { kind: ApplicationEventKind; filedOn: string | null } | null;
  /** Presidential term of the filing date. Set only for a federal-government applicant name. Approximate. */
  administration: string | null;
  /** Published, displayable Jurvio case. Absent when linking would 404. */
  casePublicId: string | null;
  /** Published opinion page for this docket, when that page can open. */
  documentPublicId: string | null;
  /** Official supremecourt.gov PDF, including when Jurvio has not extracted the text. */
  pdfUrl: string | null;
}

export type ListStatus = "open" | "decided" | "all";

export interface ListFilters {
  status: ListStatus;
  extensions: boolean;
  applicant: ApplicantKind | null;
  kind: ApplicationKind | null;
  limit?: number;
}

export interface EmergencyList {
  rows: EmergencyListRow[];
  counts: { openSerious: number; decided30: number; extensionsHidden: number; total: number };
  freshness: { lastCheckedAt: string | null; lastChangeAt: string | null };
}

export async function listEmergencyApplications(sql: Sql, filters: ListFilters): Promise<EmergencyList | null> {
  try {
    const listed = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      const status = filters.status;
      const raw = await tx<Array<Omit<EmergencyListRow, "responseFiledOn"> & { responseLines: unknown }>>`
        SELECT a.docket_number AS "docketNumber", a.caption, a.kind, a.capital, a.applicant_kind AS "applicantKind", a.status,
          a.submitted_justice AS "submittedJustice", a.expected_justice AS "expectedJustice",
          a.submitted_on::text AS "submittedOn", a.docketed_on::text AS "docketedOn", a.referred_on::text AS "referredOn",
          a.response_due_on::text AS "responseDueOn", a.response_due_text AS "responseDueText", a.admin_stay_on::text AS "adminStayOn",
          a.ruling_on::text AS "rulingOn", a.last_entry_on::text AS "lastEntryOn", a.lower_court AS "lowerCourt", a.administration,
          jsonb_array_length(a.noted_votes)::int AS "notedVotes", a.amicus_count AS "amicusCount", a.withheld_lines AS "withheldLines",
          CASE WHEN linked_vis.displayable THEN linked.public_id ELSE NULL END AS "casePublicId",
          NULL::text AS "documentPublicId", NULL::text AS "pdfUrl",
          (SELECT jsonb_build_object('kind', e.kind, 'filedOn', e.filed_on::text) FROM scotus_application_event e
            WHERE e.docket_number = a.docket_number ORDER BY e.position DESC LIMIT 1) AS "lastEvent",
          ${tx.unsafe(responseLinesSql("a"))} AS "responseLines"
        FROM scotus_application a
        LEFT JOIN legal_case linked ON linked.id = a.case_id AND linked.publication = 'published'
        LEFT JOIN publication_current linked_vis
          ON linked_vis.object_type = 'legal_case' AND linked_vis.object_id = linked.id AND linked_vis.displayable
        WHERE ${tx.unsafe(visibleSql("a"))}
          AND a.source_lane = 'live'
          AND (${filters.extensions} OR a.kind <> 'extension')
          AND (${status} = 'all' OR (${status} = 'open' AND a.status = 'pending') OR (${status} = 'decided' AND a.status <> 'pending'))
          AND (${filters.applicant}::text IS NULL OR a.applicant_kind = ${filters.applicant})
          AND (${filters.kind}::text IS NULL OR a.kind = ${filters.kind})
        -- The public list and its header counts show current applications only. History rows
        -- (earlier docket years, source_lane 'history') feed the analytics counts and their own
        -- application pages, never this list: an old docket that shows no ruling is not a
        -- pending application. The live lane adopts any history row it re-reads ('live').
        ORDER BY (a.status = 'pending') DESC, coalesce(a.last_entry_on, a.submitted_on) DESC NULLS LAST, a.docket_number DESC
        LIMIT ${Math.min(filters.limit ?? 150, 500)}`;
      const rows: EmergencyListRow[] = [];
      for (const row of raw.map((item) => withResponseStatus(item))) {
        const caption = await redactPublicText(tx as never, row.caption);
        rows.push({
          ...row,
          caption: caption.text ?? row.caption,
          administration: row.applicantKind === "federal" ? row.administration : null,
        });
      }
      const [counts] = await tx<EmergencyList["counts"][]>`
        SELECT count(*) FILTER (WHERE kind <> 'extension' AND status = 'pending')::int AS "openSerious",
          count(*) FILTER (WHERE kind <> 'extension' AND status <> 'pending' AND ruling_on >= current_date - 30)::int AS "decided30",
          count(*) FILTER (WHERE kind = 'extension')::int AS "extensionsHidden",
          count(*)::int AS total
        FROM scotus_application a WHERE ${tx.unsafe(visibleSql("a"))} AND a.source_lane = 'live'`;
      const [fresh] = await tx<{ lastCheckedAt: string | null; lastChangeAt: string | null }[]>`
        SELECT to_json(max(checked_at))#>>'{}' AS "lastCheckedAt", to_json(max(changed_at))#>>'{}' AS "lastChangeAt"
        FROM scotus_source_poll WHERE docket_number IS NOT NULL`;
      return { rows, counts: counts ?? { openSerious: 0, decided30: 0, extensionsHidden: 0, total: 0 },
        freshness: fresh ?? { lastCheckedAt: null, lastChangeAt: null } };
    });
    return listed ? await attachPublicRecordLinks(sql, listed) : null;
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return null;
    throw error;
  }
}

const CASE_ID = /^jv-[a-z0-9]{8,10}$/;
const OFFICIAL_PDF = /^https:\/\/www\.supremecourt\.gov\/.+\.pdf(?:[?#].*)?$/i;

/**
 * Fill case, opinion, and official-PDF links without failing the list.
 * A case link requires a displayable published case. An opinion link requires
 * a displayable document. The PDF is the Court's file either way.
 */
async function attachPublicRecordLinks(sql: Sql, list: EmergencyList): Promise<EmergencyList> {
  const dockets = list.rows.map((row) => row.docketNumber.toLowerCase());
  if (!dockets.length) return list;
  try {
    const linked = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '1500ms'`;
      const cases = await tx<{ docketNumber: string; casePublicId: string }[]>`
        SELECT DISTINCT ON (lower(lc.docket_number)) lc.docket_number AS "docketNumber", lc.public_id AS "casePublicId"
        FROM legal_case lc
        JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
        JOIN publication_current vis ON vis.object_type = 'legal_case' AND vis.object_id = lc.id AND vis.displayable
        WHERE lc.publication = 'published' AND lower(lc.docket_number) IN ${tx(dockets)}
        ORDER BY lower(lc.docket_number), lc.updated_at DESC`;
      const opinions = await tx<{ docketNumber: string; pdfUrl: string; casePublicId: string | null; documentPublicId: string | null }[]>`
        SELECT DISTINCT ON (lower(s.docket_number)) s.docket_number AS "docketNumber", s.source_url AS "pdfUrl",
          matched.case_public_id AS "casePublicId", matched.document_public_id AS "documentPublicId"
        FROM scotus_slip_index s
        LEFT JOIN LATERAL (
          SELECT lc.public_id AS case_public_id, doc.public_id AS document_public_id
          FROM legal_case lc
          JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
          JOIN publication_current vis ON vis.object_type = 'legal_case' AND vis.object_id = lc.id AND vis.displayable
          LEFT JOIN LATERAL (
            SELECT d.public_id
            FROM document d
            JOIN judicial_opinion j ON j.document_id = d.id
            JOIN publication_current dv ON dv.object_type = 'document' AND dv.object_id = d.id AND dv.displayable
            WHERE d.case_id = lc.id AND d.publication = 'published'
              AND split_part(j.source_download_url, '#', 1) = split_part(s.source_url, '#', 1)
            LIMIT 1
          ) doc ON true
          WHERE lower(lc.docket_number) = lower(s.docket_number) AND lc.publication = 'published'
          ORDER BY lc.updated_at DESC
          LIMIT 1
        ) matched ON true
        WHERE lower(s.docket_number) IN ${tx(dockets)}
        ORDER BY lower(s.docket_number), s.filed_on DESC`;
      return { cases, opinions };
    });
    const caseByDocket = new Map(linked.cases.filter((row) => CASE_ID.test(row.casePublicId)).map((row) => [row.docketNumber.toLowerCase(), row.casePublicId]));
    const opinionByDocket = new Map(linked.opinions.map((row) => [row.docketNumber.toLowerCase(), row]));
    return {
      ...list,
      rows: list.rows.map((row) => {
        const key = row.docketNumber.toLowerCase();
        const opinion = opinionByDocket.get(key);
        const casePublicId = row.casePublicId && CASE_ID.test(row.casePublicId) ? row.casePublicId : caseByDocket.get(key) ?? opinion?.casePublicId ?? null;
        const documentPublicId = opinion?.documentPublicId ?? null;
        const pdfUrl = opinion?.pdfUrl && OFFICIAL_PDF.test(opinion.pdfUrl) ? opinion.pdfUrl : null;
        return {
          ...row,
          casePublicId: casePublicId && casePagePath(casePublicId) ? casePublicId : null,
          documentPublicId: opinionPagePath(casePublicId, documentPublicId) ? documentPublicId : null,
          pdfUrl,
        };
      }),
    };
  } catch {
    return {
      ...list,
      rows: list.rows.map((row) => ({
        ...row,
        casePublicId: row.casePublicId && casePagePath(row.casePublicId) ? row.casePublicId : null,
        documentPublicId: null,
        pdfUrl: null,
      })),
    };
  }
}

export interface EmergencyEventRow {
  sourceRecordId: string;
  filedOn: string | null;
  kind: ApplicationEventKind;
  description: string;
  plain: string;
  justices: string[];
  detectedAt: string;
  backfilled: boolean;
}

export interface EmergencyDetail extends EmergencyListRow {
  applicant: string | null;
  administration: string | null;
  lowerCaseNumbers: string[];
  linkedDocket: string | null;
  responseRequestedBy: string | null;
  adminStayJustice: string | null;
  ruledBy: "court" | "justice" | null;
  writtenReasons: boolean;
  votes: NotedVote[];
  sourceUrl: string;
  firstSeenAt: string;
  checkedAt: string | null;
  events: EmergencyEventRow[];
  jurvioCase: { publicId: string; followable: boolean } | null;
  linkedLowerCase: { publicId: string; caption: string; docketNumber: string | null } | null;
  linkedMerits: { publicId: string; docketNumber: string } | null;
}

export async function getEmergencyApplication(sql: Sql, docketNumber: string): Promise<EmergencyDetail | null> {
  if (!/^\d{2}A\d{1,4}$/.test(docketNumber)) return null;
  try {
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      const [row] = await tx<Array<Omit<EmergencyDetail, "events" | "jurvioCase" | "linkedLowerCase" | "linkedMerits" | "lastEvent" | "responseFiledOn"> & {
        caseId: string | null; casePublicId: string | null; followable: boolean | null; lowerCaseNumbers: unknown; votes: unknown }>>`
        SELECT a.docket_number AS "docketNumber", a.caption, a.applicant, a.kind, a.capital, a.applicant_kind AS "applicantKind",
          a.administration, a.status, a.submitted_justice AS "submittedJustice", a.expected_justice AS "expectedJustice",
          a.submitted_on::text AS "submittedOn", a.docketed_on::text AS "docketedOn", a.referred_on::text AS "referredOn",
          a.response_due_on::text AS "responseDueOn", a.response_due_text AS "responseDueText", a.response_requested_by AS "responseRequestedBy",
          a.admin_stay_on::text AS "adminStayOn", a.admin_stay_justice AS "adminStayJustice", a.ruling_on::text AS "rulingOn",
          a.ruled_by AS "ruledBy", a.written_reasons AS "writtenReasons", a.noted_votes AS votes,
          jsonb_array_length(a.noted_votes)::int AS "notedVotes", a.amicus_count AS "amicusCount",
          a.last_entry_on::text AS "lastEntryOn", a.lower_court AS "lowerCourt", a.lower_case_numbers AS "lowerCaseNumbers",
          a.linked_docket AS "linkedDocket", a.withheld_lines AS "withheldLines", a.source_url AS "sourceUrl",
          to_json(a.first_seen_at)#>>'{}' AS "firstSeenAt", to_json(p.checked_at)#>>'{}' AS "checkedAt",
          a.case_id AS "caseId", c.public_id AS "casePublicId",
          NULL::text AS "documentPublicId", NULL::text AS "pdfUrl",
          CASE WHEN c.id IS NULL THEN false ELSE ${tx.unsafe(alertEligibleSql("c"))} END AS followable
        FROM scotus_application a
        LEFT JOIN legal_case c ON c.id = a.case_id
        LEFT JOIN scotus_source_poll p ON p.url = a.source_url
        WHERE a.docket_number = ${docketNumber} AND ${tx.unsafe(visibleSql("a"))}`;
      if (!row) return null;
      const events = await tx<EmergencyEventRow[]>`
        SELECT source_record_id AS "sourceRecordId", filed_on::text AS "filedOn", kind, description, plain_line AS plain, justices,
          detected_at::text AS "detectedAt", backfilled
        FROM scotus_application_event WHERE docket_number = ${docketNumber} ORDER BY position, filed_on`;
      const lowerCaseNumbers = (Array.isArray(row.lowerCaseNumbers) ? row.lowerCaseNumbers : [])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 4);
      let linkedLowerCase: EmergencyDetail["linkedLowerCase"] = null;
      const circuit = circuitOfCourtName(row.lowerCourt);
      if (circuit && lowerCaseNumbers.length) {
        const matches = await tx<Array<{ publicId: string; caption: string; docketNumber: string | null }>>`
          SELECT lc.public_id AS "publicId", lc.caption, lc.docket_number AS "docketNumber"
          FROM court JOIN legal_case lc ON lc.court_id = court.id AND lc.docket_number IN ${tx(lowerCaseNumbers)}
          WHERE lower(court.provider_court_id) = ${circuit} AND lc.publication = 'published'
            AND ${tx.unsafe(latestPublicationColumnSql("displayable", "legal_case", "lc.id"))}
          LIMIT 2`;
        if (matches.length === 1) linkedLowerCase = matches[0]!;
      }
      let linkedMerits: EmergencyDetail["linkedMerits"] = null;
      if (row.linkedDocket && /^\d{2}-\d+$/.test(row.linkedDocket)) {
        const [merits] = await tx<{ publicId: string; docketNumber: string }[]>`
          SELECT lc.public_id AS "publicId", lc.docket_number AS "docketNumber"
          FROM legal_case lc JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
          WHERE lc.docket_number = ${row.linkedDocket} AND lc.publication = 'published'
            AND ${tx.unsafe(latestPublicationColumnSql("displayable", "legal_case", "lc.id"))}
          LIMIT 1`;
        linkedMerits = merits ?? null;
      }
      const { caseId: _caseId, casePublicId, followable, votes, ...stored } = row;
      let recordCase = casePublicId && casePagePath(casePublicId) ? casePublicId : null;
      let documentPublicId: string | null = null;
      let pdfUrl: string | null = null;
      try {
        const [found] = await tx<{ casePublicId: string | null; documentPublicId: string | null; pdfUrl: string | null }[]>`
          SELECT matched.case_public_id AS "casePublicId", matched.document_public_id AS "documentPublicId", s.source_url AS "pdfUrl"
          FROM scotus_slip_index s
          LEFT JOIN LATERAL (
            SELECT lc.public_id AS case_public_id, doc.public_id AS document_public_id
            FROM legal_case lc
            JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
            JOIN publication_current vis ON vis.object_type = 'legal_case' AND vis.object_id = lc.id AND vis.displayable
            LEFT JOIN LATERAL (
              SELECT d.public_id
              FROM document d
              JOIN judicial_opinion j ON j.document_id = d.id
              JOIN publication_current dv ON dv.object_type = 'document' AND dv.object_id = d.id AND dv.displayable
              WHERE d.case_id = lc.id AND d.publication = 'published'
                AND split_part(j.source_download_url, '#', 1) = split_part(s.source_url, '#', 1)
              LIMIT 1
            ) doc ON true
            WHERE lower(lc.docket_number) = lower(${docketNumber}) AND lc.publication = 'published'
            ORDER BY lc.updated_at DESC
            LIMIT 1
          ) matched ON true
          WHERE lower(s.docket_number) = lower(${docketNumber})
          ORDER BY s.filed_on DESC
          LIMIT 1`;
        const [caseOnly] = found?.casePublicId ? [] : await tx<{ casePublicId: string }[]>`
          SELECT lc.public_id AS "casePublicId"
          FROM legal_case lc
          JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
          JOIN publication_current vis ON vis.object_type = 'legal_case' AND vis.object_id = lc.id AND vis.displayable
          WHERE lc.publication = 'published' AND lower(lc.docket_number) = lower(${docketNumber})
          ORDER BY lc.updated_at DESC
          LIMIT 1`;
        const resolvedCase = found?.casePublicId ?? caseOnly?.casePublicId ?? recordCase;
        recordCase = resolvedCase && casePagePath(resolvedCase) ? resolvedCase : null;
        documentPublicId = opinionPagePath(recordCase, found?.documentPublicId) ? found?.documentPublicId ?? null : null;
        pdfUrl = found?.pdfUrl && OFFICIAL_PDF.test(found.pdfUrl) ? found.pdfUrl : null;
      } catch {
        documentPublicId = null;
        pdfUrl = null;
        recordCase = null;
        try {
          const [caseOnly] = await tx<{ casePublicId: string }[]>`
            SELECT lc.public_id AS "casePublicId"
            FROM legal_case lc
            JOIN court ON court.id = lc.court_id AND lower(court.provider_court_id) = 'scotus'
            JOIN publication_current vis ON vis.object_type = 'legal_case' AND vis.object_id = lc.id AND vis.displayable
            WHERE lc.publication = 'published' AND lower(lc.docket_number) = lower(${docketNumber})
            ORDER BY lc.updated_at DESC
            LIMIT 1`;
          recordCase = caseOnly && casePagePath(caseOnly.casePublicId) ? caseOnly.casePublicId : null;
        } catch {
          recordCase = null;
        }
      }
      // The full timeline is already loaded: derive the deadline from it.
      const rest = withResponseStatus({ ...stored, responseLines: events.map((event) => ({ filedOn: event.filedOn, kind: event.kind, description: event.description })) });
      void _caseId;
      const caption = await redactPublicText(tx as never, rest.caption);
      const applicant = await redactPublicText(tx as never, rest.applicant);
      const eventsRedacted = [];
      for (const event of events) {
        const description = await redactPublicText(tx as never, event.description);
        const plain = await redactPublicText(tx as never, event.plain);
        eventsRedacted.push({ ...event, description: description.text ?? event.description, plain: plain.text ?? event.plain });
      }
      const lowerCaption = linkedLowerCase ? await redactPublicText(tx as never, linkedLowerCase.caption) : null;
      return {
        ...rest,
        caption: caption.text ?? rest.caption,
        applicant: applicant.text ?? rest.applicant,
        lowerCaseNumbers,
        votes: Array.isArray(votes) ? votes as NotedVote[] : [],
        lastEvent: events.length ? { kind: events.at(-1)!.kind, filedOn: events.at(-1)!.filedOn } : null,
        events: eventsRedacted,
        casePublicId: recordCase,
        documentPublicId,
        pdfUrl,
        jurvioCase: recordCase ? { publicId: recordCase, followable: Boolean(followable) && recordCase === casePublicId } : null,
        linkedLowerCase: linkedLowerCase && lowerCaption ? { ...linkedLowerCase, caption: lowerCaption.text ?? linkedLowerCase.caption } : linkedLowerCase,
        linkedMerits,
      };
    });
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return null;
    throw error;
  }
}

export interface EmergencyAnalytics {
  byApplicant: Array<{ applicantKind: ApplicantKind; decided: number; granted: number; medianDays: number | null }>;
  byJustice: Array<{ justice: string; applications: number; referred: number; granted: number }>;
  dissents: Array<{ justice: string; notes: number }>;
  speed: { lines: number; medianMinutesAfterDocketDay: number | null };
  administrations: Array<{ administration: string; decided: number; granted: number }>;
}

/** Pro analytics over serious applications Jurvio holds. Counts of noted dissents are minimums (the Court rarely publishes every vote). */
export async function loadEmergencyAnalytics(sql: Sql): Promise<EmergencyAnalytics | null> {
  try {
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '4000ms'`;
      const byApplicant = await tx<EmergencyAnalytics["byApplicant"]>`
        SELECT applicant_kind AS "applicantKind",
          count(*) FILTER (WHERE status IN ('granted', 'granted_in_part', 'denied'))::int AS decided,
          count(*) FILTER (WHERE status IN ('granted', 'granted_in_part'))::int AS granted,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY ruling_on - submitted_on) FILTER (WHERE ruling_on >= submitted_on) AS "medianDays"
        FROM scotus_application a WHERE kind <> 'extension' AND ${tx.unsafe(visibleSql("a"))}
        GROUP BY applicant_kind ORDER BY applicant_kind`;
      const byJustice = await tx<EmergencyAnalytics["byJustice"]>`
        SELECT submitted_justice AS justice, count(*)::int AS applications,
          count(*) FILTER (WHERE referred_on IS NOT NULL OR ruled_by = 'court')::int AS referred,
          count(*) FILTER (WHERE status IN ('granted', 'granted_in_part'))::int AS granted
        FROM scotus_application a WHERE kind <> 'extension' AND submitted_justice IS NOT NULL AND ${tx.unsafe(visibleSql("a"))}
        GROUP BY submitted_justice ORDER BY count(*) DESC LIMIT 12`;
      const dissents = await tx<EmergencyAnalytics["dissents"]>`
        SELECT vote->>'justiceRef' AS justice, count(*)::int AS notes
        FROM scotus_application a, jsonb_array_elements(a.noted_votes) vote
        WHERE a.kind <> 'extension' AND vote->>'position' IN ('dissent', 'would_grant', 'would_deny') AND ${tx.unsafe(visibleSql("a"))}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12`;
      const [speed] = await tx<EmergencyAnalytics["speed"][]>`
        SELECT count(*)::int AS lines,
          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM detected_at - (filed_on::timestamp AT TIME ZONE 'America/New_York')) / 60))::int AS "medianMinutesAfterDocketDay"
        FROM scotus_application_event WHERE NOT backfilled AND filed_on IS NOT NULL AND detected_at > now() - interval '90 days'`;
      const administrations = await tx<EmergencyAnalytics["administrations"]>`
        SELECT administration, count(*) FILTER (WHERE status IN ('granted', 'granted_in_part', 'denied'))::int AS decided,
          count(*) FILTER (WHERE status IN ('granted', 'granted_in_part'))::int AS granted
        FROM scotus_application a WHERE kind <> 'extension' AND applicant_kind = 'federal' AND administration IS NOT NULL AND ${tx.unsafe(visibleSql("a"))}
        GROUP BY administration ORDER BY administration`;
      return { byApplicant, byJustice, dissents, speed: speed ?? { lines: 0, medianMinutesAfterDocketDay: null }, administrations };
    });
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return null;
    throw error;
  }
}

/** Response deadlines still ahead (or today) and not yet met, for open serious applications, for the Pro calendar. */
export async function listResponseDeadlines(sql: Sql, options: { userId?: string; followedOnly?: boolean; today?: string } = {}) {
  const raw = await sql<Array<{ docketNumber: string; caption: string; responseDueOn: string | null; responseDueText: string | null; responseRequestedBy: string | null; responseLines: unknown }>>`
    SELECT a.docket_number AS "docketNumber", a.caption, a.response_due_on::text AS "responseDueOn",
      a.response_due_text AS "responseDueText", a.response_requested_by AS "responseRequestedBy",
      ${sql.unsafe(responseLinesSql("a"))} AS "responseLines"
    FROM scotus_application a
    WHERE a.status = 'pending' AND a.response_due_on IS NOT NULL AND a.response_due_on >= current_date - 120
      AND ${sql.unsafe(visibleSql("a"))}
      AND (${!options.followedOnly} OR EXISTS (SELECT 1 FROM case_follow f WHERE f.case_id = a.case_id AND f.user_id = ${options.userId ?? null}))
    LIMIT 600`;
  const today = options.today ?? easternDate(new Date());
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const pending = raw.map((row) => withResponseStatus(row))
    .filter((row): row is typeof row & { responseDueOn: string } => Boolean(row.responseDueOn) && !row.responseFiledOn && row.responseDueOn! >= yesterday)
    .sort((a, b) => a.responseDueOn.localeCompare(b.responseDueOn) || a.docketNumber.localeCompare(b.docketNumber))
    .slice(0, 300);
  const deadlines = [];
  for (const row of pending) {
    const caption = await redactPublicText(sql, row.caption);
    deadlines.push({ docketNumber: row.docketNumber, caption: caption.text ?? row.caption, responseDueOn: row.responseDueOn, responseDueText: row.responseDueText, requestedBy: row.responseRequestedBy });
  }
  return deadlines;
}
