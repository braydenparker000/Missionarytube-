// Synthetic visual evidence through the real Worker/SQLite and original-origin
// offline CDP browser fixture. No production account, history or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,
  conversationMenu,assertBrowserContained,SITE,RELAY_URL,MUSE_URL} from '../../tests/helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../../backend/relay-common.js';

const directory=fileURLToPath(new URL('./',import.meta.url));
const sizes=[{width:360,height:800},{width:390,height:844},{width:412,height:915},{width:390,height:520},{width:1280,height:900,mobile:false}];
const evidence=[];
async function capture(phone,name){
  await phone.page.screenshot({path:resolve(directory,name+'.png'),animations:'disabled'});
  evidence.push({name,url:phone.page.url(),viewport:phone.page.viewportSize(),geometry:await phone.page.evaluate(()=>({
    width:innerWidth,documentWidth:document.documentElement.scrollWidth,
    header:document.querySelector('.topbar')?.getBoundingClientRect().toJSON(),
    composer:document.querySelector('.composer')?.getBoundingClientRect().toJSON(),
    sheet:document.querySelector('dialog[open]')?{...document.querySelector('dialog[open]').getBoundingClientRect().toJSON(),opacity:getComputedStyle(document.querySelector('dialog[open]')).opacity,background:getComputedStyle(document.querySelector('dialog[open]')).backgroundColor,scrollTop:document.querySelector('dialog[open]').scrollTop,scrollHeight:document.querySelector('dialog[open]').scrollHeight,clientHeight:document.querySelector('dialog[open]').clientHeight,heading:document.querySelector('dialog[open] .dialog-heading')?.getBoundingClientRect().toJSON(),focus:document.activeElement?.outerHTML?.slice(0,220)}:null
  }))});
}
test('capture synthetic conversation and request evidence',async t=>{
  await mkdir(directory,{recursive:true});
  const browser=await launchQualifiedBrowser(t);assert.ok(browser,'The qualified browser must be available');
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  const auth=await h.oauth(),owner=await h.pair(auth,'Synthetic design review phone');
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  const bodies=['Help me make time for a quiet evening. Keep it simple.','Could you help me choose a short book?'];
  const saved=await h.phone('/jobs',{id:ids[0],title:'A quiet evening',body:bodies[0],action_kind:'read_only'},owner.device_token);assert.equal(saved.status,201);
  const reply=await h.rpc(auth,'relay_owner_reply',{inbox_id:RELAY_OWNER_INBOX,message_id:ids[0],body:'Start with one small thing: put the phone down for ten minutes, make a cup of tea, and let the day settle.\n\n## A simple plan\n- A short walk\n- An easy meal\n- One chapter before bed\n\n[Open Notes](https://missionarytube.z13.web.core.windows.net/notes/)'});
  assert.equal((await h.phone('/jobs',{id:ids[1],title:'Find a short book',body:bodies[1],action_kind:'read_only'},owner.device_token)).status,201);
  for(const size of sizes){
    const phone=await openConversationPage(browser,h,{...size,owner,clock:false});phones.push(phone);const page=phone.page,suffix=size.width+'x'+size.height;
    await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();await page.locator('[data-job-id="'+ids[1]+'"]').waitFor();
    await capture(phone,'real-owner-'+suffix);
    await page.locator('#chat-menu').click();await capture(phone,'real-owner-menu-'+suffix);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('[data-job-id="'+ids[1]+'"]').getByRole('button',{name:'Inspect request',exact:true}).click();await page.locator('#relay-owner-request-refresh').waitFor();await page.waitForFunction(()=>!document.getElementById('relay-owner-request-refresh').disabled);
    await capture(phone,'real-owner-queued-'+suffix);await page.getByRole('button',{name:'Close private request',exact:true}).click();
    await page.locator('[data-job-id="'+ids[0]+'"]').getByRole('button',{name:'Inspect request',exact:true}).click();await page.locator('#relay-owner-request-refresh').waitFor();await page.waitForFunction(()=>!document.getElementById('relay-owner-request-refresh').disabled);
    assert.equal(await page.getByRole('dialog',{name:'Private request',exact:true}).getByRole('link',{name:'Open Notes',exact:true}).count(),1);
    await capture(phone,'real-owner-result-'+suffix);await page.getByRole('button',{name:'Close private request',exact:true}).click();
    await page.locator('#relay-owner-job-toggle').click();await page.locator('#relay-owner-job-title').fill('Review a short reading list');await page.locator('#relay-owner-message-text').fill('Find three books I can finish in a weekend. Include a brief reason for each.');
    await capture(phone,'real-owner-request-'+suffix);assertBrowserContained(phone);await phone.context.close();
  }
  const correction=await h.rpc(auth,'relay_owner_job_result_correct',{inbox_id:RELAY_OWNER_INBOX,job_id:ids[0],event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,expected_version:1,
    body:'Choose one gentle activity for tonight.\n\n- Make a cup of tea.\n- Read one chapter, if you feel like it.\n\nYou can leave the rest for another evening. [Save a note](https://missionarytube.z13.web.core.windows.net/notes/)',
    correction_summary:'Revised the earlier plan because it assumed you wanted several activities. This version keeps the request simple.'});assert.equal(correction.acceptedResult.version,2);
  const corrected=await openConversationPage(browser,h,{owner,clock:false});phones.push(corrected);await corrected.page.goto(RELAY_URL);await corrected.page.locator('[data-job-id="'+ids[0]+'"]').getByRole('button',{name:'Inspect request',exact:true}).click();await corrected.page.locator('#relay-owner-result-latest[data-result-version="2"]').waitFor();
  await capture(corrected,'real-owner-correction-390x844');assertBrowserContained(corrected);await corrected.context.close();
  const empty=await openConversationPage(browser,h,{clock:false});phones.push(empty);await empty.page.goto(MUSE_URL);await empty.page.locator('#prompt').waitFor();await empty.page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Public inbox'));await capture(empty,'real-muse-empty-390x844');
  empty.rule(record=>record.path==='/shared/messages'&&record.method==='POST',async()=>({abort:true}));await empty.page.locator('#prompt').fill('Help me explore a small idea for the weekend.');await empty.page.locator('#send').click();await empty.page.locator('#muse-sync-notice:not([hidden])').waitFor();assert.equal(await empty.page.getByText('Help me explore a small idea for the weekend.',{exact:true}).count(),1);await capture(empty,'real-muse-send-unconfirmed-390x844');assertBrowserContained(empty);
  const failed=await openConversationPage(browser,h,{clock:false});phones.push(failed);failed.rule(record=>record.path==='/shared/state',async()=>({abort:true}));await failed.page.goto(RELAY_URL);await failed.page.locator('#relay-sync-notice:not([hidden])').waitFor();await capture(failed,'real-public-error-390x844');
  const slow=await openConversationPage(browser,h,{owner,clock:false});phones.push(slow);const held=slow.hold(record=>record.path==='/relay/owner/messages');await slow.page.goto(RELAY_URL);await held.entered;await capture(slow,'real-owner-loading-390x844');held.release();await slow.page.locator('#relay-owner-message-text').waitFor();
  h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?',Date.now()-1,owner.device.id);
  await conversationMenu(slow.page,'Refresh private inbox');await slow.page.getByText('This phone’s owner session has expired.',{exact:true}).waitFor();assert.equal(await slow.page.locator('#message-text').count(),0);await capture(slow,'real-owner-expired-390x844');assertBrowserContained(slow);
  await writeFile(resolve(directory,'real-render-manifest.json'),JSON.stringify({synthetic:true,node:process.version,browser:'Google Chrome for Testing 154.0.8037.97',backend:'Real Worker routing and SQLite; original Azure Origin; offline CDP fixture; no live requests',capturedAt:new Date().toISOString(),evidence},null,2)+'\n');
});
