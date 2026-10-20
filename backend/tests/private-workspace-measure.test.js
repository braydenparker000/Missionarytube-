import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {createConversationFixture,openConversationPage,closeConversationHarness,SITE} from './helpers/relay-conversation-browser-fixture.js';
test('mobile conversation occupies at least 72 percent of available screen',{timeout:60000},async t=>{
 if(!process.env.PRIVATE_WORKSPACE_CHROME){t.skip('Set PRIVATE_WORKSPACE_CHROME');return;}
 const b=await chromium.launch({executablePath:process.env.PRIVATE_WORKSPACE_CHROME,headless:true}),h=createConversationFixture(t),pages=[];await mkdir('/tmp/private-acceptance',{recursive:true});const metrics=[];
 try{const owner=await h.pair(await h.oauth());await h.phone('/messages',{id:crypto.randomUUID(),body:'Synthetic conversation: the chat should occupy most of the screen. This is a local fixture.'},owner.device_token);
 for(const [width,height]of [[360,640],[360,780],[384,824],[412,915]]){const phone=await openConversationPage(b,h,{width,height,owner,clock:false,root:process.env.PRIVATE_WORKSPACE_ROOT||new URL('../../frontend',import.meta.url).pathname});pages.push(phone);await phone.page.goto(SITE+'/private/');const f=phone.page.frameLocator('iframe');await f.locator('#relay-owner-message-text').waitFor();await phone.page.screenshot({path:`/tmp/private-acceptance/${process.env.MEASURE_LABEL||'before'}-${width}x${height}.png`});metrics.push({width,height,outer:await phone.page.locator('body').evaluate(()=>Object.fromEntries(['.workspace-header','#view-body','#workspace-status'].map(s=>[s,document.querySelector(s).getBoundingClientRect().toJSON()]))),inner:await f.locator('body').evaluate(()=>Object.fromEntries(['.private-tools','#content','.messages','.composer'].map(s=>[s,document.querySelector(s)?.getBoundingClientRect().toJSON()]))) });}
 for(const m of metrics){assert.equal(m.inner['.messages'].width,m.width);assert.ok(m.inner['.messages'].height>=m.height*.72);assert.equal(m.outer['#view-body'].bottom,m.height);}
 await writeFile(`/tmp/private-acceptance/${process.env.MEASURE_LABEL||'before'}-metrics.json`,JSON.stringify(metrics,null,2));console.log(metrics.map(m=>({viewport:[m.width,m.height],messages:[m.inner['.messages'].width,m.inner['.messages'].height]})));
 }finally{await closeConversationHarness(b,h,pages);}
});
