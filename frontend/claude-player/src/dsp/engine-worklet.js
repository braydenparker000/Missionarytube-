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
// - Gapless: each deck plays through a ring buffer whose mix point trails
//   the newest sample by LA frames, so the end of a track is seen before it
//   is heard. The next track starts early on the other deck, held (filling
//   its ring, not heard); when the outgoing deck's input has gone exactly
//   silent for ZERO_RUN frames at or after its expected end, the held deck
//   is mixed from its first sound on the frame after the outgoing track's
//   last sample, and plays on delayed by however early it started (the
//   player knows the delay; a pause or seek flushes it). A track resampled
//   to the output's rate begins and ends with the resampler's ringing; the
//   player gives its length for each track, and where a track's edge is that
//   ringing (its outermost sample tiny, not an abrupt cut), the two overlap
//   by about it (searched for the smoothest sum), adding up to the
//   continuous signal. Leading digital silence of the next track (its start
//   minus the decks' start latency, learned from recent starts) is put back.
//   A flush fades out what was about to be heard, so it never clicks.
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
// Gapless: the exact silence that ends a track (frames), the most the next track may overlap
// it (resampler ringing), the lookahead, the ring's length, how early the outgoing track may
// end (its trailing silence beyond that is kept), a deck's start latency before one is seen
// (high: until learned, a little leading silence may be lost, but no silence is added), how
// many recent starts it is learned from, the least leading silence put back (shorter is start
// jitter), and a flush's fade-out.
const ZERO_RUN = 128, OVERLAP_MAX = 192, LA = ZERO_RUN + OVERLAP_MAX;
const CAP = Math.round(sampleRate * 2.5), END_TOL = Math.round(sampleRate * 0.12);
const START_LATENCY = Math.round(sampleRate * 0.25), STARTS = 8, PAD_MIN = Math.round(sampleRate * 0.15);
const FLUSH_FADE = Math.round(sampleRate * 0.008);
// A track's outermost sample under this is resampler ringing (an abrupt cut is a sample of the signal);
// the frames either side of the ringing's modelled length searched for the smoothest join.
const RING_EDGE = 1e-3, RING_SEARCH = 6;
const DIRECT = 0, HELD = 1, DELAYED = 2;

/** A deck's ring: every input frame is written; the mix reads `delay` frames behind the newest. */
class Ring {
  constructor() {
    this.L = new Float32Array(CAP);
    this.R = new Float32Array(CAP);
    // Frames written so far (absolute); the newest is at w - 1. Frames before `start` are silence.
    this.w = 0;
    this.start = 0;
    this.delay = LA;
    this.mode = DIRECT;
    // Held: where the splice message found it, and its first audible frame (absolute).
    this.armAt = -1;
    this.onsetAt = -1;
    // A flush's fade-out (gains applied): frames tAt..tN still to be heard.
    this.tL = new Float32Array(FLUSH_FADE);
    this.tR = new Float32Array(FLUSH_FADE);
    this.tN = this.tAt = 0;
  }

  reset() {
    this.mode = DIRECT;
    this.delay = LA;
    this.armAt = this.onsetAt = -1;
  }

  /**
   * Nothing left to play: the deck goes on from its next input frame. What
   * was about to be heard (none while held) fades out over FLUSH_FADE, at the
   * deck's gain now, joining what is left of an earlier flush's fade-out. At
   * a track's end (`end`), what is left of the track is heard as it is when
   * silence follows it within FLUSH_FADE.
   */
  clear(gain, end = false) {
    const left = this.tN - this.tAt, mix = this.w - this.delay;
    let f = this.mode === HELD ? 0 : Math.min(FLUSH_FADE, this.delay), fade = true;
    if (end && f > 0) {
      let last = this.w - 1;
      while (last >= mix && (last < this.start || (this.L[last % CAP] === 0 && this.R[last % CAP] === 0))) last--;
      if (last < mix + f) { f = Math.max(0, last - mix + 1); fade = false; }
    }
    const n = Math.max(left, f);
    for (let j = 0; j < n; j++) {
      let l = j < left ? this.tL[this.tAt + j] : 0, r = j < left ? this.tR[this.tAt + j] : 0;
      const at = mix + j;
      if (j < f && at >= this.start) {
        const k = at % CAP, g = fade ? gain * (0.5 + 0.5 * Math.cos(Math.PI * (j + 1) / (f + 1))) : gain;
        l += this.L[k] * g;
        r += this.R[k] * g;
      }
      this.tL[j] = l;
      this.tR[j] = r;
    }
    this.tN = n;
    this.tAt = 0;
    this.reset();
    this.start = this.w;
  }
}

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
    this.rings = [new Ring(), new Ring()];
    // Each deck's samples at its mix point for the current block.
    this.ml = [new Float32Array(128), new Float32Array(128)];
    this.mr = [new Float32Array(128), new Float32Array(128)];
    this.clock = 0;
    // The armed splice: {id, from, to, endAt (absolute frame), ringFrom / ringTo (resampler ringing, frames),
    // zero (silent frames in a row), lastAt (the outgoing track's last sound, absolute frame)}.
    this.splice = null;
    // The decks' recent start latencies (frames).
    this.starts = new Float64Array(STARTS);
    this.startN = 0;
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
    else if (m.type === 'splice') {
      // endIn: seconds until the outgoing track's end is heard (its delay included), so it reaches the watch point then.
      const b = this.rings[m.deck];
      b.reset();
      b.mode = HELD;
      b.armAt = b.w;
      const ring = x => Math.max(0, Math.min(OVERLAP_MAX / 2, Math.round(x) || 0));
      this.splice = {id: m.id, from: m.from, to: m.deck, endAt: this.clock + Math.round(m.endIn * sampleRate), ringFrom: ring(m.ringFrom), ringTo: ring(m.ringTo), zero: 0, lastAt: -1};
    } else if (m.type === 'flush') {
      // Also a splice no longer wanted (the held deck is silent: nothing fades out).
      if (this.splice?.to === m.deck) this.splice = null;
      this.rings[m.deck].clear(this.rg[m.deck] * this.fades[m.deck].value, !!m.end);
    } else if (m.type === 'ping') this.port.postMessage({type: 'pong', id: m.id});
  }

  /**
   * Writes a block of deck d's input into its ring, and fills ml / mr with
   * its samples at the mix point (silence while held).
   */
  ring(d, input, n) {
    const g = this.rings[d], il = input?.[0], ir = input?.[1] ?? il, L = g.L, R = g.R, w0 = g.w;
    for (let i = 0; i < n; i++) {
      const k = (w0 + i) % CAP;
      L[k] = il ? il[i] : 0;
      R[k] = ir ? ir[i] : 0;
      // A held deck's first sound: its first frame that is not exactly silent (a paused deck gives exact zeros).
      if (g.mode === HELD && g.onsetAt < 0 && (L[k] !== 0 || R[k] !== 0)) g.onsetAt = w0 + i;
    }
    g.w = w0 + n;
  }

  /** Deck d's mix samples for this block (silence while held, and before the ring's start). */
  mix(d, n) {
    const g = this.rings[d], ml = this.ml[d], mr = this.mr[d];
    for (let i = 0; i < n; i++) {
      const at = g.w - n + i - g.delay;
      if (g.mode === HELD || at < g.start) { ml[i] = mr[i] = 0; continue; }
      const k = at % CAP;
      ml[i] = g.L[k];
      mr[i] = g.R[k];
    }
  }

  /** Adds what is left of deck d's flush fade-out to the block (after its gain: the fade-out carries the gain it had). */
  tail(d, wl, wr, n) {
    const g = this.rings[d], m = Math.min(n, g.tN - g.tAt);
    for (let i = 0; i < m; i++) { wl[i] += g.tL[g.tAt + i]; wr[i] += g.tR[g.tAt + i]; }
    g.tAt += Math.max(0, m);
  }

  /**
   * The armed splice: watches the outgoing deck LA frames ahead of its mix
   * point; returns the frame of this block after which its track has been
   * silent for ZERO_RUN frames (its last sound is then heard OVERLAP_MAX
   * frames later), or -1.
   */
  findSplice(n) {
    const s = this.splice, a = this.rings[s.from], b = this.rings[s.to];
    // The held deck has filled its ring without the outgoing track ending: give up (the player starts it as usual).
    if (b.w - b.armAt > CAP - 4 * n) {
      this.port.postMessage({type: 'splice_failed', deck: s.to, id: s.id});
      this.splice = null;
      return -1;
    }
    const d = a.delay - LA, w0 = a.w - n;
    for (let i = 0; i < n; i++) {
      const k = ((w0 + i - d) % CAP + CAP) % CAP;
      s.zero = a.L[k] === 0 && a.R[k] === 0 ? s.zero + 1 : 0;
      if (s.zero >= ZERO_RUN && this.clock + i >= s.endAt - END_TOL) { s.lastAt = w0 + i - d - ZERO_RUN; return i + 1; }
    }
    return -1;
  }

  /**
   * The outgoing track has been silent since OVERLAP_MAX frames after frame
   * `from` of this block. The held deck's track begins where its deck
   * started (the splice message plus the decks' start latency, the shortest
   * of the recent starts): so a leading silence is kept, also one still
   * going on. A first sound within PAD_MIN of that is start jitter, and the
   * track begins with it: exactly after the outgoing track's last frame, or
   * before it by the ringing of the edges that ring (the two add up).
   */
  join(n, from) {
    const s = this.splice, b = this.rings[s.to];
    if (b.onsetAt >= 0) this.starts[this.startN++ % STARTS] = b.onsetAt - b.armAt;
    let latency = START_LATENCY;
    if (this.startN) { latency = Infinity; for (let i = 0; i < Math.min(this.startN, STARTS); i++) latency = Math.min(latency, this.starts[i]); }
    let begin = b.armAt + latency, overlap = 0;
    if (b.onsetAt >= 0 && b.onsetAt - begin < PAD_MIN) {
      begin = b.onsetAt;
      if (Math.abs(b.L[begin % CAP]) < RING_EDGE && Math.abs(b.R[begin % CAP]) < RING_EDGE) overlap += s.ringTo;
    }
    // The outgoing deck's last frames are its track's end, also when the player has let it go meanwhile (a flush at
    // its end keeps the splice; they play from the flush's tail, at the same time).
    const a = this.rings[s.from];
    if (Math.abs(a.L[s.lastAt % CAP]) < RING_EDGE && Math.abs(a.R[s.lastAt % CAP]) < RING_EDGE) overlap += s.ringFrom;
    if (overlap) overlap = this.smoothest(a, s.lastAt, b, begin, overlap);
    // The mix reads the track's beginning at that frame (frames before it are silence); never closer than LA to the newest frame.
    b.delay = Math.max(LA, (b.w - n + from + OVERLAP_MAX - overlap) - begin);
    b.start = begin;
    b.mode = DELAYED;
    this.splice = null;
    this.port.postMessage({type: 'spliced', deck: s.to, id: s.id, delay: (b.delay - LA) / sampleRate, pad: b.onsetAt >= 0 ? Math.max(0, b.onsetAt - begin) / sampleRate : null, overlap});
    return s.to;
  }

  /**
   * The overlap near `k` (the ringing's modelled length; each resampler's
   * phase moves it by a frame or so) whose sum of the outgoing track's end
   * (last sound at a's frame `last`) and the next one's start (b from
   * `begin`) bends least: misaligned, their ringing leaves a click.
   */
  smoothest(a, last, b, begin, k) {
    let best = k, least = Infinity;
    const lo = Math.max(1, k - RING_SEARCH), hi = Math.min(OVERLAP_MAX, k + RING_SEARCH);
    // The next track's frames needed must have arrived (and the outgoing track's exist).
    if (begin + hi + 18 > b.w || last - hi - 18 < 0) return k;
    for (let d = lo; d <= hi; d++) {
      let e = 0, p1l = 0, p1r = 0, p2l = 0, p2r = 0;
      // One window for all: from before the longest overlap's start to after the outgoing track's end.
      for (let n = last - hi - 18, j = 0; n <= last + 17; n++, j++) {
        const m = begin + n - (last + 1 - d), ia = n <= last ? n % CAP : -1, ib = m >= begin ? m % CAP : -1;
        const l = (ia >= 0 ? a.L[ia] : 0) + (ib >= 0 ? b.L[ib] : 0), r = (ia >= 0 ? a.R[ia] : 0) + (ib >= 0 ? b.R[ib] : 0);
        if (j >= 2) { const dl = l - 2 * p1l + p2l, dr = r - 2 * p1r + p2r; e += dl * dl + dr * dr; }
        p2l = p1l; p2r = p1r; p1l = l; p1r = r;
      }
      if (e < least) { least = e; best = d; }
    }
    return best;
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
    if (this.wl.length < n) {
      this.wl = new Float64Array(n); this.wr = new Float64Array(n);
      for (let d = 0; d < 2; d++) { this.ml[d] = new Float32Array(n); this.mr[d] = new Float32Array(n); }
      this.mixes = null;
    }
    const wl = this.wl, wr = this.wr;
    wl.fill(0, 0, n); wr.fill(0, 0, n);
    // The decks' rings, the splice, and each deck's samples at its mix point.
    for (let d = 0; d < 2; d++) this.ring(d, inputs[d], n);
    const from = this.splice ? this.findSplice(n) : -1;
    if (from >= 0) this.join(n, from);
    for (let d = 0; d < 2; d++) this.mix(d, n);
    const mixes = this.mixes ??= [[this.ml[0], this.mr[0]], [this.ml[1], this.mr[1]]];
    // Fades that wait: this deck's audio, or the other deck's sound, starts them (or the timeout).
    for (let d = 0; d < 2; d++) {
      const f = this.fades[d];
      f.began = -1;
      if (f.wait === 1) {
        const at = this.onset(mixes[d], n);
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
      const f = this.fades[d], il = this.ml[d], ir = this.mr[d];
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
      this.tail(d, wl, wr, n);
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
    this.clock += n;
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
