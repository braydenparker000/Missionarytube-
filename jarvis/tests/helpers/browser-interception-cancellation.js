// Test-only CDP bookkeeping. A stale interception is acceptable only after a
// validated synthetic GET and the browser's matching, explicit cancellation.
// Navigation alone, missing IDs, API/fixture errors and other CDP errors fail.
export function createInterceptionCancellationTracker(cdp, {timeoutMs = 100} = {}) {
  const cancelled = new Map(), waiters = new Map();
  cdp.on('Network.loadingFailed', event => {
    if (event.canceled !== true || typeof event.requestId !== 'string') return;
    const proof = {requestId: event.requestId, canceled: true, errorText: event.errorText};
    cancelled.set(event.requestId, proof);
    for (const resolve of waiters.get(event.requestId) || []) resolve(proof);
  });
  return async ({event, error, command, validated = false}) => {
    if (!validated || event.request?.method !== 'GET' || typeof event.networkId !== 'string' || !event.networkId ||
        !['Fetch.fulfillRequest', 'Fetch.failRequest'].includes(command) ||
        error?.message !== `cdpSession.send: Protocol error (${command}): Invalid InterceptionId.`) return null;
    if (cancelled.has(event.networkId)) return cancelled.get(event.networkId);
    // Chrome may deliver the protocol error immediately before loadingFailed.
    // Wait briefly for this exact request, never for a generic navigation event.
    return new Promise(resolve => {
      const id = event.networkId, listeners = waiters.get(id) || new Set();
      let timer;
      const finish = proof => {
        clearTimeout(timer); listeners.delete(finish);
        if (!listeners.size) waiters.delete(id);
        resolve(proof);
      };
      listeners.add(finish); waiters.set(id, listeners);
      timer = setTimeout(() => finish(null), timeoutMs);
    });
  };
}
