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
