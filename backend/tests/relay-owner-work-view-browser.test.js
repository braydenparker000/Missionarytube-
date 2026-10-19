import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,conversationMenu,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,writeSyntheticEvidence,RELAY_URL,OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../relay-common.js';

test('private work filters use loaded records and explicit detail preserves truthful progress and corrected results', {timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
  try{
    const auth=await h.oauth(),owner=await h.pair(auth),rpc=(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args});
    async function create(title,labels=true){const response=await h.phone('/jobs',{id:crypto.randomUUID(),title,body:'Fictional private task: '+title,action_kind:'read_only',...(labels?{project_title:'Fictional garden',goal_title:'Plan a quiet path'}:{})},owner.device_token);assert.equal(response.status,201);return (await response.json()).job;}
    const queued=await create('Compare path materials'),working=await create('Check the two source notes'),blocked=await create('Confirm the path width'),done=await create('Draft the planting list'),unverified=await create('An old acknowledgement',false);
    const workingRun=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:working.id,run_id:workingRun,event_id:crypto.randomUUID()});await rpc('relay_owner_job_update',{job_id:working.id,run_id:workingRun,event_id:crypto.randomUUID(),stage:'running',summary:'Read both fictional notes; checking the measurements.'});
    const blockedRun=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:blocked.id,run_id:blockedRun,event_id:crypto.randomUUID()});await rpc('relay_owner_job_update',{job_id:blocked.id,run_id:blockedRun,event_id:crypto.randomUUID(),stage:'waiting_for_owner',summary:'Which fictional width should the path use?',outcome:'not_started'});
    const doneRun=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:done.id,run_id:doneRun,event_id:crypto.randomUUID()});const reply=await rpc('relay_owner_reply',{message_id:done.id,body:'Fictional original list: three shrubs.'});await rpc('relay_owner_job_update',{job_id:done.id,run_id:doneRun,event_id:crypto.randomUUID(),stage:'completed',summary:'Checked and prepared the fictional planting list.',outcome:'known',expected_reply_id:reply.entry.id,expected_version:1});await rpc('relay_owner_job_result_correct',{job_id:done.id,event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,expected_version:1,body:'Fictional corrected list: four shrubs. https://example.test/fictional-source',correction_summary:'Checked the fictional second note; corrected the count.'});
    await rpc('relay_owner_reply',{message_id:unverified.id,body:'Fictional acknowledgement: I received this.'});
    const phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;
    await page.goto(RELAY_URL);await page.locator('[data-job-id="'+working.id+'"]').waitFor();
    const before=phone.records.filter(r=>r.method==='GET'&&r.path.startsWith('/relay/owner/')).length,beforeAll=phone.records.filter(r=>r.path.startsWith('/relay/owner/')).length;
    const detailReads=()=>phone.records.filter(r=>r.method==='GET'&&r.path.endsWith('/jobs/detail'));
    await conversationMenu(page,'Requests');const work=page.locator('#relay-owner-current-work');await work.waitFor();
    assert.equal(await work.locator('[data-job-id="'+queued.id+'"]').getAttribute('data-state'),'queued');
    assert.equal(await work.locator('[data-job-id="'+working.id+'"]').getAttribute('data-state'),'working');
    assert.equal(await work.locator('[data-job-id="'+blocked.id+'"]').getAttribute('data-attention'),'waiting_for_owner');
    assert.equal(await work.locator('[data-job-id="'+unverified.id+'"]').getAttribute('data-attention'),'completion_unverified');
    const rows=work.locator('button[data-job-id]');assert.equal(await rows.count(),5);assert.equal(await work.getByRole('heading',{name:'In progress',exact:true}).count(),1);assert.equal(await work.getByRole('heading',{name:'History',exact:true}).count(),1);assert.equal(await work.locator('select,form').count(),0);await conversationMenu(page,'Search tasks');const search=page.getByRole('searchbox',{name:'Search tasks'});await search.fill('measurements');assert.equal(await rows.count(),1);await search.fill('');assert.equal(await rows.count(),5);assert.equal(detailReads().length,0);
    for(const size of [{width:360,height:800},{width:390,height:844},{width:390,height:520}]){
      await page.setViewportSize(size);const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(geometry.width<=geometry.viewport,JSON.stringify({size,geometry}));const targets=await work.locator('button:visible,select:visible').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width})));assert.ok(targets.every(n=>n.height>=48&&n.width>=48),JSON.stringify({size,targets}));await writeSyntheticEvidence(phone,'private-current-work-'+size.width+'x'+size.height,{synthetic:true,localRequests:0,geometry});
    }
    const current=work.locator('[data-job-id="'+working.id+'"]');await current.click();await page.waitForFunction(()=>{const b=document.querySelector('#relay-owner-request-refresh');return b&&!b.disabled;});await page.locator('#relay-owner-latest-progress').waitFor();assert.match(await page.locator('#relay-owner-latest-progress').innerText(),/Read both fictional notes/);assert.equal(detailReads().length,1);
    await page.getByRole('button',{name:'Back from task',exact:true}).click();await page.locator('#relay-owner-request-dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.activeElement.dataset.jobId),working.id,'Back restores the selected task');
    await work.locator('[data-job-id="'+blocked.id+'"]').click();await page.getByRole('button',{name:'View conversation',exact:true}).waitFor();assert.match(await page.locator('#relay-owner-latest-progress').innerText(),/Which fictional width/);await page.getByRole('button',{name:'Back from task',exact:true}).click();
    await work.locator('[data-job-id="'+done.id+'"]').click();await page.waitForFunction(()=>{const b=document.querySelector('#relay-owner-request-refresh');return b&&!b.disabled;});const detail=page.locator('#relay-owner-request-dialog');await detail.locator('#relay-owner-result-latest').waitFor();assert.equal(await detail.locator('#relay-owner-result-latest').getAttribute('data-result-version'),'2');assert.match(await detail.locator('#relay-owner-result-latest').innerText(),/four shrubs/);assert.equal(await detail.locator('#relay-owner-completion').getAttribute('data-result-version'),'1');
    assert.match(await detail.innerText(),/latest correction has not been confirmed complete/);await page.getByRole('button',{name:'Back from task',exact:true}).click();
    await page.reload();await page.locator('[data-job-id="'+done.id+'"]').waitFor();await conversationMenu(page,'Tasks');await page.locator('#relay-owner-current-work [data-job-id="'+done.id+'"]').click();await page.locator('#relay-owner-result-latest').waitFor();assert.match(await page.locator('#relay-owner-result-latest').innerText(),/four shrubs/);await page.getByRole('button',{name:'Back from task',exact:true}).click();
    await conversationMenu(page,'Public chat');assert.equal(await page.locator('#relay-owner-current-work:visible').count(),0);assert.equal((await page.locator('body').innerText()).includes('Fictional garden'),false);
    assertBrowserContained(phone);await assertNoPrivatePersistence(page,['Fictional garden','Fictional private task','four shrubs']);
  }finally{await closeConversationHarness(browser,h,pages);}
});


test('phone work rows wrap and preserve focused reading through heartbeat and new saved activity', {timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
  try{
    const auth=await h.oauth(),owner=await h.pair(auth),rpc=(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args}),jobs=[];
    const long='FictionalLongProjectLabel'.repeat(5).slice(0,120);
    for(let i=0;i<12;i++){const response=await h.phone('/jobs',{id:crypto.randomUUID(),title:(i===0?'FictionalLongTaskTitle'.repeat(6).slice(0,120):'Fictional task '+i),body:'Fictional private reading fixture.',action_kind:'read_only',project_title:long,goal_title:long},owner.device_token);assert.equal(response.status,201);jobs.push((await response.json()).job);}
    const target=jobs[4],run=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:target.id,run_id:run,event_id:crypto.randomUUID()});await rpc('relay_owner_job_update',{job_id:target.id,run_id:run,event_id:crypto.randomUUID(),stage:'running',summary:'Compared both fictional notes; one measurement still needs checking.'});
    const phone=await openConversationPage(browser,h,{owner,width:360,height:800});pages.push(phone);const page=phone.page;
    await page.goto(RELAY_URL);await page.locator('[data-job-id="'+target.id+'"]').waitFor();await conversationMenu(page,'Requests');const work=page.locator('#relay-owner-current-work'),current=work.locator('[data-job-id="'+target.id+'"]');
    const row=work.locator('[data-job-id="'+jobs[0].id+'"]');await row.scrollIntoViewIfNeeded();const geometry=await row.evaluate(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,scroll:n.scrollWidth}));assert.ok(geometry.height>=48&&geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
    // Keep a queued task in view while a different task's lease is renewed.
    await row.evaluate(n=>{const panel=n.closest('.messages');panel.scrollTop+=n.getBoundingClientRect().top-panel.getBoundingClientRect().top-24;n.focus({preventScroll:true});});
    const before=await row.evaluate(n=>({offset:n.getBoundingClientRect().top-n.closest('.messages').getBoundingClientRect().top,id:n.id})),activity=await current.locator('.job-state').innerText(),order=await work.locator('button[data-job-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.jobId));
    await rpc('relay_owner_job_update',{job_id:target.id,run_id:run,event_id:crypto.randomUUID(),stage:'running'});
    let response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith('/jobs/changes')&&r.status()===200);await page.clock.fastForward(30000);await response;await page.waitForFunction(()=>!document.querySelector('#relay-owner-message-form [role=status]')?.textContent.includes('Refreshing'));
    assert.deepEqual(await work.locator('button[data-job-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.jobId)),order,'A heartbeat cannot reorder work');assert.equal(await current.locator('.job-state').innerText(),activity,'A heartbeat cannot manufacture visible progress');
    assert.equal(await page.evaluate(()=>document.activeElement.id),before.id);assert.ok(Math.abs((await row.evaluate(n=>n.getBoundingClientRect().top-n.closest('.messages').getBoundingClientRect().top))-before.offset)<=1,'Focused reading anchor survives the existing refresh');
    const other=jobs[9],otherRun=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:other.id,run_id:otherRun,event_id:crypto.randomUUID()});await rpc('relay_owner_job_update',{job_id:other.id,run_id:otherRun,event_id:crypto.randomUUID(),stage:'running',summary:'Fictional meaningful activity with enough details to wrap across several lines on the narrow phone screen.'});
    response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith('/jobs/changes')&&r.status()===200);await page.clock.fastForward(30000);await response;await page.waitForFunction(()=>!document.querySelector('#relay-owner-message-form [role=status]')?.textContent.includes('Refreshing'));
    assert.equal(await page.evaluate(()=>document.activeElement.id),before.id);assert.ok(Math.abs((await row.evaluate(n=>n.getBoundingClientRect().top-n.closest('.messages').getBoundingClientRect().top))-before.offset)<=1,'New activity above the focused task preserves its reading position');
    for(const size of [{width:360,height:800},{width:390,height:844},{width:390,height:520}]){await page.setViewportSize(size);const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,bottom:document.querySelector('#relay-owner-message-form').getBoundingClientRect().bottom}));assert.ok(bounds.width<=size.width&&bounds.bottom<=size.height+1,JSON.stringify({size,bounds}));}
    assert.equal(phone.records.filter(r=>r.path.endsWith('/jobs/detail')).length,0);assertBrowserContained(phone);await assertNoPrivatePersistence(page,['FictionalLongProjectLabel','Fictional meaningful activity']);
    await writeSyntheticEvidence(phone,'private-work-reading-anchor',{synthetic:true,focusPreserved:true,readingAnchorTolerance:1,heartbeatReordered:false,heartbeatAdvancedActivity:false});
  }finally{await closeConversationHarness(browser,h,pages);}
});


test('authorization loss while private work is public and unmounted clears search, filters and task editor state', {timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
  try{
    const auth=await h.oauth(),owner=await h.pair(auth),project='Fictional prior private project';
    const response=await h.phone('/jobs',{id:crypto.randomUUID(),title:'Fictional private task',body:'Fictional private scope.',action_kind:'read_only',project_title:project},owner.device_token);assert.equal(response.status,201);const job=(await response.json()).job;
    const phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;
    await page.goto(RELAY_URL);await page.locator('[data-job-id="'+job.id+'"]').waitFor();await conversationMenu(page,'Tasks');await conversationMenu(page,'Search tasks');const search=page.getByRole('searchbox',{name:'Search tasks'});await search.fill('prior private project');
    await conversationMenu(page,'Public chat');assert.equal(await page.locator('#relay-owner-current-work').count(),0,'The private UI is unmounted while showing public chat');
    await page.evaluate(key=>{localStorage.removeItem(key);dispatchEvent(new StorageEvent('storage',{key,newValue:null,storageArea:localStorage}));},OWNER_KEY);
    const replacement=await h.pair(auth,'Fictional replacement session');const value=JSON.stringify({device_token:replacement.device_token,device_id:replacement.device.id});
    await page.evaluate(({key,value})=>{localStorage.setItem(key,value);dispatchEvent(new StorageEvent('storage',{key,newValue:value,storageArea:localStorage}));},{key:OWNER_KEY,value});
    await conversationMenu(page,'Owner chat');await page.locator('[data-job-id="'+job.id+'"]').waitFor();assert.equal(await page.locator('#relay-owner-search').inputValue(),'','The old private search is not restored into the replacement session');
    assert.equal(await page.locator('.owner-job-fields').count(),0);await conversationMenu(page,'Tasks');const restored=page.locator('#relay-owner-current-work');assert.equal(await restored.locator('select,form').count(),0);
    assert.match(await restored.innerText(),/Fictional private task/);assertBrowserContained(phone);await assertNoPrivatePersistence(page,[project,'prior private project']);
  }finally{await closeConversationHarness(browser,h,pages);}
});

