import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('seeded workerd rows-read budgets: cooldown, rejected hint, registry, delivery, retention and FIFO alarm', {timeout:30000},async()=>{
  const configuration=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./helpers/relay-read-cost-worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  let egress=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'local-relay-read-cost',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
    durableObjects:{HUBS:{className:'ReadCostFixture',useSQLite:true}},outboundService(){egress++;throw Error('No external fixture requests');}}));
  try{
    assert.equal((await mf.dispatchFetch('https://cost.example.test/seed?count=5000')).status,200);
    const results={};
    for(const name of ['state','hint','registry','scheduler','delivery','retention']){
      results[name]=await (await mf.dispatchFetch('https://cost.example.test/'+name)).json();
      assert.equal(results[name].status,name==='hint'?429:200);
    }
    process.stdout.write('LOCAL_READ_COST '+JSON.stringify(Object.fromEntries(Object.entries(results).map(([name,r])=>[name,{rowsRead:r.rowsRead,status:r.status,...r.result}])) )+'\n');
    for(const [name,result] of Object.entries(results))if(result.rowsRead>700)
      process.stdout.write('LOCAL_COST_QUERIES '+JSON.stringify({name,queries:result.queries.filter(q=>q.rowsRead>100)})+'\n');
    assert.ok(results.state.rowsRead<700,'A warmed page must not read processed comment history');
    assert.equal(results.state.result.messages,200);assert.equal(results.state.result.nextCursor,'2200');
    assert.ok(results.hint.rowsRead<50,'A rejected hint must not read history/backlog');
    assert.ok(results.registry.rowsRead<10,'Registry get must not scan unexpired rows');
    assert.ok(results.delivery.rowsRead<20,'Delivery lookup must not scan retained outbox');
    assert.ok(results.retention.rowsRead<30,'Housekeeping must not scan an unexpired event journal');
    assert.equal(results.retention.result.eventsKept,5000);
    assert.equal(results.scheduler.result.delayMs,16000,'Later queued items cannot wake ahead of a deferred FIFO head');
    assert.equal(egress,0);
    const plans=await (await mf.dispatchFetch('https://cost.example.test/plans')).json();
    for(const [name,index] of Object.entries({pending:'imported_comments_status',pendingCount:'imported_comments_status',registryExpiry:'relay_oauth_expiry',registryClient:'relay_oauth_category_expiry',delivery:'relay_outbox_event',unsettled:'relay_outbox_unsettled'}))
      assert.ok(plans[name].some(line=>line.includes(index)),name+' must use its bounded index');
  }finally{await mf.dispose();}
});
