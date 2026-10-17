import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,conversationMenu,RELAY_URL,OWNER_KEY,writeSyntheticEvidence} from './helpers/relay-conversation-browser-fixture.js';
const backendAvailable=existsSync(new URL('../backend/relay-owner-attachments.js',import.meta.url));
function png(){const crc=bytes=>{let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};const chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;};const hdr=Buffer.alloc(13);hdr.writeUInt32BE(32);hdr.writeUInt32BE(32,4);hdr[8]=8;hdr[9]=6;const pixels=Buffer.alloc(32*(1+32*4));for(let y=0;y<32;y++)for(let x=0;x<32;x++){const p=y*129+1+x*4;pixels[p]=70;pixels[p+1]=110;pixels[p+2]=160;pixels[p+3]=255;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
const textFile={name:'private-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic private file bytes')};
const imageFile={name:'private-image.png',mimeType:'image/png',buffer:png()};
const pdfFile={name:'private-document.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic download fixture\n%%EOF\n')};
async function journey(t,{width=390,height=844}={}){
 if(!backendAvailable){t.skip('Requires the separately owned private attachment backend; run on the paired integration head.');return;}
 const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];t.after(()=>closeConversationHarness(browser,h,pages));
 const owner=await h.pair(await h.oauth());const capability=await (await h.phone('/session',undefined,owner.device_token)).json();assert.equal(capability.attachments_enabled,true,'Real approved session must explicitly advertise attachment capability');
 const phone=await openConversationPage(browser,h,{owner,clock:false,width,height});pages.push(phone);const page=phone.page;
 await page.addInitScript(()=>{window.liveAttachmentURLs=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);liveAttachmentURLs.add(url);return url;};URL.revokeObjectURL=url=>{liveAttachmentURLs.delete(url);return revoke(url);};});
 await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();return {h,owner,phone,page};
}
async function select(page,files){await page.locator('#relay-compose-menu').click();const dialog=page.getByRole('dialog',{name:'Attachments',exact:true});await dialog.getByLabel('Choose files',{exact:true}).setInputFiles(files);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});}

test('private attachment-only send links real bytes, previews raster images and downloads documents without public URLs',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {h,phone,page}=j;
 await select(page,[textFile,imageFile,pdfFile]);await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.locator('.relay-linked-attachment').first().waitFor();assert.equal(await page.locator('.relay-linked-attachment').count(),3);assert.equal(await page.locator('.relay-attachment-summary').count(),0);
 await page.locator('.relay-linked-attachment').filter({hasText:'private-image.png'}).scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.relay-linked-preview')?.naturalWidth===32);assert.equal(await page.locator('iframe,embed,object').count(),0);assert.equal(await page.getByRole('button',{name:'Preview private-document.pdf',exact:true}).count(),0);
 await page.getByRole('button',{name:'Save to Files: private-document.pdf',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'Download private-document.pdf',exact:true}).click();const download=await downloading;assert.equal(download.suggestedFilename(),pdfFile.name);assert.deepEqual(await readFile(await download.path()),pdfFile.buffer);
 await writeSyntheticEvidence(phone,'relay-private-linked-attachments',{synthetic:true,actualBackendRoutes:true});
 const rows=h.rows('SELECT message_id,id,state,size_bytes FROM relay_owner_attachments');assert.equal(rows.length,3);assert.ok(rows.every(r=>r.state==='linked'));const messages=h.rows("SELECT body FROM relay_owner_entries WHERE kind='user'");assert.equal(messages.length,1);assert.equal(messages[0].body,'');
 assert.equal((await page.locator('body').innerText()).includes('unreadable response'),false);
 await conversationMenu(page,'Public chat');assert.equal(await page.locator('.relay-linked-attachment').count(),0);assert.equal(await page.locator('#relay-compose-menu').isVisible(),false);assert.equal(await page.evaluate(()=>liveAttachmentURLs.size),1,'Handed-off download survives view disposal');await conversationMenu(page,'Owner chat');await page.locator('.relay-linked-preview').waitFor();assert.equal(await page.locator('.relay-linked-attachment').count(),3);await assertNoPrivatePersistence(page,[textFile.name,imageFile.name,pdfFile.name]);assertBrowserContained(phone);
});

test('lost message response retries the same original body and ordered files without duplicate storage',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {h,phone,page}=j;
 phone.rule(r=>r.method==='POST'&&r.path==='/relay/owner/messages',async({forward})=>{const response=await forward();assert.equal(response.status,201);return {abort:true};});
 await select(page,[textFile]);await page.locator('#relay-owner-message-text').fill('Original synthetic file message');await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.getByRole('button',{name:'Retry private send',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Remove private-fixture.txt',exact:true}).isDisabled(),true);
 await page.locator('#relay-owner-message-text').fill('Edited unsent draft');await page.getByRole('button',{name:'Retry private send',exact:true}).click();await page.locator('.relay-linked-attachment').waitFor();assert.equal(await page.locator('#relay-owner-message-text').inputValue(),'Edited unsent draft');
 const sends=phone.records.filter(r=>r.method==='POST'&&r.path==='/relay/owner/messages');assert.equal(sends.length,2);assert.deepEqual(JSON.parse(sends[0].body),JSON.parse(sends[1].body));assert.equal(h.rows('SELECT id FROM relay_owner_attachments').length,1);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,1);assert.equal(phone.records.filter(r=>r.method==='POST'&&r.path==='/relay/owner/attachments').length,1);assertBrowserContained(phone);
});

test('removing a file during preparation cancels before upload and preserves text send',{timeout:120000},async t=>{
 const j=await journey(t,{width:320,height:568});if(!j)return;const {h,phone,page}=j;await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){const file=this;window.preparingAttachment=true;return new Promise(resolve=>window.releaseAttachmentPreparation=async()=>resolve(await original.call(file)));};});
 await select(page,[textFile]);await page.locator('#relay-owner-message-text').fill('Keep this text');await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.waitForFunction(()=>window.preparingAttachment===true);await page.getByRole('button',{name:'Remove private-fixture.txt',exact:true}).click();await page.evaluate(()=>releaseAttachmentPreparation());
 await page.waitForFunction(()=>!document.querySelector('.relay-attachment-summary'));await page.waitForFunction(()=>!document.querySelector('#relay-owner-message-form button[type=submit]').disabled);
 assert.equal(phone.records.filter(r=>r.method==='POST'&&r.path==='/relay/owner/attachments').length,0);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,0);await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.locator('.message-body').filter({hasText:'Keep this text'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assertBrowserContained(phone);
});

test('a partial staging failure stays unsent and removal disposes uploaded bytes before a text-only send',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {h,phone,page}=j;
 await select(page,[textFile,{name:'invalid-image.png',mimeType:'image/png',buffer:Buffer.from('Synthetic invalid raster bytes')}]);await page.locator('#relay-owner-message-text').fill('Preserved text');await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.relay-attachment-summary')?.textContent.includes('Uploaded'));
 await page.waitForFunction(()=>!document.querySelector('#relay-owner-message-form button[type=submit]').disabled);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,0);
 await page.getByRole('button',{name:'Remove private-fixture.txt',exact:true}).click();await page.getByRole('button',{name:'Remove invalid-image.png',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.relay-attachment-summary'));await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.locator('.message-body').filter({hasText:'Preserved text'}).waitFor();assert.equal(h.rows("SELECT id FROM relay_owner_attachments WHERE state='staged' OR state='linked'").length,0);assertBrowserContained(phone);
});

test('closing private view cancels delayed previews and owner loss clears selected files',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {phone,page}=j;await select(page,[imageFile]);await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.locator('.relay-linked-attachment').waitFor();
 await page.getByRole('button',{name:'Close preview of private-image.png',exact:true}).waitFor();await page.getByRole('button',{name:'Close preview of private-image.png',exact:true}).click();const held=phone.hold(r=>r.method==='GET'&&r.path==='/relay/owner/attachments/content');await page.getByRole('button',{name:'Preview private-image.png',exact:true}).click();await held.entered;await conversationMenu(page,'Public chat');held.release();await page.waitForFunction(()=>liveAttachmentURLs.size===0);assert.equal(await page.locator('.relay-linked-preview').count(),0);await conversationMenu(page,'Owner chat');await select(page,[textFile]);await page.evaluate(key=>{localStorage.removeItem(key);dispatchEvent(new StorageEvent('storage',{key,newValue:null,storageArea:localStorage}));},OWNER_KEY);await page.waitForFunction(()=>!document.querySelector('.relay-attachment-summary'));assert.equal(await page.locator('.relay-linked-attachment').count(),0);assertBrowserContained(phone);
});

test('Send includes the complete chooser batch while its first image preview remains held',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {h,phone,page}=j;
 await page.evaluate(()=>{const original=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(file){window.releaseFirstPreview=()=>original.call(this,file);};});
 await select(page,[imageFile,textFile]);assert.equal(await page.locator('.relay-attachment-chip').count(),2);
 await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.locator('.relay-linked-attachment').nth(1).waitFor();
 let rows=h.rows('SELECT message_id,id,state FROM relay_owner_attachments');assert.equal(rows.length,2);assert.ok(rows.every(row=>row.state==='linked'));assert.equal(new Set(rows.map(row=>row.message_id)).size,1);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,1);
 await page.evaluate(async()=>{releaseFirstPreview();await new Promise(resolve=>setTimeout(resolve,100));});assert.equal(await page.locator('.relay-attachment-chip').count(),0);assert.equal(await page.locator('.relay-linked-attachment').count(),2);assert.equal(h.rows("SELECT id FROM relay_owner_entries WHERE kind='user'").length,1);assertBrowserContained(phone);
});
