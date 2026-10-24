// Playback diagnostics, shown on the reference's Audio Outputs Detection Log
// screen (settings audio_platform_log; ?diag opens it at start). Counters run
// for the whole session: the audio output the browser reports (rate,
// latency, state, underruns from AudioContext.playbackStats), the decks'
// network and decoder events (waiting, stalls, errors, buffered audio), the
// output level (peaks and clipping, metered from when the log is first
// shown), main-thread long tasks and visibility. "Copy report" puts the whole
// log on the clipboard as JSON, for checking playback on the phone itself.

const MAX_EVENTS = 300;
const DECK_EVENTS = ['loadstart', 'loadedmetadata', 'canplaythrough', 'playing', 'waiting', 'stalled', 'error', 'emptied', 'seeking', 'seeked', 'ended', 'abort'];
const MEDIA_ERRORS = {1: 'aborted', 2: 'network', 3: 'decode', 4: 'not supported'};
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
const db = x => (x > 0 ? round(20 * Math.log10(x), 1) : null);

export class PlaybackLog {
  constructor(ctx) {
    this.ctx = ctx;
    this.t0 = performance.now();
    this.startedAt = new Date().toISOString();
    this.events = [];
    this.decks = new Map();
    this.underruns = {events: 0, seconds: 0, at: []};
    this.longTasks = {count: 0, totalMs: 0, maxMs: 0};
    this.hidden = {count: 0, ms: 0, since: document.hidden ? performance.now() : null};
    this.level = null;
    this.context = null;
    ctx.playbackLog = this;
    for (const el of ctx.player?.decks ?? []) this.watchDeck(el);
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed' && !d?.meta) this.log('track', this.trackInfo(ctx.player?.track));
      else if (msg === 'msg_player_playing_state_changed') { this.log(d?.playing ? 'play' : 'pause'); this.follow(); }
    });
    document.addEventListener('visibilitychange', () => {
      const now = performance.now();
      if (document.hidden) { this.hidden.count++; this.hidden.since = now; } else if (this.hidden.since !== null) { this.hidden.ms += now - this.hidden.since; this.hidden.since = null; }
      this.log(document.hidden ? 'hidden' : 'visible');
    });
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          this.longTasks.count++;
          this.longTasks.totalMs += e.duration;
          this.longTasks.maxMs = Math.max(this.longTasks.maxMs, e.duration);
          if (e.duration >= 200) this.log('long task', {ms: Math.round(e.duration)});
        }
      }).observe({type: 'longtask', buffered: false});
    } catch { /* no long task timing */ }
  }

  /** Session time (ms) of an event. */
  now() { return Math.round(performance.now() - this.t0); }

  log(type, data) {
    this.events.push({t: this.now(), type, ...data});
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  watchDeck(el) {
    const d = {index: this.decks.size, waits: 0, waitMs: 0, waitAt: null, stalls: 0, errors: 0, lastError: null, loadAt: null, startMs: [], seekMs: [], seekAt: null};
    this.decks.set(el, d);
    for (const type of DECK_EVENTS) el.addEventListener(type, () => this.deckEvent(el, d, type));
  }

  deckEvent(el, d, type) {
    const now = performance.now();
    const current = el === this.ctx.player?.audio;
    if (type === 'loadstart') d.loadAt = now;
    else if (type === 'playing') {
      if (d.loadAt !== null) { d.startMs.push(Math.round(now - d.loadAt)); d.loadAt = null; }
      if (d.waitAt !== null) { d.waitMs += now - d.waitAt; d.waitAt = null; }
    } else if (type === 'waiting') {
      // A wait while playing is a buffer underrun (the network or decoder fell behind).
      if (d.loadAt === null && d.seekAt === null) { d.waits++; d.waitAt = now; }
    } else if (type === 'stalled') d.stalls++;
    else if (type === 'seeking') d.seekAt = now;
    else if (type === 'seeked' && d.seekAt !== null) { d.seekMs.push(Math.round(now - d.seekAt)); d.seekAt = null; }
    else if (type === 'error') {
      d.errors++;
      d.lastError = {code: el.error?.code ?? 0, kind: MEDIA_ERRORS[el.error?.code] ?? 'unknown', message: String(el.error?.message ?? '').slice(0, 160)};
    }
    for (const k of ['startMs', 'seekMs']) if (d[k].length > 50) d[k].splice(0, d[k].length - 50);
    if (type === 'canplaythrough' || type === 'loadedmetadata' || type === 'seeking' || type === 'seeked') return;
    if (type !== 'playing' || current) this.log(type, {deck: d.index, ...(type === 'error' ? d.lastError : {}), ...(type === 'waiting' ? {at: round(el.currentTime, 2)} : {})});
  }

  trackInfo(t) {
    if (!t) return {};
    const src = String(t.src ?? '');
    return {format: t.format || '', kbps: t.bitrate || 0, rate: t.sampleRate || 0, channels: t.channels || 0, source: src.startsWith('blob:') ? 'cached' : /^https?:/.test(src) ? 'stream' : src ? 'local' : 'library'};
  }

  /** Samples the audio context (state changes, underruns) while playing, every second. */
  follow() {
    const playing = this.ctx.player?.state === 1;
    if (playing && !this.timer) this.timer = setInterval(() => this.sample(), 1000);
    else if (!playing && this.timer && !this.screen) { clearInterval(this.timer); this.timer = null; }
    this.sample();
  }

  sample() {
    const ac = this.ctx.dsp?.ac;
    if (ac && this.context?.ac !== ac) {
      this.context = {ac, states: []};
      const state = () => { this.context.states.push({t: this.now(), state: ac.state}); this.log('context ' + ac.state); };
      ac.addEventListener?.('statechange', state);
      ac.addEventListener?.('error', () => this.log('context error'));
      state();
    }
    const stats = ac?.playbackStats;
    if (stats) {
      const n = stats.underrunEvents, s = stats.underrunDuration;
      if (n > this.underruns.events) {
        this.log('underrun', {count: n - this.underruns.events, ms: Math.round((s - this.underruns.seconds) * 1000)});
        this.underruns.at.push(this.now());
        if (this.underruns.at.length > 100) this.underruns.at.shift();
      }
      this.underruns.events = n;
      this.underruns.seconds = s;
    }
  }

  /**
   * Output level: two analysers on the master output, read 20 times a second
   * while the page is visible (each read covers the last 43 ms, so nearly
   * every sample is seen). Peaks above full scale clip in the phone's mixer.
   */
  startLevel() {
    const dsp = this.ctx.dsp, ac = dsp?.ac, out = dsp?.nodes?.volume;
    if (this.level || !ac || !out) return;
    const split = ac.createChannelSplitter(2), an = [ac.createAnalyser(), ac.createAnalyser()];
    out.connect(split);
    an.forEach((a, i) => { a.fftSize = 2048; split.connect(a, i); });
    const buf = new Float32Array(2048);
    const level = this.level = {since: this.now(), peak: 0, clippedReads: 0, reads: 0, recentPeak: 0, recent: []};
    level.timer = setInterval(() => {
      if (document.hidden || this.ctx.player?.state !== 1) return;
      let peak = 0;
      for (const a of an) { a.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; } }
      level.reads++;
      if (peak > 1) level.clippedReads++;
      level.peak = Math.max(level.peak, peak);
      level.recent.push(peak);
      if (level.recent.length > 200) level.recent.shift();
    }, 50);
  }

  snapshot() {
    const ac = this.ctx.dsp?.ac, stats = ac?.playbackStats, dsp = this.ctx.dsp;
    const deck = [...this.decks].map(([el, d]) => ({
      index: d.index, current: el === this.ctx.player?.audio, readyState: el.readyState, networkState: el.networkState, paused: el.paused,
      bufferedAhead: round(ahead(el), 1), waits: d.waits, waitSeconds: round(d.waitMs / 1000, 1), stalls: d.stalls, errors: d.errors, lastError: d.lastError,
      startMs: d.startMs.slice(-10), seekMs: d.seekMs.slice(-10),
    }));
    const hiddenMs = this.hidden.ms + (this.hidden.since !== null ? performance.now() - this.hidden.since : 0);
    const recent = this.level?.recent ?? [];
    return {
      version: 1, startedAt: this.startedAt, sessionSeconds: Math.round(this.now() / 1000),
      browser: navigator.userAgent, cores: navigator.hardwareConcurrency ?? null, memoryGB: navigator.deviceMemory ?? null,
      network: navigator.connection ? {type: navigator.connection.effectiveType, downlinkMbps: navigator.connection.downlink, saveData: navigator.connection.saveData} : null,
      output: ac ? {sampleRate: ac.sampleRate, state: ac.state, baseLatencyMs: round(ac.baseLatency * 1000), outputLatencyMs: round(ac.outputLatency * 1000), latencyHint: dsp?.latencyHint ?? 'interactive', renderQuantum: ac.renderQuantumSize ?? 128} : null,
      underruns: stats ? {events: stats.underrunEvents, seconds: round(stats.underrunDuration, 3), playedSeconds: round(stats.totalDuration, 1), latencyMs: {average: round(stats.averageLatency * 1000), min: round(stats.minimumLatency * 1000), max: round(stats.maximumLatency * 1000)}, at: this.underruns.at.slice(-20)} : {supported: false},
      level: this.level ? {since: this.level.since, peakDb: db(this.level.peak), recentPeakDb: db(Math.max(0, ...recent)), clippedReads: this.level.clippedReads, reads: this.level.reads, limiterDb: round(dsp?.limiterReductionDb?.() ?? 0, 1)} : null,
      dsp: dsp ? {enabled: dsp.get('dsp_enabled'), eq: dsp.get('dsp_eq_enabled'), parametric: dsp.parametric, bands: dsp.parametric ? dsp.pbands.length : dsp.bands.length, preampDb: round((dsp.get('dsp_preamp') - 0.5) * 48, 1), tone: dsp.get('dsp_tone_enabled'), reverb: dsp.get('dsp_reverb_enabled'), limiter: dsp.get('dsp_limiter_enabled'), volume: dsp.get('dsp_master_volume')} : null,
      track: this.trackInfo(this.ctx.player?.track), decks: deck,
      longTasks: {count: this.longTasks.count, totalMs: Math.round(this.longTasks.totalMs), maxMs: Math.round(this.longTasks.maxMs)},
      hidden: {count: this.hidden.count, seconds: Math.round(hiddenMs / 1000)},
      contextStates: this.context?.states.slice(-20) ?? [],
      events: this.events.slice(-120),
    };
  }

  /** Fills the settings screen with the log (rows refresh every second while shown). */
  renderInto(list, settings) {
    this.startLevel();
    this.screen = {list, settings};
    const rows = new Map();
    const cat = title => {
      const c = document.createElement('div');
      c.className = 'cps-cat';
      const h = document.createElement('div');
      h.className = 'cps-cat-title';
      h.textContent = title;
      c.appendChild(h);
      list.appendChild(c);
      return c;
    };
    const row = (parent, key, title, onClick) => {
      const r = document.createElement('div');
      r.className = onClick ? 'cps-row' : 'cps-row cps-raw';
      const texts = document.createElement('div');
      texts.className = 'cps-texts';
      const t = document.createElement('div');
      t.className = 'cps-row-title';
      t.textContent = title;
      const s = document.createElement('div');
      s.className = 'cps-summary';
      texts.append(t, s);
      r.appendChild(texts);
      if (onClick) { r.tabIndex = 0; r.setAttribute('role', 'button'); r.addEventListener('click', onClick); r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }); }
      parent.appendChild(r);
      rows.set(key, s);
    };
    const out = cat('Output');
    row(out, 'output', 'Audio output');
    row(out, 'underruns', 'Dropouts (output underruns)');
    row(out, 'level', 'Output level');
    const media = cat('Stream');
    row(media, 'track', 'Playing');
    row(media, 'buffer', 'Network and decoder');
    const dev = cat('Device');
    row(dev, 'device', 'Browser and page');
    const rep = cat('Report');
    row(rep, 'copy', 'Copy report', () => this.copy(rows.get('copy')));
    row(rep, 'events', 'Recent events');
    const fill = () => {
      if (!list.isConnected || settings.stack?.at(-1) !== 'audio_platform_log' || settings.root?.hidden) { clearInterval(this.screenTimer); this.screen = null; this.follow(); return; }
      this.sample();
      this.startLevel();
      const s = this.snapshot();
      const o = s.output;
      rows.get('output').textContent = o ? `Web Audio, ${round(o.sampleRate / 1000, 1)} kHz, ${o.state}\nLatency ${o.baseLatencyMs ?? '?'} ms base, ${o.outputLatencyMs ?? '?'} ms output (${o.latencyHint})` : 'Starts with the first played track';
      rows.get('underruns').textContent = s.underruns.supported === false ? 'Not reported by this browser' : `${s.underruns.events} in ${round(s.underruns.playedSeconds / 60, 1)} min played (${round(s.underruns.seconds * 1000, 0)} ms of silence)`;
      const l = s.level;
      rows.get('level').textContent = l ? `Peak ${l.peakDb ?? '-∞'} dBFS since shown, last 10 s ${l.recentPeakDb ?? '-∞'} dBFS\nClipping in ${l.clippedReads} of ${l.reads} reads · limiter ${l.limiterDb} dB` : 'Starts with the first played track';
      const t = s.track, cur = s.decks.find(d => d.current) ?? s.decks[0];
      rows.get('track').textContent = t.format ? `${t.format} ${t.kbps ? t.kbps + ' kbps' : ''} ${t.rate ? round(t.rate / 1000, 1) + ' kHz' : ''} (${t.source})` : '—';
      rows.get('buffer').textContent = cur ? `${cur.bufferedAhead ?? 0} s buffered ahead\n${s.decks.reduce((n, d) => n + d.waits, 0)} rebuffers (${round(s.decks.reduce((n, d) => n + d.waitSeconds, 0), 1)} s), ${s.decks.reduce((n, d) => n + d.stalls, 0)} stalls, ${s.decks.reduce((n, d) => n + d.errors, 0)} errors${cur.lastError ? ' (last: ' + cur.lastError.kind + ')' : ''}` : '—';
      rows.get('device').textContent = `${s.cores ?? '?'} cores${s.memoryGB ? ', ' + s.memoryGB + ' GB' : ''}${s.network ? ', ' + s.network.type + (s.network.saveData ? ' (data saver)' : '') : ''}\nLong tasks ${s.longTasks.count} (max ${s.longTasks.maxMs} ms) · hidden ${s.hidden.count}× for ${s.hidden.seconds} s`;
      rows.get('events').textContent = s.events.slice(-8).reverse().map(e => `${fmtTime(e.t)} ${e.type}${e.deck !== undefined ? ' #' + e.deck : ''}${e.ms !== undefined ? ' ' + e.ms + ' ms' : ''}${e.kind ? ' ' + e.kind : ''}`).join('\n') || '—';
    };
    clearInterval(this.screenTimer);
    this.screenTimer = setInterval(fill, 1000);
    fill();
  }

  async copy(summary) {
    const text = JSON.stringify(this.snapshot(), null, 1);
    try { await navigator.clipboard.writeText(text); if (summary) summary.textContent = `Copied (${Math.round(text.length / 1024)} KB)`; } catch { if (summary) summary.textContent = 'Clipboard unavailable'; }
  }
}

/** Seconds buffered ahead of the playback position. */
function ahead(el) {
  try {
    const b = el.buffered, t = el.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i) - t;
  } catch { /* no buffered ranges */ }
  return 0;
}

const fmtTime = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
