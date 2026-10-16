import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BEFORE,SOURCE,checkedPaths,checkedBaseline,deploy} from './publish-makima-cookie.mjs';
test('Makima publisher pins only the reviewed repair and preserves the deployed Makima baseline',()=>{
 const paths=["backend/relay-makima-consent.js","backend/relay-makima-policy.js","backend/relay-oauth.js","tests/relay-makima-consent.test.js","tests/relay-makima-diagnostics.test.js","tests/relay-makima-double-submit-browser.test.js","tests/relay-makima.test.js"];
 checkedPaths(paths);assert.throws(()=>checkedPaths([...paths,'backend/relay-owner.js']));assert.throws(()=>checkedPaths(paths.slice(1)));
 checkedBaseline({...BEFORE,schedulesDigest:'synthetic'});
 for(const key of Object.keys(BEFORE))assert.throws(()=>checkedBaseline({...BEFORE,[key]:'changed'}));
 const workflow=readFileSync(new URL('../.github/workflows/publish-makima-cookie.yml',import.meta.url),'utf8');
 assert.ok(workflow.includes('ref: '+SOURCE));assert.match(workflow,/group: azure-production/);assert.match(workflow,/group: jarvis-worker-production/);
 assert.doesNotMatch(workflow,/azure\/login|publish-private-workspace|id-token: write/);
 assert.match(workflow,/makima-cookie-publication\/\*\.json/);
});
test('Makima publication refuses drift before checkpoint or write',async()=>{
 let writes=0,checkpoints=0;
 const fetcher=async(url,init)=>{
  if(init.method!=='GET'){writes++;throw Error('Unexpected write');}
  if(url.endsWith('/settings'))return Response.json({success:true,result:{compatibility_date:'2026-09-19',bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'synthetic'}]}});
  if(url.includes('/deployments?'))return Response.json({success:true,result:{deployments:[{id:'12345678-1234-1234-1234-123456789012',versions:[{version_id:BEFORE.version,percentage:100}]}]}});
  if(url.endsWith('/schedules'))return Response.json({success:true,result:[]});
  if(url.endsWith('/content/v2')){const f=new FormData();f.set('worker.js',new Blob(['different code']),'worker.js');return new Response(f);}
  throw Error('Unexpected read');
 };
 await assert.rejects(deploy({credentials:{account:'a'.repeat(32),token:'synthetic'},bundle:Buffer.from('candidate'),checkpoint:async()=>{checkpoints++;},fetcher}),/Production baseline changed: codeSha256/);
 assert.equal(writes,0);assert.equal(checkpoints,0);
});



