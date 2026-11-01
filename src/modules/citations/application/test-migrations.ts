import { readFile } from "node:fs/promises";
import type postgres from "postgres";
import { splitMigrationChunks } from "../../../../scripts/migration-chunks.js";

type Sql = ReturnType<typeof postgres>;

/**
 * Integration-test helper: apply migration files the way scripts/migrate.ts does
 * (each `-- @commit` chunk is its own simple-protocol query), so a file with
 * CREATE INDEX CONCURRENTLY works inside a per-test schema.
 */
export async function applyMigrations(sql: Sql, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const source = await readFile(`db/migrations/${name}`, "utf8");
    for (const chunk of splitMigrationChunks(source)) await sql.unsafe(chunk);
  }
}

/** Citation migrations after 0122 that the worker code now depends on. */
export const CITATION_WEB_MIGRATIONS = ["0170_citation_work_priority.sql"] as const;

/**
 * A throwaway schema with the citation tables and small builders, for
 * integration tests. Call `drop()` in finally.
 */
export async function citationTestSchema(sql: Sql, prefix: string, extra: readonly string[] = CITATION_WEB_MIGRATIONS) {
  const schema = `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
  await sql.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
  for (const name of ["0001_foundation.sql", "0010_opinion_research.sql"]) {
    const source = await readFile(`db/migrations/${name}`, "utf8");
    await sql.unsafe(source.replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", ""));
  }
  await sql`ALTER TABLE legal_case ADD COLUMN official_citation text, ADD COLUMN decided_on date`;
  for (const name of [
    "0114_case_citation_graph.sql",
    "0115_citation_reporter_refresh.sql",
    "0119_citation_publication_hold_rule_version.sql",
    "0122_missing_citation_bulk_resolution.sql",
    "0129_case_citation_count.sql",
  ]) {
    await applyMigrations(sql, [name]);
  }
  await applyMigrations(sql, extra);
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code='courtlistener'`;
  const [artifact] = await sql<{ id: string }[]>`INSERT INTO raw_artifact(provider_id,source_uri,content_hash,object_key,media_type,retrieved_at)
    VALUES(${provider!.id},${`https://example.test/${schema}`},${"c".repeat(64)},'fixture','application/json',now()) RETURNING id`;
  const [court] = await sql<{ id: string }[]>`INSERT INTO court(public_id,name,verification) VALUES('jc-fixture1','Fixture Court','verified') RETURNING id`;
  let n = 0;
  const decide = async (objectType: "legal_case" | "document", id: string, displayable: boolean) => {
    await sql`INSERT INTO publication_decision(object_type,object_id,displayable,indexable,machine_accessible,downloadable,summary_eligible,reason_code,rule_version)
      VALUES(${objectType},${id},${displayable},${displayable},${displayable},false,false,'fixture','v1')`;
  };
  return {
    schema,
    providerId: provider!.id,
    artifactId: artifact!.id,
    courtId: court!.id,
    decide,
    async addCase(publicId: string, citation: string | null, caption: string, options: { publication?: string; displayable?: boolean; docket?: string } = {}) {
      const [row] = await sql<{ id: string }[]>`INSERT INTO legal_case(public_id,court_id,docket_number,caption,publication,verification,official_citation)
        VALUES(${publicId},${court!.id},${options.docket ?? publicId},${caption},${options.publication ?? "published"},'verified',${citation}) RETURNING id`;
      await decide("legal_case", row!.id, options.displayable ?? true);
      return row!.id;
    },
    async addOpinion(caseId: string, text: string, options: { publication?: string; displayable?: boolean; filedOn?: string } = {}) {
      n++;
      const hash = `h-${n}-${text.length}`;
      const [doc] = await sql<{ id: string }[]>`INSERT INTO document(public_id,case_id,document_type,title,publication,content_hash,filed_on)
        VALUES(${`jd-fx${String(n).padStart(6, "0")}`},${caseId},'judicial_opinion','Opinion',${options.publication ?? "published"},${hash},${options.filedOn ?? null}) RETURNING id`;
      await decide("document", doc!.id, options.displayable ?? true);
      await sql`INSERT INTO document_content(document_id,content_html,content_text,content_hash,extraction_method,word_count,source_artifact_id)
        VALUES(${doc!.id},'<p></p>',${text},${hash},'fixture',1,${artifact!.id})`;
      return doc!.id;
    },
    async drop() {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    },
  };
}
