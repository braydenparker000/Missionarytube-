// What Claude is doing, in words, from the Worker's status:
//   alive + listening  → online, replies in seconds
//   alive + working    → working (on which thread, with its note)
//   no lease, woken    → starting up (a fresh session takes ~10–30 s)
//   no lease           → asleep; the next message wakes it

import {ago} from './dom.js';

export function claudeStatus(status, pending = 0, now = Date.now()) {
  if (!status) return {tone: 'idle', label: 'Claude', detail: 'Connecting…'};
  if (status.alive && status.state === 'working' && status.stopRequested) return {tone: 'busy', label: 'Stopping', detail: 'Finishing the current step', threadId: status.threadId, stopping: true};
  if (status.alive && status.state === 'working') return {tone: 'busy', label: 'Working', detail: status.note || 'On it', threadId: status.threadId};
  if (status.alive) return {tone: 'online', label: 'Online', detail: 'Replies in seconds'};
  const wake = status.wake;
  if (wake?.starting) return {tone: 'busy', label: 'Starting up', detail: 'A fresh session is on its way'};
  if (wake && !wake.ok && now - wake.at < 30 * 60_000) {
    const why = wake.error === 'not_configured' ? 'Waking is not set up yet' : 'Could not wake Claude';
    return {tone: 'warn', label: 'Asleep', detail: pending ? `${why} · your message is waiting` : why};
  }
  if (pending) return {tone: 'busy', label: 'Waking', detail: 'Your message is waiting'};
  return {tone: 'idle', label: 'Asleep', detail: status.lastSeen ? `Last seen ${ago(status.lastSeen, now)} · a message wakes Claude` : 'A message wakes Claude'};
}

export function museStatus(state, now = Date.now()) {
  if (state?.enabled === false) return {tone: 'warn', label: 'Muse', detail: 'Muse chat is switched off'};
  const at = state?.adapter?.lastFetchedAt ? Date.parse(state.adapter.lastFetchedAt) : 0;
  if (!at) return {tone: 'idle', label: 'Muse', detail: 'Replies when Muse checks in'};
  if (now - at < 3 * 60_000) return {tone: 'online', label: 'Muse', detail: 'Checked in just now'};
  return {tone: 'idle', label: 'Muse', detail: `Checked in ${ago(at, now)}`};
}
