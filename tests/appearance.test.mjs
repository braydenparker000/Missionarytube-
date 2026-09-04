import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile('assets/js/appearance.js', 'utf8');
function boot({value = null, unavailable = false, full = false} = {}) {
  const dataset = {}, events = [];
  let stored = value;
  const context = vm.createContext({
    document: {documentElement: {dataset}},
    get localStorage() {
      if (unavailable) throw Error('Storage denied');
      return {getItem: () => stored, setItem: (_key, next) => {
        if (full) throw Error('Quota exceeded');
        stored = next;
      }};
    },
    CustomEvent: class {constructor(type, {detail}) {this.type = type; this.detail = detail;}},
    dispatchEvent: event => events.push(event)
  });
  vm.runInContext(source, context);
  return {api: context.AstraAppearance, dataset, events, stored: () => stored};
}

test('appearance restores before rendering and rejects unknown stored values', () => {
  const {api, dataset} = boot({value: JSON.stringify({accent: 'violet', motion: 'off', density: 'invalid', injected: 'yes'})});
  assert.equal(dataset.accent, 'violet');
  assert.equal(dataset.motion, 'off');
  assert.equal(dataset.density, 'comfortable');
  assert.equal(dataset.injected, undefined);
  assert.equal(Object.keys(api.get()).length, 5);
});

test('corrupted or unavailable storage still paints a usable default interface', () => {
  for (const options of [{value: '{broken'}, {unavailable: true}]) {
    const {api, dataset} = boot(options);
    assert.equal(dataset.accent, 'ice');
    assert.equal(dataset.surface, 'black');
    assert.equal(api.get().motion, 'full');
  }
});

test('editing one preference preserves the others across a fresh page load', () => {
  const first = boot();
  assert.equal(first.api.update({accent: 'amber', density: 'compact'}), true);
  assert.equal(first.api.update({motion: 'gentle'}), true);
  const next = boot({value: first.stored()});
  assert.equal(next.dataset.accent, 'amber');
  assert.equal(next.dataset.density, 'compact');
  assert.equal(next.dataset.motion, 'gentle');
  assert.equal(next.dataset.glass, 'glass');
});

test('storage failure applies the session preference and reports that it was not saved', () => {
  for (const options of [{unavailable: true}, {full: true}]) {
    const {api, dataset, events} = boot(options);
    assert.equal(api.update({motion: 'off', glass: 'solid'}), false);
    assert.equal(dataset.motion, 'off');
    assert.equal(dataset.glass, 'solid');
    assert.equal(events.at(-1).type, 'astra:appearance');
    assert.equal(events.at(-1).detail.motion, 'off');
  }
});

test('callers cannot mutate the applied preferences through returned snapshots', () => {
  const {api, dataset} = boot();
  const snapshot = api.get();
  snapshot.accent = 'amber';
  assert.equal(api.get().accent, 'ice');
  assert.equal(dataset.accent, 'ice');
});
