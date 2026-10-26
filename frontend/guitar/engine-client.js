// Talks to the engine worker (alphaTab + converter). One worker serves the
// page; calls queue in order and each one has a deadline.
let worker = null, next = 0;
const pending = new Map();

function fail(error) {
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
  pending.clear();
  worker?.terminate();
  worker = null;
}
function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL('./engine.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id); clearTimeout(call.timer);
    if (data.ok) call.resolve(data.result); else call.reject(Error(data.error || 'The tab engine failed.'));
  };
  worker.onerror = event => { event.preventDefault?.(); fail(Error('The tab engine failed to start.')); };
  return worker;
}
function call(op, payload = {}, timeout = 60000) {
  const target = ensure(), id = ++next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { fail(Error('The tab engine took too long.')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    target.postMessage({ id, op, ...payload });
  });
}

export const load = source => call('load', { source });
export const reader = (track, width, scale = 1) => call('reader', { track, width, scale });
export const timeline = track => call('timeline', { track });
export const print = (source, tracks, timeout = 120000) => call('print', { source, tracks }, timeout);
