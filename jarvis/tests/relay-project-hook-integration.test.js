import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('Python hook through real workerd HTTP: maximum Unicode/escaped replies and two-way host notification receipts', {timeout:60000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'project-hook-http-')); t.after(()=>rm(directory,{recursive:true,force:true}));
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./helpers/project-workerd-fixture.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto']});
  const mf=new Miniflare(convertV4MiniflareOptions({name:'project-hook-http',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-19',cf:false,telemetry:{enabled:false},bindings:{RELAY_MCP_ENABLED:'true',RELAY_OWNER_ENABLED:'true',RELAY_PROJECT_ENABLED:'true',RELAY_PROJECT_ADMIN_ENABLED:'true',RELAY_MCP_ORIGIN:'https://local.project.test'},durableObjects:{HUBS:{className:'ProjectFixtureHub',useSQLite:true}},outboundService(){throw Error('No real network');}}));
  t.after(()=>mf.dispose());
  const seed=await (await mf.dispatchFetch('https://local.project.test/__fixture/seed')).json();
  const request=async(who,op,query,body)=>{
    const response=await mf.dispatchFetch('https://local.project.test/relay/projects/jarvis/'+op+(query&&Object.keys(query).length?'?'+new URLSearchParams(query):''),{method:body===null?'GET':'POST',headers:{Authorization:'Bearer '+seed.grants[who].token,...(body===null?{}:{'Content-Type':'application/json'})},...(body===null?{}:{body})});
    return {status:response.status,data:await response.json()};
  };
  async function bridge(who,mode,encoding){
    const child=spawn('python3',[fileURLToPath(new URL('./helpers/project-hook-bridge.py',import.meta.url)),join(directory,who+'.sqlite'),mode,encoding],{stdio:['pipe','pipe','pipe']});
    let stderr='',result;child.stderr.on('data',x=>stderr+=x);
    const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code));});
    for await(const line of createInterface({input:child.stdout})){
      const data=JSON.parse(line);
      if(data.request){const r=data.request;child.stdin.write(JSON.stringify(await request(who,r.op,r.query,r.body))+'\n');}
      else result=data.result;
    }
    assert.equal(await exited,0,stderr); return result;
  }
  for(const encoding of ['unicode','control']){
    const posted=await request('lucy','send',null,JSON.stringify({idempotencyKey:crypto.randomUUID(),recipient:'mast',kind:'request',body:'Test '+encoding}));
    assert.equal(posted.status,200);
    const completed=await bridge('mast','complete',encoding);assert.equal(completed.completed,true);
    const detail=await request('lucy','message',{messageId:posted.data.message.id},null);
    assert.equal(detail.data.work.state,'reported');assert.equal(detail.data.acceptedReply.body.length,6000);
    assert.equal((await bridge('lucy','notifications',encoding)).consumed,1);
  }
});
