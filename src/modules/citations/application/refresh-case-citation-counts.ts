import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * Replace every stored citation total in one pass. This is the same visibility
 * rule as the case page (published, displayable mirror, current content hash,
 * unique identity), run once for the corpus instead of once per page view.
 * A failure leaves the previous rows in place.
 */
export async function refreshCaseCitationCounts(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    WITH visible_case AS (
      SELECT c.id
      FROM legal_case c
      JOIN publication_current pub
        ON pub.object_type = 'legal_case' AND pub.object_id = c.id AND pub.displayable
      WHERE c.publication = 'published'
    ), visible_doc AS (
      SELECT d.id, d.case_id, content.content_hash
      FROM document d
      JOIN visible_case vc ON vc.id = d.case_id
      JOIN document_content content ON content.document_id = d.id
      JOIN publication_current pub
        ON pub.object_type = 'document' AND pub.object_id = d.id AND pub.displayable
      WHERE d.publication = 'published'
    ), unique_identity AS (
      SELECT citation_key, min(case_id::text)::uuid AS case_id
      FROM case_citation_identity
      GROUP BY citation_key
      HAVING count(*) = 1
    ), cited AS (
      SELECT vd.case_id, count(DISTINCT ref.citation_key)::int AS n
      FROM visible_doc vd
      JOIN document_case_citation ref
        ON ref.document_id = vd.id
       AND ref.source_content_hash = vd.content_hash
       AND ref.location_kind = 'text'
      WHERE NOT EXISTS (
        SELECT 1 FROM case_citation_identity own
        WHERE own.case_id = vd.case_id AND own.citation_key = ref.citation_key
      )
      GROUP BY vd.case_id
    ), cited_on AS (
      SELECT vd.case_id, count(DISTINCT ref.citation_key)::int AS n
      FROM visible_doc vd
      JOIN document_case_citation ref
        ON ref.document_id = vd.id
       AND ref.source_content_hash = vd.content_hash
       AND ref.location_kind = 'text'
      JOIN unique_identity ui ON ui.citation_key = ref.citation_key
      JOIN visible_case target ON target.id = ui.case_id
      WHERE ui.case_id <> vd.case_id
        AND NOT EXISTS (
          SELECT 1 FROM case_citation_identity own
          WHERE own.case_id = vd.case_id AND own.citation_key = ref.citation_key
        )
      GROUP BY vd.case_id
    ), citing_doc AS (
      SELECT DISTINCT ref.citation_key, ref.document_id, ref.source_content_hash
      FROM document_case_citation ref
    ), citing AS (
      SELECT ui.case_id, count(DISTINCT d.case_id)::int AS n
      FROM unique_identity ui
      JOIN citing_doc ref ON ref.citation_key = ui.citation_key
      JOIN document d ON d.id = ref.document_id AND d.publication = 'published' AND d.case_id <> ui.case_id
      JOIN document_content content
        ON content.document_id = d.id AND content.content_hash = ref.source_content_hash
      JOIN publication_current doc_pub
        ON doc_pub.object_type = 'document' AND doc_pub.object_id = d.id AND doc_pub.displayable
      JOIN visible_case citing_case ON citing_case.id = d.case_id
      GROUP BY ui.case_id
    ), upserted AS (
      INSERT INTO case_citation_count (case_id, cited, cited_on_jurvio, cited_by, refreshed_at)
      SELECT vc.id, COALESCE(cited.n, 0), COALESCE(cited_on.n, 0), COALESCE(citing.n, 0), now()
      FROM visible_case vc
      LEFT JOIN cited ON cited.case_id = vc.id
      LEFT JOIN cited_on ON cited_on.case_id = vc.id
      LEFT JOIN citing ON citing.case_id = vc.id
      ON CONFLICT (case_id) DO UPDATE SET
        cited = EXCLUDED.cited,
        cited_on_jurvio = EXCLUDED.cited_on_jurvio,
        cited_by = EXCLUDED.cited_by,
        refreshed_at = EXCLUDED.refreshed_at
      RETURNING case_id
    )
    SELECT count(*)::int AS n FROM upserted
  `;
  await sql`
    DELETE FROM case_citation_count stat
    WHERE NOT EXISTS (
      SELECT 1 FROM legal_case c
      JOIN publication_current pub
        ON pub.object_type = 'legal_case' AND pub.object_id = c.id AND pub.displayable
      WHERE c.id = stat.case_id AND c.publication = 'published'
    )
  `;
  return row?.n ?? 0;
}
