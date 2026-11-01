import postgres from 'postgres';
import { env } from '@/lib/config/env';
import { createArtifactStore } from '@/modules/ingestion/infrastructure/create-artifact-store';
import { discoverMissingCases } from '@/modules/citations/application/discover-missing-cases';
import { publishCitedFederalOpinions } from '@/modules/citations/application/publish-cited-federal-opinions';
import { citationBacklog, runCitationLane } from '@/modules/citations/application/citation-lane';
const args=new Map(process.argv.slice(2).map(value=>{const [key,raw='true']=value.replace(/^--/,'').split('=',2);return [key!,raw];}));
const int=(name:string,fallback:number,min:number,max:number)=>{
  const value=Number(args.get(name)??fallback);
  if(!Number.isInteger(value)||value<min||value>max) throw new Error(`--${name} must be an integer ${min}-${max}`);
  return value;
};
// --limit: rows per queue per batch. --budget-seconds: keep starting batches
// until this much time has passed (0 = exactly one batch, the old behavior).
// --backfill-batches: backfill batches after live work is drained (-1 = until
// the budget ends). --mode=backfill: builder-run drain; skips live rows,
// discovery and publication, and uses its own advisory lock so it runs beside
// the resident lane (queue rows are claimed with SKIP LOCKED).
const limit=int('limit',1000,1,5000), discover=int('discover',10,0,20);
const budgetSeconds=int('budget-seconds',0,0,6*3600), pauseMs=int('pause-ms',0,0,60_000);
const backfillBatchesArg=int('backfill-batches',-1,-1,100_000), maxActive=int('max-active',0,0,200);
const publishLimit=int('publish-limit',Math.min(limit,200),1,5000);
const mode=args.get('mode')??'resident';
if(mode!=='resident'&&mode!=='backfill') throw new Error('--mode must be resident or backfill');
// Publishing can be paused independently of citation sync/discovery so a deploy can land
// with the resident publication lane held while a controlled pilot runs. Default: publish
// unless JURVIO_PAUSE_CITATION_PUBLISH=1 (which the resident scheduler worker carries). An
// explicit --publish=1 overrides the pause for a single manual invocation (the pilot);
// --publish=0 forces skip. Citation graph sync and discovery always run regardless.
const publishArg=args.get('publish');
if (publishArg!==undefined && publishArg!=='0' && publishArg!=='1') throw new Error('--publish must be 0 or 1');
const doPublish = mode==='resident' && (publishArg!==undefined ? publishArg==='1' : process.env.JURVIO_PAUSE_CITATION_PUBLISH!=='1');
const lockName = mode==='backfill' ? 'jurvio-case-citations-backfill-v1' : 'jurvio-case-citations-v1';
// One connection keeps the session advisory lock attached to this worker.
const sql=postgres(env().DATABASE_URL,{max:1,connection:{application_name:mode==='backfill'?'jurvio-citations-backfill':'jurvio-citations'}});
try {
  // Notice a disconnected worker during long queries so a replaced container
  // cannot retain this session's advisory lock indefinitely.
  await sql`SET client_connection_check_interval='5s'`;
  const [lock]=await sql<{locked:boolean}[]>`SELECT pg_try_advisory_lock(hashtext(${lockName})) AS locked`;
  if (!lock?.locked) console.log(JSON.stringify({skipped:`citation worker already running (${lockName})`}));
  else {
    // Never let one batch statement run away on the shared database. Only the
    // lane; discovery and publication keep their previous (unlimited) setting.
    await sql`SELECT set_config('statement_timeout', '120s', false)`;
    const synced=await runCitationLane(sql,{
      batch:limit,
      budgetMs:budgetSeconds*1000,
      pauseMs,
      // One batch when no budget is given (old behavior); otherwise as configured.
      backfillBatches: budgetSeconds===0 ? 1 : (backfillBatchesArg<0 ? Number.POSITIVE_INFINITY : backfillBatchesArg),
      backfillOnly: mode==='backfill',
      maxActiveSessions: maxActive,
    });
    await sql`SELECT set_config('statement_timeout', '0', false)`;
    const found=mode==='resident'&&discover ? await discoverMissingCases(sql,createArtifactStore({localRoot:process.env.JURVIO_ARTIFACT_ROOT??'.data/artifacts'}),discover) : null;
    const publication=doPublish ? await publishCitedFederalOpinions(sql,publishLimit) : {published:0,held:0,paused:true};
    const backlog=await citationBacklog(sql);
    console.log(JSON.stringify({mode,synced,found,publication,backlog}));
  }
} finally { await sql.end(); }
