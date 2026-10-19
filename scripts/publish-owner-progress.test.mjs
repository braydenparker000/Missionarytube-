import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {backendInputIdentity} from './worker-release-identity.mjs';
import {mastBackendInputIdentity,publicationBytes,patchManifest,checkedProgressReceipt,checkedProgressChange,unchangedInventory,FILES,SOURCE,SETTINGS} from './publish-owner-progress.mjs';
import {receiptDigest} from './worker-release-identity.mjs';
const parent={source:'a'.repeat(40),frontendArtifactDigest:'b'.repeat(64),settingsDigest:SETTINGS,version:'11111111-1111-1111-1111-111111111111',shufflePatch:{preserved:true},mastReplyPatch:{preserved:true}};
function receipt(){const artifact=patchManifest(parent);return {...parent,source:SOURCE,backendDigest:'c'.repeat(64),backendReusable:false,recipe:[{path:'reviewed',sha:'d'.repeat(40)}],version:'22222222-2222-2222-2222-222222222222',orchestration:'e'.repeat(40),runId:'123',attempt:'1',frontendArtifactDigest:receiptDigest(artifact),ownerProgressPatch:{kind:'owner-progress-and-sort-info',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},artifact,codeSha256:'f'.repeat(64)}};}
test('combined receipt permits only the reviewed Worker and four-file change, retaining sorting/shuffle/Mast lineage and settings',()=>{
 const r=receipt();assert.deepEqual(checkedProgressChange(r,parent),parent);
 for(const bad of [{...r,settingsDigest:'a'.repeat(64)},{...r,source:'a'.repeat(40)},{...r,shufflePatch:{}},{...r,mastReplyPatch:{}},{...r,frontendSource:SOURCE},{...r,ownerProgressPatch:{...r.ownerProgressPatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedProgressChange(bad,parent));
 const bad=structuredClone(r);bad.ownerProgressPatch.artifact.files[0].sha256='a'.repeat(64);bad.frontendArtifactDigest=receiptDigest(bad.ownerProgressPatch.artifact);assert.throws(()=>checkedProgressChange(bad,parent));
 assert.throws(()=>checkedProgressReceipt(r),'production verifier also requires the exact pinned live parent');
});
test('publication preserves the existing Azure document security metadata exactly',()=>{
 const raw=Buffer.from('<!doctype html>\n<html><head>\n<meta charset="utf-8"></head></html>'),html=publicationBytes('drawercast/index.html',raw).toString();
 assert.ok(html.includes("worker-src 'self' blob:"));assert.ok(html.includes('strict-origin-when-cross-origin'));assert.equal(html.split('http-equiv="Content-Security-Policy"').length,2);assert.ok(html.endsWith('<meta charset="utf-8"></head></html>'));
 assert.deepEqual(publicationBytes('drawercast/player.js',raw),raw);assert.throws(()=>publicationBytes('drawercast/index.html',Buffer.from(html)));
});
test('whole-store verification rejects changes to shuffle worker, Mast, additions and deletions',()=>{
 const before=[...FILES.map(f=>({name:f.path,etag:'old',size:1})),{name:'drawercast/shuffle-worker.js',etag:'same',size:2},{name:'mast/index.html',etag:'same',size:2},{name:'release-qualified.json',etag:'old',size:3}].sort((a,b)=>a.name.localeCompare(b.name));
 const after=before.map(f=>FILES.some(x=>x.path===f.name)||f.name==='release-qualified.json'?{...f,etag:'new'}:f);unchangedInventory(before,after);
 for(const bad of [after.slice(1),[...after,{name:'new.js',etag:'new',size:1}],after.map(f=>f.name==='drawercast/shuffle-worker.js'?{...f,etag:'changed'}:f),after.map(f=>f.name==='mast/index.html'?{...f,etag:'changed'}:f)])assert.throws(()=>unchangedInventory(before,bad));
});


test('checkpoint resolves qualified URL-suffixed inputs and still requires a fresh Worker publication',()=>{
 const root=mkdtempSync(join(tmpdir(),'progress-suffix-'));
 try{
  mkdirSync(join(root,'backend'));mkdirSync(join(root,'public'));writeFileSync(join(root,'public','r2-api.js'),'export const api=42;\n');writeFileSync(join(root,'backend','worker.js'),"import {api} from '../public/r2-api.js?v=snapshot-v1';export default {fetch(){return new Response(String(api));}};\n");
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'qualified-fixture',type:'module'}));writeFileSync(join(root,'package-lock.json'),'{}');writeFileSync(join(root,'backend','wrangler.music.generated.json'),JSON.stringify({name:'jarvis-hub-api',main:'worker.js',keep_vars:true,vars:{}}));symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
  const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});git('init');git('add','backend','public','package.json','package-lock.json');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Qualified source fixture');
  assert.throws(()=>backendInputIdentity(root),error=>error.code==='ENOENT'&&error.path.endsWith('r2-api.js?v=snapshot-v1'));
  const closure=mastBackendInputIdentity(root);assert.equal(closure.reusable,false);assert.equal(closure.bundled,true);assert.ok(closure.inputs.some(i=>i.path==='public/r2-api.js'));assert.ok(closure.inputs.every(i=>!i.path.includes('?')&&/^[a-f0-9]{64}$/.test(i.sha256)));
 }finally{rmSync(root,{recursive:true,force:true});}
});
