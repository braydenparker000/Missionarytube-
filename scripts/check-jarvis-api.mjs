import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const release=JSON.parse(await readFile('jarvis-release.json','utf8'));
for(const origin of [release.storageOrigin,release.backupOrigin]) {
 for(const method of ['OPTIONS','GET']) {
  const response=await fetch(release.apiOrigin+'/health',{method,headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'},signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,method==='OPTIONS'?204:200,`${origin}: deploy the Cloudflare CORS change before cutover`);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  if(method==='GET')assert.ok((await response.json()).version>=7,'Current Worker v7 required');
 }
 const response=await fetch(release.apiOrigin+'/shared/state',{headers:{Origin:origin},signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);
 const state=await response.json();assert.equal(state.mode,'github-publications');assert.ok(Array.isArray(state.messages));assert.ok(Array.isArray(state.posts));
 console.log(`${origin}: preflight, health, and shared inbox passed`);
}
