import postgres from "postgres";
import { env } from "@/lib/config/env";
import { initialsFor } from "@/modules/privacy/domain/redact-names";
import { pagesToRefresh } from "@/lib/http/refresh-public-pages";

// Ingestion-host admin for privacy redactions. Does not print contact details.
//   node jobs/redaction-admin.mjs preview --name "Given Surname"
//   node jobs/redaction-admin.mjs apply --confirm APPLY_REDACTION --name "Given Surname" --label "privacy request"
const args = process.argv.slice(2);
const command = args[0];
const names: string[] = [];
let label = "privacy request";
let confirm = "";
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

async function findHits(): Promise<Hit[]> {
  const found = new Map<string, Hit>();
  const add = (hit: Hit) => found.set(`${hit.caseId}:${hit.documentPublicId ?? ""}`, hit);
  for (const name of names) {
    const like = `%${name.replace(/[%_\\]/g, "")}%`;
    const rows = await sql<Hit[]>`
      SELECT c.id AS "caseId", c.public_id AS "casePublicId", NULL::uuid AS "documentId", NULL::text AS "documentPublicId"
      FROM legal_case c
      WHERE c.caption ILIKE ${like}
      UNION
      SELECT c.id, c.public_id, d.id, d.public_id
      FROM document d
      JOIN legal_case c ON c.id = d.case_id
      JOIN opinion_search_projection projection ON projection.document_id = d.id
      WHERE projection.search_vector @@ websearch_to_tsquery('english', ${name})
         OR projection.case_caption ILIKE ${like}
         OR projection.title ILIKE ${like}
         OR d.title ILIKE ${like}
    `;
    for (const row of rows) add(row);
  }
  return [...found.values()];
}

function pathsFor(hit: Hit): string[] {
  const base = `/case/${hit.casePublicId}`;
  const paths = [base, `${base}/docket`, `${base}/documents`, `${base}/parties`, `${base}/timeline`, `${base}/summary`, `${base}/ai.json`];
  if (hit.documentPublicId) paths.push(`${base}/documents/${hit.documentPublicId}`);
  return paths;
}

try {
  const hits = await findHits();
  const paths = [...new Set(hits.flatMap(pathsFor))].sort();
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
  }
  await sql`
    UPDATE opinion_search_projection projection
    SET case_caption = redact_public_text(projection.case_caption),
        title = redact_public_text(projection.title),
        body = redact_public_text(projection.body),
        updated_at = now()
    WHERE projection.document_id IN (
      SELECT document_id FROM redaction_hits WHERE document_id IS NOT NULL
    )
  `;
  await sql`
    UPDATE opinion_search_meta meta
    SET caption_vector = to_tsvector('english', coalesce(projection.case_caption, '') || ' ' || coalesce(projection.title, ''))
    FROM opinion_search_projection projection
    WHERE projection.document_id = meta.document_id
      AND projection.document_id IN (SELECT document_id FROM redaction_hits WHERE document_id IS NOT NULL)
  `;
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
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone)}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: urls.slice(0, 30) }),
    });
    purged = response.ok;
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
