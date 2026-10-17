import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentDraft} from '../public/assets/relay-attachments.js';
const file=(name='fixture.txt',size=8,type='text/plain')=>new File(['a'.repeat(size)],name,{type,lastModified:1});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('selection is bounded, duplicate-safe, inert and explicitly unavailable without transport',async()=>{
 const draft=createAttachmentDraft({maxFiles:2,maxBytes:10});await draft.add([file('<img onerror=x>.txt'),file('empty',0),file('large',11)]);assert.equal(draft.snapshot().items.length,1);assert.match(draft.snapshot().notice,/nonempty/);await draft.add([file('<img onerror=x>.txt')]);assert.equal(draft.snapshot().items.length,1);await draft.add([file('b'),file('c')]);assert.equal(draft.snapshot().items.length,2);assert.match(draft.snapshot().notice,/up to 2/);assert.equal(await draft.start(),false);assert.equal(draft.snapshot().available,false);assert.ok(draft.snapshot().items.every(item=>item.status==='selected'&&item.attachment===null));assert.match(draft.snapshot().notice,/not available/);draft.clear();assert.equal(draft.snapshot().items.length,0);
});
test('removed preview and cancelled upload cannot reappear after delayed responses',async()=>{
 const image=deferred(),upload=deferred();let signal;
 const draft=createAttachmentDraft({preview:()=>image.promise,upload:(_file,args)=>{signal=args.signal;return upload.promise;}});
 const adding=draft.add([file('fixture.png',8,'image/png')]);const id=draft.snapshot().items[0].id;draft.remove(id);image.resolve('data:image/png;base64,AA==');await adding;assert.equal(draft.snapshot().items.length,0);
 await draft.add([file()]);const sending=draft.start();assert.equal(draft.snapshot().items[0].status,'uploading');draft.clear();assert.equal(signal.aborted,true);upload.resolve({id:'fixture-receipt'});await sending;assert.equal(draft.snapshot().items.length,0);
});
test('progress needs a real receipt; repeated taps do not duplicate uploads and failures stay retryable',async()=>{
 const done=deferred();let calls=0,onProgress;const draft=createAttachmentDraft({upload:async(_file,args)=>{calls++;onProgress=args.onProgress;return done.promise;}});await draft.add([file()]);const first=draft.start();await draft.start();assert.equal(calls,1);onProgress(45);onProgress(20);assert.equal(draft.snapshot().items[0].progress,45);onProgress(100);assert.equal(draft.snapshot().items[0].progress,99);done.reject(Error('fixture offline'));await first;assert.equal(draft.snapshot().items[0].status,'error');assert.equal(draft.snapshot().items[0].attachment,null);
 const success=createAttachmentDraft({upload:async()=>({id:'receipt'})});await success.add([file()]);assert.equal(await success.start(),true);assert.equal(success.snapshot().items[0].status,'ready');assert.equal(success.snapshot().items[0].progress,100);assert.equal(success.snapshot().items[0].attachment.id,'receipt');
});

test('private attachment policy rejects unsupported types and the first byte over 1 MiB',async()=>{
 const draft=createAttachmentDraft();
 await draft.add([file('large.txt',1048577),file('animation.gif',8,'image/gif'),file('vector.svg',8,'image/svg+xml'),file('page.html',8,'text/html'),file('script.js',8,'text/javascript')]);
 assert.equal(draft.snapshot().items.length,0);
 await draft.add([file('maximum.txt',1048576),file('data.json',8,'application/json'),file('notes.md',8,'text/markdown'),file('document.pdf',8,'application/pdf')]);
 assert.equal(draft.snapshot().items.length,4);assert.equal(draft.snapshot().available,false);
});

test('a chooser batch is atomic and Send includes both files while previews are held',async()=>{
 const held=deferred(),uploaded=[];const draft=createAttachmentDraft({preview:()=>held.promise,upload:async(file,{id})=>{uploaded.push(file.name);return {id};}});
 const adding=draft.add([file('first.txt'),file('second.txt')]);assert.equal(await draft.start(),true);draft.lock();const submitted=draft.snapshot();held.resolve(null);await adding;
 assert.deepEqual(uploaded,['first.txt','second.txt']);assert.deepEqual(draft.snapshot(),submitted);
});
for(const action of ['clear','cancelSelection'])test(`a held multi-file selection cannot continue after ${action}`,async()=>{
 const held=deferred();const draft=createAttachmentDraft({preview:()=>held.promise});const adding=draft.add([file('first.txt'),file('second.txt')]);draft[action]();const state=draft.snapshot();held.resolve('late preview');await adding;assert.deepEqual(draft.snapshot(),state);
 await draft.add([file('fresh.txt')]);assert.equal(draft.snapshot().items.at(-1).name,'fresh.txt');
});
test('clearing then selecting new files does not give a stale rejected preview ownership of the new draft',async()=>{
 const held=deferred();const draft=createAttachmentDraft({preview:f=>f.name==='old.txt'?held.promise:Promise.resolve(null)});const adding=draft.add([file('old.txt'),file('old-second.txt')]);draft.clear();await draft.add([file('new.txt')]);const state=draft.snapshot();held.reject(Error('late failure'));await adding;assert.deepEqual(draft.snapshot(),state);
});
