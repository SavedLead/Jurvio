import type { Readable } from "node:stream";
import type { Sql } from "postgres";
import { activeSessions } from "./citation-lane";

/**
 * CourtListener bulk citation map + parentheticals import (ADR 0090, plan C8).
 *
 * Runs on a builder runner (scripts/import-courtlistener-citation-map.ts) and
 * streams the bz2 exports straight from the public bulk bucket; the DB server
 * only sees throttled batch INSERTs. Phases, each resumable and idempotent:
 *
 *   edges          citation-map rows with a Jurvio citing opinion. Both ends
 *                  held -> courtlistener_citation_edge; cited end not held ->
 *                  courtlistener_citation_unresolved.
 *   parentheticals parentheticals written by a Jurvio opinion.
 *   clusters       one pass of the opinions export mapping just the cited
 *                  opinion ids still unresolved to their CL cluster.
 *   finalize       unresolved rows whose cluster Jurvio holds become edges;
 *                  parentheticals get their cited case; rows from older
 *                  snapshots are dropped; the edge builder is asked to sweep.
 */

export const CITATION_MAP_PHASES = ["edges", "parentheticals", "clusters", "finalize"] as const;
export type CitationMapPhase = (typeof CITATION_MAP_PHASES)[number];

export interface ImportThrottle {
  batch: number;
  pauseMs: number;
  maxActive: number;
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Immutable sorted set of positive int32 ids: ~4 bytes per id instead of a JS Set's ~40. */
export class SortedIdSet {
  readonly ids: Int32Array;
  constructor(values: Iterable<number> | Int32Array) {
    const raw = values instanceof Int32Array ? Int32Array.from(values) : Int32Array.from(values);
    raw.sort();
    let size = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const value = raw[index]!;
      if (value > 0 && (size === 0 || raw[size - 1] !== value)) raw[size++] = value;
    }
    this.ids = raw.slice(0, size);
  }
  get size(): number { return this.ids.length; }
  has(value: number): boolean {
    let low = 0;
    let high = this.ids.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const found = this.ids[middle]!;
      if (found === value) return true;
      if (found < value) low = middle + 1; else high = middle - 1;
    }
    return false;
  }
}

/** Grows an Int32Array without boxing every id in a JS array. */
export class IdCollector {
  private buffer = new Int32Array(1 << 16);
  private length = 0;
  push(value: number) {
    if (this.length === this.buffer.length) {
      const next = new Int32Array(this.buffer.length * 2);
      next.set(this.buffer);
      this.buffer = next;
    }
    this.buffer[this.length++] = value;
  }
  toSet(): SortedIdSet { return new SortedIdSet(this.buffer.subarray(0, this.length)); }
}

const INT32_ID = /^[1-9][0-9]{0,9}$/;
export function parseId(value: string | undefined): number | null {
  if (!value || !INT32_ID.test(value)) return null;
  const id = Number(value);
  return id <= 2_147_483_647 ? id : null;
}

async function courtListenerProviderId(sql: Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
  if (!row) throw new Error("courtlistener provider row is missing");
  return row.id;
}

/** Every CourtListener opinion id Jurvio holds as a document (streamed with a cursor). */
export async function loadHeldOpinionIds(sql: Sql): Promise<SortedIdSet> {
  const provider = await courtListenerProviderId(sql);
  const collector = new IdCollector();
  await sql`SELECT provider_opinion_id AS id FROM judicial_opinion
    WHERE provider_id = ${provider} AND provider_opinion_id ~ '^[1-9][0-9]{0,9}$'`
    .cursor(20_000, (rows) => { for (const row of rows) { const id = parseId(row.id as string); if (id) collector.push(id); } });
  return collector.toSet();
}

async function throttle(sql: Sql, plan: ImportThrottle) {
  const sleep = plan.sleep ?? defaultSleep;
  if (plan.pauseMs > 0) await sleep(plan.pauseMs);
  for (let waited = 0; waited < 20 && (await activeSessions(sql)) > plan.maxActive; waited += 1) await sleep(3_000);
}

export async function recordProgress(sql: Sql, snapshot: string, phase: CitationMapPhase, rowsRead: number,
  stats: Record<string, number | string | boolean>, completed = false) {
  await sql`INSERT INTO courtlistener_citation_import (snapshot_date, phase, rows_read, stats, completed_at)
    VALUES (${snapshot}, ${phase}, ${rowsRead}, ${sql.json(stats)}, ${completed ? sql`now()` : null})
    ON CONFLICT (snapshot_date, phase) DO UPDATE SET rows_read = EXCLUDED.rows_read, stats = EXCLUDED.stats,
      updated_at = now(), completed_at = EXCLUDED.completed_at`;
}

export async function importProgress(sql: Sql, snapshot: string, phase: CitationMapPhase) {
  const [row] = await sql<{ rows_read: string; completed_at: Date | null; stats: Record<string, number> }[]>`
    SELECT rows_read::text, completed_at, stats FROM courtlistener_citation_import
    WHERE snapshot_date = ${snapshot} AND phase = ${phase}`;
  return row ? { rowsRead: Number(row.rows_read), completed: row.completed_at !== null, stats: row.stats } : null;
}

export interface EdgeImportStats {
  rowsRead: number;
  citingHeld: number;
  bothHeld: number;
  citedNotHeld: number;
  edgesWritten: number;
  unresolvedWritten: number;
  batches: number;
  resumedFrom: number;
  stoppedEarly: boolean;
}

/**
 * Phase "edges". `records` yields the citation-map rows in file order
 * (`id,depth,cited_opinion_id,citing_opinion_id`). Resumes after `rows_read`
 * from the progress row; dryRun only counts.
 */
export async function importCitationMap(sql: Sql, records: AsyncIterable<Record<string, string>>, options: {
  snapshot: string; held: SortedIdSet; dryRun: boolean; throttle: ImportThrottle; resume?: boolean;
}): Promise<EdgeImportStats> {
  const { held, snapshot, dryRun } = options;
  const plan = options.throttle;
  const now = plan.now ?? Date.now;
  const provider = await courtListenerProviderId(sql);
  const previous = options.resume === false || dryRun ? null : await importProgress(sql, snapshot, "edges");
  const skip = previous && !previous.completed ? previous.rowsRead : 0;
  const stats: EdgeImportStats = { rowsRead: 0, citingHeld: 0, bothHeld: 0, citedNotHeld: 0, edgesWritten: 0,
    unresolvedWritten: 0, batches: 0, resumedFrom: skip, stoppedEarly: false };
  if (previous?.completed && !dryRun) return { ...stats, rowsRead: previous.rowsRead };
  let citing: number[] = [];
  let cited: number[] = [];
  let depth: number[] = [];
  const flush = async () => {
    if (!citing.length) return;
    if (!dryRun) {
      const [written] = await sql<{ edges: number; unresolved: number }[]>`
        WITH r AS (
          SELECT * FROM unnest(${citing}::int[], ${cited}::int[], ${depth}::int[]) AS r(citing, cited, depth)
        ), m AS (
          SELECT cj.document_id AS citing_doc, r.cited, td.case_id AS cited_case, LEAST(r.depth, 32767) AS depth
          FROM r
          JOIN judicial_opinion cj ON cj.provider_id = ${provider} AND cj.provider_opinion_id = r.citing::text
          JOIN document cd ON cd.id = cj.document_id
          LEFT JOIN judicial_opinion tj ON tj.provider_id = ${provider} AND tj.provider_opinion_id = r.cited::text
          LEFT JOIN document td ON td.id = tj.document_id
          -- Opinions of one case citing each other (a dissent citing the majority) are not edges.
          WHERE td.case_id IS DISTINCT FROM cd.case_id
        ), edges AS (
          INSERT INTO courtlistener_citation_edge AS t (citing_document_id, cited_case_id, depth, snapshot_date)
          SELECT citing_doc, cited_case, max(depth)::smallint, ${snapshot}::date FROM m
          WHERE cited_case IS NOT NULL GROUP BY citing_doc, cited_case
          ON CONFLICT (citing_document_id, cited_case_id) DO UPDATE SET
            depth = CASE WHEN t.snapshot_date = EXCLUDED.snapshot_date THEN GREATEST(t.depth, EXCLUDED.depth) ELSE EXCLUDED.depth END,
            snapshot_date = EXCLUDED.snapshot_date
          RETURNING 1
        ), unresolved AS (
          INSERT INTO courtlistener_citation_unresolved AS t (citing_document_id, cited_opinion_id, depth, snapshot_date)
          SELECT citing_doc, cited, max(depth)::smallint, ${snapshot}::date FROM m
          WHERE cited_case IS NULL GROUP BY citing_doc, cited
          ON CONFLICT (citing_document_id, cited_opinion_id) DO UPDATE SET depth = EXCLUDED.depth, snapshot_date = EXCLUDED.snapshot_date
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM edges)::int AS edges, (SELECT count(*) FROM unresolved)::int AS unresolved`;
      stats.edgesWritten += written?.edges ?? 0;
      stats.unresolvedWritten += written?.unresolved ?? 0;
      await recordProgress(sql, snapshot, "edges", stats.rowsRead, statsJson(stats));
      await throttle(sql, plan);
    }
    stats.batches += 1;
    citing = []; cited = []; depth = [];
  };

  for await (const record of records) {
    stats.rowsRead += 1;
    if (stats.rowsRead <= skip) continue;
    const citingId = parseId(record.citing_opinion_id);
    const citedId = parseId(record.cited_opinion_id);
    if (!citingId || !citedId || citingId === citedId || !held.has(citingId)) continue;
    stats.citingHeld += 1;
    if (held.has(citedId)) stats.bothHeld += 1; else stats.citedNotHeld += 1;
    citing.push(citingId);
    cited.push(citedId);
    depth.push(Math.max(1, Math.min(32767, Number.parseInt(record.depth ?? "1", 10) || 1)));
    if (citing.length >= plan.batch) {
      await flush();
      if (now() >= plan.deadline) { stats.stoppedEarly = true; break; }
    }
  }
  if (!stats.stoppedEarly) {
    await flush();
    if (!dryRun) await recordProgress(sql, snapshot, "edges", stats.rowsRead, statsJson(stats), true);
  }
  return stats;
}

function statsJson(stats: object): Record<string, number | string | boolean> {
  return Object.fromEntries(Object.entries(stats).filter(([, value]) => ["number", "string", "boolean"].includes(typeof value)));
}

export interface ParentheticalImportStats {
  rowsRead: number;
  citingHeld: number;
  written: number;
  batches: number;
  resumedFrom: number;
  stoppedEarly: boolean;
}

const MAX_PARENTHETICAL = 2_000;

/** Phase "parentheticals": `id,text,score,described_opinion_id,describing_opinion_id,group_id`. */
export async function importParentheticals(sql: Sql, records: AsyncIterable<Record<string, string>>, options: {
  snapshot: string; held: SortedIdSet; dryRun: boolean; throttle: ImportThrottle; resume?: boolean;
}): Promise<ParentheticalImportStats> {
  const { held, snapshot, dryRun } = options;
  const plan = options.throttle;
  const now = plan.now ?? Date.now;
  const provider = await courtListenerProviderId(sql);
  const previous = options.resume === false || dryRun ? null : await importProgress(sql, snapshot, "parentheticals");
  const skip = previous && !previous.completed ? previous.rowsRead : 0;
  const stats: ParentheticalImportStats = { rowsRead: 0, citingHeld: 0, written: 0, batches: 0, resumedFrom: skip, stoppedEarly: false };
  if (previous?.completed && !dryRun) return { ...stats, rowsRead: previous.rowsRead };
  let ids: string[] = []; let texts: string[] = []; let scores: (number | null)[] = [];
  let described: number[] = []; let describing: number[] = []; let groups: (number | null)[] = [];
  const flush = async () => {
    if (!ids.length) return;
    if (!dryRun) {
      const [written] = await sql<{ n: number }[]>`
        WITH r AS (
          SELECT * FROM unnest(${ids}::bigint[], ${texts}::text[], ${scores as number[]}::real[], ${described}::int[],
            ${describing}::int[], ${groups as number[]}::int[]) AS r(id, text, score, described, describing, group_id)
        ), ins AS (
          INSERT INTO courtlistener_parenthetical AS t (id, citing_document_id, described_opinion_id, cited_case_id, text, score, group_id, snapshot_date)
          SELECT r.id, cj.document_id, r.described,
            COALESCE(td.case_id, (SELECT oc.case_id FROM courtlistener_opinion_cluster_map map
              JOIN opinion_cluster oc ON oc.provider_id = ${provider} AND oc.provider_cluster_id = map.cluster_id::text
              WHERE map.opinion_id = r.described)),
            r.text, r.score, r.group_id, ${snapshot}::date
          FROM r
          JOIN judicial_opinion cj ON cj.provider_id = ${provider} AND cj.provider_opinion_id = r.describing::text
          LEFT JOIN judicial_opinion tj ON tj.provider_id = ${provider} AND tj.provider_opinion_id = r.described::text
          LEFT JOIN document td ON td.id = tj.document_id
          ON CONFLICT (id) DO UPDATE SET citing_document_id = EXCLUDED.citing_document_id,
            described_opinion_id = EXCLUDED.described_opinion_id, cited_case_id = EXCLUDED.cited_case_id,
            text = EXCLUDED.text, score = EXCLUDED.score, group_id = EXCLUDED.group_id, snapshot_date = EXCLUDED.snapshot_date
          RETURNING 1
        ) SELECT count(*)::int AS n FROM ins`;
      stats.written += written?.n ?? 0;
      await recordProgress(sql, snapshot, "parentheticals", stats.rowsRead, statsJson(stats));
      await throttle(sql, plan);
    }
    stats.batches += 1;
    ids = []; texts = []; scores = []; described = []; describing = []; groups = [];
  };
  for await (const record of records) {
    stats.rowsRead += 1;
    if (stats.rowsRead <= skip) continue;
    const describingId = parseId(record.describing_opinion_id);
    const describedId = parseId(record.described_opinion_id);
    const text = (record.text ?? "").replace(/\s+/g, " ").trim();
    if (!describingId || !describedId || !text || !/^[0-9]{1,18}$/.test(record.id ?? "") || !held.has(describingId)) continue;
    stats.citingHeld += 1;
    ids.push(record.id!);
    texts.push(text.slice(0, MAX_PARENTHETICAL));
    const score = Number.parseFloat(record.score ?? "");
    scores.push(Number.isFinite(score) ? score : null);
    described.push(describedId);
    describing.push(describingId);
    groups.push(parseId(record.group_id));
    if (ids.length >= plan.batch) {
      await flush();
      if (now() >= plan.deadline) { stats.stoppedEarly = true; break; }
    }
  }
  if (!stats.stoppedEarly) {
    await flush();
    if (!dryRun) await recordProgress(sql, snapshot, "parentheticals", stats.rowsRead, statsJson(stats), true);
  }
  return stats;
}

/** Cited opinion ids the edges/parentheticals phases could not map to a Jurvio case. */
export async function loadUnmappedOpinionIds(sql: Sql): Promise<SortedIdSet> {
  const collector = new IdCollector();
  await sql`SELECT DISTINCT cited_opinion_id AS id FROM courtlistener_citation_unresolved u
    WHERE NOT EXISTS (SELECT 1 FROM courtlistener_opinion_cluster_map m WHERE m.opinion_id = u.cited_opinion_id)`
    .cursor(50_000, (rows) => { for (const row of rows) collector.push(Number(row.id)); });
  await sql`SELECT DISTINCT described_opinion_id AS id FROM courtlistener_parenthetical p WHERE cited_case_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM courtlistener_opinion_cluster_map m WHERE m.opinion_id = p.described_opinion_id)`
    .cursor(50_000, (rows) => { for (const row of rows) collector.push(Number(row.id)); });
  return collector.toSet();
}

/**
 * Streaming scan of the opinions export that yields only `[id, cluster_id]`.
 * The export carries several huge HTML/text columns, so instead of building
 * every field this keeps only the first column and the one named `cluster_id`
 * (same dialect as parseBulkCsvRecords: `"` toggles quoting, backslash escapes).
 */
export async function* scanOpinionClusterIds(stream: Readable): AsyncGenerator<[number, number]> {
  stream.setEncoding("utf8");
  let headerDone = false;
  let header: string[] = [];
  let headerField = "";
  let clusterColumn = -1;
  let column = 0;
  let quoted = false;
  let escaped = false;
  let first = "";
  let cluster = "";
  const quotedSpecial = /["\\]/g;
  const plainSpecial = /[",\n]/g;
  for await (const chunk of stream) {
    const text = chunk as string;
    let index = 0;
    while (index < text.length) {
      if (escaped) { escaped = false; index += 1; continue; }
      const special = quoted ? quotedSpecial : plainSpecial;
      special.lastIndex = index;
      const found = special.exec(text);
      const end = found ? found.index : text.length;
      if (!headerDone) headerField += text.slice(index, end);
      else if (column === 0) first += text.slice(index, end);
      else if (column === clusterColumn) cluster += text.slice(index, end);
      if (!found) break;
      index = end + 1;
      const character = found[0];
      if (character === "\\") { escaped = true; continue; }
      if (character === '"') { quoted = !quoted; continue; }
      if (character === ",") {
        if (!headerDone) { header.push(headerField); headerField = ""; }
        column += 1;
        continue;
      }
      // newline: end of row
      if (!headerDone) {
        header.push(headerField.replace(/\r$/, ""));
        clusterColumn = header.indexOf("cluster_id");
        if (clusterColumn < 1) throw new Error("opinions export has no cluster_id column after id");
        headerDone = true;
        header = [];
      } else {
        const id = parseId(first);
        const clusterId = parseId(cluster.replace(/\r$/, ""));
        if (id && clusterId) yield [id, clusterId];
      }
      column = 0; first = ""; cluster = "";
    }
  }
  if (headerDone && first) {
    const id = parseId(first);
    const clusterId = parseId(cluster.replace(/\r$/, ""));
    if (id && clusterId) yield [id, clusterId];
  }
}

export interface ClusterMapStats { rowsRead: number; matched: number; written: number; needed: number; stoppedEarly: boolean }

/** Phase "clusters": map the still-unmapped cited opinion ids to CL cluster ids. */
export async function importOpinionClusterMap(sql: Sql, pairs: AsyncIterable<[number, number]>, options: {
  snapshot: string; needed: SortedIdSet; dryRun: boolean; throttle: ImportThrottle;
}): Promise<ClusterMapStats> {
  const plan = options.throttle;
  const now = plan.now ?? Date.now;
  const stats: ClusterMapStats = { rowsRead: 0, matched: 0, written: 0, needed: options.needed.size, stoppedEarly: false };
  let opinions: number[] = []; let clusters: number[] = [];
  const flush = async () => {
    if (!opinions.length) return;
    if (!options.dryRun) {
      const rows = await sql`INSERT INTO courtlistener_opinion_cluster_map (opinion_id, cluster_id, snapshot_date)
        SELECT * , ${options.snapshot}::date FROM unnest(${opinions}::int[], ${clusters}::int[])
        ON CONFLICT (opinion_id) DO UPDATE SET cluster_id = EXCLUDED.cluster_id, snapshot_date = EXCLUDED.snapshot_date
        RETURNING 1`;
      stats.written += rows.length;
      await recordProgress(sql, options.snapshot, "clusters", stats.rowsRead, statsJson(stats));
      await throttle(sql, plan);
    }
    opinions = []; clusters = [];
  };
  for await (const [opinion, cluster] of pairs) {
    stats.rowsRead += 1;
    if (!options.needed.has(opinion)) {
      if ((stats.rowsRead & 0xffff) === 0 && now() >= plan.deadline) { stats.stoppedEarly = true; break; }
      continue;
    }
    stats.matched += 1;
    opinions.push(opinion); clusters.push(cluster);
    if (opinions.length >= plan.batch) await flush();
  }
  await flush();
  if (!options.dryRun) await recordProgress(sql, options.snapshot, "clusters", stats.rowsRead, statsJson(stats), !stats.stoppedEarly);
  return stats;
}

export interface FinalizeStats { movedToEdges: number; parentheticalsMapped: number; staleEdges: number; staleUnresolved: number; staleParentheticals: number; batches: number; stoppedEarly: boolean }

/**
 * Phase "finalize": promote unresolved rows whose cited cluster Jurvio holds,
 * map parentheticals, drop rows from older snapshots (only once this snapshot's
 * edges phase completed) and ask the edge builder for a sweep.
 */
export async function finalizeCitationMap(sql: Sql, options: { snapshot: string; throttle: ImportThrottle; dryRun: boolean }): Promise<FinalizeStats> {
  const plan = options.throttle;
  const now = plan.now ?? Date.now;
  const provider = await courtListenerProviderId(sql);
  const stats: FinalizeStats = { movedToEdges: 0, parentheticalsMapped: 0, staleEdges: 0, staleUnresolved: 0, staleParentheticals: 0, batches: 0, stoppedEarly: false };
  if (options.dryRun) {
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM courtlistener_citation_unresolved u
      JOIN courtlistener_opinion_cluster_map m ON m.opinion_id = u.cited_opinion_id
      JOIN opinion_cluster oc ON oc.provider_id = ${provider} AND oc.provider_cluster_id = m.cluster_id::text`;
    stats.movedToEdges = row?.n ?? 0;
    return stats;
  }
  let cursor = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const [step] = await sql<{ last: string | null; moved: number }[]>`
      WITH docs AS (
        SELECT DISTINCT citing_document_id FROM courtlistener_citation_unresolved
        WHERE citing_document_id > ${cursor}::uuid ORDER BY citing_document_id LIMIT ${plan.batch}
      ), hit AS (
        SELECT u.citing_document_id, u.cited_opinion_id, u.depth, oc.case_id
        FROM courtlistener_citation_unresolved u
        JOIN docs USING (citing_document_id)
        JOIN courtlistener_opinion_cluster_map m ON m.opinion_id = u.cited_opinion_id
        JOIN opinion_cluster oc ON oc.provider_id = ${provider} AND oc.provider_cluster_id = m.cluster_id::text
      ), ins AS (
        INSERT INTO courtlistener_citation_edge AS t (citing_document_id, cited_case_id, depth, snapshot_date)
        SELECT citing_document_id, case_id, max(depth), ${options.snapshot}::date FROM hit
        WHERE NOT EXISTS (SELECT 1 FROM document d WHERE d.id = hit.citing_document_id AND d.case_id = hit.case_id)
        GROUP BY citing_document_id, case_id
        ON CONFLICT (citing_document_id, cited_case_id) DO UPDATE SET depth = GREATEST(t.depth, EXCLUDED.depth), snapshot_date = EXCLUDED.snapshot_date
        RETURNING 1
      ), del AS (
        DELETE FROM courtlistener_citation_unresolved u USING hit
        WHERE u.citing_document_id = hit.citing_document_id AND u.cited_opinion_id = hit.cited_opinion_id
        RETURNING 1
      )
      SELECT (SELECT max(citing_document_id::text) FROM docs) AS last, (SELECT count(*) FROM del)::int AS moved,
        (SELECT count(*) FROM ins)::int AS inserted`;
    stats.batches += 1;
    stats.movedToEdges += step?.moved ?? 0;
    if (!step?.last) break;
    cursor = step.last;
    await throttle(sql, plan);
    if (now() >= plan.deadline) { stats.stoppedEarly = true; break; }
  }
  if (!stats.stoppedEarly) {
    const mapped = await sql`UPDATE courtlistener_parenthetical p SET cited_case_id = oc.case_id
      FROM courtlistener_opinion_cluster_map m
      JOIN opinion_cluster oc ON oc.provider_id = ${provider} AND oc.provider_cluster_id = m.cluster_id::text
      WHERE p.cited_case_id IS NULL AND m.opinion_id = p.described_opinion_id RETURNING 1`;
    stats.parentheticalsMapped = mapped.length;
    const edgesDone = await importProgress(sql, options.snapshot, "edges");
    if (edgesDone?.completed) {
      stats.staleEdges = (await sql`DELETE FROM courtlistener_citation_edge WHERE snapshot_date < ${options.snapshot}::date RETURNING 1`).length;
      stats.staleUnresolved = (await sql`DELETE FROM courtlistener_citation_unresolved WHERE snapshot_date < ${options.snapshot}::date RETURNING 1`).length;
    }
    const parentheticalsDone = await importProgress(sql, options.snapshot, "parentheticals");
    if (parentheticalsDone?.completed) {
      stats.staleParentheticals = (await sql`DELETE FROM courtlistener_parenthetical WHERE snapshot_date < ${options.snapshot}::date RETURNING 1`).length;
    }
    await requestEdgeSweep(sql);
    await recordProgress(sql, options.snapshot, "finalize", stats.batches, statsJson(stats), true);
  }
  return stats;
}

/** The precomputed edge builder (0171) rebuilds every case on its next run. */
export async function requestEdgeSweep(sql: Sql) {
  await sql`UPDATE citation_edge_build SET sweep_requested_at = now() WHERE id`;
}
