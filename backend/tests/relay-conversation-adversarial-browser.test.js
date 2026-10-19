import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness,
  conversationMenu, assertBrowserContained, assertNoPrivatePersistence, writeSyntheticEvidence,
  SITE, RELAY_URL, MUSE_URL, OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../relay-common.js';
import {RELAY_OWNER_EVENT} from '../relay-common.js';
import {relaySubscribe, drainRelayOutbox} from '../relay-events.js';
import {MUSE_PREFIX} from '../../frontend/assets/channels.js';

async function journey(t) {
  const browser = await launchQualifiedBrowser(t);
  if (!browser) return null;
  const h = createConversationFixture(t), pages = [];
  t.after(() => closeConversationHarness(browser, h, pages));
  const oauth = await h.oauth(), owner = await h.pair(oauth);
  const open = async options => { const phone = await openConversationPage(browser, h, options); pages.push(phone); return phone; };
  return {h, oauth, owner, open};
}
const ownerInput = page => page.locator('#relay-owner-message-text');
const publicInput = page => page.locator('#message-text');
const sentMessages = phone => phone.records.filter(record => record.method === 'POST' && record.path === '/relay/owner/messages');
const publicWrites = phone => phone.records.filter(record => record.method === 'POST' && ['/shared/messages', '/v1/messages'].includes(record.path));
async function assertPrivateInvisible(page, texts) {
  const rendered = await page.evaluate(() => ({text: document.body.innerText, inputs: [...document.querySelectorAll('textarea,input')].map(input => input.value)}));
  for (const value of texts) assert.equal(JSON.stringify(rendered).includes(value), false, 'Private content must not remain in the visible channel');
}
async function savedMessage(h, owner, body) {
  const response = await h.phone('/messages', {id: crypto.randomUUID(), body}, owner.device_token);
  assert.equal(response.status, 201);
  return (await response.json()).entry;
}

test('private switches and late responses never fill public or Muse; expiry clears history/access and keeps the tab draft', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const privateBody = 'SYNTHETIC-PRIVATE-SWITCH-7261', privateReply = 'SYNTHETIC-PRIVATE-REPLY-3844', privateDraft = 'SYNTHETIC-PRIVATE-DRAFT-8916';
  const publicDraft = 'Public draft remains independent', museDraft = 'Muse draft remains independent';
  const entry = await savedMessage(h, owner, privateBody);
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: entry.id, body: privateReply});
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL);
  await ownerInput(page).waitFor();
  await page.getByText(privateReply, {exact: true}).waitFor();
  await ownerInput(page).fill(privateDraft);
  const slowRead = phone.hold(record => record.path === '/relay/owner/messages' && record.method === 'GET');
  await conversationMenu(page, 'Refresh private inbox');
  await slowRead.entered;
  await conversationMenu(page, 'Public chat');
  await publicInput(page).waitFor();
  await publicInput(page).fill(publicDraft);
  await assertPrivateInvisible(page, [privateBody, privateReply, privateDraft]);
  slowRead.release();
  await page.waitForFunction(() => !!document.getElementById('message-text'));
  await assertPrivateInvisible(page, [privateBody, privateReply, privateDraft]);
  await conversationMenu(page, 'Owner chat');
  await ownerInput(page).waitFor();
  assert.equal(await ownerInput(page).inputValue(), privateDraft, 'Private draft survives an in-page switch');
  await conversationMenu(page, 'Public chat');
  assert.equal(await publicInput(page).inputValue(), publicDraft);
  await page.goto(MUSE_URL);
  await page.locator('#prompt').waitFor();
  await page.locator('#prompt').fill(museDraft);
  await assertPrivateInvisible(page, [privateBody, privateReply, privateDraft]);
  await assertNoPrivatePersistence(page, [privateBody, privateReply, privateDraft], {draft:privateDraft});
  await page.reload();
  await page.locator('#prompt').waitFor();
  assert.equal(await page.locator('#prompt').inputValue(), museDraft);
  await page.goBack();
  await publicInput(page).waitFor();
  assert.equal(await publicInput(page).inputValue(), publicDraft);
  await conversationMenu(page, 'Owner chat');
  await ownerInput(page).waitFor();
  assert.equal(await ownerInput(page).inputValue(), privateDraft, 'Private draft is recovered only from this tab');
  await ownerInput(page).fill(privateDraft);
  h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?', Date.now() - 1, owner.device.id);
  await conversationMenu(page, 'Refresh private inbox');
  await page.waitForFunction(key => localStorage.getItem(key) === null, OWNER_KEY);
  assert.equal(await ownerInput(page).count(), 0, 'Expired access removes the private composer');
  await assertPrivateInvisible(page, [privateBody, privateReply, privateDraft]);
  await assertNoPrivatePersistence(page, [privateBody, privateReply, privateDraft], {draft:privateDraft});
  assert.deepEqual(publicWrites(phone), [], 'Failed private authorization must never invoke the public send adapter');
  await page.reload();
  await page.locator('#relay-menu-button').waitFor();
  assert.equal(await ownerInput(page).count(), 0);
  assert.equal(await publicInput(page).count(), 0, 'Reload after owner expiry stays in private sign-in-required scope');
  assert.match(await page.locator('#conversation-visibility').textContent(), /private|owner/i);
  await assertPrivateInvisible(page, [privateBody, privateReply, privateDraft]);
  await conversationMenu(page, 'Public chat');
  await publicInput(page).waitFor();
  assert.equal(await publicInput(page).inputValue(), publicDraft);
  const publicState = await (await h.fixture.request('/shared/state', {headers: {Origin: SITE}})).text();
  for (const value of [privateBody, privateReply, privateDraft]) assert.equal(publicState.includes(value), false);
  assertBrowserContained(phone);
});


test('simple task detail preserves immutable results and displays unknown execution without management controls',{timeout:120000},async t=>{
 const j=await journey(t);if(!j)return;const {h,oauth,owner,open}=j;
 const message=await savedMessage(h,owner,'Synthetic private task: prepare a draft.');const rpc=(name,args)=>h.rpc(oauth,name,{inbox_id:RELAY_OWNER_INBOX,...args});
 await rpc('relay_owner_job_plan',{job_id:message.id,event_id:crypto.randomUUID(),expected_revision:0,title:'Synthetic draft task',goal:'Prepare an inert draft',plan:['Read the request','Write a draft']});
 const run=crypto.randomUUID();await rpc('relay_owner_job_claim',{job_id:message.id,run_id:run,event_id:crypto.randomUUID()});
 h.rows('UPDATE relay_owner_jobs SET lease_expires_ms=1 WHERE id=?',message.id);
 const phone=await open({owner,clock:false}),page=phone.page;await page.goto(RELAY_URL);await page.locator('#relay-owner-inspect-'+message.id).click();const detail=page.locator('#relay-owner-request-dialog');await detail.locator('#relay-owner-request-refresh:not([disabled])').waitFor();assert.equal(await detail.locator('.request-state').innerText(),'Status unknown');
 assert.equal(await detail.locator('input,select,details').count(),0);assert.equal(await detail.getByRole('button',{name:'Try again',exact:true}).count(),0);assert.equal(await detail.getByRole('button',{name:'Request stop',exact:true}).count(),0);
 const result='Synthetic immutable draft with https://example.test/source';const reply=await rpc('relay_owner_reply',{message_id:message.id,body:result});await rpc('relay_owner_job_update',{job_id:message.id,run_id:run,event_id:crypto.randomUUID(),stage:'completed',outcome:'known',summary:'Synthetic draft checked.',expected_reply_id:reply.entry.id,expected_version:1});
 await rpc('relay_owner_job_result_correct',{job_id:message.id,event_id:crypto.randomUUID(),expected_reply_id:reply.entry.id,expected_version:1,body:'Synthetic corrected draft <script>alert(1)</script>',correction_summary:'Checked the wording.'});
 await detail.getByRole('button',{name:'Refresh',exact:true}).click();await detail.locator('#relay-owner-result-latest[data-result-version="2"]').waitFor();assert.equal(await detail.locator('script,iframe,object').count(),0);assert.equal(await detail.locator('#relay-owner-completion').getAttribute('data-result-version'),'1');assert.match(await detail.innerText(),/latest correction has not been confirmed complete/);
 await detail.getByRole('button',{name:'View conversation',exact:true}).click();await detail.waitFor({state:'detached'});await page.locator('.messages').getByText(result,{exact:true}).waitFor();assert.equal(h.rows("SELECT body FROM relay_owner_entries WHERE id=?",reply.entry.id)[0].body,result);assertBrowserContained(phone);await assertNoPrivatePersistence(page,[result,'Synthetic corrected draft']);
});
