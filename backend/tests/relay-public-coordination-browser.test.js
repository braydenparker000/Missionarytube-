import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,
  writeSyntheticEvidence,MUSE_URL,RELAY_URL} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../shared.js';
import {syncPublications} from '../publications.js';
import {MUSE_PREFIX} from '../../frontend/assets/channels.js';

const uuid=()=>crypto.randomUUID(),stamp='2026-10-01T12:00:00Z';
const comment=(payload,id)=>({id,user:{id:183016859},created_at:stamp,updated_at:stamp,body:JSON.stringify(payload)});
const report=(requestId,overrides={})=>({schema:'jarvis-coordination-v2',eventId:uuid(),requestId,attemptId:uuid(),stage:'final',
  body:'Fictional final artifact is ready.',artifacts:[{id:uuid(),revision:1,label:'Fictional source artifact',url:'https://example.test/source-a'}],resultVersion:1,...overrides});
const idle=(page,channel)=>page.waitForFunction(channel=>{const status=document.getElementById(channel==='muse'?'status':'relay-status');return status&&!/Opening|Refreshing|Sending/.test(status.textContent);},channel);
async function refresh(page,channel){await page.evaluate(()=>dispatchEvent(new Event('online')));await idle(page,channel);}
async function journey(t){
  const browser=await launchQualifiedBrowser(t);if(!browser)return null;
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  const open=async()=>{const phone=await openConversationPage(browser,h);phones.push(phone);return phone;};
  return {h,open};
}

test('mobile conversation keeps the hold and displays later final artifacts, corrections and accessible revisions through refresh/reload', {timeout:120000}, async t=>{
  const j=await journey(t);if(!j)return;
  const publicationClock=()=>Math.max(Date.now(),Number(JSON.parse(j.h.rows("SELECT value FROM shared_meta WHERE key='publisher-next-attempt'")[0]?.value||'0')))+1;
  for(const channel of ['muse','relay'])await t.test(channel,async()=>{
    const id=uuid(),holdId=uuid(),body=(channel==='muse'?MUSE_PREFIX:'')+'Fictional source artifact request';
    sharedStore(j.h.ctx,'/internal/shared/message',{id,body});
    sharedStore(j.h.ctx,'/internal/shared/reply',{id:holdId,replyTo:id,body:'Fictional hold: waiting for the source artifact.'});
    const phone=await j.open(),{page}=phone;await page.goto(channel==='muse'?MUSE_URL:RELAY_URL);await idle(page,channel);
    const heldRow=page.locator(`[data-message-id="${holdId}"]`);await heldRow.waitFor();
    // Retain the actual DOM row so acceptance cannot be satisfied by rebuilding
    // or replacing the accepted immutable reply during a later refresh.
    await heldRow.evaluate(row=>{window.fixtureHoldRow=row;});
    const final=report(id),started=performance.now();
    await syncPublications(j.h.ctx,async()=>Response.json([comment(final,channel==='muse'?10:20)]),publicationClock());
    const importedMs=performance.now()-started;
    await refresh(page,channel);
    const finalRow=page.locator(`[data-message-id="coordination:${final.eventId}"]`);await finalRow.waitFor();
    const renderedMs=performance.now()-started;
    assert.match(await heldRow.textContent(),/Fictional hold/);
    assert.equal(await heldRow.evaluate(row=>row===window.fixtureHoldRow),true);
    assert.match(await finalRow.getAttribute('aria-label'),/Public final report.*version 1.*no private execution authority/);
    assert.equal(await finalRow.getByText('Public report · private execution unverified.',{exact:true}).isVisible(),true);
    assert.ok((await finalRow.locator(':scope > .bubble > .message-footer > .message-time').textContent()).trim(),'The report retains its separate timestamp');
    const link=finalRow.getByRole('link',{name:'Fictional source artifact · revision 1',exact:true});
    assert.equal(await link.getAttribute('href'),final.artifacts[0].url);assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
    assert.equal(await finalRow.locator('.message-row').count(),0,'The update uses the existing article/bubble structure');
    const correction={...final,eventId:uuid(),stage:'correction',resultVersion:2,supersedesEventId:final.eventId,
      body:'Fictional corrected artifact link.',artifacts:[{...final.artifacts[0],revision:2,url:'https://example.test/source-b'}]};
    await syncPublications(j.h.ctx,async()=>Response.json([comment(correction,channel==='muse'?11:21)]),publicationClock());
    await refresh(page,channel);const revised=page.locator(`[data-message-id="coordination:${correction.eventId}"]`);await revised.waitFor();
    assert.equal(await revised.getByRole('link',{name:'Fictional source artifact · revision 2',exact:true}).getAttribute('href'),correction.artifacts[0].url);
    assert.match(await revised.getAttribute('aria-label'),/Public correction.*version 2/);
    await page.reload();await idle(page,channel);await revised.waitFor();await heldRow.waitFor();await finalRow.waitFor();
    assert.equal(await revised.count(),1);assert.equal(await finalRow.count(),1);
    assert.equal(await revised.getByText('Public report · private execution unverified.',{exact:true}).isVisible(),true);
    assert.equal(await finalRow.getByText('Public report · private execution unverified.',{exact:true}).isVisible(),true);
    assert.equal(j.h.rows('SELECT body FROM shared_entries WHERE id=?',holdId)[0].body,'Fictional hold: waiting for the source artifact.');
    assert.equal(phone.records.some(record=>record.path.startsWith('/relay/owner/')),false);
    assertBrowserContained(phone);
    await writeSyntheticEvidence(phone,`communication-v2-${channel}-final-correction-390x844`,{scope:'Synthetic local Worker/SQLite/browser; not production latency',importedMs,renderedMs,
      acceptedReplyUnchanged:true,revision1Visible:true,revision2Visible:true,reloadDeduplicated:true});
  });
});

test('Muse visibility recovery imports hidden final artifacts without sending a new execution request and keeps the reading anchor', {timeout:120000}, async t=>{
  const j=await journey(t);if(!j)return;
  const messages=Array.from({length:40},(_,index)=>({id:uuid(),role:'user',body:MUSE_PREFIX+'Fictional history row '+index+' with a preserved reading position.',createdAt:new Date(Date.now()-600000+index*1000).toISOString()}));
  sharedStore(j.h.ctx,'/internal/shared/import',{messages});const target=messages.at(-1);
  const hold={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:target.id,body:'Fictional original hold remains immutable.'};
  await syncPublications(j.h.ctx,async()=>Response.json([comment(hold,50)]));
  const phone=await j.open(),{page}=phone;await page.goto(MUSE_URL);await idle(page,'muse');
  await page.locator('#messages').evaluate(panel=>{panel.scrollTop=180;});
  const anchor=()=>page.locator('#messages').evaluate(panel=>{const bounds=panel.getBoundingClientRect(),row=[...panel.children].find(row=>row.dataset.messageId&&row.getBoundingClientRect().bottom>=bounds.top);return {id:row.dataset.messageId,offset:row.getBoundingClientRect().top-bounds.top};});
  const before=await anchor();
  await page.evaluate(()=>{window.fixtureHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureHidden});});
  const requests=phone.records.length;
  await page.clock.fastForward(30000);assert.equal(phone.records.length,requests,'Background visibility does not start polling or writes');
  const late={...hold,id:uuid(),body:'Fictional late source links: https://example.test/final-one and https://example.test/final-two'};
  const started=performance.now();await syncPublications(j.h.ctx,async()=>Response.json([comment(late,51)]),Date.now()+300001);
  await page.evaluate(()=>{window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await idle(page,'muse');
  const row=page.locator(`[data-message-id="coordination:${late.id}"]`);await row.waitFor();const recoveryRenderMs=performance.now()-started;
  assert.equal(await row.getByRole('link').count(),2);const after=await anchor();assert.equal(after.id,before.id);assert.ok(Math.abs(after.offset-before.offset)<=3);
  await page.getByRole('button',{name:'New messages',exact:true}).click();
  assert.equal(await page.locator(`[data-message-id="${hold.id}"]`).count(),1);
  assert.equal(phone.records.filter(record=>record.path==='/shared/messages'&&record.method==='POST').length,0);
  assert.equal(phone.records.some(record=>record.path.startsWith('/relay/owner/')),false);assertBrowserContained(phone);
  await writeSyntheticEvidence(phone,'communication-v2-muse-visibility-recovery-390x844',{scope:'Synthetic visibility/reload recovery; not a live Muse hook trial',recoveryRenderMs,anchorPreserved:true,newExecutionRequests:0});
});
