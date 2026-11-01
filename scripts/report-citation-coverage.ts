import postgres from "postgres";
import { env } from "@/lib/config/env";
import { citationBacklog } from "@/modules/citations/application/citation-lane";
import { caseCitationCounts, liveRelatedCitationCases, precomputedEdgesReady, precomputedRelatedCases } from "@/modules/citations/application/public-citations";

// Read-only citation coverage report (ADR 0090, plan PR A4). The session is
// READ ONLY, so nothing here can write. Prints one JSON line per section:
//   {"coverage":"quick",...}  sizes, queues, edges, counts (cheap)
//   {"coverage":"full",...}   the exact linked-cite join (--full; minutes)
//   {"coverage":"probe",...}  list/count latency for --probe=<public ids>
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key!, raw];
}));
const probes = (args.get("probe") ?? "").split(",").map((id) => id.trim()).filter((id) => /^jv-[a-z0-9]{6,16}$/.test(id));
const sql = postgres(env().DATABASE_URL, { max: 1, connection: { application_name: "jurvio-citation-coverage" } });

async function optionalCount(table: string, where = "true"): Promise<number | null> {
  const [exists] = await sql<{ ok: boolean }[]>`SELECT to_regclass(${table}) IS NOT NULL AS ok`;
  if (!exists?.ok) return null;
  const [row] = await sql.unsafe<{ n: string }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`);
  return Number(row?.n ?? 0);
}

try {
  await sql`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`;
  await sql`SET default_transaction_read_only = on`;
  await sql`SELECT set_config('statement_timeout', '20min', false)`;

  const sizes = await sql<{ name: string; bytes: string }[]>`
    SELECT c.relname AS name, pg_total_relation_size(c.oid)::text AS bytes FROM pg_class c
    WHERE c.relkind = 'r' AND c.relname IN ('document_case_citation','case_citation_identity','missing_case_citation',
      'case_citation_count','case_citation_edge','courtlistener_citation_edge','courtlistener_citation_unresolved',
      'courtlistener_parenthetical','citation_stub_case','citation_dirty_case','document_citation_work','case_citation_work',
      'live_opinion_text','document_content','courtlistener_pending_cluster')`;
  const [db] = await sql<{ bytes: string }[]>`SELECT pg_database_size(current_database())::text AS bytes`;
  const backlog = await citationBacklog(sql);
  const ready = await precomputedEdgesReady(sql);
  const [edges] = await sql<Record<string, string | null>[]>`SELECT
    (SELECT count(*) FROM case_citation_edge)::text AS edges,
    (SELECT count(DISTINCT cited_case_id) FROM case_citation_edge)::text AS cases_cited_by,
    (SELECT count(DISTINCT citing_case_id) FROM case_citation_edge)::text AS cases_with_outgoing,
    (SELECT count(*) FROM case_citation_edge WHERE sources = 1)::text AS jurvio_only,
    (SELECT count(*) FROM case_citation_edge WHERE sources = 2)::text AS courtlistener_only,
    (SELECT count(*) FROM case_citation_edge WHERE sources = 3)::text AS both,
    (SELECT count(*) FROM citation_dirty_case)::text AS dirty,
    (SELECT row_to_json(b)::text FROM citation_edge_build b) AS build`.catch(() => [{ edges: null }]);
  const [counts] = await sql<Record<string, string>[]>`SELECT
    count(*)::text AS rows, count(*) FILTER (WHERE cited_by > 0)::text AS cited_by_positive,
    count(*) FILTER (WHERE cited_on_jurvio > 0)::text AS cites_jurvio_case, max(refreshed_at)::text AS newest
    FROM case_citation_count`;
  const [published] = await sql<Record<string, string>[]>`SELECT
    (SELECT count(*) FROM legal_case WHERE publication = 'published')::text AS published_cases,
    GREATEST((SELECT reltuples FROM pg_class WHERE oid = 'document_content'::regclass), 0)::bigint::text AS document_content_estimate,
    GREATEST((SELECT reltuples FROM pg_class WHERE oid = 'document_case_citation'::regclass), 0)::bigint::text AS citation_mentions_estimate`;
  const courtlistener = {
    citation_edges: await optionalCount("courtlistener_citation_edge"),
    unresolved_edges: await optionalCount("courtlistener_citation_unresolved"),
    parentheticals: await optionalCount("courtlistener_parenthetical"),
    stubs: await optionalCount("citation_stub_case"),
    stubs_linkable: await optionalCount("citation_stub_case", "NOT restricted"),
    import_runs: await optionalCount("courtlistener_citation_import"),
  };
  const liveText = {
    tracked: await optionalCount("live_opinion_text"),
    extracted: await optionalCount("live_opinion_text", "state = 'extracted'"),
    failed: await optionalCount("live_opinion_text", "state = 'failed'"),
    pending: await optionalCount("live_opinion_text", "state = 'pending'"),
  };
  const lanes = await sql`
    SELECT DISTINCT ON (lane) lane, ok, exit_code, round(duration_ms / 1000.0) AS seconds,
      to_char(finished_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI') AS finished_et
    FROM scheduler_lane_run
    WHERE lane IN ('case-citation-graph','citation-edges','cited-case-bulk-resolution','live-opinion-text','citation-nightly')
    ORDER BY lane, started_at DESC`.catch(() => []);
  console.log(JSON.stringify({
    coverage: "quick", database_bytes: Number(db?.bytes ?? 0),
    table_bytes: Object.fromEntries(sizes.map((s) => [s.name, Number(s.bytes)])),
    backlog, precomputed_lists_ready: ready, edges, counts, published, courtlistener, live_text: liveText, lanes,
  }));

  if (args.has("full")) {
    const [links] = await sql`
      WITH visible AS MATERIALIZED (
        SELECT d.id, d.case_id, content.content_hash FROM document d
        JOIN legal_case c ON c.id = d.case_id
        JOIN document_content content ON content.document_id = d.id
        JOIN publication_current pc ON pc.object_type = 'legal_case' AND pc.object_id = c.id AND pc.displayable
        JOIN publication_current pd ON pd.object_type = 'document' AND pd.object_id = d.id AND pd.displayable
        WHERE d.publication = 'published' AND c.publication = 'published'
      ), refs AS MATERIALIZED (
        SELECT ref.document_id, v.case_id AS source_case, ref.citation_key, ref.location_kind FROM visible v
        JOIN document_case_citation ref ON ref.document_id = v.id AND ref.source_content_hash = v.content_hash
      ), targets AS MATERIALIZED (
        SELECT u.citation_key, u.case_id FROM unique_case_citation u
        JOIN legal_case t ON t.id = u.case_id AND t.publication = 'published'
        JOIN publication_current pt ON pt.object_type = 'legal_case' AND pt.object_id = t.id AND pt.displayable
      ), linked AS MATERIALIZED (
        SELECT r.document_id, r.source_case, r.citation_key, t.case_id AS target_case FROM refs r
        JOIN targets t ON t.citation_key = r.citation_key WHERE t.case_id <> r.source_case
      )
      SELECT (SELECT count(*) FROM visible) AS published_opinions,
        (SELECT count(DISTINCT document_id) FROM refs) AS opinions_with_citations,
        (SELECT count(*) FROM refs WHERE location_kind = 'text') AS citation_mentions,
        (SELECT count(DISTINCT citation_key) FROM refs WHERE location_kind = 'text') AS distinct_cited,
        (SELECT count(DISTINCT citation_key) FROM linked) AS distinct_cited_and_linked,
        (SELECT count(*) FROM linked) AS linked_mentions,
        (SELECT count(DISTINCT target_case) FROM linked) AS cases_linked_to,
        (SELECT count(DISTINCT source_case) FROM linked) AS cases_with_outgoing_links`;
    console.log(JSON.stringify({ coverage: "full", ...links }));
  }

  for (const id of probes) {
    const time = async <T>(fn: () => Promise<T>) => {
      const started = performance.now();
      const value = await fn();
      return { ms: Math.round(performance.now() - started), value };
    };
    const live = await time(() => liveRelatedCitationCases(sql, id, "citing"));
    const pre = ready ? await time(() => precomputedRelatedCases(sql, id, "citing")) : null;
    const preCited = ready ? await time(() => precomputedRelatedCases(sql, id, "cited")) : null;
    const count = await time(() => caseCitationCounts(sql, id));
    console.log(JSON.stringify({
      coverage: "probe", case: id,
      live_citing_ms: live.ms, live_citing_rows: live.value.length,
      precomputed_citing_ms: pre?.ms ?? null, precomputed_citing_rows: pre?.value.length ?? null,
      precomputed_cited_ms: preCited?.ms ?? null, precomputed_cited_rows: preCited?.value.length ?? null,
      counts_ms: count.ms, counts: count.value,
    }));
  }
} finally {
  await sql.end();
}
