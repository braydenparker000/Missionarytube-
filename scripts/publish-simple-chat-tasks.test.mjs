import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {backendInputIdentity} from './worker-release-identity.mjs';
import {mastBackendInputIdentity,publicationBytes,patchManifest,checkedChatTasksReceipt,checkedChatTasksChange,unchangedInventory,FILES,SOURCE,SETTINGS} from './publish-simple-chat-tasks.mjs';
import {receiptDigest} from './worker-release-identity.mjs';
const parent={source:'a'.repeat(40),frontendArtifactDigest:'b'.repeat(64),settingsDigest:SETTINGS,version:'11111111-1111-1111-1111-111111111111',shufflePatch:{preserved:true},mastReplyPatch:{preserved:true}};
function receipt(){const artifact=patchManifest(parent);return {...parent,source:SOURCE,backendDigest:'c'.repeat(64),backendReusable:false,recipe:[{path:'reviewed',sha:'d'.repeat(40)}],version:'22222222-2222-2222-2222-222222222222',orchestration:'e'.repeat(40),runId:'123',attempt:'1',frontendArtifactDigest:receiptDigest(artifact),simpleChatTasksPatch:{kind:'simple-chat-tasks',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},artifact,codeSha256:'f'.repeat(64)}};}
test('combined receipt permits only the reviewed Worker and ten chat files, retaining sorting/shuffle/Mast lineage and settings',()=>{
 const r=receipt();assert.deepEqual(checkedChatTasksChange(r,parent),parent);
 for(const bad of [{...r,settingsDigest:'a'.repeat(64)},{...r,source:'a'.repeat(40)},{...r,shufflePatch:{}},{...r,mastReplyPatch:{}},{...r,frontendSource:SOURCE},{...r,simpleChatTasksPatch:{...r.simpleChatTasksPatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedChatTasksChange(bad,parent));
 const bad=structuredClone(r);bad.simpleChatTasksPatch.artifact.files[0].sha256='a'.repeat(64);bad.frontendArtifactDigest=receiptDigest(bad.simpleChatTasksPatch.artifact);assert.throws(()=>checkedChatTasksChange(bad,parent));
 assert.throws(()=>checkedChatTasksReceipt(r),'production verifier also requires the exact pinned live parent');
});
test('chat publication carries the existing static document security policy into HTML only',()=>{
 const config={routes:[],globalHeaders:{'Content-Security-Policy':"default-src 'none'; font-src 'self' data:; frame-ancestors 'none';"}};
 const raw=Buffer.from('<html><head>\n<meta charset="utf-8"></head></html>'),html=publicationBytes('mast/index.html',raw,config).toString();
 assert.ok(html.includes("font-src 'self' data:"));assert.ok(!html.includes('frame-ancestors'));assert.ok(html.includes('strict-origin-when-cross-origin'));assert.equal(html.split('http-equiv="Content-Security-Policy"').length,2);
 assert.deepEqual(publicationBytes('assets/mast.js',raw,config),raw);assert.throws(()=>publicationBytes('mast/index.html',Buffer.from(html),config));
});
test('versioned Muse dependencies precede all new importers and preserve the existing modules during interrupted publication',()=>{
 assert.deepEqual(FILES.slice(0,2).map(f=>[f.path,f.sourcePath,f.before]),[
  ['assets/muse-shell-simple-chat-tasks-v1.js','assets/muse-shell.js',null],
  ['assets/mast-work-simple-chat-tasks-v1.js','assets/mast-work.js',null],
 ]);
 assert.ok(!FILES.some(f=>['assets/mast-work.js','assets/muse-shell.js'].includes(f.path)));
 const js=publicationBytes('assets/mast.js',Buffer.from("import {museShell} from './muse-shell.js';import {createMastWork} from './mast-work.js';"));
 assert.match(js.toString(),/muse-shell-simple-chat-tasks-v1\.js/);assert.match(js.toString(),/mast-work-simple-chat-tasks-v1\.js/);
 const before=[{name:'assets/mast-work.js',etag:'old-work',size:1},{name:'assets/muse-shell.js',etag:'old-shell',size:1}];
 const after=[...before,...FILES.map(f=>({name:f.path,etag:'new',size:f.bytes}))];unchangedInventory(before,after);
 assert.throws(()=>unchangedInventory(before,after.map(f=>f.name==='assets/mast-work.js'?{...f,etag:'changed'}:f)));
});
test('whole-store verification rejects changes to shuffle worker, Mast, additions and deletions',()=>{
 const before=[...FILES.map(f=>({name:f.path,etag:'old',size:1})),{name:'drawercast/shuffle-worker.js',etag:'same',size:2},{name:'drawercast/player.js',etag:'same',size:2},{name:'release-qualified.json',etag:'old',size:3}].sort((a,b)=>a.name.localeCompare(b.name));
 const after=before.map(f=>FILES.some(x=>x.path===f.name)||f.name==='release-qualified.json'?{...f,etag:'new'}:f);unchangedInventory(before,after);
 for(const bad of [after.slice(1),[...after,{name:'new.js',etag:'new',size:1}],after.map(f=>f.name==='drawercast/shuffle-worker.js'?{...f,etag:'changed'}:f),after.map(f=>f.name==='drawercast/player.js'?{...f,etag:'changed'}:f)])assert.throws(()=>unchangedInventory(before,bad));
});
test('publication mode serializes backup, Worker, static files and receipt using the existing identities',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8'),job=workflow.slice(workflow.indexOf('  simple-chat-tasks:\n'));
 assert.ok(job.includes('ref: '+SOURCE));assert.match(job,/path: \.jarvis-source\n          persist-credentials: false\n          fetch-depth: 0/);assert.ok(job.includes('group: jarvis-worker-production'));assert.ok(job.includes('persist-credentials: false'));
 const steps=['publish-simple-chat-tasks.mjs prepare','wrangler deploy --dry-run','publish-simple-chat-tasks.mjs checkpoint','name: simple-chat-tasks-before-','wrangler deploy --config','publish-simple-chat-tasks.mjs publish','publish-simple-chat-tasks.mjs record','publish-simple-chat-tasks.mjs stamp','--name release-qualified.json','publish-simple-chat-tasks.mjs published'];let last=-1;for(const step of steps){const next=job.indexOf(step);assert.ok(next>last,step);last=next;}
 assert.equal(workflow.slice(workflow.indexOf('jobs:')).split('inputs.publish_simple_chat_tasks != true').length-1,13);
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
