/**
 * Idempotent storage for live feed items. Callers that do not pass
 * `publishFeed` still create a draft. A district or appellate RSS caller
 * publishes a new case when the docket number is a real federal number and
 * the caption is not sealed. That publish stamps the case and its docket
 * lines outside the follower-alert window, so a 24-hour feed does not email
 * anyone about history. An existing case's publication is left as it is
 * unless it is still a draft with no publication hold.
 */
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { ArtifactStore } from "../application/artifact-store";
import { isPublishableFeedDocket } from "../domain/direct-court";
import { FEDERAL_PUBLICATION_RULE_VERSION, isRestrictedDocketText } from "../domain/federal-stream";
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
  /** Decision date, for a case first seen through an opinion release. */
  decidedOn?: string | null;
  /** Publish a new or still-draft case when the docket number is a federal one. */
  publishFeed?: boolean;
}): Promise<CaseMatch> {
  const [byIdentifier] = await sql<{ case_id: string }[]>`
    SELECT case_id FROM case_identifier
    WHERE provider_id = ${input.providerId} AND identifier_type = ${input.identifierType}
      AND identifier_value = ${input.identifierValue}
    LIMIT 1
  `;
  if (byIdentifier) {
    if (input.publishFeed && isPublishableFeedDocket(input.docketNumber) && !isRestrictedDocketText(input.caption)) {
      await publishDraftFeedCase(sql, byIdentifier.case_id);
    }
    return { kind: "existing", caseId: byIdentifier.case_id };
  }
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
    const publish = Boolean(input.publishFeed) && isPublishableFeedDocket(input.docketNumber) && !isRestrictedDocketText(input.caption);
    const [created] = await sql<{ id: string; inserted: boolean }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, decided_on,
        verification, publication, source_artifact_id, source_updated_at, updated_at)
      VALUES (${createPublicId("case")}, ${input.courtId}, ${input.docketNumber}, ${input.caption}, ${input.filedOn},
        ${input.decidedOn ?? null}, ${publish ? "verified" : "not_verified"}, ${publish ? "published" : "draft"},
        ${input.artifactId}, now(), ${publish ? sql`now() - interval '31 days'` : sql`now()`})
      ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
      DO UPDATE SET updated_at = legal_case.updated_at
      RETURNING id, (xmax = 0) AS inserted
    `;
    if (!created) throw new Error("Draft case was not persisted");
    match = created.inserted ? { kind: "created", caseId: created.id } : { kind: "existing", caseId: created.id };
    if (publish && match.kind === "created") await recordFeedPublication(sql, match.caseId);
  }
  if (input.publishFeed && match.kind === "existing" && isPublishableFeedDocket(input.docketNumber) && !isRestrictedDocketText(input.caption)) {
    await publishDraftFeedCase(sql, match.caseId);
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
  /** Stamp the line before the follower-alert window. Feed history must not notify. */
  history?: boolean;
}): Promise<boolean> {
  if (isRestrictedDocketText(input.description)) return false;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number,
      filed_on, description, entry_type, importance, source_artifact_id, created_at, updated_at)
    VALUES (${createPublicId("docketEntry")}, ${input.caseId}, ${input.providerId}, ${input.providerEntryId},
      ${input.entryNumber}, ${input.filedOn}, ${input.description}, ${input.entryType}, ${input.importance}, ${input.artifactId},
      ${input.history ? sql`now() - interval '15 days'` : sql`now()`},
      ${input.history ? sql`now() - interval '15 days'` : sql`now()`})
    ON CONFLICT (provider_id, provider_entry_id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

export async function recordFeedPublication(sql: Sql, caseId: string): Promise<void> {
  await sql`SELECT set_config('jurvio.defer_search_refresh', 'on', true)`;
  const [decision] = await sql<{ id: string; decided_at: Date }[]>`
    INSERT INTO publication_decision (
      object_type, object_id, displayable, indexable, machine_accessible,
      downloadable, summary_eligible, reason_code, rule_version
    ) VALUES (
      'legal_case', ${caseId}, true, false, true, false, false, 'feed_metadata', ${FEDERAL_PUBLICATION_RULE_VERSION}
    )
    RETURNING id, decided_at
  `;
  if (!decision) return;
  await sql`
    INSERT INTO publication_current (object_type, object_id, displayable, decided_at, decision_id)
    VALUES ('legal_case', ${caseId}, true, ${decision.decided_at}, ${decision.id})
    ON CONFLICT (object_type, object_id) DO UPDATE SET
      displayable = EXCLUDED.displayable,
      decided_at = EXCLUDED.decided_at,
      decision_id = EXCLUDED.decision_id
  `;
}

export async function publishDraftFeedCase(sql: Sql, caseId: string): Promise<void> {
  await sql`SELECT set_config('jurvio.defer_search_refresh', 'on', true)`;
  const [promoted] = await sql<{ id: string }[]>`
    UPDATE legal_case SET publication = 'published', verification = 'verified', updated_at = updated_at
    WHERE id = ${caseId} AND publication = 'draft'
      AND NOT EXISTS (
        SELECT 1 FROM federal_publication_hold hold
        WHERE hold.case_id = legal_case.id AND hold.rule_version = ${FEDERAL_PUBLICATION_RULE_VERSION}
      )
    RETURNING id
  `;
  if (promoted) await recordFeedPublication(sql, caseId);
}

export type EquivalentKind = "opinion" | "order" | "judgment" | "any";

const KIND_PATTERN: Readonly<Record<EquivalentKind, string>> = {
  opinion: "(opinion|memorandum)",
  order: "\\morder\\M",
  judgment: "judgment",
  any: "(opinion|order|memorandum|judgment|decision)",
};

/**
 * Cross-source dedupe: true when a different source already recorded the same
 * kind of entry on this case within a day of `filedOn` (court + docket + date +
 * kind), or, for opinions, an opinion document exists for that date. Each
 * free source calls this before adding its own entry so one decision is not
 * listed twice when it arrives by RSS, the court's site, GovInfo or a feed.
 */
export async function hasEquivalentEntry(sql: Sql, input: {
  caseId: string; filedOn: string | null; kind: EquivalentKind; ownPrefix: string;
  /** Also count opinion documents (the appellate opinion graph). Default true. */
  includeDocuments?: boolean;
}): Promise<boolean> {
  if (!input.filedOn) return false;
  const pattern = KIND_PATTERN[input.kind];
  const entryType = input.kind === "any" ? null : input.kind === "judgment" ? "order" : input.kind;
  const [row] = await sql<{ hit: boolean }[]>`
    SELECT (
      EXISTS (
        SELECT 1 FROM docket_entry
        WHERE case_id = ${input.caseId} AND coalesce(provider_entry_id, '') NOT LIKE ${`${input.ownPrefix}%`}
          AND filed_on BETWEEN ${input.filedOn}::date - 1 AND ${input.filedOn}::date + 1
          AND ((${entryType}::text IS NULL AND entry_type IN ('opinion', 'order')) OR entry_type = ${entryType}
            OR description ~* ${pattern})
      ) OR (${(input.includeDocuments ?? true) && (input.kind === "opinion" || input.kind === "any")} AND EXISTS (
        SELECT 1 FROM document
        WHERE case_id = ${input.caseId} AND filed_on BETWEEN ${input.filedOn}::date - 1 AND ${input.filedOn}::date + 1
      ))
    ) AS hit
  `;
  return Boolean(row?.hit);
}

/**
 * The case for a federal docket, or 'ambiguous'. Districts: same office (when
 * both have one), year, number and, when the source gives it, case type; judge
 * suffixes are ignored (federal_docket_core index). Circuits: the normalized
 * docket number.
 */
export async function findFederalCase(sql: Sql, input: {
  courtCode: string; docketNumber: string; district: boolean;
}): Promise<string | null | "ambiguous"> {
  const code = input.courtCode.toLowerCase();
  if (!input.district) {
    const rows = await sql<{ id: string }[]>`
      SELECT legal_case.id FROM legal_case JOIN court ON court.id = legal_case.court_id
      WHERE lower(coalesce(court.provider_court_id, '')) = ${code}
        AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g')) = ${normalizeDocket(input.docketNumber)}
      LIMIT 2`;
    return rows.length > 1 ? "ambiguous" : rows[0]?.id ?? null;
  }
  const source = /^(?:(\d+):)?(\d{2})-(?:([a-z]{1,5})-)?(\d{1,7})/i.exec(input.docketNumber.trim());
  if (!source) return null;
  const [, office, year, type, number] = source;
  if (number!.length > 5) return null;
  const core = `${year}${number!.padStart(5, "0").slice(-5)}`;
  const rows = await sql<{ id: string; docket_number: string }[]>`
    SELECT legal_case.id, legal_case.docket_number FROM legal_case JOIN court ON court.id = legal_case.court_id
    WHERE lower(coalesce(court.provider_court_id, '')) = ${code}
      AND federal_docket_core(legal_case.docket_number) = ${core}
      AND legal_case.supreme_court_term IS NULL
    LIMIT 20`;
  const candidates = rows.filter((row) => {
    const other = /^(?:(\d+):)?\d{2}-([a-z]{1,5})-/i.exec(row.docket_number.trim());
    if (!other) return false;
    if (type && other[2]!.toLowerCase() !== type.toLowerCase()) return false;
    if (office && other[1] && other[1] !== office) return false;
    return true;
  });
  return candidates.length > 1 ? "ambiguous" : candidates[0]?.id ?? null;
}
