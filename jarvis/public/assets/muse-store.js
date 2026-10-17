import {MUSE_PREFIX, channelMessages} from './channels.js';
import {mergePublicMessages} from './public-delivery-store.js';
export const MUSE_STORAGE_KEY = 'jarvis.muse.v1';
export const MAX_MESSAGE = 4000 - MUSE_PREFIX.length;
export function readMuse(storage) {
  const raw = storage.getItem(MUSE_STORAGE_KEY);
  if (!raw) return {version: 1, messages: [], outbox: [], composer: '', syncedAt: null};
  const state = JSON.parse(raw);
  if (state.version !== 1 || !Array.isArray(state.messages) || !Array.isArray(state.outbox) || typeof state.composer !== 'string')
    throw Error('Saved Muse drafts could not be opened. They have not been overwritten.');
  return state;
}
export function queueMuse(state, body, id, createdAt) {
  const text = body.trim();
  if (!text || text.length > MAX_MESSAGE) throw Error('Write a message of up to ' + MAX_MESSAGE + ' characters.');
  const message = {id, createdAt, role: 'user', body: MUSE_PREFIX + text, saved: false,sendState:'queued'};
  return {...state, composer: '', messages: [...state.messages, message], outbox: [...state.outbox, message]};
}
export function mergeMuse(state, remote) {
  // Collision checks use the entire shared inbox before destination filtering.
  const pending=new Set(state.outbox.map(m=>m.id));
  const received=[...new Map([...channelMessages(remote.messages,'muse'),...remote.messages.filter(m=>pending.has(m.id))].map(m=>[m.id,m])).values()];
  const merged=mergePublicMessages(state.messages,state.outbox,received,{sharedEvidence:true});
  return {...state,...merged,messages:channelMessages(merged.messages,'muse'),publisher:remote.publisher||state.publisher,syncedAt:new Date().toISOString()};
}
