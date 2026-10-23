// Android back, screen by screen. Every screen or sheet that back should
// close pushes a layer: one history entry each. The system back button pops
// the top layer; closing a layer from the UI pops its entry too, so the
// browser history always matches what is on screen.
//
// history.go() is asynchronous: its popstate arrives later. A layer pushed in
// the meantime (a menu item that closes the menu and opens a screen) waits
// for that popstate, or Chrome would go back past the new entry.

const stack = [];
const waiting = []; // layers pushed while one of our history.go() calls is under way
let pendingPops = 0; // our history.go() calls whose popstate has not arrived
let safety = 0;
let listening = false;

const browser = () => typeof history !== 'undefined' && typeof addEventListener === 'function';

function pushEntry(layer) {
  layer.pushed = true;
  history.pushState({astra: layer.name, depth: stack.indexOf(layer) + 1}, '');
}

function settle() {
  pendingPops = 0;
  clearTimeout(safety);
  for (const layer of waiting.splice(0)) if (stack.includes(layer)) pushEntry(layer);
}

function goBack(steps) {
  pendingPops++;
  history.go(-steps);
  // A popstate that never comes (nothing to go back to) must not hold pushes forever.
  clearTimeout(safety);
  safety = setTimeout(settle, 1000);
}

function listen() {
  if (listening || !browser()) return;
  listening = true;
  addEventListener('popstate', () => {
    if (pendingPops > 0) { if (--pendingPops === 0) settle(); return; }
    // The system back (or forward): close the layers above the entry now shown.
    const depth = history.state?.astra ? history.state.depth : 0;
    while (stack.length > depth) stack.pop().onBack();
  });
  // A reload on a pushed screen leaves its entries behind an empty stack:
  // return to the base entry so the first back press is not lost.
  const stale = history.state?.astra ? history.state.depth : 0;
  if (stale > 0) goBack(stale);
}

/**
 * Pushes a layer. `onBack` runs when the system back button closes it.
 * Returns close(): call it when the UI closes the layer itself.
 */
export function pushLayer(name, onBack) {
  listen();
  const layer = {name, onBack, pushed: false};
  stack.push(layer);
  if (!browser()) return () => { const i = stack.indexOf(layer); if (i >= 0) stack.splice(i); };
  if (pendingPops > 0) waiting.push(layer); else pushEntry(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return;
    const removed = stack.splice(i);
    for (const r of removed) { const w = waiting.indexOf(r); if (w >= 0) waiting.splice(w, 1); }
    const entries = removed.filter(r => r.pushed).length;
    if (entries) goBack(entries);
  };
}

/** Called once at start-up so stale entries from before a reload are skipped. */
export function startBackStack() { listen(); }

export function topLayer() { return stack[stack.length - 1]?.name ?? null; }
export function layerCount() { return stack.length; }
