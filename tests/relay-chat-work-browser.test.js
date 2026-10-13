import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,conversationMenu,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,writeSyntheticEvidence,RELAY_URL} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';

test('natural chat shows authenticated plan and progress in place, groups explicit follow-ups and remains private on narrow screens',{timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
  try{
    const auth=await h.oauth(),owner=await h.pair(auth),rpc=(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args});
    const phone=await openConversationPage(browser,h,{owner,clock:false,width:320,height:740});pages.push(phone);const page=phone.page;
    await page.goto(RELAY_URL);const input=page.locator('#relay-owner-message-text');await input.waitFor();
    await input.fill('What is a fictional garden?');await page.getByRole('button',{name:'Send private message',exact:true}).click();
    await page.locator('.message-row.outgoing').waitFor();assert.equal(await page.locator('.message-job').count(),0,'Ordinary chat has no task controls');
    await input.fill('Prepare a draft plan for my fictional garden.');await page.getByRole('button',{name:'Send private message',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.message-row.outgoing').length===2);
    const request=h.rows("SELECT id FROM relay_owner_entries WHERE kind='user' ORDER BY seq DESC LIMIT 1")[0];
    await rpc('relay_owner_job_plan',{job_id:request.id,event_id:crypto.randomUUID(),expected_revision:0,title:'Fictional garden options',goal:'A quiet fictional path <img src=x onerror=alert(1)>',plan:['Inspect the fictional layout','Draft two options for review']});
    const run_id=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:request.id,run_id,event_id:crypto.randomUUID()});
    await rpc('relay_owner_job_update',{job_id:request.id,run_id,event_id:crypto.randomUUID(),stage:'running',summary:'Compared the two fictional layouts.'});
    await page.reload();const row=page.locator('[data-message-id="'+request.id+'"]');await row.getByText('Fictional garden options',{exact:true}).waitFor();assert.match(await row.innerText(),/Compared the two fictional layouts/);await writeSyntheticEvidence(phone,'chat-work-progress-320',{classified:true});
    await page.locator('#relay-owner-inspect-'+request.id).click();await page.locator('#relay-owner-latest-progress').waitFor();assert.match(await page.locator('#relay-owner-request-dialog').innerText(),/Compared the two fictional layouts/);assert.equal(await page.locator('#relay-owner-request-dialog img').count(),0);await writeSyntheticEvidence(phone,'chat-work-plan-320',{inertMarkup:true});await page.getByRole('button',{name:'Back from task',exact:true}).click();
    await input.fill('For the fictional garden, use the first option.');await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.message-row.outgoing').length===3);
    const follow=h.rows("SELECT id FROM relay_owner_entries WHERE kind='user' ORDER BY seq DESC LIMIT 1")[0];
    await rpc('relay_owner_job_link',{job_id:follow.id,work_id:request.id,event_id:crypto.randomUUID(),reason:'Explicit fictional garden reference.'});
    await page.reload();await page.locator('[data-message-id="'+follow.id+'"] button').filter({hasText:'View task'}).waitFor();
    await conversationMenu(page,'Requests');const work=page.locator('#relay-owner-current-work');assert.equal(await work.locator('button[data-job-id]').count(),1);
    await work.locator('button[data-job-id]').click();await page.getByRole('heading',{name:'Fictional garden options',exact:true}).waitFor();assert.equal(await page.locator('#relay-owner-request-properties').count(),0);
    for(const size of [{width:320,height:740},{width:390,height:844},{width:390,height:520}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Back from task',exact:true}).click();await conversationMenu(page,'Public chat');assert.equal((await page.locator('body').innerText()).includes('Fictional garden options'),false);
    assertBrowserContained(phone);await assertNoPrivatePersistence(page,['Fictional garden options','Compared the two fictional layouts']);
  }finally{await closeConversationHarness(browser,h,pages);}
});

test('latest retry Work card and inspector retain the assistant root title, goal and plan',{timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
  try{
    const auth=await h.oauth(),owner=await h.pair(auth),rpc=(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args});
    const saved=await h.phone('/messages',{id:crypto.randomUUID(),body:'Prepare fictional retry options.'},owner.device_token),root=(await saved.json()).entry;
    await rpc('relay_owner_job_plan',{job_id:root.id,event_id:crypto.randomUUID(),expected_revision:0,title:'Fictional garden retry',goal:'Choose a quiet fictional path',plan:['Compare fictional paths','Prepare the fictional draft']});
    let id=root.id;
    for(let i=0;i<2;i++){
      const run_id=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:id,run_id,event_id:crypto.randomUUID()});
      await rpc('relay_owner_job_update',{job_id:id,run_id,event_id:crypto.randomUUID(),stage:'failed',summary:'Fictional work not started.',outcome:'not_started'});
      const response=await h.phone('/jobs/retry',{job_id:id,id:crypto.randomUUID(),confirm_duplicate_risk:true},owner.device_token);assert.equal(response.status,201);id=(await response.json()).job.id;
    }
    const phone=await openConversationPage(browser,h,{owner,clock:false,width:320,height:740});pages.push(phone);const page=phone.page;
    await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();await conversationMenu(page,'Requests');
    const cards=page.locator('#relay-owner-current-work button[data-job-id]');assert.equal(await cards.count(),1);assert.equal(await cards.first().getAttribute('data-job-id'),id);assert.match(await cards.first().innerText(),/Fictional garden retry/);
    await cards.first().click();await page.locator('#relay-owner-detail-title').waitFor();assert.equal(await page.locator('#relay-owner-detail-title').innerText(),'Fictional garden retry');assert.equal(await page.locator('#relay-owner-request-properties').count(),0);assert.equal(await page.locator('.request-state').innerText(),'Queued');
    assertBrowserContained(phone);
  }finally{await closeConversationHarness(browser,h,pages);}
});
