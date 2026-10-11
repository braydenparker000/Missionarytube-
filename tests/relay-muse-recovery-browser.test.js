import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';
test('Muse reload recovery, incremental history, rich text, search and phone reading position',{timeout:60000},async t=>{
  const evidence=(process.env.JARVIS_SCREENSHOT_DIR||'/tmp')+'/muse-parity';
  const browser=await launchQualifiedBrowser(t);if(!browser)return;const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}}),pages=[];
  try{
    const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;
    await page.goto(SITE+'/mast/');await page.locator('#composer:not([hidden])').waitFor();assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');
    await page.locator('#message').fill('Retained unsent synthetic draft');await page.reload();await page.waitForFunction(()=>document.querySelector('#message').value==='Retained unsent synthetic draft');
    phone.rule(r=>r.path==='/relay/owner/mast'&&r.method==='POST',async({forward})=>{await forward();return {abort:true};});
    await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
    await page.reload();await page.locator('.outgoing').waitFor();assert.equal(await page.locator('#message').inputValue(),'');
    assert.equal(phone.records.filter(r=>r.path==='/relay/owner/mast'&&r.method==='POST').length,1,'reload reconciles accepted send without resubmitting');
    const id=h.rows('SELECT id FROM relay_mast_entries')[0].id;
    await h.fixture.request('/relay/mast/messages',{headers:{Authorization:'Bearer '+token}});
    await h.fixture.request('/relay/mast/reply',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({id:crypto.randomUUID(),reply_to:id,body:'**Synthetic response**\n\n- Safe formatting\n- Private files\n\n```js\nconst example = 1;\n```\n<script>window.bad=true</script>'})});
    await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.bubble strong').waitFor();assert.equal(await page.evaluate(()=>window.bad),undefined);
    assert.ok(phone.records.some(r=>r.method==='GET'&&r.url.includes('/relay/owner/mast?after=1')),'incremental cursor advances only through fetched history');
    await page.locator('#search').fill('no such fixture');assert.equal(await page.locator('.message-row').count(),0);await page.locator('#search').fill('');assert.equal(await page.locator('.message-row').count(),2);
    for(let i=0;i<12;i++)await h.phone('/mast',{id:crypto.randomUUID(),body:'Synthetic history '+i},owner.device_token);
    await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Synthetic history 11',{exact:true}).waitFor();
    await page.locator('#messages').evaluate(x=>x.scrollTop=20);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.ok(Math.abs(await page.locator('#messages').evaluate(x=>x.scrollTop)-20)<3);
    await page.setViewportSize({width:320,height:520});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.locator('#send').boundingBox();assert.ok(box.y+box.height<=520);
    await page.setViewportSize({width:390,height:844});await page.locator('#messages').evaluate(x=>x.scrollTop=0);
    await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/private-phone.png'});
    await page.setViewportSize({width:1280,height:850});await page.screenshot({path:evidence+'/private-desktop.png'});
    // Corrupt pending storage is a visible stop, never a new message identity.
    await page.evaluate(()=>sessionStorage.setItem('jarvis.mast.draft.v1','invalid'));await page.reload();await page.getByText(/Cannot retain the private draft/).waitFor();
    await page.locator('#message').fill('Must not be sent');const count=h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n;await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,count);
    h.rows('UPDATE relay_owner_sessions SET revoked_ms=1 WHERE device_id=?',owner.device.id);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#login:not([hidden])').waitFor();assert.equal(await page.locator('.message-row').count(),0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('jarvis.mast.draft.v1')),null);
    const privateReads=phone.records.filter(r=>r.path.startsWith('/relay/owner/')).length;
    await page.setViewportSize({width:390,height:844});await page.goto(SITE+'/muse/');await page.locator('body.muse-page').waitFor();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)');
    assert.match(await page.locator('#conversation-visibility').innerText(),/Public/);
    assert.equal(phone.records.filter(r=>r.path.startsWith('/relay/owner/')).length,privateReads,'public Muse never loads private history');
    await page.screenshot({path:evidence+'/public-phone.png'});
    assertBrowserContained(phone);
  }finally{await closeConversationHarness(browser,h,pages);}
});
