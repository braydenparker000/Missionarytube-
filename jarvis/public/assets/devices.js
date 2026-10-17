import { STORAGE_KEY, emptyState, mergeState } from './store.js';

export const PREVIOUS_WORKSPACE = STORAGE_KEY + '.previous';
export function linkedState(key, remote) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Paste the complete device code from your original phone.');
  if (!remote || !Array.isArray(remote.messages) || !Array.isArray(remote.posts)) throw new Error('The inbox could not be read. Nothing was changed.');
  const items = [...remote.messages, ...remote.posts];
  if (!items.length) throw new Error('No saved inbox found. Send a message on the original phone, then copy its device code.');
  if (items.some(x => !x || typeof x.id !== 'string' || typeof x.body !== 'string' || !Number.isFinite(Date.parse(x.createdAt))) ||
      remote.messages.some(x => !['user','assistant'].includes(x.role)) ||
      remote.posts.some(x => typeof x.title !== 'string')) throw new Error('The inbox data could not be read. Nothing was changed.');
  return mergeState({ ...emptyState(), key }, remote);
}
export function saveLinkedState(storage, current, next) {
  if (current.key === next.key) return current;
  if (current.outbox.length || current.composer?.trim() || current.boardTitle?.trim() || current.boardBody?.trim())
    throw new Error('Send or clear your drafts on this device before linking another inbox.');
  storage.setItem(PREVIOUS_WORKSPACE, JSON.stringify(current));
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

