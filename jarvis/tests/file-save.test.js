import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileDownload,nativeSaveMode,saveToDevice} from '../public/assets/file-save.js';
const download={blob:new Blob(['synthetic text'],{type:'text/plain'}),name:'synthetic.txt'};
test('picker is invoked before the first asynchronous boundary and success waits for close',async()=>{
 const calls=[];let close;const env={showSaveFilePicker(options){calls.push(options.suggestedName);return Promise.resolve({createWritable:async()=>({write:async b=>calls.push(await b.text()),close:()=>new Promise(r=>close=r)})});}};
 let done=false;const pending=saveToDevice(download,env).then(mode=>{done=true;assert.equal(mode,'file-picker');});assert.deepEqual(calls,['synthetic.txt']);
 while(!close)await new Promise(r=>setImmediate(r));assert.equal(done,false);close();await pending;assert.deepEqual(calls,['synthetic.txt','synthetic text']);
});
test('write failure aborts instead of closing and committing partial bytes',async()=>{
 const calls=[];const failure=Error('disk full');const env={showSaveFilePicker:async()=>({createWritable:async()=>({write:async()=>{throw failure;},close:async()=>calls.push('close'),abort:async()=>calls.push('abort')})})};
 await assert.rejects(saveToDevice(download,env),e=>e===failure);assert.deepEqual(calls,['abort']);
});
test('cancel is preserved without falling through to another destination',async()=>{
 let shared=false;const env={showSaveFilePicker(){throw new DOMException('cancel','AbortError');},navigator:{share(){shared=true;}}};
 await assert.rejects(saveToDevice(download,env),{name:'AbortError'});assert.equal(shared,false);
});
test('file sharing preserves actual MIME and filename and starts synchronously',async()=>{
 let data;const env={File,navigator:{canShare:({files})=>files[0].type==='text/plain',share:value=>{data=value;return Promise.resolve();}}};
 const pending=saveToDevice(download,env);assert.equal(data.files[0].name,'synthetic.txt');assert.equal(data.files[0].type,'text/plain');assert.equal(await data.files[0].text(),'synthetic text');assert.equal(await pending,'share');
});
test('missing, false and throwing file-share support return a usable fallback',async()=>{
 for(const navigator of [{},{canShare:()=>false,share(){}},{canShare(){throw Error('blocked');},share(){}}]){const env={File,navigator};assert.equal(nativeSaveMode(download,env),null);assert.equal(await saveToDevice(download,env),null);}
});
test('URL survives an open/download handoff and view disposal, with bounded cleanup',()=>{
 const revoked=[],timers=[];const urls={createObjectURL:()=> 'blob:synthetic',revokeObjectURL:u=>revoked.push(u)};
 const file=createFileDownload(download.blob,download.name,urls,(fn,ms)=>timers.push({fn,ms}));file.handoff();file.revoke();file.revoke();assert.deepEqual(revoked,[]);assert.equal(timers.length,1);assert.equal(timers[0].ms,300000);timers[0].fn();assert.deepEqual(revoked,['blob:synthetic']);
 const unused=createFileDownload(download.blob,download.name,urls);unused.revoke();assert.equal(revoked.length,2);
});
