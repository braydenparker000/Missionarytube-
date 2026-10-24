// Audio lab scenarios: each suspect as a scripted session on the real chain.
// The player starts the first track at 0 s (with its play fade-in); actions
// run at render times. Click tests play a 440 Hz tone at -12 dBFS and read
// the output above 3 kHz, where only steps and cuts leave energy (about
// -145 dBFS floor; a 15 ms ramp reads near -86 dBFS, a gain step -50 dBFS).
// The hot signal is a synthetic loud master whose decoded sample peaks reach
// +3 dBFS, as most of the library's Opus files do.

const TONE = {kind: 'tone', hz: 440, db: -12};
const THREE = {main: TONE, next: {kind: 'tone', hz: 330, db: -12, edgeMs: 5}, third: {kind: 'tone', hz: 550, db: -12, edgeMs: 5}};
const HOT = {kind: 'hot', peakDb: 3, seed: 7};
const AT = 1.5;

/** Steps of a knob drag: `n` values from a to b, every `ms` from `at`. */
const drag = (at, n, ms, a, b, run) => Array.from({length: n}, (_, i) => ({at: at + (i * ms) / 1000, run: lab => run(lab, a + ((b - a) * i) / (n - 1))}));

const PARAM_PRESET = {name: 'Lab parametric', preamp: -3, bands: [{type: 3, frequency: 440, q: 1, gain: 0.4}, {type: 4, frequency: 120, q: 0.7, gain: 0.3}, {type: 5, frequency: 8000, q: 0.7, gain: 0.2}]};
const BASS_BOOST = {name: 'Lab bass', params: {31: 0.8, 62: 0.8, 125: 0.6, 250: 0.3, 500: 0, '1K': 0, '2K': 0, '4K': 0, '8K': 0.1, '16K': 0.1}};

const click = (title, suspect, actions, extra = {}) => ({
  group: 'clicks', title, suspect, duration: 2.6, signal: TONE,
  actions: typeof actions === 'function' ? [{at: AT, run: actions}] : actions,
  measure: lab => lab.clicks(AT - 0.02, 2.5),
  ...extra,
});

const hot = (title, suspect, extra = {}) => ({
  group: 'clipping', title, suspect, duration: 4, signal: HOT,
  measure: lab => lab.peaks(0.5, 4),
  ...extra,
});

export const SCENARIOS = {
  // Unramped changes: parameter edits and graph rebuilds while a tone plays.
  'limiter-off': click('Limiter switched off', 'unramped topology change', lab => lab.dsp.set('dsp_limiter_enabled', false)),
  'limiter-on': click('Limiter switched on', 'unramped topology change', lab => lab.dsp.set('dsp_limiter_enabled', true), {dsp: {dsp_limiter_enabled: false}}),
  'dsp-off': click('DSP switched off', 'unramped topology change', lab => lab.dsp.set('dsp_enabled', false)),
  'eq-off': click('EQ switched off (+6 dB at 500 Hz)', 'ramped parameter', lab => lab.dsp.set('dsp_eq_enabled', false), {before: lab => { lab.dsp.bands[4].gain = 0.4; }}),
  'graphic-preset': click('Graphic preset loaded', 'ramped parameters', lab => lab.dsp.applyPreset(BASS_BOOST)),
  'param-preset': click('Parametric preset loaded', 'band graph rebuilt', lab => lab.dsp.applyParamPreset(PARAM_PRESET)),
  'param-lock': click('Parametric band locked', 'band graph rebuilt', lab => lab.dsp.lockParamBands(true, [lab.dsp.pbands[0].serial]), {before: lab => lab.dsp.applyParamPreset(PARAM_PRESET)}),
  'param-drag': click('Parametric band gain dragged', 'filter swapped per step', drag(AT, 30, 16, 0.4, -0.4, (lab, g) => lab.dsp.setParamBand(0, 'gain', g)), {before: lab => lab.dsp.applyParamPreset(PARAM_PRESET)}),
  'param-drag-lag': click('Parametric drag, main thread 10.7 ms behind', 'cross-fade scheduled in the past', drag(AT, 30, 16, 0.4, -0.4, (lab, g) => lab.dsp.setParamBand(0, 'gain', g)), {before: lab => lab.dsp.applyParamPreset(PARAM_PRESET), media: {lagMs: 10.7}}),
  'graphic-drag': click('Graphic band (500 Hz) dragged', 'automated biquad gain', drag(AT, 30, 16, 0.4, -0.4, (lab, g) => lab.dsp.setBand(4, g))),
  'bass-drag': click('Bass knob dragged (100 Hz tone)', 'shelf filter swapped per step', drag(AT, 30, 16, 0, 1, (lab, v) => lab.dsp.set('dsp_bass_gain', v)), {signal: {kind: 'tone', hz: 100, db: -12}, clickHz: 1500, dsp: {dsp_tone_enabled: true}}),
  'bass-drag-lag': click('Bass drag, main thread 10.7 ms behind', 'cross-fade scheduled in the past', drag(AT, 30, 16, 0, 1, (lab, v) => lab.dsp.set('dsp_bass_gain', v)), {signal: {kind: 'tone', hz: 100, db: -12}, clickHz: 1500, dsp: {dsp_tone_enabled: true}, media: {lagMs: 10.7}}),
  'bands-relayout': click('Band count 10 -> 15', 'band graph rebuilt', lab => lab.ctx.setPref('equ_bands_num', '15'), {before: lab => { lab.dsp.bands[4].gain = 0.3; }}),
  'reverb-on': click('Reverb switched on', 'convolver buffer swap', lab => lab.dsp.set('dsp_reverb_enabled', true)),
  'reverb-size': click('Reverb size changed while on', 'convolver buffer swap', lab => lab.dsp.set('dsp_reverb_param1', 0.8), {dsp: {dsp_reverb_enabled: true}}),
  'volume-change': click('Volume 100% -> 50%', 'ramped parameter', lab => lab.dsp.set('dsp_master_volume', 0.5)),
  'balance-change': click('Balance to 25% (left)', 'ramped parameter', lab => lab.dsp.set('dsp_balance', 0.25)),
  'mono-on': click('Mono switched on', 'ramped parameter', lab => lab.dsp.set('dsp_mono_enabled', true)),
  'replaygain-change': click('ReplayGain preamp +6 dB', 'ramped parameter', lab => lab.ctx.setPref('rg_preamp_mb', 600), {prefs: {rg_type: 1}, tracks: [{name: 'main', meta: {replayGain: {track: -6}}}]}),

  // Fades: the player's pause, resume, seek and track changes.
  'pause-fade': click('Pause (400 ms fade)', 'fade then cut', lab => lab.player.pause(), {measure: lab => ({...lab.clicks(AT - 0.02, 2.5), ...prefix('after', lab.level(2.05, 2.5))})}),
  'pause-fade-lag': click('Pause, main thread 10.7 ms behind', 'fade then cut', lab => lab.player.pause(), {media: {lagMs: 10.7}}),
  'resume-fade': click('Resume after pause (30 ms to restart)', 'fade starts before audio', [{at: 1.2, run: lab => lab.player.pause()}, {at: 2.0, run: lab => lab.player.play()}], {duration: 3, media: {resumeMs: 30}, measure: lab => lab.clicks(1.98, 2.9, {floor: [0.8, 1.18]})}),
  'seek-fade': click('Seek, local file (20 ms)', 'fade around the jump', lab => lab.player.seek(9001), {signal: {...TONE, seconds: 20}, media: {seekMs: 20}}),
  'seek-fade-network': click('Seek, streamed (250 ms)', 'fade-in ends before audio returns', lab => lab.player.seek(9001), {signal: {...TONE, seconds: 20}, media: {seekMs: 250}}),
  'seek-no-fade': click('Seek with fade_seek off', 'cut and restart', lab => lab.player.seek(9001), {signal: {...TONE, seconds: 20}, prefs: {fade_seek: false}}),
  'play-in-pause-fade': click('Play 5 ms after pause, play/pause fades off', 'gain set while the de-click fade runs', [{at: AT, run: lab => lab.player.pause()}, {at: AT + 256 / 48000, run: lab => lab.player.play()}], {prefs: {fade_play_pause: false}}),
  'next-xfade': {
    group: 'fades', title: 'Next track, short cross-fade (local)', suspect: 'cross-fade summing',
    duration: 3, signals: {main: TONE, next: {kind: 'tone', hz: 330, db: -12, edgeMs: 5}}, tracks: [{name: 'main'}, {name: 'next'}],
    actions: [{at: AT, run: lab => lab.player.step(1)}],
    measure: lab => ({...lab.clicks(AT - 0.02, 2.9), ...crossfade(lab, AT, AT)}),
  },
  'next-xfade-network': {
    group: 'fades', title: 'Next track, short cross-fade (300 ms to first audio)', suspect: 'fade-in ends before audio',
    duration: 3, signals: {main: TONE, next: {kind: 'tone', hz: 330, db: -12, edgeMs: 5}}, tracks: [{name: 'main'}, {name: 'next'}], media: {loadMs: 300},
    actions: [{at: AT, run: lab => lab.player.step(1)}],
    measure: lab => ({...lab.clicks(AT - 0.02, 2.9), ...crossfade(lab, AT, AT + 0.3)}),
  },
  'next-twice': {
    group: 'fades', title: 'Next pressed twice 150 ms apart, short cross-fade (300 ms to first audio)', suspect: 'outgoing deck reused while sounding',
    duration: 3, signals: THREE, tracks: [{name: 'main'}, {name: 'next'}, {name: 'third'}], media: {loadMs: 300},
    actions: [{at: AT, run: lab => lab.player.step(1)}, {at: AT + 0.15, run: lab => lab.player.step(1)}],
    // The first track plays on until the third sounds (300 ms after the second press).
    measure: lab => ({...lab.clicks(AT - 0.02, 2.9), waitDb: lab.toneDb(440, AT + 0.3, AT + 0.34), ...crossfade(lab, AT + 0.15, AT + 0.45, 550)}),
  },
  'next-twice-no-fade': {
    group: 'fades', title: 'Next pressed twice 150 ms apart, manual fades off (300 ms to first audio)', suspect: 'outgoing deck reused while sounding',
    duration: 3, signals: THREE, tracks: [{name: 'main'}, {name: 'next'}, {name: 'third'}], media: {loadMs: 300}, prefs: {fade_manual_advance: 0},
    actions: [{at: AT, run: lab => lab.player.step(1)}, {at: AT + 0.15, run: lab => lab.player.step(1)}],
    measure: lab => lab.clicks(AT - 0.02, 2.9),
  },
  'next-no-fade': {
    group: 'fades', title: 'Next track, manual fades off (8 ms de-click)', suspect: 'equal-power corner',
    duration: 3, signals: {main: TONE, next: {kind: 'tone', hz: 330, db: -12, edgeMs: 5}}, tracks: [{name: 'main'}, {name: 'next'}], prefs: {fade_manual_advance: 0},
    actions: [{at: AT, run: lab => lab.player.step(1)}],
    measure: lab => lab.clicks(AT - 0.02, 2.9),
  },
  'pause-in-xfade': {
    group: 'fades', title: 'Pause during an automatic cross-fade', suspect: 'outgoing deck cut',
    duration: 3.5, signals: {main: {...TONE, seconds: 3.2, edgeMs: 5}, next: {kind: 'tone', hz: 330, db: -12, edgeMs: 5}}, tracks: [{name: 'main'}, {name: 'next'}],
    prefs: {crossfade_auto_advance: 2, crossfade_length_ms: 2000},
    actions: [{at: 2.2, run: lab => lab.player.pause()}],
    measure: lab => lab.clicks(2.18, 3.4),
  },
  'auto-xfade-late': autoLate('Automatic 2 s cross-fade into a cold track end, incoming 600 ms late', 600),
  'auto-xfade-later': autoLate('Automatic 2 s cross-fade into a cold track end, incoming 1.2 s late', 1200),
  'track-end-gap': {
    group: 'reliability', title: 'Track end to next track (no cross-fade, 300 ms to first audio)', suspect: 'no preload / gapless',
    duration: 3.5, signals: {main: {...TONE, seconds: 2, edgeMs: 5}, next: {...TONE, seconds: 4, edgeMs: 5}}, tracks: [{name: 'main', meta: {album: 'A', track: 1}}, {name: 'next', meta: {album: 'A', track: 2}}], media: {loadMs: 300},
    measure: lab => ({gapMs: silence(lab, 1.5, 3.5), ...lab.clicks(1.9, 3.4)}),
  },
  'auto-xfade-sum': {
    group: 'clipping', title: 'Automatic 3 s cross-fade of two hot masters', suspect: 'cross-fade summing',
    duration: 6, signals: {main: {...HOT, seconds: 4.2}, next: {...HOT, seed: 11, seconds: 6}}, tracks: [{name: 'main'}, {name: 'next'}],
    prefs: {crossfade_auto_advance: 2, crossfade_length_ms: 3000},
    measure: lab => ({...lab.peaks(0.5, 6), ...prefix('mid', lab.level(1.2, 4.2, 50))}),
  },

  // Gain staging: hot masters through the chain.
  'hot-default': hot('Hot master, default chain (limiter on)', 'compressor as limiter'),
  'hot-limiter-off': hot('Hot master, limiter off', 'no protection', {dsp: {dsp_limiter_enabled: false}}),
  'hot-bass-boost': hot('Hot master, bass-boost preset', 'EQ gain stacking', {before: lab => lab.dsp.applyPreset(BASS_BOOST)}),
  'hot-stacking': hot('Hot master, preamp +6 dB, bass tone, ReplayGain +6 dB', 'gain stacking', {dsp: {dsp_preamp: 0.625, dsp_tone_enabled: true, dsp_bass_gain: 0.5}, prefs: {rg_type: 1}, tracks: [{name: 'main', meta: {replayGain: {track: 6}}}]}),
  'width-max': hot('Side-only signal, stereo width 100%', 'stereo matrix gain', {signal: {kind: 'antiphase', hz: 440, db: -3}, dsp: {dsp_stereo_fx: 1}}),
  'balance-left': hot('Balance fully left (correlated tone at -3 dBFS)', 'StereoPanner sums channels', {signal: {kind: 'tone', hz: 440, db: -3}, dsp: {dsp_balance: 0}}),
  'reverb-full': hot('Hot master, reverb mix 100%', 'dry + wet summing', {dsp: {dsp_reverb_enabled: true, dsp_reverb_param5: 1}}),
  'limiter-level': {
    group: 'clipping', title: 'Quiet music (peaks -20 dBFS) through the limiter', suspect: 'compressor makeup gain and delay',
    duration: 2, signal: {...HOT, peakDb: -20},
    measure: lab => ({latencyFrames: lab.latency(), gainDb: lab.gainDb(1.0, 1.9)}),
  },
  'limiter-thd': {
    group: 'clipping', title: '50 Hz tone at +3 dBFS through the limiter', suspect: 'compressor distortion',
    duration: 3, signal: {kind: 'tone', hz: 50, db: 3},
    measure: lab => ({thdnDb: lab.thdn(50, 1.0, 2.9), ...lab.peaks(1.0, 2.9)}),
  },

  // Render cost (CPU) of configurations, 20 s each.
  'cost-default': cost('Default chain'),
  'cost-eq31': cost('31 graphic bands', {prefs: {equ_bands_num: '31'}}),
  'cost-param64': cost('64 parametric bands', {before: lab => lab.dsp.applyParamPreset({name: 'Lab 64', bands: Array.from({length: 64}, (_, i) => ({type: 3, frequency: Math.round(20 * Math.pow(1000, i / 63)), q: 2, gain: (i % 5 - 2) / 10}))})}),
  'cost-reverb': cost('Reverb on, largest size', {dsp: {dsp_reverb_enabled: true, dsp_reverb_param1: 1}}),
  'cost-reverb-after': cost('Reverb used, then switched off', {dsp: {dsp_reverb_enabled: true, dsp_reverb_param1: 1}, actions: [{at: 0.5, run: lab => lab.dsp.set('dsp_reverb_enabled', false)}]}),
  'cost-everything': cost('Tone, 31 bands, width, reverb', {prefs: {equ_bands_num: '31'}, dsp: {dsp_tone_enabled: true, dsp_bass_gain: 0.3, dsp_treble_gain: 0.3, dsp_stereo_fx: 0.5, dsp_reverb_enabled: true}}),
};

/**
 * An automatic 2 s cross-fade into a track that ends cold (no fade in the
 * music) with the incoming track late by loadMs: the outgoing fade still
 * ends with its track. The first track also takes loadMs to start.
 */
function autoLate(title, loadMs) {
  const len = 3.2 + 0.25 / 440, end = loadMs / 1000 + len;
  return {
    group: 'fades', title, suspect: 'outgoing fade waits past the track end', duration: 5,
    signals: {main: {...TONE, seconds: len}, next: {kind: 'tone', hz: 330, db: -12, edgeMs: 5}}, tracks: [{name: 'main'}, {name: 'next'}],
    prefs: {crossfade_auto_advance: 2, crossfade_length_ms: 2000}, media: {loadMs},
    measure: lab => ({outEndDb: lab.toneDb(440, end - 0.06, end - 0.01), ...lab.clicks(end - 0.05, end + 0.1, {floor: [0.8, 1.0]})}),
  };
}

function cost(title, extra = {}) {
  return {group: 'cost', title, suspect: 'render cost', duration: 20, signal: HOT, measure: () => ({}), ...extra};
}

/**
 * A 400 ms cross-fade from the 440 Hz track to the 330 Hz one: the incoming
 * track's level over its first 18 ms of audio (from `audible`) and both at
 * the fade's midpoint, in dB against full level. A linear fade from silence
 * reads about -33 dB at the start and -6 dB each at the midpoint.
 */
function crossfade(lab, start, audible, hz = 330) {
  const w = 2 / 110, mid = audible + 0.2 - w / 2;
  return {inStartDb: lab.toneDb(hz, audible, audible + w), inMidDb: lab.toneDb(hz, mid, mid + w), outMidDb: lab.toneDb(440, mid, mid + w)};
}

/** Keys of an object, prefixed (level ranges of several spans in one result). */
function prefix(p, o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k[0].toUpperCase() + k.slice(1), v]));
}

/** The longest run (ms) of 5 ms windows under -60 dBFS within [start, end). */
function silence(lab, start, end) {
  let run = 0, best = 0;
  const {env, ms} = lab.envelope ?? (lab.envelope = envelopeOf(lab));
  for (let i = Math.floor(start * 1000 / ms); i < Math.min(env.length, end * 1000 / ms); i++) {
    run = env[i] < 1e-3 ? run + ms : 0;
    best = Math.max(best, run);
  }
  return Math.round(best);
}

function envelopeOf(lab) {
  const ms = 5, win = Math.round(lab.rate * ms / 1000), n = Math.floor(lab.out[0].length / win), env = new Float32Array(n);
  for (let w = 0; w < n; w++) { let s = 0; for (let i = w * win; i < (w + 1) * win; i++) s += lab.out[0][i] ** 2 + lab.out[1][i] ** 2; env[w] = Math.sqrt(s / (2 * win)); }
  return {env, ms};
}
