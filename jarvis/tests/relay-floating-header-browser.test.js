import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,conversationMenu,closeConversationHarness,assertBrowserContained,writeSyntheticEvidence,RELAY_URL} from './helpers/relay-conversation-browser-fixture.js';

test('Relay chat icons float over unfiltered scroll content on mobile and desktop while controls remain usable',{timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[],observations=[];
  try{
    const auth=await h.oauth(),owner=await h.pair(auth);
    for(let i=0;i<18;i++)assert.equal((await h.phone('/messages',{id:crypto.randomUUID(),body:'Fictional conversation '+i+': compare the garden paths and keep the original reading position.'},owner.device_token)).status,201);
    for(const size of [{width:390,height:844},{width:1280,height:900}]){
      const phone=await openConversationPage(browser,h,{owner,clock:false,...size});pages.push(phone);const page=phone.page;
      await page.goto(RELAY_URL);await page.locator('.message-row').first().waitFor();const messages=page.locator('.relay-owner-chat .messages');
      for(const [state,scroll] of [['top',0],['scrolled',350]]){
        await messages.evaluate((node,value)=>node.scrollTop=value,scroll);
        const style=await page.locator('.topbar').evaluate(node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,image:s.backgroundImage,blur:s.backdropFilter,filter:s.filter,pointerEvents:s.pointerEvents};});
        const controls=await page.locator('.relay-floating-control').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,color:s.color,background:s.backgroundColor,pointerEvents:s.pointerEvents};}));
        observations.push({size,state,style,controls});await writeSyntheticEvidence(phone,'floating-header-'+size.width+'-'+state,{style,controls});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await messages.evaluate(n=>n.scrollTop),scroll);
        for(const c of controls){assert.ok(c.width>=48&&c.height>=48&&c.x>=0&&c.y>=0&&c.x+c.width<=size.width);assert.equal(c.color,'rgb(247, 247, 247)');assert.equal(c.background,'rgba(48, 48, 48, 0.91)');assert.equal(c.pointerEvents,'auto');}
      }
      await page.locator('#relay-menu-button').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
      await conversationMenu(page,'Requests');assert.equal(await page.locator('.topbar').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(0, 0, 0)');
      await page.getByRole('button',{name:'Back to chat',exact:true}).click();assert.equal(await messages.evaluate(n=>n.scrollTop),350);
      await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();observations.push({style:await page.locator('.topbar').evaluate(n=>{const s=getComputedStyle(n);return {background:s.backgroundColor,image:s.backgroundImage,blur:s.backdropFilter,filter:s.filter,pointerEvents:s.pointerEvents};})});
      assert.equal(await page.locator('#relay-scope-toggle').count(),0);
      for(const selector of ['.relay-identity-mark'])assert.equal(await page.locator(selector).evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(48, 48, 48)');
      assertBrowserContained(phone);
    }
    for(const {style} of observations){assert.equal(style.image,'none');assert.equal(style.background,'rgba(0, 0, 0, 0)');assert.equal(style.blur,'none');assert.equal(style.filter,'none');assert.equal(style.pointerEvents,'none');}
  }finally{await closeConversationHarness(browser,h,pages);}
});
