import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/js/playback/source-view.js';
const V=globalThis.AstraStreamView;
const row=(id,provider,resolution,size,languages=[])=>({id,stream:{addonOrder:provider,addonName:'Same label',title:id,facts:{resolution:resolution+'p',resolutionRank:resolution,sizeBytes:size,audioLanguages:languages}}});
const rows=[row('first',0,720,40,['en']),row('second',0,2160,80,['fr']),row('third',1,1080,20,['en']),row('fourth',1,1080,0,['en'])];
const ids=items=>items.map(x=>x.id);
test('default and reset preserve the exact supplied order without mutation',()=>{
 assert.deepEqual(ids(V.select(rows)),['first','second','third','fourth']);
 V.select(rows,{sort:'quality'});
 assert.deepEqual(ids(V.select(rows,V.defaults())),['first','second','third','fourth']);
 assert.deepEqual(ids(rows),['first','second','third','fourth']);
});
test('provider identity survives duplicate names and filters preserve relative order',()=>{
 assert.deepEqual(V.options(rows).providers.map(x=>[x.key,x.count]),[['0',2],['1',2]]);
 assert.deepEqual(ids(V.select(rows,{addon:'1',language:'en'})),['third','fourth']);
 assert.deepEqual(ids(V.select(rows,{quality:'1080p'})),['third','fourth']);
 assert.deepEqual(ids(V.select(rows,{addon:'0',language:'fr'})),['second']);
 assert.deepEqual(V.select(rows,{language:'de'}),[]);
});
test('explicit sorts are stable, keep unknown sizes last and never change candidates',()=>{
 assert.deepEqual(ids(V.select(rows,{sort:'quality'})),['second','third','fourth','first']);
 assert.deepEqual(ids(V.select(rows,{sort:'size-asc'})),['third','first','second','fourth']);
 assert.deepEqual(ids(V.select(rows,{sort:'size-desc'})),['second','first','third','fourth']);
 assert.equal(V.select(rows,{sort:'quality'})[0],rows[1]);
 assert.deepEqual(ids(V.select(rows,{sort:'unknown'})),ids(rows));
});
