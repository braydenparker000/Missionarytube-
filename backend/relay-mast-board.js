// Muse publishes the Daily Board straight to the Worker (no GitHub detour) and
// keeps the owner's board brief: what to cover, how deep, how far back.
// Mast token only; reached through mastAdapterStore, which checks it.
import {prepare} from '../frontend/daily-board/v1/schema.js';
import {sharedStore,sharedSchema} from './shared.js';
import {PRIMARY_SITE} from './origins.js';
import {RelayError, fields} from './relay-common.js';

export const BOARD_URL = PRIMARY_SITE + '/daily-board/';
export const BOARD_TIMEZONE = 'America/Argentina/Cordoba';
export const DEPTHS = ['headlines', 'standard', 'deep'];
const PROFILE_KEY = 'board-profile';
const BACKFILL_DAYS = 7;
const fail = (status, message, extra) => { throw new RelayError(-32602, message, {status, ...extra}); };
const rows = (ctx, query, ...args) => [...ctx.storage.sql.exec(query, ...args)];
const json = (x, status = 200) => Response.json(x, {status});

/** The board's calendar day (Rosario) for a time. */
export function boardDate(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: BOARD_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).format(ms);
}
const shift = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;
function strings(v, max, length, name) {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > max || v.some(x => !text(x, length))) fail(400, `${name}: up to ${max} entries of up to ${length} characters`);
}
/** The owner's brief for the board. Throws a 400 naming the field that is wrong. */
export function checkProfile(p) {
  if (!p || Object.getPrototypeOf(p) !== Object.prototype) fail(400, 'profile must be an object');
  const allowed = ['focus', 'interests', 'avoid', 'depth', 'stories', 'lookbackHours', 'regions', 'sources', 'notes'];
  const unknown = Object.keys(p).filter(k => !allowed.includes(k));
  if (unknown.length) fail(400, 'Unknown profile field: ' + unknown.join(', '));
  if (!text(p.focus, 1000)) fail(400, 'focus: what the board is for, up to 1000 characters');
  if (!Array.isArray(p.interests) || !p.interests.length || p.interests.length > 30) fail(400, 'interests: 1 to 30 topics');
  for (const i of p.interests) {
    if (!i || Object.getPrototypeOf(i) !== Object.prototype || Object.keys(i).some(k => !['topic', 'priority', 'notes'].includes(k))) fail(400, 'interests: each is {topic, priority, notes?}');
    if (!text(i.topic, 120) || !['high', 'normal', 'low'].includes(i.priority) || i.notes !== undefined && !text(i.notes, 500)) fail(400, 'interests: topic (120), priority high|normal|low, notes (500)');
  }
  strings(p.avoid, 30, 200, 'avoid');
  strings(p.regions, 20, 80, 'regions');
  if (!DEPTHS.includes(p.depth)) fail(400, 'depth: ' + DEPTHS.join('|'));
  const s = p.stories;
  if (!s || Object.keys(s).some(k => !['min', 'max'].includes(k)) || !Number.isInteger(s.min) || !Number.isInteger(s.max) || s.min < 1 || s.max > 12 || s.min > s.max) fail(400, 'stories: {min, max}, 1 to 12');
  if (!Number.isInteger(p.lookbackHours) || p.lookbackHours < 6 || p.lookbackHours > 168) fail(400, 'lookbackHours: 6 to 168');
  if (p.sources !== undefined) {
    if (!p.sources || Object.getPrototypeOf(p.sources) !== Object.prototype || Object.keys(p.sources).some(k => !['prefer', 'avoid'].includes(k))) fail(400, 'sources: {prefer?, avoid?}');
    strings(p.sources.prefer, 30, 200, 'sources.prefer');
    strings(p.sources.avoid, 30, 200, 'sources.avoid');
  }
  if (p.notes !== undefined && !text(p.notes, 2000)) fail(400, 'notes: up to 2000 characters');
  return p;
}

function savedProfile(ctx) {
  const value = rows(ctx, 'SELECT value FROM shared_meta WHERE key=?', PROFILE_KEY)[0]?.value;
  return value ? JSON.parse(value) : {profile: null, version: 0, updatedAt: null};
}
function published(ctx, from) {
  return rows(ctx, `SELECT d.date, e.id, e.title, e.created_at FROM shared_briefing_dates d JOIN shared_entries e ON e.id=d.entry_id
    WHERE d.date>=? ORDER BY d.date DESC LIMIT 31`, from).map(r => ({date: r.date, id: r.id, title: r.title, createdAt: r.created_at}));
}

/** Everything a run needs first: today's board date, what is published, the brief. */
function read(ctx, now) {
  const today = boardDate(now), recent = published(ctx, shift(today, -13));
  const have = new Set(recent.map(r => r.date));
  const missing = Array.from({length: BACKFILL_DAYS}, (_, i) => shift(today, -i)).filter(d => !have.has(d));
  return {today, timezone: BOARD_TIMEZONE, publishedToday: have.has(today), missing, recent, ...savedProfile(ctx), board: BOARD_URL};
}

function publish(ctx, report, now) {
  let publication;
  try { publication = prepare(report, {reviewedPublic: true}); }
  catch (error) { fail(400, 'Report rejected: ' + error.message); }
  const today = boardDate(now);
  if (report.date > today) fail(400, `Report date ${report.date} is after today (${today}, ${BOARD_TIMEZONE})`);
  if (report.date < shift(today, -BACKFILL_DAYS)) fail(400, `Report date ${report.date} is more than ${BACKFILL_DAYS} days old`);
  const response = sharedStore(ctx, '/internal/shared/briefing', publication);
  const view = id => {
    const r = rows(ctx, 'SELECT d.date, e.id, e.title, e.created_at FROM shared_entries e LEFT JOIN shared_briefing_dates d ON d.entry_id=e.id WHERE e.id=?', id)[0];
    return r && {id: r.id, date: r.date, title: r.title, createdAt: r.created_at};
  };
  if (response.status === 201) return json({published: true, entry: view(report.id), board: BOARD_URL}, 201);
  if (response.ok) return json({published: false, duplicate: true, entry: view(report.id), board: BOARD_URL});
  if (response.status === 409) {
    const existing = rows(ctx, 'SELECT entry_id FROM shared_briefing_dates WHERE date=?', report.date)[0]?.entry_id;
    if (existing && existing !== report.id) fail(409, `A different report is already published for ${report.date}`, {existing: view(existing)});
    fail(409, 'This report id was already published with different content. Corrections need a new date or the owner.');
  }
  fail(503, 'The board could not save the report. Retry the same report.');
}

function saveProfile(ctx, input, now) {
  fields(input, ['op', 'token_hash', 'version', 'profile'], ['op', 'token_hash', 'version', 'profile']);
  const profile = checkProfile(input.profile), current = savedProfile(ctx);
  if (input.version !== current.version) fail(409, `The brief changed (version ${current.version}). Read it again and reapply your change.`, {current});
  const next = {profile, version: current.version + 1, updatedAt: new Date(now).toISOString()};
  ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)', PROFILE_KEY, JSON.stringify(next));
  return json(next);
}

export function mastBoard(ctx, input, now = Date.now()) {
  // Synchronous throughout, so each call is atomic in the object; sharedStore
  // keeps its own transaction for the publish.
  try {
    sharedSchema(ctx);
    if (input.op === 'board_read') { fields(input, ['op', 'token_hash']); return json(read(ctx, now)); }
    if (input.op === 'board_publish') { fields(input, ['op', 'token_hash', 'report'], ['op', 'token_hash', 'report']); return publish(ctx, input.report, now); }
    if (input.op === 'board_profile') return saveProfile(ctx, input, now);
    fail(404, 'Not found');
  } catch (error) {
    if (!(error instanceof RelayError)) throw error;
    const {status = 400, ...extra} = error.data || {};
    return json({error: error.message, ...extra}, status);
  }
}
