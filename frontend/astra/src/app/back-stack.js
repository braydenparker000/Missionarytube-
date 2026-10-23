// Android back, screen by screen. Every screen or sheet that back should
// close pushes a layer: one history entry each. The system back button pops
// the top layer; closing a layer from the UI pops its entry too, so the
// browser history always matches what is on screen.

const stack = [];
let pendingPops = 0;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  addEventListener('popstate', () => {
    if (pendingPops > 0) { pendingPops--; return; } // our own history.back()
    const layer = stack.pop();
    if (layer) layer.onBack();
  });
}

/**
 * Pushes a layer. `onBack` runs when the system back button closes it.
 * Returns close(): call it when the UI closes the layer itself.
 */
export function pushLayer(name, onBack) {
  listen();
  const layer = {name, onBack};
  stack.push(layer);
  history.pushState({astra: name, depth: stack.length}, '');
  return () => {
    const i = stack.indexOf(layer);
    if (i < 0) return;
    const removed = stack.length - i;
    stack.splice(i);
    pendingPops += removed;
    history.go(-removed);
  };
}

export function topLayer() { return stack[stack.length - 1]?.name ?? null; }
export function layerCount() { return stack.length; }
