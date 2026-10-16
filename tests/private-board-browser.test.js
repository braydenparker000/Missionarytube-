import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createConversationFixture,openConversationPage,closeConversationHarness,assertBrowserContained,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {chooseView} from './helpers/private-workspace-navigation.js';
// Run against the integrated staged source. Synthetic data, actual owner HTTP
// routes, actual DOM and Chromium; no live board activation or external traffic.
test('shared board renders, paginates, accepts owner replies/decisions/tasks and retains drafts',{timeout:90000},async t=>{
 if(!process.env.PRIVATE_WORKSPACE_CHROME){if(process.env.REQUIRE_PRIVATE_BOARD_BROWSER==='1')assert.fail('PRIVATE_WORKSPACE_CHROME must name the qualified Chromium executable');t.skip('Set PRIVATE_WORKSPACE_CHROME; REQUIRE_PRIVATE_BOARD_BROWSER=1 makes this mandatory');return;}
 const {chromium}=await import('playwright-core'),{boardStore}=await import('../backend/relay-board.js');
 const browser=await chromium.launch({executablePath:process.env.PRIVATE_WORKSPACE_CHROME,headless:true}),h=createConversationFixture(t,{env:{RELAY_BOARD_ENABLED:'true'}}),pages=[];
 try{
  const owner=await h.pair(await h.oauth()),obj=[...h.fixture.objects.values()].find(o=>o.db.prepare("SELECT name FROM sqlite_master WHERE name='relay_owner_sessions'").get());
  const connections=['lucy','mast','makima'].map(agent=>({agent,connection_id:'fixture-'+agent}));
  boardStore(obj.ctx,{op:'activate',args:{id:crypto.randomUUID(),confirm:true,duration_days:365,members:connections}},()=>({agent:'owner',authenticationSource:'owner-device-session',actor:'fixture-owner',verifiedConnections:connections}));
  const requestId=crypto.randomUUID(),actor={agent:'mast',actor:'fixture-mast',connectionId:'fixture-mast',authenticationSource:'mast-muse-profile'};
  boardStore(obj.ctx,{op:'send',args:{id:requestId,body:'Synthetic exact decision request',approval_request:{action:'Publish synthetic test build',target:'fixture Jarvis',version:'fixture-sha256',question:'Approve this fixture revision?',expires_at:new Date(Date.now()+86400000).toISOString()}}},()=>actor);
  for(const [agent,body] of [['lucy','I can coordinate the next step.'],['makima','I can review the proposed changes.']])boardStore(obj.ctx,{op:'send',args:{id:crypto.randomUUID(),body}},()=>({agent,actor:'fixture-'+agent,connectionId:'fixture-'+agent,authenticationSource:agent+'-oauth-mcp'}));
  for(let i=0;i<51;i++)boardStore(obj.ctx,{op:'send',args:{id:crypto.randomUUID(),body:'Synthetic shared message '+i}},()=>actor);
  await h.phone('/messages',{id:crypto.randomUUID(),body:'PRIVATE FIXTURE MUST NOT APPEAR'},owner.device_token);
  const phone=await openConversationPage(browser,h,{owner,clock:false,...(process.env.PRIVATE_WORKSPACE_ROOT?{root:process.env.PRIVATE_WORKSPACE_ROOT}:{})});pages.push(phone);const p=phone.page;p.on('dialog',dialog=>dialog.accept());await p.goto(SITE+'/private/');await chooseView(p,'board');
  await p.getByText('Synthetic exact decision request',{exact:true}).waitFor();assert.equal(await p.getByText('PRIVATE FIXTURE MUST NOT APPEAR',{exact:true}).count(),0);assert.equal(await p.locator('.shared-board input[type=file]').count(),0);
  // Screenshot evidence is isolated synthetic data, never production or an owner account.
  if(process.env.PRIVATE_CHAT_SCREENSHOT_DIR){const dir=process.env.PRIVATE_CHAT_SCREENSHOT_DIR;await mkdir(dir,{recursive:true});await p.setViewportSize({width:390,height:844});await p.screenshot({path:dir+'/group-normal.png'});await p.locator('#agent-select').click();await p.locator('#agent-panel').waitFor({state:'visible'});await p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await p.screenshot({path:dir+'/group-menu.png'});await p.getByRole('button',{name:'Close conversations'}).click();await p.locator('#agent-panel').waitFor({state:'hidden'});await p.getByRole('button',{name:'Open navigation',exact:true}).click();await p.getByText('Appearance on this device',{exact:true}).click();await p.locator('#private-spectrum').scrollIntoViewIfNeeded();await p.getByRole('textbox',{name:'Accent hex color'}).fill('#245edb');await p.getByRole('button',{name:'Apply',exact:true}).click();await p.screenshot({path:dir+'/group-spectrum.png'});await p.getByRole('button',{name:'Close navigation',exact:true}).click();await p.locator('#navigation-drawer').waitFor({state:'hidden'});}
  await p.getByRole('button',{name:'Load more messages',exact:true}).click();await p.getByText('Synthetic shared message 50',{exact:true}).waitFor();
  await p.locator('#board-message').fill('Retained board draft');await chooseView(p,'collaboration');await chooseView(p,'board');assert.equal(await p.locator('#board-message').inputValue(),'Retained board draft');
  await p.locator('[data-message-id="'+requestId+'"] button').filter({hasText:/^Reply$/}).click();await p.locator('#board-message').fill('Owner fixture reply');await p.getByRole('button',{name:'Send message',exact:true}).click();await p.getByText('Owner fixture reply',{exact:true}).waitFor();
  await p.getByText('Review approval request',{exact:true}).click();await p.getByRole('button',{name:'Approve exact request',exact:true}).click();await p.getByText('Your exact decision is recorded.',{exact:true}).waitFor();
  const approval=obj.db.prepare("SELECT * FROM board_messages WHERE kind='approval'").get();assert.equal(approval.identity,'owner');assert.equal(approval.reply_to,requestId);assert.equal(JSON.parse(approval.approval_json).version,'fixture-sha256');
  await p.getByText('Group details',{exact:true}).click();await p.getByText('Shared tasks',{exact:true}).click();await p.locator('#board-task-title').fill('Synthetic shared task');await p.locator('#board-task-body').fill('Fixture scope only');await p.locator('#board-task-assignee').selectOption('makima');await p.getByRole('button',{name:'Create shared task',exact:true}).click();await p.getByRole('heading',{name:'Synthetic shared task',exact:true}).waitFor();
  assert.equal(obj.db.prepare('SELECT assignee FROM board_tasks WHERE title=?').get('Synthetic shared task').assignee,'makima');
  const output=process.env.PRIVATE_BOARD_EVIDENCE||'/tmp/private-board-evidence';await mkdir(output,{recursive:true});
  for(const [width,height,name] of [[320,640,'mobile-320'],[390,560,'keyboard-space'],[1280,900,'desktop']]){await p.setViewportSize({width,height});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const composer=await p.locator('.board-composer').boundingBox();assert.ok(composer&&composer.y+composer.height<=height+1,'composer stays inside viewport');await p.screenshot({path:output+'/'+name+'.png'});}
  assertBrowserContained(phone);
 }finally{await closeConversationHarness(browser,h,pages);}
});
