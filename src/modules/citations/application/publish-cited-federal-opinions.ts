import type postgres from 'postgres';
import { evaluateFederalPublicationCandidate, type FederalPublicationCandidate } from '@/modules/ingestion/domain/federal-stream';
import { publicCitationSourceExistsSql } from './public-citation-source';
import { parseBulkOpinionSourceUri } from '@/modules/ingestion/providers/courtlistener/bulk-opinions';
type Sql=ReturnType<typeof postgres>;
interface Candidate extends FederalPublicationCandidate {
  caseId:string; documentId:string; publication:string; documentPublication:string;
  wordCount:number; contentText:string; documentHash:string; artifactHash:string;
  documentSourceUri:string; documentProvider:string; blocked:boolean;
  // Provenance evidence for the opinion-source check: the document content artifact's
  // recorded source lane, its source_record_id, the stored judicial_opinion id, and
  // whether the opinion resolves to an ingested cluster. Used to verify official bulk
  // records end-to-end rather than rejecting them on URL shape.
  documentArtifactSource:string|null; documentSourceRecordId:string|null;
  opinionProviderId:string|null; clusterLinked:boolean;
}

const COURTLISTENER_REST_OPINION_URI=/^https:\/\/www\.courtlistener\.com\/api\/rest\/v[34]\/opinions\/\d+\/$/;

// The publication gate's rule version. Bump it whenever the gate logic changes (this
// release recognizes official bulk provenance). A citation_publication_hold is skipped by
// the candidate query only when it was written by THIS rule version; holds from an older
// rule (or NULL, i.e. written before holds were versioned) are treated as stale and
// re-evaluated once under the new rule -- so a gate improvement actually lets previously
// held-but-now-eligible opinions publish, instead of being suppressed forever.
export const CITED_OPINION_RULE_VERSION='cited-opinion-publication-v2';

/**
 * Accept a CourtListener opinion whose document content came from EITHER the live REST
 * API (the historical path) OR the official bulk export. A bulk record is not
 * "unverified" -- it is the same official provider over a different transport -- so we
 * verify its provenance rigorously instead of rejecting it on URL shape:
 *  - the content artifact must be the CourtListener provider and marked `courtlistener_bulk`,
 *  - its source_uri must be the canonical bulk-opinion URI (snapshot date + opinion id),
 *  - the opinion id encoded in that URI must agree with BOTH the artifact's
 *    source_record_id AND the stored judicial_opinion.provider_opinion_id, and
 *  - the opinion must be linked to an ingested opinion_cluster.
 * This authenticates the record end-to-end; it never trusts a bare URL, rewrites a URL to
 * look verified, or blanket-approves the provider.
 */
/**
 * The document-level inputs an opinion document must carry to be published, independent of
 * which publisher (cited-graph or deterministic-federal) is publishing it. Shared so both
 * paths apply exactly the same opinion-document checks.
 */
export interface FederalOpinionDocumentChecks {
  wordCount: number;
  contentText: string;
  documentHash: string;
  artifactHash: string;
  documentSourceUri: string;
  documentProvider: string;
  blocked: boolean;
  documentArtifactSource: string | null;
  documentSourceRecordId: string | null;
  opinionProviderId: string | null;
  clusterLinked: boolean;
}

export function isVerifiedCourtListenerOpinionSource(doc: FederalOpinionDocumentChecks): boolean {
  if(doc.documentProvider!=='courtlistener') return false;
  if(COURTLISTENER_REST_OPINION_URI.test(doc.documentSourceUri)) return true;
  if(doc.documentArtifactSource!=='courtlistener_bulk') return false;
  const parsed=parseBulkOpinionSourceUri(doc.documentSourceUri);
  if(!parsed) return false;
  if(!doc.documentSourceRecordId||parsed.opinionId!==doc.documentSourceRecordId) return false;
  if(!doc.opinionProviderId||parsed.opinionId!==doc.opinionProviderId) return false;
  if(!doc.clusterLinked) return false;
  return true;
}

/**
 * Opinion-document publication checks (thin text, document provenance, verified opinion
 * source, existing publication/review restriction, sensitive text). Shared by the cited
 * publisher and the deterministic federal publisher so a document faces the same bar
 * whichever path reaches it.
 */
export function federalOpinionDocumentReasons(doc: FederalOpinionDocumentChecks): string[] {
  const reasons: string[]=[];
  if(doc.wordCount<100) reasons.push('thin_opinion');
  if(!/^[a-f0-9]{64}$/.test(doc.documentHash)||!doc.artifactHash) reasons.push('missing_document_provenance');
  if(!isVerifiedCourtListenerOpinionSource(doc)) reasons.push('unverified_opinion_source');
  if(doc.blocked) reasons.push('existing_publication_or_review_restriction');
  if(/\b\d{3}-\d{2}-\d{4}\b|\b(?:date of birth|social security number)\b/i.test(doc.contentText)) reasons.push('sensitive_opinion_text');
  return reasons;
}

export function citedOpinionPublicationReasons(candidate: Candidate): string[] {
  return [
    ...evaluateFederalPublicationCandidate(candidate).reasons,
    ...federalOpinionDocumentReasons(candidate),
  ];
}
export async function publishCitedFederalOpinions(sql: Sql, limit:number) {
  const candidates=await sql<Candidate[]>`
    SELECT c.id AS "caseId", d.id AS "documentId", c.publication, d.publication AS "documentPublication",
      c.caption, c.docket_number AS "docketNumber", court.jurisdiction AS "courtJurisdiction",
      court.provider_court_id AS "courtProviderId", court.verification AS "courtVerification",
      a.id AS "sourceArtifactId", p.code AS "sourceProviderCode", a.source_record_id AS "sourceRecordId",
      a.source_uri AS "sourceUri", a.content_hash AS "sourceContentHash", a.retrieved_at::text AS "sourceRetrievedAt",
      true AS "hasReadableContent", null AS "canonicalIdentifier", 1 AS "canonicalIdentifierCount",
      (SELECT count(*)::int FROM legal_case collision WHERE collision.court_id=c.court_id AND nullif(trim(collision.docket_number),'') IS NOT NULL AND lower(trim(collision.docket_number))=lower(trim(c.docket_number))) AS "identityCollisionCount",
      (SELECT count(*)::int FROM ingestion_rejection rejection WHERE rejection.resolved_at IS NULL AND rejection.source_record_id=a.source_record_id) AS "unresolvedRejections",
      concat_ws(' ',c.caption,d.title,content.content_text) AS "restrictedText",
      content.word_count AS "wordCount", content.content_text AS "contentText", content.content_hash AS "documentHash",
      da.content_hash AS "artifactHash", da.source_uri AS "documentSourceUri", dp.code AS "documentProvider",
      da.response_metadata->>'source' AS "documentArtifactSource", da.source_record_id AS "documentSourceRecordId",
      judicial.provider_opinion_id AS "opinionProviderId",
      (judicial.cluster_id IS NOT NULL AND EXISTS(SELECT 1 FROM opinion_cluster oc WHERE oc.id=judicial.cluster_id)) AS "clusterLinked",
      judicial.provider_opinion_id AS "providerScopedIdentifier",
      (da.source_record_id IS NOT NULL AND da.source_record_id = judicial.provider_opinion_id) AS "sourceRecordResolvesIdentity",
      (judicial.cluster_id IS NOT NULL AND EXISTS(SELECT 1 FROM opinion_cluster oc WHERE oc.id=judicial.cluster_id)
        AND court.provider_court_id IS NOT NULL) AS "courtCaseLinkageVerified",
      (c.verification IN ('conflict','needs_review')
        OR EXISTS(SELECT 1 FROM publication_decision pd WHERE pd.object_id IN(c.id,d.id) AND NOT pd.displayable)
        OR EXISTS(SELECT 1 FROM publication_review pr WHERE pr.object_id IN(c.id,d.id) AND (pr.status IN('rejected','needs_changes') OR (pr.reviewer_id IS NOT NULL AND pr.status<>'approved')))
      ) AS blocked
    FROM document d JOIN legal_case c ON c.id=d.case_id JOIN court ON court.id=c.court_id
    JOIN document_content content ON content.document_id=d.id
    JOIN judicial_opinion judicial ON judicial.document_id=d.id
    JOIN raw_artifact a ON a.id=c.source_artifact_id JOIN provider p ON p.id=a.provider_id
    JOIN raw_artifact da ON da.id=content.source_artifact_id JOIN provider dp ON dp.id=da.provider_id
    WHERE NOT EXISTS(SELECT 1 FROM citation_publication_hold h WHERE h.document_id=d.id AND h.content_hash=content.content_hash AND h.rule_version=${CITED_OPINION_RULE_VERSION})
      -- Cited: one of the case's unique citation keys is cited by another
      -- case's public opinion (index probes, no full-corpus materialization).
      AND EXISTS(SELECT 1 FROM case_citation_identity i
        WHERE i.case_id=c.id
          AND NOT EXISTS(SELECT 1 FROM case_citation_identity other WHERE other.citation_key=i.citation_key AND other.case_id<>i.case_id)
          AND ${sql.unsafe(publicCitationSourceExistsSql('i.citation_key', 'i.case_id'))})
      AND d.publication='draft' AND c.publication IN('draft','published')
      AND court.provider_court_id<>'scotus'
    ORDER BY d.created_at,d.id LIMIT ${limit}
  `;
  let published=0,held=0;
  for(const candidate of candidates){
    const reasons=citedOpinionPublicationReasons(candidate);
    if(reasons.length){
      held++;
      await sql`INSERT INTO citation_publication_hold(document_id,content_hash,reasons,rule_version) VALUES(${candidate.documentId},${candidate.documentHash},${reasons},${CITED_OPINION_RULE_VERSION}) ON CONFLICT(document_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,reasons=EXCLUDED.reasons,rule_version=EXCLUDED.rule_version,held_at=now()`;
      await sql`UPDATE missing_case_citation SET state='held',detail=${reasons.join(',')},updated_at=now()
        WHERE state='ingested' AND citation_key IN(SELECT citation_key FROM case_citation_identity WHERE case_id=${candidate.caseId})`;
      continue;
    }
    const didPublish=await sql.begin(async tx=>{
      // Serialize with suppression/review writes and recheck publication decisions
      // after locks are acquired; never reactivate a restricted existing record.
      const [current]=await tx<{publication:string}[]>`SELECT publication FROM legal_case WHERE verification NOT IN ('conflict','needs_review') AND id=${candidate.caseId} FOR UPDATE`;
      const [document]=await tx<{publication:string; content_hash:string}[]>`SELECT publication, content_hash FROM document WHERE id=${candidate.documentId} FOR UPDATE`;
      const [content]=await tx<{content_hash:string}[]>`SELECT content_hash FROM document_content WHERE document_id=${candidate.documentId} FOR UPDATE`;
      if(content?.content_hash!==candidate.documentHash)return false;
      if(!current||!['draft','published'].includes(current.publication)||document?.publication!=='draft'||document.content_hash!==candidate.documentHash)return false;
      const [restriction]=await tx<{blocked:boolean}[]>`SELECT
        EXISTS(SELECT 1 FROM publication_decision WHERE object_id IN(${candidate.caseId},${candidate.documentId}) AND NOT displayable)
        OR EXISTS(SELECT 1 FROM publication_review WHERE object_id IN(${candidate.caseId},${candidate.documentId}) AND (status IN('rejected','needs_changes') OR (reviewer_id IS NOT NULL AND status<>'approved'))) AS blocked`;
      if(restriction?.blocked)return false;
      await tx`UPDATE legal_case SET publication='published',verification='verified',updated_at=now() WHERE id=${candidate.caseId}`;
      await tx`UPDATE document SET publication='published',updated_at=now() WHERE id=${candidate.documentId}`;
      for(const [type,id] of [['legal_case',candidate.caseId],['document',candidate.documentId]]){
        await tx`INSERT INTO publication_decision(object_type,object_id,displayable,indexable,machine_accessible,downloadable,summary_eligible,reason_code,rule_version)
          VALUES(${type!},${id!},true,true,true,false,false,'verified_cited_federal_opinion',${CITED_OPINION_RULE_VERSION})`;
        await tx`INSERT INTO outbox_event(topic,aggregate_type,aggregate_id,aggregate_version,payload)
          VALUES('publication.changed',${type!},${id!},(extract(epoch from clock_timestamp())*1000000)::bigint,${tx.json({policy:CITED_OPINION_RULE_VERSION})})`;
      }
      return true;
    });
    if(didPublish)published++; else held++;
  }
  return {published,held};
}
