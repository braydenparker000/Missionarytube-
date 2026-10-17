import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile(process.env.POWERAMP_PLAYER_SOURCE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const clone=x=>JSON.parse(JSON.stringify(x));
const track=(id,path=id+'.opus',source='r2')=>({id,path,source,title:id,artist:'Fixture'});
function harness(tracks=[track('r2_a')],existing=[]){
  let stored=clone(existing),fail=false,serial=0,commitGate=null,fetches=0;const receipts=new Set(),messages=[];
  const ctx=vm.createContext({structuredClone,Promise,crypto:{randomUUID:()=>`import-${++serial}`},AbortSignal,
    LIB:{map:new Map(tracks.map(t=>[t.id,t]))},SourceLibrary:{kind:t=>t.source,enabled:()=>true},allTracks:()=>[...ctx.LIB.map.values()],
    R2Source:{native:true,mapping:{},fileFor:t=>t.source==='r2'?{}:null},Views:{refreshAll(){}},Engine:{tracePlayback(){}},
    trackArtist:t=>t.artist,toast:m=>messages.push(m),hash:String,Date,
    fetch:async()=>{fetches++;return {ok:true,text:async()=>JSON.stringify(bundle())};},
    IDB:{get:async(_store,key)=>key==='playlists'?clone(stored):receipts.has(key),
      playlists:async(expected,next,marker,valid=()=>true)=>{
        if(commitGate)await commitGate;
        if(fail)throw Error('Quota exceeded');if(marker&&receipts.has(marker))return false;
        if(!valid()||JSON.stringify(expected)!==JSON.stringify(stored))throw Error('State changed');
        stored=clone(next);if(marker)receipts.add(marker);return true;
      }}
  });
  vm.runInContext(section('const Playlists={','const Bookmarks=')+'\n'+section('const PlaylistFiles={','\nPlaylists.addTo=')+'\nglobalThis.P=Playlists;globalThis.F=PlaylistFiles;',ctx);
  ctx.P.data=clone(existing);ctx.P.persisted=clone(existing);
  return {ctx,P:ctx.P,F:ctx.F,messages,receipts,stored:()=>stored,fail:()=>{fail=true;},gate:p=>{commitGate=p;},fetches:()=>fetches};
}
const bundle=()=>({format:'DrawerCast-playlists',playlists:Array.from({length:8},(_,i)=>({name:'Fixture '+i,tracks:[{id:'r2_a',path:'r2_a.opus'}]}))});
test('playlist JSON validates completely before mutation and resolves ID before colliding path',async()=>{
  const h=harness([track('wrong','same.opus'),track('wanted','same.opus')]);
  const lists=h.F.parse(JSON.stringify({format:'DrawerCast-playlists',playlists:[{name:'Roundtrip',tracks:[{id:'wanted',path:'same.opus'},{id:'wanted'}]}]}),'a.json');
  const result=await h.F.apply(lists);assert.equal(result.matched,2);assert.deepEqual(clone(h.P.data[0].ids),['wanted','wanted']);assert.deepEqual(h.stored(),clone(h.P.data));
  for(const bad of [{playlists:[]},{format:'DrawerCast-playlists',playlists:[{name:'',tracks:[]}]},{format:'DrawerCast-playlists',playlists:[{name:'Bad',tracks:[null]}]}])assert.throws(()=>h.F.parse(JSON.stringify(bad),'a.json'));
  assert.equal(h.P.data.length,1);
});
test('playlist fallback reports ambiguous/missing and cannot silently switch an identified source',()=>{
  const h=harness([track('r2_a','same'),track('r2_b','same'),track('local','local','local')]);
  const result=h.F.resolve([{name:'A',tracks:[{path:'same'},{id:'r2_missing',path:'local'},{path:'absent'}]}]);
  assert.equal(result.ambiguous,1);assert.equal(result.missing,2);assert.equal(result.matched,0);
});
test('failed durable playlist commit does not publish partial import or seed receipt',async()=>{
  const h=harness();h.fail();await assert.rejects(h.F.apply([{name:'A',tracks:[{id:'r2_a'}]}],{marker:'seed'}),/Quota/);
  assert.equal(h.P.data.length,0);assert.deepEqual(h.stored(),[]);assert.equal(h.receipts.size,0);
});
test('edit/delete while import commits survives and its queued save includes imported lists',async()=>{
  const h=harness(undefined,[{id:'old',name:'Old',ids:['r2_a']},{id:'gone',name:'Gone',ids:[]}]);
  let release;h.gate(new Promise(r=>release=r));const work=h.F.apply([{name:'Imported',tracks:[{id:'r2_a'}]}]);await Promise.resolve();
  h.P.data[0].name='Edited';h.P.remove('gone');release();await work;await h.P.writes;
  assert.deepEqual(h.stored().map(p=>p.name),['Edited','Imported']);assert.deepEqual(clone(h.P.data),h.stored());
});
test('catalog identity changing during import aborts without partial mutation',async()=>{
  const h=harness();let release;h.gate(new Promise(r=>release=r));const work=h.F.apply([{name:'A',tracks:[{id:'r2_a'}]}]);await Promise.resolve();
  h.ctx.LIB.map.set('r2_a',track('r2_a'));release();await assert.rejects(work,/State changed/);assert.equal(h.P.data.length,0);
});
test('curated seed waits for R2 mapping and all references, preserves names, and never resurrects deletions',async()=>{
  const h=harness(undefined,[{id:'own',name:'Fixture 0',ids:[]}]);h.F.seedURL='/fixture.json';h.ctx.R2Source.mapping=null;
  await h.F.seed();assert.equal(h.fetches(),0);
  h.ctx.R2Source.mapping={};h.ctx.LIB.map.clear();await h.F.seed();assert.equal(h.receipts.size,0);assert.equal(h.P.data.length,1);
  h.ctx.LIB.map.set('r2_a',track('r2_a'));await h.F.seed();assert.equal(h.P.data.length,8);assert.equal(h.P.data[0].ids.length,0);assert.equal(h.receipts.size,1);
  h.P.remove(h.P.data[1].id);h.P.data[0].name='My edit';await h.P.save();
  h.F.seedDone=false;await h.F.seed();assert.equal(h.P.data.length,7);assert.equal(h.P.data[0].name,'My edit');
  assert.equal(h.fetches(),2,'persisted receipt prevents another fetch/import after reload');
});
test('duplicate concurrent seed calls install at most once',async()=>{
  const h=harness();h.F.seedURL='/fixture.json';await Promise.all([h.F.seed(),h.F.seed()]);await h.P.writes;await Promise.resolve();assert.equal(h.P.data.length,8);assert.equal(h.receipts.size,1);
});
test('playlist store resolves only on transaction completion and abort rejects after request success',async()=>{
  let tx,read;const puts=[];
  const db={transaction(){tx={objectStore:()=>({get(){read={};return read;},put:(v,k)=>puts.push([k,v])}),abort(){this.onabort();}};return tx;}};
  const commit=vm.runInNewContext(section('function commitPlaylistState(', 'const IDB =')+'\ncommitPlaylistState',{Promise,JSON,Error});
  let finished=false;const pending=commit(db,[],[{id:'new'}]).then(()=>finished=true);read.result=[];read.onsuccess();await Promise.resolve();assert.equal(finished,false);assert.equal(puts.length,1);
  tx.oncomplete();await pending;assert.equal(finished,true);
  const failure=commit(db,[],[{id:'new'}]);read.result=[];read.onsuccess();tx.error=Error('Disk full');tx.onabort();await assert.rejects(failure,/Disk full/);
});

test('playlist input limits are checked before any writes and M3U paths resolve uniquely',()=>{
  const h=harness();assert.throws(()=>h.F.parse('x'.repeat(h.F.maxBytes+1),'a.json'),/large/);
  assert.throws(()=>h.F.parse(JSON.stringify({format:'DrawerCast-playlists',playlists:[{name:'A',tracks:Array.from({length:50001},()=>({id:'x'}))}]}),'a.json'),/Invalid playlist/);
  const lists=h.F.parse('#EXTM3U\nr2_a.opus\n','Example.m3u');assert.equal(h.F.resolve(lists).matched,1);assert.equal(h.P.data.length,0);
});

test('published curated artifact is byte-exact and resolves all authored references without guessing',async()=>{
  const bytes=await readFile(new URL('../public/drawercast/curated-playlists.json',import.meta.url));
  assert.equal(bytes.length,968384);assert.equal(createHash('sha256').update(bytes).digest('hex'),'86bc49aac0a6c1b1fab06e6020e956b5e40d21cd252acde97f9ee7a7d61e9bcf');
  const data=JSON.parse(bytes),refs=data.playlists.flatMap(p=>p.tracks);
  const h=harness(refs.map(r=>({...r,source:'r2'}))),lists=h.F.parse(bytes.toString(),'curated.json'),result=h.F.resolve(lists,{r2Only:true});
  assert.equal(lists.length,8);assert.equal(new Set(lists.map(p=>p.name)).size,8);assert.deepEqual(clone(lists.map(p=>p.tracks.length)),[145,1139,984,448,288,472,270,64]);
  assert.equal(new Set(refs.map(r=>r.id)).size,3810);assert.ok(refs.every(r=>r.id.startsWith('r2_')));assert.equal(result.matched,3810);assert.equal(result.missing+result.ambiguous,0);
  assert.match(h.F.seedURL,/curated-playlists\.json/);
});
