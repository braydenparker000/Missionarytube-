(function (global) {
  'use strict';
  const KEY = 'astra.v1.appearance';
  const choices = Object.freeze({
    accent: ['ice', 'pearl', 'violet', 'amber'],
    surface: ['black', 'charcoal'],
    density: ['comfortable', 'compact'],
    glass: ['glass', 'solid'],
    motion: ['full', 'gentle', 'off']
  });
  const defaults = Object.freeze({ accent: 'ice', surface: 'black', density: 'comfortable', glass: 'glass', motion: 'full' });
  function normalize(value) {
    const input = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(choices).map(([key, allowed]) => [key, allowed.includes(input[key]) ? input[key] : defaults[key]]));
  }
  let storage;
  let current = { ...defaults };
  try { storage = global.localStorage; current = normalize(JSON.parse(storage.getItem(KEY))); } catch {}
  function apply() {
    const root = global.document?.documentElement;
    if (!root) return;
    Object.entries(current).forEach(([key, value]) => { root.dataset[key] = value; });
  }
  function update(patch) {
    current = normalize({ ...current, ...patch });
    let saved = false;
    try { if (storage) { storage.setItem(KEY, JSON.stringify(current)); saved = true; } } catch {}
    apply();
    global.dispatchEvent?.(new global.CustomEvent('astra:appearance', { detail: { ...current } }));
    return saved;
  }
  apply();
  global.AstraAppearance = Object.freeze({ choices, defaults, normalize, get: () => ({ ...current }), update });
})(typeof globalThis !== 'undefined' ? globalThis : this);
