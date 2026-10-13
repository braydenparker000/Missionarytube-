import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,conversationMenu,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,writeSyntheticEvidence,RELAY_URL} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';
import {sharedStore} from '../backend/shared.js';

// The qualification workflow already publishes JARVIS_SCREENSHOT_DIR. Keep
// fictional Relay evidence in its own subdirectory without altering that recipe.
if(!process.env.RELAY_QA_EVIDENCE_DIR&&process.env.JARVIS_SCREENSHOT_DIR)process.env.RELAY_QA_EVIDENCE_DIR=resolve(process.env.JARVIS_SCREENSHOT_DIR,'relay-modernization-checks');

async function journey(t){
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const h=createConversationFixture(t),pages=[],auth=await h.oauth(),owner=await h.pair(auth,'Fictional redesign phone');
  t.after(()=>closeConversationHarness(browser,h,pages));
  const open=async(size={})=>{const phone=await openConversationPage(browser,h,{owner,clock:false,...size});pages.push(phone);await phone.page.goto(RELAY_URL);await phone.page.locator('#relay-owner-message-text').waitFor();await phone.page.waitForFunction(()=>!document.querySelector('#relay-owner-message-form [role=status]')?.textContent.includes('Refreshing'));return phone;};
  const create=async(data)=>{const response=await h.phone('/jobs',{id:crypto.randomUUID(),title:'Fictional task',body:'Fictional scope note.',action_kind:'read_only',...data},owner.device_token);assert.equal(response.status,201);return (await response.json()).job;};
  return {browser,h,owner,auth,pages,open,create,rpc:(name,args)=>h.rpc(auth,name,{inbox_id:RELAY_OWNER_INBOX,...args})};
}
async function geometry(page){return page.evaluate(()=>{
  const modal=document.querySelector('dialog[open]'),root=modal||document;
  const targets=[...root.querySelectorAll('button,input,select,textarea,summary,.topbar a,.relay-home')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&!n.closest('[hidden]')&&getComputedStyle(n).visibility!=='hidden';}).map(n=>{const target=n.type==='checkbox'?n.closest('label')||n:n,r=target.getBoundingClientRect();return {name:n.getAttribute('aria-label')||n.id||n.textContent.trim(),width:r.width,height:r.height};});
  return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,appHeight:parseFloat(document.documentElement.style.getPropertyValue('--app-height')),targets};
});}
function assertGeometry(value){assert.ok(value.documentWidth<=value.width+1,JSON.stringify(value));for(const t of value.targets){assert.ok(t.width>=48&&t.height>=48,JSON.stringify(t));}}
function contrast(foreground,background){const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(c=>Number(c)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
async function chatAnchor(page){return page.locator('.relay-owner-chat .messages').evaluate(panel=>{const b=panel.getBoundingClientRect(),r=[...panel.children].find(n=>n.dataset.messageId&&n.getBoundingClientRect().bottom>b.top);return {id:r?.dataset.messageId,offset:r?r.getBoundingClientRect().top-b.top:0,scroll:panel.scrollTop};});}

test('visible Chat and Work preserve local context, reading and private draft without expansion requests',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;const jobs=[];
  for(let i=0;i<16;i++)jobs.push(await j.create({title:'Fictional studio task '+i,body:'Fictional scope note '+i+'. Keep this work private.',project_title:'Fictional studio project',goal_title:'Prepare the room'}));
  const phone=await j.open(),page=phone.page;await page.locator('[data-job-id="'+jobs.at(-1).id+'"]').waitFor();
  assert.equal(await page.locator('#relay-nav-chat').getAttribute('aria-current'),'page');
  await conversationMenu(page,'Search private messages');await page.locator('#relay-owner-search').fill('scope note');
  const panel=page.locator('.relay-owner-chat .messages');await panel.evaluate(n=>n.scrollTop=220);const chat=await chatAnchor(page);assert.ok(chat.scroll>0);
  await page.locator('#relay-owner-message-text').fill('A fictional private draft to retain.');const before=phone.records.length;
  await conversationMenu(page,'Requests');assert.equal(await page.locator('#relay-nav-work').getAttribute('aria-current'),'page');
  const work=page.locator('#relay-owner-current-work');await work.waitFor();assert.equal(await page.locator('#relay-owner-message-form').isVisible(),false,'Work allocates its canvas to tasks');
  await page.locator('#relay-owner-search').fill('studio project');
  await work.locator('[data-job-id="'+jobs[6].id+'"]').focus();await panel.evaluate(n=>n.scrollTop=300);const workScroll=await panel.evaluate(n=>n.scrollTop);
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();assert.equal(await page.locator('#relay-owner-search').inputValue(),'scope note');assert.equal(await page.locator('#relay-owner-message-text').inputValue(),'A fictional private draft to retain.');
  const restored=await chatAnchor(page);assert.equal(restored.id,chat.id);assert.ok(Math.abs(restored.offset-chat.offset)<=3,JSON.stringify({chat,restored}));
  await conversationMenu(page,'Requests');assert.equal(await page.locator('#relay-owner-search').inputValue(),'studio project');assert.equal(await work.locator('select,form').count(),0);assert.ok(Math.abs((await panel.evaluate(n=>n.scrollTop))-workScroll)<=3);
  assert.equal(phone.records.slice(before).filter(r=>r.path.startsWith('/relay/owner/')).length,0,'Navigation, search, filter and disclosures use loaded records');
  assert.equal(await page.locator('#relay-owner-new-task').count(),0);assert.equal(await page.locator('#relay-owner-message-text').inputValue(),'A fictional private draft to retain.');
  await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();assert.equal(await page.locator('#relay-owner-current-work').count(),0);assert.equal((await page.locator('body').innerText()).includes('Fictional studio project'),false);
  await assertNoPrivatePersistence(page,['Fictional studio project','Fictional scope note'],{draft:'A fictional private draft to retain.'});assertBrowserContained(phone);
});

test('phone result-first detail and desktop pane retain immutable correction and completion evidence',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;const job=await j.create({title:'Fictional completed checklist',body:'Fictional original scope. Prepare a checklist without external changes.',project_title:'Fictional studio',goal_title:'Open the room'}),run=crypto.randomUUID();
  await j.rpc('relay_owner_job_claim',{job_id:job.id,run_id:run,event_id:crypto.randomUUID()});const reply=await j.rpc('relay_owner_reply',{message_id:job.id,body:'Fictional original result: three chairs.'});await j.rpc('relay_owner_job_update',{job_id:job.id,run_id:run,event_id:crypto.randomUUID(),stage:'completed',outcome:'known',summary:'Fictional checklist preparation reported complete.',expected_reply_id:reply.entry.id,expected_version:1});await j.rpc('relay_owner_job_result_correct',{job_id:job.id,event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,expected_version:1,body:'Fictional corrected result: four chairs. https://example.test/fictional-checklist',correction_summary:'Checked the second fictional note.'});
  for(const size of [{width:390,height:844,mobile:true},{width:1280,height:900,mobile:false}]){
    const phone=await j.open(size),page=phone.page;await page.locator('[data-job-id="'+job.id+'"]').waitFor();await conversationMenu(page,'Requests');const row=page.locator('#relay-owner-current-work [data-job-id="'+job.id+'"]');await row.click();await page.waitForFunction(()=>{const r=document.querySelector('#relay-owner-request-refresh');return r&&!r.disabled;});
    const detail=page.locator('#relay-owner-request-dialog');assert.equal(await detail.locator('#relay-owner-request-properties').count(),0);assert.equal(await detail.locator('input,select').count(),0);const order=await detail.evaluate(dialog=>({rect:dialog.getBoundingClientRect().toJSON()}));assert.equal(await detail.locator('#relay-owner-result-latest').getAttribute('data-result-version'),'2');assert.equal(await detail.locator('#relay-owner-completion').getAttribute('data-result-version'),'1');assert.match(await detail.innerText(),/latest correction has not been confirmed complete/);assert.match(await detail.locator('.request-state').textContent(),/Finished/);assert.equal(await detail.getByRole('button',{name:'Request stop',exact:true}).count(),0);
    const g=await geometry(page);assertGeometry(g);await writeSyntheticEvidence(phone,'redesign-result-'+size.width+'x'+size.height,{synthetic:true,geometry:g,order,completionVersion:1,resultVersion:2});
    await page.keyboard.press('Escape');await detail.waitFor({state:'detached'});assert.equal(await detail.count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'owner-work-task-'+job.id);assertBrowserContained(phone);
  }
});

test('reflow, enlarged text and visual-viewport-only keyboard keep real controls and drafts usable',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;const job=await j.create({title:('Fictional long title with useful context ').repeat(3).slice(0,120),body:'Fictional scope note with a long URL https://example.test/'+('long-path-').repeat(20),project_title:('Fictional long project ').repeat(5).slice(0,120),goal_title:('Fictional long goal ').repeat(6).slice(0,120)}),phone=await j.open(),page=phone.page;await page.locator('[data-job-id="'+job.id+'"]').waitFor();await page.locator('#relay-owner-message-text').fill('Fictional draft stays through viewport changes.');
  const keyboard=await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>520});visualViewport.dispatchEvent(new Event('resize'));return {layout:innerHeight,visual:visualViewport.height,app:parseFloat(document.documentElement.style.getPropertyValue('--app-height')),compact:document.body.dataset.relayCompactViewport,composer:document.querySelector('#relay-owner-message-form').getBoundingClientRect().toJSON()};});
  assert.equal(keyboard.layout,844);assert.equal(keyboard.visual,520);assert.equal(keyboard.app,520);assert.equal(keyboard.compact,'true');assert.ok(keyboard.composer.bottom<=521);assert.equal(await page.locator('.relay-navigation').isVisible(),false,'Only visual viewport shrinks in this explicitly mocked Android-style resize');
  await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});assert.equal(await page.locator('#relay-menu-button').isVisible(),true);assert.equal(await page.locator('#relay-owner-message-text').inputValue(),'Fictional draft stays through viewport changes.');
  await conversationMenu(page,'Requests');await page.setViewportSize({width:320,height:568});assertGeometry(await geometry(page));assert.equal(await page.getByRole('button',{name:'Back to chat',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Search tasks',exact:true}).isVisible(),true);
  await page.evaluate(()=>{const sizes=[...document.querySelectorAll('h1,h2,h3,p,span,button,label,input,select,textarea,summary,a,li')].map(n=>{const s=getComputedStyle(n);return {n,font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)};});for(const {n,font,line}of sizes){n.style.fontSize=font*2+'px';n.style.lineHeight=(Number.isFinite(line)?line*2:font*3)+'px';}});
  const enlarged=await geometry(page);assertGeometry(enlarged);await writeSyntheticEvidence(phone,'redesign-work-320-enlarged',{synthetic:true,geometry:enlarged,textScale:2,keyboardSimulation:'mock VisualViewport height only; no physical IME'});assertBrowserContained(phone);
});

test('Relay choice sheets, owner connection and pending public timestamps retain readable rendered contrast',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;const phone=await j.open(),page=phone.page;
  const assertHeading=async(name)=>{
    const colors=await page.locator('dialog[open] .dialog-heading').evaluate(n=>({background:getComputedStyle(n).backgroundColor,text:getComputedStyle(n.querySelector('h2')).color}));
    assert.ok(contrast(colors.text,colors.background)>=4.5,JSON.stringify(colors));assertGeometry(await geometry(page));
    await writeSyntheticEvidence(phone,name,{synthetic:true,colors,contrast:contrast(colors.text,colors.background)});
  };
  await page.locator('#relay-menu-button').click();await assertHeading('redesign-conversation-menu-contrast');await page.getByRole('dialog').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Connection details',exact:true}).click();await page.getByRole('dialog',{name:'Private owner connection',exact:true}).waitFor();await assertHeading('redesign-owner-connection-contrast');
  await page.getByRole('button',{name:'Close connection details',exact:true}).click();
  const id=crypto.randomUUID();assert.equal(sharedStore(j.h.ctx,'/internal/shared/message',{id,body:'Fictional public question awaiting a reply.'}).status,201);
  await conversationMenu(page,'Public chat');await page.evaluate(()=>dispatchEvent(new Event('online')));const pending=page.locator('#messages [data-message-id="'+id+'"] .message-footer>.message-time[data-pending=true]');await pending.waitFor();
  const colors=await pending.evaluate(n=>({text:getComputedStyle(n).color,background:getComputedStyle(n.closest('.bubble')).backgroundColor}));assert.ok(contrast(colors.text,colors.background)>=4.5,JSON.stringify(colors));assert.match(await pending.innerText(),/Awaiting reply/);
  await writeSyntheticEvidence(phone,'redesign-public-pending-contrast',{synthetic:true,colors,contrast:contrast(colors.text,colors.background)});assertBrowserContained(phone);
  if(process.env.JARVIS_SCREENSHOT_DIR){
    const helper=fileURLToPath(new URL('./helpers/relay-modernization-visual-fixture.mjs',import.meta.url));
    const output=resolve(process.env.JARVIS_SCREENSHOT_DIR,'relay-visual-review');
    const result=await promisify(execFile)(process.execPath,[helper,output],{timeout:90000,maxBuffer:1024*1024});
    assert.match(result.stdout,/"captures":31,"unexpected":\[\],"browserErrors":\[\]/,'The fictional review artifact must contain all 31 rendered after scenarios without uncontained routes or browser errors');
  }
});


test('approved Relay font, menu and reduced motion preserve the real public/private boundary',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;const job=await j.create({title:'PRIVATE-V6-TASK-6941',body:'PRIVATE-V6-SCOPE-7732',project_title:'PRIVATE-V6-PROJECT-1825'}),phone=await j.open(),page=phone.page;
  await page.locator('[data-job-id="'+job.id+'"]').waitFor();await page.evaluate(()=>document.fonts.ready);
  const font=await page.evaluate(()=>({loaded:document.fonts.check('17px Manrope'),family:getComputedStyle(document.querySelector('#relay-owner-message-text')).fontFamily}));assert.equal(font.loaded,true);assert.match(font.family,/Manrope/);
  assert.equal(await page.locator('[data-relay-example],.relay-preview-badge').count(),0);assert.equal(await page.locator('body').textContent().then(x=>/Preview ·|example tasks|sample conversation/.test(x)),false);
  await page.emulateMedia({reducedMotion:'reduce'});await conversationMenu(page,'Requests');await page.locator('#relay-owner-current-work').waitFor();assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
  await page.locator('#relay-owner-current-work [data-job-id="'+job.id+'"]').click();await page.locator('#relay-owner-request-dialog').waitFor();assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);await page.getByRole('button',{name:'Back from task',exact:true}).click();
  await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();await page.locator('#relay-menu-button').click();await page.getByRole('dialog').getByRole('button',{name:'Saved',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.conversation-identity .brand')?.textContent==='Saved');assert.equal(await page.locator('.conversation-identity .brand').textContent(),'Saved');
  assert.equal(await page.locator('body').textContent().then(x=>x.includes('PRIVATE-V6-')),false);await page.locator('#relay-menu-button').click();await page.getByRole('dialog').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Font & credits',exact:true}).click();await page.getByRole('dialog').locator('summary').click();const license=await page.getByRole('dialog').locator('pre').textContent();assert.match(license,/SIL OPEN FONT LICENSE Version 1.1/);assert.match(license,/TERMINATION/);assert.match(license,/DISCLAIMER/);
  assert.equal(phone.records.some(r=>/fonts\.googleapis|fonts\.gstatic|raw\.githubusercontent/.test(r.url)),false,'The licensed font loads from the deployed CSS without a third-party font request');assertBrowserContained(phone);await assertNoPrivatePersistence(page,['PRIVATE-V6-TASK-6941','PRIVATE-V6-SCOPE-7732','PRIVATE-V6-PROJECT-1825']);
});

test('rendered Relay code and recovery notices retain readable inner-surface contrast',{timeout:120000},async t=>{
  const j=await journey(t);if(!j)return;const question=crypto.randomUUID();
  assert.equal(sharedStore(j.h.ctx,'/internal/shared/message',{id:question,body:'Fictional public formatting question.'}).status,201);
  assert.equal(sharedStore(j.h.ctx,'/internal/shared/reply',{id:crypto.randomUUID(),replyTo:question,body:'Fictional code example:\n\n```js\nconsole.log("fixture");\n```\n\nUse `fixture_value` only in this example.'}).status,201);
  const phone=await j.open(),page=phone.page,checks=[];
  const colors=async locator=>locator.evaluate(n=>{
    const text=getComputedStyle(n).color;let node=n,background;
    while(node){background=getComputedStyle(node).backgroundColor;if(background!=='rgba(0, 0, 0, 0)'&&background!=='transparent')break;node=node.parentElement;}
    return {text,background};
  });
  await conversationMenu(page,'Public chat');await page.evaluate(()=>dispatchEvent(new Event('online')));const code=page.locator('#messages .code-block pre');await code.waitFor();
  for(const locator of [code,page.locator('#messages .rich-body p code'),page.locator('#messages .code-copy'),page.locator('#messages .outgoing .message-body p'),page.locator('#messages .outgoing .message-footer>.message-time')])checks.push(await colors(locator));
  await writeSyntheticEvidence(phone,'redesign-inner-code',{synthetic:true,colors:checks.slice()});
  await conversationMenu(page,'Owner chat');await page.locator('#relay-owner-message-text').waitFor();
  phone.rule(r=>r.method==='GET'&&r.path==='/relay/owner/messages',async({forward})=>{const response=await forward();return Response.json({error:'Fictional unavailable fixture'},{status:503,headers:response.headers});});
  await conversationMenu(page,'Refresh private inbox');const error=page.locator('.conversation-notice[data-kind=error] p');await error.waitFor();checks.push(await colors(error),await colors(page.locator('.conversation-notice[data-kind=error] button')));await writeSyntheticEvidence(phone,'redesign-inner-error',{synthetic:true,colors:checks.slice(-2)});
  await conversationMenu(page,'Refresh private inbox');await page.waitForFunction(()=>document.querySelector('.conversation-notice')?.hidden===true);await page.locator('#relay-owner-message-text').fill('Fictional retained draft for a safe local notice.');await conversationMenu(page,'Requests');await page.locator('#relay-owner-new-task').click();const note=page.locator('.conversation-notice[data-kind=note] p');await note.waitFor();checks.push(await colors(note));await writeSyntheticEvidence(phone,'redesign-inner-note',{synthetic:true,colors:checks.slice(-1)});
  for(const value of checks)assert.ok(contrast(value.text,value.background)>=4.5,JSON.stringify({...value,contrast:contrast(value.text,value.background)}));assertBrowserContained(phone);
});
