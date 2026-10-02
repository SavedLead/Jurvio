import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverMissingCases } from './discover-missing-cases';

const source = vi.hoisted(() => ({lookup:vi.fn(), cluster:vi.fn(), docket:vi.fn(), ingest:vi.fn(), volume:vi.fn()}));
vi.mock('@/modules/ingestion/providers/courtlistener/client',()=>({fetchCitationLookup:source.lookup,fetchOpinionCluster:source.cluster,fetchDocket:source.docket}));
vi.mock('@/modules/ingestion/application/ingest-courtlistener-opinion-cluster',()=>({ingestCourtListenerOpinionCluster:source.ingest}));
vi.mock('@/modules/ingestion/application/ingest-official-scotus-bound-volume',()=>({ingestOfficialScotusBoundVolume:source.volume}));

function database(local: string[], label='123 F.3d 456') {
  const writes: {text:string; values:unknown[]}[]=[];
  const sql=Object.assign(async (parts:TemplateStringsArray,...values:unknown[])=>{
    const text=parts.join('?'); writes.push({text,values});
    if(text.includes('SELECT missing.citation_key'))return [{citation_key:label.startsWith('5 ') ? '5us137' : '123f3d456',citation_label:label}];
    if(text.includes("SELECT id FROM provider"))return [{id:'provider'}];
    if(text.includes('INSERT INTO raw_artifact'))return [{id:'artifact'}];
    if(text.includes('SELECT DISTINCT cl.case_id'))return local.map(case_id=>({case_id}));
    return [];
  },{json:(value:unknown)=>value});
  return {sql:sql as unknown as Parameters<typeof discoverMissingCases>[0],writes};
}
const store={putIfAbsent:vi.fn(async()=>({objectKey:'source-artifact'}))};
beforeEach(()=>{
  vi.clearAllMocks();
  source.lookup.mockResolvedValue({record:[{status:200,clusters:[{id:123,citations:[{volume:123,reporter:'F.3d',page:'456'}]}]}],contentHash:'hash',rawBody:'{}',sourceUri:'https://www.courtlistener.com/api/rest/v4/citation-lookup/',retrievedAt:new Date(),responseMetadata:{}});
  source.cluster.mockResolvedValue({record:{docket_id:55}});
  source.docket.mockResolvedValue({record:{court:'ca2'}});
});
describe('bounded missing-case discovery during identity backfill',()=>{
  it('prioritizes an exact local target instead of reingesting or resetting restrictions',async()=>{
    const {sql,writes}=database(['local-case']);
    expect(await discoverMissingCases(sql,store,10)).toEqual({discovered:0,held:0,matchedLocal:1});
    expect(source.ingest).not.toHaveBeenCalled();
    expect(source.volume).not.toHaveBeenCalled();
    expect(writes.some(write=>write.text.includes('INSERT INTO case_citation_work')&&write.values.includes('local-case'))).toBe(true);
    expect(writes.some(write=>write.text.includes('INSERT INTO case_citation_verified_alias')&&write.values.includes('artifact'))).toBe(true);
    expect(writes.some(write=>/(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:legal_case|publication_decision)\b/.test(write.text))).toBe(false);
  });
  it('does not guess when one provider cluster belongs to two local cases',async()=>{
    const {sql,writes}=database(['first-case','second-case']);
    expect(await discoverMissingCases(sql,store,10)).toEqual({discovered:0,held:1,matchedLocal:0});
    expect(writes.some(write=>write.text.includes("state='ambiguous'"))).toBe(true);
    expect(source.ingest).not.toHaveBeenCalled();
  });
  it('can acquire a genuinely missing federal source while unrelated identities remain queued',async()=>{
    const {sql,writes}=database([]);
    expect(await discoverMissingCases(sql,store,10)).toEqual({discovered:1,held:0,matchedLocal:0});
    expect(source.ingest).toHaveBeenCalledWith(sql,store,123);
    expect(writes.some(write=>write.text.includes('SELECT EXISTS(SELECT 1 FROM case_citation_work)'))).toBe(false);
  });
  it('retains uncertain lookup results without ingestion or publication',async()=>{
    source.lookup.mockResolvedValueOnce({record:[{status:300,clusters:[{id:123},{id:456}]}],contentHash:'hash',rawBody:'{}',sourceUri:'source',retrievedAt:new Date(),responseMetadata:{}});
    const {sql,writes}=database([]);
    expect(await discoverMissingCases(sql,store,10)).toEqual({discovered:0,held:1,matchedLocal:0});
    expect(writes.some(write=>write.values.includes('ambiguous'))).toBe(true);
    expect(source.ingest).not.toHaveBeenCalled();
    expect(store.putIfAbsent).toHaveBeenCalled();
  });
  it('routes old nominative Supreme Court citations to official volume discovery',async()=>{
    source.lookup.mockResolvedValueOnce({record:[{status:200,clusters:[{id:123,citations:['5 U.S. (1 Cranch) 137']}]}],contentHash:'hash',rawBody:'{}',sourceUri:'source',retrievedAt:new Date(),responseMetadata:{}});
    const {sql}=database([],'5 U.S. (1 Cranch) 137');
    expect(await discoverMissingCases(sql,store,10)).toEqual({discovered:1,held:0,matchedLocal:0});
    expect(source.volume).toHaveBeenCalledWith(sql,store,{volume:5,limit:100,resume:true});
    expect(source.ingest).not.toHaveBeenCalled();
  });
});
