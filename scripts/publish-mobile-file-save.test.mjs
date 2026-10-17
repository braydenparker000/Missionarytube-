import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMobileFileSaveReceipt,checkedMobileFileSaveChange,patchManifest,unchangedInventory,FILES,SOURCE} from './publish-mobile-file-save.mjs';
import {WORKER,PROVENANCE,workerCheckpointDigest} from './saving-worker-reconciliation.mjs';
import {receiptDigest} from './worker-release-identity.mjs';
const parent={schema:1,source:'b'.repeat(40),version:'synthetic-version',settingsDigest:'c'.repeat(64),frontendArtifactDigest:'d'.repeat(64)};
const checkpoint={...WORKER,settingsDigest:'e'.repeat(64),fullSettingsDigest:'f'.repeat(64),makimaEnabled:false,provenance:PROVENANCE};
const receipt=()=>{const artifact=patchManifest(parent);return {...parent,source:checkpoint.source,version:checkpoint.version,settingsDigest:checkpoint.settingsDigest,backendDigest:workerCheckpointDigest(checkpoint),backendReusable:false,orchestration:'a'.repeat(40),runId:'123',attempt:'1',frontendArtifactDigest:receiptDigest(artifact),mobileFileSavePatch:{kind:'mobile-file-save',parentReceipt:parent,sourceProof:{qualified:true,sourceSha:SOURCE},artifact,workerCheckpoint:checkpoint}};};
test('patch receipt allows only the qualified saving overlay, preserving Worker and settings',()=>{
 const r=receipt();assert.deepEqual(checkedMobileFileSaveChange(r,parent),parent);
 for(const bad of [{...r,version:'changed'},{...r,settingsDigest:'a'.repeat(64)},{...r,frontendSource:SOURCE},{...r,frontendArtifactDigest:parent.frontendArtifactDigest},{...r,mobileFileSavePatch:{...r.mobileFileSavePatch,sourceProof:{qualified:false,sourceSha:SOURCE}}}])assert.throws(()=>checkedMobileFileSaveChange(bad,parent));
 const changed=structuredClone(r);changed.mobileFileSavePatch.artifact.files[0].sha256='f'.repeat(64);changed.frontendArtifactDigest=receiptDigest(changed.mobileFileSavePatch.artifact);assert.throws(()=>checkedMobileFileSaveChange(changed,parent));
});
test('whole-store guard rejects unrelated modifications, deletion and additions',()=>{
 const before=[...FILES.filter(f=>f.before!==null).map(f=>({name:f.path,etag:'old',size:1})),{name:'index.html',etag:'same',size:2},{name:'release-qualified.json',etag:'old',size:3}];
 const after=[...before.map(f=>FILES.some(x=>x.path===f.name)||f.name==='release-qualified.json'?{...f,etag:'new'}:f),...FILES.filter(f=>f.before===null).map(f=>({name:f.path,etag:'new',size:f.bytes}))];
 unchangedInventory(before,after);
 for(const bad of [after.filter(f=>f.name!=='index.html'),[...after,{name:'new.js',etag:'new',size:1}],after.map(f=>f.name==='index.html'?{...f,etag:'changed'}:f)])assert.throws(()=>unchangedInventory(before,bad));
});

test('production receipt refuses a synthetic or changed parent identity',()=>{assert.throws(()=>checkedMobileFileSaveReceipt(receipt()));});
test('scoped dispatch publishes dependency first and cannot deploy Worker or change settings',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8'),job=workflow.slice(workflow.indexOf('  mobile-file-save:\n'));
 assert.deepEqual(FILES.map(f=>f.path),['assets/file-save.js','assets/relay-attachment-content.js','guitar/runtime.js','guitar/guitar.js']);
 assert.equal(workflow.slice(workflow.indexOf('jobs:')).split('inputs.publish_mobile_file_save != true').length-1,13);
 assert.ok(job.includes('ref: '+SOURCE));assert.ok(job.includes('group: jarvis-worker-production'));assert.doesNotMatch(job,/wrangler deploy|keep-vars|activate-|versions upload/);
 let last=-1;for(const step of ['publish-mobile-file-save.mjs prepare','publish-mobile-file-save.mjs reconcile','name: mobile-file-save-before-','azure/login@v2','publish-mobile-file-save.mjs publish','publish-mobile-file-save.mjs record','publish-mobile-file-save.mjs stamp','--name release-qualified.json','publish-mobile-file-save.mjs published']){const next=job.indexOf(step);assert.ok(next>last,step);last=next;}
});
test('scoped qualification recipe retains the proof engine and installer and rejects every changed recipe byte',async()=>{
 const {SAVING_RECIPE}=await import('./publish-mobile-file-save.mjs');const {trustedRecipe,recipeAllowed}=await import('./plan-jarvis-qualification.mjs');
 assert.equal(SAVING_RECIPE['scripts/qualification-proof.mjs'],trustedRecipe['scripts/qualification-proof.mjs']);assert.equal(SAVING_RECIPE['scripts/install-qualification-browser.mjs'],trustedRecipe['scripts/install-qualification-browser.mjs']);assert.equal(Object.keys(SAVING_RECIPE).length,4);
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');const {createHash}=await import('node:crypto');const root=mkdtempSync(join(tmpdir(),'saving-recipe-'));
 try{const expected={};for(const path of Object.keys(SAVING_RECIPE)){const data=Buffer.from('synthetic recipe '+path);mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),data);expected[path]=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');}assert.equal(recipeAllowed(root,expected),true);for(const path of Object.keys(expected)){const bytes=readFileSync(join(root,path));writeFileSync(join(root,path),'changed');assert.equal(recipeAllowed(root,expected),false);writeFileSync(join(root,path),bytes);}}finally{rmSync(root,{recursive:true,force:true});}
});
