import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";

type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql;

/**
 * Precomputed Cites / Cited-by edges and dirty-set counts (migration 0171,
 * ADR 0090).
 *
 * One function builds every edge: `rebuildOutgoing` recomputes all edges whose
 * citing end is in a batch of cases, from Jurvio's own parse plus the
 * CourtListener citation map. "Incoming" work (a case's cite identities or
 * visibility changed) only finds the cases that cite or cited it and queues
 * them for outgoing rebuilds, so there is a single code path for edge rows.
 *
 * Rules, identical to the old live lists: both ends published and
 * displayable, citing opinion published/displayable at its current content
 * version, a reporter key counts only when exactly one case holds it, and a
 * case's own citations are not "cites". Sealed-caption cases (the same signals
 * as captionAllowsFollow) are excluded from both ends, so citation lists never
 * expose them to anonymous readers.
 */

const SEALED_CAPTION_SQL = "\\m(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\\M";
const SEALED_DOCKET_SQL = "-(mj|gj|sw|sealed)-";

function caseVisibleSql(alias: string): string {
  return `(${alias}.publication = 'published'
    AND ${latestPublicationColumnSql("displayable", "legal_case", `${alias}.id`)}
    AND ${alias}.caption !~* '${SEALED_CAPTION_SQL}'
    AND ${alias}.docket_number !~* '${SEALED_DOCKET_SQL}'
    AND NOT ${searchExcludedCaseSql(alias)})`;
}
function documentVisibleSql(alias: string): string {
  return `(${alias}.publication = 'published' AND ${latestPublicationColumnSql("displayable", "document", `${alias}.id`)})`;
}

/** Also used by the page read path, so both share one definition. */
export const citationCaseVisibleSql = caseVisibleSql;
export const citationDocumentVisibleSql = documentVisibleSql;

export const DIRTY_OUT = 1;
export const DIRTY_IN = 2;

export async function markDirty(sql: Sql | Tx, caseIds: readonly string[], bits: number): Promise<void> {
  if (!caseIds.length) return;
  await sql`
    INSERT INTO citation_dirty_case(case_id, direction)
    SELECT DISTINCT unnest(${[...caseIds]}::uuid[]), ${bits}::smallint
    ON CONFLICT (case_id) DO UPDATE SET direction = citation_dirty_case.direction | EXCLUDED.direction,
      queued_at = clock_timestamp()`;
}

export interface OutgoingResult {
  cases: number;
  edges: number;
  /** Cases whose cited_by may have changed (old and new targets). */
  affectedTargets: string[];
}

/**
 * Recompute every edge whose citing end is one of `caseIds`, and that case's
 * cited / cited_on_jurvio counts. Invisible cases end up with no edges.
 * When `recountTargets` is true, cited_by of every old or new target is
 * recounted too (the dirty path); the full sweep recounts all at the end.
 */
export async function rebuildOutgoing(tx: Tx, caseIds: readonly string[], recountTargets = true): Promise<OutgoingResult> {
  const ids = [...new Set(caseIds)];
  if (!ids.length) return { cases: 0, edges: 0, affectedTargets: [] };
  await tx.unsafe(`
    CREATE TEMP TABLE IF NOT EXISTS tmp_citation_refs (
      case_id uuid, document_id uuid, filed_on date, citation_key text, citation_label text,
      start_offset integer, location_kind text, cl_cited uuid, cl_depth integer) ON COMMIT DROP;
    CREATE TEMP TABLE IF NOT EXISTS tmp_citation_edge (
      citing uuid, cited uuid, document_id uuid, citation_label text, mentions integer,
      depth integer, sources smallint, filed_on date) ON COMMIT DROP;
    TRUNCATE tmp_citation_refs; TRUNCATE tmp_citation_edge;`);
  await tx`
    INSERT INTO tmp_citation_refs
    WITH src AS (
      SELECT c.id FROM legal_case c
      WHERE c.id = ANY(${ids}::uuid[]) AND ${tx.unsafe(caseVisibleSql("c"))}
    ), vdoc AS (
      SELECT d.id, d.case_id, d.filed_on, content.content_hash
      FROM src JOIN document d ON d.case_id = src.id
      JOIN document_content content ON content.document_id = d.id
      WHERE ${tx.unsafe(documentVisibleSql("d"))}
    )
    SELECT vd.case_id, vd.id, vd.filed_on, ref.citation_key, ref.citation_label, ref.start_offset, ref.location_kind,
      NULL::uuid, NULL::integer
    FROM vdoc vd
    JOIN document_case_citation ref ON ref.document_id = vd.id AND ref.source_content_hash = vd.content_hash
    WHERE NOT EXISTS (
      SELECT 1 FROM case_citation_identity own WHERE own.case_id = vd.case_id AND own.citation_key = ref.citation_key)
    UNION ALL
    -- CourtListener citation-map rows for these opinions (citation_key NULL).
    SELECT vd.case_id, vd.id, vd.filed_on, NULL, NULL, 2147483647, 'cl', ce.cited_case_id, ce.depth::integer
    FROM vdoc vd JOIN courtlistener_citation_edge ce ON ce.citing_document_id = vd.id`;
  await tx`
    INSERT INTO tmp_citation_edge
    WITH keyset AS (
      SELECT DISTINCT citation_key FROM tmp_citation_refs WHERE citation_key IS NOT NULL
    ), uniq AS (
      SELECT k.citation_key, min(p.case_id::text)::uuid AS target
      FROM keyset k
      JOIN LATERAL (SELECT i.case_id FROM case_citation_identity i WHERE i.citation_key = k.citation_key LIMIT 2) p ON true
      GROUP BY k.citation_key HAVING count(*) = 1
    ), linked AS (
      SELECT r.case_id AS citing, u.target AS cited, r.document_id, r.filed_on, r.citation_label, r.start_offset,
        NULL::integer AS depth, 1 AS bit
      FROM tmp_citation_refs r JOIN uniq u ON u.citation_key = r.citation_key
      UNION ALL
      SELECT r.case_id, r.cl_cited, r.document_id, r.filed_on, NULL, r.start_offset, r.cl_depth, 2
      FROM tmp_citation_refs r WHERE r.cl_cited IS NOT NULL
    ), visible AS (
      SELECT l.* FROM linked l JOIN legal_case t ON t.id = l.cited
      WHERE l.cited <> l.citing AND ${tx.unsafe(caseVisibleSql("t"))}
    )
    SELECT citing, cited,
      (array_agg(document_id ORDER BY filed_on DESC NULLS LAST, document_id, start_offset))[1],
      (array_agg(citation_label ORDER BY filed_on DESC NULLS LAST, document_id, start_offset) FILTER (WHERE citation_label IS NOT NULL))[1],
      count(*) FILTER (WHERE bit = 1)::integer,
      max(depth),
      bit_or(bit)::smallint,
      max(filed_on)
    FROM visible GROUP BY citing, cited`;
  const old = await tx<{ cited: string }[]>`
    DELETE FROM case_citation_edge e
    WHERE e.citing_case_id = ANY(${ids}::uuid[])
      AND NOT EXISTS (SELECT 1 FROM tmp_citation_edge t WHERE t.citing = e.citing_case_id AND t.cited = e.cited_case_id)
    RETURNING e.cited_case_id AS cited`;
  const fresh = await tx<{ cited: string }[]>`
    INSERT INTO case_citation_edge (citing_case_id, cited_case_id, citing_document_id, citation_label, mentions, depth, sources, citing_filed_on, refreshed_at)
    SELECT citing, cited, document_id, citation_label, mentions, depth, sources, filed_on, now() FROM tmp_citation_edge
    ON CONFLICT (citing_case_id, cited_case_id) DO UPDATE SET
      citing_document_id = EXCLUDED.citing_document_id, citation_label = EXCLUDED.citation_label,
      mentions = EXCLUDED.mentions, depth = EXCLUDED.depth, sources = EXCLUDED.sources,
      citing_filed_on = EXCLUDED.citing_filed_on, refreshed_at = EXCLUDED.refreshed_at
    RETURNING cited_case_id AS cited`;
  // cited = distinct reporter keys in the text (resolved or not) plus cases
  // known only from the CourtListener map; cited_on_jurvio = linked cases.
  await tx`
    INSERT INTO case_citation_count (case_id, cited, cited_on_jurvio, cited_by, refreshed_at)
    SELECT b.id,
      COALESCE(k.n, 0) + COALESCE(e.cl_only, 0), COALESCE(e.n, 0), 0, now()
    FROM unnest(${ids}::uuid[]) AS b(id)
    JOIN legal_case c ON c.id = b.id
    LEFT JOIN (SELECT case_id, count(DISTINCT citation_key)::int AS n FROM tmp_citation_refs
      WHERE location_kind = 'text' GROUP BY case_id) k ON k.case_id = b.id
    LEFT JOIN (SELECT citing, count(*)::int AS n, count(*) FILTER (WHERE sources = 2)::int AS cl_only
      FROM tmp_citation_edge GROUP BY citing) e ON e.citing = b.id
    ON CONFLICT (case_id) DO UPDATE SET cited = EXCLUDED.cited, cited_on_jurvio = EXCLUDED.cited_on_jurvio,
      refreshed_at = EXCLUDED.refreshed_at`;
  const affectedTargets = [...new Set([...old, ...fresh].map((row) => row.cited))];
  if (recountTargets) await recountCitedBy(tx, affectedTargets);
  return { cases: ids.length, edges: fresh.length, affectedTargets };
}

/** cited_by = number of edges pointing at the case (both ends visible at build). */
export async function recountCitedBy(tx: Tx | Sql, caseIds: readonly string[]): Promise<number> {
  if (!caseIds.length) return 0;
  const rows = await tx`
    INSERT INTO case_citation_count (case_id, cited, cited_on_jurvio, cited_by, refreshed_at)
    SELECT c.id, 0, 0, (SELECT count(*)::int FROM case_citation_edge e WHERE e.cited_case_id = c.id), now()
    FROM legal_case c WHERE c.id = ANY(${[...new Set(caseIds)]}::uuid[])
    ON CONFLICT (case_id) DO UPDATE SET cited_by = EXCLUDED.cited_by, refreshed_at = EXCLUDED.refreshed_at
    RETURNING 1`;
  return rows.length;
}

/**
 * Cases whose outgoing edges must be rebuilt because `caseIds` changed as a
 * cited case: everything that cited them before, every opinion citing one of
 * their cite keys (resolved or not), and CourtListener map rows.
 */
export async function citingCasesOf(tx: Tx, caseIds: readonly string[]): Promise<string[]> {
  if (!caseIds.length) return [];
  const rows = await tx<{ id: string }[]>`
    SELECT e.citing_case_id AS id FROM case_citation_edge e WHERE e.cited_case_id = ANY(${[...caseIds]}::uuid[])
    UNION
    SELECT d.case_id FROM case_citation_identity i
    JOIN document_case_citation ref ON ref.citation_key = i.citation_key
    JOIN document d ON d.id = ref.document_id AND d.publication = 'published'
    WHERE i.case_id = ANY(${[...caseIds]}::uuid[])
    UNION
    SELECT d.case_id FROM courtlistener_citation_edge ce JOIN document d ON d.id = ce.citing_document_id
    WHERE ce.cited_case_id = ANY(${[...caseIds]}::uuid[]) AND d.publication = 'published'`;
  return rows.map((row) => row.id);
}

export interface DirtyResult {
  taken: number;
  outgoing: number;
  incoming: number;
  requeued: number;
  edges: number;
}

/**
 * Drain one batch of citation_dirty_case. Incoming work fans out into outgoing
 * work (queued, processed by later batches); outgoing work rebuilds edges and
 * recounts the touched targets. Rows re-marked while we worked keep their
 * newer queued_at and survive the delete.
 */
export async function processDirtyBatch(sql: Sql, limit = 200, options: { recount?: boolean } = {}): Promise<DirtyResult> {
  // Before the first full sweep finishes the edge table is partial, so
  // recounting cited_by from it would lower live counts; the sweep recounts all.
  const recount = options.recount ?? true;
  return sql.begin(async (tx) => {
    // queued_at goes back as text: a JS Date drops microseconds, and the
    // "only delete rows not re-marked since" check needs the exact value.
    const rows = await tx<{ case_id: string; direction: number; queued_at: string }[]>`
      SELECT case_id, direction, queued_at::text AS queued_at FROM citation_dirty_case ORDER BY queued_at, case_id LIMIT ${limit}`;
    const result: DirtyResult = { taken: rows.length, outgoing: 0, incoming: 0, requeued: 0, edges: 0 };
    if (!rows.length) return result;
    const incoming = rows.filter((row) => row.direction & DIRTY_IN).map((row) => row.case_id);
    const outgoing = rows.filter((row) => row.direction & DIRTY_OUT).map((row) => row.case_id);
    if (incoming.length) {
      const citing = (await citingCasesOf(tx, incoming)).filter((id) => !outgoing.includes(id));
      result.incoming = incoming.length;
      // Small fan-outs are rebuilt now; big ones (a landmark case) are queued.
      if (citing.length <= limit) outgoing.push(...citing);
      else { await markDirty(tx, citing, DIRTY_OUT); result.requeued = citing.length; }
    }
    if (outgoing.length) {
      const built = await rebuildOutgoing(tx, outgoing, recount);
      result.outgoing = built.cases;
      result.edges = built.edges;
    }
    if (incoming.length && recount) await recountCitedBy(tx, incoming);
    await tx`
      DELETE FROM citation_dirty_case d USING unnest(${rows.map((r) => r.case_id)}::uuid[], ${rows.map((r) => r.queued_at)}::text[]) AS t(case_id, queued_at)
      WHERE d.case_id = t.case_id AND d.queued_at <= t.queued_at::timestamptz`;
    return result;
  });
}
