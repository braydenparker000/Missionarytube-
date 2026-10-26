#!/usr/bin/env node
// live: turns what this Claude session is doing into Jarvis Chats status notes,
// so the owner's task card says "Editing styles.css" or "Tests: 19 passed"
// within a second, without Claude stopping to post it.
//
// Claude Code runs this as a hook (.claude/settings.json): `live.mjs pre`
// before each tool call, `live.mjs post` after a Bash call. It does nothing
// unless jc's last status in this session was "working" (jc-state.json in the
// temp directory, written by `jc status`), so ordinary coding sessions and a
// listening Jarvis session stay quiet. It never blocks the tool: notes go out
// through a detached `jc status working --note …`, at most one every few
// seconds, and an identical note is not sent twice in a row.

import {readFileSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

const STATE_FILE = join(tmpdir(), 'jc-state.json'); // = jc.mjs STATE_FILE
const LAST_FILE = join(tmpdir(), 'jc-live-last.json');
const FRESH_MS = 3 * 60 * 60_000; // a "working" state older than this is stale
const GAP_MS = 3000;

const clip = (text, n = 70) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const file = path => basename(String(path || '')) || 'a file';
const capital = text => text ? text[0].toUpperCase() + text.slice(1) : text;

/** The note for a tool call about to run, or null for calls not worth a line. */
export function describeTool(name, input = {}) {
  switch (name) {
    case 'Bash': {
      const command = String(input.command || '');
      if (/jarvis-claude\/(jc|live)\.mjs/.test(command) || /^\s*(cat|ls|head|tail|date|echo|pwd)\b/.test(command) && !input.description) return null;
      if (input.description) return capital(clip(input.description));
      return `Running ${clip(command.split(/\s+/)[0], 30)}`;
    }
    case 'Read': return `Reading ${file(input.file_path)}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Editing ${file(input.file_path || input.notebook_path)}`;
    case 'Write': return `Writing ${file(input.file_path)}`;
    case 'Grep': return input.pattern ? `Searching the code for “${clip(input.pattern, 30)}”` : 'Searching the code';
    case 'Glob': return 'Looking for files';
    case 'WebSearch': return `Searching the web: ${clip(input.query, 50)}`;
    case 'WebFetch': { try { return `Reading ${new URL(input.url).hostname}`; } catch { return 'Reading a web page'; } }
    case 'Agent': case 'Task': return input.description ? `Delegating: ${clip(input.description, 50)}` : 'Delegating a task';
    case 'Artifact': return 'Publishing a page';
    case 'mcp__github__create_pull_request': return 'Opening the pull request';
    case 'mcp__github__merge_pull_request': return 'Merging the pull request';
    case 'mcp__github__pull_request_read': return input.method === 'get_check_runs' || input.method === 'get_status' ? 'Checking CI' : 'Reading the pull request';
    case 'mcp__github__get_job_logs': return 'Reading the CI logs';
    case 'mcp__github__actions_run_trigger': return input.inputs?.action === 'publish' ? 'Starting the deploy' : input.method === 'run_workflow' ? 'Starting a workflow' : 'Re-running CI';
    case 'mcp__github__actions_list': case 'mcp__github__actions_get': return 'Checking workflow runs';
    default: return null;
  }
}

/** A note from a finished Bash call's output (test counts), or null. */
export function describeResult(name, response) {
  if (name !== 'Bash') return null;
  const text = typeof response === 'string' ? response : [response?.stdout, response?.stderr, response?.output].filter(Boolean).join('\n');
  // node --test prints "# pass N" / "# fail N"; with several runs, the last pair is the summary.
  const pass = [...text.matchAll(/^# pass (\d+)$/gm)].at(-1)?.[1], fail = [...text.matchAll(/^# fail (\d+)$/gm)].at(-1)?.[1];
  if (pass !== undefined) return Number(fail) ? `Tests: ${pass} passed, ${fail} failed` : `Tests: ${pass} passed ✓`;
  if (/^Validation passed/m.test(text)) return 'Checks passed ✓';
  return null;
}

/** Whether to send a note now, given the session's state and the last note sent. */
export function shouldSend(note, {state, last, now = Date.now(), force = false}) {
  if (!note || state?.state !== 'working' || now - (state.at || 0) > FRESH_MS) return false;
  if (last?.note === note) return false;
  return force || now - (last?.at || 0) >= GAP_MS;
}

const readJSON = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

function main(phase) {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const note = phase === 'post' ? describeResult(input.tool_name, input.tool_response) : describeTool(input.tool_name, input.tool_input);
  // Results (test counts) always go out; the step before them may have just been sent.
  if (!shouldSend(note, {state: readJSON(STATE_FILE), last: readJSON(LAST_FILE), force: phase === 'post'})) return;
  try { writeFileSync(LAST_FILE, JSON.stringify({note, at: Date.now()})); } catch {}
  const jc = new URL('./jc.mjs', import.meta.url).pathname;
  spawn(process.execPath, [jc, 'status', 'working', '--note', note], {detached: true, stdio: 'ignore'}).unref();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(process.argv[2]); } catch {}
  process.exit(0);
}
