import type postgres from "postgres";
import {
  CITED_OPINION_RULE_VERSION,
  federalOpinionDocumentReasons,
  type FederalOpinionDocumentChecks,
} from "@/modules/citations/application/publish-cited-federal-opinions";

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql<Record<string, never>>;

type CaseOpinionDocumentRow = {
  document_id: string;
  word_count: number;
  content_text: string;
  document_hash: string;
  artifact_hash: string | null;
  document_source_uri: string | null;
  document_provider: string | null;
  document_artifact_source: string | null;
  document_source_record_id: string | null;
  opinion_provider_id: string | null;
  cluster_linked: boolean;
  blocked: boolean;
};

export interface OpinionDocumentPublicationResult {
  published: number;
  held: number;
  holdReasons: Record<string, number>;
}

/**
 * Publish (or hold) the opinion DOCUMENTS of an already-eligible federal legal_case, using
 * the same shared opinion-document checks the cited publisher applies. This is the
 * deterministic federal path extended from case-only to case + document publication.
 *
 * Contract, run inside the caller's transaction:
 *  - Only DRAFT opinion documents are considered, so a document already published is never
 *    touched and no duplicate publication event is emitted (idempotent / no double publish).
 *  - A document failing any shared check (thin, document provenance, verified opinion
 *    source, existing publication/review restriction, sensitive text) is recorded in the
 *    shared citation_publication_hold table under the same rule version the cited publisher
 *    uses, and is NOT published -- the case still publishes, preserving prior behavior.
 *  - A passing document is published with a `document` publication_decision
 *    (`deterministic_federal_opinion_document`) and a single `publication.changed` outbox
 *    event, the decision insert guarded so it is not duplicated.
 *  - `options.maxPublish` caps how many documents this call may PUBLISH (holds do not count).
 *    It defaults to unbounded; a bounded pilot passes its remaining document budget so the
 *    combined ceiling is honored exactly. Once the budget is spent, remaining passing
 *    documents are left draft (neither published nor held) for a later run.
 */
export async function publishCaseOpinionDocuments(
  sql: Sql,
  caseId: string,
  options: { maxPublish?: number } = {},
): Promise<OpinionDocumentPublicationResult> {
  const maxPublish = options.maxPublish ?? Number.POSITIVE_INFINITY;
  const holdReasons: Record<string, number> = {};
  let published = 0;
  let held = 0;

  const opinionDocs = await sql<CaseOpinionDocumentRow[]>`
    SELECT d.id AS document_id, content.word_count, content.content_text,
      content.content_hash AS document_hash, da.content_hash AS artifact_hash,
      da.source_uri AS document_source_uri, dp.code AS document_provider,
      da.response_metadata->>'source' AS document_artifact_source,
      da.source_record_id AS document_source_record_id,
      jo.provider_opinion_id AS opinion_provider_id,
      (jo.cluster_id IS NOT NULL
        AND EXISTS(SELECT 1 FROM opinion_cluster oc WHERE oc.id = jo.cluster_id)) AS cluster_linked,
      (EXISTS(SELECT 1 FROM publication_decision pd WHERE pd.object_id = d.id AND NOT pd.displayable)
        OR EXISTS(SELECT 1 FROM publication_review pr WHERE pr.object_id = d.id
          AND (pr.status IN ('rejected','needs_changes')
               OR (pr.reviewer_id IS NOT NULL AND pr.status <> 'approved')))) AS blocked
    FROM document d
    JOIN judicial_opinion jo ON jo.document_id = d.id
    JOIN document_content content ON content.document_id = d.id
    JOIN raw_artifact da ON da.id = content.source_artifact_id
    JOIN provider dp ON dp.id = da.provider_id
    WHERE d.case_id = ${caseId} AND d.publication = 'draft'
    FOR UPDATE OF d
  `;

  for (const doc of opinionDocs) {
    const checks: FederalOpinionDocumentChecks = {
      wordCount: doc.word_count,
      contentText: doc.content_text,
      documentHash: doc.document_hash,
      artifactHash: doc.artifact_hash ?? "",
      documentSourceUri: doc.document_source_uri ?? "",
      documentProvider: doc.document_provider ?? "",
      blocked: doc.blocked,
      documentArtifactSource: doc.document_artifact_source,
      documentSourceRecordId: doc.document_source_record_id,
      opinionProviderId: doc.opinion_provider_id,
      clusterLinked: doc.cluster_linked,
    };
    const reasons = federalOpinionDocumentReasons(checks);
    if (reasons.length > 0) {
      for (const reason of reasons) holdReasons[reason] = (holdReasons[reason] ?? 0) + 1;
      await sql`
        INSERT INTO citation_publication_hold (document_id, content_hash, reasons, rule_version)
        VALUES (${doc.document_id}, ${doc.document_hash}, ${reasons}, ${CITED_OPINION_RULE_VERSION})
        ON CONFLICT (document_id) DO UPDATE SET
          content_hash = EXCLUDED.content_hash, reasons = EXCLUDED.reasons,
          rule_version = EXCLUDED.rule_version, held_at = now()
      `;
      held += 1;
      continue;
    }
    // Budget cap (bounded pilot): this document passes every check but the caller's publish
    // budget is spent, so leave it draft for a later run. Failing documents above are still
    // held; only publishes are capped.
    if (published >= maxPublish) continue;
    await sql`
      UPDATE document SET publication = 'published', updated_at = now()
      WHERE id = ${doc.document_id} AND publication = 'draft'
    `;
    await sql`
      INSERT INTO publication_decision (
        object_type, object_id, displayable, indexable, machine_accessible,
        downloadable, summary_eligible, reason_code, rule_version
      )
      SELECT 'document', ${doc.document_id}, true, true, true, false, false,
        'deterministic_federal_opinion_document', 'federal-publication-v2'
      WHERE NOT COALESCE((
        SELECT displayable FROM publication_decision
        WHERE object_type = 'document' AND object_id = ${doc.document_id}
        ORDER BY decided_at DESC, id DESC LIMIT 1
      ), false)
    `;
    await sql`
      INSERT INTO outbox_event (
        topic, aggregate_type, aggregate_id, aggregate_version, payload
      ) VALUES (
        'publication.changed', 'document', ${doc.document_id},
        (extract(epoch from clock_timestamp()) * 1000000)::bigint,
        ${sql.json({ source: "courtlistener", policy: "federal-publication-v2" })}
      )
    `;
    published += 1;
  }
  return { published, held, holdReasons };
}
