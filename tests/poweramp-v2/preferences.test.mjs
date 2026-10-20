import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences,savePreferences} from '../../frontend/poweramp-v2/preferences.js';
test('corrupt, future and inaccessible preferences fall back without reading another namespace',()=>{
  for(const value of ['{broken','{"schema":999}','null'])assert.equal(readPreferences({getItem:()=>value}).repeat,'off');
  const storage={getItem:key=>{assert.equal(key,'poweramp-v2:preferences:1');throw Error('Denied');},setItem(){throw Error('Denied');}};
  assert.equal(readPreferences(storage).shuffle,false);assert.equal(savePreferences({},storage),false);
});
test('preference persistence strips URLs, local metadata and play intent',()=>{
  let stored;const storage={setItem:(key,value)=>{stored=value;}};
  savePreferences({track:{id:'local-123',title:'private name',src:'https://private.invalid/?token=secret'},position:22,intent:'play',repeat:'one',shuffle:true},storage);
  assert.deepEqual(JSON.parse(stored),{schema:1,repeat:'one',shuffle:true,lastDemoId:null,position:0});
  assert.doesNotMatch(stored,/private|token|intent|src/);
});
