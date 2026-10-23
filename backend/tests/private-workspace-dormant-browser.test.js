import {chooseView,openNavigation} from './helpers/private-workspace-navigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createConversationFixture,openConversationPage,closeConversationHarness,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../relay-common.js';
// The default workspace hides the dormant agents (frontend/assets/private-dormant-agents.js): Mast is the chat, Lucy and Makima appear nowhere.
test('the default workspace opens Mast and shows no dormant agent',{timeout:60000},async t=>{
 if(!process.env.PRIVATE_WORKSPACE_CHROME){t.skip('Set PRIVATE_WORKSPACE_CHROME for local browser smoke');return;}
 const browser=await chromium.launch({executablePath:process.env.PRIVATE_WORKSPACE_CHROME,headless:true});
 const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_WORK_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}}),pages=[];
 try{const owner=await h.pair(await h.oauth()),id=crypto.randomUUID();await h.phone('/mast',{id,body:'Mast original history'},owner.device_token);
 await h.fixture.request('/relay/mast/work/plan',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({job_id:id,event_id:crypto.randomUUID(),title:'Mast saved task',goal:'Preserve identity',plan:['Read'],expected_revision:0})});
 const phone=await openConversationPage(browser,h,{owner,clock:false,showDormant:false,...(process.env.PRIVATE_WORKSPACE_ROOT?{root:process.env.PRIVATE_WORKSPACE_ROOT}:{})});pages.push(phone);const page=phone.page;
 await page.goto(SITE+'/private/');await page.waitForFunction(()=>document.body.dataset.view==='mast');
 const mast=page.frameLocator('iframe[title="Private conversation with Mast"]');await mast.getByText('Mast original history',{exact:true}).waitFor();
 assert.equal(await page.locator('iframe[title="Private conversation with Lucy"]').count(),0);
 assert.deepEqual(await page.locator('#agent-panel [data-agent]').evaluateAll(b=>b.map(e=>e.dataset.agent)),['board','mast']);
 assert.equal(await page.locator('#agent-panel [data-agent="board"] small').textContent(),'You & Mast');
 assert.deepEqual(await page.locator('#destinations a').evaluateAll(a=>a.map(e=>e.dataset.view)),['mast','tasks','board']);
 assert.equal(await page.locator('#destinations [data-view="board"] small').textContent(),'You + 1');
 assert.equal(await page.locator('[data-chat-action="disconnect"]').count(),0);
 assert.deepEqual(await page.locator('.avatar-setting .avatar-label').evaluateAll(l=>l.map(e=>e.textContent)),['You','Mast']);
 assert.equal(await page.locator('body').evaluate(b=>/Lucy|Makima|ChatGPT/.test(b.innerText)),false,'no dormant agent named on the page');
 // Old links to the dormant views open Mast.
 for(const view of ['lucy','makima','collaboration']){await page.evaluate(v=>{location.hash=v;},view);await page.waitForFunction(()=>location.hash==='#mast'&&document.body.dataset.view==='mast');}
 await openNavigation(page);await page.locator('#destinations [data-view="tasks"]').click();await page.locator('#navigation-drawer').waitFor({state:'hidden'});
 await page.getByText('Mast saved task',{exact:true}).waitFor();
 assert.deepEqual(await page.locator('.task-source').evaluateAll(s=>s.map(e=>e.dataset.agent)),['mast']);
 assert.equal(await page.locator('#workspace-status').textContent(),'This view shows Mast private tasks.');
 await chooseView(page,'board');assert.equal(await page.locator('#view-title').textContent(),'Group chat');
 }finally{await closeConversationHarness(browser,h,pages);}
});
