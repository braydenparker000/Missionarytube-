import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createConversationFixture,openConversationPage,closeConversationHarness,assertBrowserContained,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {chooseView} from './helpers/private-workspace-navigation.js';
import {MAKIMA_OBJECT} from '../backend/relay-makima-policy.js';
// Synthetic account and content only; real Worker routes and frontend parser.
// Production CI sets the same mandatory Chromium gate as board qualification.
test('Makima private chat reads real owner routes, sends text and renders mobile evidence',{timeout:90000},async t=>{
 if(!process.env.PRIVATE_WORKSPACE_CHROME){if(process.env.REQUIRE_PRIVATE_BOARD_BROWSER==='1')assert.fail('PRIVATE_WORKSPACE_CHROME must name the qualified Chromium executable');t.skip('Set PRIVATE_WORKSPACE_CHROME; REQUIRE_PRIVATE_BOARD_BROWSER=1 makes this mandatory');return;}
 const {chromium}=await import('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.PRIVATE_WORKSPACE_CHROME,headless:true}),h=createConversationFixture(t,{env:{RELAY_MAKIMA_ENABLED:'true',RELAY_MAKIMA_CLIENT_ID:'c'.repeat(64),RELAY_MAKIMA_GITHUB_CLIENT_ID:'synthetic-makima-github',RELAY_MAKIMA_GITHUB_CLIENT_SECRET:'synthetic-makima-upstream-secret'}}),pages=[];
 try{
  const owner=await h.pair(await h.oauth());
  const initial=await h.phone('/makima',{id:crypto.randomUUID(),body:'Can you review the Jarvis plan?'},owner.device_token);assert.equal(initial.status,200);
  const obj=h.fixture.object(MAKIMA_OBJECT),reply=crypto.randomUUID();
  obj.db.prepare('INSERT INTO makima_messages(id,sender,body,reply_to,created_at) VALUES(?,?,?,?,?)').run(reply,'makima','Yes. Share the next change here and I’ll review it.',null,new Date().toISOString());
  obj.db.prepare('INSERT INTO makima_message_provenance(message_id,principal,authentication_source) VALUES(?,?,?)').run(reply,'agent:makima','makima-oauth-mcp');
  await h.phone('/messages',{id:crypto.randomUUID(),body:'LUCY PRIVATE FIXTURE MUST STAY SEPARATE'},owner.device_token);
  const phone=await openConversationPage(browser,h,{owner,clock:false,...(process.env.PRIVATE_WORKSPACE_ROOT?{root:process.env.PRIVATE_WORKSPACE_ROOT}:{})});pages.push(phone);const p=phone.page;
  await p.setViewportSize({width:390,height:844});await p.goto(SITE+'/private/');await chooseView(p,'makima');
  await p.getByText('Yes. Share the next change here and I’ll review it.',{exact:true}).waitFor();
  assert.equal(await p.getByText('LUCY PRIVATE FIXTURE MUST STAY SEPARATE',{exact:true}).count(),0);assert.equal(await p.getByText('Makima will join later',{exact:true}).count(),0);
  await p.locator('#makima-message').fill('Please check the navigation changes.');await p.locator('.makima-composer button[type=submit]').click();await p.getByText('Please check the navigation changes.',{exact:true}).waitFor();
  assert.equal(obj.db.prepare('SELECT sender FROM makima_messages WHERE body=?').get('Please check the navigation changes.').sender,'owner');
  await p.locator('#makima-message').fill('Retained private draft');await chooseView(p,'lucy');await chooseView(p,'makima');assert.equal(await p.locator('#makima-message').inputValue(),'Retained private draft');
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const output=process.env.PRIVATE_CHAT_SCREENSHOT_DIR||process.env.PRIVATE_BOARD_EVIDENCE||'/tmp/private-board-evidence';await mkdir(output,{recursive:true});await p.screenshot({path:output+'/makima.png'});
  assertBrowserContained(phone);
 }finally{await closeConversationHarness(browser,h,pages);}
});
