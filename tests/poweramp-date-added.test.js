import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const start=source.indexOf('const ListOptions={'),end=source.indexOf('\n  show(box)',start);
function options(reverse){
  const ctx=vm.createContext({SET:{shuffleOn:false,sortTracks:'added',listOptions:{all:{sort:'added',reverse}}},ListZoom:{key:()=> 'all',keys:{all:'all'}},sortNat:(a,b)=>a.localeCompare(b),trackArtist:t=>t.artist,trackAlbum:t=>t.album,baseName:s=>s});
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
test('all unknown dates retain order and explain unavailable sort; R2 upload provenance is visible',()=>{
  const opts=options(true),tracks=[{id:'z'},{id:'a',added:0}];
  const result=opts.prepare({type:'tracks',items:tracks},{kind:'all'});
  assert.deepEqual(Array.from(result.items,t=>t.id),['z','a']);assert.match(result.sortNotice,/No date added/);
  assert.match(opts.prepare({type:'tracks',items:[{added:100,addedSource:'r2-upload'}]},{kind:'all'}).sortNotice,/verified upload time/);
});
