import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describeTool, describeResult, shouldSend} from './jarvis-claude/live.mjs';
import {checkProgress} from './jarvis-claude/jc.mjs';

const LIVE = new URL('./jarvis-claude/live.mjs', import.meta.url).pathname;

test('live notes say what Claude is doing, in a few words, and skip its own chatter', () => {
  assert.equal(describeTool('Bash', {command: 'node --test tests/x.test.mjs', description: 'run the guitar tests'}), 'Run the guitar tests');
  assert.equal(describeTool('Bash', {command: 'node scripts/jarvis-claude/jc.mjs say t hi', description: 'Reply'}), null, 'jc itself is not news');
  assert.equal(describeTool('Bash', {command: 'cat /tmp/out.txt'}), null);
  assert.equal(describeTool('Bash', {command: 'npm test'}), 'Running npm');
  assert.equal(describeTool('Read', {file_path: '/repo/frontend/chats/src/styles.css'}), 'Reading styles.css');
  assert.equal(describeTool('Edit', {file_path: '/repo/a/chat.js'}), 'Editing chat.js');
  assert.equal(describeTool('Write', {file_path: '/repo/a/new.md'}), 'Writing new.md');
  assert.equal(describeTool('Grep', {pattern: 'renderHeader'}), 'Searching the code for “renderHeader”');
  assert.equal(describeTool('WebFetch', {url: 'https://example.com/a/page.html'}), 'Reading example.com');
  assert.equal(describeTool('mcp__github__merge_pull_request', {}), 'Merging the pull request');
  assert.equal(describeTool('mcp__github__actions_run_trigger', {method: 'run_workflow', inputs: {action: 'publish'}}), 'Starting the deploy');
  assert.equal(describeTool('mcp__github__pull_request_read', {method: 'get_check_runs'}), 'Checking CI');
  assert.equal(describeTool('TaskList', {}), null);
  assert.equal(describeTool('Bash', {description: 'x'.repeat(200)}).length, 70);
});

test('a finished test run reports its counts', () => {
  assert.equal(describeResult('Bash', {stdout: '# tests 19\n# pass 19\n# fail 0\n'}), 'Tests: 19 passed ✓');
  assert.equal(describeResult('Bash', {stdout: '# pass 4\n# fail 1\n# pass 7\n# fail 2\n'}), 'Tests: 7 passed, 2 failed', 'the last summary wins');
  assert.equal(describeResult('Bash', 'Validation passed (15 required files)'), 'Checks passed ✓');
  assert.equal(describeResult('Bash', {stdout: 'hello'}), null);
  assert.equal(describeResult('Read', {stdout: '# pass 1'}), null);
});

test('notes go out only while working, not twice, and not faster than one every few seconds', () => {
  const now = 1_000_000_000_000, working = {state: 'working', at: now - 1000};
  assert.equal(shouldSend('Reading a.js', {state: working, last: null, now}), true);
  assert.equal(shouldSend('Reading a.js', {state: {state: 'listening', at: now}, last: null, now}), false, 'a listening session stays quiet');
  assert.equal(shouldSend('Reading a.js', {state: null, last: null, now}), false, 'no jc state: not a Jarvis session');
  assert.equal(shouldSend('Reading a.js', {state: {state: 'working', at: now - 4 * 3600_000}, last: null, now}), false, 'stale');
  assert.equal(shouldSend('Reading a.js', {state: working, last: {note: 'Reading a.js', at: now - 60_000}, now}), false, 'same note');
  assert.equal(shouldSend('Reading b.js', {state: working, last: {note: 'Reading a.js', at: now - 1000}, now}), false, 'too soon');
  assert.equal(shouldSend('Tests: 3 passed ✓', {state: working, last: {note: 'Run tests', at: now - 1000}, now, force: true}), true, 'results always go');
  assert.equal(shouldSend(null, {state: working, last: null, now}), false);
});

test('CI progress counts finished checks and failures', () => {
  const run = (status, conclusion = null) => ({status, conclusion});
  assert.deepEqual(checkProgress([run('completed', 'success'), run('in_progress'), run('queued')]), {done: 1, total: 3, failed: 0, finished: false});
  assert.deepEqual(checkProgress([run('completed', 'success'), run('completed', 'skipped')]), {done: 2, total: 2, failed: 0, finished: true});
  assert.deepEqual(checkProgress([run('completed', 'failure'), run('in_progress')]), {done: 1, total: 2, failed: 1, finished: false});
  assert.equal(checkProgress([]).finished, false);
});

test('as a hook, live.mjs posts the note through jc only while the session is working', async t => {
  const posts = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    posts.push(JSON.parse(body));
    res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({status: {alive: true}}));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const TMPDIR = mkdtempSync(join(tmpdir(), 'jc-live-'));
  t.after(() => rmSync(TMPDIR, {recursive: true, force: true}));
  const env = {...process.env, TMPDIR, JC_API: `http://127.0.0.1:${server.address().port}`, JC_KEY: 'k', HTTPS_PROXY: '', https_proxy: '', CLAUDE_CODE_REMOTE_SESSION_ID: ''};
  const hook = (phase, event) => new Promise(done => {
    const child = spawn(process.execPath, [LIVE, phase], {env});
    child.on('exit', done);
    child.stdin.end(JSON.stringify(event));
  });
  const waitFor = async (n, ms = 5000) => { const end = Date.now() + ms; while (posts.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 50)); };

  await hook('pre', {tool_name: 'Read', tool_input: {file_path: '/r/chat.js'}});
  await new Promise(r => setTimeout(r, 400));
  assert.equal(posts.length, 0, 'not a working Jarvis session: nothing sent');

  writeFileSync(join(TMPDIR, 'jc-state.json'), JSON.stringify({state: 'working', at: Date.now()}));
  await hook('pre', {tool_name: 'Read', tool_input: {file_path: '/r/chat.js'}});
  await waitFor(1);
  assert.deepEqual(posts[0], {op: 'status', args: {state: 'working', note: 'Reading chat.js'}});
  await hook('post', {tool_name: 'Bash', tool_input: {command: 'node --test'}, tool_response: {stdout: '# pass 5\n# fail 0\n'}});
  await waitFor(2);
  assert.equal(posts[1].args.note, 'Tests: 5 passed ✓');
});
