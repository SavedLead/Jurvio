import type postgres from "postgres";
import { citationCaseVisibleSql, citationDocumentVisibleSql } from "./citation-edges";

type Sql = ReturnType<typeof postgres>;

/**
 * Stub pages for cited cases Jurvio does not hold (ADR 0090, C9; migration 0175).
 * A stub is built only from a cluster CourtListener's bulk export gave us
 * (courtlistener_pending_cluster) that a Jurvio citation resolved to
 * (missing_case_citation 'resolved'), and never for restricted clusters or
 * sealed-looking captions. Pages are noindex and not in any sitemap.
 */
const SEALED_CAPTION_SQL = "\\m(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\\M";
export const STUB_PATH_PREFIX = "/cited/cl-";

export function stubPath(clusterId: number | string): string {
  return `${STUB_PATH_PREFIX}${clusterId}`;
}

export function parseStubParam(value: string): number | null {
  const match = /^cl-([1-9][0-9]{0,12})$/.exec(value);
  return match ? Number(match[1]) : null;
}

export interface StubRefreshResult { upserted: number; removed: number; batches: number; completed: boolean; cursor: number | null }

/**
 * Resumable keyset pass over resolved missing citations (by cluster id). Each
 * batch upserts stubs and deletes stubs whose cluster became restricted, sealed,
 * vanished from the pending table, or is now a real Jurvio case.
 */
export async function refreshCitationStubs(sql: Sql, options: { batch?: number; deadline: number; now?: () => number }): Promise<StubRefreshResult> {
  const batch = options.batch ?? 5_000;
  const now = options.now ?? Date.now;
  const result: StubRefreshResult = { upserted: 0, removed: 0, batches: 0, completed: false, cursor: null };
  const [state] = await sql<{ cursor: string | null }[]>`SELECT cursor_cluster_id::text AS cursor FROM citation_stub_build WHERE id`;
  let cursor = Number(state?.cursor ?? 0);
  if (!cursor) await sql`UPDATE citation_stub_build SET pass_started_at = now() WHERE id`;
  while (now() < options.deadline) {
    const [step] = await sql<{ last: string | null; upserted: number; removed: number }[]>`
      WITH ids AS (
        SELECT DISTINCT resolved_cluster_id AS cluster_id FROM missing_case_citation
        WHERE state = 'resolved' AND resolved_cluster_id > ${cursor}
        ORDER BY resolved_cluster_id LIMIT ${batch}
      ), candidates AS (
        SELECT ids.cluster_id, p.case_name, p.date_filed, p.precedential_status, p.snapshot_date,
          (SELECT array_agg(DISTINCT m.citation_label ORDER BY m.citation_label) FROM missing_case_citation m
            WHERE m.state = 'resolved' AND m.resolved_cluster_id = ids.cluster_id) AS labels
        FROM ids
        JOIN courtlistener_pending_cluster p ON p.cluster_id = ids.cluster_id::text
        WHERE NOT p.restricted AND p.case_name !~* ${SEALED_CAPTION_SQL} AND length(btrim(p.case_name)) > 0
          AND NOT EXISTS (SELECT 1 FROM opinion_cluster oc JOIN provider pr ON pr.id = oc.provider_id AND pr.code = 'courtlistener'
            WHERE oc.provider_cluster_id = ids.cluster_id::text)
      ), upserted AS (
        INSERT INTO citation_stub_case AS s (cluster_id, case_name, date_filed, precedential_status, citation_labels, snapshot_date, refreshed_at)
        SELECT cluster_id, left(case_name, 500), date_filed, precedential_status, COALESCE(labels, '{}'), snapshot_date, now() FROM candidates
        ON CONFLICT (cluster_id) DO UPDATE SET case_name = EXCLUDED.case_name, date_filed = EXCLUDED.date_filed,
          precedential_status = EXCLUDED.precedential_status, citation_labels = EXCLUDED.citation_labels,
          snapshot_date = COALESCE(EXCLUDED.snapshot_date, s.snapshot_date), refreshed_at = now()
        RETURNING 1
      ), removed AS (
        DELETE FROM citation_stub_case s USING ids
        WHERE s.cluster_id = ids.cluster_id AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.cluster_id = s.cluster_id)
          -- keep a stub whose pending row was pruned, unless it is now held or became unsafe
          AND (EXISTS (SELECT 1 FROM courtlistener_pending_cluster p WHERE p.cluster_id = ids.cluster_id::text)
            OR EXISTS (SELECT 1 FROM opinion_cluster oc JOIN provider pr ON pr.id = oc.provider_id AND pr.code = 'courtlistener'
              WHERE oc.provider_cluster_id = ids.cluster_id::text))
        RETURNING 1
      )
      SELECT (SELECT max(cluster_id)::text FROM ids) AS last, (SELECT count(*) FROM upserted)::int AS upserted,
        (SELECT count(*) FROM removed)::int AS removed`;
    result.batches += 1;
    result.upserted += step?.upserted ?? 0;
    result.removed += step?.removed ?? 0;
    if (!step?.last) {
      // Stubs whose citation is no longer 'resolved' (ingested, re-pointed) go away at pass end.
      result.removed += (await sql`DELETE FROM citation_stub_case s WHERE NOT EXISTS (
        SELECT 1 FROM missing_case_citation m WHERE m.state = 'resolved' AND m.resolved_cluster_id = s.cluster_id) RETURNING 1`).length;
      await sql`UPDATE citation_stub_build SET cursor_cluster_id = NULL, pass_completed_at = now() WHERE id`;
      result.completed = true;
      cursor = 0;
      break;
    }
    cursor = Number(step.last);
    await sql`UPDATE citation_stub_build SET cursor_cluster_id = ${cursor} WHERE id`;
  }
  result.cursor = cursor || null;
  return result;
}

export interface CitationStub { clusterId: number; caseName: string; dateFiled: string | null; citationLabels: string[]; heldCasePublicId: string | null }

/** The stub, or the Jurvio case that now holds the cluster (caller redirects). */
export async function loadCitationStub(sql: Sql, clusterId: number): Promise<CitationStub | null> {
  const [held] = await sql<{ public_id: string }[]>`
    SELECT c.public_id FROM opinion_cluster oc JOIN provider pr ON pr.id = oc.provider_id AND pr.code = 'courtlistener'
    JOIN legal_case c ON c.id = oc.case_id
    WHERE oc.provider_cluster_id = ${String(clusterId)} AND ${sql.unsafe(citationCaseVisibleSql("c"))} LIMIT 1`;
  if (held) return { clusterId, caseName: "", dateFiled: null, citationLabels: [], heldCasePublicId: held.public_id };
  const [stub] = await sql<{ case_name: string; date_filed: string | null; citation_labels: string[] }[]>`
    SELECT case_name, date_filed::text, citation_labels FROM citation_stub_case
    WHERE cluster_id = ${clusterId} AND case_name !~* ${SEALED_CAPTION_SQL}`;
  return stub ? { clusterId, caseName: stub.case_name, dateFiled: stub.date_filed, citationLabels: stub.citation_labels, heldCasePublicId: null } : null;
}

export interface StubCitingCase { casePublicId: string; caption: string; courtName: string; citationLabel: string }

/** Visible Jurvio cases whose opinions cite the stub's cluster (text citations + CL map). */
export async function stubCitingCases(sql: Sql, clusterId: number, limit = 50): Promise<StubCitingCase[]> {
  return sql<StubCitingCase[]>`
    WITH docs AS (
      SELECT dcc.document_id, m.citation_label FROM missing_case_citation m
      JOIN document_case_citation dcc ON dcc.citation_key = m.citation_key
      WHERE m.state = 'resolved' AND m.resolved_cluster_id = ${clusterId}
      UNION ALL
      SELECT u.citing_document_id, '' FROM courtlistener_opinion_cluster_map map
      JOIN courtlistener_citation_unresolved u ON u.cited_opinion_id = map.opinion_id
      WHERE map.cluster_id = ${clusterId}
    )
    SELECT DISTINCT ON (c.id) c.public_id AS "casePublicId", c.caption, court.name AS "courtName",
      COALESCE(NULLIF(docs.citation_label, ''), c.official_citation, '') AS "citationLabel", d.filed_on
    FROM docs JOIN document d ON d.id = docs.document_id JOIN legal_case c ON c.id = d.case_id JOIN court ON court.id = c.court_id
    WHERE ${sql.unsafe(citationDocumentVisibleSql("d"))} AND ${sql.unsafe(citationCaseVisibleSql("c"))}
    ORDER BY c.id, d.filed_on DESC NULLS LAST
    LIMIT ${limit}`;
}

export interface CitedStub { clusterId: number; caseName: string; citationLabel: string; dateFiled: string | null }

/** Stubs the case's visible opinions cite: "Cited cases not yet on Jurvio". */
export async function citedStubsForCase(sql: Sql, casePublicId: string, limit = 50): Promise<CitedStub[]> {
  return sql<CitedStub[]>`
    SELECT DISTINCT ON (s.cluster_id) s.cluster_id::int AS "clusterId", s.case_name AS "caseName",
      m.citation_label AS "citationLabel", s.date_filed::text AS "dateFiled"
    FROM legal_case c
    JOIN document d ON d.case_id = c.id
    JOIN document_case_citation dcc ON dcc.document_id = d.id
    JOIN missing_case_citation m ON m.citation_key = dcc.citation_key AND m.state = 'resolved'
    JOIN citation_stub_case s ON s.cluster_id = m.resolved_cluster_id
    WHERE c.public_id = ${casePublicId} AND ${sql.unsafe(citationCaseVisibleSql("c"))} AND ${sql.unsafe(citationDocumentVisibleSql("d"))}
    ORDER BY s.cluster_id
    LIMIT ${limit}`;
}
