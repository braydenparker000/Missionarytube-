import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,
  assertBrowserContained,RELAY_URL,MUSE_URL,SITE,writeSyntheticEvidence} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {STORAGE_KEY} from '../public/assets/shared-store.js';
import {MUSE_STORAGE_KEY} from '../public/assets/muse-store.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

const channels=['relay','muse'],stamp='2026-10-01T12:00:00.000Z';
const key=channel=>channel==='muse'?MUSE_STORAGE_KEY:STORAGE_KEY;
const input=(page,channel)=>page.locator(channel==='muse'?'#prompt':'#message-text');
const history=phone=>phone.records.filter(record=>['/shared/state','/shared/changes'].includes(record.path)&&record.method==='GET');
const saved=(page,channel)=>page.evaluate(key=>localStorage.getItem(key),key(channel));
const scoped=(channel,body)=>(channel==='muse'?MUSE_PREFIX:'')+body;
const publicJson=(body,status)=>Response.json(body,{status,headers:{'Access-Control-Allow-Origin':SITE}});
function original(h,channel){
  const message={id:crypto.randomUUID(),role:'user',body:scoped(channel,'Fictional retained protocol history'),createdAt:stamp};
  assert.equal(sharedStore(h.ctx,'/internal/shared/import',{messages:[message]}).status,200);return message;
}
function final(h,target){
  const payload={schema:'jarvis-coordination-v2',eventId:crypto.randomUUID(),requestId:target.id,attemptId:crypto.randomUUID(),
    stage:'final',body:'Fictional final arriving during a public protocol upgrade',resultVersion:1,
    artifacts:[{id:crypto.randomUUID(),revision:1,label:'Fictional recovered public artifact',url:'https://example.test/protocol-recovery'}]};
  assert.equal(sharedStore(h.ctx,'/internal/shared/coordination',{payload,provenance:{source:'github-issue',repository:'braydenparker999/jarvis',
    issue:2,authorId:183016859,commentId:1,publishedAt:stamp}}).status,201);return payload;
}
async function journey(t){
  const browser=await launchQualifiedBrowser(t);if(!browser)return null;
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  return {h,open:async()=>{const phone=await openConversationPage(browser,h,{...(process.env.RELAY_QA_PUBLIC_ROOT?{root:process.env.RELAY_QA_PUBLIC_ROOT}:{})});
    phones.push(phone);return phone;}};
}
async function idle(page,channel){await page.waitForFunction(channel=>{
  const status=document.getElementById(channel==='muse'?'status':'relay-status');return status&&!/Sending|Refreshing|Opening/.test(status.textContent);
},channel);}
async function ready(phone,channel){await phone.page.goto(channel==='muse'?MUSE_URL:RELAY_URL);await input(phone.page,channel).waitFor();await idle(phone.page,channel);}
async function hidden(page){await page.evaluate(()=>{
  window.fixtureRecoveryHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureRecoveryHidden});
});}
async function visible(phone,channel){
  await phone.page.evaluate(()=>{window.fixtureRecoveryHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await idle(phone.page,channel);
}
async function reload(phone,channel){
  // Restore Chrome's native visibility before navigation; the synthetic getter
  // must not turn its real departure event into a second visible refresh.
  await phone.page.evaluate(()=>delete document.hidden);await phone.page.reload();await idle(phone.page,channel);
}
function publicOnly(phone){
  assert.equal(phone.records.some(record=>record.path.startsWith('/relay/owner/')),false);
  assert.equal(phone.records.some(record=>record.path==='/shared/messages'&&record.method==='POST'),false);
  assertBrowserContained(phone);
}

test('real public and Muse pages recover a failed cold fallback on visibility and retain draft/history through reload',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;
  for(const channel of channels)await t.test(channel,async()=>{
    const target=original(j.h,channel),phone=await j.open(),{page}=phone;
    phone.rule(record=>record.path==='/shared/changes',()=>publicJson({error:'Fictional unsupported changes'},404));
    phone.rule(record=>record.path==='/shared/state',()=>publicJson({error:'Fictional failed legacy snapshot'},503));
    await ready(phone,channel);assert.deepEqual(history(phone).map(record=>record.path),['/shared/changes','/shared/state']);
    const draft='Fictional '+channel+' cold fallback draft';await input(page,channel).fill(draft);
    const before=await saved(page,channel);assert.equal(JSON.parse(before).publicReader,undefined);
    await hidden(page);const reads=history(phone).length;await page.clock.fastForward(70000);assert.equal(history(phone).length,reads);
    const report=final(j.h,target);await visible(phone,channel);
    const reportRow=page.locator(`[data-message-id="coordination:${report.eventId}"]`);await reportRow.waitFor();
    await page.locator(`[data-message-id="${target.id}"]`).waitFor();
    assert.equal(await reportRow.getByRole('link').getAttribute('href'),'https://example.test/protocol-recovery');
    assert.match(await reportRow.getAttribute('aria-label'),/no private execution authority/);
    assert.equal(history(phone)[reads].path,'/shared/changes');
    assert.equal(history(phone).slice(reads).every(record=>record.path==='/shared/changes'),true);
    assert.equal(await input(page,channel).inputValue(),draft);
    const complete=JSON.parse(await saved(page,channel));assert.ok(complete.publicReader);assert.equal(complete.composer,draft);
    const cursor=complete.publicReader.cursor,reloading=history(phone).length;
    await reload(phone,channel);await reportRow.waitFor();await page.locator(`[data-message-id="${target.id}"]`).waitFor();
    assert.equal(history(phone).length,reloading+1);assert.equal(history(phone).at(-1).path,'/shared/changes');
    assert.equal(new URL(history(phone).at(-1).url).searchParams.get('cursor'),cursor);assert.equal(await input(page,channel).inputValue(),draft);
    publicOnly(phone);await writeSyntheticEvidence(phone,'reader-cold-fallback-recovery-'+channel,{scope:'Synthetic transient fallback visibility/reload recovery',
      completedCursor:cursor,draftPreserved:true,newExecutionRequests:0});
  });
});

test('open legacy pages recover a live upgrade after one failed probe without losing drafts or completed checkpoints',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;
  for(const channel of channels)await t.test(channel,async()=>{
    const target=original(j.h,channel),phone=await j.open(),{page}=phone;
    phone.rule(record=>record.path==='/shared/changes',()=>publicJson({error:'Fictional old changes route'},404));
    phone.rule(record=>record.path==='/shared/state',async({forward})=>{const response=await forward();return Response.json({...await response.json(),coordinationVersion:1},{headers:response.headers});});
    await ready(phone,channel);await page.locator(`[data-message-id="${target.id}"]`).waitFor();
    assert.deepEqual(history(phone).map(record=>record.path),['/shared/changes','/shared/state']);
    assert.equal(JSON.parse(await saved(page,channel)).publicReader,undefined);
    const draft='Fictional '+channel+' live upgrade draft';await input(page,channel).fill(draft);
    const before=await saved(page,channel);await hidden(page);const reads=history(phone).length;
    await page.clock.fastForward(70000);assert.equal(history(phone).length,reads);
    const report=final(j.h,target);
    phone.rule(record=>record.path==='/shared/changes',()=>publicJson({error:'Fictional upgrade rate limit'},429));
    await visible(phone,channel);
    assert.deepEqual(history(phone).slice(reads).map(record=>record.path),['/shared/state','/shared/changes']);
    assert.equal(await saved(page,channel),before);assert.equal(await input(page,channel).inputValue(),draft);
    await page.locator(`[data-message-id="${target.id}"]`).waitFor();
    const retry=history(phone).length;await hidden(page);await visible(phone,channel);
    const reportRow=page.locator(`[data-message-id="coordination:${report.eventId}"]`);await reportRow.waitFor();
    assert.equal(history(phone).slice(retry).every(record=>record.path==='/shared/changes'),true);
    assert.equal(history(phone)[retry].path,'/shared/changes');assert.equal(await input(page,channel).inputValue(),draft);
    const completed=await saved(page,channel),cursor=JSON.parse(completed).publicReader.cursor;
    const failures=history(phone).length;
    phone.rule(record=>record.path==='/shared/changes',()=>publicJson({error:'Fictional committed v2 outage'},404));
    await page.evaluate(()=>dispatchEvent(new Event('online')));await idle(page,channel);
    assert.deepEqual(history(phone).slice(failures).map(record=>record.path),['/shared/changes']);
    assert.equal(new URL(history(phone).at(-1).url).searchParams.get('cursor'),cursor);
    assert.equal(await saved(page,channel),completed);assert.equal(await input(page,channel).inputValue(),draft);
    const reloading=history(phone).length;await reload(phone,channel);await reportRow.waitFor();
    assert.equal(history(phone).length,reloading+1);assert.equal(history(phone).at(-1).path,'/shared/changes');
    assert.equal(new URL(history(phone).at(-1).url).searchParams.get('cursor'),cursor);assert.equal(await input(page,channel).inputValue(),draft);
    assert.match(await reportRow.getAttribute('aria-label'),/no private execution authority/);publicOnly(phone);
    await writeSyntheticEvidence(phone,'reader-live-upgrade-recovery-'+channel,{scope:'Synthetic legacy-to-v2 visibility/reload recovery',
      completedCursor:cursor,failedUpgradeProbes:1,draftAndCheckpointPreserved:true,newExecutionRequests:0});
  });
});
