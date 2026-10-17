import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {relayWebHandler} from '../relay-egress/adapters/web-handler.mjs';
const token='test-only-'+ 'x'.repeat(50);
const envelope={url:'https://receiver.example/callback',headers:{'Content-Type':'application/json','webhook-id':'evt_test','webhook-timestamp':'1791086400','webhook-signature':'v1,'+Buffer.alloc(32).toString('base64'),'X-MCP-Subscription-Id':'sub_test'},body:'{"eventId":"evt_test"}'};
test('common Node Web handler authenticates before body reads and bounds streamed payloads',async()=>{
  let reads=0;
  const denied={method:'POST',headers:new Headers({Authorization:'Bearer wrong'}),get body(){reads++;throw Error('Unauthorized body must not be read');}};
  const result=await relayWebHandler(denied,{token,webhookFetch:()=>{throw Error('No network');}});assert.equal(result.status,401);assert.equal(reads,0);
  const oversize=new Request('https://egress.example/api/relay-egress',{method:'POST',headers:{Authorization:'Bearer '+token},body:'x'.repeat(400001)});
  assert.equal((await relayWebHandler(oversize,{token})).status,413);
  const success=new Request('https://egress.example/api/relay-egress',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(envelope)});
  const accepted=await relayWebHandler(success,{token,webhookFetch:async(url,options)=>{assert.equal(url,envelope.url);assert.equal(options.body,envelope.body);assert.equal(options.headers.Authorization,undefined);return {status:204,body:''};}});
  assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{status:204,body:''});
});
for(const provider of ['azure','vercel','netlify'])test(`${provider} deployment package is complete, provider-local and does not deploy`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'relay-packages-'));t.after(()=>rm(root,{recursive:true,force:true}));const out=join(root,provider);
  const output=JSON.parse(execFileSync(process.execPath,['scripts/package-relay-egress.mjs','--provider',provider,'--outdir',out],{encoding:'utf8'}));assert.equal(output.deployed,false);assert.equal(output.endpoint,'/api/relay-egress');
  const canonical=await readFile('relay-egress/api/shared/pinned-https.mjs');
  const packaged=await readFile(join(out,provider==='azure'?'api/shared/pinned-https.mjs':'shared/pinned-https.mjs'));assert.equal(createHash('sha256').update(packaged).digest('hex'),createHash('sha256').update(canonical).digest('hex'));
  if(provider==='azure'){
    const config=JSON.parse(await readFile(join(out,'public/staticwebapp.config.json'),'utf8'));assert.equal(config.platform.apiRuntime,'node:22');
    const handler=(await import(pathToFileURL(join(out,'api/relay-egress/index.cjs')).href)).default;
    const response=await handler({}, {method:'POST',headers:{},rawBody:'{}'});assert.ok([401,503].includes(response.status));
  }else{
    const path=provider==='vercel'?'api/relay-egress.mjs':'netlify/functions/relay-egress.mjs',module=await import(pathToFileURL(join(out,path)).href);
    const response=await(provider==='vercel'?module.default.fetch(new Request('https://egress.example/api/relay-egress',{method:'POST',body:'{}'})):module.default(new Request('https://egress.example/api/relay-egress',{method:'POST',body:'{}'})));
    assert.ok([401,503].includes(response.status));if(provider==='netlify')assert.equal(module.config.path,'/api/relay-egress');
    if(provider==='vercel'){
      const config=JSON.parse(await readFile(join(out,'vercel.json'),'utf8'));
      assert.equal(config.framework,null);assert.equal(config.buildCommand,'');assert.equal(config.outputDirectory,'public');assert.equal(config.functions['api/relay-egress.mjs'].maxDuration,15);
      assert.deepEqual(await readdir(join(out,'public')),['index.html']);
      const walk=async(dir,base='')=>{const names=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=base?base+'/'+entry.name:entry.name;if(entry.isDirectory())names.push(...await walk(join(dir,entry.name),path));else names.push(path);}return names.sort();};
      const checked='deploy/relay-egress-vercel';
      assert.deepEqual(await walk(out),await walk(checked),'The importable Vercel source must match its generator');
      for(const path of await walk(out))assert.equal(await readFile(join(out,path),'utf8'),await readFile(join(checked,path),'utf8'),`Stale Vercel source: ${path}`);
    }
  }
  assert.throws(()=>execFileSync(process.execPath,['scripts/package-relay-egress.mjs','--provider',provider,'--outdir',out],{stdio:'pipe'}),'Must refuse existing output rather than overwrite source');
});
