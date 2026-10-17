import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('local workerd measures bounded cold/pending passes, warm reads, idle polling and full legacy KV cost', {timeout:30000},async()=>{
  const configuration=JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./helpers/relay-core-public-cost-worker.js',import.meta.url))],
    bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  let external=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'fictional-core-public-cost',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
    durableObjects:{HUBS:{className:'CorePublicCostFixture',useSQLite:true}},outboundService(){external++;throw Error('Live egress is forbidden in this fixture');}}));
  try{
    const request=async(path,mode)=>{const response=await mf.dispatchFetch('https://cost.example.test/'+path+'?mode='+mode+'&count=5000');
      assert.equal(response.status,200);return response.json();};
    for(const mode of ['warm','cold','pending','legacy','private'])await request('seed',mode);
    const results={state:await request('warm-state','warm'),changes:await request('warm-changes','warm'),
      cold:await request('pass','cold'),pending:await request('pass','pending'),legacy:await request('pass','legacy'),idle:await request('idle','warm'),
      private:await request('private-next','private')};
    process.stdout.write('LOCAL_CORE_PUBLIC_COST '+JSON.stringify(Object.fromEntries(Object.entries(results).map(([name,r])=>[name,
      {rowsRead:r.rowsRead,rowsWritten:r.rowsWritten,egress:r.egress,legacyFullKVReads:r.legacyFullKVReads,legacyFullKVBytes:r.legacyFullKVBytes,...r.result}])) )+'\n');
    assert.equal(results.state.result.count,200);assert.equal(results.state.egress,0);assert.equal(results.state.rowsWritten,0);
    assert.ok(results.state.rowsRead<300,'One warmed history page must not re-read history or processed comments');
    assert.equal(results.changes.result.count,100);assert.equal(results.changes.egress,0);assert.equal(results.changes.rowsWritten,0);
    assert.ok(results.changes.rowsRead<500,'Joined public page hydration must stay bounded');
    assert.equal(results.cold.result.indexed,100);assert.equal(results.cold.result.nextDelay,60000);
    assert.ok(results.cold.rowsRead<500);assert.ok(results.cold.rowsWritten<400);assert.equal(results.cold.egress,1);
    assert.ok(results.pending.result.work.pending.hourly<=600);assert.ok(results.pending.rowsRead<4000);
    assert.ok(results.pending.rowsWritten<100);assert.equal(results.pending.egress,1);
    assert.equal(results.legacy.result.legacyAfter,100);assert.equal(results.legacy.legacyFullKVReads,1);
    assert.ok(results.legacy.legacyFullKVBytes>30000&&results.legacy.legacyFullKVBytes<=100000,
      'A bounded output page still reads the entire fixed old KV blob');
    assert.ok(results.legacy.rowsRead<600);assert.ok(results.legacy.rowsWritten<600);assert.equal(results.legacy.egress,1);
    assert.equal(results.idle.egress,1);assert.ok(results.idle.rowsRead<120);assert.ok(results.idle.rowsWritten<40);
    assert.equal(results.private.result.next,null);assert.equal(results.private.rowsRead,0);assert.equal(results.private.rowsWritten,0);
    assert.equal(results.private.egress,0);assert.equal(results.private.legacyFullKVReads,0);
    assert.equal(external,0,'All provider responses are fictional');
  }finally{await mf.dispose();}
});
