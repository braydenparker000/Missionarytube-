import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness,
  conversationMenu, assertBrowserContained, assertNoPrivatePersistence, writeSyntheticEvidence,
  SITE, RELAY_URL, MUSE_URL, OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';
import {RELAY_OWNER_EVENT} from '../backend/relay-common.js';
import {relaySubscribe, drainRelayOutbox} from '../backend/relay-events.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

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

async function subscribeSynthetic(h, oauth, receiver) {
  await relaySubscribe(h.ctx, oauth, {name: RELAY_OWNER_EVENT, arguments: {inbox_id: RELAY_OWNER_INBOX},
    delivery: {mode: 'webhook', url: 'https://synthetic-browser-receiver.example/callback', secret: 'whsec_' + Buffer.alloc(32, 23).toString('base64')}, cursor: 'relay1:0'}, h.fixture.env, receiver);
}
const jobDialog = page => page.locator('#relay-owner-request-dialog');
async function waitRequestReady(page) {
  await page.waitForFunction(() => { const refresh = document.getElementById('relay-owner-request-refresh'); return refresh && !refresh.disabled; });
}
async function inspectRequest(page, id) {
  await page.locator(`[data-job-id="${id}"]`).getByRole('button', {name: 'Inspect request', exact: true}).click();
  await jobDialog(page).waitFor();
  await waitRequestReady(page);
  await jobDialog(page).locator('#relay-owner-request-properties>summary').click();
}
async function refreshRequest(page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs/detail' && response.request().method() === 'GET');
  await jobDialog(page).getByRole('button', {name: 'Refresh task', exact: true}).click();
  await response; await waitRequestReady(page);
}

test('a legacy saved reply stays visible without claiming that blocked work completed', {timeout: 90000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const request = 'Fictional owner request for a report; do not infer completion from a reply.';
  const body = 'Fictional blocker: I need the source file before continuing.';
  const message = await savedMessage(h, owner, request);
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: message.id, body});
  const phone = await open({owner, width: 390, height: 844}), {page} = phone;
  phone.rule(record => record.method === 'GET' && ['/relay/owner/jobs', '/relay/owner/jobs/detail'].includes(record.path), async ({forward}) => {
    const response = await forward(), data = await response.json();
    for (const job of data.jobs || [data.job]) if (job?.result) {
      delete job.completion; job.stage = 'completed'; job.finishedAt = job.result.createdAt; job.failure = null;
    }
    return Response.json(data, {status: response.status, headers: response.headers});
  }, 20);
  await page.goto(RELAY_URL); await ownerInput(page).waitFor();
  await page.locator('.relay-owner-chat .messages').getByText(body, {exact: true}).waitFor();
  await inspectRequest(page, message.id);
  await writeSyntheticEvidence(phone, 'owner-reply-completion-unverified-390x844', {legacyServer: true, immutableReplyPreserved: true});
  assert.equal(await jobDialog(page).locator('.request-state').textContent(), 'Finish not confirmed');
  assert.equal(await jobDialog(page).getByRole('heading', {name: 'Output', exact: true}).count(), 1);
  assert.equal(await jobDialog(page).locator('#relay-owner-result-latest').textContent(), body);
  assert.equal(await jobDialog(page).getByRole('button', {name: 'Try again', exact: true}).count(), 0);
  assert.equal(await jobDialog(page).getByText('Finished', {exact: true}).count(), 0);
  await assertNoPrivatePersistence(page, [request, body]); assert.deepEqual(publicWrites(phone), []); assertBrowserContained(phone);
});

test('typed completion is a distinct inert authenticated report tied to an immutable private reply', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const request = 'Fictional request to prepare an inspection report.', original = 'Fictional available inspection report with source notes.';
  const message = await savedMessage(h, owner, request), runId = crypto.randomUUID();
  await h.rpc(oauth, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: message.id, run_id: runId, event_id: crypto.randomUUID()});
  const accepted = await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: message.id, body: original});
  const phone = await open({owner, width: 390, height: 844}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor(); await inspectRequest(page, message.id);
  assert.equal(await jobDialog(page).locator('.request-state').textContent(), 'Finish not confirmed');
  assert.equal(await jobDialog(page).locator('#relay-owner-completion').count(), 0);
  const summary = 'Fictional attestation: the report preparation is complete. <img id="fictional-completion-xss" src=x onerror="window.__completionUnsafe=1"> [inert link](javascript:window.__completionUnsafe=2)';
  await h.rpc(oauth, 'relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: message.id, run_id: runId, event_id: crypto.randomUUID(),
    stage: 'completed', outcome: 'known', expected_reply_id: accepted.entry.id, expected_version: 1, summary});
  await refreshRequest(page);
  assert.equal(await jobDialog(page).locator('.request-state').textContent(), 'Finished');
  assert.equal(await jobDialog(page).locator('#relay-owner-completion-summary').textContent(), summary);
  assert.equal(await jobDialog(page).locator('#relay-owner-completion').getAttribute('data-result-version'), '1');
  assert.equal(await jobDialog(page).locator('#relay-owner-result-latest').textContent(), original);
  assert.equal(await jobDialog(page).locator('#fictional-completion-xss,script,iframe,a[href^="javascript:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__completionUnsafe), undefined);
  assert.match(await jobDialog(page).locator('#relay-owner-request-properties').textContent(), /does not certify factual claims or external outcomes/);
  assert.equal(await jobDialog(page).getByRole('button', {name: 'Try again', exact: true}).count(), 0);
  assert.equal(await jobDialog(page).getByRole('button', {name: 'Request stop', exact: true}).count(), 0);
  await jobDialog(page).evaluate(dialog => {dialog.scrollTop = 0;});
  await writeSyntheticEvidence(phone, 'owner-work-reported-complete-390x844', {typedCompletion: true, resultVersion: 1, immutableReplyPreserved: true});
  await h.rpc(oauth, 'relay_owner_job_result_correct', {inbox_id: RELAY_OWNER_INBOX, job_id: message.id, event_id: crypto.randomUUID(),
    expected_reply_id: accepted.entry.id, expected_version: 1, body: 'Fictional corrected inspection report after the version-one attestation.', correction_summary: 'Checked the fictional source and corrected one note.'});
  await refreshRequest(page);
  assert.equal(await jobDialog(page).locator('.request-state').textContent(), 'Finished');
  assert.equal(await jobDialog(page).locator('#relay-owner-completion').getAttribute('data-result-version'), '1');
  assert.equal(await jobDialog(page).locator('#relay-owner-result-latest').getAttribute('data-result-version'), '2');
  assert.equal(await page.locator('.relay-owner-chat .messages').getByText(original, {exact: true}).count(), 1);
  await page.setViewportSize({width: 390, height: 520});
  await jobDialog(page).evaluate(dialog => {dialog.scrollTop = 0;});
  const geometry = await jobDialog(page).evaluate(dialog => {
    const rect = dialog.getBoundingClientRect(), close = dialog.querySelector('[aria-label="Back from task"]').getBoundingClientRect();
    return {width: rect.width, height: rect.height, top: rect.top, scrollable: dialog.scrollHeight > dialog.clientHeight, closeWidth: close.width, closeHeight: close.height, overflow: document.documentElement.scrollWidth > innerWidth};
  });
  assert.equal(geometry.overflow, false); assert.ok(geometry.width <= 390 && geometry.height <= 520 && geometry.top >= 0);
  assert.equal(geometry.scrollable, true); assert.ok(geometry.closeWidth >= 48 && geometry.closeHeight >= 48);
  await writeSyntheticEvidence(phone, 'owner-work-reported-complete-390x520', {typedCompletion: true, geometry, completionVersion: 1, availableReplyVersion: 2});
  await assertNoPrivatePersistence(page, [request, original, summary]); assert.deepEqual(publicWrites(phone), []);
  assert.equal(phone.records.some(record => record.method === 'POST' && /(?:job_update|completion)/.test(record.path)), false, 'The browser never writes completion evidence');
  assertBrowserContained(phone);
});

test('private request UI distinguishes saving, callback receipt, execution, requested cancellation and a linked new attempt', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const receiver = async (_url, init) => { const value = JSON.parse(init.body); return value.type === 'verification' ? Response.json({challenge: value.challenge}) : new Response(null, {status: 204}); };
  await subscribeSynthetic(h, oauth, receiver);
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor();
  await conversationMenu(page,'Requests');await page.locator('#relay-owner-new-task').click();
  await page.locator('#relay-owner-job-title').fill('Fictional comparison request');
  await page.locator('#relay-owner-job-kind').selectOption('read_only');
  const body = 'PRIVATE-WORK-REQUEST-BROWSER-4461'; await ownerInput(page).fill(body);
  const received = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs' && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Send private request', exact: true}).click();
  const job = (await (await received).json()).job;
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();await page.locator(`[data-job-id="${job.id}"] .job-state`).waitFor();
  assert.match(await page.locator(`[data-job-id="${job.id}"] .job-state`).textContent(), /Queued/);
  await inspectRequest(page, job.id);
  await drainRelayOutbox(h.ctx, h.fixture.env, receiver);
  await refreshRequest(page);
  assert.match(await jobDialog(page).locator('.request-state').textContent(), /Queued/);
  await jobDialog(page).getByText('The callback accepted delivery. This does not confirm execution.', {exact: true}).waitFor();
  assert.equal((await h.rpc(oauth, 'relay_owner_job_read', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id})).job.stage, 'queued');
  const claim = {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID()};
  await h.rpc(oauth, 'relay_owner_job_claim', claim); await refreshRequest(page);
  assert.match(await jobDialog(page).locator('.request-state').textContent(), /Working/);
  await jobDialog(page).getByRole('button', {name: 'Request stop', exact: true}).click();
  await jobDialog(page).getByText('A stop was requested. Confirmation is still pending.', {exact: true}).waitFor();
  assert.match(await jobDialog(page).locator('.request-state').textContent(), /Stopping…/);
  assert.equal((await h.rpc(oauth, 'relay_owner_job_read', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id})).job.stage, 'running');
  await writeSyntheticEvidence(phone, 'current-owner-cancellation-requested-390x844', {jobId: job.id, stage: 'running', cancelRequested: true});
  await h.rpc(oauth, 'relay_owner_job_update', {...claim, event_id: crypto.randomUUID(), stage: 'cancelled', outcome: 'not_started', summary: 'Synthetic assistant acknowledged it stopped before doing work.'});
  await refreshRequest(page);
  assert.match(await jobDialog(page).locator('.request-state').textContent(), /Stopped/);
  const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs/retry' && response.request().method() === 'POST');
  await jobDialog(page).getByRole('button', {name: 'Try again', exact: true}).click();
  const child = (await (await retried).json()).job;
  assert.notEqual(child.id, job.id); assert.equal(child.parentJobId, job.id); assert.equal(child.stage, 'queued');
  await jobDialog(page).getByRole('button', {name: 'View retry attempt', exact: true}).waitFor();
  await jobDialog(page).getByRole('button', {name: 'View retry attempt', exact: true}).click();
  await waitRequestReady(page);
  assert.match(await jobDialog(page).locator('.request-state').textContent(), /Queued/);
  const attack = 'Fictional saved result <img id="result-xss-probe" src=x onerror="window.__jobXss=1">\n[unsafe](javascript:window.__jobXss=2)\n[Credential link](https://synthetic-reader:fictional-pass@safe.invalid/private)\n[safe](https://safe.invalid/result)';
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: child.id, body: attack});
  await refreshRequest(page);
  assert.match(await jobDialog(page).locator('.request-state').textContent(), /Finish not confirmed/);
  await jobDialog(page).locator('#relay-owner-result-latest').getByText(/Fictional saved result/).waitFor();
  assert.equal(await page.locator('#result-xss-probe, #relay-owner-request-dialog script').count(), 0);
  assert.equal(await page.evaluate(() => window.__jobXss), undefined);
  const links = await jobDialog(page).locator('#relay-owner-result-latest a').evaluateAll(nodes => nodes.map(node => ({href: node.href, rel: node.rel})));
  assert.equal(links.length, 1); assert.equal(new URL(links[0].href).protocol, 'https:'); assert.match(links[0].rel, /noopener/);
  assert.match(await jobDialog(page).locator('.rich-body').first().textContent(), /Credential link/);
  assert.equal(await jobDialog(page).locator('a').filter({hasText: 'Credential link'}).count(), 0, 'A synthetic credential-bearing URL stays inert');
  await assertNoPrivatePersistence(page, [body, attack, 'Fictional comparison request']);
  assert.deepEqual(publicWrites(phone), []);
  assertBrowserContained(phone);
});

test('callback recovery and linked work retry are separate browser actions with separate effects', {timeout: 120000}, async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const receiver = async (_url, init) => { const value = JSON.parse(init.body); return value.type === 'verification' ? Response.json({challenge: value.challenge}) : new Response(null, {status: 503}); };
  await subscribeSynthetic(h, oauth, receiver);
  const created = await h.phone('/jobs', {id: crypto.randomUUID(), title: 'Fictional failure with two recovery paths', body: 'PRIVATE-DISTINCT-RECOVERY-1723', action_kind: 'read_only'}, owner.device_token);
  const job = (await created.json()).job;
  const claim = {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID()};
  await h.rpc(oauth, 'relay_owner_job_claim', claim);
  await h.rpc(oauth, 'relay_owner_job_update', {...claim, event_id: crypto.randomUUID(), stage: 'failed', summary: 'Synthetic execution failed before starting.', outcome: 'not_started'});
  for (let attempt = 0; attempt < 6; attempt++) { await drainRelayOutbox(h.ctx, h.fixture.env, receiver); now += 32000; }
  const evidence = await h.rpc(oauth, 'relay_owner_job_read', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id});
  assert.equal(evidence.job.stage, 'failed'); assert.equal(evidence.job.delivery.state, 'delivery_failed'); assert.equal(evidence.job.delivery.retryable, true);
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor(); await inspectRequest(page, job.id);
  const detail = jobDialog(page);
  await detail.getByRole('button', {name: 'Retry delivery', exact: true}).waitFor();
  await detail.getByRole('button', {name: 'Try again', exact: true}).waitFor();
  const callback = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/delivery/retry' && response.request().method() === 'POST');
  await detail.getByRole('button', {name: 'Retry delivery', exact: true}).click(); assert.equal((await callback).ok(), true);
  await detail.getByRole('button', {name: 'Try again', exact: true}).waitFor();
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 1, 'Callback recovery does not create another execution request');
  assert.equal((await h.rpc(oauth, 'relay_owner_job_read', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id})).job.stage, 'failed');
  const retry = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs/retry' && response.request().method() === 'POST');
  await detail.getByRole('button', {name: 'Try again', exact: true}).click(); const child = (await (await retry).json()).job;
  assert.notEqual(child.id, job.id); assert.equal(child.parentJobId, job.id); assert.equal(child.stage, 'queued');
  const callbackRequest = phone.records.find(record => record.path === '/relay/owner/delivery/retry' && record.method === 'POST');
  const workRequest = phone.records.find(record => record.path === '/relay/owner/jobs/retry' && record.method === 'POST');
  assert.deepEqual(JSON.parse(callbackRequest.body), {message_id: job.id});
  assert.deepEqual(JSON.parse(workRequest.body), {job_id: job.id, id: child.id});
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 2);
  assert.deepEqual(publicWrites(phone), []); assertBrowserContained(phone);
});

test('long private result inspector preserves its reading anchor and expanded history during automatic refresh', {timeout: 90000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const body = 'Synthetic long result for reading-position qualification', message = await savedMessage(h, owner, body);
  const result = Array.from({length: 32}, (_, index) => `Fictional result paragraph ${index + 1}. This synthetic text is long enough to test reading without disclosing any private owner content.`).join('\n\n');
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: message.id, body: result});
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor(); await inspectRequest(page, message.id);
  const detail = jobDialog(page);
  const historyTarget = await detail.locator('#relay-owner-request-history>summary').boundingBox();
  assert.ok(historyTarget && historyTarget.width >= 48 && historyTarget.height >= 48, 'Expandable request history has a 48px touch target');
  await detail.locator('#relay-owner-request-history>summary').click();
  await detail.evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight - dialog.clientHeight - 70; });
  const anchor = () => detail.evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    const node = [...dialog.querySelectorAll('.rich-body p,.request-events li')].find(node => {
      const rect = node.getBoundingClientRect(); return rect.height && rect.bottom >= bounds.top + 12;
    });
    return {text: node?.textContent, offset: node ? node.getBoundingClientRect().top - bounds.top : 0, scroll: dialog.scrollTop, historyOpen: dialog.querySelector('#relay-owner-request-history').open};
  });
  const before = await anchor(); assert.ok(before.text); assert.equal(before.historyOpen, true);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs/detail' && response.request().method() === 'GET');
  await page.clock.fastForward(31000); await refreshed;
  await waitRequestReady(page);
  const after = await anchor();
  await writeSyntheticEvidence(phone, 'current-owner-long-result-refresh-390x844', {before, after});
  assert.equal(after.historyOpen, true, 'Refreshing server evidence keeps the owner’s expanded history');
  assert.equal(after.text, before.text, 'Refreshing server evidence retains the visible result/history reading anchor');
  assert.ok(Math.abs(after.offset - before.offset) <= 3);
  await assertNoPrivatePersistence(page, [body, result]); assertBrowserContained(phone);
});

test('authenticated private corrections preserve the accepted chat reply, rationale and historical reading position', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const request = 'PRIVATE-CORRECTION-REQUEST-8917', original = 'PRIVATE-ORIGINAL-ACCEPTED-RECEIPT-7524';
  const message = await savedMessage(h, owner, request);
  const accepted = await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: message.id, body: original});
  const phone = await open({owner, width: 390, height: 844}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor();
  const messages = page.locator('.relay-owner-chat .messages');
  await messages.getByText(original, {exact: true}).waitFor();
  assert.equal(await messages.getByText(original, {exact: true}).count(), 1);
  await inspectRequest(page, message.id);
  const detail = jobDialog(page);
  await detail.getByRole('heading', {name: 'Output', exact: true}).waitFor();
  const corrected = Array.from({length: 26}, (_, index) => `Fictional corrected paragraph ${index + 1}. This synthetic follow-up reports a checked interpretation and remains subject to further checking.`).join('\n\n');
  const rationale = 'The initial fictional receipt lacked the result. I checked the synthetic source and added the corrected interpretation.';
  const correction = {inbox_id: RELAY_OWNER_INBOX, job_id: message.id, event_id: crypto.randomUUID(), expected_reply_id: accepted.entry.id,
    expected_version: 1, body: corrected, correction_summary: rationale};
  const appended = await h.rpc(oauth, 'relay_owner_job_result_correct', correction);
  assert.equal(appended.newWrite, true); assert.equal(appended.job.result.body, original);
  const duplicate = await h.rpc(oauth, 'relay_owner_job_result_correct', correction);
  assert.equal(duplicate.newWrite, false); assert.equal(duplicate.acceptedResult.id, appended.acceptedResult.id);
  await refreshRequest(page);
  await detail.getByRole('heading', {name: 'Output', exact: true}).waitFor();
  assert.equal(await detail.locator('#relay-owner-result-latest').getAttribute('data-result-version'), '2');
  assert.equal(await detail.locator('#relay-owner-result-rationale').textContent(), rationale);
  assert.equal(await messages.getByText(original, {exact: true}).count(), 1, 'Appending a result correction never replaces the immutable chat receipt');
  assert.equal(await messages.getByText(/Fictional corrected paragraph/).count(), 0);
  await detail.getByText('A saved owner reply does not establish that the work finished. Authentication identifies the publisher; factual claims may still need checking.', {exact: true}).waitFor();
  await detail.locator('#relay-owner-request-history>summary').click();
  const history = detail.locator('#relay-owner-result-history');
  assert.equal(await history.evaluate(node => node.open), false, 'Older accepted results start in an explicit disclosure');
  const historyTarget = await history.locator('summary').boundingBox();
  assert.ok(historyTarget && historyTarget.width >= 48 && historyTarget.height >= 48);
  await history.locator('summary').click();

  assert.deepEqual(await history.locator('.request-result-version').evaluateAll(nodes => nodes.map(node => node.dataset.resultVersion)), ['1', '2']);
  assert.equal(await history.locator('[data-result-version="1"] .rich-body').textContent(), original);
  const marker = 'Fictional corrected paragraph 20.';
  const reading = align => detail.evaluate((dialog, {marker, align}) => {
    const paragraph = [...dialog.querySelectorAll('#relay-owner-result-history [data-result-version="2"] .rich-body p')].find(node => node.textContent.startsWith(marker));
    if (!paragraph) throw Error('Synthetic correction reading marker missing');
    if (align) dialog.scrollTop += paragraph.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 140;
    return {text: paragraph.textContent, offset: paragraph.getBoundingClientRect().top - dialog.getBoundingClientRect().top,
      resultHistoryOpen: dialog.querySelector('#relay-owner-result-history').open, requestHistoryOpen: dialog.querySelector('#relay-owner-request-history').open};
  }, {marker, align});
  const before = await reading(true);
  const latest = 'Fictional final correction 3. <script>window.__correctionUnsafe=1</script> [Unsafe](javascript:window.__correctionUnsafe=2) [Credential source](https://synthetic-reader:fictional-pass@example.com/private) [Safe source](https://example.com/fictional-source)';
  await h.rpc(oauth, 'relay_owner_job_result_correct', {...correction, event_id: crypto.randomUUID(), expected_version: 2,
    body: latest, correction_summary: 'Checked another synthetic source and corrected the previous interpretation.'});
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs/detail' && response.request().method() === 'GET');
  await page.clock.fastForward(31000); await refreshed; await waitRequestReady(page);
  const after = await reading(false);
  assert.equal(after.text, before.text); assert.ok(Math.abs(after.offset - before.offset) <= 3, 'A newly appended correction keeps the original history paragraph at its reading position');
  assert.equal(after.resultHistoryOpen, true); assert.equal(after.requestHistoryOpen, true);
  assert.equal(await detail.locator('#relay-owner-result-latest').getAttribute('data-result-version'), '3');
  assert.equal(await page.evaluate(() => window.__correctionUnsafe), undefined);
  assert.equal(await detail.locator('script,iframe,img,a[href^="javascript:"],a[href^="data:"]').count(), 0);
  const safe = detail.locator('#relay-owner-result-latest a[href="https://example.com/fictional-source"]');
  assert.match(await safe.getAttribute('rel'), /noopener/);
  assert.match(await detail.locator('#relay-owner-result-latest').textContent(), /Credential source/);
  assert.equal(await detail.locator('a').filter({hasText: 'Credential source'}).count(), 0, 'A corrected result cannot turn credential-bearing text into a link');
  assert.equal(await detail.getByText(/verified (?:result|facts|truth)|fact.checked/i).count(), 0);
  const truth = await h.rpc(oauth, 'relay_owner_job_read', {inbox_id: RELAY_OWNER_INBOX, job_id: message.id});
  assert.equal(truth.job.result.body, original); assert.equal(truth.job.resultVersion, 3); assert.equal(truth.job.stage, 'outcome_unknown');
  assert.equal(truth.job.completion, null, 'Correcting available reply text never attests that the task finished');
  assert.equal(h.rows("SELECT COUNT(*) AS n FROM relay_owner_entries WHERE kind='reply' AND reply_to=?", message.id)[0].n, 1);
  await writeSyntheticEvidence(phone, 'current-owner-authenticated-correction-390x844', {before, after, resultVersion: 3, immutableChatPreserved: true});
  await detail.evaluate(dialog => {dialog.scrollTop = 0;});
  await writeSyntheticEvidence(phone, 'current-owner-authenticated-correction-latest-390x844', {resultVersion: 3, immutableChatPreserved: true});
  await detail.getByRole('button', {name: 'Back from task', exact: true}).click();
  assert.equal(await page.getByText(original, {exact: true}).count(), 1);
  assert.equal(await page.getByText(/Fictional final correction 3/).count(), 0);
  assert.deepEqual(publicWrites(phone), []);
  assert.deepEqual(phone.records.filter(record => record.method === 'POST' && record.path.startsWith('/relay/owner/')), [], 'The correction inspector and its refresh only read authenticated projections');
  await assertNoPrivatePersistence(page, [request, original, corrected, latest, rationale]); assertBrowserContained(phone);
});

test('long active private request keeps its text reading anchor when new lifecycle evidence changes the inspector', {timeout: 90000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const body = Array.from({length: 30}, (_, index) => `Fictional request section ${index + 1}. Please review this synthetic content before preparing a report. No external action is approved.`).join('\n\n');
  const response = await h.phone('/jobs', {id: crypto.randomUUID(), title: 'Fictional request with a long body', body, action_kind: 'read_only'}, owner.device_token);
  assert.equal(response.status, 201); const job = (await response.json()).job;
  const phone = await open({owner, width: 360, height: 800}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor(); await inspectRequest(page, job.id);
  const detail = jobDialog(page), marker = 'Fictional request section 24.';
  await detail.locator('#relay-owner-objective>summary').click();
  const anchor = async align => detail.evaluate((dialog, {marker, align}) => {
    const body = dialog.querySelector('p.request-body'), text = body.firstChild;
    const index = text.textContent.indexOf(marker); if (index < 0) throw Error('Synthetic reading marker missing');
    const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + marker.length);
    if (align) dialog.scrollTop += range.getBoundingClientRect().top - dialog.getBoundingClientRect().top - 140;
    return {offset: range.getBoundingClientRect().top - dialog.getBoundingClientRect().top, scroll: dialog.scrollTop,
      marker, stageText: dialog.querySelector('.request-state').textContent};
  }, {marker, align});
  const before = await anchor(true); assert.ok(before.scroll > 0);
  const claim = {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID()};
  await h.rpc(oauth, 'relay_owner_job_claim', claim);
  await h.phone('/jobs/cancel', {job_id: job.id}, owner.device_token);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/relay/owner/jobs/detail' && response.request().method() === 'GET');
  await page.clock.fastForward(31000); await refreshed; await waitRequestReady(page);
  const after = await anchor(false);
  await writeSyntheticEvidence(phone, 'current-owner-active-reading-refresh-360x800', {before, after});
  assert.match(after.stageText, /Stopping…/);
  assert.ok(Math.abs(after.offset - before.offset) <= 3, 'A changed status/evidence block must preserve the text position the owner is reading');
  await assertNoPrivatePersistence(page, [body]); assertBrowserContained(phone);
});

test('an offline owner inbox labels cached execution evidence as last known and an elapsed lease as unconfirmed', {timeout: 90000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const message = await savedMessage(h, owner, 'PRIVATE-OFFLINE-EXECUTION-6392');
  await h.rpc(oauth, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: message.id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID()});
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor();
  const row = page.locator(`[data-job-id="${message.id}"]`);
  await row.getByText('Working', {exact: true}).waitFor();
  phone.rule(record => record.path.startsWith('/relay/owner/') && record.method === 'GET', async ({forward}) => {
    const response = await forward();
    return Response.json({code: 'temporary_fixture_failure'}, {status: 503, headers: response.headers});
  }, Infinity);
  await page.clock.fastForward(361000);
  await page.waitForFunction(id => document.querySelector(`[data-job-id="${id}"] .job-state`)?.textContent.includes('Last known:'), message.id);
  const label = await row.locator('.job-state').textContent();
  assert.match(label, /Last known:.*Status unknown/);
  assert.doesNotMatch(label, /Working|completed|cancelled|failed/i);
  await row.getByRole('button', {name: 'Inspect request', exact: true}).click(); await waitRequestReady(page);
  const detail = jobDialog(page);
  assert.equal(await detail.locator('.request-state').textContent(),'Status unknown');assert.match(await detail.innerText(),/Last saved status · refresh unavailable/);
  assert.equal(await detail.getByRole('button', {name: 'Try again', exact: true}).count(), 0, 'The browser clock cannot authorize a new attempt');
  assert.equal(h.rows('SELECT stage FROM relay_owner_jobs WHERE id=?', message.id)[0].stage, 'running', 'Displayed uncertainty does not rewrite authenticated server evidence');
  const mutating = ['/relay/owner/messages', '/relay/owner/jobs', '/relay/owner/jobs/cancel', '/relay/owner/jobs/retry', '/relay/owner/delivery/retry'];
  assert.deepEqual(phone.records.filter(record => mutating.includes(record.path) && record.method === 'POST'), [], 'Cached uncertainty cannot create a private request, lifecycle event or callback retry');
  assert.deepEqual(publicWrites(phone), []);
  await writeSyntheticEvidence(phone, 'current-owner-offline-expired-acknowledgement-390x844', {label, noClientStageMutation: true});
  await assertNoPrivatePersistence(page, ['PRIVATE-OFFLINE-EXECUTION-6392']); assertBrowserContained(phone);
});

test('public and Muse preserve separate drafts and reading positions through Home and browser Back; Ctrl+Enter routes only to their public lane', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, open} = j;
  for (let index = 0; index < 16; index++) for (const prefix of ['', MUSE_PREFIX]) {
    const response = await h.fixture.request('/shared/messages', {method: 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json'},
      body: JSON.stringify({id: crypto.randomUUID(), body: prefix + `Fictional public reading row ${index + 1}.\nThis synthetic content provides enough space to preserve an independent reading position.`})});
    assert.equal(response.ok, true);
  }
  for (const channel of ['public', 'muse']) {
    const phone = await open({width: 390, height: 844}), {page} = phone;
    await page.goto(channel === 'muse' ? MUSE_URL : RELAY_URL);
    const input = page.locator(channel === 'muse' ? '#prompt' : '#message-text'), panel = page.locator('#messages');
    await input.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#messages [data-message-id]').length >= 16);
    await panel.evaluate(node => { node.scrollTop = 180; });
    const anchor = () => panel.evaluate(panel => {
      const bounds = panel.getBoundingClientRect(), node = [...panel.querySelectorAll('[data-message-id]')].find(node => node.getBoundingClientRect().bottom >= bounds.top);
      return {id: node?.dataset.messageId, offset: node ? node.getBoundingClientRect().top - bounds.top : 0};
    });
    const before = await anchor(); assert.ok(before.id);
    const draft = `Fictional ${channel} draft for Back behavior`; await input.fill(draft);
    await page.locator('#relay-menu-button').click();await page.getByRole('link', {name: 'Jarvis home', exact: true}).click();
    await page.waitForURL(SITE + '/');
    await page.goBack(); await input.waitFor();
    assert.equal(await input.inputValue(), draft);
    const after = await anchor(); assert.equal(after.id, before.id); assert.ok(Math.abs(after.offset - before.offset) <= 3);
    await input.focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('Second line');
    assert.equal(publicWrites(phone).length, 0, 'Enter only inserts a newline');
    const receipt = page.waitForResponse(response => new URL(response.url()).pathname === '/shared/messages' && response.request().method() === 'POST');
    await page.keyboard.press('Control+Enter'); assert.equal((await receipt).ok(), true);
    const writes = publicWrites(phone); assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0].body).body, (channel === 'muse' ? MUSE_PREFIX : '') + draft + '\nSecond line');
    assert.equal(phone.records.some(record => record.path.startsWith('/relay/owner/')), false, 'Public/Muse keyboard send cannot invoke private owner jobs');
    assertBrowserContained(phone);
  }
});

test('a lost private save receipt retries the original UUID and duplicate replies render once', {timeout: 90000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const body = 'SYNTHETIC-UNCERTAIN-SEND-2317', reply = 'SYNTHETIC-DUPLICATE-REPLY-7188';
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor();
  phone.rule(record => record.path === '/relay/owner/messages' && record.method === 'POST', async ({forward}) => {
    const response = await forward(); assert.equal(response.status, 201);
    return {abort: true}; // Commit happened; only the receipt is lost.
  });
  await ownerInput(page).fill(body);
  await page.getByRole('button', {name: 'Send private message', exact: true}).click();
  await page.getByText(/Owner connection unavailable/).waitFor();
  assert.equal(await ownerInput(page).inputValue(), body);
  await page.getByRole('button', {name: 'Send private message', exact: true}).click();
  await page.getByText(body, {exact: true}).waitFor();
  assert.equal(await ownerInput(page).inputValue(), '');
  const sends = sentMessages(phone).map(record => JSON.parse(record.body));
  assert.equal(sends.length, 2); assert.equal(sends[0].id, sends[1].id);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_entries WHERE id=?', sends[0].id)[0].n, 1);
  const first = await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: sends[0].id, body: reply});
  const repeated = await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: sends[0].id, body: reply});
  assert.equal(first.entry.id, repeated.entry.id);
  await conversationMenu(page, 'Refresh private inbox');
  await page.getByText(reply, {exact: true}).waitFor();
  assert.equal(await page.getByText(body, {exact: true}).count(), 1);
  assert.equal(await page.getByText(reply, {exact: true}).count(), 1);
  assert.deepEqual(publicWrites(phone), []);
  await assertNoPrivatePersistence(page, [body, reply]);
  assertBrowserContained(phone);
});

test('an authenticated send response arriving after session expiry cannot repopulate private memory', {timeout: 90000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, owner, open} = j, body = 'SYNTHETIC-STALE-PRIVATE-SEND-2274';
  const phone = await open({owner}), {page} = phone;
  await page.goto(RELAY_URL); await ownerInput(page).waitFor();
  const slowSend = phone.hold(record => record.path === '/relay/owner/messages' && record.method === 'POST');
  t.after(() => slowSend.release());
  await ownerInput(page).fill(body);
  await page.getByRole('button', {name: 'Send private message', exact: true}).click();
  await slowSend.entered;
  h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?', Date.now() - 1, owner.device.id);
  await conversationMenu(page, 'Refresh private inbox');
  await page.waitForFunction(key => localStorage.getItem(key) === null, OWNER_KEY);
  slowSend.release();
  await page.waitForFunction(() => !document.getElementById('relay-owner-message-text'));
  await assertPrivateInvisible(page, [body]);
  await conversationMenu(page, 'Public chat');
  await publicInput(page).waitFor();
  assert.equal(await publicInput(page).inputValue(), '');
  await assertPrivateInvisible(page, [body]);
  await assertNoPrivatePersistence(page, [body], {draft:body});
  assert.deepEqual(publicWrites(phone), []);
  assertBrowserContained(phone);
});

test('owner, public and Muse render attacker text inertly and permit only safe outgoing links', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, oauth, owner, open} = j;
  const attack = 'SYNTHETIC unsafe text <img id="xss-probe" src=x onerror="window.__conversationXss=1">\n'
    + '<script>window.__conversationXss=2</script>\n[run](javascript:window.__conversationXss=3) [data](data:text/html,unsafe)\n'
    + '[safe](https://safe.invalid/path?q=%3Cscript%3E)';
  const privateEntry = await savedMessage(h, owner, attack);
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: privateEntry.id, body: attack});
  for (const body of [attack, MUSE_PREFIX + attack]) {
    const response = await h.fixture.request('/shared/messages', {method: 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json'}, body: JSON.stringify({id: crypto.randomUUID(), body})});
    assert.equal(response.ok, true);
  }
  for (const channel of ['owner', 'public', 'muse']) {
    const phone = await open(channel === 'owner' ? {owner} : {}), {page} = phone;
    await page.goto(channel === 'muse' ? MUSE_URL : RELAY_URL);
    await page.locator(channel === 'owner' ? '#relay-owner-message-text' : channel === 'muse' ? '#prompt' : '#message-text').waitFor();
    await page.getByText(/SYNTHETIC unsafe text/).first().waitFor();
    assert.equal(await page.locator('#xss-probe, .messages script, .messages iframe').count(), 0);
    assert.equal(await page.evaluate(() => window.__conversationXss), undefined);
    const links = await page.locator('.messages a[href]').evaluateAll(nodes => nodes.map(node => ({href: node.href, target: node.target, rel: node.rel})));
    for (const link of links) {
      assert.ok(['https:', 'http:'].includes(new URL(link.href).protocol));
      assert.equal(link.target, '_blank');
      assert.ok(link.rel.split(/\s+/).includes('noopener')); assert.ok(link.rel.split(/\s+/).includes('noreferrer'));
    }
    assert.equal(phone.records.some(record => record.url.startsWith('https://safe.invalid/')), false, 'Rendering must not fetch an outgoing link');
    assertBrowserContained(phone);
  }
});

function readingAnchor(page) {
  return page.locator('.relay-owner-chat .messages').evaluate(panel => {
    const bounds = panel.getBoundingClientRect();
    const row = [...panel.querySelectorAll('[data-message-id]')].find(node => node.getBoundingClientRect().bottom >= bounds.top);
    return {id: row?.dataset.messageId, offset: row ? row.getBoundingClientRect().top - bounds.top : 0, scroll: panel.scrollTop};
  });
}

test('owner reading anchor, independent drafts and keyboard controls survive refresh and narrow resized viewports', {timeout: 180000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, owner, open} = j;
  for (let index = 0; index < 18; index++) await savedMessage(h, owner, `Fictional reading row ${index + 1}\nThis is a synthetic conversation with enough text to scroll naturally.`);
  for (const size of [{width: 360, height: 800}, {width: 390, height: 844}, {width: 412, height: 915}, {width: 1280, height: 900, mobile: false}]) {
    const phone = await open({...size, owner}), {page} = phone;
    await page.goto(RELAY_URL); await ownerInput(page).waitFor();
    const panel = page.locator('.relay-owner-chat .messages');
    await panel.evaluate(node => { node.scrollTop = 180; });
    const before = await readingAnchor(page); assert.ok(before.id); assert.ok(before.scroll > 0);
    await ownerInput(page).fill(`Private draft for ${size.width}`);
    await savedMessage(h, owner, `Fictional new row for ${size.width}`);
    await conversationMenu(page, 'Refresh private inbox');
    await page.waitForFunction(() => !document.querySelector('#relay-owner-message-form button[type=submit]')?.disabled);
    const refreshed = await readingAnchor(page);
    assert.equal(refreshed.id, before.id, 'Refresh retains the visible reading anchor');
    assert.ok(Math.abs(refreshed.offset - before.offset) <= 3);
    await conversationMenu(page, 'Public chat');
    await publicInput(page).fill(`Public draft for ${size.width}`);
    await conversationMenu(page, 'Owner chat');
    await ownerInput(page).waitFor();
    assert.equal(await ownerInput(page).inputValue(), `Private draft for ${size.width}`);
    const restored = await readingAnchor(page);
    assert.equal(restored.id, before.id, 'An in-page channel switch retains the private reading anchor');
    assert.ok(Math.abs(restored.offset - before.offset) <= 3);
    await ownerInput(page).focus();
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Second line');
    assert.ok((await ownerInput(page).inputValue()).includes('\nSecond line'), 'Enter adds a newline');
    assert.equal(sentMessages(phone).length, 0, 'Plain Enter does not send');
    const geometry = await page.evaluate(() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll('.topbar button,.topbar a,#relay-owner-message-form button')].filter(node => {const r=node.getBoundingClientRect();return !node.hidden&&r.width&&r.height;}).map(node => {
        const rect = node.getBoundingClientRect(); return {name: node.getAttribute('aria-label'), width: rect.width, height: rect.height};
      })}));
    assert.ok(geometry.documentWidth <= geometry.width + 1, 'No horizontal overflow at supported phone widths');
    for (const control of geometry.controls) { assert.ok(control.width >= 48, `${control.name} width is at least 48px`); assert.ok(control.height >= 48, `${control.name} height is at least 48px`); }
    await writeSyntheticEvidence(phone, `current-owner-reading-${size.width}x${size.height}`, {geometry, readingAnchor: restored});
    if (size.mobile !== false) {
      await page.setViewportSize({width: size.width, height: size.height - 320});
      await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-height')) - visualViewport.height) <= 1);
      await ownerInput(page).focus();
      const resized = await page.locator('#relay-owner-message-form').boundingBox();
      await writeSyntheticEvidence(phone, `current-owner-keyboard-${size.width}`, {geometry: resized, simulation: 'viewport reduced by 320px; headless does not reproduce an OS keyboard'});
      assert.ok(resized && resized.y >= 0 && resized.y + resized.height <= size.height - 320 + 1, 'Composer stays inside a viewport resized to model a keyboard');
      await page.setViewportSize({width: size.width, height: size.height});
    }
    await ownerInput(page).focus();
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/relay/owner/messages' && r.request().method() === 'POST');
    await page.keyboard.press('Control+Enter'); assert.equal((await response).ok(), true);
    await page.waitForFunction(() => document.getElementById('relay-owner-message-text')?.value === '');
    assert.equal(sentMessages(phone).length, 1, 'Ctrl+Enter sends once');
    assertBrowserContained(phone);
  }
});
