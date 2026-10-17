import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createAttachmentHttpJourney,chooseAttachment,waitForValue} from './helpers/relay-attachment-http-server.js';
import {conversationMenu,OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
const available=existsSync(new URL('../backend/relay-owner-attachments.js',import.meta.url));
const file={name:'socket-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic local socket cancellation fixture only.')};
const upload=r=>r.method==='POST'&&r.path==='/relay/owner/attachments';
const message=r=>r.method==='POST'&&r.path==='/relay/owner/messages';
async function journey(t){if(!available){t.skip('Requires PR108 real attachment backend; no simulated message acceptance is substituted.');return;}return createAttachmentHttpJourney(t);}
async function send(page,text='Synthetic private socket test'){await chooseAttachment(page,file);await page.locator('#relay-owner-message-text').fill(text);await page.getByRole('button',{name:'Send private message',exact:true}).click();}
async function loseSession(page){await page.evaluate(key=>{localStorage.removeItem(key);dispatchEvent(new StorageEvent('storage',{key,newValue:null,storageArea:localStorage}));},OWNER_KEY);}
async function assertUploadCancelled(j,record){
 await waitForValue(()=>j.cancellations.find(event=>event.canceled===true&&event.request?.method==='POST'&&event.request.url===j.origin+'/relay/owner/attachments'&&event.request.postData===record.body));
 assert.equal(record.disconnected,true,'Actual HTTP response socket closed before its held response');
 // CDP and Playwright deliver cancellation independently; wait for both exact observations.
 const matchesAbort=f=>f.method==='POST'&&f.url===j.origin+'/relay/owner/attachments'&&f.body===record.body&&f.error==='net::ERR_ABORTED';
 await waitForValue(()=>j.failures.find(matchesAbort));
 assert.equal(j.failures.some(matchesAbort),true,'Browser confirms this exact POST abort');
}

test('held upload POST cancellation discards staged bytes and a late HTTP response cannot restore the file',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h}=j;const held=j.hold(upload);await send(page);const record=await held.entered;const {id}=JSON.parse(record.body);assert.equal(record.status,201);assert.equal(h.rows('SELECT state FROM relay_owner_attachments WHERE id=?',id)[0].state,'staged');
 await page.getByRole('button',{name:'Remove socket-fixture.txt',exact:true}).click();await held.closed;await assertUploadCancelled(j,record);await waitForValue(()=>h.rows('SELECT state FROM relay_owner_attachments WHERE id=?',id)[0]?.state,state=>state==='discarded');held.release();await held.done;
 assert.equal(record.lateResponse,true);assert.equal(j.records.filter(message).length,0);assert.equal(await page.locator('.relay-attachment-summary,.relay-linked-attachment').count(),0);assert.equal(await page.locator('#relay-owner-message-text').inputValue(),'Synthetic private socket test');assert.equal(h.rows('SELECT bytes FROM relay_owner_attachments WHERE id=?',id)[0].bytes,null);j.assertContained();
});

test('removal before server admission never sends a message and late orphan bytes expire on real cleanup',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h,owner}=j;const held=j.hold(upload,{phase:'before'});await send(page);const record=await held.entered;const {id}=JSON.parse(record.body);
 await page.getByRole('button',{name:'Remove socket-fixture.txt',exact:true}).click();await held.closed;await assertUploadCancelled(j,record);await waitForValue(()=>j.records.find(r=>r.path.endsWith('/attachments/discard')&&r.status===200));held.release();await held.done;
 assert.equal(j.records.filter(message).length,0);assert.equal(await page.locator('.relay-attachment-summary,.relay-linked-attachment').count(),0);
 // Simulate elapsed server time; do not claim a real 24-hour endurance test.
 const now=Date.now();t.mock.method(Date,'now',()=>now+86400001);
 const response=await h.phone('/attachments',{id:crypto.randomUUID(),message_id:crypto.randomUUID(),name:'cleanup-trigger.txt',mime_type:'text/plain',data_base64:Buffer.from('Synthetic cleanup trigger').toString('base64')},owner.device_token);assert.equal(response.status,201);
 const old=h.rows('SELECT state,bytes FROM relay_owner_attachments WHERE id=?',id)[0];assert.ok(!old||['discarded','expired'].includes(old.state));if(old)assert.equal(old.bytes,null);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,0);j.assertContained();
});

test('revocation and local session loss cancel a held upload; late admission cannot write private bytes',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h,owner}=j;const held=j.hold(upload,{phase:'before'});await send(page);const record=await held.entered;
 const revoked=await h.phone('/devices/revoke',{device_id:owner.device.id},owner.device_token);assert.equal(revoked.status,200);await loseSession(page);await held.closed;await assertUploadCancelled(j,record);held.release();await held.done;
 assert.ok([401,403].includes(record.status));assert.equal(j.records.filter(message).length,0);assert.equal(h.rows('SELECT id FROM relay_owner_attachments').length,0);assert.equal(await page.locator('.relay-attachment-summary,.relay-linked-attachment').count(),0);j.assertContained();
});

test('channel changes isolate a held private upload and its late receipt; no public write is made',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h}=j;const held=j.hold(upload);await send(page);const record=await held.entered;await conversationMenu(page,'Public chat');await page.locator('#message-text').fill('Independent unsent public draft');assert.equal(await page.locator('.relay-attachment-summary,.relay-linked-attachment').count(),0);held.release();await held.done;
 await waitForValue(()=>h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,value=>value===1);assert.equal(record.delivered,true);assert.equal(await page.locator('#message-text').inputValue(),'Independent unsent public draft');assert.equal(await page.locator('.relay-linked-attachment').count(),0);assert.equal(j.records.some(r=>r.method==='POST'&&r.path.startsWith('/shared/')),false);
 await conversationMenu(page,'Owner chat');await page.locator('.relay-linked-attachment').waitFor();assert.equal(j.records.filter(message).length,1);j.assertContained();
});

test('lost upload and message responses keep UUIDs immutable and repeated sends never duplicate accepted state',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h}=j;const firstUpload=j.hold(upload);await send(page);await firstUpload.entered;firstUpload.release('truncate');await firstUpload.done;await page.getByRole('button',{name:'Retry file send',exact:true}).waitFor();
 const firstMessage=j.hold(message);await page.getByRole('button',{name:'Retry file send',exact:true}).click();await firstMessage.entered;assert.equal(await page.getByRole('button',{name:'Remove socket-fixture.txt',exact:true}).isDisabled(),true);await page.locator('#relay-owner-message-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});assert.equal(j.records.filter(message).length,1);firstMessage.release('truncate');await firstMessage.done;await page.getByRole('button',{name:'Retry private send',exact:true}).waitFor();
 await page.locator('#relay-owner-message-text').fill('Edited draft remains unsent');await page.getByRole('button',{name:'Retry private send',exact:true}).click();await page.locator('.relay-linked-attachment').waitFor();assert.equal(await page.locator('#relay-owner-message-text').inputValue(),'Edited draft remains unsent');
 const uploads=j.records.filter(upload),messages=j.records.filter(message);assert.equal(uploads.length,2);assert.deepEqual(JSON.parse(uploads[0].body),JSON.parse(uploads[1].body));assert.equal(messages.length,2);assert.deepEqual(JSON.parse(messages[0].body),JSON.parse(messages[1].body));assert.equal(h.rows('SELECT id FROM relay_owner_attachments').length,1);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,1);assert.equal(h.rows('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,1);j.assertContained();
});

test('an already accepted message response arriving after session loss cannot recreate private UI',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h}=j;const held=j.hold(message);await send(page);await held.entered;assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,1);await loseSession(page);held.release();await held.done;await page.waitForFunction(()=>!document.querySelector('#relay-owner-message-text'));
 assert.equal(await page.locator('.relay-linked-attachment,.relay-attachment-summary').count(),0);assert.equal(j.records.filter(message).length,1);const stores=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert.equal(stores.includes(file.name),false);j.assertContained();
});

test('browser replay after an empty HTTP connection loss preserves the same upload identity',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h}=j;const held=j.hold(upload);await send(page);await held.entered;held.release('drop');await held.done;await page.locator('.relay-linked-attachment').waitFor();
 const uploads=j.records.filter(upload);assert.equal(uploads.length,2,'Pinned Chrome replays this unacknowledged HTTP POST');assert.deepEqual(JSON.parse(uploads[0].body),JSON.parse(uploads[1].body));assert.equal(h.rows('SELECT id FROM relay_owner_attachments').length,1);assert.equal(h.rows('SELECT uploads FROM relay_owner_attachment_rates')[0].uploads,1);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,1);j.assertContained();
});
