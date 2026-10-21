import test from 'node:test';
import assert from 'node:assert/strict';
import { SettingsStore, SETTINGS_KEY, resolveSettingsTheme } from '../frontend/poweramp-lab/settings.js';

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  const reads = [], writes = [];
  return { data, reads, writes,
    getItem(key) { reads.push(key); return data.get(key) ?? null; },
    setItem(key, value) { writes.push(key); data.set(key, value); },
  };
}

test('fresh state follows initialized native defaults rather than constructor-zero library values', () => {
  const s = new SettingsStore(storage());
  const c = s.get({ orientation: 'portrait' });
  assert.equal(c.skin, 'Black'); assert.equal(c.more_buttons, true); assert.equal(c.font_variant, 'Bold');
  assert.equal(c.seekbar, 'scrolling'); assert.equal(c.aa_aspect, 1); assert.equal(c.ratings, 1);
  assert.equal(c.list_zoom, 3); assert.equal(c.navbar_seekbar, true);
  assert.deepEqual(c.subaa, ['visualization', 'sleep', 'none', 'shuffle', 'repeat']);
  assert.equal(s.get({ listId: 'albums' }).list_zoom, 5);
  assert.equal(s.get({ listId: 'search' }).list_zoom, 1);
  s.reset('library');
  assert.equal(s.get().list_zoom, 0);
  assert.equal(s.get({ listId: 'albums' }).list_zoom, 5);
});

test('skin, orientation, and category edits remain independent through persistence', () => {
  const disk = storage(); const s = new SettingsStore(disk);
  s.set('alt_layout', 'FullCover'); s.set('more_buttons', false);
  s.set('subaa', ['lyrics', 'none', 'repeat'], { orientation: 'landscape' });
  s.set('list_zoom', -4, { listId: 'artists' });
  s.set('skin', 'Light');
  assert.equal(s.get().alt_layout, 'Default'); assert.equal(s.get().more_buttons, true);
  s.set('alt_layout', 'Alternative');
  const restored = new SettingsStore(disk);
  assert.equal(restored.get().skin, 'Light'); assert.equal(restored.get().alt_layout, 'Alternative');
  restored.set('skin', 'Black');
  assert.equal(restored.get().alt_layout, 'FullCover'); assert.equal(restored.get().more_buttons, false);
  assert.deepEqual(restored.get({ orientation: 'landscape' }).subaa, ['lyrics', 'none', 'repeat']);
  assert.equal(restored.get({ listId: 'artists' }).list_zoom, -4);
  assert.equal(restored.get({ listId: 'albums' }).list_zoom, 5);
});

test('Settings Theme remains independent from player skin and follows system preference only when selected', () => {
  const disk = storage(); const s = new SettingsStore(disk);
  assert.equal(s.get().settings_theme, 0);
  assert.equal(resolveSettingsTheme(0, false), 'Light');
  assert.equal(resolveSettingsTheme(0, true), 'Dark');
  assert.equal(resolveSettingsTheme(3, false), 'Light');
  assert.equal(resolveSettingsTheme(3, true), 'Dark');
  s.set('settings_theme', 2); s.set('skin', 'Light');
  assert.equal(resolveSettingsTheme(s.get().settings_theme, false), 'Dark');
  const restored = new SettingsStore(disk);
  assert.equal(restored.get().settings_theme, 2); assert.equal(restored.get().skin, 'Light');
  restored.set('settings_theme', 1);
  assert.equal(resolveSettingsTheme(restored.get().settings_theme, true), 'Light');
  restored.reset('look'); assert.equal(restored.get().settings_theme, 0);
  assert.equal(restored.get().skin, 'Light');
  assert.throws(() => s.set('settings_theme', '2'), TypeError);
  assert.throws(() => s.set('settings_theme', 4), TypeError);
});

test('storage access is isolated; unrelated browser namespaces are not inspected or modified', () => {
  const disk = storage({ 'drawercast.settings': '{"skin":"Light"}', 'poweramp-v2.settings': 'private', unrelated: 'keep' });
  const s = new SettingsStore(disk); s.set('ratings', 3); s.reset('all');
  assert.deepEqual([...new Set(disk.reads)], [SETTINGS_KEY]);
  assert.deepEqual([...new Set(disk.writes)], [SETTINGS_KEY]);
  assert.equal(disk.data.get('drawercast.settings'), '{"skin":"Light"}');
  assert.equal(disk.data.get('poweramp-v2.settings'), 'private'); assert.equal(disk.data.get('unrelated'), 'keep');
});

test('strict value checks reject wrong types, unknown keys, invalid ranges and unsafe scopes', () => {
  const disk = storage(); const s = new SettingsStore(disk);
  for (const [key, value] of [['more_buttons', 'false'], ['ratings', 4], ['aa_aspect', -1],
    ['background_saturation', 155], ['font_scale', NaN], ['font_scale', 2], ['list_zoom', 6],
    ['subaa', ['unimplemented']], ['subaa', Array(33).fill('repeat')], ['__proto__', {}]]) {
    assert.throws(() => s.set(key, value), TypeError);
  }
  assert.throws(() => s.set('list_zoom', 1, { listId: '__proto__' }), TypeError);
  assert.throws(() => s.get({ orientation: 'diagonal' }), TypeError);
  assert.equal(disk.writes.length, 0);
  assert.equal(s.get({ listId: 'toString' }).list_zoom, 3);
  assert.equal(s.get({ listId: 'valueOf' }).list_zoom, 3);
  s.set('list_zoom', 1, { listId: 'toString' });
  assert.equal(s.get({ listId: 'toString' }).list_zoom, 1);
  assert.equal(Object.prototype.toString.list_zoom, undefined);
});

test('corrupt or future snapshots fail safely; partial valid snapshots recover only typed known keys', () => {
  for (const raw of ['{bad', 'null', '[]', '{"version":99}']) {
    const disk = storage({ [SETTINGS_KEY]: raw }); const s = new SettingsStore(disk);
    assert.equal(s.get().skin, 'Black'); assert.equal(s.status.restored, false);
    assert.match(s.status.storageError, /could not be read/); assert.equal(disk.data.get(SETTINGS_KEY), raw);
  }
  const raw = JSON.stringify({ version: 1, global: { ratings: 2, aa_aspect: '2', secret: 'discard' },
    skins: { Black: { seekbar: 'static', more_buttons: 'false' } },
    orientations: { portrait: { subaa: ['invalid'] } }, lists: { albums: { list_zoom: 1 } } });
  const s = new SettingsStore(storage({ [SETTINGS_KEY]: raw }));
  assert.equal(s.get().ratings, 2); assert.equal(s.get().aa_aspect, 1);
  assert.equal(s.get().seekbar, 'static'); assert.equal(s.get().more_buttons, true);
  assert.equal(s.get().secret, undefined); assert.equal(s.get({ listId: 'albums' }).list_zoom, 1);
});

test('scoped reset preserves other skins and orientations, while all-reset persists reset-phase defaults', () => {
  const disk = storage(); const s = new SettingsStore(disk);
  s.set('alt_layout', 'FullCover'); s.set('skin', 'Light'); s.set('alt_layout', 'Alternative');
  s.set('subaa_small', true, { orientation: 'landscape' }); s.set('subaa_small', true, { orientation: 'portrait' });
  s.reset('skin'); assert.equal(s.get().alt_layout, 'Default');
  s.set('skin', 'Black'); assert.equal(s.get().alt_layout, 'FullCover');
  s.reset('subaa', { orientation: 'portrait' });
  assert.equal(s.get({ orientation: 'portrait' }).subaa_small, false);
  assert.equal(s.get({ orientation: 'landscape' }).subaa_small, true);
  s.reset('all'); const restored = new SettingsStore(disk);
  assert.equal(restored.status.phase, 'reset'); assert.equal(restored.get({ listId: 'albums' }).list_zoom, 0);
  assert.equal(restored.get().more_buttons, true); assert.equal(restored.get().font_variant, 'Bold');
});

test('owned snapshots cannot mutate stored arrays, and editor holes survive except at the end', () => {
  const s = new SettingsStore(storage());
  const actions = ['repeat', 'none', 'lyrics', 'none']; s.set('subaa', actions, { orientation: 'portrait' });
  actions[0] = 'settings'; const c = s.get({ orientation: 'portrait' }); c.subaa[0] = 'queue';
  assert.deepEqual(s.get({ orientation: 'portrait' }).subaa, ['repeat', 'none', 'lyrics']);
  s.set('subaa', [], { orientation: 'portrait' }); assert.deepEqual(s.get({ orientation: 'portrait' }).subaa, []);
});

test('mutations report coherent scoped changes once and continue in memory when storage is unavailable', () => {
  const disk = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const s = new SettingsStore(disk); const events = [];
  s.addEventListener('change', e => events.push(e.detail));
  assert.equal(s.set('list_zoom', 2, { listId: 'queue' }), true);
  assert.equal(s.set('list_zoom', 2, { listId: 'queue' }), false);
  assert.equal(events.length, 1); assert.deepEqual(events[0].keys, ['list_zoom']);
  assert.equal(events[0].context.listId, 'queue'); assert.equal(events[0].config.list_zoom, 2);
  assert.equal(s.get({ listId: 'queue' }).list_zoom, 2); assert.match(s.status.storageError, /could not be saved/);
});
