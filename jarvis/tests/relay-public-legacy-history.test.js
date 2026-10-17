import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicDeliveryStore} from '../public/assets/public-delivery-store.js';
import {readState, mergeState, STORAGE_KEY, LEGACY_KEY} from '../public/assets/shared-store.js';
import {readMuse, mergeMuse, MUSE_STORAGE_KEY} from '../public/assets/muse-store.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';

class Storage {
  values = new Map();
  writes = [];
  get length() {return this.values.size;}
  key(index) {return [...this.values.keys()][index] ?? null;}
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {this.writes.push({action: 'set', key}); this.values.set(key, String(value));}
  removeItem(key) {this.writes.push({action: 'remove', key}); this.values.delete(key);}
}
const stamp = '2026-01-01T00:00:00.000Z';
const lanes = [
  {name: 'Relay', key: STORAGE_KEY, read: readState, merge: mergeState, prefix: ''},
  {name: 'Muse', key: MUSE_STORAGE_KEY, read: readMuse, merge: mergeMuse, prefix: MUSE_PREFIX}
];
const delivery = (storage, lane) => createPublicDeliveryStore({storage, tabStorage: new Storage(), key: lane.key, read: lane.read});
const journals = storage => [...storage.values.keys()].filter(key => key.includes('.pending.'));

test('old inbox history and flags stay local through persistence without becoming a public send', () => {
  const storage = new Storage(), lane = lanes[0];
  const legacy = {key: 'a'.repeat(64), messages: [
    {id: 'legacy-message', role: 'user', body: 'Fictional earlier local thought', createdAt: stamp},
    {id: crypto.randomUUID(), role: 'user', body: 'Fictional old inbox receipt', createdAt: stamp, saved: true, sendState: 'sending'}
  ], outbox: [], composer: 'Fictional unfinished old draft'};
  legacy.outbox = [{...legacy.messages[1], type: 'message'}];
  const original = JSON.stringify(legacy); storage.setItem(LEGACY_KEY, original);
  const adapter = delivery(storage, lane), current = adapter.commit(adapter.restore());
  assert.deepEqual(new Map(current.messages.map(message => [message.id, message.body])), new Map(legacy.messages.map(message => [message.id, message.body])));
  assert.ok(current.messages.every(message => message.saved === false), 'An old inbox flag does not establish acceptance by the shared public inbox');
  assert.equal(current.legacyPending, false, 'Old inbox access does not authorize automatic publication into the shared public inbox');
  assert.deepEqual(current.outbox, []); assert.deepEqual(journals(storage), []);
  assert.equal(current.composer, legacy.composer);
  const refreshed = adapter.commit(lane.merge(current, {messages: [], posts: []}));
  const reloaded = delivery(storage, lane).restore();
  assert.deepEqual(reloaded.messages, refreshed.messages);
  assert.deepEqual(reloaded.outbox, []); assert.deepEqual(journals(storage), []);
  assert.equal(storage.getItem(LEGACY_KEY), original, 'The original legacy store remains untouched');
});

test('cached legacy migration flags are disabled without discarding explicit public queued intents', () => {
  const storage = new Storage(), queued = {id: crypto.randomUUID(), role: 'user', body: 'Fictional explicit shared-public queued intent', createdAt: stamp, saved: false};
  const state = {version: 1, messages: [queued], posts: [], outbox: [queued], composer: 'Fictional later draft', legacyPending: true};
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
  const adapter = delivery(storage, lanes[0]), current = adapter.commit(adapter.restore());
  assert.equal(current.legacyPending, false);
  assert.deepEqual(current.outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]]);
  assert.deepEqual(journals(storage), [adapter.prefix + queued.id]);
  assert.equal(current.composer, state.composer);
});

for (const lane of lanes) {
  test(`${lane.name} retains local-only history across refresh, bounded caching, another tab, and reload`, () => {
    const storage = new Storage(), local = {id: 'local-history', role: 'user', body: lane.prefix + 'Fictional local history', createdAt: stamp};
    storage.setItem(lane.key, JSON.stringify({version: 1, messages: [local], outbox: [], composer: 'Fictional separate draft', ...(lane.name === 'Relay' ? {posts: []} : {})}));
    const adapter = delivery(storage, lane), current = adapter.commit(adapter.restore());
    const nonUuidReceipt = adapter.commit(lane.merge(current, {messages: [local], posts: []}));
    assert.equal(nonUuidReceipt.messages.find(message => message.id === local.id)?.saved, false, 'A legacy non-UUID identity cannot establish shared-inbox acceptance');
    const remote = Array.from({length: 251}, (_, index) => ({id: crypto.randomUUID(), role: 'user', body: lane.prefix + `Fictional accepted message ${index}`, createdAt: `2026-10-08T05:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`}));
    const full = adapter.commit(lane.merge(nonUuidReceipt, {messages: remote, posts: []}));
    assert.equal(full.messages.length, 252, 'Full runtime history includes the retained local text');
    const cache = JSON.parse(storage.getItem(lane.key));
    assert.equal(cache.messages.filter(message => message.saved === true).length, 250, 'Only accepted cache entries are bounded');
    assert.deepEqual(cache.messages.find(message => message.id === local.id)?.body, local.body);
    assert.equal(cache.messages.find(message => message.id === local.id)?.saved, false);
    const other = delivery(storage, lane); other.commit({...other.restore(), composer: 'Fictional draft in another tab'});
    const external = adapter.external(full);
    assert.equal(external.messages.length, 252);
    assert.equal(external.messages.find(message => message.id === local.id)?.body, local.body);
    const reloaded = delivery(storage, lane).restore();
    assert.equal(reloaded.messages.find(message => message.id === local.id)?.saved, false);
    assert.deepEqual(reloaded.outbox, []); assert.deepEqual(journals(storage), []);
  });

  test(`${lane.name} needs an exact matching UUID receipt before local history can become accepted`, () => {
    const storage = new Storage(), local = {id: crypto.randomUUID(), role: 'user', body: lane.prefix + 'Fictional original local text', createdAt: stamp};
    storage.setItem(lane.key, JSON.stringify({version: 1, messages: [local], outbox: [], composer: '', ...(lane.name === 'Relay' ? {posts: []} : {})}));
    const adapter = delivery(storage, lane), current = adapter.commit(adapter.restore());
    const collision = adapter.commit(lane.merge(current, {messages: [{...local, body: lane.prefix + 'Fictional different inbox text'}], posts: []}));
    assert.equal(collision.messages.find(message => message.id === local.id)?.body, local.body);
    assert.equal(collision.messages.find(message => message.id === local.id)?.saved, false);
    assert.deepEqual(collision.outbox, []); assert.deepEqual(journals(storage), []);
    const proved = adapter.commit(lane.merge(collision, {messages: [local], posts: []}));
    assert.equal(proved.messages.find(message => message.id === local.id)?.saved, true);
    assert.deepEqual(proved.outbox, []); assert.deepEqual(journals(storage), []);
    assert.throws(() => lane.merge(proved, {messages: [{...local, body: lane.prefix + 'Fictional changed immutable text'}], posts: []}), /already accepted immutable/i);
  });

  test(`${lane.name} fails closed when another tab's accepted cache conflicts with original local text`, () => {
    const storage = new Storage(), local = {id: crypto.randomUUID(), role: 'user', body: lane.prefix + 'Fictional original local history', createdAt: stamp};
    const base = {version: 1, messages: [local], outbox: [], composer: 'Fictional retained draft', ...(lane.name === 'Relay' ? {posts: []} : {})};
    storage.setItem(lane.key, JSON.stringify(base));
    const tabStorage = new Storage(), adapter = createPublicDeliveryStore({storage, tabStorage, key: lane.key, read: lane.read}), current = adapter.commit(adapter.restore());
    const queued = {id: crypto.randomUUID(), role: 'user', body: lane.prefix + 'Fictional independently queued intent', createdAt: stamp, saved: false};
    const anotherTab = {...base, messages: [{...local, body: lane.prefix + 'Fictional conflicting accepted cache', saved: true}, queued], outbox: [queued]};
    const conflictingCache = JSON.stringify(anotherTab); storage.setItem(lane.key, conflictingCache);
    storage.writes = []; tabStorage.writes = [];
    assert.throws(() => adapter.external(current), error => /Local history has different content/i.test(error.message) && /Keep this page open.*copy.*before reloading/i.test(error.message));
    assert.throws(() => adapter.commit({...current, composer: 'Fictional edited draft'}), /Local history has different content/i);
    assert.equal(current.messages.find(message => message.id === local.id)?.body, local.body);
    assert.equal(current.messages.find(message => message.id === local.id)?.saved, false);
    assert.equal(current.composer, base.composer);
    assert.equal(storage.getItem(lane.key), conflictingCache, 'The failure occurs before aggregate storage is overwritten');
    assert.deepEqual(storage.writes, [], 'A failed association cannot migrate the independent aggregate queue into a journal');
    assert.deepEqual(tabStorage.writes, [], 'A failed association cannot replace the tab draft');
    assert.deepEqual(current.outbox, []); assert.deepEqual(journals(storage), []);
    storage.setItem(lane.key, JSON.stringify({...anotherTab, messages: [{...local, saved: true}, queued]}));
    const exact = adapter.external(current);
    assert.equal(exact.messages.find(message => message.id === local.id)?.body, local.body);
    assert.equal(exact.messages.find(message => message.id === local.id)?.saved, true, 'Exact accepted-cache evidence may confirm the same original UUID and text');
    assert.deepEqual(exact.outbox.map(message => [message.id, message.body]), [[queued.id, queued.body]]);
    assert.deepEqual(journals(storage), [adapter.prefix + queued.id], 'A validated independent queued intent remains durable');
  });
}
