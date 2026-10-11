import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';
test('Muse Work phone preserves unconfirmed request identity and displays version-bound completion',{timeout:60000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}}),pages=[];
 try{
  const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;
  await page.goto(SITE+'/mast/');await page.locator('#composer:not([hidden])').waitFor();await page.getByRole('button',{name:'Work',exact:true}).click();await page.getByText('New request',{exact:true}).click();
  await page.locator('#work-form [name=title]').fill('Synthetic Muse request');await page.locator('#work-form [name=body]').fill('Prepare a draft without publishing.');await page.locator('#work-form [name=action_kind]').selectOption('draft');
  phone.rule(r=>r.path==='/relay/owner/mast/work'&&r.method==='POST',async({forward})=>{await forward();return {abort:true};});
  await page.getByRole('button',{name:'Create request',exact:true}).click();await page.getByRole('button',{name:'Retry unconfirmed create',exact:true}).waitFor();await page.reload();await page.locator('#composer:not([hidden])').waitFor();await page.getByRole('button',{name:'Work',exact:true}).click();await page.getByRole('button',{name:'Retry unconfirmed create',exact:true}).click();await page.getByRole('heading',{name:'Synthetic Muse request'}).waitFor();
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_work')[0].n,1);const posts=phone.records.filter(r=>r.path==='/relay/owner/mast/work'&&r.method==='POST');assert.equal(posts[0].body,posts[1].body);
  const job=h.rows('SELECT id FROM relay_mast_work')[0].id,run=crypto.randomUUID(),reply=crypto.randomUUID();const adapter=(path,body)=>h.fixture.request('/relay/mast/'+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
  await adapter('work/claim',{job_id:job,event_id:crypto.randomUUID(),run_id:run});await adapter('reply',{id:reply,reply_to:job,body:'**Synthetic draft v1**'});
  await adapter('work/update',{job_id:job,event_id:crypto.randomUUID(),run_id:run,stage:'completed',outcome:'known',summary:'Draft prepared only',expected_reply_id:reply,expected_version:1});
  await adapter('work/correct',{job_id:job,event_id:crypto.randomUUID(),expected_reply_id:reply,expected_version:1,body:'**Synthetic draft v2**',correction_summary:'Corrected wording'});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.mast-work-row>section strong').waitFor();await page.getByText(/latest correction is not covered/).waitFor();
  await page.getByText('Original result and correction history',{exact:true}).click();await page.locator('#work-list').getByText('Synthetic draft v1',{exact:true}).waitFor();
  await page.setViewportSize({width:320,height:520});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:390,height:844});const evidence=(process.env.JARVIS_SCREENSHOT_DIR||'/tmp')+'/muse-parity';await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/work-phone.png'});
  h.rows('UPDATE relay_owner_sessions SET revoked_ms=1 WHERE device_id=?',owner.device.id);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('#login:not([hidden])').waitFor();assert.equal(await page.locator('.mast-work-row').count(),0);assertBrowserContained(phone);
 }finally{await closeConversationHarness(browser,h,pages);}
});
