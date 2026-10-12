import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdir} from 'node:fs/promises';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,conversationMenu,RELAY_URL,OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
const available=existsSync(new URL('../backend/relay-owner-assistant-attachments.js',import.meta.url));
const inbox_id='brayden-owner';
async function journey(t,{height=568}={}){if(!available){t.skip('Requires exact assistant delivery backend pair.');return;}const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];t.after(()=>closeConversationHarness(browser,h,pages));const auth=await h.oauth(),owner=await h.pair(auth),phone=await openConversationPage(browser,h,{owner,clock:false,width:320,height});pages.push(phone);const page=phone.page;return {h,auth,owner,phone,page};}
async function original(j){const id=crypto.randomUUID();assert.equal((await j.h.phone('/messages',{id,body:'Synthetic requested files'},j.owner.device_token)).status,201);return id;}
async function stage(j,message_id,delivery_id,name,mime_type,bytes){const args={inbox_id,message_id,delivery_id,attachment_id:crypto.randomUUID(),name,mime_type,data_base64:bytes.toString('base64')};const value=await j.h.rpc(j.auth,'relay_owner_attachment_upload',args);return {args,attachment:value.attachment};}
const commit=(j,message_id,delivery_id,files,body='',kind='deliverable')=>j.h.rpc(j.auth,kind==='reply'?'relay_owner_reply_with_attachments':'relay_owner_deliverable_send',{inbox_id,message_id,delivery_id,body,attachment_ids:files.map(f=>f.attachment.id)});

test('phone private text updates are ordered, preserve the reply and stay out of public chat',{timeout:120000},async t=>{
 const j=await journey(t,{height:844});if(!j)return;const {page,h}=j,message=await original(j);
 const reply=await h.rpc(j.auth,'relay_owner_reply',{inbox_id,message_id:message,body:'Synthetic accepted reply remains unchanged.'});
 const first=crypto.randomUUID();await commit(j,message,first,[],'Synthetic progress: the focused fix is ready.');assert.equal((await commit(j,message,first,[],'Synthetic progress: the focused fix is ready.')).newWrite,false);
 await commit(j,message,crypto.randomUUID(),[],'Synthetic progress: required checks passed.');
 await page.goto(RELAY_URL);await page.getByText(reply.entry.body,{exact:true}).waitFor();await page.getByRole('button',{name:'Updates and files from assistant',exact:true}).click();
 await page.getByText('Synthetic progress: required checks passed.',{exact:true}).waitFor();assert.deepEqual(await page.locator('[data-delivery-id] .message-body').allTextContents(),['Synthetic progress: the focused fix is ready.','Synthetic progress: required checks passed.']);
 assert.equal(await page.getByText(reply.entry.body,{exact:true}).count(),1);assert.equal(await page.locator('.relay-linked-attachment').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const evidence='/tmp/jarvis-owner-progress-evidence';await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/phone-320.png'});
 await page.getByRole('button',{name:'Close assistant updates',exact:true}).click();assert.equal(await page.locator('[data-delivery-id]').count(),0);
 await conversationMenu(page,'Public chat');assert.equal(await page.getByText('Synthetic progress: required checks passed.',{exact:true}).count(),0);assertBrowserContained(j.phone);
});

test('actual MCP later image and PDF preserves text, retries after a synthetic post-success throw, and clears on local credential removal',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h,phone}=j,message=await original(j),delivery=crypto.randomUUID();
 const reply=await h.rpc(j.auth,'relay_owner_reply',{inbox_id,message_id:message,body:'Accepted synthetic text remains unchanged.'});
 const raster=JSON.parse(await readFile(new URL('./fixtures/relay-attachment-raster.json',import.meta.url),'utf8')),docs=JSON.parse(await readFile(new URL('./fixtures/relay-attachment-document.json',import.meta.url),'utf8'));
 const png=Buffer.from(raster.png,'base64'),pdf=Buffer.from(docs.pdf,'base64');
 const image=await stage(j,message,delivery,'Synthetic illustration.png','image/png',png),document=await stage(j,message,delivery,'Synthetic report.pdf','application/pdf',pdf);
 assert.equal((await h.rpc(j.auth,'relay_owner_attachment_upload',image.args)).newWrite,false);
 await assert.rejects((async()=>{await commit(j,message,delivery,[image,document]);throw Error('Synthetic lost response after persistence');})(),/lost response/);
 assert.equal((await commit(j,message,delivery,[image,document])).newWrite,false);
 await page.goto(RELAY_URL);await page.getByText('Accepted synthetic text remains unchanged.',{exact:true}).waitFor();await page.getByRole('button',{name:'Updates and files from assistant',exact:true}).click();await page.getByRole('button',{name:'Download Synthetic report.pdf',exact:true}).waitFor();assert.equal(await page.locator('[data-delivery-id]').count(),1);await conversationMenu(page,'Search messages');await page.locator('#relay-owner-search').fill('report.pdf');await page.getByRole('button',{name:'Download Synthetic report.pdf',exact:true}).waitFor();await page.locator('#relay-owner-search').fill('');
 await page.getByRole('button',{name:'Preview Synthetic illustration.png',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.relay-linked-preview')?.naturalWidth>0);assert.equal(await page.locator('iframe,embed,object').count(),0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download Synthetic report.pdf',exact:true}).click();assert.deepEqual(await readFile(await(await download).path()),pdf);
 const conversation=await(await h.phone('/conversation?message_id='+message,undefined,j.owner.device_token)).json();assert.equal(conversation.reply.id,reply.entry.id);assert.equal(conversation.reply.body,reply.entry.body);assert.equal(conversation.deliverables.length,1);
 await conversationMenu(page,'Public chat');assert.equal(await page.locator('.relay-linked-attachment').count(),0);await conversationMenu(page,'Owner chat');await page.getByRole('button',{name:'Preview Synthetic illustration.png',exact:true}).waitFor();
 const held=phone.hold(r=>r.method==='GET'&&r.path==='/relay/owner/attachments/content');await page.getByRole('button',{name:'Preview Synthetic illustration.png',exact:true}).click();await held.entered;
 assert.equal((await h.phone('/devices/revoke',{device_id:j.owner.device.id},j.owner.device_token)).status,200);
 await page.evaluate(key=>{localStorage.removeItem(key);dispatchEvent(new StorageEvent('storage',{key,newValue:null,storageArea:localStorage}));},OWNER_KEY);held.release();await page.waitForFunction(()=>!document.querySelector('.relay-linked-attachment'));assert.equal(await page.locator('.relay-linked-preview').count(),0);await assertNoPrivatePersistence(page,['Synthetic illustration.png','Synthetic report.pdf']);assertBrowserContained(phone);
});

test('actual first file-only reply and later paginated deliveries remain separate and close safely',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page}=j,message=await original(j),first=crypto.randomUUID();const file=await stage(j,message,first,'First reply.txt','text/plain',Buffer.from('Synthetic first file-only reply'));await commit(j,message,first,[file],'','reply');
 for(let i=0;i<11;i++){const id=crypto.randomUUID(),file=await stage(j,message,id,'Later '+i+'.txt','text/plain',Buffer.from('Synthetic page '+i));await commit(j,message,id,[file]);}
 await page.goto(RELAY_URL);await page.getByRole('button',{name:'Download First reply.txt',exact:true}).waitFor();await page.getByRole('button',{name:'Updates and files from assistant',exact:true}).click();await page.getByRole('button',{name:'Load more updates',exact:true}).waitFor();assert.equal(await page.locator('[data-delivery-id]').count(),10);
 await page.getByRole('button',{name:'Load more updates',exact:true}).click();await page.getByRole('button',{name:'Download Later 10.txt',exact:true}).waitFor();assert.equal(await page.locator('[data-delivery-id]').count(),11);assert.equal(await page.getByRole('button',{name:'Load more updates',exact:true}).count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'Close assistant updates',exact:true}).click();assert.equal(await page.locator('[data-delivery-id]').count(),0);assert.equal(await page.getByRole('button',{name:'Download First reply.txt',exact:true}).count(),1);assertBrowserContained(j.phone);
});

test('server-only revocation rejects the next actual file request and clears cached files, previews and credentials',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {page,h,phone}=j,message=await original(j),delivery=crypto.randomUUID();
 const raster=JSON.parse(await readFile(new URL('./fixtures/relay-attachment-raster.json',import.meta.url),'utf8'));const image=await stage(j,message,delivery,'Revocation image.png','image/png',Buffer.from(raster.png,'base64')),text=await stage(j,message,delivery,'Revocation document.txt','text/plain',Buffer.from('Synthetic revocation download'));
 await commit(j,message,delivery,[image,text]);await page.addInitScript(()=>{window.activePrivateURLs=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);activePrivateURLs.add(url);return url;};URL.revokeObjectURL=url=>{activePrivateURLs.delete(url);return revoke(url);};});
 await page.goto(RELAY_URL);await page.getByRole('button',{name:'Updates and files from assistant',exact:true}).click();await page.getByRole('button',{name:'Preview Revocation image.png',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.relay-linked-preview')?.naturalWidth>0);assert.equal(await page.evaluate(()=>activePrivateURLs.size),1);
 // Revoke through the real server only. Do not edit browser storage or dispatch storage events.
 assert.equal((await h.phone('/devices/revoke',{device_id:j.owner.device.id},j.owner.device_token)).status,200);assert.ok(await page.evaluate(key=>localStorage.getItem(key),OWNER_KEY));
 await page.getByRole('button',{name:'Download Revocation document.txt',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.relay-linked-attachment')&&activePrivateURLs.size===0);
 assert.ok(phone.records.some(r=>r.path==='/relay/owner/attachments/content'&&r.status===401));assert.equal(await page.evaluate(key=>localStorage.getItem(key),OWNER_KEY),null);assert.equal(await page.locator('[data-delivery-id],.relay-linked-preview').count(),0);assertBrowserContained(phone);
});
