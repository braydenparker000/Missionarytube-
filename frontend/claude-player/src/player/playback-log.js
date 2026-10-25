// Playback diagnostics, shown on the reference's Audio Outputs Detection Log
// screen (settings audio_platform_log; ?diag opens it at start). Counters run
// for the whole session: the audio output the browser reports (rate,
// latency, state, underruns from AudioContext.playbackStats), the decks'
// network and decoder events (waiting, stalls, errors, buffered audio), the
// output level (every sample, from the audio engine's meters: peaks, limiter
// reduction, clipped samples and the overs the limiter caught), the offline
// copies and the stream recoveries (stream-guard.js), main-thread long tasks
// and visibility. "Copy report" puts the whole log on the
// clipboard as JSON, for checking playback on the phone itself.

import {offlineAhead, setOfflineAhead, AHEAD_MODES} from '../library/audio-cache.js';

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
    // The engine's meters, summed over the session (dsp.js forwards each report).
    this.meters = {frames: 0, inPeak: 0, inOvers: 0, outPeak: 0, clamps: 0, minGain: 1, recent: []};
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
    const from = type === 'loadstart' ? {from: /^blob:/.test(el.currentSrc) ? (this.ctx.audioCache?.sourceOf?.(el.currentSrc) ? 'offline copy' : 'device') : 'stream'} : {};
    if (type !== 'playing' || current) this.log(type, {deck: d.index, ...from, ...(type === 'error' ? d.lastError : {}), ...(type === 'waiting' ? {at: round(el.currentTime, 2)} : {})});
  }

  trackInfo(t) {
    if (!t) return {};
    const src = String(t.src ?? ''), p = this.ctx.player;
    const playing = t === p?.track ? String(p.deckUrl?.get(p.audio) ?? '') : '';
    const source = /^https?:/.test(src) ? (playing.startsWith('blob:') ? 'offline copy' : 'stream') : src || t.libraryId ? 'device' : 'demo';
    return {id: t.id ?? null, format: t.format || '', kbps: t.bitrate || 0, rate: t.sampleRate || 0, channels: t.channels || 0, source};
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

  /** A meter report from the audio engine (every 100 ms of audio). */
  engineMeter(m) {
    const t = this.meters;
    t.frames += m.frames;
    t.inPeak = Math.max(t.inPeak, m.inPeak);
    t.inOvers += m.inOvers;
    t.outPeak = Math.max(t.outPeak, m.outPeak);
    t.clamps += m.clamps;
    t.minGain = Math.min(t.minGain, m.minGain);
    t.recent.push(m.outPeak);
    if (t.recent.length > 100) t.recent.shift();
    if (!m.clamps) return;
    // A run of clipping is one event (updated), so it cannot flood the log.
    const last = this.events.at(-1), now = this.now();
    if (last?.type === 'clipped' && now - last.until < 2000) { last.samples += m.clamps; last.until = now; } else this.log('clipped', {samples: m.clamps, until: now});
  }

  /**
   * Output level without the engine (plain playback): two analysers on the master output, read 20 times a second
   * while the page is visible (each read covers the last 43 ms, so nearly
   * every sample is seen). Peaks above full scale clip in the phone's mixer.
   */
  startLevel() {
    const dsp = this.ctx.dsp, ac = dsp?.ac, out = dsp?.nodes?.volume;
    if (this.level || !ac || !out || dsp.engine !== 'native') return;
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
      output: ac ? {sampleRate: ac.sampleRate, state: ac.state, baseLatencyMs: round(ac.baseLatency * 1000), outputLatencyMs: round(ac.outputLatency * 1000), latencyHint: dsp?.latencyHint ?? 'interactive', renderQuantum: ac.renderQuantumSize ?? 128, engine: dsp?.engine ?? null, bypass: !!dsp?.bypass, engineFailure: dsp?.failure ?? null} : null,
      underruns: stats ? {events: stats.underrunEvents, seconds: round(stats.underrunDuration, 3), playedSeconds: round(stats.totalDuration, 1), latencyMs: {average: round(stats.averageLatency * 1000), min: round(stats.minimumLatency * 1000), max: round(stats.maximumLatency * 1000)}, at: this.underruns.at.slice(-20)} : {supported: false},
      level: this.meters.frames ? this.engineLevel() : this.level ? {since: this.level.since, peakDb: db(this.level.peak), recentPeakDb: db(Math.max(0, ...recent)), clippedReads: this.level.clippedReads, reads: this.level.reads} : null,
      dsp: dsp ? {enabled: dsp.get('dsp_enabled'), eq: dsp.get('dsp_eq_enabled'), parametric: dsp.parametric, bands: dsp.parametric ? dsp.pbands.length : dsp.bands.length, preampDb: round((dsp.get('dsp_preamp') - 0.5) * 48, 1), tone: dsp.get('dsp_tone_enabled'), reverb: dsp.get('dsp_reverb_enabled'), limiter: dsp.get('dsp_limiter_enabled'), volume: dsp.get('dsp_master_volume')} : null,
      track: this.trackInfo(this.ctx.player?.track), decks: deck,
      preloaded: this.ctx.player?.preloaded ? {track: this.ctx.player.preloaded.track?.id ?? null, deck: this.decks.get(this.ctx.player.preloaded.el)?.index ?? null} : null,
      offline: this.ctx.audioCache?.summary?.() ?? null,
      recovery: this.ctx.player?.guard?.summary?.() ?? null,
      longTasks: {count: this.longTasks.count, totalMs: Math.round(this.longTasks.totalMs), maxMs: Math.round(this.longTasks.maxMs)},
      hidden: {count: this.hidden.count, seconds: Math.round(hiddenMs / 1000)},
      contextStates: this.context?.states.slice(-20) ?? [],
      events: this.events.slice(-120),
    };
  }

  /** The engine's level figures: every sample of the session. */
  engineLevel() {
    const t = this.meters, sr = this.ctx.dsp?.ac?.sampleRate || 48000;
    return {meteredSeconds: round(t.frames / sr, 1), peakDb: db(t.outPeak), recentPeakDb: db(Math.max(0, ...t.recent)), inputPeakDb: db(t.inPeak), limiterMaxDb: round(db(t.minGain) ?? 0, 1), limiterNowDb: round(this.ctx.dsp?.limiterReductionDb?.() ?? 0, 1), clippedSamples: t.clamps, oversCaught: t.inOvers};
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
    row(media, 'recovery', 'Recovery');
    row(media, 'offline', 'Offline copies');
    // How far ahead copies are saved (per device); tapping cycles the choices and applies at once.
    const aheadText = () => this.ctx.pref?.('cp_data_saver') === true ? 'None: Data saver is on (Settings › Misc)' : ({few: 'A few whole songs: on Wi-Fi the playing one and the next 3, on mobile data the next one', next: 'The next whole song', off: 'None (songs stream; the next ones keep their first 15 s ready)'})[offlineAhead()] + (offlineAhead() === 'off' ? '' : '\nOnce a song has played 30 s (skipped songs cost none)');
    row(media, 'heads', 'Next songs\' first seconds');
    row(media, 'offlineAhead', 'Save whole songs for offline', () => {
      setOfflineAhead(AHEAD_MODES[(AHEAD_MODES.indexOf(offlineAhead()) + 1) % AHEAD_MODES.length]);
      rows.get('offlineAhead').textContent = aheadText();
      this.ctx.player?.wantOffline?.();
    });
    rows.get('offlineAhead').textContent = aheadText();
    row(media, 'offlineClear', 'Delete offline copies', () => this.ctx.audioCache?.clear().then(() => { rows.get('offlineClear').textContent = 'Deleted'; }));
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
      rows.get('output').textContent = o ? `Web Audio, ${round(o.sampleRate / 1000, 1)} kHz, ${o.state}, ${o.bypass ? 'plain playback (the audio engine takes over once loaded and nothing plays)' : o.engine === 'worklet' ? 'audio engine on' : o.engine === 'native' ? 'plain playback (no effects' + (o.engineFailure ? ': ' + o.engineFailure : '') + ')' : 'starting'}\nLatency ${o.baseLatencyMs ?? '?'} ms base, ${o.outputLatencyMs ?? '?'} ms output (${o.latencyHint})` : 'Starts with the first played track';
      rows.get('underruns').textContent = s.underruns.supported === false ? 'Not reported by this browser' : `${s.underruns.events} in ${round(s.underruns.playedSeconds / 60, 1)} min played (${round(s.underruns.seconds * 1000, 0)} ms of silence)`;
      const l = s.level;
      rows.get('level').textContent = !l ? 'Starts with the first played track' : l.meteredSeconds !== undefined
        ? `Peak ${l.peakDb ?? '-∞'} dBFS, last 10 s ${l.recentPeakDb ?? '-∞'} dBFS · limiter now ${l.limiterNowDb} dB, at most ${l.limiterMaxDb} dB\n${l.clippedSamples} clipped samples in ${round(l.meteredSeconds / 60, 1)} min (the limiter caught ${l.oversCaught} over full scale)`
        : `Peak ${l.peakDb ?? '-∞'} dBFS since shown, last 10 s ${l.recentPeakDb ?? '-∞'} dBFS\nClipping in ${l.clippedReads} of ${l.reads} reads`;
      const t = s.track, cur = s.decks.find(d => d.current) ?? s.decks[0];
      rows.get('track').textContent = t.format ? `${t.format} ${t.kbps ? t.kbps + ' kbps' : ''} ${t.rate ? round(t.rate / 1000, 1) + ' kHz' : ''} (${t.source})` : '—';
      rows.get('buffer').textContent = cur ? `${cur.bufferedAhead ?? 0} s buffered ahead\n${s.decks.reduce((n, d) => n + d.waits, 0)} rebuffers (${round(s.decks.reduce((n, d) => n + d.waitSeconds, 0), 1)} s), ${s.decks.reduce((n, d) => n + d.stalls, 0)} stalls, ${s.decks.reduce((n, d) => n + d.errors, 0)} errors${cur.lastError ? ' (last: ' + cur.lastError.kind + ')' : ''}` : '—';
      const r = s.recovery;
      rows.get('recovery').textContent = !r ? '—' : `${r.reloads} reloads after ${r.errors} errors and ${r.stalls} stalls, ${r.recovered} recovered\n${r.skipped} tracks skipped (failed to play), ${r.offlineSkips} skipped offline${r.waitingOnline ? ' · waiting for the network' : ''}`;
      const c = s.offline, mb = n => Math.round(n / 1048576);
      rows.get('offline').textContent = !c?.available ? 'Not available in this browser' : `${c.ready} of the next ${c.wanted} tracks saved${c.downloading ? ', downloading' : c.held ? ', waiting for the track to start' : !c.online ? ', offline' : ''}\n${c.tracks} kept (${mb(c.bytes)} of ${mb(c.budget)} MB) · ${c.plays} played from a copy${c.failing ? ` · ${c.failing} failing (${c.lastError})` : ''}${c.tooBig ? ` · ${c.tooBig} too big for the space left` : ''}`;
      const hd = this.ctx.audioHeads?.summary?.();
      rows.get('heads').textContent = !hd ? '—' : !hd.available ? 'Starts once the app has its service worker (after the first visit)' : `${hd.kept} of the next ${hd.wanted} ready (first 15 s each)${hd.held ? ', waiting for the playing song\'s stream' : hd.downloading ? ', downloading' : ''}\n${hd.downloads} fetched, ${Math.round(hd.bytes / 1024)} KB${hd.failures ? ` · ${hd.failures} failed` : ''}`;
      if (!rows.get('offlineClear').textContent) rows.get('offlineClear').textContent = offlineAhead() === 'off' ? 'None are saved unless chosen above' : 'The copies download again as the queue plays';
      rows.get('device').textContent = `${s.cores ?? '?'} cores${s.memoryGB ? ', ' + s.memoryGB + ' GB' : ''}${s.network ? ', ' + s.network.type + (s.network.saveData ? ' (data saver)' : '') : ''}\nLong tasks ${s.longTasks.count} (max ${s.longTasks.maxMs} ms) · hidden ${s.hidden.count}× for ${s.hidden.seconds} s`;
      rows.get('events').textContent = s.events.slice(-8).reverse().map(e => `${fmtTime(e.t)} ${e.type.replace(/_/g, ' ')}${e.deck !== undefined ? ' #' + e.deck : ''}${e.ms !== undefined ? ' ' + e.ms + ' ms' : ''}${e.kind ? ' ' + e.kind : ''}${e.reason ? ' ' + e.reason : ''}`).join('\n') || '—';
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
