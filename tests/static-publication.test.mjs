import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildPublication,stageRelease,switchPointer,installLoaders,verifyRelease,compatibleLoaders,inventory,sha256,mimeFor,POINTER,ROOT,LOADER,savePublication,loadPublication,versionText} from '../scripts/static-publication.mjs';
import {boundedEvidence,recoveryDecision} from '../scripts/release-recovery-plan.mjs';

const loader=await readFile(new URL('../scripts/static-release-loader.js',import.meta.url));
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'";
const html=(name,body='')=>Buffer.from('<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="'+CSP+'"><title>'+name+'</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/app.js" defer></script></head><body><h1>'+name+'</h1>'+body+'</body></html>');
export function fixture(name){const input=new Map([['index.html',html(name)],['podcasts/index.html',html(name+' podcasts')],['media/index.html',html(name+' Astra','<script src="assets/js/extra.js"></script>')],['assets/app.js',Buffer.from('window.releaseName='+JSON.stringify(name)+';')],['assets/style.css',Buffer.from('h1{color:rgb(40,50,60)}')],['media/assets/js/extra.js',Buffer.from('window.extraLoaded=true;')]]);const publication=buildPublication(input,{proof:{artifactDigest:sha256(name),source:'a'.repeat(40)},recipe:sha256('recipe'),loader});publication.original=input;return publication;}
export class Store{
  blobs=new Map();writes=[];serial=0;failAt=Infinity;afterWrite=false;
  async get(key){const v=this.blobs.get(key);return v&&{...v,bytes:Buffer.from(v.bytes)};}
  async route(key){return this.get(key+'index.html');}
  async put(key,bytes,contentType,condition){
    const old=this.blobs.get(key);
    if(condition.ifNoneMatch==='*'&&old||condition.ifMatch&&condition.ifMatch!==old?.etag)throw Error('precondition failed');
    if(this.writes.length===this.failAt&&!this.afterWrite)throw Error('runner interrupted');
    this.blobs.set(key,{bytes:Buffer.from(bytes),contentType,etag:'"fixture-'+(++this.serial)+'"'});this.writes.push(key);
    if(this.writes.length-1===this.failAt&&this.afterWrite)throw Error('runner interrupted after provider commit');
  }
  seed(input){for(const [key,bytes] of input)this.blobs.set(key,{bytes,contentType:mimeFor(key),etag:'"seed-'+(++this.serial)+'"'});}
}
const expected=async store=>{const current=await store.get(POINTER);return {etag:current?.etag??null,sha256:current?sha256(current.bytes):null};};
const guard=async()=>{};
async function boot(){const old=fixture('old'),next=fixture('candidate'),store=new Store();store.seed(old.original);await stageRelease(old,store);await stageRelease(next,store);await installLoaders(old,next,store,{guard});return {old,next,store};}

test('namespaces bind input bytes, exact proof, recipe, documents, hashes and MIME',()=>{
  const a=fixture('old'),b=fixture('candidate');assert.notEqual(a.plan.releaseId,b.plan.releaseId);assert.notEqual(a.plan.inputDigest,b.plan.inputDigest);
  assert.match(a.payload.get('index.html').toString(),new RegExp(a.plan.prefix));assert.match(a.payload.get('media/index.html').toString(),new RegExp(a.plan.prefix+'media/assets/js/extra.js'));
  assert.match(a.payload.get('index.html').toString(),/base-uri 'none'/);assert.ok(!a.payload.get('index.html').toString().includes('<base'));
  assert.deepEqual(a.plan.files,inventory(a.payload));assert.equal(a.plan.pointer.manifestDigest,sha256(a.plan.files));
  assert.notEqual(buildPublication(a.original,{proof:{artifactDigest:sha256('different')},recipe:a.plan.recipe,loader}).plan.releaseId,a.plan.releaseId);
});
test('root static URLs and dynamic Astra resources remap without changing API, navigation, storage or SW scope',()=>{
  const paths=new Set(['assets/drive-config.json','media/assets/js/app.js','muse/setup.txt','podcasts/sw.js','podcasts/index.html']);
  const code=`fetch('/assets/drive-config.json');fetch('/muse/setup.txt');new URL('/podcasts/audio',API);location.href='/podcasts/';localStorage.getItem('jarvis.owner');navigator.serviceWorker.register('/podcasts/sw.js',{scope:'/podcasts/'});script.src='assets/js/app.js';const remote='https://other.example.test/assets/a.js';`;
  const output=versionText(code,'media/assets/js/main.js',paths,'/version/');
  assert.ok(output.includes("fetch('/version/assets/drive-config.json')"));assert.ok(output.includes("fetch('/version/muse/setup.txt')"));
  for(const value of ["new URL('/podcasts/audio',API)","location.href='/podcasts/'","localStorage.getItem('jarvis.owner')","register('/podcasts/sw.js'","scope:'/podcasts/'","https://other.example.test/assets/a.js"])assert.ok(output.includes(value),value);
  assert.ok(output.includes("script.src='/version/media/assets/js/app.js'"));
});
test('publication forbids traversal, symlinks, media, reserved paths and missing policies',()=>{
  const a=fixture('old');for(const path of ['../escape','/absolute','bad//path','x.mp3',POINTER,LOADER,ROOT+'unexpected'])assert.throws(()=>buildPublication(new Map([...a.original,[path,Buffer.from('x')]]),{proof:{},recipe:'fixture',loader}));
  assert.throws(()=>buildPublication(new Map([['index.html',Buffer.from('<head></head>')]]),{proof:{},recipe:'fixture',loader}),/CSP/);
});
test('every upload interruption can resume including a successful write with a lost checkpoint',async()=>{
  const next=fixture('candidate');
  for(const afterWrite of [false,true])for(let failAt=0;failAt<=next.payload.size;failAt++){
    const store=new Store();store.failAt=failAt;store.afterWrite=afterWrite;
    await assert.rejects(stageRelease(next,store),/interrupted/);assert.equal(await store.get(POINTER),undefined);
    const preserved=new Map([...store.blobs].map(([key,v])=>[key,v.etag]));store.failAt=Infinity;await stageRelease(next,store);
    for(const [key,etag] of preserved)assert.equal((await store.get(key)).etag,etag,'resume must never overwrite an existing immutable blob');
    await verifyRelease(next,store);assert.ok(store.writes.every(key=>key.startsWith(ROOT+next.plan.releaseId+'/')));
  }
});
test('hash or MIME drift, immutable collisions and directory index failure all block promotion',async()=>{
  for(const mutation of ['bytes','mime','route']){
    const {next,store}=await boot(),before=await expected(store),key=ROOT+next.plan.releaseId+'/assets/app.js';
    if(mutation==='bytes')store.blobs.get(key).bytes=Buffer.from('corrupt');if(mutation==='mime')store.blobs.get(key).contentType='text/plain';if(mutation==='route')store.route=async()=>undefined;
    await assert.rejects(switchPointer(next,store,{expected:before,guard}),/bytes|MIME|route/);assert.deepEqual(await expected(store),before);
  }
  const a=fixture('old'),store=new Store();store.seed(new Map([[ROOT+a.plan.releaseId+'/assets/app.js',Buffer.from('collision')]]));await assert.rejects(stageRelease(a,store),/conflict/);
});
test('bootstrap can resume after each write while the selected release stays old',async()=>{
  const old=fixture('old'),next=fixture('candidate');
  for(let stop=0;stop<old.canonical.size+1;stop++){
    const store=new Store();store.seed(old.original);await stageRelease(old,store);await stageRelease(next,store);let count=0;
    await assert.rejects(installLoaders(old,next,store,{guard,checkpoint:async()=>{if(count++===stop)throw Error('interrupted');}}).then(()=>{throw Error('interrupted');}),/interrupted/);
    assert.equal(JSON.parse((await store.get(POINTER)).bytes).releaseId,old.plan.releaseId);
    await installLoaders(old,next,store,{guard});await verifyRelease(old,store,{canonical:true});
    assert.ok(!store.writes.some(key=>key==='assets/app.js'));
  }
});
test('promotion and rollback touch only one pointer and leave both complete releases intact',async()=>{
  const {old,next,store}=await boot(),writeStart=store.writes.length;
  await switchPointer(next,store,{expected:await expected(store),guard});assert.equal(JSON.parse((await store.get(POINTER)).bytes).releaseId,next.plan.releaseId);
  await switchPointer(old,store,{expected:await expected(store),guard});assert.equal(JSON.parse((await store.get(POINTER)).bytes).releaseId,old.plan.releaseId);
  assert.deepEqual(store.writes.slice(writeStart),[POINTER,POINTER]);await verifyRelease(old,store);await verifyRelease(next,store);
});
test('pointer races and changed actual backend identity refuse promotion and rollback',async()=>{
  const {old,next,store}=await boot(),before=await expected(store);
  store.blobs.get(POINTER).etag='"foreign-update"';await assert.rejects(switchPointer(next,store,{expected:before,guard}),/changed/);
  const stable=await expected(store);await assert.rejects(switchPointer(next,store,{expected:stable,guard:async()=>{throw Error('backend drift');}}),/backend drift/);
  assert.deepEqual(await expected(store),stable);
  await switchPointer(next,store,{expected:stable,guard});await assert.rejects(switchPointer(old,store,{expected:await expected(store),guard:async()=>{throw Error('old frontend incompatible');}}),/incompatible/);
  const late=await expected(store);
  await assert.rejects(switchPointer(old,store,{expected:late,guard:async()=>{store.blobs.get(POINTER).etag='"raced-after-inspection"';}}),/precondition/);
});
test('lost response after pointer commit is reconciled from provider bytes without a second mutation',async()=>{
  const {next,store}=await boot(),before=await expected(store);store.failAt=store.writes.length;store.afterWrite=true;
  await assert.rejects(switchPointer(next,store,{expected:before,guard}),/after provider/);const writes=store.writes.length;store.failAt=Infinity;
  const result=await switchPointer(next,store,{expected:before,guard});assert.equal(result.reconciled,true);assert.equal(store.writes.length,writes);
});
test('canonical policy, route or service-worker changes need a separate migration',()=>{
  const a=fixture('old'),b=fixture('candidate');compatibleLoaders(a,b);b.plan.canonical[0].sha256='c'.repeat(64);assert.throws(()=>compatibleLoaders(a,b),/migration/);
  const x=fixture('old'),y=fixture('new');x.payload.set('podcasts/sw.js',Buffer.from('one'));y.payload.set('podcasts/sw.js',Buffer.from('two'));assert.throws(()=>compatibleLoaders(x,y),/service-worker/);
});
test('the existing podcast frontend and all offline dependencies remain canonical and byte-identical',async()=>{
  const input=fixture('old').original;
  input.set('podcasts/index.html',html('unchanged podcasts'));
  for(const path of ['podcasts/sw.js','podcasts/app.js','podcasts/core.js','podcasts/style.css','assets/config.js','assets/shell.css','assets/premium.css'])input.set(path,Buffer.from('unchanged fixture '+path));
  const a=buildPublication(input,{proof:{digest:sha256('old')},recipe:sha256('recipe'),loader});a.original=input;
  const nextInput=new Map(input);nextInput.set('index.html',html('new homepage'));
  const b=buildPublication(nextInput,{proof:{digest:sha256('new')},recipe:sha256('recipe'),loader});compatibleLoaders(a,b);
  assert.deepEqual(b.canonical.get('podcasts/index.html'),input.get('podcasts/index.html'));
  const store=new Store();store.seed(input);await stageRelease(a,store);await stageRelease(b,store);await installLoaders(a,b,store,{guard});
  await switchPointer(b,store,{expected:await expected(store),guard});
  assert.ok(!store.writes.includes('podcasts/index.html'));assert.ok(!store.writes.includes('podcasts/sw.js'));assert.ok(!store.writes.includes('assets/shell.css'));
  nextInput.set('podcasts/app.js',Buffer.from('changed offline frontend'));
  assert.throws(()=>compatibleLoaders(a,buildPublication(nextInput,{proof:{digest:sha256('changed')},recipe:sha256('recipe'),loader})),/migration/);
});
test('saved publication seals reject plan, bytes and pointer tampering',async()=>{
  const root=await mkdtemp(join(tmpdir(),'static-publication-'));
  try{const a=fixture('old');await savePublication(a,root);assert.deepEqual((await loadPublication(root)).plan,a.plan);
    await writeFile(join(root,'payload/assets/app.js'),'changed');await assert.rejects(loadPublication(root),/seal/);await savePublication(a,root);
    a.plan.pointer.prefix='/foreign/';await writeFile(join(root,'plan.json'),JSON.stringify(a.plan));await assert.rejects(loadPublication(root),/identity/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('readiness evidence projects fixed enums, digests and bounded counters only',()=>{
  const evidence=boundedEvidence({phase:'staging',releaseId:'a'.repeat(64),checks:[{name:'backend_identity',status:'pass',body:'PRIVATE'}],error:'secret',settings:{token:'PRIVATE'},completed:1,total:10});
  assert.ok(!JSON.stringify(evidence).includes('PRIVATE'));assert.ok(!JSON.stringify(evidence).includes('secret'));
  for(const changes of [{phase:'arbitrary-provider-error'},{checks:[{name:'body',status:'pass'}]},{total:10001},{workerVersion:'token'}])assert.throws(()=>boundedEvidence({...evidence,...changes}));
});
test('database restore, Worker rollback and pending work need distinct evidence and approvals',()=>{
  const base={exactArtifact:true,staticBackup:true,providerIdentity:true,originReadiness:true};
  assert.equal(recoveryDecision({...base,schema:'restore_requested'}).reason,'database_restore_unproven');
  assert.equal(recoveryDecision({...base,worker:'rollback_requested',previousWorkerProven:true}).go,false);
  const worker=recoveryDecision({...base,worker:'rollback_requested',previousWorkerProven:true,schemaBackwardCompatible:true,pendingWorkCompatible:true});assert.equal(worker.go,true);assert.ok(worker.actions.includes('approve_exact_worker_version'));
  assert.equal(recoveryDecision({...base,pointer:'candidate',verification:'failed',previousStaticVerified:true,previousFrontendCompatible:true}).reason,'frontend_rollback_only');
  assert.equal(recoveryDecision({...base,pointer:'unknown'}).go,false);
  assert.equal(recoveryDecision({...base,pointer:'old',upload:'partial'}).reason,'resume_immutable_stage');
});
