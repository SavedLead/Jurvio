import postgres from 'postgres';
import { env } from '@/lib/config/env';
import { createArtifactStore } from '@/modules/ingestion/infrastructure/create-artifact-store';
import { syncCitationGraph } from '@/modules/citations/application/sync-citation-graph';
import { discoverMissingCases } from '@/modules/citations/application/discover-missing-cases';
import { publishCitedFederalOpinions } from '@/modules/citations/application/publish-cited-federal-opinions';
const args=new Map(process.argv.slice(2).map(value=>{const [key,raw='true']=value.replace(/^--/,'').split('=',2);return [key!,raw];}));
const limit=Number(args.get('limit')??1000), discover=Number(args.get('discover')??10);
if (!Number.isInteger(limit)||limit<1||limit>5000||!Number.isInteger(discover)||discover<0||discover>20) throw new Error('Invalid citation batch limits');
// One connection keeps the session advisory lock attached to this worker.
const sql=postgres(env().DATABASE_URL,{max:1});
try {
  // Notice a disconnected worker during long queries so a replaced container
  // cannot retain this session's advisory lock indefinitely.
  await sql`SET client_connection_check_interval='5s'`;
  const [lock]=await sql<{locked:boolean}[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-case-citations-v1')) AS locked`;
  if (!lock?.locked) console.log(JSON.stringify({skipped:'citation worker already running'}));
  else {
    const synced=await syncCitationGraph(sql,limit);
    const found=discover ? await discoverMissingCases(sql,createArtifactStore({localRoot:process.env.JURVIO_ARTIFACT_ROOT??'.data/artifacts'}),discover) : null;
    const publication=await publishCitedFederalOpinions(sql,limit);
    const [backlog]=await sql`SELECT
      (SELECT count(*) FROM case_citation_work) AS identities_remaining,
      (SELECT count(*) FROM document_citation_work) AS documents_remaining,
      (SELECT count(*) FROM missing_case_citation WHERE state='pending') AS discovery_remaining,
      (SELECT count(*) FROM missing_case_citation WHERE state IN ('held','ambiguous','not_found')) AS needs_attention`;
    console.log(JSON.stringify({synced,found,publication,backlog}));
  }
} finally { await sql.end(); }
