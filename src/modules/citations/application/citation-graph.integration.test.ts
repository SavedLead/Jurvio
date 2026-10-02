import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { syncCitationGraph } from './sync-citation-graph';
import { publishCitedFederalOpinions } from './publish-cited-federal-opinions';
import { publicCitationTargets, relatedCitationCases } from './public-citations';
const databaseUrl=process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('citation graph database integration',()=>{
  it('backfills, updates, hides restricted edges and refuses ambiguous identities',async()=>{
    const sql=postgres(databaseUrl!,{max:1,onnotice:()=>{}});
    const schema=`citation_test_${randomUUID().replaceAll('-','')}`;
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public`);
      for(const name of ['0001_foundation.sql','0010_opinion_research.sql']) {
        const source=await readFile(`db/migrations/${name}`,'utf8');
        await sql.unsafe(source.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
      }
      await sql`ALTER TABLE legal_case ADD COLUMN official_citation text, ADD COLUMN decided_on date`;
      await sql.unsafe(await readFile('db/migrations/0114_case_citation_graph.sql','utf8'));
      await sql.unsafe(await readFile('db/migrations/0115_citation_reporter_refresh.sql','utf8'));
      const [provider]=await sql<{id:string}[]>`SELECT id FROM provider WHERE code='courtlistener'`;
      const [artifact]=await sql<{id:string}[]>`INSERT INTO raw_artifact(provider_id,source_uri,content_hash,object_key,media_type,retrieved_at) VALUES(${provider!.id},'https://www.courtlistener.com/api/rest/v4/opinions/2/',${'a'.repeat(64)},'fixture','application/json',now()) RETURNING id`;
      const [court]=await sql<{id:string}[]>`INSERT INTO court(public_id,name,verification) VALUES('jc-test1234','Test Court','verified') RETURNING id`;
      async function addCase(publicId:string,citation:string|null,caption:string){
        const [row]=await sql<{id:string}[]>`INSERT INTO legal_case(public_id,court_id,docket_number,caption,publication,verification,official_citation) VALUES(${publicId},${court!.id},${publicId},${caption},'published','verified',${citation}) RETURNING id`;
        await sql`INSERT INTO publication_decision(object_type,object_id,displayable,indexable,machine_accessible,downloadable,summary_eligible,reason_code,rule_version) VALUES('legal_case',${row!.id},true,true,true,false,false,'fixture','v1')`;
        return row!.id;
      }
      const sourceId=await addCase('jv-source12',null,'Source v. Agency');
      const targetId=await addCase('jv-target12','347 U. S. 483','Brown v. Board');
      const [document]=await sql<{id:string}[]>`INSERT INTO document(public_id,case_id,document_type,title,publication,content_hash) VALUES('jd-source12',${sourceId},'judicial_opinion','Source opinion','published','first') RETURNING id`;
      await sql`INSERT INTO publication_decision(object_type,object_id,displayable,indexable,machine_accessible,downloadable,summary_eligible,reason_code,rule_version) VALUES('document',${document!.id},true,true,true,false,false,'fixture','v1')`;
      await sql`INSERT INTO document_content(document_id,content_html,content_text,content_hash,extraction_method,word_count,source_artifact_id) VALUES(${document!.id},'<p>347 U.S. 483</p>','347 U.S. 483','first','fixture',3,${artifact!.id})`;
      expect(await syncCitationGraph(sql,100)).toEqual({identities:1,documents:1});
      expect((await publicCitationTargets(sql,'See 347 U.S. 483'))[0]?.casePublicId).toBe('jv-target12');
      expect((await relatedCitationCases(sql,'jv-source12','cited'))[0]?.casePublicId).toBe('jv-target12');
      expect((await relatedCitationCases(sql,'jv-target12','citing'))[0]?.casePublicId).toBe('jv-source12');
      // Verified parallel citations are source-backed, durable and rebuildable.
      await sql`INSERT INTO case_citation_verified_alias(case_id,citation_key,citation_label,source_artifact_id)
        VALUES(${targetId},'100ny2d1','100 N.Y.2d 1',${artifact!.id})`;
      await syncCitationGraph(sql,100);
      expect((await publicCitationTargets(sql,'100 N.Y.2d 1'))[0]?.casePublicId).toBe('jv-target12');
      await sql`DELETE FROM case_citation_verified_alias WHERE case_id=${targetId}`;
      await syncCitationGraph(sql,100);
      expect(await publicCitationTargets(sql,'100 N.Y.2d 1')).toEqual([]);
      await sql`UPDATE document SET publication='suppressed' WHERE id=${document!.id}`;
      expect(await relatedCitationCases(sql,'jv-target12','citing')).toEqual([]);
      await sql`UPDATE document SET publication='published' WHERE id=${document!.id}`;
      await sql`UPDATE legal_case SET publication='restricted' WHERE id=${targetId}`;
      expect(await publicCitationTargets(sql,'347 U.S. 483')).toEqual([]);
      expect(await relatedCitationCases(sql,'jv-source12','cited')).toEqual([]);
      await sql`UPDATE legal_case SET publication='published' WHERE id=${targetId}`;
      const collision=await addCase('jv-hidden12','347 U.S. 483','Another case');
      await sql`UPDATE legal_case SET publication='suppressed' WHERE id=${collision}`;
      await syncCitationGraph(sql,100);
      expect(await publicCitationTargets(sql,'347 U.S. 483')).toEqual([]);
      expect(await relatedCitationCases(sql,'jv-source12','cited')).toEqual([]);
      await sql`DELETE FROM legal_case WHERE id=${collision}`;
      await sql`UPDATE document_content SET content_text='No case citations remain',content_html='<p>No case citations remain</p>',content_hash='second' WHERE document_id=${document!.id}`;
      // Old edges disappear immediately on source revision, before the worker.
      expect(await relatedCitationCases(sql,'jv-target12','citing')).toEqual([]);
      await syncCitationGraph(sql,100);
      expect(await sql`SELECT * FROM document_case_citation`).toHaveLength(0);
      expect(await syncCitationGraph(sql,100)).toEqual({identities:0,documents:0});
      // Structured provider metadata also contributes identities.
      await sql`INSERT INTO opinion_cluster(public_id,case_id,provider_id,provider_cluster_id,case_name,citations,source_artifact_id) VALUES('jo-cluster1',${targetId},${provider!.id},'123','Brown v. Board',${sql.json([{volume:98,reporter:'S. Ct.',page:'456'}])},${artifact!.id})`;
      await syncCitationGraph(sql,100);
      expect((await publicCitationTargets(sql,'98 S. Ct. 456'))[0]?.casePublicId).toBe('jv-target12');
      const sourceLink='<p><a href="https://www.courtlistener.com/opinion/123/brown/">Brown v. Board</a></p>';
      await sql`UPDATE document_content SET content_html=${sourceLink},content_text='Brown v. Board',content_hash='source-link' WHERE document_id=${document!.id}`;
      await syncCitationGraph(sql,100);
      expect((await publicCitationTargets(sql,'Brown v. Board',sourceLink))[0]?.casePublicId).toBe('jv-target12');
      expect((await relatedCitationCases(sql,'jv-target12','citing'))[0]?.casePublicId).toBe('jv-source12');
      // Validate the publication SQL against the actual table contract.
      await sql`CREATE TABLE ingestion_rejection(source_record_id text,resolved_at timestamptz)`;
      await sql`CREATE TABLE publication_review(object_id uuid,status text,reviewer_id uuid)`;
      await sql`UPDATE court SET provider_court_id='ca2',jurisdiction='f' WHERE id=${court!.id}`;
      await sql`UPDATE legal_case SET source_artifact_id=${artifact!.id} WHERE id=${targetId}`;
      const [targetDoc]=await sql<{id:string}[]>`INSERT INTO document(public_id,case_id,document_type,title,publication,content_hash) VALUES('jd-target12',${targetId},'judicial_opinion','Brown opinion','draft',${'b'.repeat(64)}) RETURNING id`;
      const [cluster]=await sql<{id:string}[]>`SELECT id FROM opinion_cluster WHERE case_id=${targetId}`;
      await sql`INSERT INTO judicial_opinion(cluster_id,document_id,provider_id,provider_opinion_id,opinion_type,source_artifact_id) VALUES(${cluster!.id},${targetDoc!.id},${provider!.id},'2','majority',${artifact!.id})`;
      await sql`INSERT INTO document_content(document_id,content_html,content_text,content_hash,extraction_method,word_count,source_artifact_id) VALUES(${targetDoc!.id},'<p>Public court text</p>',${'Public court text '.repeat(50)},${'b'.repeat(64)},'fixture',150,${artifact!.id})`;
      await sql`UPDATE document_content SET content_text='See 347 U.S. 483',content_hash='cite-brown' WHERE document_id=${document!.id}`;
      await syncCitationGraph(sql,100);
      expect(await publishCitedFederalOpinions(sql,100)).toEqual({published:1,held:0});
      expect((await sql`SELECT publication FROM document WHERE id=${targetDoc!.id}`)[0]?.publication).toBe('published');
      expect(await publishCitedFederalOpinions(sql,100)).toEqual({published:0,held:0});
      await sql`UPDATE document SET publication='draft' WHERE id=${targetDoc!.id}`;
      await sql`INSERT INTO publication_decision(object_type,object_id,displayable,indexable,machine_accessible,downloadable,summary_eligible,reason_code,rule_version) VALUES('document',${targetDoc!.id},false,false,false,false,false,'privacy','v2')`;
      expect(await publishCitedFederalOpinions(sql,100)).toEqual({published:0,held:1});
      expect((await sql`SELECT publication FROM document WHERE id=${targetDoc!.id}`)[0]?.publication).toBe('draft');
      expect(await publishCitedFederalOpinions(sql,100)).toEqual({published:0,held:0});
      // Unknown citations enter durable discovery, without guessing a target.
      await sql`UPDATE document_content SET content_text='See 123 F.3d 456',content_hash='third' WHERE document_id=${document!.id}`;
      await syncCitationGraph(sql,100);
      expect(await sql`SELECT citation_key FROM missing_case_citation WHERE citation_key='123f3d456'`).toEqual([expect.objectContaining({citation_key:'123f3d456'})]);
    } finally {
      await sql.unsafe(`SET search_path TO public; DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>undefined);
      await sql.end();
    }
  },30000);
});
