import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicDeliveryStore} from '../public/assets/public-delivery-store.js';
import {readState, mergeState, STORAGE_KEY} from '../public/assets/shared-store.js';

class SyntheticStorage {
  values = new Map();
  beforeSet = null;
  get length() {return this.values.size;}
  key(index) {return [...this.values.keys()][index] ?? null;}
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {this.beforeSet?.(key, value); this.values.set(key, String(value));}
  removeItem(key) {this.values.delete(key);}
}
const stamp = '2026-10-08T05:00:00.000Z';
const message = body => ({id: crypto.randomUUID(), body, role: 'user', createdAt: stamp, saved: false});
const adapter = (storage, tabStorage = new SyntheticStorage()) => createPublicDeliveryStore({storage, tabStorage, key: STORAGE_KEY, read: readState});
const journalIds = (storage, prefix) => [...storage.values.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));

test('another tab draft write preserves every already loaded Daily Board post beyond the serialized cache', () => {
  const storage = new SyntheticStorage(), first = adapter(storage), second = adapter(storage);
  const posts = Array.from({length: 30}, (_, index) => ({id: crypto.randomUUID(), title: `Fictional board entry ${index + 1}`,
    body: 'Synthetic public board content', createdAt: new Date(Date.parse(stamp) + index * 1000).toISOString()}));
  const current = first.commit(mergeState(first.restore(), {messages: [], posts, publisher: {ok: true}}));
  assert.equal(current.posts.length, 30);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).posts.length, 20, 'The serialized public cache stays bounded');
  second.commit({...second.restore(), composer: 'Fictional draft in another tab'});
  const updated = first.external(current);
  assert.deepEqual(updated.posts.map(post => post.id), posts.map(post => post.id), 'An external cache write cannot truncate full runtime board history');
  assert.equal(updated.composer, current.composer);
});

test('blocked tab draft persistence fails visibly before another tab can silently replace an acknowledged draft', () => {
  const storage = new SyntheticStorage(), blocked = {getItem: () => null, setItem: () => {throw Error('Synthetic sessionStorage quota exhausted');}};
  const first = adapter(storage, blocked), original = first.restore();
  assert.throws(() => first.commit({...original, composer: 'Fictional unsaved first-tab draft'}), error => error.storageFailure === true && /draft|tab/i.test(error.message));
  assert.equal(storage.getItem(STORAGE_KEY), null, 'A failed independent draft save cannot advertise success through aggregate storage');
  const second = adapter(storage);
  second.commit({...second.restore(), composer: 'Fictional second-tab draft'});
  const before = storage.getItem(STORAGE_KEY);
  assert.throws(() => first.commit({...original, composer: 'Fictional still-unsaved first-tab draft'}), error => error.storageFailure === true);
  assert.equal(storage.getItem(STORAGE_KEY), before, 'Failure preserves the other tab’s durable data instead of overwriting it');
});

test('two tabs racing for the last queue slot preserve and reconcile every already durable UUID', () => {
  const storage = new SyntheticStorage(), first = adapter(storage), second = adapter(storage), existing = [];
  for (let index = 0; index < 49; index++) {
    const queued = message(`Fictional pending public message ${index + 1}`); existing.push(queued); first.savePending(queued);
  }
  const a = message('Fictional racing fiftieth message A'), b = message('Fictional racing fiftieth message B');
  // Independent renderer processes can both observe 49 before their distinct
  // synchronous localStorage writes. The hook reproduces that exact interleave.
  storage.beforeSet = key => {if (key === first.prefix + a.id) {storage.beforeSet = null; second.savePending(b);}};
  first.savePending(a);
  const all = [...existing, a, b], expected = new Map(all.map(item => [item.id, item.body]));
  assert.equal(journalIds(storage, first.prefix).length, 51);
  const recovery = adapter(storage), restored = recovery.restore();
  assert.deepEqual(new Map(restored.outbox.map(item => [item.id, item.body])), expected, 'An existing overflow remains readable and recoverable');
  assert.throws(() => recovery.savePending(message('Fictional new message beyond the cap')), /Fifty|queued/i);
  const accepted = mergeState(restored, {messages: all.map(item => ({id: item.id, role: 'user', body: item.body, createdAt: item.createdAt})), posts: [], publisher: {ok: true}});
  const drained = recovery.commit(accepted);
  assert.deepEqual(drained.outbox, []); assert.deepEqual(journalIds(storage, recovery.prefix), []);
  assert.deepEqual(new Map(drained.messages.map(item => [item.id, item.body])), expected);
  const reload = adapter(storage).restore();
  assert.equal(reload.messages.length, 51); assert.ok(reload.messages.every(item => item.saved === true));
});

test('a partial enqueue journal survives aggregate persistence failure and reload without allocating a replacement UUID', () => {
  const storage = new SyntheticStorage(), delivery = adapter(storage), initial = delivery.restore(), queued = message('Fictional body whose journal was saved before aggregate failure');
  delivery.savePending(queued);
  storage.beforeSet = key => {if (key === STORAGE_KEY) throw Error('Synthetic aggregate quota exhausted');};
  assert.throws(() => delivery.commit({...initial, messages: [queued], outbox: [queued], composer: ''}), error => error.storageFailure === true);
  storage.beforeSet = null;
  const recovered = adapter(storage).restore();
  assert.deepEqual(recovered.outbox.map(item => ({id: item.id, body: item.body})), [{id: queued.id, body: queued.body}]);
  assert.equal(journalIds(storage, delivery.prefix).length, 1);
  const confirmed = delivery.commit(mergeState(recovered, {messages: [{id: queued.id, role: 'user', body: queued.body, createdAt: queued.createdAt}], posts: []}));
  assert.deepEqual(confirmed.outbox, []); assert.equal(confirmed.messages[0].id, queued.id);
  assert.deepEqual(journalIds(storage, delivery.prefix), []);
});

test('an isolated pending UUID conflict does not permit replacement of previously accepted immutable content', () => {
  const storage = new SyntheticStorage(), delivery = adapter(storage), initial = delivery.restore();
  const queued = message('Fictional pending original body'), accepted = {...message('Fictional accepted immutable body'), saved: true};
  delivery.savePending(queued);
  const current = delivery.commit({...initial, messages: [accepted, queued], outbox: [queued], composer: 'Fictional separate draft'});
  const conflict = {...queued, body: 'Fictional competing immutable body'};
  const merged = delivery.commit(mergeState(current, {messages: [conflict], posts: []}));
  assert.equal(merged.outbox.find(item => item.id === queued.id)?.body, queued.body);
  assert.equal(merged.outbox.find(item => item.id === queued.id)?.sendState, 'conflict');
  assert.equal(merged.messages.find(item => item.id === accepted.id)?.body, accepted.body);
  const before = storage.getItem(STORAGE_KEY);
  assert.throws(() => delivery.commit(mergeState(merged, {messages: [{...accepted, body: 'Fictional forged replacement of accepted text'}], posts: []})), /already accepted immutable/i);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.equal(delivery.restore().messages.find(item => item.id === accepted.id)?.body, accepted.body);
  assert.equal(delivery.restore().outbox.find(item => item.id === queued.id)?.body, queued.body);
});
