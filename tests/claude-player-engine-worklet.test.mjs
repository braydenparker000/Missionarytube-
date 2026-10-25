// Claude Player audio engine worklet (src/dsp/engine-worklet.js), run in Node
// with a stand-in AudioWorkletGlobalScope: the deck fades that cross-fades,
// pauses and seeks are made of, however the main thread's messages fall
// between render blocks.
// Run: node --test tests/claude-player-engine-worklet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const RATE = 48000, N = 128;
globalThis.sampleRate = RATE;
const registry = new Map();
globalThis.registerProcessor = (name, cls) => registry.set(name, cls);
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.posted = [];
    this.port = {onmessage: null, postMessage: m => this.posted.push({...m, frame: this.frame})};
  }
};
await import('../frontend/claude-player/src/dsp/engine-worklet.js');

/** The cp-eq processor with a frame counter; send() delivers a message between blocks. */
function eq() {
  const p = new (registry.get('cp-eq'))();
  p.frame = 0;
  p.send = m => p.port.onmessage({data: m});
  return p;
}

const tone = (hz, amp = 0.25) => {
  let ph = 0;
  return n => Float32Array.from({length: n}, () => { const v = amp * Math.sin(ph); ph += 2 * Math.PI * hz / RATE; return v; });
};

/** Renders blocks while inputs(b) gives each deck's audio; returns each deck's fade gain per block. */
function render(p, blocks, inputs, each = () => {}) {
  const gains = [];
  for (let b = 0; b < blocks; b++) {
    each(b);
    const ins = inputs(b).map(x => (x ? [x, x] : []));
    p.process(ins, [0, 1, 2].map(() => [new Float32Array(N), new Float32Array(N)]));
    p.frame += N;
    gains.push(p.fades.map(f => f.value));
  }
  return gains;
}

const at = ms => Math.floor(ms / 1000 * RATE / N);

test('the outgoing deck waits for the incoming one to sound, in whatever block its fade arrives', () => {
  for (const late of [0, 1, 8, 40]) {
    const p = eq(), a = tone(440), b = tone(330), onset = at(300);
    // load(): the incoming deck silenced, the outgoing fade linked to it...
    p.send({type: 'set', deck: 1, value: 0});
    p.send({type: 'fade', deck: 0, to: 0, ms: 400, curve: 'equal', after: 1, id: 1});
    // ...and the incoming deck's gated fade-in later, once its source is set.
    const g = render(p, at(1200), k => [a(N), k >= onset ? b(N) : null], k => { if (k === late) p.send({type: 'fade', deck: 1, to: 1, ms: 400, curve: 'equal', gate: true, id: 2}); });
    assert.equal(g[onset - 1][0], 1, `${late} blocks late: the outgoing track plays on until the incoming one sounds`);
    assert.ok(g[onset + at(200)][0] < 0.8 && g[onset + at(200)][1] > 0.6, `${late} blocks late: both fade from the incoming sound`);
    assert.deepEqual(p.posted.filter(m => m.type === 'done').map(m => m.id).sort(), [1, 2]);
  }
});

test('an incoming deck replaced before it sounded (Next twice): the outgoing one waits for the replacement', () => {
  const p = eq(), a = tone(440), c = tone(550), onset = at(450);
  p.send({type: 'set', deck: 1, value: 0});
  p.send({type: 'fade', deck: 0, to: 0, ms: 400, curve: 'equal', after: 1, id: 1});
  p.send({type: 'fade', deck: 1, to: 1, ms: 400, curve: 'equal', gate: true, id: 2});
  const g = render(p, at(1200), k => [a(N), k >= onset ? c(N) : null], k => {
    if (k === at(150)) { p.send({type: 'set', deck: 1, value: 0}); p.send({type: 'fade', deck: 1, to: 1, ms: 400, curve: 'equal', gate: true, id: 3}); }
  });
  assert.equal(g[onset - 1][0], 1);
  assert.ok(g[onset + at(200)][0] < 0.8);
  assert.ok(!p.posted.some(m => m.type === 'done' && m.id === 2), 'the replaced fade never completes');
});

test('an automatic cross-fade still ends with its track when the incoming one is late', () => {
  const p = eq(), a = tone(440), b = tone(330), late = at(600);
  p.send({type: 'set', deck: 1, value: 0});
  p.send({type: 'fade', deck: 0, to: 0, ms: 2000, curve: 'equal', after: 1, keepEnd: true, timeoutMs: 1700, id: 1});
  p.send({type: 'fade', deck: 1, to: 1, ms: 2000, curve: 'equal', gate: true, id: 2});
  render(p, at(2500), k => [a(N), k >= late ? b(N) : null]);
  const done = p.posted.find(m => m.id === 1).frame / RATE;
  assert.ok(Math.abs(done - 2) < 0.01, `the outgoing fade ends at ${done} s, with the track (2 s)`);
  // With no incoming sound at all it gives up waiting in time to fade out over the last 300 ms.
  const q = eq();
  q.send({type: 'set', deck: 1, value: 0});
  q.send({type: 'fade', deck: 0, to: 0, ms: 2000, curve: 'equal', after: 1, keepEnd: true, timeoutMs: 1700, id: 1});
  const g = render(q, at(2100), () => [a(N), null]);
  assert.equal(g[at(1690)][0], 1);
  assert.ok(Math.abs(q.posted.find(m => m.id === 1).frame / RATE - 2) < 0.01);
});

test('a fade under 50 ms takes the smooth curve; a fade taking over a running one turns without a corner', () => {
  const p = eq(), a = tone(440);
  p.send({type: 'fade', deck: 0, to: 0, ms: 8, curve: 'equal', id: 1});
  const values = [];
  const f = p.fades[0], step = () => { p.process([[a(1), a(1)], []], [0, 1, 2].map(() => [new Float32Array(1), new Float32Array(1)])); values.push(f.value); };
  for (let i = 0; i < 192; i++) step();
  // Raised cosine: half way at half time (equal power would be at 0.71).
  assert.ok(Math.abs(values[191] - 0.5) < 0.01, `midpoint ${values[191]}`);
  // Play 4 ms into the 8 ms fade-out: the gain's slope carries on through the turn.
  p.send({type: 'fade', deck: 0, to: 1, ms: 8, curve: 'smooth', id: 2});
  for (let i = 0; i < 400; i++) step();
  const d = values.slice(1).map((v, i) => v - values[i]);
  // The curves' own bending is under 1e-4 per frame; a corner (the gain held, then restarted) would jump about 4e-3.
  const jump = Math.max(...d.slice(1).map((x, i) => Math.abs(x - d[i])));
  assert.ok(jump < 1e-4, `largest change of slope ${jump}`);
  assert.equal(values.at(-1), 1);
});

/** Gapless: runs cp-eq over scripted deck inputs (frame → sample or undefined for silence), returning its music output and messages. */
function gapless(p, seconds, deckA, deckB, at = []) {
  const n = Math.round(seconds * RATE / N), outL = new Float32Array(n * N);
  for (let k = 0; k < n; k++) {
    for (const [block, m] of at) if (block === k) p.send(typeof m === 'function' ? m() : m);
    const ins = [deckA, deckB].map(src => {
      const L = new Float32Array(N);
      let any = false;
      for (let i = 0; i < N; i++) { const v = src(k * N + i); if (v !== undefined) { L[i] = v; any = true; } }
      return any ? [L, L] : [];
    });
    const outs = [0, 1, 2].map(() => [new Float32Array(N), new Float32Array(N)]);
    p.process(ins, outs);
    outL.set(outs[0][0], k * N);
  }
  return outL;
}

const W = 2 * Math.PI * 440 / RATE, AMP = 0.25, LA = 320;
const sine = j => AMP * Math.sin(W * j);

test('gapless: the next track follows the last frame of the playing one exactly, however early it started', () => {
  for (const latency of [0.012, 0.031]) {
    const p = eq(), endA = 36077, start = Math.round(endA - 0.5 * RATE), b0 = start + Math.round(latency * RATE);
    // A plays a sine to frame endA (a phase that is not a zero crossing), then nothing; B continues the same sine from where A stopped.
    const out = gapless(p, 1.4, f => (f < endA ? sine(f) : undefined), f => (f >= b0 ? sine(endA + f - b0) : undefined),
      [[Math.floor(start / N), () => ({type: 'splice', deck: 1, from: 0, endIn: (endA - Math.floor(start / N) * N) / RATE})]]);
    // The output is the one continuous sine, LA frames late.
    let worst = 0;
    for (let t = LA; t < out.length - 256; t++) worst = Math.max(worst, Math.abs(out[t] - sine(t - LA)));
    assert.ok(worst < 1e-6, `latency ${latency}: largest error ${worst}`);
    const m = p.posted.find(x => x.type === 'spliced');
    assert.equal(m.deck, 1);
    assert.equal(m.pad, 0);
    assert.ok(Math.abs(m.delay - (0.5 - latency)) < 0.01, `delay ${m.delay}`);
  }
});

test('gapless: the next track\'s leading silence is kept (one shorter than the start tolerance is taken for start jitter), also one going on past the end; the playing track\'s trailing silence too', () => {
  const lat = Math.round(0.02 * RATE), arm = 12032, endA = 24000;
  for (const silent of [0.1, 0.2, 0.3].map(x => Math.round(x * RATE))) {
    // The decks' start latency (20 ms) was learned from an earlier join; the next track begins with digital silence.
    const q = eq();
    q.starts[0] = lat;
    q.startN = 1;
    const out = gapless(q, 1.5, f => (f < endA ? sine(f) : undefined), f => (f >= arm + lat + silent ? sine(f) : f >= arm + lat ? 0 : undefined),
      [[arm / N, {type: 'splice', deck: 1, from: 0, endIn: (endA - arm) / RATE}]]);
    let first = -1, last = -1;
    for (let t = 0; t < out.length; t++) if (Math.abs(out[t]) > 1e-4) { if (t < endA + LA + 10) last = t; else if (first < 0) first = t; }
    // The next track plays from its beginning: all of its leading silence comes between them (under 150 ms, none).
    const kept = (first - last - 1) / RATE, want = silent / RATE < 0.15 ? 0 : silent / RATE;
    assert.ok(Math.abs(kept - want) < 0.003, `${silent / RATE} s: kept ${kept} s`);
  }
  // Trailing silence: a track whose last second is digital silence keeps it (all but the 120 ms tolerance).
  const r = eq();
  r.starts[0] = lat;
  r.startN = 1;
  const out3 = gapless(r, 2.2, f => (f < 24000 ? sine(f) : f < 72000 ? 0 : undefined), f => (f >= 48000 + lat ? sine(f) : undefined),
    [[48000 / N, {type: 'splice', deck: 1, from: 0, endIn: (72000 - 48000) / RATE}]]);
  let resumed = -1;
  for (let t = 24000 + LA + 10; t < out3.length; t++) if (Math.abs(out3[t]) > 1e-4) { resumed = t; break; }
  assert.ok((resumed - (24000 + LA)) / RATE > 0.85, `trailing silence kept ${(resumed - 24000 - LA) / RATE} s`);
});

test('gapless: a playing track that does not end gives the splice up; a flush cancels it and returns the deck to plain playback', () => {
  const p = eq();
  gapless(p, 3, f => sine(f), f => (f >= 6000 ? sine(f) : undefined), [[40, {type: 'splice', deck: 1, from: 0, endIn: 0.1}]]);
  assert.ok(p.posted.some(m => m.type === 'splice_failed' && m.deck === 1));
  // Held, the next deck is not heard; flushed, it plays what comes in from then as usual (LA frames late), nothing it held.
  const q = eq();
  const out = gapless(q, 0.5, () => undefined, f => sine(f), [[0, {type: 'splice', deck: 1, from: 0, endIn: 5}], [50, {type: 'flush', deck: 1}]]);
  assert.equal(Math.max(...out.subarray(0, 50 * N + LA).map(Math.abs)), 0);
  for (let t = 50 * N + LA; t < out.length; t++) assert.ok(Math.abs(out[t] - sine(t - LA)) < 1e-6);
  assert.ok(!q.posted.some(m => m.type === 'spliced'));
});

test('gapless: ringing edges (resampled tracks) overlap where they add up to the signal, found near the modelled length; abrupt ones join back to back; a slower start than the recent ones adds no silence', () => {
  // A continuous sine split at frame E. Ringing: both tracks pass the same band-limiting filter (a windowed sinc, 2R + 1 taps,
  // as a resampler does), so A's end and B's start ring over R frames each and add up to the filtered sine; abrupt: unfiltered.
  const R = 29, E = 36077, fc = 0.45;
  const h = Array.from({length: 2 * R + 1}, (_, i) => {
    const k = i - R, x = (i + 1) / (2 * R + 2), w = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
    return w * (k ? Math.sin(2 * Math.PI * fc * k) / (Math.PI * k) : 2 * fc);
  });
  const lp = (sig, n) => { let v = 0; for (let k = -R; k <= R; k++) v += h[k + R] * sig(n - k); return v; };
  const head = n => (n < E ? sine(n) : 0), rest = n => (n >= E ? sine(n) : 0);
  for (const [ringing, model] of [[false, R], [true, R], [true, R + 3], [true, R - 3]]) {
    const p = eq(), arm = Math.floor((E - 0.5 * RATE) / N) * N, b0 = arm + Math.round(0.13 * RATE);
    // The fastest recent start took 10 ms; this one takes 130 ms (under the 150 ms tolerance: start jitter, not leading silence).
    p.starts[0] = Math.round(0.01 * RATE);
    p.startN = 1;
    const aEnd = ringing ? E + R : E, bFrom = ringing ? E - R : E;
    const a = f => (ringing ? lp(head, f) : head(f)), b = j => (ringing ? lp(rest, bFrom + j) : rest(bFrom + j));
    const out = gapless(p, 1.4, f => (f < aEnd ? a(f) : undefined), f => (f >= b0 ? b(f - b0) : undefined),
      [[arm / N, () => ({type: 'splice', deck: 1, from: 0, endIn: (aEnd - arm) / RATE, ringFrom: model, ringTo: model})]]);
    // The output is the one continuous (filtered) sine, LA frames late.
    const want = ringing ? s => lp(sine, s) : sine;
    let worst = 0;
    for (let t = E - 2000 + LA; t < E + 4000 + LA; t++) worst = Math.max(worst, Math.abs(out[t] - want(t - LA)));
    const m = p.posted.find(x => x.type === 'spliced');
    assert.ok(worst < 1e-6, `${ringing ? 'ringing' : 'abrupt'}, modelled ${model}: largest error ${worst}`);
    assert.equal(m.overlap, ringing ? 2 * R : 0);
    assert.equal(m.pad, 0);
  }
});

test('a flush fades out what was about to be heard (no step), also a spliced deck\'s delay, and then plays on from new input', () => {
  for (const delayed of [false, true]) {
    const p = eq();
    // Deck 0 plays a sine; delayed: joined into deck 0 first (deck 1 silent), so it plays 0.3 s behind its input.
    const at = delayed ? [[0, {type: 'splice', deck: 0, from: 1, endIn: 0}]] : [];
    const stop = 120 * N;
    const out = gapless(p, 1, f => (f < stop ? sine(f) : undefined), () => undefined, [...at, [120, {type: 'flush', deck: 0}]]);
    if (delayed) assert.ok(p.posted.some(m => m.type === 'spliced'));
    let step = 0, last = -1;
    for (let t = 1; t < out.length; t++) { step = Math.max(step, Math.abs(out[t] - out[t - 1])); if (Math.abs(out[t]) > 0) last = t; }
    // A sine's own largest step is AMP·W (0.0144); a cut would step by up to AMP.
    assert.ok(step < AMP * W * 1.2, `${delayed ? 'delayed' : 'direct'}: largest step ${step}`);
    // Silent within the fade-out (8 ms) of the flush.
    assert.ok(last < stop + Math.round(0.008 * RATE) + 1, `${delayed ? 'delayed' : 'direct'}: last sound at ${last - stop} frames after the flush`);
  }
});
