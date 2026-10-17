import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Run the real browser engine and installed transport wrappers without browser,
// network, wall-clock sleeps, or third-party test dependencies.
const source = await readFile(process.env.POWERAMP_PLAYER_SOURCE || new URL('../public/drawercast/player.js', import.meta.url), 'utf8');
function block(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Player source block exists: ${start}`);
  return source.slice(first, last);
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fakeClock() {
  let now = 1_800_000_000_000, id = 0;
  const pending = new Map(), scheduled = [];
  return {
    now: () => now, pending, scheduled,
    setTimeout(fn, delay = 0) {
      const timer = {id: ++id, fn, delay: Math.max(0, Number(delay) || 0), at: now + Math.max(0, Number(delay) || 0)};
      pending.set(timer.id, timer); scheduled.push(timer); return timer.id;
    },
    clearTimeout(timer) { pending.delete(timer); },
    async advance(ms) {
      const end = now + ms; let calls = 0;
      while (true) {
        const next = [...pending.values()].filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        assert.ok(++calls < 500, 'timer scheduling is bounded');
        now = next.at; pending.delete(next.id); next.fn(); await flush();
      }
      now = end; await flush();
    }
  };
}

class FakeAudio {
  constructor() {
    this._src = ''; this.sources = []; this.loads = 0; this.attempts = [];
    this.paused = true; this.ended = false; this.error = null; this.readyState = 0;
    this.networkState = 0; this.currentTime = 0; this.duration = NaN; this.volume = 1;
    this.events = new Map(); this.pauseTasks = new Set(); this.cancelPauseOnLoad = false;
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value); this.sources.push(this._src);
    this.currentTime = 0; this.readyState = 0; this.duration = NaN; this.ended = false; this.error = null;
  }
  get currentSrc() { return this._src; }
  setAttribute() {}
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  addEventListener(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  emit(name) { for (const fn of [...(this.events.get(name) || [])]) fn({type: name, target: this}); }
  pause() {
    const changed = !this.paused; this.paused = true;
    if (changed) {
      let task; task = this.dispatch(() => { this.pauseTasks.delete(task); this.emit('pause'); });
      this.pauseTasks.add(task);
    }
  }
  load() {
    this.loads++; this.error = null; this.currentTime = 0; this.readyState = 0;
    if (this.cancelPauseOnLoad) { for (const task of this.pauseTasks) this.cancelDispatch(task); this.pauseTasks.clear(); }
  }
  play() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.attempts.push({resolve, reject, promise, source: this.src});
    // A play request is not evidence that data or Web Audio output is advancing.
    this.paused = false; return promise;
  }
  metadata(duration = 200) { this.readyState = 1; this.duration = duration; this.emit('loadedmetadata'); }
  playing() { this.paused = false; this.readyState = 4; this.emit('playing'); this.attempts.at(-1)?.resolve(); }
  progress(seconds) { this.currentTime = seconds; this.emit('timeupdate'); }
}

function fakeContextClass() {
  const param = () => ({value: 0, setTargetAtTime(){}, cancelScheduledValues(){}, setValueAtTime(){}, linearRampToValueAtTime(){}});
  const node = () => {
    const n = {connect(){}, disconnect(){}};
    for (const key of ['gain', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'pan']) n[key] = param();
    return n;
  };
  return class FakeContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.events = new Map(); this.resumeCalls = 0; this.resumeFailure = null; }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
    removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
    change(state) {
      this.state = state; const event = {type: 'statechange', target: this};
      for (const fn of [...(this.events.get('statechange') || [])]) fn(event);
      this.onstatechange?.(event);
    }
    resume() { this.resumeCalls++; return this.resumeFailure ? Promise.reject(this.resumeFailure) : Promise.resolve(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createStereoPanner() { return node(); }
    createDynamicsCompressor() { return node(); }
    createAnalyser() { return node(); }
    createConvolver() { return node(); }
    createDelay() { return node(); }
    createChannelSplitter() { return node(); }
    createChannelMerger() { return node(); }
    createMediaElementSource() { return node(); }
  };
}

const cleanR2URL = 'https://music.example.test/music/library/audio/private-native-track-id';
function track(kind = 'native-r2', extra = {}) {
  const defaults = {
    'native-r2': {source: 'r2', nativeR2: true, remote: false},
    'legacy-r2': {source: 'r2', remote: true},
    drive: {source: 'drive', remote: true},
    server: {source: 'server', remote: true},
    local: {source: 'local', remote: false}
  };
  return {id: `private-${kind}-track-id`, title: 'Private song title', dur: 200, ...defaults[kind], ...extra};
}

function harness(kind = 'native-r2', {webAudio = false, installed = true, extra = {}} = {}) {
  const clock = fakeClock(), messages = [], revoked = [], renderStates = [], mediaHandlers = new Map(), nodes = new Map();
  const selected = track(kind, extra), urls = new Map([[selected.id, kind.includes('r2') ? cleanR2URL : kind === 'local' ? 'blob:private-local-file' : `https://audio.example.test/${kind}/private-track?key=private-token-secret`]]);
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {setAttribute(){}, getAttribute(){}, remove(){}, append(){}});
    return nodes.get(selector);
  };
  const AudioContext = fakeContextClass();
  const ctx = vm.createContext({
    Audio: class extends FakeAudio { constructor() { super(); this.dispatch = fn => clock.setTimeout(fn, 0); this.cancelDispatch = clock.clearTimeout; } }, Date: class extends Date { static now() { return clock.now(); } },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, debounce: fn => fn,
    clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
    SET: {volume: 1, speed: 1, fadeOnPause: false, fadeLen: 100, gapless: false, crossfade: false, crossfadeLen: 0, audioMode: 'custom', headsetButtons: true, keepQueue: true},
    SourceLibrary: {kind: t => t?.source || (t?.remote ? 'server' : 'local')},
    AudioQuality: {reset(){}, refreshGain(){}},
    URL: {revokeObjectURL: url => revoked.push(url)},
    document: {visibilityState: 'visible', body: {appendChild(){}}},
    window: {AudioContext: webAudio ? AudioContext : undefined, MediaMetadata: class { constructor(data) { Object.assign(this, data); } }},
    navigator: {onLine: true, mediaSession: {setActionHandler: (name, fn) => mediaHandlers.set(name, fn)}},
    UI: {
      renderPlayState(){renderStates.push({actual: ctx.Engine.playing, wanted: ctx.Engine.wantsPlayback()});},
      renderProgress(){}, renderMeta(){}, renderNowPlaying(){}, startLoop(){}, stopLoop(){}, renderToggles(){}, renderReconnect(){}
    },
    toast: message => messages.push(message),
    DriveSource: {api: {}, status: '', playbackRetry: new Map(), prioritize(){}, pumpTags(){}, scheduleManifestCheck(){}, retryFileFor: t => ({__remoteURL: urls.get(t.id) + '&retry=1'})},
    R2Source: {status: '', fileFor: t => ({__remoteURL: urls.get(t.id)}), connect: async () => true},
    DrawerCast: {canPlay: () => true, fileFor: t => ({__remoteURL: urls.get(t.id)}), markError(){}},
    sourceTrackEnabled: t => !!t && !t.disabled,
    getFileFor: async t => ({__remoteURL: urls.get(t.id)}), audioSource: file => file.__remoteURL,
    LIB: {map: new Map([[selected.id, selected]])}, IDB: {set: async () => {}, get: async () => null},
    localStorage: {getItem: () => null, setItem(){}}, persistTrack(){}, rootsNeedingPermission: () => [],
    getArtURL: async () => null, trackArtist: t => t?.artist || '', trackAlbum: t => t?.album || '',
    nativeValues: () => ({queue_no_shuffle: false, queue_start: 2, queue_end: 1, played_dur: 100}),
    Views: {buildItems(){}, counts: () => ({}), buildFabs(){}, refreshAll(){}, refreshQueueOrder(){}},
    ctxMenuList(){}, $: node, $$: () => [], icoHTML: () => '', saveSet(){},
    FREQ_SETS: {16: Array.from({length: 16}, (_, i) => 20 * (i + 1))}, shuffleArray: a => a.slice()
  });
  const diagnostics = source.includes('const PlaybackDiagnostics={') ? block('const PlaybackDiagnostics={', 'const Engine = {') : '';
  const Engine = vm.runInContext(diagnostics + block('const Engine = {', 'function SET_shuffleOn()') + '\nEngine', ctx);
  const diagnosticReport = () => vm.runInContext('typeof PlaybackDiagnostics === \"undefined\" ? null : PlaybackDiagnostics.report()', ctx);
  ctx.Engine = Engine;
  Engine._playRequest = 1;
  if (installed) vm.runInContext(
    block('const PlaybackQueue={', 'const PlaybackTransitions={') +
    block('const PlaybackTransitions={', 'function installPlaybackRework()') +
    block('function restoreTrackStepOrigin(', '/* Shared finger tracking:') +
    block('function installPlaybackRework(){', '/* Synced lyrics') + '\ninstallPlaybackRework();', ctx);
  // Production installs wrappers before init binds native ended/time handlers.
  Engine.init();
  Engine.queue = [selected]; Engine.order = [0]; Engine.pos = 0; Engine.current = selected; Engine.dur = selected.dur;
  Engine.el().src = urls.get(selected.id); Engine.el().metadata();
  // Effects are outside this transport regression; the actual context creation
  // and statechange handler are retained when webAudio is requested.
  Engine.applyEQ = Engine.applyVolume = Engine.applyReverb = () => {};
  Engine.setGain = () => {}; Engine.rgGain = () => 1; Engine.applySpeed = () => {}; Engine.saveState = () => {};
  const PlaybackTransitions = installed ? vm.runInContext('PlaybackTransitions', ctx) : null;
  return {Engine, PlaybackTransitions, ctx, clock, messages, revoked, renderStates, mediaHandlers, urls, selected, diagnosticReport,
    audio: () => Engine.el(),
    async start(at = 42) { Engine.play(); Engine.el().playing(); Engine.el().progress(at); await flush(); },
    add(t, url) { urls.set(t.id, url); ctx.LIB.map.set(t.id, t); Engine.queue.push(t); Engine.order.push(Engine.queue.length - 1); }
  };
}

function recoveryLoads(audio, before) { return audio.loads > before.loads || audio.sources.length > before.sources; }
function loadSnapshot(audio) { return {loads: audio.loads, sources: audio.sources.length, attempts: audio.attempts.length}; }
function assertNoNewAudio(audio, before) {
  assert.equal(audio.attempts.length, before.attempts, 'cancelled recovery must not start audio');
  assert.equal(recoveryLoads(audio, before), false, 'cancelled recovery must not reload audio');
}

for (const kind of ['native-r2', 'legacy-r2', 'drive', 'server', 'local']) {
  test(`explicit transport capabilities classify ${kind} independently of legacy remote`, () => {
    const h = harness(kind), {Engine} = h;
    assert.equal(typeof Engine.transportCapabilities, 'function', 'transport capabilities are explicit');
    const capabilities = Engine.transportCapabilities(h.selected);
    assert.equal(capabilities.kind, kind.includes('r2') ? 'r2' : kind);
    assert.equal(capabilities.network, kind !== 'local');
    assert.equal(capabilities.reload, kind !== 'local');
  });
}

for (const kind of ['native-r2', 'legacy-r2']) {
  test(`${kind} transient network recovery reloads the exact clean URL and preserves actual position`, async () => {
    const h = harness(kind); await h.start(42);
    const a = h.audio(), before = loadSnapshot(a);
    a.error = {code: 2}; a.emit('error');
    await h.clock.advance(2500);
    assert.ok(recoveryLoads(a, before), 'network error reloads rather than terminally pausing R2');
    assert.ok(a.sources.slice(before.sources).every(url => !url || url === cleanR2URL), 'R2 never adds retry queries or changes the validated URL');
    assert.equal(a.src, cleanR2URL);
    a.metadata(200);
    assert.equal(a.currentTime, 42, 'retry restores the interrupted playhead after metadata');
    a.playing(); await flush();
    assert.equal(h.Engine.playing, true);
    assert.equal(h.Engine.wantsPlayback(), true);
  });

  test(`${kind} recovery preserves a requested seek while media metadata is still pending`, async () => {
    const h = harness(kind); await h.start(12);
    const a = h.audio(), before = loadSnapshot(a); a.readyState = 0; a.duration = NaN;
    h.Engine.seek(87); assert.equal(h.Engine.time(), 87);
    a.error = {code: 2}; a.emit('error'); await h.clock.advance(2500);
    assert.ok(recoveryLoads(a, before), 'the pending-seek assertion exercises a real reload');
    assert.equal(h.Engine.time(), 87, 'pending requested position survives the reload');
    a.metadata(200); assert.equal(a.currentTime, 87);
  });

  test(`${kind} silent initial Play has a bounded no-progress watchdog`, async () => {
    const h = harness(kind), a = h.audio(), before = loadSnapshot(a);
    h.Engine.play();
    assert.ok(h.clock.pending.size > 0, 'the initial unresolved play promise is watched');
    assert.equal(h.Engine.playing, false, 'requesting play is not confirmed output');
    assert.equal(h.Engine.wantsPlayback(), true, 'user intent remains visible while awaiting output');
    await h.clock.advance(20000);
    assert.ok(recoveryLoads(a, before), 'an initial silent stream recovers without a waiting event');
    assert.equal(a.src, cleanR2URL);
  });

  test(`${kind} repeated waiting and metadata cannot renew an exhausted retry budget`, async () => {
    const h = harness(kind); await h.start(42); const a = h.audio(), before = loadSnapshot(a);
    for (let i = 0; i < 8; i++) {
      a.emit('waiting'); a.metadata(200);
      await h.clock.advance(15000); a.error = {code: 2}; a.emit('error');
    }
    await h.clock.advance(60000);
    const retries = a.sources.slice(before.sources).filter(Boolean).length;
    assert.equal(retries, 1, 'only one R2 retry is allowed per deliberate selection/Play intent');
    assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
    const exhausted = loadSnapshot(a); a.emit('waiting'); a.emit('error');
    await h.clock.advance(60000); assertNoNewAudio(a, exhausted);
  });
}

test('explicit Play on an errored native R2 slot reloads it and retains the interrupted position', async () => {
  const h = harness(); const a = h.audio(); a.currentTime = 63; a.error = {code: 2};
  const before = loadSnapshot(a); h.Engine.play(); await flush();
  assert.ok(recoveryLoads(a, before), 'native R2 is reloadable even though remote is false');
  assert.equal(a.src, cleanR2URL); a.metadata(200); assert.equal(a.currentTime, 63);
});

test('a current play policy rejection clears actual and desired state without automatic retry', async () => {
  const h = harness(); h.Engine.play(); const a = h.audio(), before = loadSnapshot(a);
  a.attempts.at(-1).reject({name: 'NotAllowedError', message: 'private-token-secret ' + cleanR2URL}); await flush();
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  await h.clock.advance(60000); assertNoNewAudio(a, before);
});

test('a current codec rejection does not enter transient R2 network recovery', async () => {
  const h = harness(); h.Engine.play(); const a = h.audio(), before = loadSnapshot(a);
  a.error = {code: 4}; a.attempts.at(-1).reject({name: 'NotSupportedError'}); await flush();
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  await h.clock.advance(60000); assertNoNewAudio(a, before);
});

test('a current AbortError cannot claim actual playing output', async () => {
  const h = harness(); h.Engine.play(); h.audio().attempts.at(-1).reject({name: 'AbortError'}); await flush();
  assert.equal(h.Engine.playing, false);
});

test('a stale rejected play on the old selection cannot alter the new track', async () => {
  const h = harness(); h.Engine.play(); const old = h.audio().attempts.at(-1);
  const next = track('native-r2', {id: 'private-next-track'}); h.add(next, cleanR2URL + '-next');
  await h.Engine.playIndex(1, true); h.audio().metadata(); h.audio().playing(); await flush();
  const before = h.renderStates.length; old.reject({name: 'NotSupportedError'}); await flush();
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, true);
  assert.equal(h.Engine.wantsPlayback(), true); assert.equal(h.renderStates.length, before);
});

test('stale AbortError from a same-URL reload cannot cancel the newer play attempt', async () => {
  const h = harness(); await h.start(42);
  h.Engine.play(); const a = h.audio(), old = a.attempts.at(-1);
  a.error = {code: 2}; a.emit('error'); await h.clock.advance(2500);
  assert.ok(a.attempts.length >= 3, 'network recovery creates a distinct play attempt');
  a.metadata(); a.playing(); await flush();
  const before = h.renderStates.length; old.reject({name: 'AbortError'}); await flush();
  assert.equal(a.src, cleanR2URL); assert.equal(h.Engine.playing, true);
  assert.equal(h.Engine.wantsPlayback(), true); assert.equal(h.renderStates.length, before);
});

for (const action of ['pause', 'stop']) {
  test(`intentional ${action} cancels pending native R2 network recovery`, async () => {
    const h = harness(); await h.start(); const a = h.audio();
    a.error = {code: 2}; a.emit('error');
    assert.ok([...h.clock.pending.values()].some(t => t.delay > 0), 'a recovery start is genuinely pending');
    h.Engine[action](); const before = loadSnapshot(a);
    await h.clock.advance(60000); assertNoNewAudio(a, before);
    assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  });
}

test('skip cancels old recovery before the final selected source resolves', async () => {
  const h = harness(); await h.start(); const a = h.audio();
  a.error = {code: 2}; a.emit('error');
  assert.ok([...h.clock.pending.values()].some(t => t.delay > 0), 'the old retry is scheduled before selection changes');
  const next = track('native-r2', {id: 'private-next-track'}); h.add(next, cleanR2URL + '-next');
  let resolve; h.ctx.getFileFor = () => new Promise(yes => { resolve = yes; });
  const selecting = h.Engine.playIndex(1, true), before = loadSnapshot(a);
  await h.clock.advance(60000); assertNoNewAudio(a, before);
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), true);
  h.Engine.pause(); resolve({__remoteURL: cleanR2URL + '-next'}); await selecting; await flush();
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false); assert.equal(a.src, '');
});

test('MediaSession focus Pause cancels pending native R2 recovery and waits for explicit Play', async () => {
  const h = harness(); await h.start(); await h.Engine.updateMediaSession();
  const a = h.audio(); a.error = {code: 2}; a.emit('error');
  assert.ok([...h.clock.pending.values()].some(t => t.delay > 0), 'the retry is pending when focus Pause arrives');
  assert.equal(typeof h.mediaHandlers.get('pause'), 'function'); h.mediaHandlers.get('pause')();
  const before = loadSnapshot(a); await h.clock.advance(60000); assertNoNewAudio(a, before);
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
});

test('an unexpected native Pause reflects output loss without fighting an OS focus interruption', async () => {
  const h = harness(); await h.start(); const a = h.audio(); a.pause(); await h.clock.advance(0);
  assert.equal(h.Engine.playing, false, 'actual output stops when the media element pauses');
  const before = loadSnapshot(a); await h.clock.advance(60000); assertNoNewAudio(a, before);
});

for (const state of ['interrupted', 'suspended', 'closed']) {
  test(`AudioContext ${state} updates actual output and does not automatically resume over calls or OS focus`, async () => {
    const h = harness('native-r2', {webAudio: true}); await h.start(); const context = h.Engine.ctx;
    assert.ok(context, 'test exercises the real Web Audio context setup');
    context.change(state); await flush();
    assert.equal(h.Engine.playing, false, 'context state cannot leave output shown as playing');
    const resumes = context.resumeCalls, before = loadSnapshot(h.audio());
    await h.clock.advance(60000); assert.equal(context.resumeCalls, resumes); assertNoNewAudio(h.audio(), before);
  });
}

test('a rejected explicit AudioContext resume cannot leave false actual playback or trigger an autonomous resume loop', async () => {
  const h = harness('native-r2', {webAudio: true}); await h.start(); const context = h.Engine.ctx;
  context.change('suspended'); context.resumeFailure = {name: 'NotAllowedError'};
  h.Engine.play(); await flush();
  assert.equal(h.Engine.playing, false);
  const resumes = context.resumeCalls, before = loadSnapshot(h.audio());
  await h.clock.advance(60000); assert.equal(context.resumeCalls, resumes); assertNoNewAudio(h.audio(), before);
});

test('playback diagnostics are bounded snapshots that exclude URLs, track identities, titles and secrets', async () => {
  const h = harness('native-r2', {webAudio: true});
  assert.ok(h.diagnosticReport(), 'transport diagnostic snapshot is available');
  for (let i = 0; i < 100; i++) {
    h.Engine.play(); h.audio().attempts.at(-1)?.reject({name: 'NotAllowedError', message: `private-token-secret ${cleanR2URL}`});
    await flush(); h.Engine.pause();
  }
  const report = h.diagnosticReport(), serialized = JSON.stringify(report);
  assert.ok(report.events.length > 0 && report.events.length <= 80, 'only the newest 80 diagnostic rows are retained');
  assert.ok(serialized.length > 10 && serialized.length < 32000, 'diagnostic history has a finite small bound');
  for (const value of [cleanR2URL, h.selected.id, h.selected.title, 'private-token-secret', 'https://', 'blob:']) {
    assert.equal(serialized.includes(value), false, `diagnostics omit private value ${value}`);
  }
  const snapshot = JSON.stringify(report); h.Engine.play(); await flush();
  assert.equal(JSON.stringify(report), snapshot, 'a captured report cannot mutate as the engine continues');
});


for (const kind of ['native-r2', 'legacy-r2', 'drive', 'server', 'local']) {
  test(`${kind} pending Play separates desired intent from confirmed output`, async () => {
    const h = harness(kind); h.Engine.play();
    assert.equal(h.Engine.wantsPlayback(), true);
    assert.equal(h.Engine.playing, false, 'a pending play promise is not confirmed output');
    h.audio().readyState=4; // Native successful playback has future data.
    h.audio().attempts.at(-1).resolve(); await flush();
    assert.equal(h.Engine.playing, true, 'the current successful play promise confirms output');
    assert.equal(h.Engine.wantsPlayback(), true);
    h.Engine.pause(); assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
  });

  test(`${kind} buffering watchdog eligibility follows transport capability`, async () => {
    const h = harness(kind); await h.start(); h.audio().emit('waiting');
    assert.equal([...h.clock.pending.values()].some(t => t.delay > 0), kind !== 'local');
  });
}

for (const kind of ['native-r2', 'legacy-r2']) {
  test(`${kind} a genuine no-progress stall recovers the exact URL at the saved playhead`, async () => {
    const h = harness(kind); await h.start(48); const a = h.audio(), before = loadSnapshot(a);
    a.emit('stalled'); await h.clock.advance(16000);
    assert.ok(recoveryLoads(a, before), 'no-progress timeout enters transient recovery');
    assert.equal(a.src, cleanR2URL); a.metadata(); assert.equal(a.currentTime, 48);
  });

  test(`${kind} repeated waiting cannot indefinitely postpone the original stall deadline`, async () => {
    const h = harness(kind); await h.start(48); const a = h.audio(), before = loadSnapshot(a);
    for (let i = 0; i < 4; i++) { a.emit('waiting'); await h.clock.advance(4000); }
    assert.ok(recoveryLoads(a, before), 'a stream with no progress recovers despite repeated waiting events');
  });

  test(`${kind} advancing playback cancels the stall timeout without reloading`, async () => {
    const h = harness(kind); await h.start(48); const a = h.audio(), before = loadSnapshot(a);
    a.emit('waiting'); await h.clock.advance(4000); a.progress(49);
    await h.clock.advance(20000); assertNoNewAudio(a, before);
    assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
  });
}

test('a queued owned recovery pause cannot hide a later genuine external focus pause', async () => {
  const h = harness(); await h.start(42); const a = h.audio();
  a.error = {code: 2}; a.emit('error'); await h.clock.advance(2500);
  a.metadata(); a.playing(); await flush(); assert.equal(h.Engine.playing, true);
  a.pause(); await h.clock.advance(0);
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  const before = loadSnapshot(a); await h.clock.advance(60000); assertNoNewAudio(a, before);
});

test('spare element pauses and errors cannot change the active track or consume its recovery budget', async () => {
  const h = harness(); await h.start(42); const active = h.audio(), before = loadSnapshot(active), spare = h.Engine.other();
  spare.src = cleanR2URL + '-spare'; spare.paused = false; spare.pause(); spare.error = {code: 2}; spare.emit('error');
  await h.clock.advance(20000); assertNoNewAudio(active, before);
  assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
  active.error = {code: 2}; active.emit('error'); await h.clock.advance(2500);
  assert.ok(recoveryLoads(active, before), 'spare failure does not exhaust active retry');
});

test('explicit Play after an exhausted R2 recovery starts a fresh bounded attempt at the retained position', async () => {
  const h = harness(); await h.start(58); const a = h.audio();
  a.error = {code: 2}; a.emit('error'); await h.clock.advance(2500); a.metadata();
  a.error = {code: 2}; a.emit('error'); await h.clock.advance(60000);
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  const before = loadSnapshot(a); h.Engine.play(); await flush();
  assert.ok(recoveryLoads(a, before), 'a deliberate Play renews eligibility after terminal failure');
  assert.equal(a.src, cleanR2URL); a.metadata(); assert.equal(a.currentTime, 58);
  assert.equal(h.Engine.wantsPlayback(), true);
});

test('current AbortError visibly yields focus and cancels automatic initial-stall recovery', async () => {
  const h = harness(); h.Engine.play(); const a = h.audio(), before = loadSnapshot(a);
  a.attempts.at(-1).reject({name: 'AbortError'}); await flush();
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  await h.clock.advance(60000); assertNoNewAudio(a, before);
});

test('diagnostic details are allowlisted instead of retaining arbitrary error or reason text', () => {
  const h = harness();
  assert.equal(typeof h.Engine.tracePlayback, 'function');
  h.Engine.tracePlayback('play-rejected', {reason: h.selected.title, error: 'private-token-secret ' + cleanR2URL});
  const report = h.diagnosticReport(); assert.ok(report.events.length > 0);
  const latest = report.events.at(-1);
  assert.equal(latest.reason, null); assert.equal(latest.error, 'OtherError');
  assert.equal(JSON.stringify(report).includes('private-token-secret'), false);
});

for (const state of ['interrupted', 'suspended']) {
  test(`AudioContext ${state} during R2 recovery cancels retry and routine context checks cannot restart audio`, async () => {
    const h = harness('native-r2', {webAudio: true}); await h.start(42); const a = h.audio();
    a.error = {code: 2}; a.emit('error');
    assert.ok([...h.clock.pending.values()].some(t => t.delay > 0), 'retry is pending before interruption');
    h.Engine.ctx.change(state); await flush(); const before = loadSnapshot(a), resumes = h.Engine.ctx.resumeCalls;
    // This is the routine ensureCtx route also used by non-play UI interactions.
    h.Engine.ensureCtx(); await flush(); await h.clock.advance(60000);
    assert.equal(h.Engine.ctx.resumeCalls, resumes, 'ordinary interactions cannot resume an interrupted context');
    assertNoNewAudio(a, before); assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  });
}

test('stale policy failure from a same-URL reload cannot pause a new successfully playing attempt', async () => {
  const h = harness(); await h.start(42); h.Engine.play(); const a = h.audio(), old = a.attempts.at(-1);
  a.error = {code: 2}; a.emit('error'); await h.clock.advance(2500); a.metadata(); a.playing(); await flush();
  const before = h.renderStates.length; old.reject({name: 'NotAllowedError'}); await flush();
  assert.equal(a.src, cleanR2URL); assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
  assert.equal(h.renderStates.length, before, 'obsolete policy errors cannot alter active UI state');
});


for (const action of ['pause', 'stop']) {
  test(`late play success after intentional ${action} cannot reassert playback intent or actual output`, async () => {
    const h = harness(); h.Engine.play(); const a = h.audio(), pending = a.attempts.at(-1);
    h.Engine[action](); pending.resolve(); await flush();
    assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
    a.playing(); await h.clock.advance(0);
    assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false); assert.equal(a.paused, true);
  });
}

test('a late native R2 network error after intentional Pause never starts recovery', async () => {
  const h = harness(); await h.start(); h.Engine.pause(); await h.clock.advance(0); const a = h.audio(), before = loadSnapshot(a);
  a.error = {code: 2}; a.emit('error'); await h.clock.advance(60000); assertNoNewAudio(a, before);
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
});


for (const advancing of [false, true]) {
  test(`hung AudioContext resume with ${advancing ? 'advancing' : 'zero-advancement'} media never retries the R2 URL or claims actual output`, async () => {
    const h = harness('native-r2', {webAudio: true}), a = h.audio();
    const context = h.Engine.ensureCtx(); context.change('suspended');
    context.resume = () => { context.resumeCalls++; return new Promise(() => {}); };
    const before = loadSnapshot(a), retryBudget = h.Engine._r2RetryId;
    h.Engine.play(); a.playing(); await flush();
    assert.equal(h.Engine.playing, false, 'successful element play is not output while the context is suspended');
    assert.equal(h.Engine.wantsPlayback(), true, 'the explicit Play awaits its context');
    const resumes = context.resumeCalls;
    if (advancing) { await h.clock.advance(4000); a.progress(4); }
    h.Engine.ensureCtx(); await h.clock.advance(20000);
    assert.equal(context.resumeCalls, resumes, 'a hung resume is not repeatedly invoked');
    assert.equal(a.loads, before.loads); assert.equal(a.sources.length, before.sources);
    assert.equal(a.src, cleanR2URL); assert.equal(h.Engine._r2RetryId, retryBudget, 'context trouble never consumes a media retry');
    assert.equal(h.Engine.playing, false);
    if (!advancing) {
      assert.equal(h.Engine.wantsPlayback(), false, 'the no-progress deadline exposes the context interruption');
      assert.ok(h.diagnosticReport().events.some(event => event.event === 'pause-request' && event.reason === 'context-interrupted'));
    }
  });
}

test('load cancelling the queued owned pause cannot mask a genuine external pause after R2 retry starts', async () => {
  const h = harness(); await h.start(42); const a = h.audio();
  // A throttled native pause task remains queued when the delayed reload runs.
  a.dispatch = fn => h.clock.setTimeout(fn, 1000);
  a.cancelPauseOnLoad = true; a.error = {code: 2}; a.emit('error');
  await h.clock.advance(800);
  assert.equal(a.pauseTasks.size, 0, 'load discarded the owned pause event instead of delivering it');
  await h.clock.advance(1700); a.metadata(); a.playing(); await flush();
  assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
  a.pause(); await h.clock.advance(1000);
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  const before = loadSnapshot(a); await h.clock.advance(60000); assertNoNewAudio(a, before);
});


test('installed transition awaits pending AudioContext resume after incoming media starts before reporting actual output', async () => {
  const h = harness('local', {webAudio: true}), next = track('local', {id: 'private-incoming-local'});
  h.add(next, 'blob:private-incoming-local');
  await h.start();const context = h.Engine.ctx;context.state='suspended';
  let finishResume; context.resume = () => { context.resumeCalls++; return new Promise(resolve => { finishResume = resolve; }); };
  const transition = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
  assert.equal(incoming.attempts.length, 1, 'the raw installed transition starts the spare element');
  incoming.metadata(); incoming.playing(); await transition; await flush();
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.cur, 1);
  assert.equal(h.Engine.wantsPlayback(), true); assert.equal(h.Engine.playing, false, 'media success cannot bypass a suspended output graph');
  assert.equal(context.resumeCalls, 1);
  context.change('running'); finishResume(); await flush();
  assert.equal(h.Engine.playing, true, 'current media is confirmed only after the output context resumes');
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.wantsPlayback(), true);
  await h.clock.advance(1000); assert.equal(h.Engine.cur, 1); assert.equal(h.Engine.playing, true);
});

for (const interruption of ['native-focus-pause', 'context-interrupted', 'intentional-pause', 'intentional-stop']) {
  test(`installed transition pending media is safely cancelled by ${interruption} and late completion cannot change selection`, async () => {
    const h = harness('local', {webAudio: true}); await h.start(42);
    const outgoing = h.selected, next = track('local', {id: 'private-incoming-local'}); h.add(next, 'blob:private-incoming-local');
    const transition = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
    const pending = incoming.attempts.at(-1); assert.ok(pending, 'incoming play remains pending when interruption occurs');
    if (interruption === 'native-focus-pause') { h.audio().pause(); await h.clock.advance(0); }
    else if (interruption === 'context-interrupted') { h.Engine.ctx.change('interrupted'); await flush(); }
    else h.Engine[interruption === 'intentional-stop' ? 'stop' : 'pause']();
    assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
    const selectedAfterCancel = h.Engine.current, slot = h.Engine.cur;
    if (interruption !== 'intentional-stop') assert.equal(selectedAfterCancel.id, outgoing.id);
    // Model a browser completing its old media promise after cancellation.
    pending.resolve(); await transition; await flush(); await h.clock.advance(1000);
    assert.equal(h.Engine.current, selectedAfterCancel); assert.equal(h.Engine.cur, slot);
    assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
    assert.equal(incoming.paused, true, 'a late incoming start is silenced');
  });
}

test('installed transition cannot select or start incoming media with an already closed AudioContext', async () => {
  const h = harness('local', {webAudio: true}); await h.start(42);
  const next = track('local', {id: 'private-incoming-local'}); h.add(next, 'blob:private-incoming-local');
  h.Engine.ctx.change('closed'); await flush(); const outgoing = h.Engine.current;
  const transition = h.PlaybackTransitions.to(1, 400); await flush();
  assert.equal(h.Engine.other().attempts.length, 0, 'a closed context blocks the incoming start');
  await transition; await flush();
  assert.equal(h.Engine.current, outgoing); assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
});


test('raw installed transition cancellation silences a late successful incoming promise while preserving the outgoing track', async () => {
  const h = harness('local', {webAudio: true}); await h.start(42);
  const next = track('local', {id: 'private-incoming-local'}); h.add(next, 'blob:private-incoming-local');
  const transition = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
  const pending = incoming.attempts.at(-1), outgoing = h.Engine.current;
  h.PlaybackTransitions.cancel(false); pending.resolve(); await transition; await flush(); await h.clock.advance(1000);
  assert.equal(h.Engine.current, outgoing); assert.equal(h.Engine.cur, 0); assert.equal(h.Engine.playing, true);
  assert.equal(incoming.paused, true, 'cancelled spare media with a retained URL cannot remain active');
});
