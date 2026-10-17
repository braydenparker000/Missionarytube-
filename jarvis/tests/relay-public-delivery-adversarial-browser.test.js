import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness,
  assertBrowserContained, writeSyntheticEvidence, SITE, RELAY_URL, MUSE_URL} from './helpers/relay-conversation-browser-fixture.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';
import {MUSE_STORAGE_KEY} from '../public/assets/muse-store.js';
import {STORAGE_KEY} from '../public/assets/shared-store.js';
import {sharedStore} from '../backend/shared.js';

const channels = ['relay', 'muse'];
const storageKey = channel => channel === 'muse' ? MUSE_STORAGE_KEY : STORAGE_KEY;
const input = (page, channel) => page.locator(channel === 'muse' ? '#prompt' : '#message-text');
const scopedBody = (channel, body) => (channel === 'muse' ? MUSE_PREFIX : '') + body;
const writes = phone => phone.records.filter(record => record.path === '/shared/messages' && record.method === 'POST');
const state = (page, channel) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(channel));
const error = (page, channel) => page.locator(channel === 'muse' ? '#error' : '#relay-sync-error');

async function journey(t) {
  const browser = await launchQualifiedBrowser(t); if (!browser) return null;
  const h = createConversationFixture(t), pages = [];
  t.after(() => closeConversationHarness(browser, h, pages));
  const open = async options => {
    const phone = await openConversationPage(browser, h, {...options,
      ...(process.env.RELAY_QA_PUBLIC_ROOT ? {root: process.env.RELAY_QA_PUBLIC_ROOT} : {})});
    pages.push(phone); return phone;
  };
  return {h, open};
}
async function ready(phone, channel) {
  await phone.page.goto(channel === 'muse' ? MUSE_URL : RELAY_URL);
  await input(phone.page, channel).waitFor();
}
async function idle(page, channel) {
  await page.waitForFunction(channel => {
    const status = document.getElementById(channel === 'muse' ? 'status' : 'relay-status');
    return status && !/Sending|Refreshing|Opening/.test(status.textContent);
  }, channel);
}
async function send(page, channel, body) {
  await input(page, channel).fill(body);
  await page.locator(channel === 'muse' ? '#send' : '#send-message').click();
}
async function refresh(phone, channel) {
  const response = phone.page.waitForResponse(response => new URL(response.url()).pathname === '/shared/changes' && response.request().method() === 'GET');
  await phone.page.evaluate(() => dispatchEvent(new Event('online')));
  await response; await idle(phone.page, channel);
}
function assertPublicOnly(phone) {
  assert.equal(phone.records.some(record => record.path.startsWith('/relay/owner/')), false);
  assertBrowserContained(phone);
}

test('public and Muse messages queued during the initial slow GET remain visible with their original UUID and body', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} message queued during a slow initial read`;
    const initial = phone.hold(record => record.path === '/shared/changes' && record.method === 'GET');
    await ready(phone, channel); await initial.entered;
    await send(page, channel, body);
    const queued = (await state(page, channel)).outbox.find(item => item.body === scopedBody(channel, body));
    assert.ok(queued, 'The send must first persist its complete synthetic payload');
    await page.locator(`[data-message-id="${queued.id}"]`).waitFor();
    initial.release(); await idle(page, channel);
    const after = await state(page, channel);
    await writeSyntheticEvidence(phone, `${process.env.RELAY_QA_PHASE || 'current'}-${channel}-send-during-slow-read-390x844`,
      {messageRetained: after.messages.some(item => item.id === queued.id && item.body === queued.body),
        payloadRetained: after.outbox.some(item => item.id === queued.id && item.body === queued.body), publicPosts: writes(phone).length});
    assert.ok(after.messages.some(item => item.id === queued.id && item.body === queued.body), `${channel}: a late GET cannot erase a newly queued message`);
    assert.equal(await page.locator(`[data-message-id="${queued.id}"]`).count(), 1);
    assert.ok(after.outbox.some(item => item.id === queued.id && item.body === queued.body) || after.messages.some(item => item.id === queued.id && item.body === queued.body && item.saved === true));
    await refresh(phone, channel);
    const confirmed = await state(page, channel);
    assert.equal(confirmed.outbox.some(item => item.id === queued.id), false);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', queued.id)[0].n, 1);
    assertPublicOnly(phone);
  });
});

test('lost public and Muse POST receipts preserve the same UUID whether the server accepted or never received the request', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) for (const accepted of [true, false]) await t.test(`${channel} ${accepted ? 'accepted' : 'not received'}`, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} lost response ${accepted ? 'accepted' : 'unreceived'}`;
    await ready(phone, channel); await idle(page, channel);
    phone.rule(record => record.path === '/shared/messages' && record.method === 'POST', async ({forward}) => {
      if (accepted) assert.equal((await forward()).status, 201);
      return {abort: true};
    });
    await send(page, channel, body); await error(page, channel).waitFor(); await idle(page, channel);
    const original = JSON.parse(writes(phone)[0].body), queued = await state(page, channel);
    assert.deepEqual(queued.outbox.filter(item => item.id === original.id).map(item => item.body), [original.body]);
    assert.equal(await page.locator(`[data-message-id="${original.id}"]`).count(), 1);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, accepted ? 1 : 0);
    await page.reload(); await input(page, channel).waitFor(); await idle(page, channel);
    const restored = await state(page, channel), posts = writes(phone).map(record => JSON.parse(record.body));
    assert.equal(posts.length, accepted ? 1 : 2, 'A fresh exact target read confirms an accepted UUID before resending');
    assert.ok(posts.every(item => item.id === original.id && item.body === original.body));
    assert.equal(restored.outbox.some(item => item.id === original.id), false);
    assert.equal(restored.messages.find(item => item.id === original.id)?.body, original.body);
    assert.equal(restored.messages.find(item => item.id === original.id)?.saved, true);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, 1);
    assert.equal(await page.locator(`[data-message-id="${original.id}"]`).count(), 1);
    assertPublicOnly(phone);
  });
});

test('an explicitly rejected public or Muse POST keeps its payload and shows that the send needs attention', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} request rejected by the existing daily limit`;
    await ready(phone, channel); await idle(page, channel);
    j.h.ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta(key,value) VALUES(?,?)', 'messages:' + new Date().toISOString().slice(0, 10), '200');
    await send(page, channel, body); await error(page, channel).waitFor(); await idle(page, channel);
    const rejected = writes(phone)[0], original = JSON.parse(rejected.body), retained = await state(page, channel);
    assert.equal(rejected.status, 429, 'The real Worker rejects the send before creating an entry');
    assert.deepEqual(retained.outbox.filter(item => item.id === original.id).map(item => item.body), [original.body]);
    assert.equal(retained.messages.find(item => item.id === original.id)?.saved, false);
    assert.equal(retained.outbox.find(item => item.id === original.id)?.sendState, 'rejected');
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, 0);
    const status = page.locator(channel === 'muse' ? '#status' : '#relay-status');
    assert.match(await status.textContent(), /needs attention/i);
    assert.equal(await page.locator(`[data-message-id="${original.id}"]`).getByText(body, {exact: true}).count(), 1);
    assertPublicOnly(phone);
  });
});

test('an accepted exact public or Muse POST entry survives stale paginated reads without another send', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const seeded = Array.from({length: 205}, (_, index) => ({id: crypto.randomUUID(), role: 'user',
    body: `Fictional pagination seed ${index + 1}`, createdAt: new Date(Date.now() - 3600000 + index * 1000).toISOString()}));
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: seeded}).status, 200);
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} exact POST with stale paginated reads`;
    await ready(phone, channel); await idle(page, channel);
    let posted = null;
    const staleThrough = (await state(page, channel)).publicReader.cursor.split(':')[1];
    phone.rule(record => record.path === '/shared/messages' && record.method === 'POST', async ({record, forward}) => {
      const response = await forward(); assert.equal(response.status, 201);
      const receipt = await response.clone().json(); posted = JSON.parse(record.body);
      assert.equal(receipt.entry.id, posted.id); assert.equal(receipt.entry.body, posted.body);
      return response;
    });
    phone.rule(record => !!posted && record.path === '/shared/changes' && record.method === 'GET', async ({record}) => {
      // Use a real earlier fenced snapshot. Removing the newly accepted entry
      // from a current snapshot would be malformed pagination, not a stale read.
      const after = new URL(record.url).searchParams.get('cursor').split(':')[1];
      return j.h.fixture.request('/shared/changes?cursor=' + encodeURIComponent(`pc2:${after}:${staleThrough}`), {headers: {Origin: SITE}});
    }, Infinity);
    await send(page, channel, body); await idle(page, channel);
    assert.ok(posted);
    const first = await state(page, channel), entry = first.messages.find(item => item.id === posted.id);
    assert.equal(entry?.body, posted.body, `${channel}: stale GET pages cannot hide the proven accepted entry`);
    assert.equal(entry.saved, true); assert.equal(first.outbox.some(item => item.id === posted.id), false);
    assert.equal(await page.locator(`[data-message-id="${posted.id}"]`).count(), 1);
    await refresh(phone, channel);
    assert.equal((await state(page, channel)).messages.find(item => item.id === posted.id)?.body, posted.body);
    assert.equal(writes(phone).length, 1);
    assert.ok(phone.records.some(record => record.path === '/shared/changes' && new URL(record.url).searchParams.get('cursor').split(':').length === 3), 'The fixture exercises a later fenced history page');
    await writeSyntheticEvidence(phone, `current-${channel}-accepted-stale-pagination-390x844`, {exactPostAccepted: true, completePaginationExercised: true});
    assertPublicOnly(phone);
  });
});

test('complete online history beyond the local cache bound retains the oldest message and its reading anchor', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const seeded = [];
  for (let index = 0; index < 302; index++) for (const channel of channels) seeded.push({id: crypto.randomUUID(), role: 'user',
    body: scopedBody(channel, `Fictional ${channel} online history ${index + 1}. This original public row must remain readable after all history pages load.`),
    createdAt: new Date(Date.now() - 3600000 + index * 1000).toISOString()});
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: seeded}).status, 200);
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone;
    await ready(phone, channel); await idle(page, channel);
    const panel = page.locator('#messages'), oldest = seeded.find(item => item.body === scopedBody(channel,
      `Fictional ${channel} online history 1. This original public row must remain readable after all history pages load.`));
    assert.equal(await panel.locator(`[data-message-id="${oldest.id}"]`).count(), 1, 'The complete online history includes rows older than the serialized cache');
    assert.ok(await panel.locator('[data-message-id]').count() >= 302);
    assert.ok((await state(page, channel)).messages.length <= 250, 'Only the serialized accepted cache is bounded');
    await panel.evaluate(node => {node.scrollTop = 180;});
    const anchor = () => panel.evaluate(panel => {
      const bounds = panel.getBoundingClientRect(), row = [...panel.querySelectorAll('[data-message-id]')].find(node => node.getBoundingClientRect().bottom >= bounds.top);
      return {id: row?.dataset.messageId, offset: row ? row.getBoundingClientRect().top - bounds.top : 0, scroll: panel.scrollTop};
    });
    const before = await anchor(); assert.ok(before.id); assert.ok(before.scroll > 0);
    const more = {id: crypto.randomUUID(), role: 'user', body: scopedBody(channel, `Fictional newer ${channel} row after the complete history was read`), createdAt: new Date().toISOString()};
    assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: [more]}).status, 200);
    await refresh(phone, channel);
    const after = await anchor();
    assert.equal(after.id, before.id); assert.ok(Math.abs(after.offset - before.offset) <= 3);
    assert.equal(await panel.locator(`[data-message-id="${oldest.id}"]`).count(), 1);
    assert.equal(await panel.locator(`[data-message-id="${more.id}"]`).count(), 1);
    assert.ok(await panel.locator('[data-message-id]').count() >= 303);
    assert.ok(phone.records.filter(record => record.path === '/shared/changes' && new URL(record.url).searchParams.get('cursor').split(':').length === 3).length >= 3);
    await writeSyntheticEvidence(phone, `current-${channel}-full-online-history-390x844`, {before, after, onlineRows: await panel.locator('[data-message-id]').count(), serializedRows: (await state(page, channel)).messages.length});
    assertPublicOnly(phone);
  });
});

test('a public or Muse UUID collision with different content stays unconfirmed through 409 and fresh history', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} collision payload to preserve`;
    await ready(phone, channel); await idle(page, channel);
    const beforeSend = phone.hold(record => record.path === '/shared/changes' && record.method === 'GET');
    await page.evaluate(() => dispatchEvent(new Event('online'))); await beforeSend.entered;
    await send(page, channel, body);
    const original = (await state(page, channel)).outbox.find(item => item.body === scopedBody(channel, body));
    assert.ok(original);
    const different = scopedBody(channel, 'Fictional different content with the same UUID');
    const competing = await j.h.fixture.request('/shared/messages', {method: 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json'}, body: JSON.stringify({id: original.id, body: different})});
    assert.equal(competing.status, 201);
    beforeSend.release(); await idle(page, channel);
    await refresh(phone, channel);
    const retained = await state(page, channel);
    assert.deepEqual(retained.outbox.filter(item => item.id === original.id).map(item => item.body), [original.body], 'An ID alone cannot prove acceptance of a different payload');
    await error(page, channel).waitFor();
    assert.equal(await page.locator(`[data-message-id="${original.id}"]`).getByText(body, {exact: true}).count(), 1);
    const attempts = writes(phone).map(record => JSON.parse(record.body));
    assert.ok(attempts.length >= 1); assert.ok(attempts.every(item => item.id === original.id && item.body === original.body));
    assert.ok(writes(phone).some(record => record.status === 409));
    assert.equal(j.h.rows('SELECT body FROM shared_entries WHERE id=?', original.id)[0].body, different);
    assertPublicOnly(phone);
  });
});

test('blocked per-tab draft storage surfaces failure and keeps the typed public or Muse text available', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} draft retained despite blocked tab storage`;
    await ready(phone, channel); await idle(page, channel);
    await page.evaluate(body => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === sessionStorage && String(value) === body) throw new DOMException('Synthetic tab quota failure', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    }, body);
    await input(page, channel).fill(body); await error(page, channel).waitFor();
    assert.equal(await input(page, channel).inputValue(), body);
    assert.match(await error(page, channel).textContent(), /draft|storage|copy/i);
    assert.equal(await page.locator(channel === 'muse' ? '#send' : '#send-message').isDisabled(), true, 'An actual retention failure disables new send intents');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key + '.composer.v1'), storageKey(channel)), '');
    assert.deepEqual(writes(phone), []);
    await writeSyntheticEvidence(phone, `current-${channel}-blocked-tab-draft-390x844`, {typedTextRetained: true, failureSurfaced: true});
    assertPublicOnly(phone);
  });
});

test('a saved public or Muse UUID journal recovers after aggregate persistence fails midway through enqueue', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} partial enqueue whose original UUID must survive`;
    await ready(phone, channel); await idle(page, channel);
    await page.evaluate(key => {
      const setItem = Storage.prototype.setItem; let failed = false;
      Storage.prototype.setItem = function(name, value) {
        if (!failed && this === localStorage && name === key && JSON.parse(String(value)).outbox.length) {
          failed = true; throw new DOMException('Synthetic aggregate quota failure', 'QuotaExceededError');
        }
        return setItem.call(this, name, value);
      };
    }, storageKey(channel));
    await send(page, channel, body); await error(page, channel).waitFor();
    const journals = await page.evaluate(prefix => Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)).map(([, value]) => JSON.parse(value)), storageKey(channel) + '.pending.');
    assert.equal(journals.length, 1); const original = journals[0];
    assert.equal(original.body, scopedBody(channel, body)); assert.equal(original.saved, false);
    assert.equal(await input(page, channel).inputValue(), body);
    assert.equal(await page.locator(channel === 'muse' ? '#send' : '#send-message').isDisabled(), true);
    assert.deepEqual(writes(phone), [], 'A failed enqueue cannot claim or attempt remote acceptance');
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, 0);
    await writeSyntheticEvidence(phone, `current-${channel}-partial-enqueue-390x844`, {originalUuidDurable: true, remoteAcceptance: false});
    await page.reload(); await input(page, channel).waitFor(); await idle(page, channel);
    const posts = writes(phone).map(record => JSON.parse(record.body));
    assert.deepEqual(posts, [{id: original.id, body: original.body}], 'Restoring the durable journal resends the original payload exactly once');
    assert.equal((await state(page, channel)).outbox.some(item => item.id === original.id), false);
    assert.equal((await state(page, channel)).messages.find(item => item.id === original.id)?.saved, true);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, 1);
    assertPublicOnly(phone);
  });
});

test('a failed per-tab draft clear cannot turn a recovered public or Muse send into a second intent', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} intent retained after its draft clear failed`;
    await ready(phone, channel); await idle(page, channel);
    await input(page, channel).fill(body);
    await page.evaluate(draftKey => {
      const setItem = Storage.prototype.setItem; let failed = false;
      Storage.prototype.setItem = function(name, value) {
        if (!failed && this === sessionStorage && name === draftKey && String(value) === '') {
          failed = true; throw new DOMException('Synthetic draft-clear quota failure', 'QuotaExceededError');
        }
        return setItem.call(this, name, value);
      };
    }, storageKey(channel) + '.composer.v1');
    await page.locator(channel === 'muse' ? '#send' : '#send-message').click();
    await error(page, channel).waitFor();
    const journals = await page.evaluate(prefix => Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)).map(([, value]) => JSON.parse(value)), storageKey(channel) + '.pending.');
    assert.equal(journals.length, 1); const original = journals[0];
    assert.equal(original.body, scopedBody(channel, body));
    assert.equal(await input(page, channel).inputValue(), body, 'The original text remains available while persistence has failed');
    assert.deepEqual(writes(phone), []);
    const accepted = page.waitForResponse(response => new URL(response.url()).pathname === '/shared/messages' && response.request().method() === 'POST');
    await page.reload(); await input(page, channel).waitFor();
    assert.equal((await accepted).status(), 201); await idle(page, channel);
    assert.deepEqual(writes(phone).map(record => JSON.parse(record.body)), [{id: original.id, body: original.body}]);
    assert.equal((await state(page, channel)).messages.find(item => item.id === original.id)?.saved, true);
    assert.equal((await state(page, channel)).outbox.some(item => item.id === original.id), false);
    assert.equal(await input(page, channel).inputValue(), '', 'The recovered and accepted intent is no longer offered as a fresh draft');
    await input(page, channel).focus(); await page.keyboard.press('Control+Enter');
    assert.equal(writes(phone).length, 1, 'A natural next Send cannot allocate another UUID for that submitted intent');
    assert.equal(j.h.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE kind='user' AND body=?", original.body)[0].n, 1);
    await writeSyntheticEvidence(phone, `current-${channel}-failed-draft-clear-recovery-390x844`, {originalUuidAcceptedOnce: true, submittedDraftNotOfferedAgain: true});
    await input(page, channel).fill(`Fictional later independent ${channel} draft`);
    await page.reload(); await input(page, channel).waitFor(); await idle(page, channel);
    assert.equal(await input(page, channel).inputValue(), `Fictional later independent ${channel} draft`, 'Recovery does not discard a separately typed draft');
    assert.equal(writes(phone).length, 1);
    assertPublicOnly(phone);
  });
});

test('a permanent public or Muse UUID conflict preserves its payload while unrelated messages can still be accepted', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const phone = await j.open(), {page} = phone, body = `Fictional ${channel} permanent conflict kept for inspection`;
    await ready(phone, channel); await idle(page, channel);
    const held = phone.hold(record => record.path === '/shared/changes' && record.method === 'GET');
    await page.evaluate(() => dispatchEvent(new Event('online'))); await held.entered;
    await send(page, channel, body);
    const original = (await state(page, channel)).outbox.find(item => item.body === scopedBody(channel, body));
    assert.ok(original);
    const different = scopedBody(channel, 'Fictional immutable competing content for a conflicting UUID');
    const competing = await j.h.fixture.request('/shared/messages', {method: 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json'}, body: JSON.stringify({id: original.id, body: different})});
    assert.equal(competing.status, 201);
    held.release(); await error(page, channel).waitFor(); await idle(page, channel);
    const independentBody = `Fictional ${channel} independent message after a permanent conflict`;
    await send(page, channel, independentBody); await idle(page, channel);
    const accepted = (await state(page, channel)).messages.find(item => item.body === scopedBody(channel, independentBody));
    assert.ok(accepted); assert.equal(accepted.saved, true, 'A conflicting UUID cannot prevent acceptance of a separate queued intent');
    assert.notEqual(accepted.id, original.id);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=? AND body=?', accepted.id, accepted.body)[0].n, 1);
    await refresh(phone, channel);
    const after = await state(page, channel), pending = after.outbox.find(item => item.id === original.id);
    assert.equal(pending?.body, original.body);
    assert.equal(pending.sendState, 'conflict');
    assert.equal(after.messages.find(item => item.id === original.id)?.saved, false, 'Different immutable server text cannot become acceptance proof for the original intent');
    assert.equal(j.h.rows('SELECT body FROM shared_entries WHERE id=?', original.id)[0].body, different);
    assert.equal(writes(phone).filter(record => JSON.parse(record.body).id === accepted.id).length, 1);
    assert.equal(await page.locator(`[data-message-id="${original.id}"]`).getByText(body, {exact: true}).count(), 1);
    await writeSyntheticEvidence(phone, `current-${channel}-conflict-isolation-390x844`, {originalConflictRetained: true, independentIntentAccepted: true});
    await page.reload(); await input(page, channel).waitFor(); await idle(page, channel);
    assert.equal((await state(page, channel)).outbox.find(item => item.id === original.id)?.body, original.body);
    assert.equal((await state(page, channel)).messages.find(item => item.id === accepted.id)?.saved, true);
    assertPublicOnly(phone);
  });
});

test('two real tabs retain separate drafts across reload and merge every pending public or Muse UUID without overwriting', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const channel of channels) await t.test(channel, async () => {
    const first = await j.open({clock: false}), second = await j.open({context: first.context, clock: false});
    await ready(first, channel); await idle(first.page, channel);
    await ready(second, channel); await idle(second.page, channel);
    const draftA = `Fictional ${channel} draft for the first tab`, draftB = `Fictional ${channel} draft for the second tab`;
    await input(first.page, channel).fill(draftA); await input(second.page, channel).fill(draftB);
    assert.equal(await input(first.page, channel).inputValue(), draftA);
    assert.equal(await input(second.page, channel).inputValue(), draftB);
    await first.page.reload(); await input(first.page, channel).waitFor(); await idle(first.page, channel);
    assert.equal(await input(first.page, channel).inputValue(), draftA, 'Reload restores this tab’s draft rather than another tab’s later draft');
    await second.page.reload(); await input(second.page, channel).waitFor(); await idle(second.page, channel);
    assert.equal(await input(second.page, channel).inputValue(), draftB);
    for (const phone of [first, second]) phone.rule(record => record.path === '/shared/messages' && record.method === 'POST', async () => ({abort: true}), Infinity);
    await send(first.page, channel, draftA); await error(first.page, channel).waitFor(); await idle(first.page, channel);
    const originalA = (await state(first.page, channel)).outbox.find(item => item.body === scopedBody(channel, draftA));
    assert.ok(originalA);
    await send(second.page, channel, draftB); await error(second.page, channel).waitFor(); await idle(second.page, channel);
    const retained = await state(second.page, channel), originalB = retained.outbox.find(item => item.body === scopedBody(channel, draftB));
    assert.ok(originalB); assert.notEqual(originalB.id, originalA.id);
    assert.deepEqual(new Map(retained.outbox.map(item => [item.id, item.body])), new Map([[originalA.id, originalA.body], [originalB.id, originalB.body]]), 'A second tab cannot overwrite a first tab’s pending send');
    await input(first.page, channel).fill('Fictional later draft in first tab');
    await input(second.page, channel).fill('Fictional later draft in second tab');
    await refresh(first, channel);
    const after = await state(first.page, channel);
    assert.deepEqual(new Map(after.outbox.map(item => [item.id, item.body])), new Map([[originalA.id, originalA.body], [originalB.id, originalB.body]]));
    assert.equal(await input(first.page, channel).inputValue(), 'Fictional later draft in first tab');
    assert.equal(await input(second.page, channel).inputValue(), 'Fictional later draft in second tab');
    assertPublicOnly(first); assertPublicOnly(second);
  });
});
