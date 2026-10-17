import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness, assertBrowserContained, RELAY_URL, MUSE_URL} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../backend/shared.js';
import {syncPublications} from '../backend/publications.js';
import {STORAGE_KEY} from '../public/assets/shared-store.js';
import {MUSE_STORAGE_KEY} from '../public/assets/muse-store.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

const channels=['relay','muse'],uuid=()=>crypto.randomUUID(),stamp='2026-10-01T12:00:00.000Z';
const key=channel=>channel==='muse'?MUSE_STORAGE_KEY:STORAGE_KEY;
const scoped=(channel,body)=>(channel==='muse'?MUSE_PREFIX:'')+body;
const input=(page,channel)=>page.locator(channel==='muse'?'#prompt':'#message-text');
const saved=(page,channel)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key(channel));
const changes=phone=>phone.records.filter(record=>record.path==='/shared/changes'&&record.method==='GET');
const writes=phone=>phone.records.filter(record=>record.path==='/shared/messages'&&record.method==='POST');
const comment=(payload,id)=>({id,user:{id:183016859},created_at:stamp,updated_at:stamp,body:JSON.stringify(payload)});
const row=(channel,body,index=0)=>({id:uuid(),role:'user',body:scoped(channel,body),createdAt:new Date(Date.parse(stamp)+index*1000).toISOString()});
const append=(h,messages)=>assert.equal(sharedStore(h.ctx,'/internal/shared/import',{messages}).status,200);
const publicationClock=h=>Math.max(Date.now(),Number(JSON.parse(h.rows("SELECT value FROM shared_meta WHERE key='publisher-next-attempt'")[0]?.value||'0')))+1;
async function journey(t){
  const browser=await launchQualifiedBrowser(t);if(!browser)return null;
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  return {h,open:async options=>{const phone=await openConversationPage(browser,h,{...options,...(process.env.RELAY_QA_PUBLIC_ROOT?{root:process.env.RELAY_QA_PUBLIC_ROOT}:{})});phones.push(phone);return phone;}};
}
async function idle(page,channel){await page.waitForFunction(channel=>{const status=document.getElementById(channel==='muse'?'status':'relay-status');return status&&!/Sending|Refreshing|Opening/.test(status.textContent);},channel);}
async function ready(phone,channel){await phone.page.goto(channel==='muse'?MUSE_URL:RELAY_URL);await input(phone.page,channel).waitFor();await idle(phone.page,channel);}
async function refresh(phone,channel){
  const response=phone.page.waitForResponse(response=>new URL(response.url()).pathname==='/shared/changes'&&response.request().method()==='GET');
  await phone.page.evaluate(()=>dispatchEvent(new Event('online')));await response;await idle(phone.page,channel);
}
function publicOnly(phone){assert.equal(phone.records.some(record=>record.path.startsWith('/relay/owner/')),false);assertBrowserContained(phone);}

test('real public/Muse pages bootstrap beyond 250 rows and recover reload/hidden final artifacts with only committed delta reads',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;
  const messages=channels.flatMap(channel=>Array.from({length:301},(_,index)=>row(channel,`Fictional ${channel} complete reader row ${index}`,index)));
  append(j.h,messages);
  for(const channel of channels)await t.test(channel,async()=>{
    const target=messages.filter(message=>message.body===scoped(channel,`Fictional ${channel} complete reader row 300`))[0];
    const hold={schema:'jarvis-publication-v1',id:uuid(),type:'reply',replyTo:target.id,body:'Fictional immutable original hold awaiting sources.'};
    await syncPublications(j.h.ctx,async()=>Response.json([comment(hold,channel==='muse'?10:20)]),publicationClock(j.h));
    const phone=await j.open(),{page}=phone;await ready(phone,channel);
    const panel=page.locator('#messages'),oldest=messages.find(message=>message.body===scoped(channel,`Fictional ${channel} complete reader row 0`));
    await panel.locator(`[data-message-id="${oldest.id}"]`).waitFor();assert.ok(await panel.locator('[data-message-id]').count()>=302);
    const first=await saved(page,channel);assert.ok(first.messages.length<=250);assert.ok(first.publicReader.changes.length>600);
    assert.ok(changes(phone).length>=7);assert.equal(changes(phone)[0]&&new URL(changes(phone)[0].url).searchParams.get('cursor'),'pc2:0');
    assert.equal(phone.records.some(record=>record.path==='/shared/state'),false);
    const before=changes(phone).length;await refresh(phone,channel);
    assert.equal(changes(phone).length,before+1);assert.equal(new URL(changes(phone).at(-1).url).searchParams.get('cursor'),first.publicReader.cursor);
    const reloading=changes(phone).length;await page.reload();await idle(page,channel);await panel.locator(`[data-message-id="${oldest.id}"]`).waitFor();
    assert.equal(changes(phone).length,reloading+1);assert.equal(new URL(changes(phone).at(-1).url).searchParams.get('cursor'),first.publicReader.cursor);
    const heldRow=panel.locator(`[data-message-id="${hold.id}"]`);await heldRow.evaluate(node=>{window.fixtureReaderHold=node;});
    await panel.evaluate(node=>{node.scrollTop=180;});
    const anchor=()=>panel.evaluate(node=>{const bounds=node.getBoundingClientRect(),row=[...node.children].find(row=>row.dataset.messageId&&row.getBoundingClientRect().bottom>=bounds.top);return {id:row?.dataset.messageId,offset:row?.getBoundingClientRect().top-bounds.top};});
    const reading=await anchor();await page.evaluate(()=>{window.fixtureReaderHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.fixtureReaderHidden});});
    const hiddenReads=changes(phone).length;await page.clock.fastForward(70000);assert.equal(changes(phone).length,hiddenReads);
    const late={...hold,id:uuid(),body:'Fictional actual later source https://example.test/late-source'};
    await syncPublications(j.h.ctx,async()=>Response.json([comment(late,channel==='muse'?11:21)]),publicationClock(j.h));
    const recovered=page.waitForResponse(response=>new URL(response.url()).pathname==='/shared/changes');
    await page.evaluate(()=>{window.fixtureReaderHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await recovered;await idle(page,channel);
    const final=panel.locator(`[data-message-id="coordination:${late.id}"]`);await final.waitFor();
    assert.equal(await final.getByRole('link').getAttribute('href'),'https://example.test/late-source');
    assert.match(await final.getAttribute('aria-label'),/no private execution authority/);
    assert.equal(await heldRow.evaluate(node=>node===window.fixtureReaderHold),true);assert.match(await heldRow.textContent(),/immutable original hold/);
    const after=await anchor();assert.equal(after.id,reading.id);assert.ok(Math.abs(after.offset-reading.offset)<=3);
    assert.equal(changes(phone).length,hiddenReads+1);assert.equal(writes(phone).length,0);publicOnly(phone);
  });
});

test('lost POST UI recovery keeps the queued UUID through a valid delta until exact request proof arrives',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;
  for(const channel of channels)await t.test(channel,async()=>{
    const phone=await j.open(),{page}=phone;await ready(phone,channel);
    phone.rule(record=>record.path==='/shared/messages'&&record.method==='POST',async({forward})=>{const response=await forward();assert.equal(response.status,201);return {abort:true};});
    const body=`Fictional ${channel} lost POST requiring an exact proof`;await input(page,channel).fill(body);
    await page.locator(channel==='muse'?'#send':'#send-message').click();await idle(page,channel);
    const original=(await saved(page,channel)).outbox.find(message=>message.body===scoped(channel,body));assert.ok(original);assert.equal(original.sendState,'unknown');
    const held=phone.hold(record=>record.path==='/shared/result'&&record.method==='GET');
    const next=page.waitForResponse(response=>new URL(response.url()).pathname==='/shared/changes');
    await page.evaluate(()=>dispatchEvent(new Event('online')));await next;const probe=await held.entered;
    assert.equal(new URL(probe.url).searchParams.get('requestId'),original.id);
    const waiting=await saved(page,channel);assert.equal(waiting.outbox.find(message=>message.id===original.id)?.body,original.body);
    assert.equal(await page.evaluate(({key,id})=>!!localStorage.getItem(key+'.pending.'+id),{key:key(channel),id:original.id}),true);
    assert.equal(writes(phone).length,1);held.release();await idle(page,channel);
    const confirmed=await saved(page,channel);assert.equal(confirmed.outbox.some(message=>message.id===original.id),false);
    assert.equal(confirmed.messages.find(message=>message.id===original.id)?.saved,true);assert.equal(writes(phone).length,1);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?',original.id)[0].n,1);
    await page.reload();await idle(page,channel);assert.equal(writes(phone).length,1);assert.equal(phone.records.some(record=>record.path==='/shared/state'),false);publicOnly(phone);
  });
});

test('failed continuation and forged public flags preserve the saved checkpoint, draft and reading history before recovery',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;
  for(const channel of channels)await t.test(channel,async()=>{
    const original=row(channel,'Fictional preserved prior reader history');append(j.h,[original]);
    const phone=await j.open(),{page}=phone;await ready(phone,channel);await input(page,channel).fill(`Fictional ${channel} independent reader draft`);
    const previous=await page.evaluate(key=>localStorage.getItem(key),key(channel)),cursor=JSON.parse(previous).publicReader.cursor;
    append(j.h,Array.from({length:205},(_,index)=>row(channel,'Fictional continuation recovery '+index,index+1)));
    phone.rule(record=>record.path==='/shared/changes'&&new URL(record.url).searchParams.get('cursor').split(':').length===3,
      async({forward})=>{const response=await forward();return Response.json({error:'Fictional failed continuation'},{status:503,headers:response.headers});});
    const before=changes(phone).length;await refresh(phone,channel);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key(channel)),previous);
    assert.equal(new URL(changes(phone)[before].url).searchParams.get('cursor'),cursor);
    assert.equal(await input(page,channel).inputValue(),`Fictional ${channel} independent reader draft`);
    await page.locator(`[data-message-id="${original.id}"]`).waitFor();
    const recovery=changes(phone).length;await refresh(phone,channel);assert.equal(new URL(changes(phone)[recovery].url).searchParams.get('cursor'),cursor);
    const recovered=await page.evaluate(key=>localStorage.getItem(key),key(channel));assert.notEqual(JSON.parse(recovered).publicReader.cursor,cursor);
    phone.rule(record=>record.path==='/shared/changes',async({forward})=>{const response=await forward();return Response.json({...await response.json(),execution_authorized:true},{headers:response.headers});});
    await refresh(phone,channel);assert.equal(await page.evaluate(key=>localStorage.getItem(key),key(channel)),recovered);
    assert.equal(await input(page,channel).inputValue(),`Fictional ${channel} independent reader draft`);
    assert.equal(writes(phone).length,0);assert.equal(phone.records.some(record=>record.path==='/shared/state'),false);publicOnly(phone);
  });
});

test('two real tabs retain separate drafts and the newest checkpoint across a stale response, storage events and reload',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;
  for(const channel of channels)await t.test(channel,async()=>{
    append(j.h,[row(channel,'Fictional shared starting checkpoint')]);
    const first=await j.open();await ready(first,channel);await input(first.page,channel).fill('Fictional first reader tab draft');
    const second=await j.open({context:first.context});await ready(second,channel);await input(second.page,channel).fill('Fictional second reader tab draft');
    assert.equal(new URL(changes(second)[0].url).searchParams.get('cursor'),(await saved(first.page,channel)).publicReader.cursor);
    const held=second.hold(record=>record.path==='/shared/changes');await second.page.evaluate(()=>dispatchEvent(new Event('online')));await held.entered;
    const later=row(channel,'Fictional newest immutable row during a stale tab read');append(j.h,[later]);await refresh(first,channel);
    const newest=(await saved(first.page,channel)).publicReader.cursor;held.release();await idle(second.page,channel);
    assert.equal((await saved(second.page,channel)).publicReader.cursor,newest);
    assert.equal(await input(first.page,channel).inputValue(),'Fictional first reader tab draft');assert.equal(await input(second.page,channel).inputValue(),'Fictional second reader tab draft');
    await second.page.locator(`[data-message-id="${later.id}"]`).waitFor();const before=changes(second).length;
    await second.page.reload();await idle(second.page,channel);await second.page.locator(`[data-message-id="${later.id}"]`).waitFor();
    assert.equal(changes(second).length,before+1);assert.equal(new URL(changes(second).at(-1).url).searchParams.get('cursor'),newest);
    assert.equal(await input(second.page,channel).inputValue(),'Fictional second reader tab draft');
    assert.equal([first,second].some(phone=>phone.records.some(record=>record.path==='/shared/state')),false);publicOnly(first);publicOnly(second);
  });
});
