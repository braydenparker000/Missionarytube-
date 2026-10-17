import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('current-work presentation measures bounded physical reads and no idle summary work', {timeout:60000},async()=>{
  const config=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./helpers/relay-owner-work-cost-worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});let egress=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'local-owner-work-cost',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags||[],cf:false,telemetry:{enabled:false},durableObjects:{HUBS:{className:'OwnerWorkCostFixture',useSQLite:true}},outboundService(){egress++;throw Error('No external fixture requests');}}));
  try{
    assert.equal((await mf.dispatchFetch('https://fictional.example.test/seed')).status,200);
    const baseline=await (await mf.dispatchFetch('https://fictional.example.test/baseline')).json(),view=await (await mf.dispatchFetch('https://fictional.example.test/presentation')).json(),idle=await (await mf.dispatchFetch('https://fictional.example.test/idle')).json();
    const added=view.rowsRead-baseline.rowsRead;process.stdout.write('LOCAL_OWNER_WORK_COST '+JSON.stringify({synthetic:true,retainedJobs:5000,heartbeatTail:99,baseline:baseline.rowsRead,presentation:view.rowsRead,added,emptyDelta:idle.rowsRead,externalRequests:egress})+'\n');
    const sparseBaseline=await (await mf.dispatchFetch('https://fictional.example.test/baseline?after=2500')).json(),sparse=await (await mf.dispatchFetch('https://fictional.example.test/presentation?after=2500')).json();assert.ok(sparse.rowsRead-sparseBaseline.rowsRead<=4);process.stdout.write('LOCAL_OWNER_WORK_SPARSE '+JSON.stringify({addedPhysicalRows:sparse.rowsRead-sparseBaseline.rowsRead})+'\n');
    assert.equal(baseline.jobs,1);assert.equal(view.jobs,1);assert.equal(view.latestSummary,'Fictional meaningful progress.');assert.ok(added>=100&&added<=104,'Physical lookup is bounded by one job event budget, rather than unrelated history');
    assert.equal(idle.jobs,0);assert.equal(idle.queries.some(q=>q.query.includes('ORDER BY seq DESC LIMIT 1')),false,'No summary lookup on an unchanged delta');assert.ok(idle.rowsRead<40);assert.equal(egress,0);
    const plans=await (await mf.dispatchFetch('https://fictional.example.test/plans')).json();assert.ok(plans.plans.some(line=>line.includes('relay_owner_job_event_order')));
  }finally{await mf.dispose();}
});
