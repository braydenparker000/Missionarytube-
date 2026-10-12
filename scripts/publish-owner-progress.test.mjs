import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicationBytes,patchManifest,checkedProgressReceipt,checkedProgressChange,unchangedInventory,FILES,SOURCE,SETTINGS} from './publish-owner-progress.mjs';
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
test('publication mode serializes backup, Worker, static files and receipt using the existing identities',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8'),job=workflow.slice(workflow.indexOf('  owner-progress:\n'));
 assert.ok(job.includes('ref: '+SOURCE));assert.match(job,/path: \.jarvis-source\n          persist-credentials: false\n          fetch-depth: 0/);assert.ok(job.includes('group: jarvis-worker-production'));assert.ok(job.includes('persist-credentials: false'));
 const steps=['publish-owner-progress.mjs prepare','wrangler deploy --dry-run','publish-owner-progress.mjs checkpoint','name: owner-progress-before-','wrangler deploy --config','publish-owner-progress.mjs publish','publish-owner-progress.mjs record','publish-owner-progress.mjs stamp','--name release-qualified.json','publish-owner-progress.mjs published'];let last=-1;for(const step of steps){const next=job.indexOf(step);assert.ok(next>last,step);last=next;}
 assert.ok(workflow.slice(0,workflow.indexOf('  owner-progress:\n')).match(/if: \$\{\{ inputs.publish_owner_progress != true/g).length>=10);
});
