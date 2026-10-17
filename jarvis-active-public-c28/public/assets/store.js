export const STORAGE_KEY = 'jarvis.hub.v2';
export function emptyState() {
  return { version: 2, key: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''), messages: [], posts: [], outbox: [], composer: '', boardTitle: '', boardBody: '', syncedAt: null };
}
export function readState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return emptyState();
  const state = JSON.parse(raw);
  if (state.version !== 2 || !/^[a-f0-9]{64}$/.test(state.key) || !['messages', 'posts', 'outbox'].every(k => Array.isArray(state[k]))) throw new Error('Saved data could not be opened. It has not been overwritten.');
  return state;
}
export function mergeState(state, remote) {
  // Keep local drafts that have not yet been accepted by the server.
  const pending = new Set(state.outbox.map(x => x.id));
  const merge = (local, incoming) => {
    const byId = new Map(local.filter(x => pending.has(x.id)).map(x => [x.id, x]));
    for (const item of incoming) byId.set(item.id, { ...item, saved: true });
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  return { ...state, messages: merge(state.messages, remote.messages), posts: merge(state.posts, remote.posts), syncedAt: new Date().toISOString() };
}
