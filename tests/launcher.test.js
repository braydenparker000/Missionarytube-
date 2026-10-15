import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { apps, loadPreferences, savePreferences } from '../public/assets/hub.js';

const destinations = [
  ['jarvis', 'Jarvis', '/private/'],
  ['drawercast', 'Poweramp', '/drawercast/'],
  ['podcasts', 'Podcasts', '/podcasts/'],
  ['media', 'Astra', '/media/'],
  ['muse', 'Mast', '/private/#mast'],
  ['quick-ai', 'Quick AI', '/quick-ai/'],
  ['board', 'Daily Board', '/daily-board/'],
  ['guitar', 'Guitar', '/guitar/'],
  ['notes', 'Notes', '/notes/'],
  ['mymedia', 'My Media', '/mymedia/'],
  ['tools', 'Tools', '/tools/'],
  ['server', 'Server', '/server/'],
  ['settings', 'Settings', '/settings/']
];

test('launcher opens unified private chats while preserving app IDs and secondary public routes', async () => {
  assert.deepEqual(apps.map(a => [a.id, a.name, a.href]), destinations);
  assert.equal(apps.find(a => a.id === 'jarvis').description, 'Private chats & shared tasks');
  assert.equal(apps.filter(a => a.name === 'Jarvis').length, 1);
  for(const route of ['/jarvis/','/muse/'])await access(new URL(`../public${route}index.html`,import.meta.url));
  for (const app of apps) await access(new URL(`../public${app.href.split('#')[0]}index.html`, import.meta.url));
});

function withStorage(values, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map(Object.entries(values));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value)
  }});
  try { run(entries); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('existing favorites keep their IDs and preference key through the Relay rename', () => {
  const saved = { favorites: ['jarvis', 'drawercast', 'media', 'mymedia', 'notes'] };
  withStorage({ 'jarvis.preferences.v1': JSON.stringify(saved), 'jarvis.shared.v1': 'existing messages' }, entries => {
    assert.deepEqual(loadPreferences(), saved);
    savePreferences(loadPreferences());
    assert.deepEqual(JSON.parse(entries.get('jarvis.preferences.v1')), saved);
    assert.equal(entries.get('jarvis.shared.v1'), 'existing messages');
    assert.equal(entries.size, 2);
  });
});

test('empty favorites remain empty and unavailable apps are filtered without rewriting saved preferences', () => {
  for (const favorites of [[], ['jarvis', 'missing-app']]) {
    const raw = JSON.stringify({ favorites });
    withStorage({ 'jarvis.preferences.v1': raw }, entries => {
      assert.deepEqual(loadPreferences().favorites, favorites.filter(id => id !== 'missing-app'));
      assert.equal(entries.get('jarvis.preferences.v1'), raw);
    });
  }
});

test('missing or damaged preferences retain the existing defaults', () => {
  for (const values of [{}, { 'jarvis.preferences.v1': 'broken' }]) {
    withStorage(values, () => assert.deepEqual(loadPreferences(), { favorites: ['jarvis', 'drawercast'] }));
  }
});
