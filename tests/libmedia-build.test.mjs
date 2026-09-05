import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {patchMediaStreamGuard} from '../scripts/build-libmedia.mjs';

test('pinned runtime accepts its VideoFrame renderer without requiring a WebGL canvas',async()=>{
  const source=await readFile(new URL('../node_modules/@libmedia/avplayer/dist/umd/avplayer.js',import.meta.url),'utf8');
  const patched=patchMediaStreamGuard(source);
  const expression=patched.match(/if\((!y\.A\.wasmPlayerSupported[^;]+?)\)return/)[1];
  const rejects=Function('y','return '+expression);
  const scope={isMediaStreamMode:()=>true},caps={trackGenerator:true,wasmBaseSupported:true,fetch:true,audioContext:true,wasmPlayerSupported:false};
  assert.equal(rejects.call(scope,{A:caps}),false);
  assert.equal(rejects.call({isMediaStreamMode:()=>false},{A:caps}),true);
  for(const key of ['trackGenerator','wasmBaseSupported','fetch','audioContext'])assert.equal(rejects.call(scope,{A:{...caps,[key]:false}}),true,key+' is still required');
  assert.throws(()=>patchMediaStreamGuard(patched),/no longer matches/);
});
