import test from 'node:test';
import assert from 'node:assert/strict';
import {allGuitarValue,defaultParts,resolveParts,validParts} from '../public/guitar/track-selection.js';

const tracks=[{partId:0,kind:'other',name:'Vocals'},{partId:5,kind:'guitar',name:'Left'},
  {partId:9,kind:'guitar',name:'Right'},{partId:12,kind:'drums',name:'Drums'}];
const guitars=n=>Array.from({length:n},(_,i)=>({partId:i+1,kind:'guitar'}));
test('fresh vocal-first songs select real guitars and respect the All guitar bound',()=>{
  assert.equal(defaultParts(tracks),'5,9');assert.equal(allGuitarValue(tracks),'5,9');
  assert.equal(defaultParts([tracks[0],tracks[1]]),'5');assert.equal(allGuitarValue([tracks[1]]),null);
  assert.equal(allGuitarValue(guitars(12)),Array.from({length:12},(_,i)=>i+1).join(','));
  assert.equal(allGuitarValue(guitars(13)),null);assert.equal(defaultParts([tracks[0],...guitars(13)]),'1');
});
test('single-track and no-guitar songs keep usable defaults',()=>{
  assert.equal(defaultParts([tracks[1]]),'5');assert.equal(defaultParts([tracks[0],tracks[3]]),'0');
  assert.equal(resolveParts([tracks[0],tracks[3]],'12'),'12');
});
test('only offered single and All guitar selections are valid',()=>{
  for(const value of ['0','5','9','12','5,9'])assert.equal(validParts(tracks,value),value);
  for(const value of [undefined,null,'','999','5,999','0,5','5,5',{},[]])assert.equal(validParts(tracks,value),null);
  assert.equal(validParts(guitars(13),Array.from({length:13},(_,i)=>i+1).join(',')),null);
});
test('latest valid recent choice wins, including vocals and multiple guitars',()=>{
  assert.equal(resolveParts(tracks,'0','5,9'),'0');assert.equal(resolveParts(tracks,'5,9','0'),'5,9');
  assert.equal(resolveParts(tracks,'9','0'),'9');
});
test('saved choices survive missing or invalid recent entries; both invalid use the default',()=>{
  assert.equal(resolveParts(tracks,undefined,'0'),'0');assert.equal(resolveParts(tracks,'999','9'),'9');
  assert.equal(resolveParts(tracks,null,'5,9'),'5,9');assert.equal(resolveParts(tracks,'5,999','999'),'5,9');
});
