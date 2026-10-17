import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

test('actual workerd HTTP + SQLite persistence: two-way traffic, concurrent claims, restart, revoked grants, no egress', {timeout:60000}, async t => {
  const directory=await mkdtemp(join(tmpdir(),'jarvis-project-workerd-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const config=JSON.parse(await readFile(new URL('../backend/wrangler.jsonc',import.meta.url),'utf8'));
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./helpers/project-workerd-fixture.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  let egress=0, mf;
  const start=()=>new Miniflare(convertV4MiniflareOptions({name:'project-local-test',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:config.compatibility_date,cf:false,telemetry:{enabled:false},resourcePersistencePath:directory,
    bindings:{RELAY_MCP_ENABLED:'true',RELAY_OWNER_ENABLED:'true',RELAY_PROJECT_ENABLED:'true',RELAY_PROJECT_ADMIN_ENABLED:'true',RELAY_MCP_ORIGIN:'https://local.project.test'},
    durableObjects:{HUBS:{className:'ProjectFixtureHub',useSQLite:true}},outboundService(){egress++;throw Error('No external requests allowed');}}));
  mf=start(); t.after(async()=>{if(mf)await mf.dispose();});
  const http=async(path,body,token)=>{
    const r=await mf.dispatchFetch('https://local.project.test'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await r.text();
    assert.ok(text.startsWith('{'),'Expected fixture JSON: '+text);
    return {status:r.status,data:JSON.parse(text)};
  };
  const seed=(await http('/__fixture/seed')).data;
  const call=(op,args,who='lucy')=>http('/relay/projects/jarvis/'+op,args,seed.grants[who].token);
  assert.equal((await call('identity')).data.agent,'lucy');
  const input={idempotencyKey:crypto.randomUUID(),recipient:'mast',kind:'request',body:'Local workerd request'};
  const first=await call('send',input); assert.equal(first.status,200);
  const id=first.data.message.id;
  const claims=await Promise.all(Array.from({length:8},()=>call('claim',{messageId:id,runId:crypto.randomUUID()},'mast')));
  assert.equal(claims.filter(x=>x.status===200).length,1);
  const claim=claims.find(x=>x.status===200).data;
  const lease={claimId:claim.claimId,runId:claim.work.runId,fence:claim.work.fence};
  const events=(await call('events',undefined,'mast')).data.events;
  await call('ack',{eventIds:events.map(x=>x.id)},'mast');
  const response=await call('send',{idempotencyKey:crypto.randomUUID(),recipient:'lucy',kind:'reply',body:'Durably accepted',replyTo:id,...lease},'mast');
  assert.equal(response.status,200);
  const replyId=response.data.message.id;
  // Recreate the actual isolate and DO, preserving only its disk storage.
  await mf.dispose(); mf=start();
  const again=await call('send',input); assert.equal(again.data.duplicate,true,JSON.stringify(again)); assert.equal(again.data.message.id,id);
  assert.equal((await call('events',undefined,'mast')).data.events.length,0);
  assert.equal((await call('events?mode=replay',undefined,'mast')).data.events.length,1);
  const returnEvents=(await call('events')).data.events;
  assert.equal(returnEvents.length,1); assert.equal(returnEvents[0].messageId,replyId);
  const detail=(await call('message?messageId='+id)).data;
  assert.equal(detail.acceptedReply.id,replyId); assert.equal(detail.work.state,'claimed');
  const finished=await call('result',{messageId:id,...lease,outcome:'completed',replyId,summary:'Persisted across restart'},'mast');
  assert.equal(finished.status,200);
  assert.equal((await call('work?mode=all',undefined,'mast')).data.work[0].state,'reported');
  assert.equal((await call('work?mode=all',undefined,'mast')).data.work[0].result.verification,'held');
  assert.equal((await http('/relay/projects/other-project/message?messageId='+id,undefined,seed.grants.other.token)).status,404);
  assert.equal((await http('/relay/projects/jarvis/messages',undefined,seed.grants.other.token)).status,403);
  assert.equal((await http('/relay/projects/_grants',{op:'revoke',grantId:seed.grants.mast.grantId,confirm:true},seed.access)).status,200);
  assert.equal((await call('identity',undefined,'mast')).status,401);
  assert.equal((await call('renew',{messageId:id,...lease},'mast')).status,401);
  assert.equal(egress,0);
});
