/**
 * Hourly publisher. Does nothing unless CONTINUOUS_PUBLISH=1 and the pause
 * flag is unset. Does not publish SCOTUS. Does not rewrite docket_entry rows,
 * so a history line cannot look like a new filing to follower alerts.
 * Metadata-only cases are displayable and not indexable.
 */
import type postgres from "postgres";
import {
  evaluateFederalPublicationCandidate, FEDERAL_PUBLICATION_RULE_VERSION, isRestrictedDocketText,
} from "@/modules/ingestion/domain/federal-stream";
import { federalPublicationIncludesCourt } from "@/modules/ingestion/domain/federal-publication-hold";
import {
  continuousPublishBucket, continuousPublishEnabled, orderContinuousCases, pacedPublishLimit, type ContinuousBucket,
} from "../domain/continuous-publish";
import { measurePublicSearchMs, slowPublicQueryCount } from "./search-pace";

type Sql = ReturnType<typeof postgres>;

const RULE = `${FEDERAL_PUBLICATION_RULE_VERSION}-continuous`;

interface Candidate {
  id: string;
  caption: string;
  docket_number: string;
  filed_on: string | null;
  court_jurisdiction: string;
  court_provider_id: string | null;
  court_verification: string;
  source_artifact_id: string | null;
  source_record_id: string | null;
  source_uri: string | null;
  source_content_hash: string | null;
  source_retrieved_at: string | null;
  has_opinion_text: boolean;
  signal_count: number;
  has_name: boolean;
  identity_collision_count: number;
}

export async function runContinuousPublish(sql: Sql, options: { limit?: number; now?: Date } = {}) {
  if (!continuousPublishEnabled()) {
    return { skipped: "off" as const, published: 0, held: 0, entriesShown: 0, alertsQueued: 0 as const };
  }
  const requested = Math.min(3000, Math.max(1, options.limit ?? 2000));
  const searchMs = await measurePublicSearchMs();
  const slowQueries = await slowPublicQueryCount(sql).catch(() => 0);
  const limit = pacedPublishLimit(requested, searchMs, slowQueries);
  if (limit === 0) {
    return { skipped: "search_slow" as const, published: 0, held: 0, entriesShown: 0, alertsQueued: 0 as const, searchMs, slowQueries };
  }
  const now = options.now ?? new Date();
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '8s'`;
    const rows = await tx<Candidate[]>`
      SELECT c.id::text, c.caption, c.docket_number, c.filed_on::text,
        court.jurisdiction AS court_jurisdiction, court.provider_court_id AS court_provider_id,
        court.verification::text AS court_verification, c.source_artifact_id::text,
        artifact.source_record_id, artifact.source_uri, artifact.content_hash AS source_content_hash,
        artifact.retrieved_at::text AS source_retrieved_at,
        EXISTS (
          SELECT 1 FROM document d
          JOIN document_content content ON content.document_id = d.id
          WHERE d.case_id = c.id AND length(btrim(content.content_text)) > 40
        ) AS has_opinion_text,
        (
          (c.terminated_on IS NOT NULL)::int
          + (nullif(btrim(coalesce(c.cause_of_action, '')), '') IS NOT NULL)::int
          + (EXISTS (SELECT 1 FROM docket_entry e WHERE e.case_id = c.id))::int
        ) AS signal_count,
        (length(btrim(c.caption)) >= 5) AS has_name,
        (SELECT count(*)::int FROM legal_case other
          WHERE other.court_id = c.court_id
            AND lower(regexp_replace(other.docket_number, '[^a-zA-Z0-9]', '', 'g'))
              = lower(regexp_replace(c.docket_number, '[^a-zA-Z0-9]', '', 'g'))
        ) AS identity_collision_count
      FROM legal_case c
      JOIN court ON court.id = c.court_id
      LEFT JOIN raw_artifact artifact ON artifact.id = c.source_artifact_id
      WHERE c.publication = 'draft'
        AND lower(coalesce(court.provider_court_id, '')) <> 'scotus'
        AND (
          c.filed_on >= current_date - 90
          OR c.filed_on < date '2000-01-01'
          OR EXISTS (
            SELECT 1 FROM document d
            JOIN document_content content ON content.document_id = d.id
            WHERE d.case_id = c.id AND length(btrim(content.content_text)) > 40
          )
        )
      ORDER BY c.filed_on DESC NULLS LAST
      LIMIT ${limit * 4}
    `;
    const ranked = orderContinuousCases(rows.flatMap((row) => {
      if (!federalPublicationIncludesCourt(row.court_provider_id)) return [];
      if (isRestrictedDocketText(`${row.caption} ${row.docket_number}`)) return [];
      const bucket = continuousPublishBucket({
        filedOn: row.filed_on, hasOpinionText: row.has_opinion_text,
        signalCount: row.signal_count, hasName: row.has_name, now,
      });
      return bucket ? [{ ...row, bucket, filedOn: row.filed_on }] : [];
    })).slice(0, limit);

    let published = 0;
    let held = 0;
    for (const row of ranked) {
      const decision = evaluateFederalPublicationCandidate({
        caption: row.caption,
        docketNumber: row.docket_number,
        courtJurisdiction: row.court_jurisdiction,
        courtProviderId: row.court_provider_id,
        courtVerification: row.court_verification as "verified",
        sourceArtifactId: row.source_artifact_id,
        sourceProviderCode: null,
        sourceRecordId: row.source_record_id,
        sourceUri: row.source_uri,
        sourceContentHash: row.source_content_hash,
        sourceRetrievedAt: row.source_retrieved_at,
        hasReadableContent: row.has_opinion_text,
        canonicalIdentifier: null,
        canonicalIdentifierCount: 0,
        identityCollisionCount: row.identity_collision_count,
        unresolvedRejections: 0,
        restrictedText: `${row.caption} ${row.docket_number}`,
        providerScopedIdentifier: null,
        sourceRecordResolvesIdentity: false,
        courtCaseLinkageVerified: false,
      }, { allowMissingReadableContent: true });
      if (!decision.eligible || decision.restricted) {
        held += 1;
        continue;
      }
      const indexable = row.has_opinion_text;
      await tx`
        UPDATE legal_case SET verification = 'verified', publication = 'published'
        WHERE id = ${row.id}::uuid AND publication = 'draft'`;
      await tx`
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        )
        SELECT 'legal_case', ${row.id}::uuid, true, ${indexable}, true, false, false,
          'continuous_publish', ${RULE}
        WHERE NOT COALESCE((
          SELECT displayable FROM publication_decision
          WHERE object_type = 'legal_case' AND object_id = ${row.id}::uuid
          ORDER BY decided_at DESC, id DESC LIMIT 1
        ), false)`;
      published += 1;
    }
    const entries = await tx<{ id: string; description: string }[]>`
      SELECT e.id::text, e.description
      FROM docket_entry e
      JOIN legal_case c ON c.id = e.case_id
      WHERE c.publication = 'published'
        AND e.created_at > now() - interval '2 days'
        AND NOT EXISTS (
          SELECT 1 FROM publication_decision d
          WHERE d.object_type = 'docket_entry' AND d.object_id = e.id
        )
      ORDER BY e.created_at DESC
      LIMIT ${limit}`;
    let entriesShown = 0;
    for (const entry of entries) {
      if (isRestrictedDocketText(entry.description)) continue;
      await tx`
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        ) VALUES (
          'docket_entry', ${entry.id}::uuid, true, false, true, false, false,
          'continuous_publish_entry', ${RULE}
        )`;
      entriesShown += 1;
    }
    return { skipped: null, published, held, entriesShown, alertsQueued: 0 as const, searchMs, slowQueries, buckets: ranked.map((row) => row.bucket as ContinuousBucket) };
  });
}
