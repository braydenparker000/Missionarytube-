import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,
  conversationMenu,assertNoPrivatePersistence,
  RELAY_URL,MUSE_URL,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {publicComment,publicReport} from './helpers/relay-core-request-result-harness.js';
import {COMMENTS_URL} from '../publications.js';
import {RELAY_INBOX,RELAY_OWNER_INBOX,RELAY_PUBLIC_SCOPES} from '../relay-common.js';
import {STORAGE_KEY} from '../../frontend/assets/shared-store.js';
import {MUSE_STORAGE_KEY} from '../../frontend/assets/muse-store.js';
import {MUSE_PREFIX} from '../../frontend/assets/channels.js';
import {SHARED_OBJECT} from '../shared.js';

const input=(page,channel)=>page.locator(channel==='muse'?'#prompt':'#message-text');
const key=channel=>channel==='muse'?MUSE_STORAGE_KEY:STORAGE_KEY;
const idle=(page,channel)=>page.waitForFunction(channel=>{
  const status=document.getElementById(channel==='muse'?'status':'relay-status');return status&&!/Opening|Refreshing|Sending/.test(status.textContent);
},channel);
const history=phone=>phone.records.filter(record=>record.method==='GET'&&['/shared/state','/shared/changes'].includes(record.path));
const saved=(page,channel)=>page.evaluate(key=>localStorage.getItem(key),key(channel));
async function hide(page){await page.evaluate(()=>{
  window.coreRequestResultHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.coreRequestResultHidden});
});}
async function show(page,channel){await page.evaluate(()=>{window.coreRequestResultHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await idle(page,channel);}

test('actual MCP hidden-final/artifact recovery reaches both mobile readers after429 visibility retry and reload with immutable hold, cursor and draft',{timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const h=createConversationFixture(t),phones=[],comments=new Map();
  assert.equal(h.fixture.env.RELAY_ACCOUNT_ADMISSION_MODE,undefined,'Default business protocol is distinct from paid native admission');
  t.after(()=>closeConversationHarness(browser,h,phones));
  const publicationFetcher=async(input,init={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    assert.equal(url.origin+url.pathname,COMMENTS_URL);assert.equal(init.method||'GET','GET');assert.equal(init.redirect,'manual');
    const page=Number(url.searchParams.get('page')||1);
    return Response.json([...comments.values()].sort((a,b)=>a.id-b.id).slice((page-1)*100,page*100));
  };
  h.fixture.object(SHARED_OBJECT).hub.publicationFetcher=publicationFetcher;
  t.mock.method(globalThis,'fetch',publicationFetcher);
  for(const [index,channel] of ['relay','muse'].entries())await t.test(channel,async()=>{
    const id=crypto.randomUUID(),auth=await h.oauth(RELAY_PUBLIC_SCOPES.join(' '));
    const created=await h.fixture.request('/shared/messages',{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json'},
      body:JSON.stringify({id,body:(channel==='muse'?MUSE_PREFIX:'')+'Fictional complete mobile result journey'})});
    assert.equal(created.status,201);
    const hold=await h.rpc(auth,'relay_reply',{inbox_id:RELAY_INBOX,message_id:id,body:'Fictional immutable '+channel+' hold'});
    const phone=await openConversationPage(browser,h);phones.push(phone);const {page}=phone;
    await page.goto(channel==='muse'?MUSE_URL:RELAY_URL);await input(page,channel).waitFor();await idle(page,channel);
    const held=page.locator(`[data-message-id="${hold.entry.id}"]`);await held.waitFor();await held.evaluate(row=>{window.coreRequestResultHold=row;});
    const draft='Fictional '+channel+' unsent separate draft';await input(page,channel).fill(draft);
    const checkpoint=await saved(page,channel);assert.ok(JSON.parse(checkpoint).publicReader);
    await hide(page);const background=history(phone).length;await page.clock.fastForward(70000);
    assert.equal(history(phone).length,background,'A hidden reader creates no background reads or requests');
    const late={schema:'jarvis-publication-v1',id:crypto.randomUUID(),type:'reply',replyTo:id,
      body:'Fictional hidden '+channel+' final https://example.test/mobile-hidden-final'};
    const final=publicReport(id,{body:'Fictional '+channel+' artifact final',
      artifacts:[{id:crypto.randomUUID(),revision:1,label:'Fictional '+channel+' source',url:'https://example.test/mobile-artifact-v1'}]});
    comments.set(9600+index*10,publicComment(late,9600+index*10));
    comments.set(9601+index*10,publicComment(final,9601+index*10));now+=300001;
    const result=await h.rpc(auth,'relay_read_public_result',{inbox_id:RELAY_INBOX,message_id:id});
    assert.equal(result.reply.id,hold.entry.id);assert.deepEqual(result.events.map(event=>event.eventId),[late.id,final.eventId]);
    assert.equal(result.execution_authorized,false);
    let failOnce=true;
    phone.rule(record=>record.path==='/shared/changes'&&record.method==='GET',async({forward})=>{
      if(failOnce){failOnce=false;return Response.json({error:'Fictional reader429'},{status:429,headers:{'Access-Control-Allow-Origin':SITE}});}
      return forward();
    });
    await show(page,channel);assert.equal(failOnce,false);assert.equal(await saved(page,channel),checkpoint);
    assert.equal(await input(page,channel).inputValue(),draft);
    await hide(page);await show(page,channel);
    const lateRow=page.locator(`[data-message-id="coordination:${late.id}"]`),finalRow=page.locator(`[data-message-id="coordination:${final.eventId}"]`);
    await lateRow.waitFor();await finalRow.waitFor();
    assert.equal(await held.evaluate(row=>row===window.coreRequestResultHold),true);
    assert.match(await finalRow.getAttribute('aria-label'),/no private execution authority/);
    assert.equal(await finalRow.getByRole('link').getAttribute('href'),final.artifacts[0].url);
    assert.equal(await finalRow.getByRole('link').getAttribute('rel'),'noopener noreferrer');
    assert.equal(await input(page,channel).inputValue(),draft);
    const complete=JSON.parse(await saved(page,channel)),cursor=complete.publicReader.cursor;
    assert.notEqual(cursor,JSON.parse(checkpoint).publicReader.cursor);
    const reloadAt=history(phone).length;await page.evaluate(()=>delete document.hidden);await page.reload();await idle(page,channel);
    await held.waitFor();await lateRow.waitFor();await finalRow.waitFor();
    assert.equal(await lateRow.count(),1);assert.equal(await finalRow.count(),1);assert.equal(await input(page,channel).inputValue(),draft);
    assert.equal(history(phone).slice(reloadAt).every(record=>record.path==='/shared/changes'),true);
    assert.equal(new URL(history(phone)[reloadAt].url).searchParams.get('cursor'),cursor);
    assert.equal(phone.records.some(record=>record.path.startsWith('/relay/owner/')),false);
    assert.equal(phone.records.some(record=>record.path==='/shared/messages'&&record.method==='POST'),false);
    assertBrowserContained(phone);
  });
});

test('actual private typed request recovers lost save once, retains edited draft and shows immutable completion plus correction after failed refresh and reload',{timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  assert.equal(h.fixture.env.RELAY_ACCOUNT_ADMISSION_MODE,undefined);
  const auth=await h.oauth(),owner=await h.pair(auth),phone=await openConversationPage(browser,h,{owner});phones.push(phone);
  const {page}=phone,ownerInput=page.locator('#relay-owner-message-text'),dialog=page.locator('#relay-owner-request-dialog');
  await page.goto(RELAY_URL);await ownerInput.waitFor();
  const request='PRIVATE-FICTIONAL-COMPLETE-REQUEST-4301',draft='PRIVATE-FICTIONAL-EDITED-UNSENT-4302';await ownerInput.fill(request);
  phone.rule(record=>record.path==='/relay/owner/messages'&&record.method==='POST',async({forward})=>{
    const response=await forward();assert.equal(response.status,201);return {abort:true};
  });
  await page.getByRole('button',{name:'Send private message',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.relay-owner-chat .composer [role="status"]')?.textContent.includes('Send unconfirmed'));
  assert.equal(await ownerInput.inputValue(),request);await ownerInput.fill(draft);
  const first=phone.records.find(record=>record.path==='/relay/owner/messages'&&record.method==='POST'),payload=JSON.parse(first.body);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='user'")[0].n,1);
  await page.getByRole('button',{name:'Retry private send',exact:true}).click();
  await page.waitForFunction(()=>!/(?:Saving privately|Refreshing private inbox)/.test(document.querySelector('.relay-owner-chat .composer [role="status"]')?.textContent||''));
  await h.rpc(auth,'relay_owner_job_plan',{inbox_id:RELAY_OWNER_INBOX,job_id:payload.id,event_id:crypto.randomUUID(),expected_revision:0,title:'Fictional complete private report',goal:'Prepare the requested report',plan:['Read the request','Prepare the report']});await conversationMenu(page,'Refresh private inbox');
  await page.locator(`[data-job-id="${payload.id}"] .job-state`).waitFor();
  await page.waitForFunction(()=>!/(?:Saving privately|Refreshing private inbox)/.test(document.querySelector('.relay-owner-chat .composer [role="status"]')?.textContent||''));
  const writes=phone.records.filter(record=>record.path==='/relay/owner/messages'&&record.method==='POST');
  assert.equal(writes.length,2);assert.deepEqual(JSON.parse(writes[1].body),payload);assert.equal(await ownerInput.inputValue(),draft);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='user'")[0].n,1);
  const runId=crypto.randomUUID(),claim={inbox_id:RELAY_OWNER_INBOX,job_id:payload.id,run_id:runId,event_id:crypto.randomUUID()};
  await h.rpc(auth,'relay_owner_job_claim',claim);
  const original='PRIVATE-FICTIONAL-IMMUTABLE-RESULT-4303',summary='Fictional authenticated completion; sources still need checking.';
  const reply=await h.rpc(auth,'relay_owner_reply',{inbox_id:RELAY_OWNER_INBOX,message_id:payload.id,body:original});
  const completion={...claim,event_id:crypto.randomUUID(),stage:'completed',outcome:'known',summary,expected_reply_id:reply.entry.id,expected_version:1};
  const completed=await h.rpc(auth,'relay_owner_job_update',completion);assert.equal(completed.newWrite,true);
  assert.equal((await h.rpc(auth,'relay_owner_job_update',completion)).newWrite,false);
  const corrected='PRIVATE-FICTIONAL-CORRECTED-RESULT-4304';
  const correction={inbox_id:RELAY_OWNER_INBOX,job_id:payload.id,event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,
    expected_version:1,body:corrected,correction_summary:'Fictional independent source recheck.'};
  await h.rpc(auth,'relay_owner_job_result_correct',correction);
  assert.equal((await h.rpc(auth,'relay_owner_job_result_correct',correction)).newWrite,false);
  phone.rule(record=>record.path==='/relay/owner/jobs/changes'&&record.method==='GET',async()=>Response.json({error:'Fictional private refresh429'},
    {status:429,headers:{'Access-Control-Allow-Origin':SITE}}));
  const failedRefresh=page.waitForResponse(response=>new URL(response.url()).pathname==='/relay/owner/jobs/changes'&&response.request().method()==='GET');
  await conversationMenu(page,'Refresh private inbox');const failed=await failedRefresh;assert.equal(failed.status(),429);
  await page.waitForFunction(()=>!document.querySelector('.relay-owner-chat .composer [role="status"]')?.textContent.includes('Refreshing'));
  assert.equal(await ownerInput.inputValue(),draft);
  const retryRefresh=page.waitForResponse(response=>new URL(response.url()).pathname==='/relay/owner/jobs/changes'&&response.request().method()==='GET');
  await conversationMenu(page,'Refresh private inbox');const retried=await retryRefresh;assert.equal(retried.status(),200);
  assert.equal(new URL(retried.url()).searchParams.get('after'),new URL(failed.url()).searchParams.get('after'));
  await page.locator('.relay-owner-chat .messages').getByText(original,{exact:true}).waitFor();
  await page.locator(`[data-job-id="${payload.id}"]`).getByRole('button',{name:'View task',exact:true}).click();
  await dialog.locator('#relay-owner-result-latest[data-result-version="2"]').waitFor();
  assert.equal(await dialog.locator('#relay-owner-result-latest').textContent(),corrected);
  assert.equal(await dialog.locator('#relay-owner-completion').getAttribute('data-result-version'),'1');
  assert.equal(await dialog.locator('#relay-owner-completion').textContent(),summary);
  assert.match(await dialog.innerText(),/latest correction has not been confirmed complete/);
  await dialog.getByRole('button',{name:'Back from task',exact:true}).click();
  await page.reload();await ownerInput.waitFor();await page.locator('.relay-owner-chat .messages').getByText(original,{exact:true}).waitFor();
  assert.equal(await ownerInput.inputValue(),draft);
  await page.locator(`[data-job-id="${payload.id}"]`).getByRole('button',{name:'View task',exact:true}).click();
  await dialog.locator('#relay-owner-result-latest[data-result-version="2"]').waitFor();
  assert.equal(await dialog.locator('#relay-owner-completion').getAttribute('data-result-version'),'1');
  assert.equal(await page.locator('.relay-owner-chat .messages').getByText(original,{exact:true}).count(),1);
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='reply' AND reply_to=?",payload.id)[0].n,1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_result_corrections WHERE job_id=?',payload.id)[0].n,1);
  assert.equal(phone.records.some(record=>record.method==='POST'&&['/shared/messages','/v1/messages'].includes(record.path)),false);
  await assertNoPrivatePersistence(page,[request,original,corrected,summary],{draft});assertBrowserContained(phone);
});
