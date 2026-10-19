import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedFiles,checkedRun,checkedReceipt,checkedBaseline,publish,restore,sha} from './publish-frontend.mjs';

const bytes=path=>Buffer.from(path);
const file=(path,text=path)=>({path,sha256:sha(bytes(text)),bytes:bytes(text).length});
const properties={contentSettings:{contentType:'text/plain',cacheControl:'no-cache',contentMd5:'retained-md5'}};
function fixture({adoption=false}={}){
 const old=[file('assets/app.js','old app'),file('index.html','old page'),file('release.json','old release')];
 const next=[file('index.html','new page'),file('assets/app.js','new app'),file('assets/new.js','dependency'),file('release.json','new release')];
 const parent=adoption?null:{files:old};
 const candidate={commit:'a'.repeat(40),files:adoption?[old[0],old[1],next[3]]:next};
 const store=new Map(old.map((f,i)=>[f.path,{...f,exists:true,etag:'old-'+i,properties:structuredClone(properties),metadata:{reviewed:'kept'},file:'before-'+i}]));
 const paths=[...new Set([...old,...candidate.files].map(f=>f.path))].sort();
 const before=paths.map((path,i)=>({...structuredClone(store.get(path)||{path,exists:false}),...(store.has(path)?{file:'before-'+i}:{})}));
 const saved={candidate,parent,before},uploads=[],reads=[];
 const snapshot=async path=>structuredClone(store.get(path)||{path,exists:false});
 const upload=async(f,prior)=>{assert.equal(prior.etag,store.get(f.path)?.etag);uploads.push(f.path);store.set(f.path,{...f,exists:true,etag:'new-'+uploads.length,properties:structuredClone(properties),metadata:{reviewed:'kept'}});};
 const publicRead=async(path,hash,size)=>{const current=store.get(path);assert.equal(current.sha256,hash);assert.equal(current.bytes,size);reads.push(path);};
 return {saved,store,uploads,reads,snapshot,upload,publicRead,candidate:async()=>structuredClone(candidate),readBefore:async old=>bytes(old.path==='assets/app.js'?'old app':old.path==='index.html'?'old page':'old release')};
}
test('first adoption accepts only already deployed runtime bytes; protected paths never enter manifests',()=>{
 const h=fixture({adoption:true});assert.equal(checkedBaseline(h.saved.candidate,h.saved.before,null),true);
 for(const mutation of [h=>h.saved.before[0].sha256='0'.repeat(64),h=>h.saved.before[0].exists=false]){
  const h=fixture({adoption:true});mutation(h);assert.throws(()=>checkedBaseline(h.saved.candidate,h.saved.before,null));
 }
 for(const path of ['../escape','/index.html','a//b','assets/drive-config.json','assets/quick-ai-config.json','content/jarvis.json','drawercast/catalog/current.json'])assert.throws(()=>checkedFiles([file(path)]));
 assert.throws(()=>checkedFiles([file('index.html'),file('index.html')]));
});
test('only trusted successful main workflow receipts establish a baseline',()=>{
 const run={id:12,repository:{full_name:'braydenparker000/Missionarytube-'},head_repository:{full_name:'braydenparker000/Missionarytube-'},path:'.github/workflows/deploy-azure-storage.yml',head_branch:'main',head_sha:'a'.repeat(40),event:'workflow_dispatch',status:'completed',conclusion:'success'};
 const receipt={schema:1,kind:'frontend',runId:'12',commit:run.head_sha,action:'publish',files:[file('index.html')],workerChanged:false,dataChanged:false};
 checkedReceipt(receipt,run);
 for(const patch of [{head_branch:'feature'},{event:'pull_request'},{conclusion:'failure'},{path:'.github/workflows/other.yml'},{repository:{full_name:'foreign/repo'}}])assert.throws(()=>checkedRun({...run,...patch},'12'));
 for(const patch of [{runId:'13'},{commit:'b'.repeat(40)},{workerChanged:true},{dataChanged:true}])assert.throws(()=>checkedReceipt({...receipt,...patch},run));
 checkedRun({...run,conclusion:'failure'},'12',{rollback:true});
});
test('publication writes dependencies before documents and release metadata; verifies every uploaded byte',async()=>{
 const h=fixture();await publish(h.saved,h);
 assert.deepEqual(h.uploads,['assets/new.js','assets/app.js','index.html','release.json']);
 assert.deepEqual(h.reads,h.uploads);
 assert.deepEqual(h.store.get('index.html').properties,properties);
});
test('adoption changes metadata only and leaves all existing runtime blobs untouched',async()=>{
 const h=fixture({adoption:true});await publish(h.saved,h);assert.deepEqual(h.uploads,['release.json']);
});
test('unknown baseline bytes, missing files and unexpected new paths fail before the first upload',async()=>{
 for(const change of [h=>h.saved.before[0].sha256='0'.repeat(64),h=>h.saved.before[0].exists=false,h=>h.saved.before.find(f=>!f.exists).exists=true]){
  const h=fixture();change(h);await assert.rejects(publish(h.saved,h));assert.deepEqual(h.uploads,[]);
 }
});
test('a race anywhere in the baseline or a rebuilt candidate prevents the first upload',async()=>{
 for(const change of [h=>h.store.get('release.json').etag='foreign',h=>h.candidate=async()=>({...h.saved.candidate,commit:'b'.repeat(40)})]){
  const h=fixture();change(h);await assert.rejects(publish(h.saved,h));assert.deepEqual(h.uploads,[]);
 }
});
test('an object created after preflight cannot be overwritten',async()=>{
 const h=fixture(),read=h.snapshot;let calls=0;
 h.snapshot=async(path,...args)=>{if(++calls===h.saved.before.length+1)h.store.set('assets/new.js',{...file('assets/new.js','foreign'),exists:true,etag:'foreign'});return read(path,...args);};
 await assert.rejects(publish(h.saved,h));assert.ok(!h.uploads.includes('assets/new.js'));
});
test('rollback checks every saved byte and current object before restoring anything',async()=>{
 for(const change of [h=>h.readBefore=async()=>bytes('corrupt'),h=>h.store.get('release.json').sha256='0'.repeat(64),h=>h.store.get('release.json').properties.contentSettings.cacheControl='foreign']){
  const h=fixture();await publish(h.saved,h);h.uploads.length=0;change(h);
  await assert.rejects(restore(h.saved,h));assert.deepEqual(h.uploads,[]);
 }
});
test('rollback restores old pages and headers while retaining new immutable dependencies',async()=>{
 const h=fixture();await publish(h.saved,h);h.uploads.length=0;
 await restore(h.saved,h);
 assert.deepEqual(h.uploads,['release.json','index.html','assets/app.js']);
 assert.equal(h.store.get('index.html').sha256,sha(bytes('old page')));
 assert.equal(h.store.get('assets/new.js').sha256,sha(bytes('dependency')));
 assert.deepEqual(h.store.get('index.html').properties,properties);
});
test('an interrupted publication can restore accepted files without requiring absent new dependencies',async()=>{
 const h=fixture();h.store.set('index.html',{...h.store.get('index.html'),...file('index.html','new page')});
 await restore(h.saved,h);assert.deepEqual(h.uploads,['index.html']);assert.equal(h.store.has('assets/new.js'),false);
});
