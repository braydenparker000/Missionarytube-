// scripts/drawercast-phase12-qualification.mjs
//
// Focused pre-publication behavior qualification for the Poweramp player
// Phase 1+2 bytes (PR #258) and the shuffle worker.
//
// This is NOT a general test suite: it executes the exact changed code paths
// (P1 conditional library refresh; E1 resilient play path; E2 guarded
// auto-resume; E3 adaptive stall watchdog; E4 audio wake-up retries; E5 honest
// offline status; shuffle-worker generation) against the exact bytes the
// publisher will upload, using the same node:vm harness pattern as the
// existing jarvis/tests/drawercast-*.test.js files. Every test drives the real
// functions and asserts observable behavior — nothing here string-matches the
// source for proof.
//
// Binding: this file asserts the reviewed sha256/byte-length pins itself
// before running anything, and the publisher invokes it with
// POWERAMP_SOURCE_ROOT pointing at the pin-verified SOURCE checkout, requiring
// exit 0 before any upload. It is invoked explicitly by
// scripts/publish-poweramp-shuffle.mjs and is intentionally NOT named
// *.test.mjs, so the root `npm test` glob does not pick it up (there is no
// .poweramp-source checkout in ordinary CI).
//
// Run: POWERAMP_SOURCE_ROOT=/path/to/.poweramp-source node --test scripts/drawercast-phase12-qualification.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SOURCE_ROOT = process.env.POWERAMP_SOURCE_ROOT;
assert.ok(SOURCE_ROOT, 'POWERAMP_SOURCE_ROOT must point at the pinned source checkout (refusing to run against unknown bytes)');
const PLAYER = resolve(SOURCE_ROOT, 'jarvis/public/drawercast/player.js');
const SHUFFLE_WORKER = resolve(SOURCE_ROOT, 'jarvis/public/drawercast/shuffle-worker.js');

// The exact bytes under test are the exact bytes the publisher uploads.
// POWERAMP_PINS_FILE overrides the pins path for verification runs only
// (e.g. demonstrating that the regression tests fail against the old bytes);
// the publisher never sets it, so publication always uses the reviewed pins.
const PINS_PATH = process.env.POWERAMP_PINS_FILE || resolve(REPO, 'scripts/poweramp-shuffle-file-pins.json');
const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8'));
const pinByPath = new Map(pins.map(p => [p.path, p]));
const playerBytes = readFileSync(PLAYER);
const workerBytes = readFileSync(SHUFFLE_WORKER);
// The player pin lives under its fingerprinted live path (perf overhaul);
// the pinned bytes are identical to the logical source file.
const playerPinPath = [...pinByPath.keys()].find(p => /^drawercast\/player\.[0-9a-f]{12}\.js$/.test(p));
assert.ok(playerPinPath, 'no reviewed fingerprinted player pin');
for (const [rel, bytes, pinRel] of [['drawercast/player.js', playerBytes, playerPinPath], ['drawercast/shuffle-worker.js', workerBytes, 'drawercast/shuffle-worker.js']]) {
  const pin = pinByPath.get(pinRel);
  assert.ok(pin, 'no reviewed pin for ' + rel);
  assert.equal(bytes.length, pin.bytes, 'byte length drift for ' + rel);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, 'sha256 drift for ' + rel);
}
const playerSource = playerBytes.toString('utf8');
const workerSource = workerBytes.toString('utf8');

const block = (a, b) => {
  const s = playerSource.indexOf(a);
  assert.ok(s >= 0, 'block start not found: ' + a);
  const e = playerSource.indexOf(b, s);
  assert.ok(e > s, 'block end not found: ' + b);
  return playerSource.slice(s, e);
};
const settle = async (ticks = 25) => { for (let i = 0; i < ticks; i++) await Promise.resolve(); };

// ---------------------------------------------------------------------------
// Engine harness: evaluates the real `const Engine = {...}` block in a vm
// context with stubbed browser/platform globals, then drives its methods.
// ---------------------------------------------------------------------------
function engineHarness(overrides = {}) {
  const traces = [];
  const toasts = [];
  const timers = [];
  let timerSeq = 0;
  const base = {
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.push({id, fn, ms}); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    debounce: fn => fn,
    toast: (m) => toasts.push(m),
    UI: {renderPlayState(){}, renderProgress(){}, startLoop(){}, settling:false},
    SET: {fadeOnPause:false},
    navigator: {onLine:true},
    document: {visibilityState:'visible'},
    DriveSource: {pumpTags(){}, status:'', scheduleManifestCheck(){}},
    R2Source: {status:'', connect(){}},
    SourceLibrary: {kind:()=>'local'},
    AudioQuality: {reset(){}, refreshGain(){},
    },
  };
  const ctx = vm.createContext({...base, ...overrides});
  const src = block('const Engine = {', 'function SET_shuffleOn()');
  assert.ok(src.includes('r2PreflightWithRetry'), 'Engine block is missing the E1 preflight');
  assert.ok(src.includes('_armAutoResume'), 'Engine block is missing the E2 auto-resume');
  assert.ok(src.includes('stallDeadlineMs'), 'Engine block is missing the E3 watchdog');
  assert.ok(src.includes('readLibraryConditional') === false, 'wrong block extracted');
  const Engine = vm.runInContext(src + '\nEngine;', ctx);
  Engine.tracePlayback = (event, detail) => traces.push({event, detail});
  return {Engine, ctx, traces, toasts, timers,
    fireAll: () => { const p = timers.splice(0, timers.length); for (const t of p) t.fn(); return p.length; }};
}

// Pause() collaborators that are unchanged by PR #258: stubbed so the E2
// arming branch (the changed path) executes in isolation.
function stubPauseCollaborators(Engine) {
  Engine.cancelSleepFade = () => {};
  Engine.clearBuffering = () => {};
  Engine.clearR2Recovery = () => {};
  Engine.pauseElement = () => {};
  Engine.saveState = () => {};
  Engine.els = [{src:'https://r2.test/audio', paused:true}];
  Engine.cur = 0;
}

// ---------------------------------------------------------------------------
// R2Source harness: evaluates the real `const R2Source = {...}` block with a
// stubbed fetch/Headers pair and a controllable helper.readLibrary.
// ---------------------------------------------------------------------------
function r2Harness() {
  const requests = [];
  let responder = null;
  const ctx = vm.createContext({
    fetch: async (url, init) => { requests.push({url, init}); return responder(url, init); },
    Headers: class {
      constructor(init) { this.m = new Map(); if (init) for (const k of Object.keys(init)) this.m.set(k.toLowerCase(), init[k]); }
      set(k, v) { this.m.set(String(k).toLowerCase(), v); }
      get(k) { const v = this.m.get(String(k).toLowerCase()); return v === undefined ? null : v; }
    },
  });
  const src = block('const R2Source={', 'const PlaybackDiagnostics=');
  assert.ok(src.includes('readLibraryConditional'), 'R2Source block is missing the P1 conditional refresh');
  const R2Source = vm.runInContext(src + '\nR2Source;', ctx);
  return {R2Source, ctx, requests, setResponder: f => { responder = f; }};
}

const okLibrary = (etag) => async () => ({
  status: 200,
  headers: {get: (n) => n.toLowerCase() === 'etag' ? etag : null},
});
const stubHelper = (behavior) => ({readLibrary: behavior});
const passthroughHelper = async ({url, signal, fetcher}) => {
  const r = await fetcher(url, {headers:{}});
  return {tracks:[{id:'t1'}], mapping:{}, snapshot:{}};
};
const LIB_URL = 'https://r2.test/library.json';

// ---------------------------------------------------------------------------
// P1: conditional library refresh
// ---------------------------------------------------------------------------
test('P1: the library poll sends If-None-Match and promotes a fresh ETag on 200', async () => {
  const h = r2Harness();
  h.setResponder(okLibrary('"v2"'));
  h.R2Source.helper = stubHelper(passthroughHelper);
  h.R2Source._libraryETag = '"v1"';
  h.R2Source._libraryETagFor = LIB_URL;
  await h.R2Source.readLibraryConditional({url: LIB_URL});
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].init.headers.get('if-none-match'), '"v1"');
  assert.equal(h.R2Source._libraryETag, '"v2"');
  assert.equal(h.R2Source._libraryETagFor, LIB_URL);
});

test('P1: a 304 raises the not-modified sentinel and keeps the old ETag', async () => {
  const h = r2Harness();
  h.setResponder(async () => ({status:304, headers:{get:() => null}, body:{cancel: async () => {}}}));
  h.R2Source.helper = stubHelper(async ({url, fetcher}) => {
    await fetcher(url, {headers:{}});
    throw new Error('must not parse on 304');
  });
  h.R2Source._libraryETag = '"v1"';
  h.R2Source._libraryETagFor = LIB_URL;
  await assert.rejects(
    h.R2Source.readLibraryConditional({url: LIB_URL}),
    (e) => e.__r2NotModified === true && e.message === 'R2 library not modified');
  assert.equal(h.R2Source._libraryETag, '"v1"', 'a 304 must not promote anything');
});

test('P1: an over-long ETag is never promoted', async () => {
  const h = r2Harness();
  h.setResponder(okLibrary('x'.repeat(600)));
  h.R2Source.helper = stubHelper(passthroughHelper);
  h.R2Source._libraryETag = '"v1"';
  h.R2Source._libraryETagFor = LIB_URL;
  await h.R2Source.readLibraryConditional({url: LIB_URL});
  assert.equal(h.R2Source._libraryETag, '"v1"');
});

test('P1: the ETag is only promoted after a full successful parse', async () => {
  const h = r2Harness();
  h.setResponder(okLibrary('"v2"'));
  h.R2Source.helper = stubHelper(async ({url, fetcher}) => {
    await fetcher(url, {headers:{}});
    throw new Error('parse boom');
  });
  h.R2Source._libraryETag = '"v1"';
  h.R2Source._libraryETagFor = LIB_URL;
  await assert.rejects(h.R2Source.readLibraryConditional({url: LIB_URL}), /parse boom/);
  assert.equal(h.R2Source._libraryETag, '"v1"', 'a rejected body must never mask itself as current');
});

test('P1: switching library URLs resets the ETag instead of sending a stale one', async () => {
  const h = r2Harness();
  h.setResponder(okLibrary(null));
  h.R2Source.helper = stubHelper(passthroughHelper);
  h.R2Source._libraryETag = '"v1"';
  h.R2Source._libraryETagFor = 'https://r2.test/other.json';
  await h.R2Source.readLibraryConditional({url: LIB_URL});
  assert.equal(h.requests[0].init.headers.get('if-none-match'), null);
  assert.equal(h.R2Source._libraryETag, null);
});

// ---------------------------------------------------------------------------
// E1: resilient play path
// ---------------------------------------------------------------------------
test('E1: the preflight returns the mapped file immediately when available', async () => {
  const h = engineHarness({R2Source: {fileFor: () => ({__remoteURL:'https://r2.test/audio'}), busy:false, _lastRefreshNetwork:false}});
  const f = await h.Engine.r2PreflightWithRetry({id:'s', source:'r2'});
  assert.equal(f.__remoteURL, 'https://r2.test/audio');
  assert.equal(h.timers.length, 0, 'no wait when the mapping is already there');
});

test('E1: the preflight waits out an in-flight refresh and returns the landed file', async () => {
  let calls = 0;
  const h = engineHarness({R2Source: {
    fileFor: () => (++calls >= 2 ? {__remoteURL:'https://r2.test/audio'} : null),
    busy: true, _lastRefreshNetwork: false,
  }});
  const p = h.Engine.r2PreflightWithRetry({id:'s', source:'r2'});
  await settle();
  assert.equal(h.timers.length, 1, 'one bounded wait while the refresh is in flight');
  assert.equal(h.timers[0].ms, 1000);
  h.fireAll();
  const f = await p;
  assert.equal(f.__remoteURL, 'https://r2.test/audio');
  assert.ok(h.traces.some(t => t.event === 'r2-preflight-retry' && t.detail.attempt === 1));
});

test('E1: the preflight fails fast when no refresh can land the mapping', async () => {
  const h = engineHarness({R2Source: {fileFor: () => null, busy:false, _lastRefreshNetwork:false, _lastRefreshFailedAt:0}});
  const f = await h.Engine.r2PreflightWithRetry({id:'s', source:'r2'});
  assert.equal(f, null);
  assert.equal(h.timers.length, 0, 'a mapping that never existed fails fast');
});

test('E1: the refresh gate distinguishes a network blip from a missing mapping', () => {
  const mk = (r2) => engineHarness({R2Source: r2}).Engine;
  assert.equal(mk({busy:true}).r2RefreshMayLand(), true, 'in-flight refresh may land');
  assert.equal(mk({busy:false, _lastRefreshNetwork:true, _lastRefreshFailedAt:Date.now()}).r2RefreshMayLand(), true, 'seconds-old network failure may land');
  assert.equal(mk({busy:false, _lastRefreshNetwork:true, _lastRefreshFailedAt:Date.now()-30000}).r2RefreshMayLand(), false, 'stale failure fails fast');
  assert.equal(mk({busy:false, _lastRefreshNetwork:false, _lastRefreshFailedAt:0}).r2RefreshMayLand(), false, 'no failure on record fails fast');
});

test('E1: an AbortError on element start retries twice with backoff, then pauses interrupted', () => {
  const pauses = [];
  const h = engineHarness();
  h.Engine.pause = (reason) => pauses.push(reason);
  h.Engine.noteR2OfflineSource = () => {};
  h.Engine.updateMediaSession = () => {};
  h.Engine.transportCapabilities = () => ({});
  const audio = {
    src: 'https://r2.test/audio/track',
    play() { return {then: (ok, bad) => bad({name:'AbortError'})}; },
  };
  h.Engine.els = [audio];
  h.Engine.cur = 0;
  h.Engine._playRequest = 5;
  h.Engine._playAttempt = 0;
  h.Engine._playIntent = true;
  h.Engine._playStartRetries = {request:5, n:0};
  h.Engine.current = {id:'s'};
  h.Engine.startElement(audio);
  assert.equal(h.timers.length, 1, 'first retry scheduled');
  assert.equal(h.timers[0].ms, 1000);
  assert.ok(h.traces.some(t => t.event === 'play-start-retry' && t.detail.attempt === 1));
  h.fireAll();
  assert.equal(h.timers.length, 1, 'second retry scheduled');
  assert.equal(h.timers[0].ms, 2000);
  assert.ok(h.traces.some(t => t.event === 'play-start-retry' && t.detail.attempt === 2));
  h.fireAll();
  assert.deepEqual(pauses, ['interrupted'], 'budget spent -> interrupted pause, no third retry');
  assert.equal(h.timers.length, 0);
  assert.equal(h.traces.filter(t => t.event === 'play-start-retry').length, 2);
});

test('E1: decode and policy errors stay terminal — no retry', () => {
  const pauses = [];
  const h = engineHarness();
  h.Engine.pause = (reason) => pauses.push(reason);
  h.Engine.noteR2OfflineSource = () => {};
  h.Engine.updateMediaSession = () => {};
  h.Engine.transportCapabilities = () => ({});
  const audio = {
    src: 'https://r2.test/audio/track',
    play() { return {then: (ok, bad) => bad({name:'NotSupportedError'})}; },
  };
  h.Engine.els = [audio];
  h.Engine.cur = 0;
  h.Engine._playRequest = 5;
  h.Engine._playAttempt = 0;
  h.Engine._playIntent = true;
  h.Engine._playStartRetries = {request:5, n:0};
  h.Engine.current = {id:'s'};
  h.Engine.onError = (i, name) => pauses.push('onError:' + name);
  h.Engine.startElement(audio);
  assert.equal(h.traces.filter(t => t.event === 'play-start-retry').length, 0, 'no retry for decode errors');
  assert.equal(h.timers.length, 0);
});

test('E1+E2: an explicit play resets the retry budget, marks user control, and disarms auto-resume', () => {
  const pauses = [];
  const h = engineHarness();
  h.Engine.pause = (r) => pauses.push(r);
  h.Engine.cancelSleepFade = () => {};
  h.Engine.ctx = {state:'closed'};
  h.Engine._playRequest = 5;
  h.Engine._armAutoResume();
  assert.ok(h.Engine._autoResume, 'precondition: armed');
  h.Engine.play();
  assert.equal(h.Engine._playStartRetries.request, 5, 'retry budget request');
  assert.equal(h.Engine._playStartRetries.n, 0, 'retry budget count');
  assert.equal(h.Engine._userInteracted, true);
  assert.equal(h.Engine._autoResume, null);
  assert.deepEqual(pauses, ['context-failed']);
});

// ---------------------------------------------------------------------------
// E5: honest status messages
// ---------------------------------------------------------------------------
test('E5: the unavailable message names the network when the network is the problem', () => {
  const offline = engineHarness({navigator:{onLine:false}}).Engine;
  assert.equal(offline.r2UnavailableMessage(), 'Waiting for connection…');
  const mayLand = engineHarness({navigator:{onLine:true}, R2Source:{busy:true}}).Engine;
  assert.equal(mayLand.r2UnavailableMessage(), 'Waiting for connection…');
  const dead = engineHarness({navigator:{onLine:true}, R2Source:{busy:false, _lastRefreshNetwork:false}}).Engine;
  assert.equal(dead.r2UnavailableMessage(), 'Cloudflare R2 is unavailable. Refresh its source in Music Sources.');
});

// ---------------------------------------------------------------------------
// E2: guarded auto-resume
// ---------------------------------------------------------------------------
test('E2: only a system interruption arms auto-resume', () => {
  const h = engineHarness();
  stubPauseCollaborators(h.Engine);
  h.Engine._lastAutoResumeAttemptAt = 0;
  h.Engine.pause('interrupted');
  assert.ok(h.Engine._autoResume, 'interrupted arms');
  assert.ok(h.traces.some(t => t.event === 'auto-resume-armed'));
  assert.equal(h.Engine._userInteracted, false, 'arming clears the interaction flag');
});

test('E2: user and media-session pauses never arm auto-resume', () => {
  for (const reason of ['user', 'media-session']) {
    const h = engineHarness();
    stubPauseCollaborators(h.Engine);
    h.Engine._lastAutoResumeAttemptAt = 0;
    h.Engine.pause(reason);
    assert.equal(h.Engine._autoResume, null, reason + ' must not arm');
    assert.equal(h.Engine._userInteracted, true, reason + ' marks user control');
  }
});

test('E2: an interruption in the wake of our own resume attempt does not re-arm', () => {
  const h = engineHarness();
  stubPauseCollaborators(h.Engine);
  h.Engine._lastAutoResumeAttemptAt = Date.now();
  h.Engine.pause('interrupted');
  assert.equal(h.Engine._autoResume, null, 'immediate fallout of a resume attempt stays disarmed');
});

test('E2: auto-resume stands down the moment the user touched a control', () => {
  const h = engineHarness();
  let played = 0;
  h.Engine.play = () => played++;
  h.Engine._autoResume = {at: Date.now() - 5000, reason:'interrupted', timer:null};
  h.Engine._userInteracted = true;
  h.Engine.playing = false;
  h.Engine.current = {id:'s'};
  h.Engine.queue = [{id:'s'}];
  h.Engine._tryAutoResume();
  assert.equal(played, 0);
  assert.ok(h.traces.some(t => t.event === 'auto-resume-suppressed' && t.detail.why === 'user-interacted'));
});

test('E2: auto-resume fires inside its window when nothing stands in the way', () => {
  const h = engineHarness();
  let played = 0;
  h.Engine.play = () => played++;
  h.Engine._autoResume = {at: Date.now() - 5000, reason:'interrupted', timer:null};
  h.Engine._userInteracted = false;
  h.Engine.playing = false;
  h.Engine.current = {id:'s'};
  h.Engine.queue = [{id:'s'}];
  h.Engine._loadingRequest = 0;
  h.Engine._r2Recovery = null;
  h.Engine._r2RetryTimer = null;
  h.Engine._driveRetryTimer = null;
  h.Engine._serverRetryTimer = null;
  h.Engine._tryAutoResume();
  assert.equal(played, 1);
  assert.ok(h.traces.some(t => t.event === 'auto-resume-attempt'));
});

test('E2: auto-resume stays quiet once its window expires', () => {
  const h = engineHarness();
  let played = 0;
  h.Engine.play = () => played++;
  h.Engine._autoResume = {at: Date.now() - 16000, reason:'interrupted', timer:null};
  h.Engine._userInteracted = false;
  h.Engine.playing = false;
  h.Engine.current = {id:'s'};
  h.Engine.queue = [{id:'s'}];
  h.Engine._tryAutoResume();
  assert.equal(played, 0, 'never phone-call-length');
  assert.ok(h.traces.some(t => t.event === 'auto-resume-suppressed' && t.detail.why === 'window-expired'));
});

test('E2: scrubbing disarms an armed auto-resume', () => {
  const h = engineHarness();
  h.Engine._armAutoResume();
  assert.ok(h.Engine._autoResume, 'precondition: armed');
  h.Engine._loadingRequest = 1;
  h.Engine.seek(30);
  assert.equal(h.Engine._autoResume, null);
  assert.equal(h.Engine._userInteracted, true);
  assert.equal(h.Engine._requestedSeek, 30);
});

test('E2: stepping tracks disarms an armed auto-resume', () => {
  const stepped = [];
  const h = engineHarness({
    commitTrackStep: (x) => { stepped.push(x); return x; },
    resolveTrackStep: (d) => d,
  });
  h.Engine._armAutoResume();
  assert.ok(h.Engine._autoResume, 'precondition: armed');
  h.Engine.next();
  assert.equal(h.Engine._autoResume, null);
  assert.equal(h.Engine._userInteracted, true);
  assert.deepEqual(stepped, [1]);
});

test('E2: a visible page inside the resume window triggers the early resume', () => {
  const h = engineHarness({document:{visibilityState:'visible'}});
  let tried = 0;
  h.Engine._tryAutoResume = () => tried++;
  h.Engine._autoResume = {at: Date.now() - 5000, reason:'interrupted', timer:null};
  h.Engine._userInteracted = false;
  h.Engine.reconcilePlaybackLifecycle();
  assert.equal(tried, 1);
});

test('E2: no early resume after user interaction', () => {
  const h = engineHarness({document:{visibilityState:'visible'}});
  let tried = 0;
  h.Engine._tryAutoResume = () => tried++;
  h.Engine._autoResume = {at: Date.now() - 5000, reason:'interrupted', timer:null};
  h.Engine._userInteracted = true;
  h.Engine._playIntent = false;
  h.Engine.reconcilePlaybackLifecycle();
  assert.equal(tried, 0);
});

// ---------------------------------------------------------------------------
// E3: adaptive stall watchdog
// ---------------------------------------------------------------------------
test('E3: the stall deadline scales with the reported network', () => {
  const d = (conn) => engineHarness({navigator:{connection:conn}}).Engine.stallDeadlineMs();
  assert.equal(d({effectiveType:'slow-2g'}), 24000);
  assert.equal(d({effectiveType:'2g'}), 24000);
  assert.equal(d({effectiveType:'3g'}), 18000);
  assert.equal(d({effectiveType:'4g'}), 12000);
  assert.equal(d({saveData:true, effectiveType:'4g'}), 24000);
  assert.equal(d({}), 12000);
});

test('E3: a missing Network Information API falls back to the fixed deadline', () => {
  const h = engineHarness({navigator: undefined});
  assert.equal(h.Engine.stallDeadlineMs(), 12000);
});

test('E3: the buffering watchdog arms with the adaptive deadline', () => {
  const h = engineHarness({navigator:{connection:{effectiveType:'2g'}}});
  h.Engine.cur = 0;
  h.Engine._playRequest = 5;
  h.Engine._loadingRequest = 0;
  h.Engine._playIntent = true;
  h.Engine.transportCapabilities = () => ({network:true});
  h.Engine.clearBuffering = () => {};
  h.Engine.els = [{src:'https://r2.test/audio', currentTime:0, paused:false, ended:false}];
  h.Engine.current = {id:'s'};
  h.Engine.onBuffering(0, 'stall-test');
  const buffering = h.traces.find(t => t.event === 'buffering');
  assert.ok(buffering, 'buffering traced');
  assert.equal(buffering.detail.deadlineMs, 24000);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 24000, 'the watchdog timer itself uses the adaptive deadline');
});

// ---------------------------------------------------------------------------
// E4: audio wake-up retries
// ---------------------------------------------------------------------------
test('E4: a transient AudioContext failure is retried with backoff, then resumes', async () => {
  const pauses = [];
  const h = engineHarness();
  h.Engine.pause = (r) => pauses.push(r);
  let resumes = 0;
  h.Engine.ctx = {state:'suspended', resume: async () => { resumes++; if (resumes < 3) throw {name:'NotAllowedError'}; }};
  h.Engine._playRequest = 5;
  h.Engine._playIntent = true;
  const p = h.Engine.resumeContext('play');
  await settle();
  assert.equal(resumes, 1);
  assert.equal(h.timers.length, 1, 'first backoff scheduled');
  assert.equal(h.timers[0].ms, 500);
  h.fireAll();
  await settle();
  assert.equal(resumes, 2);
  assert.equal(h.timers.length, 1, 'second backoff scheduled');
  assert.equal(h.timers[0].ms, 1500);
  h.fireAll();
  await p;
  assert.equal(resumes, 3);
  assert.deepEqual(pauses, [], 'a recovered context never pauses');
  assert.ok(h.traces.some(t => t.event === 'context-resumed' && t.detail.attempt === 3));
  assert.equal(h.traces.filter(t => t.event === 'context-resume-failed').length, 2);
});

test('E4: three failed wake-ups pause with context-failed', async () => {
  const pauses = [];
  const h = engineHarness();
  h.Engine.pause = (r) => pauses.push(r);
  let resumes = 0;
  h.Engine.ctx = {state:'suspended', resume: async () => { resumes++; throw {name:'NotAllowedError'}; }};
  h.Engine._playRequest = 5;
  h.Engine._playIntent = true;
  const p = h.Engine.resumeContext('play');
  await settle();
  h.fireAll(); await settle();
  h.fireAll(); await p;
  assert.equal(resumes, 3, 'bounded at three attempts');
  assert.deepEqual(pauses, ['context-failed']);
  const failed = h.traces.filter(t => t.event === 'context-resume-failed');
  assert.equal(failed.length, 3);
  assert.deepEqual(failed.map(t => t.detail.attempt), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// shuffle-worker: generation behavior against the exact published bytes
// ---------------------------------------------------------------------------
function workerHarness() {
  const posted = [];
  const self = {postMessage: (m) => posted.push(m)};
  const ctx = vm.createContext({self});
  vm.runInContext(workerSource + '\nself;', ctx);
  assert.equal(typeof self.onmessage, 'function', 'worker did not install onmessage');
  return {self, posted};
}

test('shuffle-worker: finish posts a done message with a full permutation of ranks', () => {
  const h = workerHarness();
  const queue = [
    {id:'a', title:'A', artist:'X', album:'L1', lastPlayed:0},
    {id:'b', title:'B', artist:'Y', album:'L1', lastPlayed:0},
    {id:'c', title:'C', artist:'X', album:'L2', lastPlayed:0},
    {id:'d', title:'D', artist:'Z', album:'L3', lastPlayed:0},
  ];
  h.self.onmessage({data:{type:'start', mode:1, saved:null}});
  h.self.onmessage({data:{type:'tracks', value:queue}});
  h.self.onmessage({data:{type:'finish'}});
  const done = h.posted.find(m => m.type === 'done');
  assert.ok(done, 'expected a done message, got: ' + JSON.stringify(h.posted.map(m => m.type)));
  const ranks = h.posted.filter(m => m.type === 'ranks').flatMap(m => m.value);
  assert.equal(ranks.length, queue.length, 'every queued track gets a rank');
  assert.deepEqual([...ranks].sort((a, b) => a - b), [0, 1, 2, 3], 'ranks are a permutation of the queue indices');
  const idsJSON = h.posted.filter(m => m.type === 'json' && m.field === 'idsJSON').map(m => m.value).join('');
  assert.deepEqual(JSON.parse(idsJSON), ['a', 'b', 'c', 'd']);
});

test('shuffle-worker: a corrupt queue fails closed with a failed message', () => {
  const h = workerHarness();
  h.self.onmessage({data:{type:'start', mode:1, saved:null}});
  h.self.onmessage({data:{type:'tracks', value:[null]}});
  h.self.onmessage({data:{type:'finish'}});
  const failed = h.posted.find(m => m.type === 'failed');
  assert.ok(failed, 'expected a failed message, got: ' + JSON.stringify(h.posted.map(m => m.type)));
});

// ---------------------------------------------------------------------------
// D1/D2: regression tests for the two defects Lucy found in rev-4 review.
// Each FAILS against the pre-fix bytes and PASSES against the fixed bytes.
// ---------------------------------------------------------------------------
test('D1: a stale slow preflight cannot overwrite a newer selection', async () => {
  let releaseA;
  const gateA = new Promise(res => { releaseA = () => res(true); });
  const fakeEl = () => ({src:'', readyState:0, paused:true, removeAttribute(){}, load(){}});
  const h = engineHarness({
    R2Source: {fileFor: (t) => t.id === 'B' ? {__remoteURL:'https://r2.test/b'} : null},
    DriveSource: {pumpTags(){}, status:'', scheduleManifestCheck(){}, prioritize(){}},
    UI: {renderPlayState(){}, renderProgress(){}, renderNowPlaying(){}, startLoop(){}, settling:false},
  });
  const E = h.Engine;
  // Module-scope collaborators that live outside the extracted Engine block.
  h.ctx.getFileFor = async (t) => ({__remoteURL:'https://r2.test/' + t.id, dur:180});
  h.ctx.audioSource = (f) => f.__remoteURL;
  h.ctx.clamp = (v,a,b) => v<a?a:(v>b?b:v);
  h.ctx.sourceTrackEnabled = (t) => !!t;
  E.queue = [{id:'A', source:'r2', dur:180}, {id:'B', source:'r2', dur:180}];
  E.order = [0, 1];
  E.cur = 0;
  E.els = [fakeEl(), fakeEl()];
  E.gains = [];
  E.ctx = {state:'running'};
  E._playRequest = 0;
  E.pauseElement = () => {};
  E.saveState = () => {};
  // The preflight itself is unchanged by the fix; hold A's open with a
  // deferred so B's selection lands while A is still in flight.
  E.r2PreflightWithRetry = (t) => t.id === 'A' ? gateA : Promise.resolve(true);
  const pA = E.playIndex(0, false);
  await settle();
  const pB = E.playIndex(1, false);
  await settle(50);
  assert.equal(E.current && E.current.id, 'B',
    'precondition: the newer selection is current while the stale preflight is still in flight');
  releaseA();
  await settle(50);
  await Promise.all([pA.catch(() => {}), pB.catch(() => {})]);
  assert.equal(E.current && E.current.id, 'B',
    'the stale preflight must not overwrite the newer selection');
});

test('D1c1: a failed stale preflight applies no failure effects to the newer selection', async () => {
  let releaseA;
  const gateA = new Promise(res => { releaseA = () => res(false); }); // resolves FALSE: preflight failure
  const fakeEl = () => ({src:'', readyState:0, paused:true, removeAttribute(){}, load(){}});
  const h = engineHarness({
    R2Source: {fileFor: (t) => t.id === 'B' ? {__remoteURL:'https://r2.test/b'} : null},
    DriveSource: {pumpTags(){}, status:'', scheduleManifestCheck(){}, prioritize(){}},
    UI: {renderPlayState(){}, renderProgress(){}, renderNowPlaying(){}, startLoop(){}, settling:false},
  });
  const E = h.Engine;
  // Module-scope collaborators that live outside the extracted Engine block.
  h.ctx.getFileFor = async (t) => ({__remoteURL:'https://r2.test/' + t.id, dur:180});
  h.ctx.audioSource = (f) => f.__remoteURL;
  h.ctx.clamp = (v,a,b) => v<a?a:(v>b?b:v);
  h.ctx.sourceTrackEnabled = (t) => !!t;
  E.queue = [{id:'A', source:'r2', dur:180}, {id:'B', source:'r2', dur:180}];
  E.order = [0, 1];
  E.cur = 0;
  E.els = [fakeEl(), fakeEl()];
  E.gains = [];
  E.ctx = {state:'running'};
  E._playRequest = 0;
  E.pauseElement = () => {};
  E.saveState = () => {};
  // Hold A's preflight open with a deferred that resolves FALSE (failure);
  // B's selection lands and commits while A is still in flight.
  E.r2PreflightWithRetry = (t) => t.id === 'A' ? gateA : Promise.resolve(true);
  const pA = E.playIndex(0, false);
  await settle();
  const pB = E.playIndex(1, false);
  await settle(50);
  assert.equal(E.current && E.current.id, 'B',
    'precondition: the newer selection is current while the stale preflight is still in flight');
  const toastsBefore = h.toasts.length;
  releaseA(); // A's preflight FAILS while B is current
  await settle(50);
  await Promise.all([pA.catch(() => {}), pB.catch(() => {})]);
  assert.equal(E.current && E.current.id, 'B',
    'the failed stale preflight must not clobber the newer selection');
  assert.equal(h.toasts.length, toastsBefore,
    'the stale failure must not surface an unavailable toast for the superseded selection');
});

test('D2: the scheduled auto-resume fallback fires inside its window', () => {
  const h = engineHarness();
  const E = h.Engine;
  let played = 0;
  E.play = () => played++;
  E.current = {id:'s'};
  E.queue = [{id:'s'}];
  E.playing = false;
  E._armAutoResume();
  assert.equal(h.timers.length, 1, 'precondition: the fallback timer is armed');
  const scheduledMs = h.timers[0].ms;
  assert.ok(scheduledMs < 15000,
    'the fallback must be scheduled strictly inside the 15s window, got ' + scheduledMs +
    'ms — at 15000ms _tryAutoResume\'s age>=15000 check always suppresses it');
  h.fireAll();
  assert.equal(played, 1, 'the scheduled fallback resumes inside the window');
  assert.ok(h.traces.some(t => t.event === 'auto-resume-attempt'),
    'expected an auto-resume-attempt trace');
});
