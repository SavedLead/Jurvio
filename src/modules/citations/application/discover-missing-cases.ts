import type postgres from "postgres";
import type { ArtifactStore } from "@/modules/ingestion/application/artifact-store";
import { fetchCitationLookup, fetchOpinionCluster, fetchDocket } from "@/modules/ingestion/providers/courtlistener/client";
import { ingestCourtListenerOpinionCluster } from "@/modules/ingestion/application/ingest-courtlistener-opinion-cluster";
import { ingestOfficialScotusBoundVolume } from "@/modules/ingestion/application/ingest-official-scotus-bound-volume";
import { identityCitations, citationKey } from "../domain/citations";
type Sql = ReturnType<typeof postgres>;
export async function discoverMissingCases(sql: Sql, store: ArtifactStore, limit: number) {
  // Do not spend source requests rediscovering local cases before their identity
  // backfill is complete. Publication restrictions are never reset here.
  const [backlog] = await sql<{waiting: boolean}[]>`SELECT EXISTS(SELECT 1 FROM case_citation_work) AS waiting`;
  if (backlog?.waiting) return {discovered:0, held:0, deferred:'identity_backfill'};
  const citations = await sql<{citation_key:string; citation_label:string}[]>`
    SELECT missing.citation_key, missing.citation_label FROM missing_case_citation missing
    WHERE missing.state IN ('pending','not_found','ambiguous') AND missing.next_attempt_at<=now()
      AND NOT EXISTS(SELECT 1 FROM case_citation_identity i WHERE i.citation_key=missing.citation_key)
      AND EXISTS(
        SELECT 1 FROM document_case_citation ref
        JOIN document d ON d.id=ref.document_id JOIN legal_case c ON c.id=d.case_id
        JOIN document_content content ON content.document_id=d.id AND content.content_hash=ref.source_content_hash
        WHERE ref.citation_key=missing.citation_key AND d.publication='published' AND c.publication='published'
          AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=c.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
          AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='document' AND object_id=d.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
      )
    ORDER BY missing.next_attempt_at, missing.citation_key LIMIT ${limit}
  `;
  let discovered=0, held=0, volumeFetched=false;
  for (const cite of citations) {
    try {
      const clusterId=cite.citation_key.startsWith('cl-cluster:') ? Number(cite.citation_key.slice('cl-cluster:'.length)) : null;
      const lookup=clusterId ? await fetchOpinionCluster(clusterId).then(retrieved=>({...retrieved,record:[{status:200,clusters:[retrieved.record]}]})) : await fetchCitationLookup(cite.citation_label);
      const [provider]=await sql<{id:string}[]>`SELECT id FROM provider WHERE code='courtlistener'`;
      if (!provider) throw new Error('CourtListener provider seed is missing');
      const stored=await store.putIfAbsent({key:`courtlistener/citation-lookup/${lookup.contentHash}.json`,mediaType:'application/json',body:lookup.rawBody,contentHash:lookup.contentHash});
      const [artifact]=await sql<{id:string}[]>`
        INSERT INTO raw_artifact(provider_id,source_uri,source_record_id,content_hash,object_key,media_type,retrieved_at,response_metadata)
        VALUES(${provider.id},${lookup.sourceUri},${cite.citation_key},${lookup.contentHash},${stored.objectKey},'application/json',${lookup.retrievedAt},${sql.json(lookup.responseMetadata)})
        ON CONFLICT(provider_id,source_uri,content_hash) DO UPDATE SET retrieved_at=EXCLUDED.retrieved_at RETURNING id
      `;
      if (!artifact) throw new Error('Citation lookup provenance was not persisted');
      const result=lookup.record[0];
      const matching=result?.status===200 && result.clusters.length===1
        && (clusterId ? result.clusters[0]?.id===clusterId : identityCitations(result.clusters[0]?.citations).some(label=>citationKey(label)===cite.citation_key));
      if (!matching) {
        const state=result?.status===300 || (result?.clusters.length??0)>1 ? 'ambiguous' : result?.status===429 ? 'pending' : 'not_found';
        await sql`UPDATE missing_case_citation SET state=${state},source_artifact_id=${artifact.id},attempts=attempts+1,
          next_attempt_at=now()+interval '1 day',detail=${`Citation lookup status ${result?.status??'empty'}`},updated_at=now() WHERE citation_key=${cite.citation_key}`;
        held++;
        if(result?.status===429) break;
        continue;
      }
      const cluster=result!.clusters[0]!;
      // SCOTUS docket numbers are reused by Term. Use the existing official
      // volume importer and publisher, rather than merging by docket alone.
      const usReport=identityCitations(cluster.citations).find(label=>/^\d+\s+U\.?\s*S\.?\s+\d+$/.test(label));
      let scotus=Boolean(usReport);
      if (!scotus) {
        const sourceCluster=await fetchOpinionCluster(cluster.id);
        const reference=sourceCluster.record.docket_id??sourceCluster.record.docket;
        const docketId=typeof reference==='number' ? reference : Number(reference.split('/').filter(Boolean).at(-1));
        const docket=await fetchDocket(docketId);
        scotus=docket.record.court.split('/').filter(Boolean).at(-1)==='scotus';
      }
      if (scotus && !usReport) {
        await sql`UPDATE missing_case_citation SET state='held',detail='Requires official Supreme Court slip-opinion discovery; recycled docket identity was not used',source_artifact_id=${artifact.id},updated_at=now() WHERE citation_key=${cite.citation_key}`;
        held++; continue;
      }
      if (usReport) {
        if (volumeFetched) continue;
        const volume=Number.parseInt(usReport,10);
        if (volume<2 || volume>587) {
          await sql`UPDATE missing_case_citation SET state='held',detail='Requires official Supreme Court slip-opinion discovery',source_artifact_id=${artifact.id},updated_at=now() WHERE citation_key=${cite.citation_key}`;
          held++; continue;
        }
        volumeFetched=true;
        await ingestOfficialScotusBoundVolume(sql,store,{volume,limit:100,resume:true});
        // Keep pending until the official candidate becomes a canonical case.
        await sql`UPDATE missing_case_citation SET attempts=attempts+1,next_attempt_at=now()+interval '30 minutes',source_artifact_id=${artifact.id},detail='Official U.S. Reports discovery queued; existing verified publisher will process candidates',updated_at=now() WHERE citation_key=${cite.citation_key}`;
      } else {
        await ingestCourtListenerOpinionCluster(sql,store,cluster.id);
        await sql`UPDATE missing_case_citation SET state='ingested',attempts=attempts+1,source_artifact_id=${artifact.id},detail='Source and readable opinions ingested; existing publication review applies',updated_at=now() WHERE citation_key=${cite.citation_key}`;
      }
      discovered++;
    } catch(error) {
      // Retry source failures with durable backoff; never crash the entire queue.
      const message=error instanceof Error?error.message:String(error);
      await sql`UPDATE missing_case_citation SET attempts=attempts+1,next_attempt_at=now()+interval '1 hour',detail=${message.slice(0,500)},updated_at=now() WHERE citation_key=${cite.citation_key}`;
      held++;
      if (/429|401|403/.test(message)) break;
    }
  }
  return {discovered,held};
}
