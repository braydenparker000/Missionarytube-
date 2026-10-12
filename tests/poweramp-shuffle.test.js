import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
function cycle(queue,seed=1,saved=null,mode=1){
  let x=seed;const math=Object.create(Math);math.random=()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296);
  const context=vm.createContext({Math:math});
  const shuffle=source.slice(source.indexOf('function shuffleArray('),source.indexOf('\nfunction installSearchPlayback('));
  const clazz=source.slice(source.indexOf('  class ShuffleCycle{'),source.indexOf('  Engine._syncShuffle='));
  vm.runInContext(shuffle+'\n'+clazz+'\nglobalThis.Cycle=ShuffleCycle;',context);
  return new context.Cycle(queue,mode,saved);
}
const plain=x=>JSON.parse(JSON.stringify(x));
const tracks=counts=>counts.flatMap((n,a)=>Array.from({length:n},(_,i)=>({id:`${a}-${i}`,artist:`Artist ${a}`,album:`Album ${i%3}`})));
function finish(c){const seen=[];for(let s;(s=c.peek(1));){assert.ok(seen.length<c.keys.length,'bounded exhaustion');seen.push(s.key);c.select(c.indices.get(s.key),s);}return seen;}
test('adversarial distributions preserve every occurrence and exhaust without replacement',()=>{
  for(const counts of [[0],[1],[2,4,4],[4,8,10],[99,1],[50],[1,1,1,1]])for(let seed=1;seed<=20;seed++){
    const c=cycle(tracks(counts),seed),seen=finish(c);assert.equal(seen.length,c.keys.length);assert.equal(new Set(seen).size,c.keys.length);assert.deepEqual([...seen].sort(),[...c.keys].sort());
  }
  const duplicate=[{id:'same'},{id:'same'},{id:'other',artist:'Unknown Artist'}];assert.equal(finish(cycle(duplicate)).length,3);
});
test('history cursor back and forward does not spend bag entries; cycles start only after exhaustion',()=>{
  const c=cycle(tracks([3,3]));for(let i=0;i<3;i++){const s=c.peek(1);c.select(c.indices.get(s.key),s);}
  const before=plain(c.snapshot()),previous=c.peek(-1);c.select(c.indices.get(previous.key),previous);const next=c.peek(1);c.select(c.indices.get(next.key),next);
  assert.deepEqual(plain(c.snapshot()),before);assert.equal(c.peek(1).cycle,undefined);
  finish(c);assert.equal(c.peek(1),null);const last=c.history[c.cursor],loop=c.peek(1,true);assert.notEqual(loop.key,last);assert.equal(c.peek(1,true).key,loop.key);
  c.select(c.indices.get(loop.key),loop);assert.equal(c.consumed.size,1);assert.equal(finish(c).length,5);
});
test('reload, queue additions, metadata refresh and removals preserve ranks and consumed entries',()=>{
  const list=tracks([5,5]),c=cycle(list);for(let i=0;i<4;i++){const s=c.peek(1);c.select(c.indices.get(s.key),s);}
  const saved=plain(c.snapshot()),restored=cycle(list,999,saved);assert.deepEqual(plain(restored.snapshot()),saved);
  const remaining=c.ranks.filter(k=>!c.consumed.has(k));restored.sync([...list,{id:'new',artist:'New'}],1);
  assert.deepEqual([...restored.ranks].slice(0,-1),saved.ranks);assert.deepEqual([...restored.consumed],saved.consumed);
  const removed=JSON.parse(remaining[1])[0];restored.sync(list.filter(t=>t.id!==removed).map(t=>({...t,title:'refreshed'})),1);
  assert.deepEqual(finish(restored),[...remaining].filter(k=>JSON.parse(k)[0]!==removed));
});
test('malformed persisted state is rejected and unknown artists are not one clustering group',()=>{
  const list=Array.from({length:12},(_,i)=>({id:String(i)})),unknown=list.map(t=>({...t,artist:'Unknown Artist',album:'Unknown Album'}));
  assert.deepEqual([...cycle(list,10).ranks],[...cycle(unknown,10).ranks]);
  assert.equal(finish(cycle(list,1,{version:1,keys:['bad'],ranks:['else'],history:[],consumed:[],cursor:-1})).length,12);
});
test('album shuffle modes preserve group semantics and all duplicate occurrences',()=>{
  const list=tracks([5,4,3]);for(const mode of [2,3,4])assert.equal(finish(cycle(list,4,null,mode)).length,list.length);
});
test('50,000-track generation and saved-state restore stay bounded',()=>{
  const list=tracks([30000,15000,5000]),start=performance.now(),c=cycle(list),generated=performance.now()-start;
  const saved=plain(c.snapshot()),restoreStart=performance.now();const restored=cycle(list,999,saved),restoredMs=performance.now()-restoreStart;
  assert.equal(restored.ranks.length,50000);assert.ok(generated<1500,`generation ${generated}ms`);assert.ok(restoredMs<750,`restore ${restoredMs}ms`);
  console.log(JSON.stringify({shuffle50000GenerationMs:Math.round(generated),shuffle50000RestoreMs:Math.round(restoredMs)}));
});

test('bounded candidate selection reduces clustering across seeded balanced catalogs',()=>{
  const list=tracks([12,12,12,12]);let before=0,after=0;
  const cost=order=>{let score=0,run=1;for(let i=1;i<order.length;i++){run=order[i].artist===order[i-1].artist?run+1:1;if(run>1)score+=4+run*run;if(order[i].artist===order[i-1].artist&&order[i].album===order[i-1].album)score+=2;}return score;};
  for(let seed=1;seed<=100;seed++){
    let x=seed;const random=()=>((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296),uniform=list.slice();
    for(let i=uniform.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[uniform[i],uniform[j]]=[uniform[j],uniform[i]];}
    const c=cycle(list,seed);before+=cost(uniform);after+=cost(c.ranks.map(k=>list[c.indices.get(k)]));
  }
  assert.ok(after<before*.75,`${after} vs ${before}`);
});
