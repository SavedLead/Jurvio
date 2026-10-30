import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * Fill case_citation_count in committed batches.
 *
 * The first version inserted every case in one statement, after a distinct
 * over every document_case_citation row. That statement holds its insert
 * until it commits, so thirteen minutes after the citations worker restarted
 * on cd1b816 the table was still empty and case pages still ran the ~4.7s
 * query. A timeout rolls the whole statement back, so a 20-minute limit
 * never leaves a partial result.
 *
 * Each batch commits. A statement timeout shrinks that batch, and a single
 * case that still times out is skipped so the rest of the corpus is stored.
 * Skipped cases keep the live query.
 */
const BATCH = 100;
const BATCH_TIMEOUT = "45s";

export async function refreshCaseCitationCounts(sql: Sql): Promise<number> {
  console.log(JSON.stringify({ citationCounts: "start", batchSize: BATCH }));
  let cursor: string | null = null;
  let upserted = 0;
  let skipped = 0;
  let limit = BATCH;
  let pending = await nextCaseIds(sql, cursor, BATCH);
  while (pending.length) {
    const slice = pending.slice(0, limit);
    try {
      const n = await upsertBatch(sql, slice);
      upserted += n;
      cursor = slice[slice.length - 1] ?? cursor;
      pending = pending.slice(slice.length);
      if (!pending.length) pending = await nextCaseIds(sql, cursor, BATCH);
      limit = BATCH;
      console.log(JSON.stringify({ citationCounts: "batch", cases: slice.length, upserted: n, total: upserted, cursor }));
    } catch (error) {
      if (!isStatementTimeout(error)) throw error;
      if (slice.length === 1) {
        skipped += 1;
        cursor = slice[0] ?? cursor;
        pending = pending.slice(1);
        if (!pending.length) pending = await nextCaseIds(sql, cursor, BATCH);
        limit = BATCH;
        console.log(JSON.stringify({ citationCounts: "skipped", caseId: slice[0], reason: "statement_timeout" }));
        continue;
      }
      limit = Math.max(1, Math.floor(slice.length / 4));
      console.log(JSON.stringify({ citationCounts: "shrink", from: slice.length, to: limit }));
    }
  }
  const removed = await deleteStale(sql);
  console.log(JSON.stringify({ citationCounts: "done", upserted, skipped, removed }));
  return upserted;
}

function isStatementTimeout(error: unknown): boolean {
  if ((error as { code?: string }).code === "57014") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("statement timeout");
}

async function nextCaseIds(sql: Sql, cursor: string | null, limit: number): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT c.id
    FROM legal_case c
    JOIN publication_current pub
      ON pub.object_type = 'legal_case' AND pub.object_id = c.id AND pub.displayable
    WHERE c.publication = 'published'
      AND (${cursor}::uuid IS NULL OR c.id > ${cursor}::uuid)
    ORDER BY c.id
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

async function upsertBatch(sql: Sql, ids: string[]): Promise<number> {
  return sql.begin(async (tx) => {
    // set_config inside the statement it limits does not apply to that
    // statement. Set it, then run the batch.
    await tx`SELECT set_config('statement_timeout', ${BATCH_TIMEOUT}, true)`;
    const [row] = await tx<{ n: number }[]>`
      WITH batch AS (
        SELECT c.id
        FROM legal_case c
        WHERE c.id = ANY(${ids}::uuid[])
      ), visible_doc AS (
        SELECT d.id, d.case_id, content.content_hash
        FROM document d
        JOIN batch b ON b.id = d.case_id
        JOIN document_content content ON content.document_id = d.id
        JOIN publication_current pub
          ON pub.object_type = 'document' AND pub.object_id = d.id AND pub.displayable
        WHERE d.publication = 'published'
      ), cited_keys AS (
        SELECT DISTINCT vd.case_id, ref.citation_key
        FROM visible_doc vd
        JOIN document_case_citation ref
          ON ref.document_id = vd.id
         AND ref.source_content_hash = vd.content_hash
         AND ref.location_kind = 'text'
        WHERE NOT EXISTS (
          SELECT 1 FROM case_citation_identity own
          WHERE own.case_id = vd.case_id AND own.citation_key = ref.citation_key
        )
      ), cited AS (
        SELECT case_id, count(*)::int AS n FROM cited_keys GROUP BY case_id
      ), unique_cited AS (
        SELECT k.case_id, k.citation_key, min(probe.case_id::text)::uuid AS target_id
        FROM cited_keys k
        JOIN LATERAL (
          SELECT identity.case_id
          FROM case_citation_identity identity
          WHERE identity.citation_key = k.citation_key
          LIMIT 2
        ) probe ON true
        GROUP BY k.case_id, k.citation_key
        HAVING count(*) = 1
      ), cited_on AS (
        SELECT u.case_id, count(*)::int AS n
        FROM unique_cited u
        JOIN legal_case target ON target.id = u.target_id AND target.publication = 'published'
        JOIN publication_current pub
          ON pub.object_type = 'legal_case' AND pub.object_id = target.id AND pub.displayable
        WHERE u.target_id <> u.case_id
        GROUP BY u.case_id
      ), own_keys AS (
        SELECT own.case_id, own.citation_key
        FROM case_citation_identity own
        JOIN batch b ON b.id = own.case_id
        WHERE (
          SELECT count(*) FROM (
            SELECT 1 FROM case_citation_identity other
            WHERE other.citation_key = own.citation_key
            LIMIT 2
          ) probe
        ) = 1
      ), citing AS (
        SELECT own.case_id, count(DISTINCT d.case_id)::int AS n
        FROM own_keys own
        JOIN LATERAL (
          SELECT DISTINCT ref.document_id, ref.source_content_hash
          FROM document_case_citation ref
          WHERE ref.citation_key = own.citation_key
        ) ref ON true
        JOIN document d ON d.id = ref.document_id AND d.publication = 'published' AND d.case_id <> own.case_id
        JOIN document_content content
          ON content.document_id = d.id AND content.content_hash = ref.source_content_hash
        JOIN publication_current doc_pub
          ON doc_pub.object_type = 'document' AND doc_pub.object_id = d.id AND doc_pub.displayable
        JOIN legal_case citing_case ON citing_case.id = d.case_id AND citing_case.publication = 'published'
        JOIN publication_current case_pub
          ON case_pub.object_type = 'legal_case' AND case_pub.object_id = citing_case.id AND case_pub.displayable
        GROUP BY own.case_id
      ), upserted AS (
        INSERT INTO case_citation_count (case_id, cited, cited_on_jurvio, cited_by, refreshed_at)
        SELECT b.id, COALESCE(cited.n, 0), COALESCE(cited_on.n, 0), COALESCE(citing.n, 0), now()
        FROM batch b
        LEFT JOIN cited ON cited.case_id = b.id
        LEFT JOIN cited_on ON cited_on.case_id = b.id
        LEFT JOIN citing ON citing.case_id = b.id
        ON CONFLICT (case_id) DO UPDATE SET
          cited = EXCLUDED.cited,
          cited_on_jurvio = EXCLUDED.cited_on_jurvio,
          cited_by = EXCLUDED.cited_by,
          refreshed_at = EXCLUDED.refreshed_at
        RETURNING case_id
      )
      SELECT count(*)::int AS n FROM upserted
    `;
    return row?.n ?? 0;
  });
}

async function deleteStale(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    WITH removed AS (
      DELETE FROM case_citation_count stat
      WHERE NOT EXISTS (
        SELECT 1 FROM legal_case c
        JOIN publication_current pub
          ON pub.object_type = 'legal_case' AND pub.object_id = c.id AND pub.displayable
        WHERE c.id = stat.case_id AND c.publication = 'published'
      )
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM removed
  `;
  return row?.n ?? 0;
}
