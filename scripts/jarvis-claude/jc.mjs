#!/usr/bin/env node
// jc: how the "Jarvis Claude" cloud session talks to Jarvis Chats.
//
// The session never sees a key. Its cloud environment holds a network secret
// for the Worker's host, and Anthropic's proxy adds the Authorization header
// to requests as they leave the session. (JC_KEY is only for local testing.)
//
//   jc wait [--minutes 24]      wait for owner messages; prints them as JSON and
//                               exits 0, or exits 3 when the time is up with none
//   jc history <thread> [--limit 40]
//   jc say <thread> [--reply-to <id>] [--kind text|progress|question|card] [--meta JSON] <text | ->
//   jc status working|listening|stopping [--thread <id>] [--note text]
//   jc title <thread> <title>
//   jc link <thread>            records this session's link on the thread
//   jc threads
//   jc notebook [--write <file|->] [--version N]
//
// Every call is one HTTPS request to POST /claude-chat/agent {op, args}.

import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

const API = (process.env.JC_API || 'https://jarvis-hub-api.braydenparker999.workers.dev').replace(/\/$/, '');
const SESSION_URL = process.env.CLAUDE_CODE_REMOTE_SESSION_ID ? `https://claude.ai/code/${process.env.CLAUDE_CODE_REMOTE_SESSION_ID}` : undefined;

export async function call(op, args = {}, {timeoutMs = 70_000} = {}) {
  const headers = {'Content-Type': 'application/json'};
  if (process.env.JC_KEY) headers.Authorization = `Bearer ${process.env.JC_KEY}`;
  const response = await fetch(`${API}/claude-chat/agent`, {method: 'POST', headers, body: JSON.stringify({op, args}), signal: AbortSignal.timeout(timeoutMs)});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), {status: response.status});
  return body;
}

function parse(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else rest.push(argv[i]);
  }
  return {flags, rest};
}
const stdin = () => readFileSync(0, 'utf8');
const out = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function wait(minutes) {
  const deadline = Date.now() + minutes * 60_000;
  let failures = 0;
  while (Date.now() < deadline) {
    try {
      const left = deadline - Date.now();
      const {messages} = await call('take', {wait: Math.min(50_000, Math.max(1000, left)), sessionUrl: SESSION_URL});
      failures = 0;
      if (messages.length) { out({messages}); return 0; }
    } catch (error) {
      // The lease lapses after ~75 s without a call, so keep trying, gently.
      if (error.status === 401 || error.status === 403) { console.error(`jc: refused (${error.status}): ${error.message}`); return 2; }
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
      out(await call('post', {id: randomUUID(), threadId, body, kind: flags.kind || 'text', replyTo: flags['reply-to'], meta}));
      return 0;
    }
    case 'status': out(await call('status', {state: rest[0] || 'working', threadId: flags.thread, note: typeof flags.note === 'string' ? flags.note : undefined, sessionUrl: SESSION_URL})); return 0;
    case 'title': out(await call('thread.update', {id: rest[0], title: rest.slice(1).join(' ')})); return 0;
    case 'link': out(await call('thread.update', {id: rest[0], sessionUrl: SESSION_URL})); return 0;
    case 'threads': out(await call('threads')); return 0;
    case 'notebook': {
      if (flags.write === undefined) { out(await call('notebook')); return 0; }
      const body = flags.write === '-' || flags.write === true ? stdin() : readFileSync(flags.write, 'utf8');
      out(await call('notebook', {body, version: flags.version === undefined ? undefined : Number(flags.version)}));
      return 0;
    }
    default:
      console.error('usage: jc wait|history|say|status|title|link|threads|notebook (see the header of this file)');
      return 64;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(`jc: ${error.message}`); process.exit(1); });
}
