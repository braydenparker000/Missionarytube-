// When Astra cannot start (something saved on this device it cannot read, or
// a bug), this card takes the place of an endless launch screen: download
// what is saved, or reset the new Astra's data and start again.

import {h} from '../ui/dom.js';
import {confirm} from '../ui/components.js';
import {createStorage, PREFIX} from './store.js';

export function showRecovery(root, error) {
  const store = createStorage(undefined, {events: null});
  // Exactly what is stored, as text: a damaged value may not even be JSON.
  const exportRaw = () => {
    const items = Object.fromEntries(store.keys().map(k => [PREFIX + k, store.raw(PREFIX + k)]));
    const blob = new Blob([JSON.stringify({astra: 'raw/1', at: new Date().toISOString(), items}, null, 1)], {type: 'application/json'});
    const a = h('a', {href: URL.createObjectURL(blob), download: `astra-data-${new Date().toISOString().slice(0, 10)}.json`});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // Only "astra.v2.*": classic Astra's data and the rest of the site stay.
  const reset = () => { for (const k of store.keys()) store.remove(k); location.reload(); };
  const ask = () => confirm('Reset Astra data?', {message: 'Removes the add-ons, library, progress and settings this Astra saved on this device. Classic Astra’s data is not touched.',
    action: 'Reset and start again', destructive: true, run: reset});
  root.replaceChildren(h('div', {class: 'recovery'}, h('div', {class: 'state-card', role: 'alert'},
    h('h3', {}, 'Astra couldn’t start'),
    h('p', {}, 'Something saved on this device stopped it from opening. Export the raw data to keep a copy, then reset Astra’s data to start fresh.'),
    h('div', {class: 'recovery-actions'},
      h('button', {class: 'btn wide', type: 'button', onclick: exportRaw}, 'Export raw data'),
      h('button', {class: 'btn primary wide', type: 'button', onclick: ask}, 'Reset Astra data')),
    h('p', {class: 'recovery-detail'}, String(error?.message || error || '')))));
}
