import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { decodeScdbText, parseCsv, readSingleFileZip, scdbDate, scdbInt, scdbText, type CsvRecord } from "../domain/scdb";
import { scdbMatchCtes } from "./scdb-matching";

/**
 * Imports the Supreme Court Database (SCDB), the FJC-backed justice roster and
 * Martin-Quinn scores into the tables from migration 0186, links SCDB cases to
 * Jurvio legal_case rows, and refreshes the precomputed analytics.
 * Every value comes from the published files; nothing is inferred.
 */

export const SCDB_CITATION =
  "Harold J. Spaeth, Lee Epstein, Michael J. Nelson, Andrew D. Martin, Jeffrey A. Segal, Theodore J. Ruger, and Sara C. Benesh. Supreme Court Database, Version {version}. URL: https://scdb.psu.edu";
export const SCDB_LICENSE_NOTE =
  "No license text published on scdb.la.psu.edu; the site asks users to cite the database with its specific version (https://scdb.la.psu.edu/how-to-cite-us/). NSF-funded academic dataset.";
export const MQ_CITATION =
  "Andrew D. Martin and Kevin M. Quinn. 2002. \"Dynamic Ideal Point Estimation via Markov Chain Monte Carlo for the U.S. Supreme Court, 1953-1999.\" Political Analysis 10:134-153.";
export const MQ_LICENSE_NOTE =
  "No license text published on mqscores.wustl.edu; the site asks users of the scores to cite Martin & Quinn (2002).";
export const FJC_CITATION = "Federal Judicial Center, Biographical Directory of Article III Federal Judges, 1789-present (https://www.fjc.gov/history/judges).";
export const FJC_LICENSE_NOTE = "U.S. government work (Federal Judicial Center); public domain.";

type Db = Sql<Record<string, unknown>>;

export interface DataFile { path: string; bytes: Buffer }

export interface RosterJustice {
  scdbJusticeId: number; scdbCode: string; scdbName: string; scdbServiceStart: string; scdbServiceEnd: string | null;
  fjcNid: string; fullName: string; birthDate: string | null; birthYear: number | null; birthPlace: string | null;
  deathDate: string | null; deathYear: number | null; deathPlace: string | null;
  appointments: {
    fjcSequence: number; appointmentTitle: string | null; appointingPresident: string | null;
    nominationDate: string | null; confirmationDate: string | null; commissionDate: string | null;
    recessAppointmentDate: string | null; senateVoteType: string | null; senateVote: string | null;
    terminationReason: string | null; terminationDate: string | null;
  }[];
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Accepts the SCDB/MQ file as published: a .zip with one CSV inside, or the CSV itself. */
export function readScdbCsv(file: DataFile): { rows: CsvRecord[]; innerName: string; encoding: string } {
  const inner = file.path.toLowerCase().endsWith(".zip") ? readSingleFileZip(file.bytes) : { name: file.path, data: file.bytes };
  const { text, encoding } = decodeScdbText(inner.data);
  return { rows: parseCsv(text), innerName: inner.name, encoding };
}

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function recordRelease(sql: Db, input: {
  sourceSystem: string; version: string; fileName: string; sourceUrl: string; bytes: Buffer;
  rowCount: number; citation: string; license: string;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO scotus_dataset_release (source_system, version, file_name, source_url, sha256, row_count, citation_text, license_note)
    VALUES (${input.sourceSystem}, ${input.version}, ${input.fileName}, ${input.sourceUrl}, ${sha256(input.bytes)},
            ${input.rowCount}, ${input.citation}, ${input.license})
    ON CONFLICT (source_system, version, file_name) DO UPDATE
      SET sha256 = EXCLUDED.sha256, row_count = EXCLUDED.row_count, source_url = EXCLUDED.source_url,
          citation_text = EXCLUDED.citation_text, license_note = EXCLUDED.license_note, imported_at = now()
    RETURNING id`;
  return row!.id;
}

export async function importJusticeRoster(sql: Db, roster: { justices: RosterJustice[] }, file: DataFile) {
  if (!roster.justices.length) throw new Error("justice roster is empty");
  await recordRelease(sql, {
    sourceSystem: "fjc", version: "justices.json", fileName: file.path,
    sourceUrl: "https://www.fjc.gov/sites/default/files/history/federal-judicial-service.csv",
    bytes: file.bytes, rowCount: roster.justices.length, citation: FJC_CITATION, license: FJC_LICENSE_NOTE,
  });
  const justices = roster.justices.map((j) => ({
    scdb_justice_id: j.scdbJusticeId, scdb_code: j.scdbCode, scdb_name: j.scdbName, display_name: j.fullName,
    fjc_nid: j.fjcNid, scdb_service_start: j.scdbServiceStart, scdb_service_end: j.scdbServiceEnd,
    birth_date: j.birthDate, birth_year: j.birthYear, birth_place: j.birthPlace,
    death_date: j.deathDate, death_year: j.deathYear, death_place: j.deathPlace,
    bio_source_url: `https://www.fjc.gov/node/${encodeURIComponent(j.fjcNid)}`,
  }));
  await sql`
    INSERT INTO scotus_justice ${sql(justices)}
    ON CONFLICT (scdb_justice_id) DO UPDATE SET
      scdb_code = EXCLUDED.scdb_code, scdb_name = EXCLUDED.scdb_name, display_name = EXCLUDED.display_name,
      fjc_nid = EXCLUDED.fjc_nid, scdb_service_start = EXCLUDED.scdb_service_start, scdb_service_end = EXCLUDED.scdb_service_end,
      birth_date = EXCLUDED.birth_date, birth_year = EXCLUDED.birth_year, birth_place = EXCLUDED.birth_place,
      death_date = EXCLUDED.death_date, death_year = EXCLUDED.death_year, death_place = EXCLUDED.death_place,
      bio_source_url = EXCLUDED.bio_source_url, updated_at = now()`;
  const appointments = roster.justices.flatMap((j) => j.appointments.map((a) => ({
    fjc_nid: j.fjcNid, fjc_sequence: a.fjcSequence, scdb_justice_id: j.scdbJusticeId,
    appointment_title: a.appointmentTitle, appointing_president: a.appointingPresident,
    nomination_date: a.nominationDate, confirmation_date: a.confirmationDate, commission_date: a.commissionDate,
    recess_appointment_date: a.recessAppointmentDate, senate_vote_type: a.senateVoteType, senate_vote: a.senateVote,
    termination_reason: a.terminationReason, termination_date: a.terminationDate,
    source_url: `https://www.fjc.gov/node/${encodeURIComponent(j.fjcNid)}`,
  })));
  await sql`
    INSERT INTO scotus_justice_appointment ${sql(appointments)}
    ON CONFLICT (fjc_nid, fjc_sequence) DO UPDATE SET
      scdb_justice_id = EXCLUDED.scdb_justice_id, appointment_title = EXCLUDED.appointment_title,
      appointing_president = EXCLUDED.appointing_president, nomination_date = EXCLUDED.nomination_date,
      confirmation_date = EXCLUDED.confirmation_date, commission_date = EXCLUDED.commission_date,
      recess_appointment_date = EXCLUDED.recess_appointment_date, senate_vote_type = EXCLUDED.senate_vote_type,
      senate_vote = EXCLUDED.senate_vote, termination_reason = EXCLUDED.termination_reason,
      termination_date = EXCLUDED.termination_date, source_url = EXCLUDED.source_url`;
  // Link to Jurvio's existing FJC-sourced judge rows when they exist.
  const linked = await sql`
    UPDATE scotus_justice sj SET judge_id = j.id, updated_at = now()
    FROM judge j WHERE j.fjc_nid = sj.fjc_nid AND sj.judge_id IS DISTINCT FROM j.id`;
  return { justices: justices.length, appointments: appointments.length, linkedToJudge: linked.count };
}

function caseRow(r: CsvRecord, era: "modern" | "legacy", releaseId: string) {
  return {
    scdb_case_id: r.caseId!, release_id: releaseId, era, term: scdbInt(r.term)!,
    decided_on: scdbDate(r.dateDecision), decision_type: scdbInt(r.decisionType),
    us_cite: scdbText(r.usCite), sct_cite: scdbText(r.sctCite), led_cite: scdbText(r.ledCite), lexis_cite: scdbText(r.lexisCite),
    docket: scdbText(r.docket), case_name: scdbText(r.caseName) ?? "(no name in SCDB)",
    natural_court: scdbInt(r.naturalCourt), chief: scdbText(r.chief),
    argued_on: scdbDate(r.dateArgument), reargued_on: scdbDate(r.dateRearg),
    issue: scdbInt(r.issue), issue_area: scdbInt(r.issueArea),
    decision_direction: scdbInt(r.decisionDirection), decision_direction_dissent: scdbInt(r.decisionDirectionDissent),
    case_disposition: scdbInt(r.caseDisposition), party_winning: scdbInt(r.partyWinning),
    precedent_alteration: scdbInt(r.precedentAlteration), declaration_uncon: scdbInt(r.declarationUncon),
    maj_opin_writer: scdbInt(r.majOpinWriter), maj_opin_assigner: scdbInt(r.majOpinAssigner),
    split_vote: scdbInt(r.splitVote), maj_votes: scdbInt(r.majVotes), min_votes: scdbInt(r.minVotes),
  };
}

// The codebook lists only justice ids 1-118 for first/secondAgreement; the files
// also carry 0 (about 2,700 modern + 1,700 legacy rows), which we read as "no
// agreement coded" rather than guess a meaning.
const agreement = (value: string | undefined) => { const n = scdbInt(value); return n === 0 ? null : n; };

function voteRow(r: CsvRecord) {
  return {
    scdb_case_id: r.caseId!, scdb_justice_id: scdbInt(r.justice)!, scdb_vote_id: r.voteId!,
    vote: scdbInt(r.vote), opinion: scdbInt(r.opinion), direction: scdbInt(r.direction), majority: scdbInt(r.majority),
    first_agreement: agreement(r.firstAgreement), second_agreement: agreement(r.secondAgreement),
  };
}

const REQUIRED_JUSTICE_COLUMNS = ["caseId", "docketId", "voteId", "term", "justice", "vote", "majority", "direction", "usCite", "docket", "dateDecision"];

/**
 * One SCDB release (modern or legacy). `justiceFile` is the justice-centered,
 * citation-organized file; `docketFile` (optional) the case-centered,
 * docket-organized file that lists every docket of consolidated cases.
 */
export async function importScdbRelease(sql: Db, input: {
  era: "modern" | "legacy"; version: string; sourceUrl: string; justiceFile: DataFile; docketFile?: DataFile;
}) {
  const justice = readScdbCsv(input.justiceFile);
  const header = Object.keys(justice.rows[0] ?? {});
  const missing = REQUIRED_JUSTICE_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${input.justiceFile.path} is missing SCDB columns: ${missing.join(", ")}`);
  const sourceSystem = input.era === "modern" ? "scdb_modern" : "scdb_legacy";
  const citation = SCDB_CITATION.replace("{version}", input.version);
  const releaseId = await recordRelease(sql, {
    sourceSystem, version: input.version, fileName: justice.innerName, sourceUrl: input.sourceUrl,
    bytes: input.justiceFile.bytes, rowCount: justice.rows.length, citation, license: SCDB_LICENSE_NOTE,
  });
  const cases = new Map<string, ReturnType<typeof caseRow>>();
  const firstDocket = new Map<string, CsvRecord>();
  for (const r of justice.rows) {
    if (!cases.has(r.caseId!)) { cases.set(r.caseId!, caseRow(r, input.era, releaseId)); firstDocket.set(r.caseId!, r); }
  }
  // Legacy 07 has a few rows with justice = -99 (not a codebook value): they
  // cannot be attributed to a justice, so they are counted and skipped.
  const attributable = (r: CsvRecord) => { const id = scdbInt(r.justice); return id !== null && id > 0; };
  const votes = justice.rows.filter(attributable).map(voteRow);
  const skippedVotes = justice.rows.length - votes.length;
  const dockets = new Map<string, { scdb_docket_id: string; scdb_case_id: string; docket: string | null; case_name: string | null; us_cite: string | null; decided_on: string | null }>();
  const docketRow = (r: CsvRecord) => ({
    scdb_docket_id: r.docketId!, scdb_case_id: r.caseId!, docket: scdbText(r.docket), case_name: scdbText(r.caseName),
    us_cite: scdbText(r.usCite), decided_on: scdbDate(r.dateDecision),
  });
  for (const r of firstDocket.values()) dockets.set(r.docketId!, docketRow(r));
  if (input.docketFile) {
    const docket = readScdbCsv(input.docketFile);
    await recordRelease(sql, {
      sourceSystem, version: input.version, fileName: docket.innerName, sourceUrl: input.sourceUrl,
      bytes: input.docketFile.bytes, rowCount: docket.rows.length, citation, license: SCDB_LICENSE_NOTE,
    });
    for (const r of docket.rows) if (cases.has(r.caseId!)) dockets.set(r.docketId!, docketRow(r));
  }
  const caseRows = [...cases.values()];
  await chunked(caseRows, 1000, (chunk) => sql`
    INSERT INTO scdb_case ${sql(chunk)}
    ON CONFLICT (scdb_case_id) DO UPDATE SET
      release_id = EXCLUDED.release_id, era = EXCLUDED.era, term = EXCLUDED.term, decided_on = EXCLUDED.decided_on,
      decision_type = EXCLUDED.decision_type, us_cite = EXCLUDED.us_cite, sct_cite = EXCLUDED.sct_cite,
      led_cite = EXCLUDED.led_cite, lexis_cite = EXCLUDED.lexis_cite, docket = EXCLUDED.docket,
      case_name = EXCLUDED.case_name, natural_court = EXCLUDED.natural_court, chief = EXCLUDED.chief,
      argued_on = EXCLUDED.argued_on, reargued_on = EXCLUDED.reargued_on, issue = EXCLUDED.issue,
      issue_area = EXCLUDED.issue_area, decision_direction = EXCLUDED.decision_direction,
      decision_direction_dissent = EXCLUDED.decision_direction_dissent, case_disposition = EXCLUDED.case_disposition,
      party_winning = EXCLUDED.party_winning, precedent_alteration = EXCLUDED.precedent_alteration,
      declaration_uncon = EXCLUDED.declaration_uncon, maj_opin_writer = EXCLUDED.maj_opin_writer,
      maj_opin_assigner = EXCLUDED.maj_opin_assigner, split_vote = EXCLUDED.split_vote,
      maj_votes = EXCLUDED.maj_votes, min_votes = EXCLUDED.min_votes, imported_at = now()`);
  await chunked([...dockets.values()], 2000, (chunk) => sql`
    INSERT INTO scdb_case_docket ${sql(chunk)}
    ON CONFLICT (scdb_docket_id) DO UPDATE SET scdb_case_id = EXCLUDED.scdb_case_id, docket = EXCLUDED.docket,
      case_name = EXCLUDED.case_name, us_cite = EXCLUDED.us_cite, decided_on = EXCLUDED.decided_on`);
  await chunked(votes, 4000, (chunk) => sql`
    INSERT INTO scdb_vote ${sql(chunk)}
    ON CONFLICT (scdb_case_id, scdb_justice_id) DO UPDATE SET
      scdb_vote_id = EXCLUDED.scdb_vote_id, vote = EXCLUDED.vote, opinion = EXCLUDED.opinion,
      direction = EXCLUDED.direction, majority = EXCLUDED.majority,
      first_agreement = EXCLUDED.first_agreement, second_agreement = EXCLUDED.second_agreement`);
  return { era: input.era, version: input.version, encoding: justice.encoding, cases: caseRows.length, dockets: dockets.size, votes: votes.length, skippedVotes };
}

/** Martin-Quinn justices.csv: term, justice (SCDB id), justiceName, code, post_mn, post_sd, post_med, post_025, post_975. */
export async function importMartinQuinn(sql: Db, input: { version: string; sourceUrl: string; file: DataFile }) {
  const { rows, innerName } = readScdbCsv(input.file);
  const header = Object.keys(rows[0] ?? {});
  for (const c of ["term", "justice", "post_mn"]) if (!header.includes(c)) throw new Error(`Martin-Quinn file missing column ${c}`);
  const releaseId = await recordRelease(sql, {
    sourceSystem: "martin_quinn", version: input.version, fileName: innerName, sourceUrl: input.sourceUrl,
    bytes: input.file.bytes, rowCount: rows.length, citation: MQ_CITATION, license: MQ_LICENSE_NOTE,
  });
  const num = (v: string | undefined) => { const t = scdbText(v); if (t === null) return null; const n = Number(t); if (!Number.isFinite(n)) throw new Error(`bad number ${v}`); return t; };
  // Refuse the file if any (justice id, justiceName) pair disagrees with the SCDB roster.
  const codes = new Map((await sql<{ id: number; code: string }[]>`SELECT scdb_justice_id AS id, scdb_code AS code FROM scotus_justice`).map((r) => [r.id, r.code]));
  const mismatched = rows.filter((r) => r.justiceName !== undefined && codes.get(scdbInt(r.justice)!) !== r.justiceName);
  if (mismatched.length) throw new Error(`Martin-Quinn rows disagree with SCDB justice ids: ${mismatched.slice(0, 3).map((r) => `${r.justice}=${r.justiceName}`).join(", ")}`);
  const scores = rows.map((r) => ({
    term: scdbInt(r.term)!, scdb_justice_id: scdbInt(r.justice)!, release_id: releaseId,
    post_mn: num(r.post_mn)!, post_sd: num(r.post_sd), post_med: num(r.post_med), post_025: num(r.post_025), post_975: num(r.post_975),
  }));
  await chunked(scores, 2000, (chunk) => sql`
    INSERT INTO martin_quinn_score ${sql(chunk)}
    ON CONFLICT (term, scdb_justice_id) DO UPDATE SET release_id = EXCLUDED.release_id, post_mn = EXCLUDED.post_mn,
      post_sd = EXCLUDED.post_sd, post_med = EXCLUDED.post_med, post_025 = EXCLUDED.post_025, post_975 = EXCLUDED.post_975`);
  return { scores: scores.length };
}

/** Link SCDB dockets, then cases, to Jurvio legal_case rows (see scdb-matching.ts). */
export async function matchScdbToJurvio(sql: Db) {
  await sql.unsafe(`
    WITH src AS (
      SELECT d.scdb_docket_id, c.term, coalesce(d.decided_on, c.decided_on) AS decided_on,
             coalesce(d.us_cite, c.us_cite) AS us_cite, d.docket
      FROM scdb_case_docket d JOIN scdb_case c USING (scdb_case_id)
    ),
    ${scdbMatchCtes("src")}
    UPDATE scdb_case_docket d
    SET legal_case_id = m.legal_case_id, match_method = m.match_method,
        match_candidates = m.match_candidates
    FROM scdb_match m
    WHERE m.scdb_docket_id = d.scdb_docket_id
      AND (d.legal_case_id, d.match_method, d.match_candidates) IS DISTINCT FROM (m.legal_case_id, m.match_method, m.match_candidates)`);
  // A case takes its first matched docket (in SCDB docket order); an unmatched
  // case keeps the candidate count of its first docket for review.
  await sql`
    WITH pick AS (
      SELECT DISTINCT ON (scdb_case_id) scdb_case_id, legal_case_id, match_method, match_candidates
      FROM scdb_case_docket
      ORDER BY scdb_case_id, (legal_case_id IS NULL), scdb_docket_id
    )
    UPDATE scdb_case c
    SET legal_case_id = p.legal_case_id, match_method = p.match_method, match_candidates = p.match_candidates,
        matched_at = now()
    FROM pick p
    WHERE p.scdb_case_id = c.scdb_case_id
      AND (c.legal_case_id, c.match_method, c.match_candidates) IS DISTINCT FROM (p.legal_case_id, p.match_method, p.match_candidates)`;
  return scdbMatchReport(sql);
}

export async function scdbMatchReport(sql: Db) {
  return sql<{ era: string; scdb_cases: number; matched: number; match_rate: string; by_us_cite: number; by_docket_and_date: number; by_docket_and_term: number }[]>`
    SELECT coalesce(era, 'all') AS era, count(*)::int AS scdb_cases, count(legal_case_id)::int AS matched,
           round(100.0 * count(legal_case_id) / nullif(count(*), 0), 2)::text AS match_rate,
           count(*) FILTER (WHERE match_method = 'us_cite')::int AS by_us_cite,
           count(*) FILTER (WHERE match_method = 'docket_and_date')::int AS by_docket_and_date,
           count(*) FILTER (WHERE match_method = 'docket_and_term')::int AS by_docket_and_term
    FROM scdb_case GROUP BY ROLLUP (era) ORDER BY era NULLS LAST`;
}

export async function refreshScotusAnalytics(sql: Db) {
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY scotus_justice_direction_mv`;
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY scotus_justice_pair_agreement_mv`;
}
