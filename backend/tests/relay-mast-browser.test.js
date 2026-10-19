import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../relay-common.js';

test('Mast phone: closed state, safe uncertain-send retry and chronological private reply',{timeout:60000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const evidence=process.env.MAST_EVIDENCE_DIR||'/tmp/jarvis-mast-evidence';
  const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}}),pages=[];
  try{
    const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);
    const page=phone.page;await page.goto(SITE+'/mast/');await page.locator('#composer:not([hidden])').waitFor();
    phone.rule(record=>record.path==='/relay/owner/mast'&&record.method==='POST',async({forward})=>{await forward();return {abort:true};});
    await page.locator('#message').fill('Synthetic hello Mast');await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByRole('button',{name:'Retry',exact:true}).waitFor();assert.equal(await page.locator('#message').inputValue(),'Synthetic hello Mast');
    await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.outgoing').waitFor();
    assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,1);
    const id=h.rows('SELECT id FROM relay_mast_entries')[0].id;
    await h.fixture.request('/relay/mast/messages',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({id:crypto.randomUUID(),reply_to:id,body:'Synthetic Mast reply — only this conversation.'})});
    await page.locator('#refresh').evaluate(button=>button.click());await page.getByText('Synthetic Mast reply — only this conversation.',{exact:true}).waitFor();
    assert.deepEqual(await page.locator('.message-author').allTextContents(),['You','Mast']);
    await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/phone-390.png'});
    await page.setViewportSize({width:390,height:520});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const box=await page.locator('#message').boundingBox();assert.ok(box.y+box.height<=520);
    await assertNoPrivatePersistence(page,['Synthetic hello Mast','Synthetic Mast reply']);assertBrowserContained(phone);
    assert.ok(phone.records.every(r=>!r.path.startsWith('/shared/')&&!r.path.startsWith('/v1/')));
  }finally{await closeConversationHarness(browser,h,pages);}
  const closed=createConversationFixture(t),closedPages=[];const secondBrowser=await launchQualifiedBrowser(t);
  try{
    const owner=await closed.pair(await closed.oauth()),phone=await openConversationPage(secondBrowser,closed,{owner,clock:false});closedPages.push(phone);
    await phone.page.goto(SITE+'/mast/');await phone.page.getByText('Muse adapter is not connected. Secure setup is still required.',{exact:true}).waitFor();assert.ok(await phone.page.locator('#composer').isHidden());
    await phone.page.screenshot({path:evidence+'/inactive-390.png'});assertBrowserContained(phone);
  }finally{await closeConversationHarness(secondBrowser,closed,closedPages);}
});
