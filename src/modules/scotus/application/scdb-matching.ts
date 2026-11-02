/**
 * SQL that links SCDB dockets to Jurvio legal_case rows. Shared by the importer
 * (which writes the result) and by the read-only production match-rate report
 * (scripts/diag), so both measure exactly the same rule.
 *
 * `source` must be a relation (CTE or table) with columns
 *   scdb_docket_id text, term smallint, decided_on date, us_cite text, docket text.
 *
 * Rule, first unique hit wins (ambiguous candidates never match):
 *   1. us_cite          U.S. Reports citation (legal_case.official_citation or a
 *                       case_citation_identity key "<vol>us<page>"); when several
 *                       Jurvio cases share the cite, the one with the same docket.
 *   2. docket_and_date  same docket key and same decision date.
 *   3. docket_and_term  same docket key and same October Term, only one candidate.
 * Returns: scdb_docket_id, legal_case_id, match_method, match_candidates.
 */
export const DOCKET_KEY_SQL = (expr: string) =>
  `nullif(regexp_replace(regexp_replace(lower(coalesce(${expr}, '')), '^\\s*nos?\\.?\\s*', ''), '[^a-z0-9]', '', 'g'), '')`;

export const US_KEY_SQL = (expr: string) =>
  `CASE WHEN ${expr} ~* '^\\s*[0-9]+\\s*U\\.?\\s*S\\.?\\s+[0-9]+' THEN regexp_replace(${expr}, '^\\s*0*([0-9]+)\\s*[Uu]\\.?\\s*[Ss]\\.?\\s+0*([0-9]+).*$', '\\1us\\2') END`;

export function scdbMatchCtes(source: string): string {
  return `
scdb_src AS (
  SELECT s.scdb_docket_id, s.term, s.decided_on,
         ${US_KEY_SQL("s.us_cite")} AS us_key,
         ${DOCKET_KEY_SQL("s.docket")} AS docket_key
  FROM ${source} s
),
jv AS (
  SELECT lc.id, lc.supreme_court_term AS term, lc.decided_on,
         ${DOCKET_KEY_SQL("lc.docket_number")} AS docket_key,
         ${US_KEY_SQL("lc.official_citation")} AS us_key
  FROM legal_case lc
  JOIN court ct ON ct.id = lc.court_id
  WHERE lc.supreme_court_term IS NOT NULL OR lower(ct.provider_court_id) = 'scotus'
),
jv_us AS (
  SELECT id, us_key FROM jv WHERE us_key IS NOT NULL
  UNION
  SELECT cci.case_id, cci.citation_key FROM case_citation_identity cci JOIN jv ON jv.id = cci.case_id
  WHERE cci.citation_key ~ '^[0-9]+us[0-9]+$'
),
m_us AS (
  SELECT s.scdb_docket_id,
         count(DISTINCT jv.id) AS n,
         count(DISTINCT jv.id) FILTER (WHERE jv.docket_key = s.docket_key) AS n_docket,
         (array_agg(DISTINCT jv.id))[1] AS any_id,
         (array_agg(DISTINCT jv.id) FILTER (WHERE jv.docket_key = s.docket_key))[1] AS docket_id
  FROM scdb_src s JOIN jv_us u ON u.us_key = s.us_key JOIN jv ON jv.id = u.id
  GROUP BY s.scdb_docket_id
),
m_date AS (
  SELECT s.scdb_docket_id, count(DISTINCT jv.id) AS n, (array_agg(DISTINCT jv.id))[1] AS any_id
  FROM scdb_src s JOIN jv ON jv.docket_key = s.docket_key AND jv.decided_on = s.decided_on
  GROUP BY s.scdb_docket_id
),
m_term AS (
  SELECT s.scdb_docket_id, count(DISTINCT jv.id) AS n, (array_agg(DISTINCT jv.id))[1] AS any_id
  FROM scdb_src s JOIN jv ON jv.docket_key = s.docket_key AND jv.term = s.term
  GROUP BY s.scdb_docket_id
),
scdb_match AS (
  SELECT s.scdb_docket_id,
         CASE WHEN u.n = 1 THEN u.any_id WHEN u.n_docket = 1 THEN u.docket_id
              WHEN d.n = 1 THEN d.any_id WHEN t.n = 1 THEN t.any_id END AS legal_case_id,
         CASE WHEN u.n = 1 OR u.n_docket = 1 THEN 'us_cite'
              WHEN d.n = 1 THEN 'docket_and_date' WHEN t.n = 1 THEN 'docket_and_term' END AS match_method,
         CASE WHEN u.n = 1 OR u.n_docket = 1 THEN u.n
              WHEN d.n = 1 THEN d.n WHEN t.n = 1 THEN t.n
              ELSE greatest(coalesce(u.n, 0), coalesce(d.n, 0), coalesce(t.n, 0)) END::smallint AS match_candidates
  FROM scdb_src s
  LEFT JOIN m_us u USING (scdb_docket_id)
  LEFT JOIN m_date d USING (scdb_docket_id)
  LEFT JOIN m_term t USING (scdb_docket_id)
)`;
}
