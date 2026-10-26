#!/usr/bin/env node
// jc: how the "Jarvis Claude" cloud session talks to Jarvis Chats.
//
// The session never sees a key. Its cloud environment holds a network secret
// for the Worker's host, and Anthropic's proxy adds the Authorization header
// to requests as they leave the session. (JC_KEY is only for local testing.)
// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1, so jc
// restarts itself with it when a proxy is configured; otherwise its requests
// would skip the proxy and arrive without the key.
//
//   jc wait [--minutes 24]      wait for owner messages; prints them as JSON and
//                               exits 0, exits 3 when the time is up with none, or
//                               exits 4 (printing {stop}) when the owner taps Stop
//   jc history <thread> [--limit 40]
//   jc say <thread> [--reply-to <id>] [--kind text|progress|question|card] [--meta JSON]
//          [--attach <file>]… <text | ->     attachments: photos, screenshots, files (≤ 15 MB each)
//   jc file <attachment id> [--out <path>]  saves an attachment from a message; prints where
//   jc status working|listening|stopping [--thread <id>] [--note text]
//   jc amend <message id> [--meta JSON] [--body <text | ->]   update your own post (a card's state)
//   jc title <thread> <title>
//   jc link <thread>            records this session's link on the thread
//   jc threads
//   jc notebook [--write <file|->] [--version N]
//   jc log                      the Worker's recent handouts and requeues (which
//                               session took which message), to trace a lost one
//
// Every call is one HTTPS request to POST /claude-chat/agent {op, args}.
// When the owner has tapped Stop, every answer to a post or status says so,
// and jc prints a STOP line on stderr: finish the step, report, and stop.

import {randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {basename, extname, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const API = (process.env.JC_API || 'https://jarvis-hub-api.braydenparker999.workers.dev').replace(/\/$/, '');
// The session's id (cse_…) shares its suffix with the session's claude.ai link (session_…).
const SESSION_ID = process.env.CLAUDE_CODE_REMOTE_SESSION_ID || '';
const SESSION_URL = /^(cse|session)_[A-Za-z0-9]+$/.test(SESSION_ID) ? `https://claude.ai/code/${SESSION_ID.replace(/^cse_/, 'session_')}` : undefined;

export async function call(op, args = {}, {timeoutMs = 70_000} = {}) {
  const headers = {'Content-Type': 'application/json'};
  if (process.env.JC_KEY) headers.Authorization = `Bearer ${process.env.JC_KEY}`;
  const response = await fetch(`${API}/claude-chat/agent`, {method: 'POST', headers, body: JSON.stringify({op, args}), signal: AbortSignal.timeout(timeoutMs)});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), {status: response.status});
  if (body.stop) console.error(`jc: STOP: the owner asked you to stop${body.stop.threadId ? ` (thread ${body.stop.threadId})` : ''}. Finish the current step, post a short reply saying what was and was not done, and stop working.`);
  return body;
}

function parse(argv) {
  const flags = {attach: []}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { rest.push(argv[i]); continue; }
    const key = argv[i].slice(2), value = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    if (key === 'attach') flags.attach.push(value); else flags[key] = value;
  }
  return {flags, rest};
}

// ——— Attachments ———
const TYPES = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  mp3: 'audio/mpeg', opus: 'audio/ogg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', zip: 'application/zip'};
async function upload(path) {
  const bytes = readFileSync(path), name = basename(path);
  const headers = {'Content-Type': TYPES[extname(name).slice(1).toLowerCase()] || 'application/octet-stream', 'X-File-Name': encodeURIComponent(name)};
  if (process.env.JC_KEY) headers.Authorization = `Bearer ${process.env.JC_KEY}`;
  const response = await fetch(`${API}/claude-chat/agent/files`, {method: 'POST', headers, body: bytes, signal: AbortSignal.timeout(120_000)});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`${name}: ${body.error || `HTTP ${response.status}`}`), {status: response.status});
  return body.file;
}
async function download(id, out) {
  const headers = process.env.JC_KEY ? {Authorization: `Bearer ${process.env.JC_KEY}`} : {};
  const response = await fetch(`${API}/claude-chat/agent/files/${encodeURIComponent(id)}`, {headers, signal: AbortSignal.timeout(120_000)});
  if (!response.ok) throw Object.assign(new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`), {status: response.status});
  const name = decodeURIComponent(response.headers.get('x-file-name') || id).replace(/[\/\\]/g, '') || id;
  const path = typeof out === 'string' ? out : join(tmpdir(), 'jc-files', id + '-' + name);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}
const stdin = () => readFileSync(0, 'utf8');
const out = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

// The last Stop this machine's waits reported, so each Stop ends one wait only.
const STOP_SEEN = join(tmpdir(), 'jc-stop-seen');
const stopSeen = () => { try { return Number(readFileSync(STOP_SEEN, 'utf8')) || 0; } catch { return 0; } };

// The session's proxy ends any request after 30 s (502), and a take it cuts
// may already have been handed messages. Each take stays well under that.
export const TAKE_WAIT_MS = 25_000;

async function wait(minutes) {
  const deadline = Date.now() + minutes * 60_000;
  let failures = 0, take;
  while (Date.now() < deadline) {
    try {
      const left = deadline - Date.now();
      // Each take has an id the Worker logs, so a reply lost on the way back can be matched to it.
      take = randomUUID();
      const {messages, stop} = await call('take', {wait: Math.min(TAKE_WAIT_MS, Math.max(1000, left)), sessionUrl: SESSION_URL, stopSeen: stopSeen(), take});
      failures = 0;
      if (messages.length) { out({messages}); return 0; }
      if (stop) { try { writeFileSync(STOP_SEEN, String(stop.at)); } catch {} out({stop}); return 4; }
    } catch (error) {
      // The lease lapses after ~75 s without a call, so keep trying, gently.
      if (error.status === 401 || error.status === 403) { console.error(`jc: refused (${error.status}): ${error.message}`); return 2; }
      console.error(`jc: ${new Date().toISOString()} take ${take} failed: ${error.status ? `HTTP ${error.status} ` : ''}${error.message}`);
      failures++;
      await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
    }
  }
  return 3;
}

async function main(argv) {
  const [command, ...tail] = argv;
  const {flags, rest} = parse(tail);
  switch (command) {
    case 'wait': return wait(Number(flags.minutes) || 24);
    case 'history': out(await call('messages', {threadId: rest[0], limit: Number(flags.limit) || 40})); return 0;
    case 'say': {
      const [threadId, ...words] = rest;
      const body = words.length === 1 && words[0] === '-' ? stdin() : words.join(' ');
      const meta = typeof flags.meta === 'string' ? JSON.parse(flags.meta) : undefined;
      const attachments = [];
      for (const path of flags.attach) attachments.push(await upload(path));
      out(await call('post', {id: randomUUID(), threadId, body, kind: flags.kind || 'text', replyTo: flags['reply-to'], meta, attachments: attachments.length ? attachments : undefined}));
      return 0;
    }
    case 'file': console.log(await download(rest[0], flags.out)); return 0;
    case 'status': out(await call('status', {state: rest[0] || 'working', threadId: flags.thread, note: typeof flags.note === 'string' ? flags.note : undefined, sessionUrl: SESSION_URL})); return 0;
    case 'amend': {
      const body = flags.body === '-' ? stdin() : typeof flags.body === 'string' ? flags.body : undefined;
      const meta = typeof flags.meta === 'string' ? JSON.parse(flags.meta) : undefined;
      out(await call('amend', {id: rest[0], body, meta}));
      return 0;
    }
    case 'title': out(await call('thread.update', {id: rest[0], title: rest.slice(1).join(' ')})); return 0;
    case 'link': out(await call('thread.update', {id: rest[0], sessionUrl: SESSION_URL})); return 0;
    case 'threads': out(await call('threads')); return 0;
    case 'log': out(await call('log')); return 0;
    case 'notebook': {
      if (flags.write === undefined) { out(await call('notebook')); return 0; }
      const body = flags.write === '-' || flags.write === true ? stdin() : readFileSync(flags.write, 'utf8');
      out(await call('notebook', {body, version: flags.version === undefined ? undefined : Number(flags.version)}));
      return 0;
    }
    default:
      console.error('usage: jc wait|history|say|file|amend|status|title|link|threads|notebook|log (see the header of this file)');
      return 64;
  }
}

/** True when jc must restart itself so that fetch goes through the session's proxy. */
export function needsProxyRestart(env = process.env) {
  return !!(env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY !== '1';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (needsProxyRestart()) {
    const child = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.execArgv, ...process.argv.slice(1)],
      {stdio: 'inherit', env: {...process.env, NODE_USE_ENV_PROXY: '1'}});
    process.exit(child.status ?? 1);
  }
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`jc: ${error.message}`); process.exit(1); });
}
