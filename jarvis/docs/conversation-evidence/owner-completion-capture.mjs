import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness, assertBrowserContained, writeSyntheticEvidence, RELAY_URL} from '../../tests/helpers/relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../../backend/relay-common.js';

test('capture only fictional reply availability and typed completion on a phone', {timeout: 90000}, async t => {
  const browser = await launchQualifiedBrowser(t); if (!browser) return;
  const harness = createConversationFixture(t), pages = [];
  t.after(() => closeConversationHarness(browser, harness, pages));
  const auth = await harness.oauth(), owner = await harness.pair(auth, 'Fictional evidence phone');
  const fixtures = [
    {name: 'synthetic-owner-reply-unverified-390x844', title: 'Fictional source review', request: 'Review the fictional source notes.', reply: 'I received the request. Please supply the fictional source file before I can continue.', complete: false},
    {name: 'synthetic-owner-work-reported-complete-390x844', title: 'Fictional inspection report', request: 'Prepare a report from the fictional notes.', reply: 'The fictional report is available with its source notes.', summary: 'The fictional inspection report has been prepared. No external changes were made.', complete: true}
  ];
  for (const fixture of fixtures) {
    const id = crypto.randomUUID();
    const response = await harness.phone('/jobs', {id, title: fixture.title, body: fixture.request, action_kind: 'draft'}, owner.device_token);
    assert.equal(response.status, 201);
    const runId = crypto.randomUUID();
    if (fixture.complete) await harness.rpc(auth, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: id, run_id: runId, event_id: crypto.randomUUID()});
    const accepted = await harness.rpc(auth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: id, body: fixture.reply});
    if (fixture.complete) await harness.rpc(auth, 'relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: id, run_id: runId, event_id: crypto.randomUUID(), stage: 'completed', outcome: 'known', expected_reply_id: accepted.entry.id, expected_version: 1, summary: fixture.summary});
    const phone = await openConversationPage(browser, harness, {owner, width: 390, height: 844, clock: false}); pages.push(phone);
    await phone.page.goto(RELAY_URL); await phone.page.locator('#relay-owner-message-text').waitFor();
    await phone.page.locator(`[data-job-id="${id}"]`).getByRole('button', {name: 'Inspect request', exact: true}).click();
    const dialog = phone.page.getByRole('dialog', {name: 'Private request', exact: true});
    await phone.page.waitForFunction(() => {const refresh = document.getElementById('relay-owner-request-refresh'); return refresh && !refresh.disabled;});
    await dialog.evaluate(node => {node.scrollTop = 0;});
    assert.equal(await dialog.locator('.request-state').textContent(), fixture.complete ? 'Work reported complete' : 'Reply received · completion unverified');
    await writeSyntheticEvidence(phone, fixture.name, {fictionalFixturesOnly: true, typedCompletion: fixture.complete, immutableReplyPreserved: true});
    if (fixture.complete) {
      await phone.page.setViewportSize({width: 390, height: 520});
      await dialog.evaluate(node => {node.scrollTop = 0;});
      const geometry = await dialog.evaluate(node => {const rect = node.getBoundingClientRect(); return {width: rect.width, height: rect.height, top: rect.top, scrollable: node.scrollHeight > node.clientHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth};});
      assert.equal(geometry.horizontalOverflow, false); assert.ok(geometry.top >= 0 && geometry.height <= 520 && geometry.scrollable);
      await writeSyntheticEvidence(phone, 'synthetic-owner-work-reported-complete-390x520', {fictionalFixturesOnly: true, typedCompletion: true, geometry});
    }
    assertBrowserContained(phone);
  }
});
