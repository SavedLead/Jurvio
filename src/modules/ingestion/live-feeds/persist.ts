/**
 * Idempotent storage for live feed items. Everything new is created as a
 * draft, not_verified case: the existing publication pipelines decide later,
 * under their own gates, whether anything becomes public. Nothing here writes
 * publication_decision rows or changes publication on an existing case.
 */
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { ArtifactStore } from "../application/artifact-store";
import { isRestrictedDocketText } from "../domain/federal-stream";
import { normalizeDocket } from "./coa-feeds";

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

export async function providerId(sql: Sql, code: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = ${code}`;
  if (!row) throw new Error(`Provider seed ${code} is missing`);
  return row.id;
}

/** Store a fetched feed body once per content hash and return its raw_artifact id. */
export async function storeFeedArtifact(sql: Sql, store: ArtifactStore, input: {
  providerId: string; sourceUri: string; sourceRecordId: string; keyPrefix: string;
  body: string; mediaType: string; metadata?: Record<string, postgres.JSONValue>;
}): Promise<string> {
  const contentHash = createHash("sha256").update(input.body).digest("hex");
  const extension = input.mediaType.includes("json") ? "json" : input.mediaType.includes("xml") ? "xml" : "html";
  const stored = await store.putIfAbsent({
    key: `${input.keyPrefix}/${contentHash}.${extension}`, mediaType: input.mediaType, body: input.body, contentHash,
  });
  const [artifact] = await sql<{ id: string }[]>`
    INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key,
      media_type, retrieved_at, response_metadata)
    VALUES (${input.providerId}, ${input.sourceUri}, ${input.sourceRecordId}, ${contentHash}, ${stored.objectKey},
      ${input.mediaType}, now(), ${sql.json(input.metadata ?? {})})
    ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
    RETURNING id
  `;
  if (!artifact) throw new Error("Feed artifact was not persisted");
  return artifact.id;
}

/** The court row new cases attach to: the provider's own row for this court, else any row for it. */
export async function resolveCourt(sql: Sql, input: {
  providerId: string; courtCode: string; name: string; shortName: string; jurisdiction: string; artifactId: string;
}): Promise<string> {
  const code = input.courtCode.toLowerCase();
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM court WHERE lower(provider_court_id) = ${code}
    ORDER BY (provider_id = ${input.providerId}) DESC, created_at, id LIMIT 1
  `;
  if (existing) return existing.id;
  const [created] = await sql<{ id: string }[]>`
    INSERT INTO court (public_id, provider_id, provider_court_id, name, short_name, jurisdiction, verification, source_artifact_id)
    VALUES (${createPublicId("court")}, ${input.providerId}, ${code}, ${input.name}, ${input.shortName},
      ${input.jurisdiction}, 'verified', ${input.artifactId})
    ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET updated_at = court.updated_at
    RETURNING id
  `;
  if (!created) throw new Error(`Court ${code} could not be resolved`);
  return created.id;
}

export type CaseMatch =
  | { kind: "existing"; caseId: string }
  | { kind: "created"; caseId: string }
  | { kind: "ambiguous" }
  | { kind: "restricted" };

/**
 * Match an incoming docket to one Jurvio case: first by this source's
 * identifier, then by court + normalized docket number (the rule the
 * appellate pipeline uses). Two candidate cases means a duplicate identity
 * that a person should resolve, so nothing is attached. Otherwise a new draft
 * case is created. Captions that trip the sealed/restricted check are skipped.
 */
export async function matchOrCreateDraftCase(sql: Sql, input: {
  providerId: string; courtId: string; courtCode: string; docketNumber: string; caption: string;
  filedOn: string | null; artifactId: string; identifierType: string; identifierValue: string;
}): Promise<CaseMatch> {
  const [byIdentifier] = await sql<{ case_id: string }[]>`
    SELECT case_id FROM case_identifier
    WHERE provider_id = ${input.providerId} AND identifier_type = ${input.identifierType}
      AND identifier_value = ${input.identifierValue}
    LIMIT 1
  `;
  if (byIdentifier) return { kind: "existing", caseId: byIdentifier.case_id };
  const matches = await sql<{ id: string }[]>`
    SELECT legal_case.id FROM legal_case JOIN court ON court.id = legal_case.court_id
    WHERE lower(coalesce(court.provider_court_id, '')) = ${input.courtCode.toLowerCase()}
      AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g')) = ${normalizeDocket(input.docketNumber)}
    LIMIT 2
  `;
  if (matches.length > 1) return { kind: "ambiguous" };
  let match: CaseMatch;
  if (matches[0]) {
    match = { kind: "existing", caseId: matches[0].id };
  } else {
    if (isRestrictedDocketText(input.caption)) return { kind: "restricted" };
    const [created] = await sql<{ id: string; inserted: boolean }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on,
        verification, publication, source_artifact_id, source_updated_at)
      VALUES (${createPublicId("case")}, ${input.courtId}, ${input.docketNumber}, ${input.caption}, ${input.filedOn},
        'not_verified', 'draft', ${input.artifactId}, now())
      ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
      DO UPDATE SET updated_at = legal_case.updated_at
      RETURNING id, (xmax = 0) AS inserted
    `;
    if (!created) throw new Error("Draft case was not persisted");
    match = created.inserted ? { kind: "created", caseId: created.id } : { kind: "existing", caseId: created.id };
  }
  await sql`
    INSERT INTO case_identifier (case_id, provider_id, identifier_type, identifier_value)
    VALUES (${match.caseId}, ${input.providerId}, ${input.identifierType}, ${input.identifierValue})
    ON CONFLICT (provider_id, identifier_type, identifier_value) DO NOTHING
  `;
  return match;
}

/** Insert one docket entry if this source has not recorded it yet. Returns true when new. */
export async function insertDocketEntryOnce(sql: Sql, input: {
  caseId: string; providerId: string; providerEntryId: string; entryNumber: string | null; filedOn: string | null;
  description: string; entryType: string; importance: "high" | "routine"; artifactId: string;
}): Promise<boolean> {
  if (isRestrictedDocketText(input.description)) return false;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number,
      filed_on, description, entry_type, importance, source_artifact_id)
    VALUES (${createPublicId("docketEntry")}, ${input.caseId}, ${input.providerId}, ${input.providerEntryId},
      ${input.entryNumber}, ${input.filedOn}, ${input.description}, ${input.entryType}, ${input.importance}, ${input.artifactId})
    ON CONFLICT (provider_id, provider_entry_id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}
