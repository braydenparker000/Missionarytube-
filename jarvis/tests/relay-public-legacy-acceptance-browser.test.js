import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness,
  assertBrowserContained, writeSyntheticEvidence, deferred, SITE, RELAY_URL} from './helpers/relay-conversation-browser-fixture.js';
import {STORAGE_KEY, LEGACY_KEY} from '../public/assets/shared-store.js';
import {sharedStore} from '../backend/shared.js';

const stamp = '2026-01-01T00:00:00.000Z';
const draft = 'Fictional unfinished archived thought';
const row = (body, index = 0) => ({id: crypto.randomUUID(), role: 'user', body,
  createdAt: new Date(Date.parse(stamp) + index * 1000).toISOString()});
const mutations = phone => phone.records.filter(record => !['GET', 'HEAD', 'OPTIONS'].includes(record.method));
const state = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const historyRead = record => ['/shared/state', '/shared/changes'].includes(record.path) && record.method === 'GET';
const legacyFeed = process.env.JARVIS_LEGACY_ACCEPTANCE_FEED === 'legacy';

async function journey(t) {
  const browser = await launchQualifiedBrowser(t); if (!browser) return null;
  const h = createConversationFixture(t), pages = [];
  const empty = sharedStore(h.ctx, '/internal/shared/state');
  assert.equal(empty.status, 200, 'Initialize the empty real shared schema before offline no-write assertions');
  const emptyState = await empty.json(), staleThrough = String(h.rows('SELECT COALESCE(MAX(seq),0) AS n FROM public_changes')[0].n);
  t.after(() => closeConversationHarness(browser, h, pages));
  const open = async (legacy, cached, {measureWrites = false, journal = null, tabDraft = null} = {}) => {
    const phone = await openConversationPage(browser, h,
      process.env.RELAY_QA_PUBLIC_ROOT ? {root: process.env.RELAY_QA_PUBLIC_ROOT} : {});
    pages.push(phone);
    const original = JSON.stringify(legacy);
    await phone.context.addInitScript(({oldKey, key, original, cached, measureWrites, journal, tabDraft}) => {
      // Seed once. Reload exercises the actual persisted migration and cache.
      if (localStorage.getItem(oldKey) === null) {
        localStorage.setItem(oldKey, original); localStorage.setItem(key, cached);
        if (journal) localStorage.setItem(key + '.pending.' + journal.id, JSON.stringify(journal));
        if (tabDraft !== null) sessionStorage.setItem(key + '.composer.v1', tabDraft);
      }
      if (measureWrites) {
        globalThis.__legacyPersistenceWrites = [];
        const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
        const measured = name => name === oldKey || name.startsWith(key);
        Storage.prototype.setItem = function(name, value) {
          if (measured(name)) globalThis.__legacyPersistenceWrites.push({action: 'set', store: this === localStorage ? 'local' : 'session', key: name});
          return set.call(this, name, value);
        };
        Storage.prototype.removeItem = function(name) {
          if (measured(name)) globalThis.__legacyPersistenceWrites.push({action: 'remove', store: this === localStorage ? 'local' : 'session', key: name});
          return remove.call(this, name);
        };
      }
    }, {oldKey: LEGACY_KEY, key: STORAGE_KEY, original, cached: JSON.stringify(cached), measureWrites, journal, tabDraft});
    let readMode = 'offline';
    phone.rule(historyRead, async ({record, forward}) => {
      if (readMode === 'offline') return Response.json({error: 'Offline fictional fixture'}, {status: 503, headers: {'Access-Control-Allow-Origin': SITE}});
      // The same assertions can explicitly exercise the old history transport;
      // unsupported changes is distinct from the fixture's offline outage.
      if (legacyFeed && record.path === '/shared/changes') return Response.json({error: 'Fictional legacy route unavailable'}, {status: 404, headers: {'Access-Control-Allow-Origin': SITE}});
      if (readMode === 'stale' && record.path === '/shared/changes') {
        // Serve the honest earlier fence. A later committed cursor is rejected
        // by that older view; never forge an empty current complete checkpoint.
        const after = new URL(record.url).searchParams.get('cursor').split(':')[1];
        return h.fixture.request('/shared/changes?cursor=' + encodeURIComponent(`pc2:${after}:${staleThrough}`), {headers: {Origin: SITE}});
      }
      const response = await forward();
      if (readMode !== 'stale' && !legacyFeed) return response;
      const data = readMode === 'stale' ? emptyState : await response.json();
      return Response.json({...data, ...(legacyFeed ? {coordinationVersion: 1} : {})}, {status: response.status, headers: response.headers});
    }, Infinity);
    return {phone, original, online() { readMode = 'online'; }, offline() { readMode = 'offline'; }, stale() { readMode = 'stale'; }};
  };
  return {h, open};
}
async function idle(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById('relay-status');
    return status && !/Refreshing|Opening|Sending/.test(status.textContent);
  });
}
async function load(phone, reload = false) {
  if (reload) await phone.page.reload(); else await phone.page.goto(RELAY_URL);
  await phone.page.locator('#message-text').waitFor(); await idle(phone.page);
}
async function refresh(phone) {
  const response = phone.page.waitForResponse(response => historyRead({path: new URL(response.url()).pathname, method: response.request().method()}));
  await phone.page.evaluate(() => dispatchEvent(new Event('online'))); await response; await idle(phone.page);
}
const cache = (messages, legacyPending) => ({version: 1, messages, posts: [], outbox: [], composer: draft,
  legacyPending, syncedAt: '2026-01-02T00:00:00.000Z', mode: 'github-publications'});
const old = messages => ({key: 'a'.repeat(64), messages, outbox: [], composer: draft});

async function assertLocal(session, originals, h) {
  const {phone, original} = session, {page} = phone, saved = await state(page);
  const expected = new Map(originals.map(message => [message.id, message.body]));
  assert.deepEqual(new Map(saved.messages.map(message => [message.id, message.body])), expected, 'Every irreplaceable old row remains in the local store');
  assert.ok(saved.messages.every(message => message.saved !== true && message.localOnly === true), 'An old inbox flag cannot prove shared-public acceptance');
  assert.equal(await page.locator('#messages [data-message-id]').count(), originals.length, 'All old text remains readable, including beyond the accepted cache bound');
  for (const message of [originals[0], originals.at(-1)]) {
    const visible = page.locator(`[data-message-id="${message.id}"]`);
    assert.equal(await visible.getByText(message.body, {exact: true}).count(), 1);
    const status = await visible.locator('.message-time').textContent();
    assert.match(status, /Local history.*on this device/i); assert.doesNotMatch(status, /Awaiting reply|Saved|Sending|Queued/i);
  }
  assert.equal(await page.locator('#message-text').inputValue(), draft);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), original, 'The original old-store bytes remain unchanged');
  assert.deepEqual(saved.outbox, []);
  assert.deepEqual(await page.evaluate(key => Object.keys(localStorage).filter(name => name.startsWith(key + '.pending.')), STORAGE_KEY), []);
  assert.deepEqual(mutations(phone), [], 'Local restore, reload and complete reads must not mutate any API');
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE kind=\'user\'')[0].n, 0, 'Old text was not silently published');
  assert.equal(phone.records.some(record => record.path.startsWith('/v1/') || record.path === '/shared/migrate'), false);
  assertBrowserContained(phone);
}

test('inherited old-inbox saved flags remain local through offline load, reload and an empty shared GET', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const flag of [true, false]) await t.test(flag ? 'cached legacy flag' : 'already normalized flag with original raw history', async () => {
    const local = row(`Fictional inherited saved thought with flag ${flag}`), session = await j.open(old([local]), cache([{...local, saved: true}], flag));
    await load(session.phone); await assertLocal(session, [local], j.h);
    await load(session.phone, true); await assertLocal(session, [local], j.h);
    session.online(); await refresh(session.phone); await assertLocal(session, [local], j.h);
    await load(session.phone, true); await assertLocal(session, [local], j.h);
    await writeSyntheticEvidence(session.phone, `current-inherited-legacy-${flag ? 'flagged' : 'normalized'}-390x844`, {localRows: 1, mutations: 0, exactRawRetained: true});
  });
});

test('more than 250 inherited old rows and a previously truncated cache recover without publication authority', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  for (const truncated of [false, true]) await t.test(truncated ? 'normalized cache already limited to 250' : 'flagged cache still contains all 301', async () => {
    const local = Array.from({length: 301}, (_, index) => row(`Fictional irreplaceable archived thought ${index + 1}`, index));
    const cached = (truncated ? local.slice(-250) : local).map(message => ({...message, saved: true}));
    const session = await j.open(old(local), cache(cached, !truncated));
    await load(session.phone); await assertLocal(session, local, j.h);
    await load(session.phone, true); await assertLocal(session, local, j.h);
    session.online(); await refresh(session.phone); await assertLocal(session, local, j.h);
    await load(session.phone, true); await assertLocal(session, local, j.h);
    await writeSyntheticEvidence(session.phone, `current-inherited-legacy-301-${truncated ? 'recovered' : 'retained'}-390x844`, {localRows: 301, mutations: 0, exactRawRetained: true});
  });
});

test('only exact shared receipts confirm inherited rows while genuine acceptance survives stale reads and offline reload', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const inherited = row('Fictional inherited row later proved public'), unconfirmed = row('Fictional different archived row remains local', 1);
  const genuine = row('Fictional independently accepted shared row', 2), reply = {id: crypto.randomUUID(), role: 'assistant', kind: 'reply', replyTo: genuine.id,
    body: 'Fictional public reply with its original linked UUID', createdAt: '2026-10-08T06:00:00.000Z'};
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: [inherited, genuine]}).status, 200);
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/reply', reply).status, 201);
  const session = await j.open(old([inherited, unconfirmed]), cache([{...inherited, saved: true}, {...unconfirmed, saved: true}], true)), {phone} = session;
  await load(phone);
  assert.ok((await state(phone.page)).messages.every(message => message.saved !== true), 'Before a public receipt, inherited flags remain unconfirmed');
  session.online(); await refresh(phone);
  const proved = await state(phone.page), accepted = [inherited, genuine, reply];
  for (const expected of accepted) {
    const actual = proved.messages.find(message => message.id === expected.id);
    assert.equal(actual?.body, expected.body); assert.equal(actual?.saved, true); assert.equal(actual?.replyTo, expected.replyTo);
  }
  assert.equal(proved.messages.find(message => message.id === unconfirmed.id)?.saved, false);
  session.stale();
  const observe = async () => {
    const stored = await state(phone.page);
    for (const expected of accepted) {
      const actual = stored.messages.find(message => message.id === expected.id);
      assert.equal(actual?.body, expected.body); assert.equal(actual?.saved, true); assert.equal(actual?.replyTo, expected.replyTo);
      assert.equal(await phone.page.locator(`[data-message-id="${expected.id}"]`).count(), 1);
    }
    assert.equal(stored.messages.find(message => message.id === unconfirmed.id)?.saved, false);
    assert.deepEqual(stored.outbox, []); assert.deepEqual(mutations(phone), []);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
    assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
    assertBrowserContained(phone);
  };
  await refresh(phone); await observe();
  await phone.page.evaluate(key => {const stored = JSON.parse(localStorage.getItem(key)); stored.legacyPending = true; localStorage.setItem(key, JSON.stringify(stored));}, STORAGE_KEY);
  session.offline(); await load(phone, true); await observe();
  session.stale(); await refresh(phone); await observe(); await load(phone, true); await observe();
  await writeSyntheticEvidence(phone, 'current-legacy-exact-public-proof-390x844', {acceptedRows: 3, localRows: 1, mutations: 0, replyAssociationRetained: true});
});

test('same-ID public body or role collisions and duplicate text never prove acceptance of an inherited tuple', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const bodyCollision = row('Fictional original archived body with a colliding UUID'), roleCollision = row('Fictional original archived user identity', 1), duplicate = row('Fictional shared and archived text with distinct UUIDs', 2);
  const otherBody = {...bodyCollision, body: 'Fictional different body already in the public inbox'}, otherIdentity = row(duplicate.body, 3), target = row('Fictional actual public reply target', 4);
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: [otherBody, otherIdentity, target]}).status, 200);
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/reply', {...roleCollision, role: 'assistant', replyTo: target.id}).status, 201);
  const originals = [bodyCollision, roleCollision, duplicate], session = await j.open(old(originals), cache(originals.map(message => ({...message, saved: true})), false)), {phone} = session;
  await load(phone); session.online(); await refresh(phone); await load(phone, true);
  const stored = await state(phone.page);
  for (const expected of originals) {
    const actual = stored.messages.find(message => message.id === expected.id);
    assert.equal(actual?.body, expected.body); assert.equal(actual?.role, 'user'); assert.equal(actual?.saved, false);
    assert.match(await phone.page.locator(`[data-message-id="${expected.id}"] .message-time`).textContent(), /Local history.*on this device/i);
  }
  assert.equal(stored.messages.find(message => message.id === otherIdentity.id)?.saved, true, 'A genuinely accepted different UUID stays independently accepted');
  assert.deepEqual(stored.outbox, []); assert.deepEqual(mutations(phone), []);
  assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
  assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
  assertBrowserContained(phone);
});

test('legacy flags never send old text while an explicit existing public queue keeps and accepts its original UUID', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const inherited = row('Fictional inherited old outbox flag with no public intent'), queued = {...row('Fictional current explicit public queued intent', 1), saved: false, sendState: 'queued', type: 'message'};
  const legacy = old([{...inherited, saved: true, sendState: 'sending'}]); legacy.outbox = [{...inherited, saved: false, type: 'message'}];
  const cached = cache([{...inherited, saved: true}, queued], true); cached.outbox = [queued];
  const session = await j.open(legacy, cached), {phone} = session;
  await load(phone); await load(phone, true);
  const waiting = await state(phone.page);
  assert.equal(waiting.messages.find(message => message.id === inherited.id)?.saved, false);
  assert.deepEqual(waiting.outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]]);
  assert.deepEqual(mutations(phone), [], 'Offline restore does not attempt any writes');
  assert.deepEqual(await phone.page.evaluate(key => Object.keys(localStorage).filter(name => name.startsWith(key + '.pending.')), STORAGE_KEY), [STORAGE_KEY + '.pending.' + queued.id]);
  session.online(); await refresh(phone);
  const accepted = await state(phone.page), actual = accepted.messages.find(message => message.id === queued.id);
  assert.equal(actual?.body, queued.body); assert.equal(actual?.saved, true);
  assert.equal(accepted.messages.find(message => message.id === inherited.id)?.saved, false);
  assert.deepEqual(accepted.outbox, []);
  assert.deepEqual(mutations(phone).map(record => [record.method, record.path, JSON.parse(record.body)]), [['POST', '/shared/messages', {id: queued.id, body: queued.body}]], 'Only the independently authorized current public UUID may be sent');
  assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', queued.id)[0].n, 1);
  assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', inherited.id)[0].n, 0);
  assert.equal(phone.records.some(record => record.path.startsWith('/v1/') || record.path === '/shared/migrate'), false);
  assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
  assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
  assertBrowserContained(phone);
});

test('301 shared-confirmed old rows retain exact acceptance evidence outside the ordinary cache through stale reads and offline reload', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const originals = Array.from({length: 301}, (_, index) => row(`Fictional archived row with genuine subsequent shared receipt ${index + 1}`, index));
  assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: originals}).status, 200);
  const session = await j.open(old(originals), cache(originals.map(message => ({...message, saved: true})), true)), {phone} = session;
  await load(phone);
  assert.ok((await state(phone.page)).messages.every(message => message.saved !== true), 'The old inbox flag alone is unconfirmed');
  session.online(); await refresh(phone);
  const observe = async () => {
    const stored = await state(phone.page);
    assert.equal(stored.messages.length, 301, 'Confirmed old history retains its own evidence beyond the ordinary 250-row cache');
    assert.equal(await phone.page.locator('#messages [data-message-id]').count(), 301);
    for (const original of originals) {
      const actual = stored.messages.find(message => message.id === original.id);
      assert.equal(actual?.body, original.body); assert.equal(actual?.saved, true); assert.equal(actual?.legacyHistory, true);
      assert.deepEqual(actual.sharedAcceptance, {version: 1, id: original.id, role: original.role, body: original.body, replyTo: null});
    }
    for (const original of [originals[0], originals.at(-1)]) {
      const visible = phone.page.locator(`[data-message-id="${original.id}"]`);
      assert.equal(await visible.getByText(original.body, {exact: true}).count(), 1);
      assert.doesNotMatch(await visible.locator('.message-time').textContent(), /Local history|Queued|Sending/i);
    }
    assert.deepEqual(stored.outbox, []); assert.deepEqual(mutations(phone), []);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
    assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
    assertBrowserContained(phone);
  };
  await observe(); session.stale(); await refresh(phone); await observe();
  session.offline(); await load(phone, true); await observe();
  session.stale(); await refresh(phone); await observe(); await load(phone, true); await observe();
  assert.ok(phone.records.some(record => historyRead(record) && (record.path === '/shared/state' ? new URL(record.url).searchParams.get('after') !== '0' : /^pc2:[1-9]\d*:\d+$/.test(new URL(record.url).searchParams.get('cursor')))), 'Exact acceptance is established by a complete paginated shared read');
  await writeSyntheticEvidence(phone, 'current-legacy-301-genuine-public-proof-390x844', {acceptedLegacyRows: 301, mutations: 0, exactRawRetained: true, completePaginationExercised: true});
});

test('initial raw/cache UUID conflicts show an accurate retention error before any queue, draft or API mutation', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const original = row('Fictional original raw body before an initial cache collision');
  for (const change of [{body: 'Fictional conflicting cached body'}, {role: 'assistant'}, {replyTo: crypto.randomUUID()}]) {
    const conflicting = {...original, ...change, saved: true};
    conflicting.sharedAcceptance = {version: 1, id: conflicting.id, role: conflicting.role, body: conflicting.body, replyTo: conflicting.replyTo || null};
    const queued = {...row('Fictional separately queued public intent to preserve', 1), saved: false, type: 'message'};
    const cached = cache([conflicting, queued], false); cached.outbox = [queued];
    // The same initialization script seeds once, then instruments persistence
    // before the first application module attempts to restore the queue.
    const session = await j.open(old([original]), cached, {measureWrites: true}), {phone} = session;
    await phone.page.goto(RELAY_URL);
    await phone.page.getByRole('heading', {name: 'Unable to save on this device', exact: true}).waitFor();
    assert.match(await phone.page.locator('#content').textContent(), /different|conflict|mismatch/i);
    assert.match(await phone.page.locator('#content').textContent(), /not.*overwritten|not.*changed|unchanged|preserved/i);
    assert.equal(await phone.page.locator('#message-text').count(), 0);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), JSON.stringify(cached));
    assert.deepEqual(await phone.page.evaluate(() => globalThis.__legacyPersistenceWrites), [], 'Initial association preflight occurs before all public storage writes');
    assert.deepEqual(mutations(phone), [], 'A conflicting original cannot authorize a public send');
    assert.equal(phone.records.some(record => record.path.startsWith('/v1/') || record.path === '/shared/migrate'), false);
    assertBrowserContained(phone);
  }
});

test('legacy queue overlap: exact unproved intents survive offline reload and an empty shared read until their original POST receipt', {timeout: 120000}, async t => {
  for (const flag of [true, false]) for (const placement of ['aggregate', 'journal', 'both']) await t.test(`${flag}/${placement}`, async child => {
    const j = await journey(child); if (!j) return;
    const original = row(`Fictional existing exact overlapping public intent ${flag} ${placement}`), queued = {...original, saved: false, type: 'message', sendState: 'queued'};
    const cached = cache([{...original, saved: true}], flag); cached.outbox = placement === 'journal' ? [] : [queued];
    const session = await j.open(old([original]), cached, {journal: placement === 'aggregate' ? null : queued}), {phone} = session;
    const observe = async () => {
      const stored = await state(phone.page), actual = stored.messages.find(message => message.id === original.id);
      assert.equal(actual?.id, queued.id); assert.equal(actual?.body, queued.body); assert.equal(actual?.saved, false); assert.equal(actual?.sharedAcceptance, undefined);
      assert.deepEqual(stored.outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]], 'Inherited saved flags cannot consume an explicit current intent');
      assert.equal(await phone.page.locator(`[data-message-id="${queued.id}"]`).getByText(queued.body, {exact: true}).count(), 1);
      assert.doesNotMatch(await phone.page.locator(`[data-message-id="${queued.id}"] .message-time`).textContent(), /Awaiting reply|Saved/i);
      const journal = await phone.page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY + '.pending.' + queued.id);
      assert.equal(journal?.id, queued.id); assert.equal(journal?.body, queued.body);
      assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
      assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
      assertBrowserContained(phone);
    };
    await load(phone); await observe(); assert.deepEqual(mutations(phone), []);
    await load(phone, true); await observe(); assert.deepEqual(mutations(phone), []);
    const entered = deferred(), release = deferred(); child.after(() => release.resolve());
    phone.rule(record => record.method === 'POST' && record.path === '/shared/messages', async ({record, forward}) => {
      entered.resolve(record); await release.promise; return forward();
    });
    session.online(); const refreshed = refresh(phone); await entered.promise;
    await observe();
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, 0, 'The complete empty GET cannot establish acceptance before the queued POST reaches storage');
    assert.ok(phone.records.some(record => historyRead(record) && record.status === 200));
    assert.deepEqual(mutations(phone).map(record => JSON.parse(record.body)), [{id: queued.id, body: queued.body}]);
    release.resolve(); await refreshed;
    const accepted = await state(phone.page), actual = accepted.messages.find(message => message.id === original.id);
    assert.equal(actual?.saved, true); assert.deepEqual(actual.sharedAcceptance, {version: 1, id: original.id, role: 'user', body: original.body, replyTo: null});
    assert.deepEqual(accepted.outbox, []);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), STORAGE_KEY + '.pending.' + queued.id), null);
    assert.equal(j.h.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE id=?', original.id)[0].n, 1);
    await refresh(phone); await load(phone, true);
    assert.deepEqual(mutations(phone).map(record => [record.method, record.path, JSON.parse(record.body)]), [['POST', '/shared/messages', {id: queued.id, body: queued.body}]], 'Acceptance and reload never allocate or send a replacement UUID');
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
    assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
    assertBrowserContained(phone);
    if (flag && placement === 'both') await writeSyntheticEvidence(phone, 'current-legacy-exact-queue-overlap-390x844', {originalUuidAcceptedOnce: true, receiptRequired: true, rawAndDraftRetained: true});
  });
});

test('legacy queue overlap: actual prior shared proof drains redundant same-UUID aggregate and journal intents without another POST', {timeout: 120000}, async t => {
  for (const flag of [true, false]) for (const placement of ['aggregate', 'journal', 'both']) await t.test(`${flag}/${placement}`, async child => {
    const j = await journey(child); if (!j) return;
    const original = row(`Fictional actually received public overlap ${flag} ${placement}`), queued = {...original, saved: false, type: 'message'};
    assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: [original]}).status, 200);
    const session = await j.open(old([original]), cache([{...original, saved: true}], flag)), {phone} = session;
    session.online(); await load(phone);
    const proved = await state(phone.page), genuine = proved.messages.find(message => message.id === original.id);
    assert.equal(genuine?.saved, true); assert.deepEqual(genuine.sharedAcceptance, {version: 1, id: original.id, role: 'user', body: original.body, replyTo: null});
    await phone.page.evaluate(({key, id, queued, placement, flag}) => {
      const stored = JSON.parse(localStorage.getItem(key)); stored.legacyPending = flag; stored.outbox = placement === 'journal' ? [] : [queued];
      localStorage.setItem(key, JSON.stringify(stored));
      if (placement !== 'aggregate') localStorage.setItem(key + '.pending.' + id, JSON.stringify(queued));
    }, {key: STORAGE_KEY, id: queued.id, queued, placement, flag});
    session.offline(); await load(phone, true);
    const observe = async () => {
      const stored = await state(phone.page), accepted = stored.messages.find(message => message.id === queued.id);
      assert.deepEqual(stored.outbox, []); assert.equal(accepted?.id, original.id); assert.equal(accepted?.body, original.body); assert.equal(accepted?.saved, true);
      assert.deepEqual(accepted.sharedAcceptance, genuine.sharedAcceptance);
      assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), STORAGE_KEY + '.pending.' + queued.id), null);
      assert.deepEqual(mutations(phone), [], 'A genuine prior exact receipt finishes the redundant intent without another public write');
      assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
      assert.equal(await phone.page.locator('#message-text').inputValue(), draft);
      assertBrowserContained(phone);
    };
    await observe(); session.stale(); await refresh(phone); await observe(); await load(phone, true); await observe();
  });
});

test('legacy queue overlap: conflicting aggregate or journal text cannot overwrite proved or unproved history during initial restore', {timeout: 120000}, async t => {
  for (const proven of [false, true]) for (const placement of ['aggregate', 'journal']) await t.test(`${proven}/${placement}`, async child => {
    const j = await journey(child); if (!j) return;
    const original = row(`Fictional protected original before pending collision ${proven} ${placement}`), queued = {...original, body: 'Fictional different pending body with the same UUID', saved: false, type: 'message'};
    const cached = cache([{...original, saved: true}], false);
    if (!proven && placement === 'aggregate') cached.outbox = [queued];
    if (proven) assert.equal(sharedStore(j.h.ctx, '/internal/shared/import', {messages: [original]}).status, 200);
    const session = await j.open(old([original]), cached, {measureWrites: true, journal: !proven && placement === 'journal' ? queued : null, tabDraft: draft}), {phone} = session;
    let beforeShared = JSON.stringify(cached), beforeJournal = placement === 'journal' ? JSON.stringify(queued) : null;
    if (proven) {
      session.online(); await load(phone);
      const received = (await state(phone.page)).messages.find(message => message.id === original.id);
      assert.equal(received?.saved, true); assert.deepEqual(received.sharedAcceptance, {version: 1, id: original.id, role: 'user', body: original.body, replyTo: null});
      beforeShared = await phone.page.evaluate(({key, queued, placement}) => {
        const stored = JSON.parse(localStorage.getItem(key)); stored.outbox = placement === 'aggregate' ? [queued] : [];
        const raw = JSON.stringify(stored); localStorage.setItem(key, raw);
        if (placement === 'journal') localStorage.setItem(key + '.pending.' + queued.id, JSON.stringify(queued));
        return raw;
      }, {key: STORAGE_KEY, queued, placement});
      session.offline(); await phone.page.reload();
    } else await phone.page.goto(RELAY_URL);
    await phone.page.waitForFunction(() => document.getElementById('message-text') || document.querySelector('#content h1'));
    assert.equal(await phone.page.getByRole('heading', {name: 'Unable to save on this device', exact: true}).count(), 1, 'The association fails before the conflicting queue replaces the original history');
    assert.match(await phone.page.locator('#content').textContent(), /different|conflict|mismatch/i);
    assert.match(await phone.page.locator('#content').textContent(), /not.*overwritten|not.*changed|unchanged|preserved/i);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), beforeShared);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), session.original);
    assert.equal(await phone.page.evaluate(key => localStorage.getItem(key), STORAGE_KEY + '.pending.' + queued.id), beforeJournal);
    assert.equal(await phone.page.evaluate(key => sessionStorage.getItem(key), STORAGE_KEY + '.composer.v1'), draft);
    assert.deepEqual(await phone.page.evaluate(() => globalThis.__legacyPersistenceWrites), []);
    assert.deepEqual(mutations(phone), []); assertBrowserContained(phone);
  });
});
