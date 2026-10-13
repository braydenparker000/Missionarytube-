import {mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,cp,writeFile,mkdtemp,rm,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,conversationMenu,closeConversationHarness,assertBrowserContained,writeSyntheticEvidence,SITE,RELAY_URL} from './relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../../backend/relay-common.js';
import {sharedStore} from '../../backend/shared.js';

// All records and sessions below are fictional, in a local SQLite fixture.
// Browser contexts are offline; CDP serves source files and the fake Worker.
// No production reads, writes, identity provider or external assets. Output is only fictional local review evidence.
const source=resolve(fileURLToPath(new URL('../../',import.meta.url))),base=process.argv[2];
assert.ok(base&&base.startsWith('/'),'A dedicated absolute evidence directory is required');
const root=await mkdtemp(resolve(tmpdir(),'relay-visual-public-'));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
execFileSync('git',['diff','--exit-code'],{cwd:source});
execFileSync('git',['diff','--cached','--exit-code'],{cwd:source});
const sourceTree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:source,encoding:'utf8'}).trim();
let candidateSourceCommit=sourceCommit;
if(process.env.GITHUB_EVENT_PATH){const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));candidateSourceCommit=event.pull_request?.head?.sha||sourceCommit;}
await mkdir(base,{recursive:true});
await cp(resolve(source,'public'),root,{recursive:true});
await cp(new URL('../fixtures/relay-modernization-baseline/',import.meta.url),resolve(base,'baseline'),{recursive:true});
await writeFile(root+'/assets/quick-ai-config.json',JSON.stringify({version:3,geminiKey:'',groqKey:'',tavilyKey:''})+'\n');
await writeFile(root+'/assets/drive-config.json',JSON.stringify({apiKey:'',folderId:'',videoFolderId:''})+'\n');
process.env.RELAY_QA_EVIDENCE_DIR=base+'/after';
const t={mock,skip:message=>{throw Error(message);}},browser=await launchQualifiedBrowser(t),h=createConversationFixture(t),pages=[],captures=[];
const capture=async(phone,name,extra={})=>{
  await phone.page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const geometry=await phone.page.evaluate(()=>{
    const rect=node=>node?.getBoundingClientRect().toJSON()||null;
    const composer=document.querySelector('#relay-owner-message-form')||document.querySelector('#message-form');
    const messages=document.querySelector('.relay-owner-chat .messages')||document.querySelector('#messages');
    const visible=node=>{const r=node.getBoundingClientRect();return r.width&&r.height&&!node.closest('[hidden]')&&getComputedStyle(node).visibility!=='hidden';};
    return {viewport:{width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height},documentWidth:document.documentElement.scrollWidth,
      appHeight:document.documentElement.style.getPropertyValue('--app-height'),workspace:rect(document.querySelector('.workspace')),header:rect(document.querySelector('.topbar')),
      content:rect(document.querySelector('#content')),messages:rect(messages),composer:rect(composer),detail:rect(document.querySelector('#relay-owner-request-dialog')),
      focused:document.activeElement.id,controls:[...document.querySelectorAll('button,input,select,summary,textarea,.topbar a')].filter(visible).map(node=>({id:node.id,label:node.getAttribute('aria-label')||node.textContent.trim()||node.id,...rect(node)}))};
  });
  await writeSyntheticEvidence(phone,name,{sourceCommit,sourceTree,candidateSourceCommit,productionEquivalentUi:false,configurationStubs:['quick-ai-config.json','drive-config.json'],...extra,geometry});
  captures.push({name,viewport:phone.page.viewportSize(),...extra,geometry});
  assertBrowserContained(phone);console.log('Captured '+name);
};
const open=async(size={},owner)=>{const phone=await openConversationPage(browser,h,{width:390,height:844,mobile:true,root,clock:false,...size,...(owner?{owner}:{})});pages.push(phone);await phone.page.goto(RELAY_URL);return phone;};
const waitOwner=async page=>{await page.locator('#relay-owner-message-text').waitFor();await page.waitForFunction(()=>!document.querySelector('#relay-owner-message-form [role=status]')?.textContent.includes('Refreshing'));};
const inspect=async(page,id)=>{await page.locator('#relay-owner-current-work [data-job-id="'+id+'"]').click();await page.locator('#relay-owner-request-dialog').waitFor();await page.waitForFunction(()=>{const r=document.querySelector('#relay-owner-request-refresh');return r&&!r.disabled;});};
const closeDetail=page=>page.getByRole('button',{name:'Back from task',exact:true}).click();
try{
  const auth=await h.oauth(),owner=await h.pair(auth,'Fictional visual audit device');
  const rpc=(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args});
  const emptyPrivate=await open({},owner);await waitOwner(emptyPrivate.page);await capture(emptyPrivate,'phone-private-empty');await conversationMenu(emptyPrivate.page,'Requests');await emptyPrivate.page.locator('#relay-owner-current-work').waitFor();await capture(emptyPrivate,'phone-work-empty');
  const emptyPublic=await open();await emptyPublic.page.locator('#message-text').waitFor();await capture(emptyPublic,'phone-public-empty');
  const jobs={};
  const create=async(key,title,body,project='Oak Street studio',goal='Prepare the launch plan')=>{
    const response=await h.phone('/jobs',{id:crypto.randomUUID(),title,body,action_kind:'read_only',...(project?{project_title:project,goal_title:goal}:{})},owner.device_token);
    assert.equal(response.status,201);return jobs[key]=(await response.json()).job;
  };
  const claim=async(job,stage,summary,outcome)=>{const run_id=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:job.id,run_id,event_id:crypto.randomUUID()});if(stage)await rpc('relay_owner_job_update',{job_id:job.id,run_id,event_id:crypto.randomUUID(),stage,summary,...(outcome?{outcome}:{})});return run_id;};
  await create('queued','Compare acoustic panels','Compare three acoustic panel options for the north wall. Keep the recommendation practical and note where the measurements still need checking.');
  await create('working','Check room measurements','Check the floor plan against the two measurement notes. Flag conflicts before preparing the layout.');
  await claim(jobs.working,'running','Compared both measurement notes. The north wall depth still needs checking.');
  await create('waiting','Choose the opening date','Prepare a short opening checklist once the date is confirmed.');await claim(jobs.waiting,'waiting_for_owner','Should the opening be on Saturday 24 October or the following weekend?','not_started');
  await create('failed','Read the venue notes','Read the venue notes and list accessibility questions.');await claim(jobs.failed,'failed','The venue note could not be read. No external action started.','not_started');
  await create('unknown','Check the equipment shortlist','Review the equipment shortlist and compare the available specifications.');await claim(jobs.unknown,'running','Started comparing the saved equipment notes.');h.ctx.storage.sql.exec('UPDATE relay_owner_jobs SET lease_expires_ms=? WHERE id=?',Date.now()-60000,jobs.unknown.id);
  await create('cancellation','Compare delivery options','Compare the delivery options described in the saved notes.','Weekend workshop','Set up the room');await claim(jobs.cancellation,'running','Read the delivery options; one pickup window is unclear.');assert.equal((await h.phone('/jobs/cancel',{job_id:jobs.cancellation.id},owner.device_token)).status,201);
  await create('unverified','Review the printed handout','Review the wording of the workshop handout.','Weekend workshop','Set up the room');await rpc('relay_owner_reply',{message_id:jobs.unverified.id,body:'I received the handout request. The saved notes mention four materials, but I have not finished reviewing the wording.'});
  await create('done','Prepare the opening checklist','Prepare a simple checklist for the first morning. Use only the saved studio notes.');const doneRun=await claim(jobs.done);const reply=await rpc('relay_owner_reply',{message_id:jobs.done.id,body:'Opening morning checklist\n\n1. Check the entrance and accessible route.\n2. Test the lighting and speakers.\n3. Place the printed schedule by the door.\n4. Set out three chairs beside the north wall.\n\nThe opening date still needs your confirmation.'});await rpc('relay_owner_job_update',{job_id:jobs.done.id,run_id:doneRun,event_id:crypto.randomUUID(),stage:'completed',summary:'Prepared the checklist from the saved studio notes. No external actions were taken.',outcome:'known',expected_reply_id:reply.entry.id,expected_version:1});await rpc('relay_owner_job_result_correct',{job_id:jobs.done.id,event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,expected_version:1,body:'Opening morning checklist\n\n1. Check the entrance and accessible route.\n2. Test the lighting and speakers.\n3. Place the printed schedule by the door.\n4. Set out four chairs beside the north wall.\n\nCorrected the chair count after comparing the second saved note. The opening date still needs your confirmation.\n\nSource note: https://example.test/studio/room-plan',correction_summary:'The second note specifies four chairs rather than three.'});
  const messageId=crypto.randomUUID();await h.phone('/messages',{id:messageId,body:'Can you help me keep the studio launch calm? I want to start with a few useful things and leave the rest for later.'},owner.device_token);await rpc('relay_owner_reply',{message_id:messageId,body:'Start with the room, the schedule, and one clear welcome.\n\nThe room measurements are being checked. The opening checklist is ready in Current work, with the corrected chair count. Before moving further, choose the opening date.\n\nEverything else can wait until those three pieces feel settled.'});
  const publicTurns=[
    ['How can I make a small creative space feel welcoming?','Leave a clear path through the room, give people somewhere comfortable to pause, and make the first thing they see easy to understand. A simple sign and a little natural light can do more than a crowded display.'],
    ['What would you put on a one-page opening schedule?','Keep it to three things: when the doors open, what visitors can try, and when the day winds down.\n\nUse plain headings and leave space between them. The schedule should help someone decide where to go next.'],
    ['Give me a short welcome note I can adapt.','Welcome in. Take your time, look around, and ask about anything that catches your eye. We are glad you are here.']
  ];
  for(const [index,[body,answer]]of publicTurns.entries()){const id=crypto.randomUUID(),time=new Date(Date.now()-(publicTurns.length-index)*3600000).toISOString();assert.equal(sharedStore(h.ctx,'/internal/shared/message',{id,body,createdAt:time}).status,201);assert.equal(sharedStore(h.ctx,'/internal/shared/reply',{id:crypto.randomUUID(),replyTo:id,body:answer,createdAt:new Date(Date.parse(time)+60000).toISOString()}).status,201);}
  for(const size of [{width:390,height:844,mobile:true},{width:1280,height:900,mobile:false}]){
    const label=size.mobile?'phone':'desktop',phone=await open(size,owner),page=phone.page;await waitOwner(page);await page.locator(`[data-job-id="${jobs.done.id}"]`).waitFor();await capture(phone,label+'-private-chat');
    await conversationMenu(page,'Requests');const work=page.locator('#relay-owner-current-work');await work.waitFor();const before=phone.records.length;await capture(phone,label+'-work-overview');
    const working=work.locator(`[data-job-id="${jobs.working.id}"]`);await working.focus();await working.scrollIntoViewIfNeeded();await capture(phone,label+'-work-expanded',{localWorkExpansionRequests:phone.records.slice(before).filter(r=>r.path.startsWith('/relay/owner/')).length});
    await conversationMenu(page,'Search tasks');const search=page.getByRole('searchbox',{name:'Search tasks'});await search.fill('fictional unmatched task');assert.match(await work.innerText(),/No work matches this search and status/);await capture(phone,label+'-work-no-matches');await page.getByRole('button',{name:'Close search',exact:true}).click();
    await conversationMenu(page,'Requests');await inspect(page,jobs.waiting.id);await capture(phone,label+'-detail-waiting');await closeDetail(page);
    await inspect(page,jobs.done.id);await capture(phone,label+'-detail-corrected-result');await page.locator('#relay-owner-result-latest').scrollIntoViewIfNeeded();await capture(phone,label+'-detail-result-reading');await closeDetail(page);
    await inspect(page,jobs.unverified.id);await capture(phone,label+'-detail-unverified');await closeDetail(page);
    await page.getByRole('button',{name:'Back to chat',exact:true}).click();await waitOwner(page);await page.locator('#relay-owner-message-text').fill('Prepare a short welcome note I can review. Use the studio notes and keep the tone calm.');await capture(phone,label+'-chat-draft');
    if(size.mobile){await page.setViewportSize({width:390,height:520});await page.locator('#relay-owner-message-text').focus();await capture(phone,'phone-chat-draft-short',{keyboardFixture:'Reduced VisualViewport-style space; no physical Android IME'});await page.setViewportSize({width:360,height:800});await capture(phone,'phone-chat-draft-360');await page.setViewportSize({width:390,height:844});}
    await page.locator('#relay-menu-button').click();await capture(phone,label+'-navigation-menu');await page.keyboard.press('Escape');await page.locator('#relay-owner-message-text').fill('');
    await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();await page.locator('#messages .message-row').first().waitFor();await page.evaluate(()=>document.querySelector('#messages').scrollTop=0);await capture(phone,label+'-public-chat');
    if(size.mobile){await page.setViewportSize({width:320,height:568});await capture(phone,'phone-public-chat-320');}
  }
  const retryPhone=await open({},owner);await waitOwner(retryPhone.page);await retryPhone.page.locator('#relay-owner-message-text').fill('Prepare a reminder draft for me to review.');retryPhone.rule(r=>r.method==='POST'&&r.path==='/relay/owner/messages',async({forward})=>{const accepted=await forward();assert.equal(accepted.status,201);return{abort:true};});await retryPhone.page.getByRole('button',{name:'Send private message',exact:true}).click();await retryPhone.page.getByRole('button',{name:'Retry private send',exact:true}).waitFor();await capture(retryPhone,'phone-chat-send-unconfirmed',{serverAcceptedInFixture:true,receivedResponse:false});
  const stale=await open({},owner);await waitOwner(stale.page);await stale.page.locator(`[data-job-id="${jobs.working.id}"]`).waitFor();await conversationMenu(stale.page,'Requests');stale.rule(r=>r.method==='GET'&&r.path.startsWith('/relay/owner/'),async()=>new Response(JSON.stringify({error:'Fictional offline fixture'}),{status:503,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':SITE}}),10);await conversationMenu(stale.page,'Refresh private inbox');await stale.page.waitForFunction(()=>document.querySelector('#relay-owner-message-form [role=status]')?.textContent==='Private sync unavailable');await capture(stale,'phone-work-stale',{loadedRecordsRetained:true});
  const authPhone=await open();await authPhone.page.locator('#message-text').waitFor();await conversationMenu(authPhone.page,'Connect this phone');await authPhone.page.locator('.relay-owner-panel').waitFor();await capture(authPhone,'phone-private-access-required');
  await writeFile(base+'/after/index.json',JSON.stringify({synthetic:true,sourceCommit,sourceTree,candidateSourceCommit,captures},null,2)+'\n');
  const cards=captures.map(({name,viewport})=>`<figure><a href="${name}.png"><img loading="lazy" src="${name}.png" alt="${name}"></a><figcaption>${name} · ${viewport.width} × ${viewport.height}</figcaption></figure>`).join('\n');
  await writeFile(base+'/after/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Relay redesign audit — fictional fixtures</title><style>body{font:16px/1.5 system-ui;background:#faf9f6;color:#20242b;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:24px}figure{margin:0;overflow:hidden}img{width:100%;height:560px;object-fit:contain;object-position:top;background:#eee}figcaption{margin-top:8px;font-size:14px}a:focus-visible{outline:3px solid #3f46a7}</style><h1>Relay redesign audit</h1><p>All displayed content, devices and requests are fictional. Offline Chrome renders source ${sourceCommit}. No real owner browser or production writes.</p><main>${cards}</main></html>`);
  console.log(JSON.stringify({synthetic:true,captures:captures.length,unexpected:pages.flatMap(p=>p.unexpected),browserErrors:pages.flatMap(p=>p.errors)}));
}finally{await closeConversationHarness(browser,h,pages);mock.restoreAll();await rm(root,{recursive:true,force:true});}
