import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const start=source.indexOf('const ListOptions={'),end=source.indexOf('\n  show(box)',start);
function options(reverse,ids){
  const ctx=vm.createContext({...(ids?{LIB:{ids}}:{}),SET:{shuffleOn:false,sortTracks:'added',listOptions:{all:{sort:'added',reverse}}},ListZoom:{key:()=> 'all',keys:{all:'all'}},sortNat:(a,b)=>a.localeCompare(b),trackArtist:t=>t.artist,trackAlbum:t=>t.album,baseName:s=>s});
  vm.runInContext(source.slice(start,end)+'\n};globalThis.options=ListOptions;',ctx);return ctx.options;
}
test('date added orders dates, preserves ties, and keeps missing dates last in both directions',()=>{
  const tracks=[{id:'z',title:'Z',added:200},{id:'a',title:'A',added:100},{id:'b',title:'B',added:200},{id:'x',title:'X'},{id:'n',added:NaN},{id:'zero',added:0},{id:'bad',added:'bad'}];
  for(const [reverse,expected] of [[false,['z','b','a','x','n','zero','bad']],[true,['a','z','b','x','n','zero','bad']]]){
    const result=options(reverse).prepare({type:'tracks',items:tracks},{kind:'all'});
    assert.deepEqual(Array.from(result.items,t=>t.id),expected);
  }
  assert.deepEqual(tracks.map(t=>t.id),['z','a','b','x','n','zero','bad']);
});
test('all unknown dates retain order and explain unavailable sort; R2 provenance stays out of the prepared header',()=>{
  const opts=options(true),tracks=[{id:'z'},{id:'a',added:0}];
  const result=opts.prepare({type:'tracks',items:tracks},{kind:'all'});
  assert.deepEqual(Array.from(result.items,t=>t.id),['z','a']);assert.match(result.sortNotice,/No date added/);
  assert.equal(opts.prepare({type:'tracks',items:[{added:100,addedSource:'r2-upload'}]},{kind:'all'}).sortNotice,undefined);
});

test('category date ties recover library order after legacy title sorting',()=>{
  const input=[{id:'a',title:'A',added:10},{id:'z',title:'Z',added:10}];
  for(const reverse of [false,true])assert.deepEqual(Array.from(options(reverse,['z','a']).prepare({type:'tracks',items:input},{kind:'all'}).items,t=>t.id),['z','a']);
  assert.deepEqual(Array.from(options(false,['z','a']).prepare({type:'tracks',items:input},{kind:'playlist'}).items,t=>t.id),['a','z']);
});
