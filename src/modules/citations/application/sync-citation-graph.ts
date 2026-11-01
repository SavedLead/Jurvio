import type postgres from "postgres";
import { CITATION_PARSER_VERSION, citationKey, extractCaseCitations, extractCourtListenerLinks, identityCitations } from "../domain/citations";
import { DIRTY_IN, DIRTY_OUT, markDirty } from "./citation-edges";
type Sql = ReturnType<typeof postgres>;

// postgres.js refuses statements with more than 65,534 bind parameters
// (MAX_PARAMETERS_EXCEEDED). A queue batch of cases with many opinion clusters,
// or of long opinions with thousands of citations, used to build one VALUES
// list with a parameter per column per row. Rows now go in as one array per
// column through unnest(), so a statement has 3 or 9 parameters whatever its
// size, and rows are still chunked to keep each statement bounded.
export const CITATION_ROWS_PER_STATEMENT = 5_000;

export function chunkRows<T>(rows: readonly T[], size = CITATION_ROWS_PER_STATEMENT): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a positive integer");
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

type IdentityRow = { case_id: string; citation_key: string; citation_label: string };
type DocumentCitationRow = {
  document_id: string; citation_key: string; citation_label: string; source_content_hash: string;
  source_artifact_id: string; location_kind: string; start_offset: number; end_offset: number; parser_version: string;
};

async function insertIdentities(tx: postgres.TransactionSql, rows: readonly IdentityRow[]): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    await tx`
      INSERT INTO case_citation_identity (case_id, citation_key, citation_label)
      SELECT * FROM unnest(
        ${chunk.map(r => r.case_id)}::uuid[],
        ${chunk.map(r => r.citation_key)}::text[],
        ${chunk.map(r => r.citation_label)}::text[]
      )
    `;
  }
}

async function insertDocumentCitations(tx: postgres.TransactionSql, rows: readonly DocumentCitationRow[]): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    await tx`
      INSERT INTO document_case_citation (
        document_id, citation_key, citation_label, source_content_hash, source_artifact_id,
        location_kind, start_offset, end_offset, parser_version
      )
      SELECT * FROM unnest(
        ${chunk.map(r => r.document_id)}::uuid[],
        ${chunk.map(r => r.citation_key)}::text[],
        ${chunk.map(r => r.citation_label)}::text[],
        ${chunk.map(r => r.source_content_hash)}::text[],
        ${chunk.map(r => r.source_artifact_id)}::uuid[],
        ${chunk.map(r => r.location_kind)}::text[],
        ${chunk.map(r => r.start_offset)}::int[],
        ${chunk.map(r => r.end_offset)}::int[],
        ${chunk.map(r => r.parser_version)}::text[]
      )
    `;
  }
}

/** Queue rows at or above this priority are live work (migration 0170). */
export const LIVE_CITATION_PRIORITY = 10;

export interface SyncCitationGraphOptions {
  /**
   * Only take queue rows with priority >= this value. The resident worker
   * passes LIVE_CITATION_PRIORITY for its live pass so new opinions never wait
   * behind the backfill; omitted, every row is eligible (highest priority first).
   */
  minPriority?: number;
  /** Only take rows with priority <= this value (builder backfill leaves live rows to the resident lane). */
  maxPriority?: number;
}

export async function syncCitationGraph(sql: Sql, limit: number, options: SyncCitationGraphOptions = {}) {
  const minPriority = options.minPriority ?? -32768;
  const maxPriority = options.maxPriority ?? 32767;
  // Lock queue rows for each transaction. Content changes arriving concurrently
  // either queue after the delete or are read in the next cycle; work is durable.
  const identities = await sql.begin(async tx => {
    const cases = await tx<{case_id: string}[]>`SELECT case_id FROM case_citation_work WHERE priority BETWEEN ${minPriority} AND ${maxPriority} ORDER BY priority DESC, queued_at, case_id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    if (!cases.length) return 0;
    const ids = cases.map(row => row.case_id);
    const records = await tx<{id: string; official_citation: string | null; citations: unknown; verified_labels:unknown; cluster_ids:string[]}[]>`
      SELECT c.id, c.official_citation,
        COALESCE((SELECT jsonb_agg(cl.citations) FROM opinion_cluster cl WHERE cl.case_id=c.id), '[]'::jsonb) AS citations,
        COALESCE((SELECT jsonb_agg(alias.citation_label) FROM case_citation_verified_alias alias WHERE alias.case_id=c.id), '[]'::jsonb) AS verified_labels,
        ARRAY(SELECT cl.provider_cluster_id FROM opinion_cluster cl JOIN provider p ON p.id=cl.provider_id WHERE cl.case_id=c.id AND p.code='courtlistener') AS cluster_ids
      FROM legal_case c WHERE c.id = ANY(${ids}::uuid[])
    `;
    const rows = records.flatMap(record => {
      const labels = identityCitations([record.official_citation, record.citations, record.verified_labels]);
      return [...new Map([...labels.map(label => [citationKey(label), label] as const),...record.cluster_ids.map(id=>[`cl-cluster:${id}`,`CourtListener opinion cluster ${id}`] as const)]).entries()].map(([key,label]) => ({case_id: record.id, citation_key: key, citation_label: label}));
    });
    const previous = await tx<{case_id: string; citation_key: string}[]>`DELETE FROM case_citation_identity WHERE case_id = ANY(${ids}::uuid[]) RETURNING case_id, citation_key`;
    await insertIdentities(tx, rows);
    // Precomputed edges (migration 0171): a case whose cite keys changed, and
    // every other holder of a changed key (uniqueness may have flipped), must
    // have its incoming edges rebuilt. Unchanged replays mark nothing.
    const before = new Set(previous.map(row => `${row.case_id}|${row.citation_key}`));
    const after = new Set(rows.map(row => `${row.case_id}|${row.citation_key}`));
    const changedKeys = new Set<string>();
    for (const pair of before) if (!after.has(pair)) changedKeys.add(pair.slice(pair.indexOf('|') + 1));
    for (const pair of after) if (!before.has(pair)) changedKeys.add(pair.slice(pair.indexOf('|') + 1));
    if (changedKeys.size) {
      const holders = await tx<{case_id: string}[]>`SELECT DISTINCT case_id FROM case_citation_identity WHERE citation_key = ANY(${[...changedKeys]}::text[])`;
      const changedCases = [...before, ...after].filter(pair => changedKeys.has(pair.slice(pair.indexOf('|') + 1))).map(pair => pair.slice(0, pair.indexOf('|')));
      await markDirty(tx, [...new Set([...holders.map(row => row.case_id), ...changedCases])], DIRTY_IN);
    }
    await tx`DELETE FROM case_citation_work WHERE case_id = ANY(${ids}::uuid[])`;
    return cases.length;
  });
  const documents = await sql.begin(async tx => {
    const queue = await tx<{document_id: string}[]>`SELECT document_id FROM document_citation_work WHERE priority BETWEEN ${minPriority} AND ${maxPriority} ORDER BY priority DESC, queued_at, document_id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    if (!queue.length) return 0;
    const ids = queue.map(row => row.document_id);
    const records = await tx<{document_id: string; content_text: string; content_html:string; content_hash: string; source_artifact_id: string}[]>`
      SELECT document_id, content_text, content_html, content_hash, source_artifact_id FROM document_content WHERE document_id = ANY(${ids}::uuid[])
    `;
    await tx`DELETE FROM document_case_citation WHERE document_id = ANY(${ids}::uuid[])`;
    for (const record of records) {
      const citations=[...extractCaseCitations(record.content_text).filter(cite=>!cite.ambiguous).map(cite=>({...cite,location:'text'})),...extractCourtListenerLinks(record.content_html).map(cite=>({...cite,location:'html'}))];
      const rows: DocumentCitationRow[] = citations.map(cite => ({
        document_id: record.document_id, citation_key: cite.key, citation_label: cite.label,
        source_content_hash: record.content_hash, source_artifact_id: record.source_artifact_id,
        location_kind:cite.location, start_offset: cite.start, end_offset: cite.end, parser_version: CITATION_PARSER_VERSION,
      }));
      await insertDocumentCitations(tx, rows);
      const missing = [...new Map(rows.map(row => [row.citation_key, row.citation_label])).entries()];
      if (missing.length) await tx`
        INSERT INTO missing_case_citation(citation_key, citation_label)
        SELECT key, label FROM jsonb_to_recordset(${tx.json(missing.map(([key,label])=>({key,label})))}) AS refs(key text,label text)
        WHERE NOT EXISTS(SELECT 1 FROM case_citation_identity i WHERE i.citation_key=refs.key)
        ON CONFLICT(citation_key) DO NOTHING
      `;
    }
    // The citing cases' outgoing edges change with their opinions' citations.
    const owners = await tx<{case_id: string}[]>`SELECT DISTINCT case_id FROM document WHERE id = ANY(${ids}::uuid[]) AND publication = 'published'`;
    await markDirty(tx, owners.map(row => row.case_id), DIRTY_OUT);
    await tx`DELETE FROM document_citation_work WHERE document_id = ANY(${ids}::uuid[])`;
    return queue.length;
  });
  return {identities, documents};
}
