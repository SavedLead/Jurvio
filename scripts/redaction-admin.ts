import postgres from "postgres";
import { env } from "@/lib/config/env";
import { initialsFor } from "@/modules/privacy/domain/redact-names";
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

async function findHits(): Promise<{ hits: Hit[]; entities: EntityHit[] }> {
  const found = new Map<string, Hit>();
  const entities = new Map<string, EntityHit>();
  const add = (hit: Hit) => found.set(`${hit.caseId}:${hit.documentPublicId ?? ""}`, hit);
  for (const name of names) {
    const like = `%${name.replace(/[%_\\]/g, "")}%`;
    const rows = await sql<Hit[]>`
      SELECT c.id AS "caseId", c.public_id AS "casePublicId", NULL::uuid AS "documentId", NULL::text AS "documentPublicId"
      FROM legal_case c
      WHERE c.caption ILIKE ${like}
      UNION
      SELECT c.id, c.public_id, NULL::uuid, NULL::text
      FROM legal_case c
      JOIN party_appearance appearance ON appearance.case_id = c.id
      LEFT JOIN entity ON entity.id = appearance.entity_id
      WHERE appearance.party_name_as_filed ILIKE ${like}
         OR entity.display_name ILIKE ${like}
      UNION
      SELECT c.id, c.public_id, d.id, d.public_id
      FROM document d
      JOIN legal_case c ON c.id = d.case_id
      LEFT JOIN opinion_search_projection projection ON projection.document_id = d.id
      WHERE projection.search_vector @@ websearch_to_tsquery('english', ${name})
         OR projection.case_caption ILIKE ${like}
         OR projection.title ILIKE ${like}
         OR d.title ILIKE ${like}
    `;
    for (const row of rows) add(row);
    const people = await sql<EntityHit[]>`
      SELECT entity.public_id AS "publicId", entity.entity_type AS "entityType"
      FROM entity
      WHERE entity.display_name ILIKE ${like}
    `;
    for (const person of people) entities.set(person.publicId, person);
  }
  const caseIds = [...new Set([...found.values()].map((hit) => hit.caseId))];
  if (caseIds.length > 0) {
    const documents = await sql<Hit[]>`
      SELECT c.id AS "caseId", c.public_id AS "casePublicId", d.id AS "documentId", d.public_id AS "documentPublicId"
      FROM document d
      JOIN legal_case c ON c.id = d.case_id
      WHERE c.id = ANY(${sql.array(caseIds)}::uuid[])
    `;
    for (const row of documents) add(row);
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

try {
  const { hits, entities } = await findHits();
  const paths = [...new Set([...hits.flatMap(pathsFor), ...entities.map(entityPath)])].sort();
  if (command === "preview") {
    console.log(JSON.stringify({ redaction: "preview", subjects: names.length, urls: paths.length, paths }));
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
  console.log(JSON.stringify({
    redaction: "applied",
    subjects: names.length,
    urls: paths,
    purge: token && zone ? (purged ? "purged" : "purge failed") : "purge missing; edge copies expire on the cache TTL",
    sharedPages: pagesToRefresh().length,
  }));
} finally {
  await sql.end({ timeout: 5 });
}
