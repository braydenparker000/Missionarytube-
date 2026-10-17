import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayMenuHistory} from '../public/assets/relay-menu-history.js';

const HOME = 'https://relay.test/', RELAY = HOME + 'jarvis/', OTHER = HOME + 'notes/';
function fixture({direct = false} = {}) {
  const entries = direct ? [{url: RELAY, state: {foreign: 7}}] :
    [{url: HOME, state: {}}, {url: RELAY, state: {foreign: 7}}];
  let index = entries.length - 1, sequence = 0, renders = 0, backs = 0, menu;
  const tasks = [], actions = [];
  const history = {
    get state() { return entries[index].state; },
    replaceState(state, _, url) { entries[index] = {state, url}; },
    pushState(state, _, url) { entries.splice(++index, Infinity, {state, url}); },
    back() { backs++; go(-1); },
  };
  function go(delta) {
    const next = index + delta;
    if (next < 0 || next >= entries.length) return;
    tasks.push(() => { index = next; if (!menu.popstate()) { renders++; menu.invalidate(); } });
  }
  function reset() { menu = createRelayMenuHistory({history, getURL: () => entries[index].url, createId: () => 'menu-' + ++sequence}); }
  function flush() {
    let remaining = 30;
    while (tasks.length) { assert.ok(remaining-- > 0, 'History must settle without a loop'); tasks.shift()(); }
  }
  function open() {
    const dialog = {open: true, close() { if (!this.open) return; this.open = false; tasks.push(() => menu.closed(this)); }};
    menu.open(dialog); return dialog;
  }
  reset();
  return {history, entries, actions, open, go, flush, reset, get menu() { return menu; },
    get url() { return entries[index].url; }, get index() { return index; },
    get renders() { return renders; }, get backs() { return backs; }};
}

test('Back dismisses only the Relay menu and retains unrelated history state', () => {
  const f = fixture(), dialog = f.open();
  assert.equal(f.history.state.foreign, 7);
  assert.deepEqual(Object.keys(f.history.state).sort(), ['foreign', 'jarvisRelayMenu']);
  f.history.back(); f.flush();
  assert.equal(dialog.open, false); assert.equal(f.url, RELAY); assert.equal(f.renders, 0);
  f.history.back(); f.flush();
  assert.equal(f.url, HOME); assert.equal(f.renders, 1);
});

test('explicit dismissal traverses once, waits for cleanup, and ignores repeated clicks', () => {
  const f = fixture(), dialog = f.open();
  f.menu.close(dialog, () => f.actions.push('first'));
  f.menu.close(dialog, () => f.actions.push('duplicate'));
  assert.equal(f.backs, 1); assert.deepEqual(f.actions, []);
  f.flush(); assert.deepEqual(f.actions, ['first']);
  f.history.back(); f.flush(); assert.equal(f.url, HOME);
});

test('reload and stale Forward entries do not resurrect menus or trap the next Back', () => {
  const f = fixture(); f.open(); f.reset();
  f.history.back(); f.flush(); assert.equal(f.url, HOME);
  f.go(1); f.flush(); assert.equal(f.url, RELAY);
  f.go(1); f.flush(); assert.equal(f.url, RELAY);
  f.history.back(); f.flush(); assert.equal(f.url, HOME);
});

test('reopening a dismissed Forward entry reuses it and repeated dismissal never grows history', () => {
  const f = fixture(); let dialog = f.open(); const length = f.entries.length;
  f.menu.close(dialog); f.flush(); f.go(1); f.flush();
  dialog = f.open(); assert.equal(f.entries.length, length);
  f.menu.close(dialog); f.flush();
  for (let i = 0; i < 12; i++) {
    dialog = f.open(); f.menu.close(dialog); f.flush();
    assert.equal(f.entries.length, length); assert.equal(f.index, 1);
  }
  f.history.back(); f.flush(); assert.equal(f.url, HOME);
});

test('newer route navigation replaces a pending menu action and keeps normal Back', () => {
  const f = fixture(), dialog = f.open();
  f.menu.close(dialog, () => f.actions.push('stale'));
  f.menu.navigate(() => { f.actions.push('newer'); f.history.pushState({}, '', OTHER); f.menu.invalidate(); });
  f.flush(); assert.deepEqual(f.actions, ['newer']); assert.equal(f.url, OTHER);
  f.history.back(); f.flush(); assert.equal(f.url, RELAY);
  f.history.back(); f.flush(); assert.equal(f.url, HOME);
});

test('newer navigation after traversal but before native close cleanup still wins', () => {
  const f = fixture(), dialog = f.open();
  f.menu.close(dialog, () => f.actions.push('stale'));
  // Popstate is synchronous; the native close event arrives later.
  f.menu.popstate = (() => {
    const original = f.menu.popstate;
    return () => { const consumed = original(); f.menu.navigate(() => f.actions.push('newer')); return consumed; };
  })();
  f.flush(); assert.deepEqual(f.actions, ['newer']);
});

test('a conversation change invalidates stale menu actions without a remount on dismissal', () => {
  const f = fixture(), dialog = f.open();
  f.menu.close(dialog, () => f.actions.push('old conversation'));
  f.menu.invalidate(); f.flush();
  assert.deepEqual(f.actions, []); assert.equal(f.url, RELAY); assert.equal(f.renders, 0);
});

test('a jump beyond the owned base cancels the menu action and honors the newer route', () => {
  const f = fixture(), dialog = f.open();
  f.go(-2); f.flush();
  assert.equal(dialog.open, false); assert.equal(f.url, HOME); assert.equal(f.renders, 1);
});

test('fresh direct navigation has exactly one transient entry and no automatic extra traversal', () => {
  const f = fixture({direct: true}), dialog = f.open();
  assert.equal(f.entries.length, 2);
  f.menu.close(dialog); f.flush();
  assert.equal(f.index, 0); assert.equal(f.url, RELAY); assert.equal(f.backs, 1);
});

test('native programmatic close retires the owned entry, and non-menu navigation remains normal', () => {
  const f = fixture(), dialog = f.open();
  dialog.close(); f.flush(); assert.equal(f.index, 1);
  f.menu.navigate(() => { f.history.pushState({}, '', OTHER); f.menu.invalidate(); });
  f.history.back(); f.flush(); assert.equal(f.url, RELAY); assert.equal(f.renders, 1);
});
