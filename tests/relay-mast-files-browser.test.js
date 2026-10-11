import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';

test('Mast phone files: uncertain uploads/sends, inline images both ways, exact document download and auth cleanup',{timeout:60000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const dir=process.env.MAST_FILE_EVIDENCE_DIR||'/tmp/mast-file-evidence';await mkdir(dir,{recursive:true});
  const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}}),pages=[];
  const adapter=(path,body)=>h.fixture.request('/relay/mast/'+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
  try{
    const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;
    await page.goto(SITE+'/mast/');await page.locator('#composer:not([hidden])').waitFor();
    const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=280;c.height=130;const x=c.getContext('2d');x.fillStyle='#425c69';x.fillRect(0,0,280,130);x.fillStyle='white';x.font='18px sans-serif';x.fillText('Synthetic private image',28,70);return c.toDataURL('image/png').split(',')[1];}),'base64');
    await page.locator('#files').setInputFiles({name:'synthetic-owner.png',mimeType:'image/png',buffer:png});
    phone.rule(r=>r.path==='/relay/owner/mast/files'&&r.method==='POST',async({forward})=>{await forward();return {abort:true};});
    phone.rule(r=>r.path==='/relay/owner/mast'&&r.method==='POST',async({forward})=>{await forward();return {abort:true};});
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('Files not confirmed. Retry or remove them; nothing has been sent.',{exact:true}).waitFor();
    assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,0);
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.outgoing img').waitFor();
    await page.waitForFunction(()=>document.querySelector('.outgoing img')?.naturalWidth===280);await page.screenshot({path:dir+'/mast-owner-image-phone-390.png'});
    assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_files')[0].n,1);assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,1);
    const message=h.rows('SELECT id FROM relay_mast_entries')[0].id,reply=crypto.randomUUID(),image=crypto.randomUUID(),documentId=crypto.randomUUID(),text='Synthetic Mast document bytes.\n';
    for(const file of [{id:image,name:'synthetic-mast.png',mime_type:'image/png',data_base64:png.toString('base64')},{id:documentId,name:'synthetic-mast.txt',mime_type:'text/plain',data_base64:Buffer.from(text).toString('base64')}])assert.equal((await adapter('files',{...file,message_id:reply,reply_to:message})).status,201);
    assert.equal((await adapter('reply',{id:reply,reply_to:message,body:'Synthetic image and file from Mast.',attachment_ids:[image,documentId]})).status,201);
    await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Synthetic image and file from Mast.',{exact:true}).waitFor();
    await page.locator('.message-row:not(.outgoing) img').scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.message-row img')].length===2&&[...document.querySelectorAll('.message-row img')].every(x=>x.complete&&x.naturalWidth===280));
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download synthetic-mast.txt',exact:true}).click();const download=await downloadPromise;assert.equal((await readFile(await download.path())).toString(),text);
    await page.screenshot({path:dir+'/mast-files-phone-390.png'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:390,height:520});const box=await page.locator('#send').boundingBox();assert.ok(box.y+box.height<=520);
    await assertNoPrivatePersistence(page,['synthetic-owner.png','Synthetic Mast document']);
    assert.ok(phone.records.every(r=>!r.path.startsWith('/shared/')&&!r.path.startsWith('/v1/')&&!r.path.startsWith('/relay/owner/attachments')));
    h.rows('UPDATE relay_owner_sessions SET revoked_ms=1 WHERE device_id=?',owner.device.id);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#login:not([hidden])').waitFor();assert.equal(await page.locator('.message-row,img[src^="blob:"]').count(),0);
    assertBrowserContained(phone);
  }finally{await closeConversationHarness(browser,h,pages);}
});
