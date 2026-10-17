// One shared inbox. Public callers can create user messages only.
import publication from '../public/content/jarvis.json' with {type:'json'};
import {enqueueRelayMessage} from './relay-events.js';
import {RELAY_OAUTH_OBJECT,boundedText} from './relay-common.js';
import {coordinationSchema, recordPublicEntry, appendCoordination, readPublicCoordination, publicChangesReady, validatePublicCoordinationRead} from './public-coordination.js';
export const SHARED_OBJECT = RELAY_OAUTH_OBJECT;
export const PUBLIC_KEY = '2d9a0d0d4254cd5774d2d4e7806cbadae306271ffc1f31fef0d44cd7e226c2a5';
const id = x => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const json = (x, status = 200) => Response.json(x, {status});
const schemas = new WeakSet();
const rows = (ctx, query, ...values) => [...ctx.storage.sql.exec(query, ...values)];
const metadata = (ctx, key) => JSON.parse(rows(ctx, 'SELECT value FROM shared_meta WHERE key=?', key)[0]?.value || 'null');
const saveMetadata = (ctx, key, value) => ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)', key, JSON.stringify(value));
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
export const LEGACY_PAGE_LIMIT = 100;
const LEGACY_INTERVAL = 300000;
const LEGACY_CONTINUATION = 60000;

export function sharedSchema(ctx) {
  if (schemas.has(ctx)) return;
  const sql = ctx.storage.sql;
  sql.exec(`CREATE TABLE IF NOT EXISTS shared_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('user','reply','briefing')),
    reply_to TEXT UNIQUE, title TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
  sql.exec('CREATE INDEX IF NOT EXISTS shared_kind_seq ON shared_entries(kind, seq)');
  sql.exec('CREATE TABLE IF NOT EXISTS shared_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS shared_briefing_dates (date TEXT PRIMARY KEY, entry_id TEXT NOT NULL)');
  coordinationSchema(ctx);
  schemas.add(ctx);
}
// Validate without building a response page, fetching history or importing data.
export function validateSharedRead(ctx, path, params) {
  sharedSchema(ctx);
  if (path === '/internal/shared/state' || path === '/internal/shared/inbox')
    return /^\d{1,15}$/.test(params.get('after') || '0') ? null : json({error: 'Invalid cursor'}, 400);
  return validatePublicCoordinationRead(ctx, path, params);
}

export function seedLegacyInbox(ctx, now = Date.now()) {
  sharedSchema(ctx);
  if (metadata(ctx, 'legacy-inbox-checkpoint')) return;
  ctx.storage.transactionSync(() => {
    saveMetadata(ctx, 'legacy-inbox-checkpoint', {after: 0, through: 0, prefix: null, nextAt: now});
    saveMetadata(ctx, 'legacy-inbox-initialized', false);
  });
}
export function nextLegacyInboxAt(ctx) {
  return metadata(ctx, 'legacy-inbox-checkpoint')?.nextAt ?? null;
}
// Only the fixed former public object is queried. Its append offset counts all
// physical rows, including untrusted assistant receipts. A prefix digest detects
// reset/reordering; replay never rewrites or removes accepted shared entries.
export async function readLegacyInboxPage(ctx, params) {
  const afterText = params.get('after') || '0', throughText = params.get('through') || '0', prefix = params.get('prefix');
  if (!/^(0|[1-9]\d{0,5})$/.test(afterText) || !/^(0|[1-9]\d{0,5})$/.test(throughText) ||
      prefix !== null && !/^[a-f0-9]{64}$/.test(prefix)) return json({error: 'Invalid legacy checkpoint'}, 400);
  const state = await ctx.storage.get('state') ?? {messages: [], posts: []};
  if (!state || !Array.isArray(state.messages) || !Array.isArray(state.posts) ||
      new TextEncoder().encode(JSON.stringify(state)).length > 100000 ||
      state.messages.some(m => !m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.body !== 'string' ||
        !['user', 'assistant'].includes(m.role))) return json({error: 'Legacy inbox is malformed or oversized'}, 503);
  let after = Number(afterText), through = Number(throughText), reset = false;
  if (after > state.messages.length || through > state.messages.length || after > through && through !== 0 ||
      after && (!prefix || await hash(JSON.stringify(state.messages.slice(0, after))) !== prefix)) {
    after = 0; through = 0; reset = true;
  }
  if (!through || after === through) through = state.messages.length;
  const nextAfter = Math.min(through, after + LEGACY_PAGE_LIMIT);
  return json({after, through, nextAfter, prefix: await hash(JSON.stringify(state.messages.slice(0, nextAfter))), reset,
    messages: state.messages.slice(after, nextAfter).filter(m => m.role === 'user' && id(m.id) && text(m.body, 4000))
      .map(m => ({id: m.id, body: m.body, role: 'user', ...(Number.isFinite(Date.parse(m.createdAt)) ? {createdAt: m.createdAt} : {})})),
    complete: nextAfter === through});
}
export async function syncLegacyInbox(ctx, env, now = Date.now()) {
  if (!env?.HUBS) return {examined: 0};
  seedLegacyInbox(ctx, now);
  const checkpoint = metadata(ctx, 'legacy-inbox-checkpoint');
  if (now < checkpoint.nextAt) return {examined: 0};
  const hour = Math.floor(now / 3600000), day = Math.floor(now / 86400000);
  const stored = metadata(ctx, 'legacy-inbox-budget');
  const budget = {hour, day, hourly: stored?.hour === hour ? stored.hourly : 0, daily: stored?.day === day ? stored.daily : 0};
  if (stored && (hour < stored.hour || day < stored.day) || budget.hourly >= 60 || budget.daily >= 120) {
    const nextAt = Math.max((hour + 1) * 3600000, budget.daily >= 120 ? (day + 1) * 86400000 : 0,
      stored && hour < stored.hour ? stored.hour * 3600000 : 0);
    saveMetadata(ctx, 'legacy-inbox-checkpoint', {...checkpoint, nextAt});
    return {examined: 0, limited: true};
  }
  budget.hourly++; budget.daily++;
  saveMetadata(ctx, 'legacy-inbox-budget', budget);
  // Persist cooldown before I/O. Concurrent readers and partial failures cannot
  // repeatedly transfer the old inbox, and an interrupted page keeps its offset.
  saveMetadata(ctx, 'legacy-inbox-checkpoint', {...checkpoint, nextAt: now + LEGACY_INTERVAL});
  try {
    const params = new URLSearchParams({after: String(checkpoint.after), through: String(checkpoint.through)});
    if (checkpoint.prefix) params.set('prefix', checkpoint.prefix);
    const legacy = env.HUBS.get(env.HUBS.idFromName(await hash(PUBLIC_KEY)));
    const response = await legacy.fetch(new Request('https://internal/internal/shared/legacy-page?' + params));
    if (!response.ok) throw Error('Legacy inbox unavailable');
    const page = JSON.parse(await boundedText(response, 131072));
    if (!Array.isArray(page.messages) || page.messages.length > LEGACY_PAGE_LIMIT ||
        !Number.isSafeInteger(page.after) || !Number.isSafeInteger(page.through) || !Number.isSafeInteger(page.nextAfter) ||
        page.after < 0 || page.nextAfter < page.after || page.nextAfter > page.through || page.nextAfter - page.after > LEGACY_PAGE_LIMIT ||
        !/^[a-f0-9]{64}$/.test(page.prefix) || page.complete !== (page.nextAfter === page.through) ||
        (page.reset !== true && page.after !== checkpoint.after) ||
        page.messages.some(m => m.role !== 'user' || !id(m.id) || !text(m.body, 4000))) throw Error('Invalid legacy inbox page');
    // The page import is itself atomic. Checkpoint it only after that commit;
    // an interruption between the two commits safely replays immutable IDs.
    const imported = sharedStore(ctx, '/internal/shared/import', {messages: page.messages});
    if (!imported.ok) throw Error('Legacy inbox migration failed');
    ctx.storage.transactionSync(() => {
      const idle = page.nextAfter === page.after ? Math.min((checkpoint.idle || 0) + 1, 4) : 0;
      saveMetadata(ctx, 'legacy-inbox-checkpoint', {after: page.nextAfter, through: page.through, prefix: page.prefix, idle,
        nextAt: now + (page.complete ? Math.min(1800000, LEGACY_INTERVAL * 2 ** idle) : LEGACY_CONTINUATION)});
      if (page.complete) saveMetadata(ctx, 'legacy-inbox-initialized', true);
      saveMetadata(ctx, 'legacy-inbox-status', {ok: true, catchingUp: !page.complete, lastAttempt: new Date(now).toISOString()});
    });
    return {examined: page.nextAfter - page.after, complete: page.complete};
  } catch (error) {
    saveMetadata(ctx, 'legacy-inbox-status', {ok: false, lastAttempt: new Date(now).toISOString(), error: error.message});
    return {examined: 0, error: error.message};
  }
}
export function sharedStore(ctx, path, body = {}, params = new URLSearchParams()) {
  sharedSchema(ctx);
  const sql = ctx.storage.sql;
  const rows = (q, ...v) => [...sql.exec(q, ...v)];
  const entry = r => ({id:r.id, body:r.body, createdAt:r.created_at,
    ...(r.kind === 'briefing' ? {title:r.title} : {role:r.kind === 'user' ? 'user' : 'assistant'}),
    ...(r.kind === 'reply' ? {kind:'reply', replyTo:r.reply_to} : {})});
  const insert = (m, kind) => {sql.exec(
    'INSERT INTO shared_entries(id,kind,reply_to,title,body,created_at) VALUES(?,?,?,?,?,?)',
    m.id, kind, m.replyTo || null, m.title || null, m.body.trim(), m.createdAt || new Date().toISOString());
    recordPublicEntry(ctx, m.id);
  };
  if (path === '/internal/shared/coordination') return appendCoordination(ctx, body.payload, body.provenance);
  if (path === '/internal/shared/changes' || path === '/internal/shared/result') return readPublicCoordination(ctx, path, params);
  if (path === '/internal/shared/import') {
    // Input comes only from the old DO and the checked-in, trusted publication.
    return ctx.storage.transactionSync(() => {
      for (const m of body.messages || []) {
        if (m.role === 'user' && id(m.id) && text(m.body,4000) && !rows('SELECT id FROM shared_entries WHERE id=?',m.id).length) insert(m,'user');
      }
      if (!rows("SELECT value FROM shared_meta WHERE key='publication-imported'").length) {
        for (const r of publication.replies) {
          if (rows("SELECT id FROM shared_entries WHERE id=? AND kind='user'",r.replyTo).length && !rows('SELECT id FROM shared_entries WHERE id=? OR reply_to=?',r.id,r.replyTo).length) insert(r,'reply');
        }
        for (const p of publication.posts) if (!rows('SELECT id FROM shared_entries WHERE id=?',p.id).length) insert(p,'briefing');
        // Do not mark complete until every original reply has its user message.
        if (publication.replies.every(r => rows('SELECT id FROM shared_entries WHERE reply_to=?',r.replyTo).length)) sql.exec("INSERT OR REPLACE INTO shared_meta VALUES('publication-imported','true')");
      }
      return json({ok:true});
    });
  }
  if (path === '/internal/shared/state' || path === '/internal/shared/inbox') {
    const cursor = params.get('after') || '0';
    if (!/^\d{1,15}$/.test(cursor)) return json({error:'Invalid cursor'},400);
    const page = rows('SELECT * FROM shared_entries WHERE seq>? ORDER BY seq LIMIT 201',Number(cursor));
    const selected = page.slice(0,200);
    const result = {messages:selected.filter(r=>r.kind!=='briefing').map(entry),posts:selected.filter(r=>r.kind==='briefing').map(entry),
      nextCursor:page.length>200 ? String(selected.at(-1).seq) : null,
      mode:'github-publications',serviceVersion:7,coordinationVersion:publicChangesReady(ctx)?2:1,publisher:{source:'GitHub issue #2 → Cloudflare',...JSON.parse(rows("SELECT value FROM shared_meta WHERE key='publisher-status'")[0]?.value || '{"ok":false,"error":"Publication sync has not run yet"}')}};
    if (path.endsWith('/inbox')) {
      // Pending queue is independent of history pagination; never hide old pending messages.
      const pending=rows("SELECT * FROM shared_entries u WHERE kind='user' AND NOT EXISTS(SELECT 1 FROM shared_entries r WHERE r.reply_to=u.id) ORDER BY seq LIMIT 101");
      result.unanswered=pending.slice(0,100).map(entry);result.moreUnanswered=pending.length>100;

    }
    return json(result);
  }
  const kind = path === '/internal/shared/message' ? 'user' : path === '/internal/shared/reply' ? 'reply' : path === '/internal/shared/briefing' ? 'briefing' : null;
  if (!kind) return json({error:'Not found'},404);
  const bodyLimit = kind==='user' ? 4000 : kind==='briefing' ? 20000 : 6000;
  if (!id(body.id) || !text(body.body,bodyLimit) || kind==='reply'&&!id(body.replyTo) || kind==='briefing'&&!text(body.title,120)) return json({error:'Invalid entry'},400);
  return ctx.storage.transactionSync(() => {
    const existing=rows('SELECT * FROM shared_entries WHERE id=?',body.id)[0];
    const dated=kind==='briefing'&&body.date?rows('SELECT e.* FROM shared_entries e JOIN shared_briefing_dates d ON e.id=d.entry_id WHERE d.date=?',body.date)[0]:null;
    const prior=kind==='reply'?rows('SELECT * FROM shared_entries WHERE reply_to=?',body.replyTo)[0]:(dated||existing);
    const same=r=>r && r.kind===kind && r.body===body.body.trim() && (r.title||'')===(body.title?.trim()||'') && (r.reply_to||'')===(body.replyTo||'');
    if (existing && !same(existing)) return json({error:'Entry ID conflict'},409);
    if (prior) return same(prior)?json({entry:entry(prior)}):json({error:'Entry already exists with different content'},409);
    if (kind==='reply'&&!rows("SELECT id FROM shared_entries WHERE id=? AND kind='user'",body.replyTo).length) return json({error:'Original message not found'},404);
    // Public writes have a fixed daily cap. Paid upgrades are never automatic.
    if (kind==='user') {
      const today=new Date().toISOString().slice(0,10);
      const count=rows("SELECT value FROM shared_meta WHERE key=?",'messages:'+today)[0];
      if (Number(count?.value||0)>=200) return json({error:'Daily message limit reached. Try again tomorrow.'},429);
      sql.exec("DELETE FROM shared_meta WHERE key LIKE 'messages:%' AND key<>?",'messages:'+today);
      sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)','messages:'+today,String(Number(count?.value||0)+1));
    }
    const value={...body,title:body.title?.trim()};insert(value,kind);
    if(kind==='user')enqueueRelayMessage(ctx,entry(rows('SELECT * FROM shared_entries WHERE id=?',body.id)[0]));
    if(kind==='briefing'&&body.date)sql.exec('INSERT INTO shared_briefing_dates VALUES(?,?)',body.date,body.id);
    return json({entry:entry(rows('SELECT * FROM shared_entries WHERE id=?',body.id)[0])},201);
  });
}
