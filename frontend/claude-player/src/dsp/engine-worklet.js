// The audio engine's worklet (AudioWorkletGlobalScope, loaded by dsp.js):
// - cp-eq: the two decks in, each with its ReplayGain and fade gain, then the
//   preamp, the equalizer bank (eq-engine.js) and the stereo matrix (width,
//   mono, balance). Fades glide from wherever they are; a fade can wait for
//   its deck's audio to begin (gate) or for another deck's sound to begin
//   under its gated fade (after), so it starts with the sound however long
//   the network took, in whichever order the messages arrive. A fade that
//   must end on time (keepEnd: an automatic cross-fade ends with its track)
//   is shortened by its wait. Fades under 50 ms use the smooth curve: an
//   equal-power curve's corner clicks when it is that short. A fade that
//   takes over a running one (play just after pause) continues from its
//   slope, so the gain turns without a corner.
//   Outputs 1 and 2 are the sends to the two reverb convolvers, each faded
//   in and out here: a convolver whose input started abruptly would smear
//   that step into a long noisy tail.
// - cp-out: the dry signal and the reverb returns, the master volume and the
//   true-peak limiter (limiter.js), with meters for the Limit button and the
//   playback log.
// Every gain glides; nothing in process() allocates.
import {EqBank} from './eq-engine.js';
import {TruePeakLimiter} from './limiter.js';

// A deck's audio has begun once a sample exceeds this (decks are silent zeros until then).
const SILENT = 1e-6;
const coef = ms => 1 - Math.exp(-1 / (sampleRate * ms / 1000));
const GLIDE = coef(20);
const SHORT = Math.round(sampleRate * 0.05), MIN_FADE = Math.round(sampleRate * 0.008);

/** Fade curves: linear, equal power (crossfades) and smooth (raised cosine). */
function shape(curve, x, rising) {
  if (curve === 'equal') return rising ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2);
  if (curve === 'smooth') return 0.5 - 0.5 * Math.cos(Math.PI * x);
  return x;
}

/** From p0 leaving with slope m0 (per fade length) to p1, arriving flat (cubic Hermite). */
function hermite(p0, m0, p1, x) {
  const x2 = x * x, x3 = x2 * x;
  return Math.max(0, (2 * x3 - 3 * x2 + 1) * p0 + (x3 - 2 * x2 + x) * m0 + (3 * x2 - 2 * x3) * p1);
}

class Fade {
  constructor() {
    this.value = 1;
    this.from = 1;
    this.to = 1;
    this.pos = 0;
    this.len = 0;
    this.curve = 'linear';
    // 0 running (or idle), 1 waiting for this deck's audio, 2 waiting for the other deck's fade.
    this.wait = 0;
    this.other = 0;
    this.left = 0;
    this.id = 0;
    this.began = -1;
    // The deck's sound has begun under its gated fade (what another deck's "after" waits for).
    this.sounded = false;
    this.waited = 0;
    this.keepEnd = false;
    // The gain's change per frame while a fade runs, and the slope a new fade starts with.
    this.vel = 0;
    this.v0 = 0;
  }

  start(m) {
    const vel = this.running ? this.vel : 0;
    this.vStart = vel;
    this.from = this.value;
    this.to = m.to;
    this.len = Math.max(1, Math.round(sampleRate * (m.ms ?? 0) / 1000));
    this.pos = 0;
    this.curve = m.curve ?? 'linear';
    this.shorten();
    this.wait = m.gate ? 1 : m.after !== undefined ? 2 : 0;
    this.other = m.after ?? 0;
    this.left = Math.round(sampleRate * (m.timeoutMs ?? 4000) / 1000);
    this.id = m.id ?? 0;
    this.sounded = false;
    this.waited = 0;
    this.keepEnd = !!m.keepEnd;
    // Taking over a running fade at once: on from its slope (a fade that waits starts from rest).
    this.v0 = this.wait === 0 ? vel : 0;
  }

  /** A short equal-power fade takes the smooth curve (no corner at its end). */
  shorten() {
    if (this.curve === 'equal' && this.len < SHORT) this.curve = 'smooth';
  }

  /** Stops where it is (set, hold): no fade, no wait. */
  rest(value = this.value) {
    this.wait = 0;
    this.len = 0;
    this.value = this.to = value;
    this.vel = 0;
    this.sounded = false;
  }

  get running() { return this.wait === 0 && this.pos < this.len; }
}

class EqProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bank = new EqBank(sampleRate);
    this.pre = 1; this.preT = 1;
    this.m = new Float64Array([1, 0, 0, 1]); this.mT = new Float64Array([1, 0, 0, 1]);
    this.rg = new Float64Array([1, 1]); this.rgT = new Float64Array([1, 1]);
    this.fades = [new Fade(), new Fade()];
    this.send = new Float64Array(2); this.sendT = new Float64Array(2);
    this.wl = new Float64Array(128); this.wr = new Float64Array(128);
    this.port.onmessage = e => this.message(e.data);
  }

  message(m) {
    if (m.type === 'state') {
      this.preT = m.preamp;
      this.mT.set(m.matrix);
      if (m.rg) this.rgT.set(m.rg);
      if (m.send) this.sendT.set(m.send);
      this.bank.set(m.bands);
    } else if (m.type === 'fade') this.fades[m.deck].start(m);
    else if (m.type === 'set') this.fades[m.deck].rest(m.value);
    else if (m.type === 'hold') this.fades[m.deck].rest();
    else if (m.type === 'rg') this.rgT[m.deck] = m.value;
    else if (m.type === 'ping') this.port.postMessage({type: 'pong', id: m.id});
  }

  /** Frame of the first audible sample of a deck input in this block, or -1. */
  onset(input, n) {
    for (let c = 0; c < input.length; c++) {
      const x = input[c];
      for (let i = 0; i < n; i++) if (x[i] > SILENT || x[i] < -SILENT) return i;
    }
    return -1;
  }

  process(inputs, outputs) {
    const out = outputs[0], n = out[0].length;
    if (this.wl.length < n) { this.wl = new Float64Array(n); this.wr = new Float64Array(n); }
    const wl = this.wl, wr = this.wr;
    wl.fill(0, 0, n); wr.fill(0, 0, n);
    // Fades that wait: this deck's audio, or the other deck's sound, starts them (or the timeout).
    for (let d = 0; d < 2; d++) {
      const f = this.fades[d];
      f.began = -1;
      if (f.wait === 1) {
        const at = inputs[d]?.length ? this.onset(inputs[d], n) : -1;
        if (at >= 0 || (f.left -= n) <= 0) {
          f.wait = 0;
          f.began = Math.max(0, at);
          f.sounded = true;
          // Sounding from the first frame after the message: the gain was never held, so it turns on from its slope.
          if (!f.waited && at === 0) f.v0 = f.vStart;
        } else f.waited += n;
      }
    }
    for (let d = 0; d < 2; d++) {
      const f = this.fades[d];
      if (f.wait !== 2) continue;
      const o = this.fades[f.other];
      if (o.sounded || (f.left -= n) <= 0) {
        f.wait = 0;
        f.began = o.began >= 0 ? o.began : 0;
        if (!f.waited && !f.began) f.v0 = f.vStart;
        if (f.keepEnd) {
          f.len = Math.max(MIN_FADE, f.len - f.waited - f.began);
          f.shorten();
        }
      } else f.waited += n;
    }
    for (let d = 0; d < 2; d++) {
      const input = inputs[d], f = this.fades[d];
      const il = input?.[0], ir = input?.[1] ?? il;
      let rg = this.rg[d];
      const rgT = this.rgT[d];
      for (let i = 0; i < n; i++) {
        rg += (rgT - rg) * GLIDE;
        if (f.wait === 0 && f.pos < f.len && i >= (f.began < 0 ? 0 : f.began)) {
          f.pos++;
          const x = f.pos / f.len;
          const v = f.pos >= f.len ? f.to : f.v0 ? hermite(f.from, f.v0 * f.len, f.to, x) : f.from + (f.to - f.from) * shape(f.curve, x, f.to > f.from);
          f.vel = f.pos >= f.len ? 0 : v - f.value;
          f.value = v;
          if (f.pos >= f.len) this.port.postMessage({type: 'done', id: f.id});
        }
        if (il) { const g = rg * f.value; wl[i] += il[i] * g; wr[i] += ir[i] * g; }
      }
      this.rg[d] = rg;
      f.began = -1;
    }
    // Preamp, equalizer, then the stereo matrix.
    let pre = this.pre;
    const preT = this.preT;
    for (let i = 0; i < n; i++) { pre += (preT - pre) * GLIDE; wl[i] *= pre; wr[i] *= pre; }
    this.pre = pre;
    this.bank.process(wl, wr, n);
    const m = this.m, t = this.mT, ol = out[0], or = out[1] ?? out[0];
    for (let i = 0; i < n; i++) {
      m[0] += (t[0] - m[0]) * GLIDE; m[1] += (t[1] - m[1]) * GLIDE; m[2] += (t[2] - m[2]) * GLIDE; m[3] += (t[3] - m[3]) * GLIDE;
      const l = wl[i], r = wr[i];
      ol[i] = m[0] * l + m[1] * r;
      or[i] = m[2] * l + m[3] * r;
    }
    // The reverb sends: the output, each faded by its own gain.
    for (let k = 0; k < 2; k++) {
      const so = outputs[1 + k];
      if (!so?.length) continue;
      let g = this.send[k];
      const gT = this.sendT[k];
      if (g === 0 && gT === 0) continue;
      const sl = so[0], sr = so[1] ?? so[0];
      for (let i = 0; i < n; i++) { g += (gT - g) * GLIDE; if (Math.abs(gT - g) < 1e-7) g = gT; sl[i] = ol[i] * g; sr[i] = or[i] * g; }
      this.send[k] = g;
    }
    return true;
  }
}

class OutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.limiter = new TruePeakLimiter(sampleRate);
    this.g = new Float64Array([1, 0, 0, 1]); this.gT = new Float64Array([1, 0, 0, 1]);
    this.wl = new Float64Array(128); this.wr = new Float64Array(128);
    this.frames = 0;
    this.period = Math.round(sampleRate / 10);
    this.port.onmessage = e => {
      const m = e.data;
      if (m.type === 'state') { this.gT[0] = m.dry; this.gT[1] = m.wet[0]; this.gT[2] = m.wet[1]; this.gT[3] = m.volume; this.limiter.enabled = m.limiter; }
      else if (m.type === 'ping') this.port.postMessage({type: 'pong', id: m.id});
    };
  }

  process(inputs, outputs) {
    const out = outputs[0], n = out[0].length;
    if (this.wl.length < n) { this.wl = new Float64Array(n); this.wr = new Float64Array(n); }
    const wl = this.wl, wr = this.wr, g = this.g, t = this.gT;
    const d = inputs[0], a = inputs[1], b = inputs[2];
    const dl = d?.[0], dr = d?.[1] ?? dl, al = a?.[0], ar = a?.[1] ?? al, bl = b?.[0], br = b?.[1] ?? bl;
    for (let i = 0; i < n; i++) {
      g[0] += (t[0] - g[0]) * GLIDE; g[1] += (t[1] - g[1]) * GLIDE; g[2] += (t[2] - g[2]) * GLIDE; g[3] += (t[3] - g[3]) * GLIDE;
      let l = dl ? dl[i] * g[0] : 0, r = dr ? dr[i] * g[0] : 0;
      if (al) { l += al[i] * g[1]; r += ar[i] * g[1]; }
      if (bl) { l += bl[i] * g[2]; r += br[i] * g[2]; }
      wl[i] = l * g[3]; wr[i] = r * g[3];
    }
    this.limiter.process(wl, wr, out[0], out[1] ?? out[0], n);
    this.frames += n;
    if (this.frames >= this.period) {
      const m = this.limiter.meter();
      this.port.postMessage({type: 'meter', frames: this.frames, gain: this.limiter.applied, ...m});
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor('cp-eq', EqProcessor);
registerProcessor('cp-out', OutProcessor);
