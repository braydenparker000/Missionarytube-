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
  Engine.init();
  Engine.queue = [selected]; Engine.order = [0]; Engine.pos = 0; Engine.current = selected; Engine.dur = selected.dur;
  Engine.el().src = urls.get(selected.id); Engine.el().metadata();
  // Effects are outside this transport regression; the actual context creation
  // and statechange handler are retained when webAudio is requested.
  Engine.applyEQ = Engine.applyVolume = Engine.applyReverb = () => {};
  const installedSetGain = Engine.setGain;
  Engine.setGain = () => {}; Engine.rgGain = () => 1; Engine.applySpeed = () => {}; Engine.saveState = () => {};
  const PlaybackTransitions = installed ? vm.runInContext('PlaybackTransitions', ctx) : null;
  return {Engine, PlaybackTransitions, ctx, clock, messages, revoked, renderStates, mediaHandlers, urls, selected, diagnosticReport, installedSetGain,
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



// Keep this harness self-contained so the regression suite runs from a clean
// checkout. The wrappers above are installed BEFORE Engine.init(), matching
// production boot and the native listeners' binding order.
const addTrack = (h, kind = 'native-r2', suffix = 'next') => {
  const t = track(kind, {id: `private-${kind}-${suffix}-id`});
  const url = kind === 'local' ? `blob:private-${suffix}` : kind.includes('r2')
    ? `https://music.example.test/music/library/audio/${suffix}`
    : `https://audio.example.test/${kind}/${suffix}?key=private-token-secret`;
  h.add(t, url); return t;
};
const naturalEnd = a => {
  a.currentTime = a.duration; a.ended = true; a.paused = true; a.emit('ended');
};
const retryState = kind => {
  const prefix = kind.includes('r2') ? '_r2' : kind === 'drive' ? '_drive' : '_server';
  return {id: `${prefix}RetryId`, error: `${prefix}ErrorReportedId`, delay: kind === 'server' ? 1500 : 800};
};
const commitTransition = async (h, index, ms = 400) => {
  const task = h.PlaybackTransitions.to(index, ms); await flush();
  const incoming = h.Engine.other();
  assert.ok(incoming.attempts.at(-1), 'transition starts an incoming media request');
  incoming.metadata(200); incoming.playing(); await task; await flush();
  await h.clock.advance(ms + 100); return incoming;
};
const finishRetry = async (h, kind) => {
  await h.clock.advance(retryState(kind).delay);
  h.audio().metadata(200); h.audio().playing(); await flush();
  assert.equal(h.Engine.playing, true, 'the original one-time retry succeeded');
};
const assertFreshRetry = async (h, kind) => {
  const a = h.audio(), before = loadSnapshot(a), source = a.src, state = retryState(kind);
  a.error = {code: 2}; a.emit('error'); await flush();
  assert.equal(h.Engine.wantsPlayback(), true, 'a new selection retains intent for its first retry');
  assert.equal(h.Engine.playing, false, 'retry is not reported as audible output');
  assert.equal(h.Engine[state.id], h.Engine.current.id);
  assert.notEqual(h.Engine[state.error], h.Engine.current.id, 'historical terminal error does not suppress the new retry');
  await h.clock.advance(state.delay);
  assert.ok(recoveryLoads(a, before), 'new selection gets an actual transport reload');
  if (kind.includes('r2')) assert.equal(a.src, source, 'R2 retries preserve the validated URL exactly');
  if (kind === 'drive') assert.match(a.src, /&retry=1$/, 'Drive keeps its own URL refresh path');
  if (kind === 'server') assert.match(a.src, /&retry=\d+$/, 'server keeps its own cache-refresh path');
  assert.ok(a.attempts.length > before.attempts);
  a.metadata(200); a.playing(); await flush();
  assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
};

for (const kind of ['native-r2', 'legacy-r2', 'drive', 'server']) {
  test(`${kind} successful retry then crossfade A to B to A grants a fresh retry`, async () => {
    const h = harness(kind); addTrack(h, kind); await h.start(170);
    h.audio().error = {code: 2}; h.audio().emit('error'); await finishRetry(h, kind);
    assert.equal(h.Engine[retryState(kind).id], h.selected.id);
    await commitTransition(h, 1); await commitTransition(h, 0);
    assert.equal(h.Engine.current.id, h.selected.id);
    await assertFreshRetry(h, kind);
  });

  test(`${kind} accepted crossfade retires historical terminal and retry state before revisiting A`, async () => {
    const h = harness(kind), next = addTrack(h, kind); await h.start(170);
    const state = retryState(kind);
    // Model the bounded transport state retained from an earlier selection.
    // This does not require a terminal error to authorize a pending transition.
    h.Engine[state.id] = h.selected.id; h.Engine[state.error] = h.selected.id;
    if (kind === 'drive') h.ctx.DriveSource.playbackRetry.set(h.selected.id, {attempts: 1});
    await commitTransition(h, 1); assert.equal(h.Engine.current.id, next.id);
    assert.notEqual(h.Engine[state.error], h.selected.id, 'accepted B retires A terminal state');
    await commitTransition(h, 0); await assertFreshRetry(h, kind);
    if (kind === 'drive') assert.equal(h.ctx.DriveSource.playbackRetry.has(h.selected.id), false);
  });
}

test('installed automatic crossfade repeat-all A to B to A grants a new R2 retry budget', async () => {
  const h = harness(); addTrack(h);
  Object.assign(h.ctx.SET, {crossfade: true, crossfadeLen: 4, repeatMode: 'all'});
  h.ctx.nativeValues = () => ({crossfade_auto_advance: 2, played_dur: 100});
  await h.start(170); h.audio().error = {code: 2}; h.audio().emit('error'); await finishRetry(h, 'native-r2');
  for (const pos of [1, 0]) {
    h.audio().progress(197); await flush(); assert.equal(h.PlaybackTransitions.pending, true);
    h.Engine.other().metadata(200); h.Engine.other().playing(); await flush(); await h.clock.advance(4300);
    assert.equal(h.Engine.pos, pos);
  }
  assert.equal(h.Engine.current.id, h.selected.id); await assertFreshRetry(h, 'native-r2');
});

test('delayed already-ended incoming crossfade advances once to the next playable song', async () => {
  const h = harness(), incomingTrack = addTrack(h), after = addTrack(h, 'native-r2', 'after'); await h.start(198);
  const task = h.PlaybackTransitions.to(1, 400); await flush();
  const incoming = h.Engine.other(), pending = incoming.attempts.at(-1);
  incoming.metadata(1); naturalEnd(incoming); pending.resolve(); await task; await flush();
  assert.notEqual(h.Engine.current?.id, incomingTrack.id, 'ended incoming audio is never committed as the active song');
  assert.equal(h.Engine.current?.id, after.id, 'one bounded advance reaches C');
  assert.equal(h.PlaybackTransitions.pending, false);
  assert.equal(h.Engine.playing, false, 'C is still waiting for actual playback confirmation');
  assert.equal(h.Engine.wantsPlayback(), true);
  const active = h.audio(); assert.equal(active.ended, false);
  active.metadata(200); active.playing(); active.progress(1); await flush();
  const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0);
  incoming.emit('ended'); await h.clock.advance(60000);
  assert.equal(h.Engine.current?.id, after.id); assert.equal(h.Engine.playing, true);
  assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts, 'duplicate incoming end cannot start another song');
});

for (const repeatMode of ['off', 'one', 'all']) {
  test(`already-ended final incoming crossfade is bounded with repeat ${repeatMode}`, async () => {
    const h = harness(); addTrack(h); h.ctx.SET.repeatMode = repeatMode; await h.start(198);
    const task = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
    const pending = incoming.attempts.at(-1); incoming.metadata(1); naturalEnd(incoming);
    pending.resolve(); await task; await flush();
    assert.equal(h.PlaybackTransitions.pending, false, 'recovery leaves no unresolved transition');
    assert.equal(h.Engine.xfading, false, 'an ended slot is not a live overlap');
    if (repeatMode === 'one') {
      assert.equal(h.audio(), incoming);
      assert.equal(incoming.attempts.length, 2, 'repeat-one starts exactly one legitimate replay of B');
      // HTMLMediaElement.play() restarts an ended element. FakeAudio leaves
      // flags unchanged until the test supplies the browser playback event.
      incoming.ended = false; incoming.currentTime = 0;
    } else assert.ok(!h.Engine.wantsPlayback() || !h.audio().ended, 'cannot wedge wanted=true on already-ended current media');
    if (repeatMode === 'off') {
      assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
    } else if (h.Engine.wantsPlayback()) {
      h.audio().metadata(200); h.audio().playing(); h.audio().progress(1); await flush();
    }
    const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0);
    await h.clock.advance(60000);
    assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts, 'no timer-driven repeat loop or retry of the ended slot');
  });
}

for (const interruption of ['pause', 'stop', 'skip', 'native-focus-pause', 'context-interrupted']) {
  test(`late already-ended crossfade completion honors ${interruption} cancellation`, async () => {
    const h = harness('local', {webAudio: true}), next = addTrack(h, 'local'), after = addTrack(h, 'local', 'after');
    await h.start(170); const task = h.PlaybackTransitions.to(1, 400); await flush();
    const incoming = h.Engine.other(), pending = incoming.attempts.at(-1);
    incoming.metadata(1); naturalEnd(incoming);
    if (interruption === 'native-focus-pause') { h.audio().pause(); await h.clock.advance(0); }
    else if (interruption === 'context-interrupted') { h.Engine.ctx.change('interrupted'); await flush(); }
    else if (interruption === 'skip') { await h.Engine.playIndex(2, true); h.audio().metadata(200); h.audio().playing(); await flush(); }
    else h.Engine[interruption]();
    const selected = h.Engine.current, slot = h.Engine.cur;
    const wanted = h.Engine.wantsPlayback(), actual = h.Engine.playing;
    pending.resolve(); await task; await flush(); await h.clock.advance(60000);
    assert.equal(h.Engine.current, selected); assert.equal(h.Engine.cur, slot);
    assert.equal(h.Engine.wantsPlayback(), wanted); assert.equal(h.Engine.playing, actual);
    assert.equal(incoming.paused, true); assert.notEqual(h.Engine.current?.id, next.id);
    if (interruption === 'skip') assert.equal(h.Engine.current?.id, after.id);
    else { assert.equal(wanted, false); assert.equal(actual, false); }
  });
}

const unavailableSource = (h, kind, t) => {
  if (kind.includes('r2')) {
    const prior = h.ctx.R2Source.fileFor;
    h.ctx.R2Source.fileFor = next => next.id === t.id ? null : prior(next);
    return () => {h.ctx.R2Source.fileFor = prior;};
  }
  if (kind === 'drive') {
    const prior = h.ctx.DriveSource.api; h.ctx.DriveSource.api = null;
    return () => {h.ctx.DriveSource.api = prior;};
  }
  if (kind === 'server') {
    const prior = h.ctx.DrawerCast.canPlay; h.ctx.DrawerCast.canPlay = next => next.id !== t.id;
    return () => {h.ctx.DrawerCast.canPlay = prior;};
  }
  t.disabled = true; return () => {t.disabled = false;};
};

for (const kind of ['native-r2', 'legacy-r2', 'drive', 'server', 'local']) {
  test(`${kind} unavailable next preflight normalizes natural end and explicit replay ends legitimately`, async () => {
    const h = harness(kind), next = addTrack(h, kind); await h.start(198);
    const restore = unavailableSource(h, kind, next), old = h.audio(); naturalEnd(old); await flush();
    assert.equal(h.Engine.playing, false, 'an ended element cannot remain actual playback');
    assert.equal(h.Engine.wantsPlayback(), false, 'unavailable next source settles to stopped intent');
    assert.equal(h.PlaybackTransitions.pending, false);
    assert.equal(old.paused, true); assert.equal(old.ended, true);
    const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0);
    old.emit('ended'); await h.clock.advance(60000);
    assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts, 'duplicate ended is inert while stopped');
    restore(); const replay = h.Engine.play(); await flush();
    const replayAudio = h.audio(); replayAudio.ended = false; replayAudio.currentTime = 0;
    replayAudio.metadata(200); replayAudio.playing(); await replay; await flush();
    assert.equal(h.Engine.wantsPlayback(), true); assert.equal(h.Engine.playing, true);
    naturalEnd(replayAudio); await flush();
    assert.equal(h.Engine.current?.id, next.id, 'the next legitimate natural end advances after explicit replay');
    assert.equal(h.Engine.wantsPlayback(), true);
    h.audio().metadata(200); h.audio().playing(); await flush();
    assert.equal(h.Engine.playing, true);
  });

  test(`${kind} manual unavailable selection preserves healthy outgoing playback`, async () => {
    const h = harness(kind), next = addTrack(h, kind); await h.start(170);
    unavailableSource(h, kind, next); const outgoing = h.audio(), attempts = outgoing.attempts.length;
    await h.Engine.playIndex(1, true); await flush(); await h.clock.advance(2000);
    assert.equal(h.Engine.current.id, h.selected.id); assert.equal(h.audio(), outgoing);
    assert.equal(h.Engine.wantsPlayback(), true); assert.equal(h.Engine.playing, true);
    assert.equal(outgoing.paused, false); assert.equal(outgoing.attempts.length, attempts);
  });
}

test('default transparent gapless unavailable next stops and replay can advance', async () => {
  const h = harness('native-r2', {webAudio: true}), next = addTrack(h);
  Object.assign(h.ctx.SET, {audioMode: 'transparent', crossfade: false, gapless: true, fadeOnPause: true, fadeLen: 250, repeatMode: 'off'});
  h.ctx.nativeValues = () => ({crossfade_auto_advance: 0, track_end_silence_ms: 0, gapless_preload_ms: 0});
  await h.start(170); const fileFor = h.ctx.R2Source.fileFor;
  const restore = unavailableSource(h, 'native-r2', next); h.ctx.getFileFor = async t => h.ctx.R2Source.fileFor(t);
  h.audio().progress(198); await flush(); naturalEnd(h.audio()); await flush();
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  restore(); const replay = h.Engine.play(); await flush(); const a = h.audio();
  a.ended = false; a.currentTime = 0; a.metadata(200); a.playing(); await replay; await flush();
  naturalEnd(a); await flush(); assert.equal(h.Engine.current?.id, next.id);
  assert.equal(h.ctx.R2Source.fileFor(next).__remoteURL, h.urls.get(next.id));
  assert.equal(fileFor(next).__remoteURL, h.urls.get(next.id));
});

test('production-order native end listener retains track-end silence and dedupes one advance', async () => {
  const h = harness(), next = addTrack(h); addTrack(h, 'native-r2', 'after');
  h.ctx.nativeValues = () => ({track_end_silence_ms: 250}); await h.start(198);
  const a = h.audio(); naturalEnd(a); a.emit('ended'); await flush();
  assert.equal(h.Engine.current.id, h.selected.id); await h.clock.advance(249);
  assert.equal(h.Engine.current.id, h.selected.id); await h.clock.advance(1);
  assert.equal(h.Engine.current.id, next.id); h.audio().metadata(200); h.audio().playing(); await flush();
  await h.clock.advance(1000); assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, true);
});

test('healthy production-order gapless R2 handoff preserves clean media URL and playback confirmation', async () => {
  const h = harness('native-r2', {webAudio: true}), next = addTrack(h);
  h.ctx.SET.gapless = true; await h.start(195); await flush();
  const spare = h.Engine.other(); spare.metadata(200); assert.equal(h.Engine.preloadId, next.id);
  naturalEnd(h.audio()); await flush();
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.audio(), spare);
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), true);
  assert.equal(spare.src, h.urls.get(next.id)); spare.playing(); await flush(); await h.clock.advance(0);
  assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
});


for (const kind of ['native-r2', 'legacy-r2', 'drive', 'server']) {
  test(`${kind} terminal outgoing error cancels a pending crossfade and its late completion`, async () => {
    const h = harness(kind); addTrack(h, kind); await h.start(170);
    const outgoing = h.audio(); outgoing.error = {code: 2}; outgoing.emit('error'); await finishRetry(h, kind);
    const task = h.PlaybackTransitions.to(1, 400); await flush();
    const incoming = h.Engine.other(), pending = incoming.attempts.at(-1);
    outgoing.error = {code: 2}; outgoing.emit('error'); await flush();
    assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
    assert.equal(h.PlaybackTransitions.pending, false, 'terminal outgoing failure cancels pending incoming selection');
    const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0);
    pending.resolve(); await task; await flush(); await h.clock.advance(60000);
    assert.equal(h.Engine.current.id, h.selected.id); assert.equal(h.audio(), outgoing);
    assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
    assert.equal(incoming.paused, true);
    assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts);
  });

  test(`${kind} rejected incoming crossfade does not grant the outgoing song an extra retry`, async () => {
    const h = harness(kind); addTrack(h, kind); await h.start(170);
    const outgoing = h.audio(); outgoing.error = {code: 2}; outgoing.emit('error'); await finishRetry(h, kind);
    const task = h.PlaybackTransitions.to(1, 400); await flush();
    h.Engine.other().attempts.at(-1).reject({name: 'NetworkError'}); await task; await flush();
    assert.equal(h.Engine.current.id, h.selected.id);
    assert.equal(h.Engine[retryState(kind).id], h.selected.id, 'only an accepted new selection resets its retry budget');
    outgoing.error = {code: 2}; outgoing.emit('error'); await flush();
    assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
  });
}

test('obsolete ended callback on a healthy reused current slot cannot skip the new song', async () => {
  const h = harness(), next = addTrack(h), after = addTrack(h, 'native-r2', 'after'); await h.start(198);
  const a = h.audio(); naturalEnd(a); await flush(); assert.equal(h.Engine.current.id, next.id);
  a.metadata(200); a.playing(); a.progress(1); await flush(); assert.equal(a.ended, false);
  // This is a queued obsolete callback, not evidence Chromium always emits one.
  a.emit('ended'); await flush(); await h.clock.advance(1000);
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, true);
  naturalEnd(a); await flush(); assert.equal(h.Engine.current.id, after.id, 'the real new song end still advances');
});

test('outgoing native end cancels pending incoming crossfade and ordinarily starts the next song', async () => {
  const h = harness(), next = addTrack(h); await h.start(198);
  const task = h.PlaybackTransitions.to(1, 400); await flush();
  const incoming = h.Engine.other(), pending = incoming.attempts.at(-1);
  naturalEnd(h.audio()); await flush();
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.cur, 0);
  h.audio().metadata(200); h.audio().playing(); await flush();
  pending.resolve(); await task; await flush(); await h.clock.advance(1000);
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, true); assert.equal(incoming.paused, true);
});

test('unavailable next preserves the exact duplicate queue occurrence through explicit replay', async () => {
  const h = harness(); addTrack(h); h.add(h.selected, h.urls.get(h.selected.id));
  const after = addTrack(h, 'native-r2', 'after-duplicate');
  h.Engine.pos = 2; await h.start(198);
  const restore = unavailableSource(h, 'native-r2', after), a = h.audio(); naturalEnd(a); await flush();
  assert.equal(h.Engine.current.id, h.selected.id);
  assert.equal(h.Engine.pos, 2, 'failed preflight preserves the second A occurrence rather than moving to first A');
  assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), false);
  restore(); const replay = h.Engine.play(); await flush();
  a.ended = false; a.currentTime = 0; a.metadata(200); a.playing(); await replay; await flush();
  assert.equal(h.Engine.pos, 2); naturalEnd(a); await flush();
  assert.equal(h.Engine.current.id, after.id); assert.equal(h.Engine.pos, 3);
});

test('completed incoming B with unavailable C stops and later explicit B replay can advance to C', async () => {
  const h = harness(), next = addTrack(h), after = addTrack(h, 'native-r2', 'after'); await h.start(198);
  const restore = unavailableSource(h, 'native-r2', after);
  const task = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
  incoming.metadata(1); naturalEnd(incoming); incoming.attempts.at(-1).resolve(); await task; await flush();
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.pos, 1);
  assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
  assert.equal(h.PlaybackTransitions.pending, false); assert.equal(h.Engine.xfading, false);
  restore(); const replay = h.Engine.play(); await flush(); const a = h.audio();
  a.ended = false; a.currentTime = 0; a.metadata(200); a.playing(); await replay; await flush();
  naturalEnd(a); await flush(); assert.equal(h.Engine.current.id, after.id); assert.equal(h.Engine.pos, 2);
});

test('Pause during completed incoming track-end silence prevents its scheduled advance', async () => {
  const h = harness(), next = addTrack(h); addTrack(h, 'native-r2', 'after'); await h.start(198);
  h.ctx.nativeValues = () => ({track_end_silence_ms: 250});
  const task = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
  incoming.metadata(1); naturalEnd(incoming); incoming.attempts.at(-1).resolve(); await task; await flush();
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, false);
  assert.equal(h.Engine.wantsPlayback(), true); assert.ok([...h.clock.pending.values()].some(t => t.delay === 250));
  h.Engine.pause(); const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0);
  await h.clock.advance(60000);
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
  assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts);
});

test('late crossfade play completion from a paused nonended incoming element yields interruption', async () => {
  const h = harness(); addTrack(h); await h.start(170);
  const task = h.PlaybackTransitions.to(1, 400); await flush(); const incoming = h.Engine.other();
  incoming.metadata(200); incoming.pause(); incoming.attempts.at(-1).resolve(); await task; await flush();
  assert.equal(h.Engine.current.id, h.selected.id);
  assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
  assert.equal(h.PlaybackTransitions.pending, false); assert.equal(h.Engine.xfading, false);
  const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0); await h.clock.advance(60000);
  assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts);
});

test('real ended event before a new selection reports playing still advances once', async () => {
  const h = harness(), next = addTrack(h), after = addTrack(h, 'native-r2', 'after'); await h.start(198);
  await h.Engine.playIndex(1, true); const a = h.audio(); a.metadata(1);
  assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, false); assert.equal(h.Engine.wantsPlayback(), true);
  naturalEnd(a); await flush(); assert.equal(h.Engine.current.id, after.id);
  a.metadata(200); a.playing(); a.progress(1); await flush();
  a.emit('ended'); await flush(); assert.equal(h.Engine.current.id, after.id); assert.equal(h.Engine.playing, true);
});


for (const webAudio of [false, true]) {
  test(`late-ended repeat-one incoming restores ${webAudio ? 'Web Audio gain target' : 'element volume'} before replay`, async () => {
    const h = harness('local', {webAudio}), next = addTrack(h, 'local');
    Object.assign(h.ctx.SET, {repeatMode: 'one', fadeOnPause: false, volume: 1});
    // Retain the real installed volume/gain function for this audible-output
    // regression instead of the transport-only harness's normal no-op.
    h.Engine.setGain = h.installedSetGain; await h.start(198);
    const incoming = h.Engine.other(), slot = 1 - h.Engine.cur, gainTargets = [];
    if (webAudio) {
      const gain = h.Engine.gains[slot].gain;
      gain.setValueAtTime = (value, at) => {gain.value = value; gainTargets.push({value, at});};
      gain.linearRampToValueAtTime = (value, at) => {gain.value = value; gainTargets.push({value, at});};
    }
    const task = h.PlaybackTransitions.to(1, 400); await flush();
    if (webAudio) assert.equal(gainTargets.at(-1)?.value, 0, 'pending incoming gain is intentionally zero');
    else assert.equal(incoming.volume, 0, 'pending incoming volume is intentionally zero');
    incoming.metadata(1); naturalEnd(incoming); incoming.attempts.at(-1).resolve(); await task; await flush();
    assert.equal(h.Engine.current.id, next.id); assert.equal(h.audio(), incoming);
    assert.equal(incoming.attempts.length, 2, 'repeat-one requests exactly one replay');
    assert.equal(h.Engine.playing, false, 'gain restoration does not claim actual output before playback confirmation');
    assert.equal(h.Engine.wantsPlayback(), true);
    if (webAudio) assert.equal(gainTargets.at(-1)?.value, 1, 'the installed function restores the incoming output gain');
    else assert.equal(incoming.volume, 1, 'repeat-one restores element volume with fadeOnPause disabled');
    incoming.ended = false; incoming.currentTime = 0; incoming.metadata(200); incoming.playing(); incoming.progress(1); await flush();
    assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
    if (webAudio) assert.equal(h.Engine.gains[slot].gain.value, 1);
    else assert.equal(incoming.volume, 1);
  });
}

for (const kind of ['native-r2', 'local']) {
  for (const completion of ['resolve', 'reject']) {
    for (const newerStage of ['pending', 'committed']) {
      test(`${kind} canceled same-URL crossfade late ${completion} cannot disturb newer ${newerStage} incoming attempt`, async () => {
        const h = harness(kind), next = addTrack(h, kind); h.Engine.setGain = h.installedSetGain; await h.start(170);
        const first = h.PlaybackTransitions.to(1, 400); await flush();
        const incoming = h.Engine.other(), oldAttempt = incoming.attempts.at(-1), url = incoming.src;
        const second = h.PlaybackTransitions.to(1, 400); await flush();
        const newerAttempt = incoming.attempts.at(-1);
        assert.notEqual(oldAttempt, newerAttempt); assert.equal(incoming.src, url);
        assert.equal(h.Engine.other(), incoming, 'same element slot is reused for B');
        if (newerStage === 'committed') {
          incoming.metadata(200); incoming.playing(); await second; await flush();
          assert.equal(h.Engine.current.id, next.id); assert.equal(h.Engine.playing, true);
        }
        if (completion === 'resolve') oldAttempt.resolve();
        else oldAttempt.reject({name: 'AbortError'});
        await first; await flush();
        assert.equal(incoming.paused, false, 'obsolete completion cannot pause the newer same-URL media request');
        assert.equal(h.Engine.wantsPlayback(), true, 'obsolete result cannot clear the newer playback intent');
        if (newerStage === 'pending') {
          assert.equal(h.PlaybackTransitions.pending, true, 'obsolete result cannot clear the newer pending transition');
          assert.equal(h.Engine.current.id, h.selected.id);
          incoming.metadata(200); incoming.playing(); await second; await flush();
        }
        await h.clock.advance(1000);
        assert.equal(h.Engine.current.id, next.id); assert.equal(h.audio(), incoming);
        assert.equal(h.Engine.playing, true); assert.equal(h.Engine.wantsPlayback(), true);
        assert.equal(incoming.paused, false); assert.equal(incoming.volume, 1);
        assert.equal(h.PlaybackTransitions.pending, false); assert.equal(h.Engine.xfading, false);
        assert.equal(incoming.attempts.length, 2, 'the newer request commits without a replacement third attempt');
      });
    }
  }
}

for (const interruption of ['pause', 'stop']) {
  for (const completion of ['resolve', 'reject']) {
    test(`${interruption} still cancels both same-URL transitions despite first late ${completion} and second late resolve`, async () => {
      const h = harness('local'); addTrack(h, 'local'); await h.start(170);
      const first = h.PlaybackTransitions.to(1, 400); await flush();
      const incoming = h.Engine.other(), oldAttempt = incoming.attempts.at(-1), url = incoming.src;
      const second = h.PlaybackTransitions.to(1, 400); await flush(); const newerAttempt = incoming.attempts.at(-1);
      assert.equal(incoming.src, url); assert.notEqual(oldAttempt, newerAttempt);
      h.Engine[interruption](); const selected = h.Engine.current, slot = h.Engine.cur;
      if (completion === 'resolve') oldAttempt.resolve(); else oldAttempt.reject({name: 'AbortError'});
      await first; await flush(); newerAttempt.resolve(); await second; await flush();
      const attempts = h.Engine.els.reduce((n, a) => n + a.attempts.length, 0); await h.clock.advance(60000);
      assert.equal(h.Engine.current, selected); assert.equal(h.Engine.cur, slot);
      assert.equal(h.Engine.wantsPlayback(), false); assert.equal(h.Engine.playing, false);
      assert.equal(incoming.paused, true); assert.equal(h.PlaybackTransitions.pending, false); assert.equal(h.Engine.xfading, false);
      assert.equal(h.Engine.els.reduce((n, a) => n + a.attempts.length, 0), attempts);
    });
  }
}
