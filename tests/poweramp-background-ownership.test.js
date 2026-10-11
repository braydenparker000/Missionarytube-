import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.POWERAMP_PLAYER_SOURCE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function workers(){
  let now=0,id=0;const timers=new Map(),instances=[],fallback=[],revoked=[];
  const ctx=vm.createContext({CAP:{workers:null},navigator:{hardwareConcurrency:2},buildTagWorkerURL:()=> 'blob:worker',URL:{revokeObjectURL:x=>revoked.push(x)},
    setTimeout(fn,ms){const n=++id;timers.set(n,{fn,at:now+ms});return n;},clearTimeout:n=>timers.delete(n),
    readTags:async file=>{fallback.push(file.name);return {title:file.name};},
    Worker:class {constructor(){instances.push(this);this.sent=[];}postMessage(job){this.sent.push(job);}terminate(){this.terminated=true;}}
  });
  vm.runInContext(section('const TagPool={','/* =====================================================================\n   LIBRARY MODEL')+'\nglobalThis.pool=TagPool;',ctx);
  return {ctx,pool:ctx.pool,instances,fallback,revoked,timers,
    async tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}}
}
test('a timed-out worker retires the pool and settles active and queued tag reads',async()=>{
  const h=workers(),out=[];
  for(const name of ['A','B','C'])h.pool.read({name},'',false,true).then(t=>out.push(t.title));
  await h.tick(20000);
  assert.deepEqual(out.sort(),['A','B','C']);assert.equal(h.pool.jobs.size,0);assert.equal(h.pool.queue.length,0);
  assert.ok(h.instances.every(w=>w.terminated));assert.deepEqual(h.revoked,['blob:worker']);
});
test('queued tags receive their timeout when dispatched, not while waiting for a worker',async()=>{
  const h=workers();let done=false;
  h.pool.read({name:'A'},'',false,true);h.pool.read({name:'B'},'',false,true).then(()=>{done=true;});
  await h.tick(19000);const w=h.instances[0];w.onmessage({data:{id:w.sent[0].id,tags:{title:'A'}}});
  await h.tick(19999);assert.equal(done,false);
  await h.tick(1);assert.equal(done,true);assert.ok(w.terminated);
});
test('stop settles outstanding tags and stale worker messages cannot free a restarted worker',async()=>{
  const h=workers(),out=[];h.pool.read({name:'A'},'',false,true).then(t=>out.push(t.title));h.pool.read({name:'B'},'',false,true).then(t=>out.push(t.title));
  const old=h.instances[0],late=old.onmessage,lateError=old.onerror,job=old.sent[0];h.pool.stop();await flush();
  assert.deepEqual(out.sort(),['A','B']);h.pool.read({name:'C'},'',false,true);
  late({data:{id:job.id,tags:{title:'stale'}}});lateError();await flush();
  assert.equal(h.pool.jobs.size,1);assert.equal(h.instances.at(-1).busy,true);
});
function metadata(){
  const t={id:'local',dur:0},writes=[],art=[];let tags;
  const ctx=vm.createContext({LIB:{map:new Map([[t.id,t]])},getFileFor:async()=>({slice(){}}),TagPool:{read:()=>new Promise(resolve=>{tags=resolve;})},
    persistTrack:x=>writes.push({...x}),hash:()=> 'cover',Blob,storeArt:async(...args)=>art.push(args)});
  vm.runInContext(section('const MetadataRepair={','/* small=true')+'\nglobalThis.repair=MetadataRepair;',ctx);
  return {ctx,t,writes,art,resolve:value=>tags(value)};
}
for(const replacement of [false,true])test('late local metadata cannot persist a '+(replacement?'replacement':'deleted')+' track record',async()=>{
  const h=metadata(),pending=h.ctx.repair.repair(h.t);await flush();
  replacement?h.ctx.LIB.map.set(h.t.id,{id:h.t.id,dur:90}):h.ctx.LIB.map.delete(h.t.id);
  h.resolve({tagDur:120,sampleRate:48000});await pending;
  assert.equal(h.writes.length,0);assert.equal(h.t.dur,0);
});
test('late duration completion cannot resurrect a deleted track',async()=>{
  const t={id:'local',dur:0},writes=[];let finish;
  const ctx=vm.createContext({LIB:{map:new Map([[t.id,t]])},DUR:{queue:[t],done:0},getFileFor:async()=>({}),tailDuration:()=>new Promise(resolve=>{finish=resolve;}),
    persistTracks:async tracks=>writes.push(...tracks),Views:{refreshAll(){}},UI:{renderBgTask(){},renderProgress(){}},Engine:{current:null},setTimeout:fn=>{fn();}});
  vm.runInContext(section('async function runDurations(){','function stopBackgroundCache(')+'\nglobalThis.run=runDurations;',ctx);
  const pending=ctx.run();await flush();ctx.LIB.map.delete(t.id);finish(120);await pending;
  assert.equal(writes.length,0);assert.equal(t.dur,0);
});
test('background audio cache skips entries removed before their batch starts',async()=>{
  const writes=[],ctx=vm.createContext({LIB:{map:new Map()},BG:{queue:[{id:'deleted',file:{}}],done:0},
    IDB:{bulk:async(store,rows)=>writes.push(...rows)},UI:{renderBgTask(){}},toast(){},setTimeout:fn=>fn()});
  vm.runInContext(section('async function runBackgroundCache(){','/* Durations for formats')+'\nglobalThis.run=runBackgroundCache;',ctx);
  await ctx.run();assert.equal(writes.length,0);
});
for(const kind of ['root','handle','blob'])test('a deleted local '+kind+' read cannot refill the file cache',async()=>{
  const t={id:'local',...(kind==='root'?{rootId:'root',rel:'song.wav'}:{})},files=new Map();let finish;
  const held=new Promise(resolve=>{finish=resolve;}),file={name:'song.wav',type:'audio/wav'};
  const ctx=vm.createContext({LIB:{map:new Map([[t.id,t]])},FILES:files,ROOTS:{perm:{}},File,baseName:()=> 'song.wav',
    resolveInRoot:()=>held,IDB:{get:async store=>store==='handles'?(kind==='handle'?{getFile:()=>held}:null):held}});
  vm.runInContext(section('async function getFileFor(t){','function libAdd(t){')+'\nglobalThis.read=getFileFor;',ctx);
  const pending=ctx.read(t);await flush();ctx.LIB.map.delete(t.id);finish(kind==='blob'?new Blob(['audio']):file);
  assert.equal(await pending,null);assert.equal(files.size,0);
});
test('a stopped metadata job does not mark its replacement record as already repaired',async()=>{
  const h=metadata(),pending=h.ctx.repair.ensure(h.t);await flush();h.ctx.LIB.map.set(h.t.id,{id:h.t.id,dur:0});
  h.resolve({tagDur:120});await pending;assert.equal(h.ctx.repair.attempted.has(h.t.id),false);
});
