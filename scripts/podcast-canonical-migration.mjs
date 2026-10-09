// Local, fictional-store qualification only: no provider client or production caller.
import assert from 'node:assert/strict';
import {inventory,sha256,mimeFor,buildPublication,compatibleLoaders,stageRelease,installLoaders,switchPointer,verifyRelease,POINTER} from './static-publication.mjs';
export const PODCAST_PAIR=Object.freeze({previous:'f999581aa979712b4b63a6783b7c56842fedb6a1',candidate:'ed7bbd436689be3ac9cca1ab5f111341dd690b80',artifactSha256:'c2d8abe103d35ae3d2b7bb36c9483a6bd3bb089ed1c625cc2f1e0972a8f91fc1',previousInput:'bf3f58f741c2153cb68668c6ebb3b3b50996167269b4aa5aede04297391fd903',candidateInput:'4d62ca1ee23e3e0031acddb5ab0cbc1cf2a953520b3bf9c41cabd9902be41163'});
export const PODCAST_ORDER=Object.freeze(['podcasts/directory.js','podcasts/app.js','podcasts/index.html','podcasts/sw.js']);
const DELTA=Object.freeze([
 ['podcasts/directory.js',null,'1bc7aa534b8b396f81bb78fb49096d455d50d41b6cec9c78699569ff4527c28f'],
 ['podcasts/app.js','c14a7648dc1559d184578bce1fc95e270dcccc2c53542e38c7a70d7f22912919','b425b664413ae5453e4ad54a85325f5ff10bdfd79a457e1b05c8e0dfae2e1ac4'],
 ['podcasts/index.html','426700912d2a244eda6bedf82bd801023afb4b9a784c111464e419cfb9d12ae1','7aadfe4052e8e34fb5ae1a87bf1167d8609da1859c673fa6baf2275323363d08'],
 ['podcasts/sw.js','72f5db81a7a25d691df904729998f9699c833de67d3f68b78698f78ede4dcf3f','77acc1162cfe1e722630f128d1980f23abf425c56e556a4fdd9297e09ea50c0a']]);
const states=new WeakMap(),frozen=path=>path.startsWith('podcasts/')||['assets/config.js','assets/shell.css','assets/premium.css'].includes(path);
const copy=files=>new Map([...files].map(([p,b])=>[p,Buffer.from(b)]));
export function podcastCanonicalContract(previous,candidate,{sourcePair,artifactSha256}={}){
 assert.deepEqual(sourcePair,{previous:PODCAST_PAIR.previous,candidate:PODCAST_PAIR.candidate},'Unsupported exact source pair');
 assert.equal(artifactSha256,PODCAST_PAIR.artifactSha256,'Original qualified ZIP required');
 for(const [files,count,digest] of [[previous,174,PODCAST_PAIR.previousInput],[candidate,179,PODCAST_PAIR.candidateInput]]){
  assert.ok(files instanceof Map);assert.equal(files.size,count);assert.ok([...files.values()].every(b=>Buffer.isBuffer(b)));assert.ok([...files.values()].reduce((n,b)=>n+b.length,0)<=67108864);assert.equal(sha256(inventory(files)),digest,'Complete actual artifact closure changed');
 }
 for(const [path,before,after] of DELTA){assert.equal(previous.has(path)?sha256(previous.get(path)):null,before);assert.equal(sha256(candidate.get(path)),after);}
 for(const path of new Set([...previous.keys(),...candidate.keys()].filter(frozen)))if(!PODCAST_ORDER.includes(path))assert.deepEqual(candidate.get(path),previous.get(path),'Canonical API/storage/CSS/offline closure changed');
 const app=candidate.get('podcasts/app.js').toString(),directory=candidate.get('podcasts/directory.js').toString(),sw=candidate.get('podcasts/sw.js').toString();
 assert.ok(app.includes("import {clientDirectory} from './directory.js'"));assert.ok(!app.includes('function jsonpDirectory'));
 assert.ok(directory.includes("credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'"));assert.ok(directory.includes('1024 * 1024'));assert.ok(directory.includes('JSON.parse'));assert.ok(!/document\.createElement|eval\(|new Function/.test(directory));
 assert.ok(sw.includes("const SHELL = 'jarvis-podcast-shell-v3'"));for(const value of ["const AUDIO = 'jarvis-podcast-audio-v1'","const ART = 'jarvis-podcast-art-v1'"])assert.ok(sw.includes(value));
 const derived=copy(previous);for(const path of PODCAST_ORDER)derived.set(path,Buffer.from(candidate.get(path)));
 const envelope=Object.freeze({schema:1,kind:'local-explicit-canonical-migration',sourcePair:Object.freeze({...sourcePair}),artifactSha256,rawFiles:174,derivedFiles:175,candidateFiles:179,rawInputDigest:PODCAST_PAIR.previousInput,derivedInputDigest:sha256(inventory(derived)),candidateInputDigest:PODCAST_PAIR.candidateInput,order:PODCAST_ORDER,delta:Object.freeze(DELTA.map(([path,before,after])=>Object.freeze({path,before,after}))),rollbackPolicy:'main pointer rollback retains the approved data-only podcast canonical layer',productionAuthorized:false});
 const contract=Object.freeze({envelope,digest:sha256(envelope)});states.set(contract,{previous:copy(previous),candidate:copy(candidate),derived});return contract;
}
export function derivedPodcastView(contract){const state=states.get(contract);assert.ok(state,'Unrecognized migration contract');return copy(state.derived);}
function same(actual,bytes,path){return !bytes?!actual:actual&&Buffer.isBuffer(actual.bytes)&&sha256(actual.bytes)===sha256(bytes)&&actual.contentType===mimeFor(path)&&typeof actual.etag==='string'&&actual.etag.length>0;}
export async function migratePodcastCanonical(contract,store,{guard}={}){
 const state=states.get(contract);assert.ok(state,'Unrecognized migration contract');assert.equal(sha256(contract.envelope),contract.digest,'Migration envelope changed');assert.equal(typeof guard,'function','Separate per-action local authorization required');
 const paths=[...new Set([...state.previous.keys(),...state.derived.keys()].filter(frozen))].sort();let writes=0;
 async function inspect(){
  const observed=new Map();for(const path of paths)observed.set(path,await store.get(path));
  let prefix=0;while(prefix<PODCAST_ORDER.length&&same(observed.get(PODCAST_ORDER[prefix]),state.derived.get(PODCAST_ORDER[prefix]),PODCAST_ORDER[prefix]))prefix++;
  for(const path of paths){const index=PODCAST_ORDER.indexOf(path),bytes=index>=0&&index<prefix?state.derived.get(path):state.previous.get(path);assert.ok(same(observed.get(path),bytes,path),'Mixed or foreign canonical state refused');}
  return {prefix,observed};
 }
 await guard(contract.envelope);let current=await inspect();
 while(current.prefix<4){
  const path=PODCAST_ORDER[current.prefix],old=current.observed.get(path);await guard(contract.envelope);
  await store.put(path,state.derived.get(path),mimeFor(path),old?{ifMatch:old.etag}:{ifNoneMatch:'*'});writes++;
  const next=await inspect();assert.equal(next.prefix,current.prefix+1,'Canonical write did not commit exactly');current=next;
 }
 await guard(contract.envelope);await inspect();assert.equal(sha256(contract.envelope),contract.digest,'Migration envelope changed');return {schema:1,digest:contract.digest,writes,completed:true,rawFiles:174,derivedFiles:175,productionOperations:0,offlineReadyVerified:false};
}
export class LocalMigrationStore{
 blobs=new Map();writes=[];serial=0;stop=Infinity;after=false;
 constructor(files){for(const [path,bytes] of files)this.blobs.set(path,{bytes:Buffer.from(bytes),contentType:mimeFor(path),etag:'"local-'+(++this.serial)+'"'});}
 async get(path){const v=this.blobs.get(path);return v&&{...v,bytes:Buffer.from(v.bytes)};}
 async route(path){return this.get(path+'index.html');}
 async put(path,bytes,contentType,condition){const old=this.blobs.get(path);assert.ok(condition.ifNoneMatch==='*'?!old:condition.ifMatch===old?.etag,'Conditional write refused');if(this.writes.length===this.stop&&!this.after)throw Error('Local interruption');this.blobs.set(path,{bytes:Buffer.from(bytes),contentType,etag:'"local-'+(++this.serial)+'"'});this.writes.push(path);if(this.writes.length-1===this.stop&&this.after)throw Error('Local interruption after commit');}
}
export async function qualifyCanonicalChain(contract,{loader,recipe,rawProof,candidateProof}={}){
 const state=states.get(contract);assert.ok(state);const guard=async envelope=>assert.equal(sha256(envelope),contract.digest);
 let interruptions=0;for(const after of [false,true])for(let stop=0;stop<4;stop++){
  const store=new LocalMigrationStore(state.previous);store.stop=stop;store.after=after;await assert.rejects(migratePodcastCanonical(contract,store,{guard}),/Local interruption/);store.stop=Infinity;await migratePodcastCanonical(contract,store,{guard});assert.deepEqual(store.writes,PODCAST_ORDER);interruptions++;
 }
 const raw=buildPublication(state.previous,{proof:rawProof,loader,recipe}),derived=buildPublication(state.derived,{proof:{kind:'derived-compatibility-view',rawProof,migrationDigest:contract.digest},loader,recipe}),candidate=buildPublication(state.candidate,{proof:candidateProof,loader,recipe});
 assert.throws(()=>compatibleLoaders(raw,candidate),/separately reviewed migration/);compatibleLoaders(derived,candidate);
 const store=new LocalMigrationStore(state.previous);await migratePodcastCanonical(contract,store,{guard});derived.original=copy(state.derived);await stageRelease(derived,store);await stageRelease(candidate,store);await installLoaders(derived,candidate,store,{guard:async()=>guard(contract.envelope)});
 const expected=async()=>{const p=await store.get(POINTER);return {etag:p.etag,sha256:sha256(p.bytes)};};
 await switchPointer(candidate,store,{expected:await expected(),guard:async()=>guard(contract.envelope)});await switchPointer(derived,store,{expected:await expected(),guard:async()=>guard(contract.envelope)});
 await verifyRelease(derived,store,{canonical:true});await verifyRelease(candidate,store,{canonical:true});for(const path of PODCAST_ORDER)assert.deepEqual((await store.get(path)).bytes,state.candidate.get(path));
 let refusals=0;for(const mutate of [s=>s.blobs.get('podcasts/core.js').bytes=Buffer.from('foreign'),s=>s.blobs.get('podcasts/app.js').contentType='text/plain',s=>s.blobs.set('podcasts/sw.js',{bytes:state.candidate.get('podcasts/sw.js'),contentType:mimeFor('podcasts/sw.js'),etag:'"foreign"'})]){const s=new LocalMigrationStore(state.previous);mutate(s);await assert.rejects(migratePodcastCanonical(contract,s,{guard}),/foreign/);assert.equal(s.writes.length,0);refusals++;}
 const denied=new LocalMigrationStore(state.previous);await assert.rejects(migratePodcastCanonical(contract,denied,{guard:async()=>{throw Error('No canonical migration authorization');}}),/authorization/);assert.equal(denied.writes.length,0);refusals++;
 return {schema:1,kind:'fictional-local-exact-chain',rawFiles:174,derivedFiles:175,candidateFiles:179,interruptions,refusals,defaultRawPairRefused:true,mainPromotionAndRollbackPassed:true,securityCanonicalRetained:true,productionOperations:0};
}
