import type postgres from "postgres";
import { justiceSlugs } from "@/modules/scotus/domain/justice-slug";
import {
  resolveJustice,
  type JusticeNoteContext,
  type JusticeNoteKind,
  type RosterJustice,
} from "@/modules/scotus/domain/docket-justice-notes";

type Sql = ReturnType<typeof postgres>;

/** Missing tables (before migration 0191 runs) read as "no notes yet", never as a 500. */
async function orEmpty<T>(query: PromiseLike<readonly T[]>): Promise<T[]> {
  try {
    return [...(await query)];
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}

export interface CaseJusticeNote {
  entryOn: string;
  context: JusticeNoteContext;
  kind: JusticeNoteKind;
  justiceRef: string;
  name: string;
  slug: string | null;
  sentence: string;
  entryText: string;
  opinionUrl: string | null;
  opinionOpening: string | null;
  opinionReason: string | null;
}

export interface CaseJusticeNotes {
  docketNumber: string;
  sourceUrl: string;
  certStatus: string | null;
  certStatusOn: string | null;
  fetchedAt: string;
  notes: CaseJusticeNote[];
  /** The justices sitting on the date of the latest order with a note (for the 9-justice chip row). */
  bench: Array<{ name: string; slug: string | null; surname: string }>;
}

let rosterCache: { at: number; roster: RosterJustice[] } | null = null;

/** Every SCDB justice with surname, service and Chief Justice dates; cached for ten minutes per process. */
export async function loadJusticeRoster(sql: Sql): Promise<RosterJustice[]> {
  if (rosterCache && Date.now() - rosterCache.at < 600_000) return rosterCache.roster;
  const rows = await orEmpty(sql<Array<{ scdbJusticeId: number; displayName: string; scdbName: string; serviceStart: string; serviceEnd: string | null; chiefFrom: string | null; chiefTo: string | null }>>`
    SELECT j.scdb_justice_id AS "scdbJusticeId", j.display_name AS "displayName", j.scdb_name AS "scdbName",
      j.scdb_service_start::text AS "serviceStart", j.scdb_service_end::text AS "serviceEnd",
      chief.from_on::text AS "chiefFrom", chief.to_on::text AS "chiefTo"
    FROM scotus_justice j
    LEFT JOIN LATERAL (
      SELECT coalesce(a.commission_date, a.confirmation_date) AS from_on, a.termination_date AS to_on
      FROM scotus_justice_appointment a
      WHERE a.scdb_justice_id = j.scdb_justice_id AND a.appointment_title ILIKE 'Chief Justice%'
      ORDER BY a.commission_date DESC NULLS LAST LIMIT 1
    ) chief ON true
  `);
  const slugs = justiceSlugs(rows.map((row) => ({ scdbJusticeId: row.scdbJusticeId, displayName: row.displayName, serviceStart: row.serviceStart })));
  const roster = rows.map((row) => ({
    scdbJusticeId: row.scdbJusticeId,
    displayName: row.displayName,
    surname: (row.scdbName.split(",")[0] ?? row.scdbName).trim(),
    slug: slugs.get(row.scdbJusticeId) ?? "",
    serviceStart: row.serviceStart,
    serviceEnd: row.serviceEnd,
    // A Chief Justice serves as Chief until their service ends.
    chiefFrom: row.chiefFrom,
    chiefTo: row.chiefFrom ? row.chiefTo ?? row.serviceEnd : null,
  }));
  rosterCache = { at: Date.now(), roster };
  return roster;
}

const KIND_ORDER: JusticeNoteKind[] = ["dissent", "joined_dissent", "would_grant", "would_deny", "statement", "joined_statement", "concurrence", "joined_concurrence", "recused"];

/** Justice notes from the official docket for one Supreme Court case, or null when there are none. */
export async function loadCaseJusticeNotes(sql: Sql, publicCaseId: string): Promise<CaseJusticeNotes | null> {
  const rows = await orEmpty(sql<Array<{
    docketNumber: string; sourceUrl: string; entryOn: string; context: JusticeNoteContext; kind: JusticeNoteKind;
    justiceRef: string; sentence: string; entryText: string; opinionUrl: string | null; opinionOpening: string | null;
    opinionReason: string | null; fetchedAt: string; certStatus: string | null; certStatusOn: string | null;
  }>>`
    SELECT n.docket_number AS "docketNumber", n.source_url AS "sourceUrl", n.entry_on::text AS "entryOn",
      n.entry_context AS context, n.note_kind AS kind, n.justice_ref AS "justiceRef", n.sentence,
      n.entry_text AS "entryText", n.opinion_url AS "opinionUrl", n.opinion_opening AS "opinionOpening",
      n.opinion_reason AS "opinionReason", n.fetched_at::text AS "fetchedAt",
      s.cert_status AS "certStatus", s.cert_status_on::text AS "certStatusOn"
    FROM scotus_docket_justice_note n
    JOIN legal_case c ON c.id = n.case_id
    LEFT JOIN scotus_docket_status s ON s.case_id = n.case_id
    WHERE c.public_id = ${publicCaseId}
    ORDER BY n.entry_on DESC
    LIMIT 80
  `);
  const first = rows[0];
  if (!first) return null;
  const roster = await loadJusticeRoster(sql);
  const notes = rows.map((row) => {
    const justice = resolveJustice(row.justiceRef, row.entryOn, roster);
    return {
      entryOn: row.entryOn, context: row.context, kind: row.kind, justiceRef: row.justiceRef,
      name: justice?.displayName ?? (row.justiceRef === "The Chief Justice" ? "The Chief Justice" : `Justice ${row.justiceRef}`),
      slug: justice?.slug || null,
      sentence: row.sentence, entryText: row.entryText, opinionUrl: row.opinionUrl,
      opinionOpening: row.opinionOpening, opinionReason: row.opinionReason,
    };
  }).sort((left, right) => right.entryOn.localeCompare(left.entryOn) || KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind));
  const benchOn = notes[0]?.entryOn ?? first.entryOn;
  const bench = roster
    .filter((justice) => justice.serviceStart <= benchOn && (!justice.serviceEnd || justice.serviceEnd >= benchOn))
    .sort((left, right) => (left.chiefFrom && left.chiefFrom <= benchOn ? -1 : 0) - (right.chiefFrom && right.chiefFrom <= benchOn ? -1 : 0) || left.serviceStart.localeCompare(right.serviceStart))
    .map((justice) => ({ name: justice.displayName, slug: justice.slug || null, surname: justice.surname }));
  return {
    docketNumber: first.docketNumber, sourceUrl: first.sourceUrl, certStatus: first.certStatus,
    certStatusOn: first.certStatusOn, fetchedAt: first.fetchedAt, notes, bench,
  };
}
