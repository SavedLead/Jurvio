import type postgres from 'postgres';
import { evaluateFederalPublicationCandidate, type FederalPublicationCandidate } from '@/modules/ingestion/domain/federal-stream';
type Sql=ReturnType<typeof postgres>;
interface Candidate extends FederalPublicationCandidate {
  caseId:string; documentId:string; publication:string; documentPublication:string;
  wordCount:number; contentText:string; documentHash:string; artifactHash:string;
  documentSourceUri:string; documentProvider:string; blocked:boolean;
}
export function citedOpinionPublicationReasons(candidate: Candidate): string[] {
  const reasons=evaluateFederalPublicationCandidate(candidate).reasons;
  if(candidate.wordCount<100) reasons.push('thin_opinion');
  if(!/^[a-f0-9]{64}$/.test(candidate.documentHash)||!candidate.artifactHash) reasons.push('missing_document_provenance');
  if(candidate.documentProvider!=='courtlistener'||!/^https:\/\/www\.courtlistener\.com\/api\/rest\/v[34]\/opinions\/\d+\/$/.test(candidate.documentSourceUri)) reasons.push('unverified_opinion_source');
  if(candidate.blocked) reasons.push('existing_publication_or_review_restriction');
  if(/\b\d{3}-\d{2}-\d{4}\b|\b(?:date of birth|social security number)\b/i.test(candidate.contentText)) reasons.push('sensitive_opinion_text');
  return reasons;
}
export async function publishCitedFederalOpinions(sql: Sql, limit:number) {
  const candidates=await sql<Candidate[]>`
    WITH visible_sources AS MATERIALIZED (
      SELECT d.id,d.case_id,content.content_hash FROM document d
      JOIN legal_case c ON c.id=d.case_id JOIN document_content content ON content.document_id=d.id
      WHERE d.publication='published' AND c.publication='published'
        AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=c.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
        AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='document' AND object_id=d.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
    ), public_citations AS MATERIALIZED (
      SELECT DISTINCT ref.citation_key,source.case_id FROM visible_sources source
      JOIN document_case_citation ref ON ref.document_id=source.id AND ref.source_content_hash=source.content_hash
    ), cited_targets AS MATERIALIZED (
      SELECT DISTINCT i.case_id FROM case_citation_identity i
      JOIN public_citations ref ON ref.citation_key=i.citation_key AND ref.case_id<>i.case_id
      WHERE NOT EXISTS(SELECT 1 FROM case_citation_identity other WHERE other.citation_key=i.citation_key AND other.case_id<>i.case_id)
    )
    SELECT c.id AS "caseId", d.id AS "documentId", c.publication, d.publication AS "documentPublication",
      c.caption, c.docket_number AS "docketNumber", court.jurisdiction AS "courtJurisdiction",
      court.provider_court_id AS "courtProviderId", court.verification AS "courtVerification",
      a.id AS "sourceArtifactId", p.code AS "sourceProviderCode", a.source_record_id AS "sourceRecordId",
      a.source_uri AS "sourceUri", a.content_hash AS "sourceContentHash", a.retrieved_at::text AS "sourceRetrievedAt",
      true AS "hasReadableContent", null AS "canonicalIdentifier", 1 AS "canonicalIdentifierCount",
      (SELECT count(*)::int FROM legal_case collision WHERE collision.court_id=c.court_id AND lower(trim(collision.docket_number))=lower(trim(c.docket_number))) AS "identityCollisionCount",
      (SELECT count(*)::int FROM ingestion_rejection rejection WHERE rejection.resolved_at IS NULL AND rejection.source_record_id=a.source_record_id) AS "unresolvedRejections",
      concat_ws(' ',c.caption,d.title,content.content_text) AS "restrictedText",
      content.word_count AS "wordCount", content.content_text AS "contentText", content.content_hash AS "documentHash",
      da.content_hash AS "artifactHash", da.source_uri AS "documentSourceUri", dp.code AS "documentProvider",
      (c.verification IN ('conflict','needs_review')
        OR EXISTS(SELECT 1 FROM publication_decision pd WHERE pd.object_id IN(c.id,d.id) AND NOT pd.displayable)
        OR EXISTS(SELECT 1 FROM publication_review pr WHERE pr.object_id IN(c.id,d.id) AND (pr.status IN('rejected','needs_changes') OR (pr.reviewer_id IS NOT NULL AND pr.status<>'approved')))
      ) AS blocked
    FROM document d JOIN legal_case c ON c.id=d.case_id JOIN court ON court.id=c.court_id
    JOIN cited_targets cited ON cited.case_id=c.id
    JOIN document_content content ON content.document_id=d.id
    JOIN judicial_opinion judicial ON judicial.document_id=d.id
    JOIN raw_artifact a ON a.id=c.source_artifact_id JOIN provider p ON p.id=a.provider_id
    JOIN raw_artifact da ON da.id=content.source_artifact_id JOIN provider dp ON dp.id=da.provider_id
    WHERE NOT EXISTS(SELECT 1 FROM citation_publication_hold h WHERE h.document_id=d.id AND h.content_hash=content.content_hash)
      AND d.publication='draft' AND c.publication IN('draft','published')
      AND court.provider_court_id<>'scotus'
    ORDER BY d.created_at,d.id LIMIT ${limit}
  `;
  let published=0,held=0;
  for(const candidate of candidates){
    const reasons=citedOpinionPublicationReasons(candidate);
    if(reasons.length){
      held++;
      await sql`INSERT INTO citation_publication_hold(document_id,content_hash,reasons) VALUES(${candidate.documentId},${candidate.documentHash},${reasons}) ON CONFLICT(document_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,reasons=EXCLUDED.reasons,held_at=now()`;
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
          VALUES(${type!},${id!},true,true,true,false,false,'verified_cited_federal_opinion','cited-opinion-publication-v1')`;
        await tx`INSERT INTO outbox_event(topic,aggregate_type,aggregate_id,aggregate_version,payload)
          VALUES('publication.changed',${type!},${id!},(extract(epoch from clock_timestamp())*1000000)::bigint,${tx.json({policy:'cited-opinion-publication-v1'})})`;
      }
      return true;
    });
    if(didPublish)published++; else held++;
  }
  return {published,held};
}
