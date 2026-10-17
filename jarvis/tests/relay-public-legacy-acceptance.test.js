import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicDeliveryStore} from '../public/assets/public-delivery-store.js';
import {readState, mergeState, STORAGE_KEY, LEGACY_KEY} from '../public/assets/shared-store.js';

class Storage {
  values = new Map(); writes = [];
  get length() {return this.values.size;}
  key(index) {return [...this.values.keys()][index] ?? null;}
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {this.writes.push({action: 'set', key}); this.values.set(key, String(value));}
  removeItem(key) {this.writes.push({action: 'remove', key}); this.values.delete(key);}
}
const stamp = '2026-01-01T00:00:00.000Z';
const row = (body, index = 0) => ({id: crypto.randomUUID(), role: 'user', body, createdAt: new Date(Date.parse(stamp) + index * 1000).toISOString()});
const state = (messages, legacyPending = true, outbox = []) => ({version: 1, messages, posts: [], outbox, composer: 'Fictional unfinished separate draft', legacyPending, mode: 'github-publications', syncedAt: '2026-01-02T00:00:00.000Z'});
const evidence = message => ({version: 1, id: message.id, role: message.role, body: message.body, replyTo: message.replyTo || null});
const adapter = (storage, tabStorage = new Storage()) => createPublicDeliveryStore({storage, tabStorage, key: STORAGE_KEY, read: readState});
const journals = storage => [...storage.values.keys()].filter(key => key.startsWith(STORAGE_KEY + '.pending.'));
function seed(legacy, cached) {
  const storage = new Storage(), raw = JSON.stringify({key: 'a'.repeat(64), messages: legacy, outbox: [], composer: 'Fictional unfinished separate draft'});
  storage.setItem(LEGACY_KEY, raw); if (cached) storage.setItem(STORAGE_KEY, JSON.stringify(cached));
  return {storage, raw};
}

test('flagged and previously normalized saved old rows are classified and recovered before bounded caching', () => {
  for (const truncated of [false, true]) {
    const legacy = Array.from({length: 301}, (_, index) => ({...row(`Fictional irreplaceable old row ${index + 1}`, index), saved: true}));
    const {storage, raw} = seed(legacy, state(truncated ? legacy.slice(-250) : legacy, !truncated));
    const delivery = adapter(storage), current = delivery.commit(delivery.restore());
    const refreshed = delivery.commit(mergeState(current, {messages: [], posts: []})), reloaded = adapter(storage).restore();
    for (const observed of [current, refreshed, reloaded]) {
      assert.deepEqual(new Map(observed.messages.map(message => [message.id, message.body])), new Map(legacy.map(message => [message.id, message.body])));
      assert.ok(observed.messages.every(message => message.saved === false && message.localOnly === true && message.legacyHistory === true));
      assert.ok(observed.messages.every(message => message.sharedAcceptance === undefined), 'Old inbox saved flags and sync timestamps are not shared receipt evidence');
      assert.deepEqual(observed.outbox, []);
    }
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).messages.length, 301, 'Irreplaceable old rows are not part of the accepted-cache cap');
    assert.deepEqual(journals(storage), []); assert.equal(storage.getItem(LEGACY_KEY), raw);
  }
});

test('raw old-store receipt-shaped fields are ignored and a migration flag alone cannot assert public acceptance', () => {
  const local = row('Fictional raw row carrying old receipt-shaped fields');
  const decorated = {...local, saved: true, sharedAcceptance: evidence(local)};
  const {storage, raw} = seed([decorated]);
  const delivery = adapter(storage), recovered = delivery.commit(delivery.restore());
  assert.equal(recovered.messages[0].saved, false); assert.equal(recovered.messages[0].sharedAcceptance, undefined);
  assert.equal(storage.getItem(LEGACY_KEY), raw); assert.deepEqual(journals(storage), []);
  const noRaw = new Storage(); noRaw.setItem(STORAGE_KEY, JSON.stringify(state([{...local, saved: true}])));
  const noRawDelivery = adapter(noRaw), flagged = noRawDelivery.commit(noRawDelivery.restore());
  assert.equal(flagged.messages[0].saved, false, 'An unresolved migration flag needs revalidation even without a readable old store');
  assert.equal(flagged.messages[0].body, local.body); assert.deepEqual(flagged.outbox, []); assert.deepEqual(journals(noRaw), []);
});

test('mixed legacy history, genuine public rows and explicit public queues keep their separate evidence and original UUIDs', () => {
  const legacy = Array.from({length: 301}, (_, index) => ({...row(`Fictional old local row ${index + 1}`, index), saved: true}));
  const genuine = Array.from({length: 251}, (_, index) => row(`Fictional genuine public receipt ${index + 1}`, 1000 + index));
  const receipts = mergeState(state([], false), {messages: genuine, posts: []}).messages;
  const grandfathered = {...row('Fictional unrelated existing shared cache row', 2000), saved: true};
  const queued = {...row('Fictional current explicit queued public intent', 3000), saved: false, type: 'message'};
  const {storage, raw} = seed(legacy, state([...legacy, ...receipts, grandfathered, queued], true, [queued]));
  const delivery = adapter(storage), current = delivery.commit(delivery.restore()), cache = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(current.messages.length, 554, 'Runtime history retains all three classes');
  assert.equal(current.messages.filter(message => message.legacyHistory).length, 301);
  assert.ok(current.messages.filter(message => message.legacyHistory).every(message => message.saved === false));
  assert.equal(current.messages.find(message => message.id === grandfathered.id)?.saved, true, 'An unrelated existing public row is not guessed to be an old inbox row');
  assert.ok(current.messages.filter(message => genuine.some(receipt => receipt.id === message.id)).every(message => message.saved === true));
  assert.equal(cache.messages.filter(message => message.saved === true && !message.legacyHistory).length, 250, 'Only ordinary accepted cache rows are bounded');
  assert.equal(cache.messages.filter(message => message.legacyHistory).length, 301);
  assert.deepEqual(current.outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]]);
  assert.deepEqual(journals(storage), [delivery.prefix + queued.id]);
  assert.equal(JSON.parse(storage.getItem(delivery.prefix + queued.id)).body, queued.body);
  assert.equal(storage.getItem(LEGACY_KEY), raw);
});

test('more than 250 exact confirmed legacy receipts keep tuple-bound evidence through stale reads and reload', () => {
  const legacy = Array.from({length: 301}, (_, index) => row(`Fictional subsequently public old row ${index + 1}`, index));
  const {storage, raw} = seed(legacy, state(legacy.map(message => ({...message, saved: true}))));
  const delivery = adapter(storage), local = delivery.commit(delivery.restore());
  const proved = delivery.commit(mergeState(local, {messages: legacy, posts: []}));
  const stale = delivery.commit(mergeState(proved, {messages: [], posts: []}));
  const cached = JSON.parse(storage.getItem(STORAGE_KEY)); cached.legacyPending = true; storage.setItem(STORAGE_KEY, JSON.stringify(cached));
  const reloaded = adapter(storage).restore();
  for (const observed of [proved, stale, reloaded]) {
    assert.equal(observed.messages.length, 301);
    for (const original of legacy) {
      const actual = observed.messages.find(message => message.id === original.id);
      assert.equal(actual?.saved, true); assert.equal(actual?.legacyHistory, true); assert.equal(actual?.localOnly, undefined);
      assert.deepEqual(actual.sharedAcceptance, evidence(original), 'A receipt marker binds this exact immutable identity, role, body and reply target');
    }
    assert.deepEqual(observed.outbox, []);
  }
  assert.equal(storage.getItem(LEGACY_KEY), raw); assert.deepEqual(journals(storage), []);
});

test('unproved cache merges and mismatched receipt markers cannot turn inherited text into an accepted row', () => {
  const local = row('Fictional tuple to revalidate');
  const corruptions = [undefined, {...evidence(local), version: 2}, {...evidence(local), id: crypto.randomUUID()}, {...evidence(local), body: 'Fictional other body'}, {...evidence(local), role: 'assistant'}, {...evidence(local), replyTo: crypto.randomUUID()}];
  for (const sharedAcceptance of corruptions) {
    const {storage, raw} = seed([local], state([{...local, saved: true, ...(sharedAcceptance ? {sharedAcceptance} : {})}], false));
    const tabStorage = new Storage(), delivery = adapter(storage, tabStorage), current = delivery.restore();
    assert.equal(current.messages[0].saved, false); assert.equal(current.messages[0].body, local.body);
    storage.writes = []; tabStorage.writes = [];
    const anotherCache = delivery.external(current);
    assert.equal(anotherCache.messages[0].saved, false); assert.equal(anotherCache.messages[0].sharedAcceptance, undefined);
    assert.deepEqual(storage.writes, []); assert.deepEqual(tabStorage.writes, [], 'Cache association checks cannot write a new receipt or replace a tab draft');
    const committed = delivery.commit(anotherCache);
    assert.equal(committed.messages[0].saved, false); assert.equal(committed.messages[0].sharedAcceptance, undefined);
    assert.equal(storage.getItem(LEGACY_KEY), raw); assert.deepEqual(journals(storage), []);
  }
});

test('only an exact received UUID, role, body and reply target upgrades positively associated old history', () => {
  const local = row('Fictional local content awaiting exact shared evidence');
  const {storage} = seed([local], state([{...local, saved: true}], false));
  const delivery = adapter(storage), current = delivery.commit(delivery.restore());
  for (const receipt of [{...local, body: 'Fictional different public body'}, {...local, role: 'assistant'}, {...local, replyTo: crypto.randomUUID()}]) {
    const refused = delivery.commit(mergeState(current, {messages: [receipt], posts: []}));
    assert.equal(refused.messages[0].body, local.body); assert.equal(refused.messages[0].role, 'user'); assert.equal(refused.messages[0].saved, false); assert.equal(refused.messages[0].sharedAcceptance, undefined);
  }
  const proved = delivery.commit(mergeState(current, {messages: [local], posts: []}));
  assert.equal(proved.messages[0].saved, true); assert.deepEqual(proved.messages[0].sharedAcceptance, evidence(local));
  assert.throws(() => mergeState(proved, {messages: [{...local, body: 'Fictional later attempt to rewrite accepted immutable text'}], posts: []}), /already accepted immutable/i);
  assert.equal(adapter(storage).restore().messages[0].body, local.body);
});

test('initial raw/cache UUID conflicts fail before restoring independent queues or writing drafts, journals or aggregate state', () => {
  const original = row('Fictional original raw old-inbox body');
  const changes = [{body: 'Fictional different cached body'}, {role: 'assistant'}, {replyTo: crypto.randomUUID()}];
  for (const change of changes) for (const proven of [false, true]) {
    const conflicting = {...original, ...change, saved: true};
    if (proven) conflicting.sharedAcceptance = evidence(conflicting);
    const queued = {...row('Fictional independent public queue to preserve', 1), saved: false, type: 'message'};
    const {storage, raw} = seed([original], state([conflicting, queued], false, [queued]));
    const sharedRaw = storage.getItem(STORAGE_KEY), tabStorage = new Storage();
    tabStorage.setItem(STORAGE_KEY + '.composer.v1', 'Fictional existing tab draft');
    const tabRaw = new Map(tabStorage.values); storage.writes = []; tabStorage.writes = [];
    const delivery = adapter(storage, tabStorage);
    assert.throws(() => delivery.restore(), error => /different|conflict|mismatch/i.test(error.message) && /history|legacy|earlier|old/i.test(error.message));
    assert.equal(storage.getItem(LEGACY_KEY), raw, 'The original raw old history is not overwritten');
    assert.equal(storage.getItem(STORAGE_KEY), sharedRaw, 'The conflicting cache and independent original queue remain byte-identical');
    assert.deepEqual(storage.writes, [], 'Initial preflight cannot migrate a queue or write aggregate storage');
    assert.deepEqual(tabStorage.writes, [], 'Initial preflight cannot replace a tab draft');
    assert.deepEqual(tabStorage.values, tabRaw); assert.deepEqual(journals(storage), []);
    assert.deepEqual(JSON.parse(sharedRaw).outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]]);
  }
});

test('legacy queue overlap: inherited saved flags do not consume an exact explicit queued intent without shared evidence', () => {
  for (const flag of [true, false]) for (const placement of ['aggregate', 'journal', 'both']) {
    const original = row(`Fictional overlapping public intent ${flag} ${placement}`), queued = {...original, saved: false, type: 'message'};
    const cached = state([{...original, saved: true}], flag, placement === 'journal' ? [] : [queued]);
    const {storage, raw} = seed([original], cached), delivery = adapter(storage);
    if (placement !== 'aggregate') storage.setItem(delivery.prefix + queued.id, JSON.stringify(queued));
    const restored = delivery.restore(), committed = delivery.commit(restored);
    const empty = delivery.commit(mergeState(committed, {messages: [], posts: []})), reloaded = adapter(storage).restore();
    for (const observed of [restored, committed, empty, reloaded]) {
      assert.deepEqual(observed.outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]], `${flag}/${placement}: Only an actual receipt may finish this exact intent`);
      const message = observed.messages.find(message => message.id === original.id);
      assert.equal(message?.body, original.body); assert.equal(message?.saved, false); assert.equal(message?.sharedAcceptance, undefined);
      assert.equal(observed.composer, cached.composer);
    }
    assert.deepEqual(journals(storage), [delivery.prefix + queued.id]);
    assert.equal(storage.getItem(LEGACY_KEY), raw);
    const proved = delivery.commit(mergeState(reloaded, {messages: [original], posts: []}));
    assert.deepEqual(proved.outbox, []); assert.deepEqual(journals(storage), []);
    assert.deepEqual(proved.messages[0].sharedAcceptance, evidence(original));
    assert.equal(proved.messages[0].saved, true); assert.equal(proved.messages[0].id, queued.id);
  }
});

test('legacy queue overlap: a genuine prior exact receipt can finish a redundant aggregate or journal intent', () => {
  for (const flag of [true, false]) for (const placement of ['aggregate', 'journal', 'both']) {
    const original = row(`Fictional genuinely accepted overlapping intent ${flag} ${placement}`), queued = {...original, saved: false, type: 'message'};
    const received = mergeState(state([], false), {messages: [original], posts: []}).messages[0];
    const {storage, raw} = seed([original], state([received], flag, placement === 'journal' ? [] : [queued])), delivery = adapter(storage);
    if (placement !== 'aggregate') storage.setItem(delivery.prefix + queued.id, JSON.stringify(queued));
    const current = delivery.commit(delivery.restore()), stale = delivery.commit(mergeState(current, {messages: [], posts: []})), reload = adapter(storage).restore();
    for (const observed of [current, stale, reload]) {
      assert.deepEqual(observed.outbox, []); assert.equal(observed.messages[0].id, queued.id); assert.equal(observed.messages[0].body, queued.body);
      assert.equal(observed.messages[0].saved, true); assert.deepEqual(observed.messages[0].sharedAcceptance, evidence(original));
    }
    assert.deepEqual(journals(storage), []); assert.equal(storage.getItem(LEGACY_KEY), raw);
  }
});

test('legacy queue overlap: a conflicting queued tuple fails before restore, commit or external persistence and preserves genuine proof', () => {
  for (const proven of [false, true]) for (const placement of ['aggregate', 'journal']) for (const difference of placement === 'aggregate' ? ['body', 'role', 'replyTo', 'missingTarget'] : ['body', 'replyTo', 'missingTarget']) {
    const original = row(`Fictional original protected queued association ${proven} ${placement} ${difference}`);
    if (difference === 'missingTarget') original.replyTo = crypto.randomUUID();
    const queued = {...original, saved: false, type: 'message'};
    if (difference === 'body') queued.body = 'Fictional conflicting intent with the same UUID';
    else if (difference === 'role') queued.role = 'assistant';
    else if (difference === 'replyTo') queued.replyTo = crypto.randomUUID();
    else delete queued.replyTo;
    const known = proven ? mergeState(state([], false), {messages: [original], posts: []}).messages[0] : {...original, saved: true};
    const {storage, raw} = seed([original], state([known], false)), tabStorage = new Storage(), delivery = adapter(storage, tabStorage);
    tabStorage.setItem(STORAGE_KEY + '.composer.v1', 'Fictional existing independent tab draft');
    const current = delivery.restore();
    if (placement === 'aggregate') storage.setItem(STORAGE_KEY, JSON.stringify(state([known], false, [queued])));
    else storage.setItem(delivery.prefix + queued.id, JSON.stringify(queued));
    const beforeLocal = new Map(storage.values), beforeTab = new Map(tabStorage.values); storage.writes = []; tabStorage.writes = [];
    const conflict = error => /different|conflict|mismatch/i.test(error.message) && /history|legacy|earlier|old|queued/i.test(error.message);
    assert.throws(() => adapter(storage, tabStorage).restore(), conflict);
    assert.throws(() => delivery.external(current), conflict);
    assert.throws(() => delivery.commit({...current, composer: 'Fictional edited draft after the collision'}), conflict);
    assert.deepEqual(storage.writes, []); assert.deepEqual(tabStorage.writes, []);
    assert.deepEqual(storage.values, beforeLocal); assert.deepEqual(tabStorage.values, beforeTab);
    assert.equal(storage.getItem(LEGACY_KEY), raw);
    assert.equal(current.messages[0].body, original.body);
    if (proven) assert.deepEqual(current.messages[0].sharedAcceptance, evidence(original), 'A conflicting queue cannot replace a genuine immutable receipt');
  }
});
