import {nextPublicationReconciliationAt} from './publications.js';

// Alarm I/O yields. Serialize its read/compose/write boundaries so a stale
// scheduler cannot erase a wake recorded by a concurrent request.
const writes = new WeakMap(), wakeTables = new WeakSet(), recoveries = new WeakMap();
const rows = (ctx, query, ...values) => [...ctx.storage.sql.exec(query, ...values)];
const validTime = value => typeof value === 'number' && Number.isFinite(value);
const MAX_RESERVATIONS = 256;
// At most 256 ordinary rows plus this one aggregate row are persisted. Cloudflare
// invokes one alarm() at a time per DO instance, so production holds one live
// handle plus one orphan. Keep handles separate for defensive/manual overlap;
// the aggregate covers them after restart, when their promises no longer exist.
// https://developers.cloudflare.com/durable-objects/api/alarms/
const RECOVERY_ID = 'alarm:recovery';
export const RELAY_ALARM_RETRY_MS = 60000;
export const RELAY_PRECOMMIT_EXPIRY_MS = 300000;

function serialized(ctx, operation) {
  const previous = writes.get(ctx) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writes.set(ctx, current);
  return current.finally(() => { if (writes.get(ctx) === current) writes.delete(ctx); });
}
function wakeSchema(ctx) {
  if (wakeTables.has(ctx)) return;
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS relay_core_alarm_wakes (id TEXT PRIMARY KEY,due_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_core_alarm_due ON relay_core_alarm_wakes(due_ms)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS relay_core_alarm_expiry ON relay_core_alarm_wakes(expires_ms)');
  wakeTables.add(ctx);
}
function hasWakeTable(ctx) {
  if (wakeTables.has(ctx)) return true;
  // Probing a missing optional lane must not scan every schema row during
  // delivery retention. LIMIT 0 reads no rows; cache only positive existence.
  try { rows(ctx,'SELECT due_ms FROM relay_core_alarm_wakes LIMIT 0');wakeTables.add(ctx);return true; }
  catch(error) { if (/no such table: relay_core_alarm_wakes\b/.test(error.message||''))return false;throw error; }
}
function nextReserved(ctx) {
  return hasWakeTable(ctx) ? rows(ctx,'SELECT MIN(due_ms) AS n FROM relay_core_alarm_wakes')[0].n : null;
}
function recoveryGroup(ctx) {
  let group=recoveries.get(ctx);
  if(!group){
    const saved=rows(ctx,'SELECT due_ms,expires_ms FROM relay_core_alarm_wakes WHERE id=?',RECOVERY_ID)[0];
    group={handles:new Map(),orphan:saved?{due:saved.due_ms,expires:saved.expires_ms}:null};
    recoveries.set(ctx,group);
  }
  return group;
}
function sweepRecovery(group, now) {
  let changed=false;
  if(group.orphan?.expires<=now){group.orphan=null;changed=true;}
  for(const [id,lease] of group.handles){
    if(lease.expires<=now){group.handles.delete(id);changed=true;}
  }
  return changed;
}
function pruneExpiredWakes(ctx, now) {
  const expiry=rows(ctx,'SELECT MIN(expires_ms) AS n FROM relay_core_alarm_wakes')[0].n;
  if(expiry!==null&&expiry<=now){
    ctx.storage.sql.exec('DELETE FROM relay_core_alarm_wakes WHERE expires_ms<=? AND id<>?',now,RECOVERY_ID);
    // The aggregate's older orphan can expire while its cached live pass is
    // still running. Promote that pass instead of deleting its durable wake.
    const group=recoveryGroup(ctx);
    if(sweepRecovery(group,now))saveRecovery(ctx,group);
  }
}
function saveRecovery(ctx, group) {
  const leases=[...group.handles.values(),...(group.orphan?[group.orphan]:[])];
  if(!leases.length){
    ctx.storage.sql.exec('DELETE FROM relay_core_alarm_wakes WHERE id=?',RECOVERY_ID);
    recoveries.delete(ctx);return;
  }
  // A process can terminate between ACK and release. Persist the orphan's
  // original cap throughout retries, so restart cannot renew abandonment.
  // Once it expires, a still-live cached handle keeps its own remaining TTL.
  const expiry=group.orphan?.expires??Math.max(...leases.map(lease=>lease.expires));
  ctx.storage.sql.exec(`INSERT INTO relay_core_alarm_wakes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE
    SET due_ms=excluded.due_ms,expires_ms=excluded.expires_ms
    WHERE due_ms<>excluded.due_ms OR expires_ms<>excluded.expires_ms`,RECOVERY_ID,
    Math.min(...leases.map(lease=>lease.due)),expiry);
}
async function acknowledgeWake(ctx, now, ignoreElapsed) {
  await serialized(ctx,async()=>{
    const current=ctx.storage.getAlarm ? await ctx.storage.getAlarm() : null;
    const reserved=nextReserved(ctx);
    const times=[reserved,validTime(current)&&(!ignoreElapsed||current>now)?current:null].filter(validTime);
    // Mutation/recovery admission explicitly acknowledges durable alarm storage
    // even when another reservation already owns the same earlier timestamp.
    await ctx.storage.setAlarm(Math.max(now+50,Math.min(...times)));
  });
}

function releaseRecovery(ctx, id, completed) {
  const group=recoveries.get(ctx);
  if(!group?.handles.delete(id))return;
  sweepRecovery(group,Date.now());
  if(completed&&group.orphan)group.orphan.due=group.orphan.expires;
  saveRecovery(ctx,group);
}
export function releaseRelayCoreWake(ctx, id) {
  if(id?.startsWith('alarm:'))return releaseRecovery(ctx,id,true);
  if (id) ctx.storage.sql.exec('DELETE FROM relay_core_alarm_wakes WHERE id=?',id);
}
export function abandonRelayCoreAlarm(ctx, id) {
  const group=recoveries.get(ctx),lease=group?.handles.get(id);
  if(!lease)return;
  group.handles.delete(id);
  const now=Date.now();sweepRecovery(group,now);
  // One failed alarm's earlier retry also recovers work from later failures.
  // Preserve the earliest abandonment expiry; successful retries never renew it.
  if(lease.expires>now)
    group.orphan=group.orphan?{due:Math.min(group.orphan.due,lease.due),expires:Math.min(group.orphan.expires,lease.expires)}:lease;
  saveRecovery(ctx,group);
}
export function assertRelayCoreWake(ctx, id, now=Date.now()) {
  if (!id) return;
  if(id.startsWith('alarm:')){
    const group=recoveries.get(ctx),lease=group?.handles.get(id);
    if(!lease||lease.expires<=now)throw Error('Relay alarm admission expired');
    // The required alarm ACK may finish after an older orphan's cap. Only an
    // acknowledged, still-live handle may promote the aggregate at this point.
    if(sweepRecovery(group,now))saveRecovery(ctx,group);
    id=RECOVERY_ID;
  }
  const wake=rows(ctx,'SELECT expires_ms FROM relay_core_alarm_wakes WHERE id=?',id)[0];
  if (!wake || wake.expires_ms<=now) throw Error('Relay alarm admission expired');
}
async function reserve(ctx, now, delay) {
  if (!ctx.storage.setAlarm) return null;
  wakeSchema(ctx);
  pruneExpiredWakes(ctx,now);
  if (rows(ctx,'SELECT id FROM relay_core_alarm_wakes WHERE id<>? LIMIT ?',RECOVERY_ID,MAX_RESERVATIONS).length >= MAX_RESERVATIONS)
    throw Error('Relay alarm admission is busy');
  const id=crypto.randomUUID();
  ctx.storage.sql.exec('INSERT INTO relay_core_alarm_wakes VALUES(?,?,?)',id,now+delay,now+Math.max(delay,RELAY_PRECOMMIT_EXPIRY_MS));
  try {
    await acknowledgeWake(ctx,now,false);
    assertRelayCoreWake(ctx,id);
    return id;
  } catch(error) { releaseRelayCoreWake(ctx,id); throw error; }
}
export function reserveRelayCoreWake(ctx, now=Date.now(), delay=100) {
  return reserve(ctx,now,delay);
}
export async function beginRelayCoreAlarm(ctx, now=Date.now()) {
  // A fired wake does not prove that its request has committed. Retain a single
  // conservative recovery at its bounded expiry until the owner releases it.
  // A restart loses the promise, but keeps this recovery without a 50ms loop.
  if(!ctx.storage.setAlarm)return null;
  if(!hasWakeTable(ctx))wakeSchema(ctx);
  pruneExpiredWakes(ctx,now);
  ctx.storage.sql.exec('UPDATE relay_core_alarm_wakes SET due_ms=expires_ms WHERE due_ms<=?',now);
  const group=recoveryGroup(ctx);sweepRecovery(group,now);
  if(group.orphan?.due<=now)group.orphan.due=group.orphan.expires;
  for(const lease of group.handles.values())if(lease.due<=now)lease.due=lease.expires;
  const id='alarm:'+crypto.randomUUID(),lease={due:now+RELAY_ALARM_RETRY_MS,expires:now+RELAY_PRECOMMIT_EXPIRY_MS};
  group.handles.set(id,lease);
  try{
    saveRecovery(ctx,group);
    await acknowledgeWake(ctx,now,true);
    assertRelayCoreWake(ctx,id);
    return id;
  }catch(error){
    try{releaseRecovery(ctx,id,false);}catch{}
    throw error;
  }
}

export async function scheduleRelayCoreAlarm(ctx, nextDelivery, now=Date.now()) {
  if (!ctx.storage.setAlarm) return null;
  return serialized(ctx,async()=>{
    const current=ctx.storage.getAlarm ? await ctx.storage.getAlarm() : null;
    // Evaluate sources after the await, inside the serialized setter.
    const publication=nextPublicationReconciliationAt(ctx,now);
    const delivery=typeof nextDelivery==='function' ? nextDelivery() : nextDelivery;
    const times=[publication,delivery,nextReserved(ctx)].filter(validTime);
    const next=times.length ? Math.max(now+50,Math.min(...times)) : null;
    if (next!==null) { if(current!==next)await ctx.storage.setAlarm(next); }
    else if (current!==null && current!==undefined && ctx.storage.deleteAlarm) await ctx.storage.deleteAlarm();
    return next;
  });
}
