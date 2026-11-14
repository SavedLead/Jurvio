import postgres from "postgres";
import { env } from "@/lib/config/env";
import { initialsFor } from "@/modules/privacy/domain/redact-names";
import { scrubRedactionLog } from "@/modules/privacy/domain/scrub-redaction-log";
import { pagesToRefresh } from "@/lib/http/refresh-public-pages";

// Ingestion-host admin for privacy redactions. Does not print contact details.
//   node jobs/redaction-admin.mjs preview --name "Given Surname"
//   node jobs/redaction-admin.mjs apply --confirm APPLY_REDACTION --name "Given Surname" --label "privacy request"
const args = process.argv.slice(2);
const command = process.env.REDACTION_MODE || args[0];
const names = (process.env.REDACTION_NAMES ?? "").split("|").map((name) => name.trim()).filter(Boolean);
let label = process.env.REDACTION_LABEL || "privacy request";
let confirm = process.env.REDACTION_MODE === "apply" ? "APPLY_REDACTION" : "";
for (let i = 1; i < args.length; i += 1) {
  const arg = args[i] ?? "";
  if (arg === "--name") names.push(args[++i] ?? "");
  else if (arg === "--label") label = args[++i] ?? label;
  else if (arg === "--confirm") confirm = args[++i] ?? "";
}

if ((command !== "preview" && command !== "apply") || names.length === 0 || names.some((name) => name.trim().split(/\s+/).length < 2)) {
  console.error("usage: redaction-admin.mjs preview|apply --name \"Given Surname\" [--label \"privacy request\"] [--confirm APPLY_REDACTION]");
  process.exit(1);
}
if (command === "apply" && confirm !== "APPLY_REDACTION") {
  console.error("apply requires --confirm APPLY_REDACTION");
  process.exit(1);
}

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-redaction-admin", statement_timeout: 180_000 },
});

interface Hit { caseId: string; casePublicId: string; documentId: string | null; documentPublicId: string | null }
interface EntityHit { publicId: string; entityType: string }

const MATCH_LIMIT = 500;

function tsqueryText(name: string): string {
  return name.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
}

async function inStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error("query failed");
    (wrapped as Error & { step?: string }).step = step;
    throw wrapped;
  }
}

async function findHits(): Promise<{ hits: Hit[]; entities: EntityHit[] }> {
  // A startup parameter does not beat the role's statement_timeout. The previous
  // preview OR'd an unindexed document-title scan into the opinion GIN lookup,
  // and that scan was canceled after about eight seconds.
  await sql.unsafe(`SET statement_timeout = '60s'`);
  await sql.unsafe(`SET lock_timeout = '5s'`);
  const found = new Map<string, Hit>();
  const entities = new Map<string, EntityHit>();
  const add = (hit: Hit) => found.set(`${hit.caseId}:${hit.documentPublicId ?? ""}`, hit);
  const indexed = async (step: string, run: (tx: postgres.TransactionSql<Record<string, never>>) => Promise<void>) => {
    await inStep(step, () => sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = '30s'`);
      await tx.unsafe(`SET LOCAL lock_timeout = '3s'`);
      await tx.unsafe(`SET LOCAL enable_seqscan = off`);
      await run(tx);
    }));
  };
  for (const name of names) {
    const like = `%${name.replace(/[%_\\]/g, "")}%`;
    const terms = tsqueryText(name);
    await indexed("caption", async (tx) => {
      const rows = await tx<Hit[]>`
        SELECT c.id AS "caseId", c.public_id AS "casePublicId", NULL::uuid AS "documentId", NULL::text AS "documentPublicId"
        FROM legal_case c
        WHERE c.caption ILIKE ${like}
        LIMIT ${MATCH_LIMIT}
      `;
      for (const row of rows) add(row);
    });
    await indexed("party-name", async (tx) => {
      const rows = await tx<Hit[]>`
        SELECT c.id AS "caseId", c.public_id AS "casePublicId", NULL::uuid AS "documentId", NULL::text AS "documentPublicId"
        FROM party_appearance appearance
        JOIN legal_case c ON c.id = appearance.case_id
        WHERE appearance.party_name_as_filed ILIKE ${like}
        LIMIT ${MATCH_LIMIT}
      `;
      for (const row of rows) add(row);
    });
    await indexed("entity-name", async (tx) => {
      const rows = await tx<(Hit & EntityHit)[]>`
        SELECT entity.public_id AS "publicId", entity.entity_type AS "entityType",
          c.id AS "caseId", c.public_id AS "casePublicId", NULL::uuid AS "documentId", NULL::text AS "documentPublicId"
        FROM entity
        JOIN party_appearance appearance ON appearance.entity_id = entity.id
        JOIN legal_case c ON c.id = appearance.case_id
        WHERE entity.display_name ILIKE ${like}
        LIMIT ${MATCH_LIMIT}
      `;
      for (const row of rows) {
        entities.set(row.publicId, { publicId: row.publicId, entityType: row.entityType });
        add(row);
      }
    });
    await indexed("case-search", async (tx) => {
      const rows = await tx<Hit[]>`
        SELECT c.id AS "caseId", c.public_id AS "casePublicId", NULL::uuid AS "documentId", NULL::text AS "documentPublicId"
        FROM public_case_search search
        JOIN legal_case c ON c.id = search.case_id
        WHERE search.search_text ILIKE ${like}
        LIMIT ${MATCH_LIMIT}
      `;
      for (const row of rows) add(row);
    });
    if (terms.length >= 3) {
      await indexed("opinion-caption", async (tx) => {
        const rows = await tx<Hit[]>`
          SELECT c.id AS "caseId", c.public_id AS "casePublicId", d.id AS "documentId", d.public_id AS "documentPublicId"
          FROM opinion_search_meta meta
          JOIN document d ON d.id = meta.document_id
          JOIN legal_case c ON c.id = meta.case_id
          WHERE meta.caption_vector @@ websearch_to_tsquery('english', ${terms})
          LIMIT ${MATCH_LIMIT}
        `;
        for (const row of rows) add(row);
      });
      await indexed("opinion-text", async (tx) => {
        const rows = await tx<Hit[]>`
          SELECT c.id AS "caseId", c.public_id AS "casePublicId", d.id AS "documentId", d.public_id AS "documentPublicId"
          FROM opinion_search_projection projection
          JOIN document d ON d.id = projection.document_id
          JOIN legal_case c ON c.id = projection.case_id
          WHERE projection.search_vector @@ websearch_to_tsquery('english', ${terms})
          LIMIT ${MATCH_LIMIT}
        `;
        for (const row of rows) add(row);
      });
    }
  }
  const caseIds = [...new Set([...found.values()].map((hit) => hit.caseId))];
  if (caseIds.length > 0) {
    await indexed("case-documents", async (tx) => {
      const documents = await tx<Hit[]>`
        SELECT c.id AS "caseId", c.public_id AS "casePublicId", d.id AS "documentId", d.public_id AS "documentPublicId"
        FROM document d
        JOIN legal_case c ON c.id = d.case_id
        WHERE c.id = ANY(${tx.array(caseIds)}::uuid[])
        LIMIT ${MATCH_LIMIT}
      `;
      for (const row of documents) add(row);
    });
  }
  return { hits: [...found.values()], entities: [...entities.values()] };
}

function pathsFor(hit: Hit): string[] {
  const base = `/case/${hit.casePublicId}`;
  const paths = [base, `${base}/docket`, `${base}/documents`, `${base}/parties`, `${base}/timeline`, `${base}/summary`, `${base}/ai.json`];
  if (hit.documentPublicId) paths.push(`${base}/documents/${hit.documentPublicId}`);
  return paths;
}

function entityPath(entity: EntityHit): string {
  return entity.entityType === "law_firm" ? `/law-firms/${entity.publicId}` : `/parties/${entity.publicId}`;
}

function publicReport(kind: "preview" | "applied", hits: Hit[], entities: EntityHit[], extra: Record<string, string | number> = {}) {
  const caseIds = [...new Set(hits.map((hit) => hit.casePublicId))].sort();
  const documentIds = [...new Set(hits.flatMap((hit) => hit.documentPublicId ? [hit.documentPublicId] : []))].sort();
  console.log(JSON.stringify({
    redaction: kind,
    subjects: names.length,
    cases: caseIds.length,
    documents: documentIds.length,
    entities: entities.length,
    caseIds,
    documentIds,
    ...extra,
  }));
}

try {
  const { hits, entities } = await findHits();
  const paths = [...new Set([...hits.flatMap(pathsFor), ...entities.map(entityPath)])].sort();
  if (command === "preview") {
    publicReport("preview", hits, entities);
    process.exit(0);
  }
  const rules = names.map((fullName) => ({ fullName, initials: initialsFor(fullName) }));
  const [request] = await sql<{ id: string }[]>`
    INSERT INTO redaction_requests (requester_label, subject_names, scope, status, notes)
    VALUES (${label}, ${sql.array(names)}, 'all', 'received', 'Applied from the ingestion-host admin. Contact details are not stored.')
    RETURNING id
  `;
  for (const rule of rules) {
    const [redaction] = await sql<{ id: string }[]>`
      INSERT INTO name_redactions (request_id, full_name, initials)
      VALUES (${request!.id}, ${rule.fullName}, ${rule.initials})
      RETURNING id
    `;
    for (const hit of hits) {
      for (const path of pathsFor(hit)) {
        await sql`
          INSERT INTO redaction_hits (redaction_id, case_id, document_id, path)
          VALUES (${redaction!.id}, ${hit.caseId}, ${hit.documentId}, ${path})
          ON CONFLICT (redaction_id, path) DO NOTHING
        `;
      }
    }
    for (const entity of entities) {
      await sql`
        INSERT INTO redaction_hits (redaction_id, path)
        VALUES (${redaction!.id}, ${entityPath(entity)})
        ON CONFLICT (redaction_id, path) DO NOTHING
      `;
    }
  }
  const caseIds = [...new Set(hits.map((hit) => hit.caseId))];
  if (caseIds.length > 0) {
    await sql`
      UPDATE opinion_search_projection projection
      SET case_caption = redact_public_text(projection.case_caption),
          title = redact_public_text(projection.title),
          body = redact_public_text(projection.body),
          updated_at = now()
      WHERE projection.document_id IN (
        SELECT d.id FROM document d WHERE d.case_id = ANY(${sql.array(caseIds)}::uuid[])
      )
    `;
    await sql`
      UPDATE opinion_search_meta meta
      SET caption_vector = to_tsvector('english', coalesce(projection.case_caption, '') || ' ' || coalesce(projection.title, ''))
      FROM opinion_search_projection projection
      WHERE projection.document_id = meta.document_id
        AND projection.document_id IN (
          SELECT d.id FROM document d WHERE d.case_id = ANY(${sql.array(caseIds)}::uuid[])
        )
    `;
    await sql`
      UPDATE public_case_search
      SET search_text = redact_public_text(search_text), refreshed_at = now()
      WHERE case_id = ANY(${sql.array(caseIds)}::uuid[])
    `;
  }
  await sql`
    UPDATE redaction_requests SET status = 'applied', applied_at = now(), updated_at = now()
    WHERE id = ${request!.id}
  `;
  const origin = (process.env.SITE_URL ?? "https://jurvio.com").replace(/\/$/, "");
  const urls = paths.map((path) => `${origin}${path}`);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  let purged = false;
  if (token && zone && urls.length > 0) {
    purged = true;
    for (let index = 0; index < urls.length; index += 30) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone)}/purge_cache`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files: urls.slice(index, index + 30) }),
      });
      purged = purged && response.ok;
    }
  }
  publicReport("applied", hits, entities, {
    purge: token && zone ? (purged ? "purged" : "purge failed") : "purge missing",
    sharedPages: pagesToRefresh().length,
  });
} catch (error) {
  const failed = error instanceof Error ? error : new Error("query failed");
  const step = (failed as Error & { step?: string }).step ?? "redaction";
  const code = (failed as Error & { code?: string }).code ?? "";
  console.error(JSON.stringify({
    redaction: "failed",
    step,
    code,
    message: scrubRedactionLog(failed.message, names),
    stack: scrubRedactionLog(failed.stack ?? "", names).split("\n").slice(0, 12),
  }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
