// The full-screen reader: tab with a live cursor, chord strip, fretboard and
// the practice transport (loop, speed, play, metronome, instrument).
import { el, icon, esc, openSheet, pushLayer, toast, segmented, slider, reduced } from './ui.js';
import * as engine from './engine-client.js';
import { openSong, keepSong, forgetSaved, coverURL, accentOf } from './sources.js';
import { Player, INSTRUMENTS, TONES } from './audio.js';
import { chordDiagram, Fretboard } from './draw.js';
import { tuningName } from './chords.js';
import { lastAtOrBefore, occurrence, formatTime } from './timeline.js';
import { STATUSES, TAB_SCALES } from './store.js';
import { readerTrack } from './track-selection.js';
import { filename, createDownload, nativeSaveMode, saveToDevice, triggerDownload, withDeadline } from './runtime.js';

const player = new Player();
let open = null;
export const readerOpen = () => !!open;

export function openReader(song, { store, onclose }) {
  if (open) open.close(true);
  const r = new Reader(song, store, onclose);
  open = r;
  return r;
}

class Reader {
  constructor(song, store, onclose) {
    this.song = song; this.store = store; this.onclose = onclose;
    this.prefs = store.prefs;
    this.urls = []; this.geo = new Map(); this.manualScroll = 0; this.lastSystem = null; this.loopPick = null;
    this.lastInteraction = performance.now();
    this.build();
    this.dismiss = pushLayer(() => this.close(false), '#play=' + encodeURIComponent(song.key));
    this.load();
  }

  // ----- layout -------------------------------------------------------------
  build() {
    const s = this.song;
    this.root = el('section.reader', { 'aria-label': `${s.title} by ${s.artist}` },
      el('div.rd-backdrop', { 'aria-hidden': 'true' }, this.backdrop = el('img', { alt: '' })),
      el('header.rd-top', {},
        el('button.icon-btn', { type: 'button', 'aria-label': 'Close song', html: icon('down'), onclick: () => this.dismiss() }),
        el('div.rd-title', {}, this.titleText = el('strong', {}, s.title), this.artistText = el('span', {}, s.artist)),
        this.moreButton = el('button.icon-btn', { type: 'button', 'aria-label': 'Song options', html: icon('more'), onclick: () => this.menu() })),
      this.tags = el('div.rd-tags', { 'aria-label': 'Song details' }),
      this.chordStrip = el('div.rd-chords', { role: 'group', 'aria-label': 'Chords in this song', hidden: true }),
      this.scroller = el('div.rd-scroll', {},
        this.sheet = el('div.rd-sheet', {},
          this.loading = el('div.rd-loading', { 'aria-hidden': 'true' }, el('i'), el('i'), el('i')))),
      this.boardWrap = el('div.rd-board', { hidden: true, role: 'button', tabindex: '0', 'aria-label': 'Hide fretboard', onclick: () => this.setFretboard(false),
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setFretboard(false); } } }),
      el('div.rd-dock', {},
        this.progress = el('div.rd-progress', {},
          this.timeNow = el('span.rd-time', {}, '0:00'),
          this.bar = el('div.rd-bar', { role: 'slider', tabindex: '0', 'aria-label': 'Song position', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' },
            this.loopBand = el('i.rd-bar-loop', { hidden: true }), this.fill = el('i.rd-bar-fill'), this.knob = el('i.rd-bar-knob')),
          this.timeEnd = el('span.rd-time', {}, '0:00')),
        el('nav.rd-transport', { 'aria-label': 'Practice controls' },
          this.loopButton = el('button.tp-btn', { type: 'button', 'aria-label': 'Loop', onclick: () => this.loopAction() }, el('span', { html: icon('loop') }), el('small', {}, 'Loop')),
          this.speedButton = el('button.tp-btn', { type: 'button', 'aria-label': 'Speed', onclick: () => this.speedSheet() }, el('span.tp-value', {}, '100%'), el('small', {}, 'Speed')),
          this.playButton = el('button.tp-play', { type: 'button', 'aria-label': 'Play', disabled: true, onclick: () => this.toggle() },
            this.ring = el('i.tp-ring'), this.playIcon = el('span', { html: icon('play', 30) })),
          this.clickButton = el('button.tp-btn', { type: 'button', 'aria-label': 'Metronome', 'aria-pressed': 'false', onclick: () => this.toggleClick(), oncontextmenu: e => { e.preventDefault(); this.clickSheet(); } },
            el('span', { html: icon('metronome') }), el('small', {}, 'Click')),
          this.voiceButton = el('button.tp-btn', { type: 'button', 'aria-label': 'Instrument', onclick: () => this.voiceSheet() }, el('span', { html: icon('guitar') }), el('small', {}, 'Acoustic')))),
      this.countBadge = el('div.rd-count', { 'aria-live': 'assertive', hidden: true }),
      this.hint = el('div.rd-hint', { role: 'status', hidden: true }));
    document.body.append(this.root);
    document.body.classList.add('reading');
    requestAnimationFrame(() => this.root.classList.add('open'));
    this.applyAccent(this.song.accent);
    coverURL(this.song).then(async url => {
      if (!url || this.closed) return;
      this.backdrop.src = url; this.backdrop.onload = () => this.root.classList.add('has-cover');
      if (!this.song.accent) { const accent = await accentOf(url); if (accent && !this.closed) { this.applyAccent(accent); this.store.update(this.song.key, { accent }); } }
    });
    this.wireSheet(); this.wireProgress(); this.wireKeys();
    this.practiceTimer = setInterval(() => this.tally(), 5000);
    const touched = () => { this.lastInteraction = performance.now(); };
    for (const type of ['pointerdown', 'wheel', 'keydown']) this.root.addEventListener(type, touched, { passive: true });
    this.scroller.addEventListener('scroll', touched, { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.scroller);
    this.updateVoiceLabel(); this.updateSpeedLabel(); this.updateClick();
    this.boardWrap.hidden = true;
  }

  applyAccent(color) { if (color) this.root.style.setProperty('--accent', color); }

  setTags() {
    const tl = this.timeline, chips = [];
    if (tl?.tuning?.length) chips.push(tuningName(tl.tuning));
    if (tl?.capo) chips.push('Capo ' + tl.capo);
    if (tl) chips.push(Math.round(tl.tempos[0][1]) + ' BPM');
    this.tags.replaceChildren(...chips.map(t => el('span.tag', {}, t)));
    const track = this.tracks?.find(t => t.id === this.trackId);
    if (track) this.tags.append(el('button.tag.tag-track', { type: 'button', 'aria-label': 'Change track, now ' + track.name, onclick: () => this.trackSheet(),
      html: '<span>' + esc(track.name) + '</span>' + icon('down', 16) }));
    if (this.loaded?.fromCache) this.tags.append(el('span.tag.tag-offline', {}, 'Saved copy'));
  }

  // ----- loading ------------------------------------------------------------
  async load() {
    this.showLoading(true);
    try {
      this.loaded = await openSong(this.song, { keep: !!this.song.status });
      if (this.closed) return;
      if (this.loaded.source === 'gprotab') {
        const info = await engine.load(await this.loaded.scoreSource());
        this.info = info;
        this.tracks = info.tracks.filter(t => t.kind !== 'drums' && t.strings > 0).map(t => ({ id: t.index, name: t.name, kind: t.kind, notes: t.notes }));
        if (!this.tracks.length) throw Error('This file has no guitar or bass tracks.');
        const guitars = this.tracks.filter(t => t.kind === 'guitar');
        this.defaultTrack = readerTrack(this.tracks);
        this.allGuitars = guitars.length > 1 && guitars.length <= 12 ? guitars.map(t => t.id) : null;
      } else {
        this.tracks = this.loaded.tracks.filter(t => t.kind !== 'drums');
        if (!this.tracks.length) this.tracks = this.loaded.tracks;
        this.defaultTrack = readerTrack(this.tracks); this.allGuitars = this.loaded.allGuitars;
      }
      const remembered = this.tracks.find(t => t.id === this.song.track);
      await this.showTrack(remembered ? remembered.id : this.defaultTrack, true);
    } catch (e) {
      if (!this.closed) this.fail(e.message || 'Couldn’t open this tab.');
    }
  }

  showLoading(on) { this.loading.hidden = !on; this.root.classList.toggle('is-loading', on); }

  fail(message) {
    this.showLoading(false);
    this.sheet.replaceChildren(el('div.rd-error', {}, el('p', {}, message),
      el('div.rd-error-actions', {}, el('button.btn.primary', { type: 'button', onclick: () => { this.sheet.replaceChildren(this.loading); this.load(); } }, 'Try again'),
        el('button.btn', { type: 'button', onclick: () => this.dismiss() }, 'Back'))));
  }

  async showTrack(id, first = false) {
    const wasPlaying = player.playing;
    player.pause();
    this.saveState();
    this.trackId = id;
    this.showLoading(true);
    this.sheet.querySelectorAll('.rd-system').forEach(n => n.remove());
    try {
      const engineTrack = this.loaded.engineTrack(id);
      if (this.loaded.source === 'songsterr') this.info = await engine.load(await this.loaded.scoreSource(id));
      const [systems, timeline] = await Promise.all([engine.reader(engineTrack, this.sheetWidth(), this.prefs.tabScale), engine.timeline(engineTrack)]);
      if (this.closed || this.trackId !== id) return;
      this.engineTrack = engineTrack;
      this.timeline = timeline;
      player.setTimeline(timeline);
      this.drawSystems(systems);
      this.setupChords(); this.setupBoard(); this.setTags();
      const track = this.tracks.find(t => t.id === id);
      const songsterr = this.loaded.source === 'songsterr';
      const record = this.store.open({ source: this.song.source, id: this.song.id, title: songsterr ? this.loaded.title : this.song.title || this.info.title,
        artist: songsterr ? this.loaded.artist : this.song.artist || this.info.artist, track: id, trackName: track?.name || '' });
      if (record) {
        this.song = record;
        this.titleText.textContent = record.title; this.artistText.textContent = record.artist;
      }
      // Resume where you left off: bar, loop and speed.
      if (first) {
        const bars = player.bars;
        if (this.song.loop && this.song.loop[1] < bars.length) this.setLoopBars(this.song.loop[0], this.song.loop[1], false);
        if (this.song.bar > 0 && this.song.bar < bars.length) player.seek(bars[this.song.bar].s);
        player.setSpeed(this.song.speed / 100);
        this.updateSpeedLabel();
      } else this.clearLoop(false);
      this.timeEnd.textContent = formatTime(player.duration);
      this.showLoading(false);
      this.playButton.disabled = false;
      this.frame(true);
      this.loop();
      this.prepareSounds(wasPlaying);
    } catch (e) {
      if (!this.closed && this.trackId === id) this.fail(e.message || 'Couldn’t load this track.');
    }
  }

  async prepareSounds(thenPlay = false) {
    player.voice(this.prefs);
    this.root.classList.add('sounds-loading');
    try {
      await player.prepare((done, total) => { this.ring.style.setProperty('--p', total ? done / total : 1); });
      if (thenPlay && !this.closed) this.play();
    } catch (e) { toast(e.message, { error: true }); }
    finally { this.root.classList.remove('sounds-loading'); }
  }

  sheetWidth() { return Math.max(280, Math.min(1100, Math.floor(this.scroller.clientWidth - 24))); }

  drawSystems(systems) {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = []; this.geo.clear();
    this.sheet.querySelectorAll('.rd-system').forEach(n => n.remove());
    const sections = new Map();
    for (const bar of this.timeline?.bars || []) if (bar.section && !sections.has(bar.mb)) sections.set(bar.mb, bar.section);
    this.systems = systems.map((sys, index) => {
      const url = URL.createObjectURL(new Blob([sys.svg], { type: 'image/svg+xml' }));
      this.urls.push(url);
      const img = el('img', { src: url, alt: `Tab, bars ${sys.first + 1} to ${sys.last + 1}`, width: String(Math.round(sys.width)), height: String(Math.round(sys.height)), draggable: false });
      const node = el('div.rd-system', { dataset: { index: String(index) } }, img);
      this.sheet.append(node);
      for (const bar of sys.bars) {
        this.geo.set(bar.index, { ...bar, node, system: index });
        const section = sections.get(bar.index);
        if (section) { const label = el('span.rd-section', {}, section); label.style.left = bar.x + 'px'; node.append(label); }
      }
      return { ...sys, node };
    });
    if (!this.cursor) {
      this.highlight = el('div.rd-hl', { 'aria-hidden': 'true' });
      this.cursor = el('div.rd-cursor', { 'aria-hidden': 'true' });
    }
    this.sheet.append(this.highlight, this.cursor);
    this.sheet.querySelectorAll('.rd-loopmark').forEach(n => n.remove());
    this.lastSystem = null;
    if (player.loop) this.drawLoopMarks();
  }

  onResize() {
    const width = this.sheetWidth();
    if (!this.systems || Math.abs(width - (this.renderedWidth || width)) < 12) { this.renderedWidth ??= width; return; }
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.rerender(), 250);
  }
  async rerender() {
    if (this.engineTrack == null || this.closed) return;
    const width = this.sheetWidth(), id = this.trackId;
    try {
      const systems = await engine.reader(this.engineTrack, width, this.prefs.tabScale);
      if (this.closed || id !== this.trackId) return;
      this.renderedWidth = width;
      this.drawSystems(systems);
      this.setupBoard();
      this.frame(true);
    } catch {}
  }

  // ----- chords and fretboard ---------------------------------------------
  setupChords() {
    const chords = this.timeline.chords;
    const unique = [];
    for (const c of chords) if (!unique.some(u => u.name === c.name)) unique.push(c);
    this.chordCards = new Map();
    this.chordStrip.replaceChildren(...unique.map(c => {
      const card = el('button.chord', { type: 'button', 'aria-label': 'Chord ' + c.name, onclick: () => this.chordSheet(c) },
        el('span.chord-diagram', { html: chordDiagram(c.frets, { label: c.name }) }), el('strong', {}, c.name));
      this.chordCards.set(c.name, card);
      return card;
    }));
    this.chordStrip.hidden = !unique.length;
    this.currentChord = null;
  }
  chordSheet(chord) {
    const next = () => {
      const tick = this.tickNow(), seq = this.timeline.chords.find(c => c.name === chord.name && c.t > tick + 1) || this.timeline.chords.find(c => c.name === chord.name);
      if (seq) player.seek(player.map.secAt(seq.t));
      this.frame(true);
    };
    openSheet({ title: chord.name, subtitle: chord.frets.some(f => f > 0) ? 'As played in this song' : '', className: 'chord-sheet',
      content: el('div.chord-big', { html: chordDiagram(chord.frets, { width: 150, height: 170, label: chord.name }) }),
      items: [{ label: 'Go to this chord', icon: 'right', action: next }] });
  }
  setupBoard() {
    const tl = this.timeline;
    if (!tl.strings) { this.board = null; this.boardWrap.hidden = true; return; }
    let high = 12;
    for (const e of tl.events) for (const n of e.n) if (n.f > high) high = n.f;
    this.boardWrap.hidden = !this.prefs.fretboard;
    this.board = new Fretboard(this.boardWrap, { strings: tl.strings, frets: Math.min(24, high <= 12 ? 12 : high <= 15 ? 15 : high), capo: tl.capo });
  }
  // A tap on the fretboard hides it; Display (or Undo) brings it back.
  setFretboard(on) {
    this.store.setPrefs({ fretboard: on }); this.prefs = this.store.prefs;
    this.setupBoard(); this.lastSystem = null; this.frame(true);
    if (!on) toast('Fretboard hidden', { label: 'Undo', action: () => this.setFretboard(true) });
  }

  // ----- the playhead -----------------------------------------------------
  tickNow() { return player.map ? player.map.tickAt(player.now()) : 0; }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.closed) return;
      this.frame();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  frame(force = false) {
    if (!this.timeline || !this.systems) return;
    const sec = player.now(), tl = this.timeline, tick = player.map.tickAt(sec);
    const seq = Math.max(0, lastAtOrBefore(tl.bars, tick, 'start')), bar = tl.bars[seq];
    if (!force && sec === this.lastSec && !player.playing) return;
    this.lastSec = sec;
    this.seq = seq;
    // Cursor: interpolate between beats inside the bar.
    const g = this.geo.get(bar.mb);
    if (g) {
      const span = bar.end - bar.start, offset = Math.max(0, Math.min(span, tick - bar.start)) * (g.duration / (span || g.duration));
      const points = [...g.beats, [g.duration, g.x + g.w - 6]];
      let x = points[0]?.[1] ?? g.x;
      for (let i = 0; i < points.length - 1; i++) {
        const [t0, x0] = points[i], [t1, x1] = points[i + 1];
        if (offset >= t0 && offset <= t1) { x = x0 + (x1 - x0) * (t1 > t0 ? (offset - t0) / (t1 - t0) : 0); break; }
        if (offset > t1) x = x1;
      }
      const top = g.node.offsetTop + g.y;
      this.cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${top}px, 0)`;
      this.cursor.style.height = g.h + 'px';
      if (force || this.hlBar !== bar.mb) {
        this.hlBar = bar.mb;
        this.highlight.style.transform = `translate3d(${g.x}px, ${top}px, 0)`;
        this.highlight.style.width = g.w + 'px';
        this.highlight.style.height = g.h + 'px';
      }
      if (g.system !== this.lastSystem) { this.lastSystem = g.system; this.follow(g.node, force); }
    }
    // Progress and time.
    const ratio = player.duration ? sec / player.duration : 0;
    this.fill.style.transform = `scaleX(${ratio})`;
    this.knob.style.transform = `translateX(${(ratio * this.bar.clientWidth).toFixed(1)}px)`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    this.bar.setAttribute('aria-valuetext', `${formatTime(sec)} of ${formatTime(player.duration)}, bar ${bar.mb + 1}`);
    const now = formatTime(sec);
    if (this.timeNow.textContent !== now) this.timeNow.textContent = now;
    // Chord strip.
    const ci = lastAtOrBefore(tl.chords, tick, 't'), chord = ci >= 0 && tl.chords[ci].t <= tick + 1 ? tl.chords[ci] : null;
    const upcoming = tl.chords.slice(Math.max(0, ci + 1)).find(c => c.name !== chord?.name);
    if (chord?.name !== this.currentChord || upcoming?.name !== this.nextChord) {
      this.chordCards.get(this.currentChord)?.classList.remove('now');
      this.chordCards.get(this.nextChord)?.classList.remove('next');
      this.currentChord = chord?.name; this.nextChord = upcoming?.name;
      const card = this.chordCards.get(this.currentChord);
      card?.classList.add('now');
      if (this.nextChord !== this.currentChord) this.chordCards.get(this.nextChord)?.classList.add('next');
      card?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() || force ? 'auto' : 'smooth' });
    }
    // Fretboard.
    if (this.board && !this.boardWrap.hidden) this.board.show(...this.sounding(tick));
    // Count-in.
    const count = player.counting();
    this.countBadge.hidden = !count;
    if (count) this.countBadge.textContent = count;
  }

  // Practice time: five-second steps while playing, or while reading with
  // a touch, scroll or key in the last 90 seconds.
  tally() {
    const t = performance.now();
    if (player.playing) this.lastInteraction = t;
    if (this.timeline && t - this.lastInteraction < 90000 && document.visibilityState === 'visible') this.store.practice(this.song.key, 5);
  }

  // Notes sounding at this tick, and the next beat's notes.
  sounding(tick) {
    const events = this.timeline.events;
    const i = lastAtOrBefore(events, tick, 't');
    const on = new Map();
    for (let k = i; k >= 0 && k > i - 40; k--) {
      const e = events[k];
      if (e.t > tick) continue;
      for (const n of e.n) if (!on.has(n.s)) on.set(n.s, { ...n, t: e.t });
    }
    const notes = [...on.values()].filter(n => tick < n.t + Math.max(n.d, n.fl & 4 ? 9e9 : 0) || tick - n.t < 60);
    const next = events[i + 1] || (i < 0 ? events[0] : null);
    return [notes, next && next.t - tick < 1920 ? next.n : []];
  }

  follow(node, instant) {
    if (performance.now() - this.manualScroll < 2500) return;
    // The playing line sits near the top, and always wholly above the fretboard.
    const view = this.scroller.clientHeight;
    const top = Math.min(node.offsetTop - 12, Math.max(node.offsetTop - view * 0.18, node.offsetTop + node.offsetHeight - view + 20));
    this.scroller.scrollTo({ top: Math.max(0, top), behavior: instant || reduced() ? 'auto' : 'smooth' });
  }

  // ----- input --------------------------------------------------------------
  wireSheet() {
    let down = null;
    const mark = () => { this.manualScroll = performance.now(); this.lastInteraction = performance.now(); };
    this.scroller.addEventListener('wheel', mark, { passive: true });
    this.scroller.addEventListener('touchmove', mark, { passive: true });
    this.scroller.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.scroller.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || performance.now() - down.t > 600) { down = null; return; }
      down = null;
      const system = e.target.closest('.rd-system');
      if (!system) return;
      const rect = system.getBoundingClientRect(), x = e.clientX - rect.left, index = Number(system.dataset.index);
      const bar = this.systems[index].bars.find(b => x >= b.x && x <= b.x + b.w) || this.systems[index].bars.at(-1);
      if (bar) this.tapBar(bar.index);
    });
  }
  tapBar(mb) {
    this.lastInteraction = performance.now();
    const seq = occurrence(player.bars, mb, this.loopPick ? 0 : this.seq || 0);
    if (seq < 0) return;
    if (this.loopPick) {
      if (this.loopPick.first == null) { this.loopPick.first = seq; this.say(`From bar ${mb + 1}. Now tap the last bar.`, true); this.markPick(seq); return; }
      const a = Math.min(this.loopPick.first, seq), b = Math.max(this.loopPick.first, seq);
      this.loopPick = null;
      this.setLoopBars(a, b, true);
      return;
    }
    this.manualScroll = 0;
    player.seek(player.bars[seq].s);
    this.frame(true);
  }
  markPick(seq) {
    this.sheet.querySelectorAll('.rd-loopmark').forEach(n => n.remove());
    const g = this.geo.get(player.bars[seq].mb);
    if (!g) return;
    const mark = el('div.rd-loopmark.pick');
    mark.style.transform = `translate3d(${g.x}px, ${g.node.offsetTop + g.y}px, 0)`; mark.style.width = g.w + 'px'; mark.style.height = g.h + 'px';
    this.sheet.append(mark);
  }

  wireProgress() {
    let dragging = false;
    const seekTo = e => {
      const rect = this.bar.getBoundingClientRect(), ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      player.seek(ratio * player.duration); this.manualScroll = 0; this.frame(true);
    };
    this.bar.addEventListener('pointerdown', e => { dragging = true; this.bar.setPointerCapture(e.pointerId); this.bar.classList.add('dragging'); seekTo(e); });
    this.bar.addEventListener('pointermove', e => { if (dragging) seekTo(e); });
    const end = () => { dragging = false; this.bar.classList.remove('dragging'); };
    this.bar.addEventListener('pointerup', end); this.bar.addEventListener('pointercancel', end);
    this.bar.addEventListener('keydown', e => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) { e.preventDefault(); this.stepBar(step); }
    });
  }
  stepBar(step) {
    const bars = player.bars;
    if (!bars) return;
    const seq = Math.max(0, Math.min(bars.length - 1, (this.seq || 0) + step));
    player.seek(bars[seq].s); this.manualScroll = 0; this.frame(true);
  }
  wireKeys() {
    this.keys = e => {
      if (e.target.closest('input, textarea, .sheet-layer') || document.querySelector('.sheet-layer') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === ' ' || k === 'k') { e.preventDefault(); this.toggle(); }
      else if (k === 'ArrowRight' && e.target === document.body) { e.preventDefault(); this.stepBar(1); }
      else if (k === 'ArrowLeft' && e.target === document.body) { e.preventDefault(); this.stepBar(-1); }
      else if (k === 'Escape') { e.preventDefault(); this.dismiss(); }
      else if (k === 'l') this.loopAction();
      else if (k === 'm') this.toggleClick();
      else if (k === '+' || k === '=') this.changeSpeed(5);
      else if (k === '-') this.changeSpeed(-5);
    };
    addEventListener('keydown', this.keys);
    this.visibility = () => { if (document.visibilityState === 'visible' && player.playing) this.lock(); };
    document.addEventListener('visibilitychange', this.visibility);
  }

  // ----- transport ----------------------------------------------------------
  async toggle() { if (player.playing) this.pause(); else this.play(); }
  async play() {
    if (!player.events) return;
    this.lastInteraction = performance.now();
    player.metronome = this.prefs.metronome; player.countIn = this.prefs.countIn; player.latency = this.prefs.latency;
    player.trainer = this.prefs.trainer;
    player.onend = () => { this.recordBest(); this.setPlaying(false); this.frame(true); };
    player.onloop = speed => { this.recordBest(); this.updateSpeedLabel(speed * 100); };
    try { await player.play(); } catch { toast('Audio could not start. Tap play again.', { error: true }); return; }
    this.setPlaying(true);
    this.lock();
  }
  pause() { player.pause(); this.setPlaying(false); this.saveState(); this.frame(true); }
  setPlaying(on) {
    this.playButton.setAttribute('aria-label', on ? 'Pause' : 'Play');
    this.playIcon.innerHTML = icon(on ? 'pause' : 'play', 30);
    this.root.classList.toggle('playing', on);
    if (!on) { this.wakeLock?.release().catch(() => {}); this.wakeLock = null; }
  }
  async lock() { try { if ('wakeLock' in navigator && !this.wakeLock) { this.wakeLock = await navigator.wakeLock.request('screen'); this.wakeLock.addEventListener('release', () => { this.wakeLock = null; }); } } catch {} }
  recordBest() {
    const speed = Math.round(player.speed * 100);
    if (speed > (this.song.best || 0)) this.song = this.store.update(this.song.key, { best: speed }) || this.song;
  }

  toggleClick() {
    this.store.setPrefs({ metronome: !this.prefs.metronome });
    this.prefs = this.store.prefs; player.metronome = this.prefs.metronome;
    this.updateClick();
  }
  updateClick() {
    this.clickButton.setAttribute('aria-pressed', String(!!this.prefs.metronome));
    this.clickButton.classList.toggle('on', !!this.prefs.metronome);
  }
  clickSheet() {
    openSheet({ title: 'Metronome', items: [
      { label: 'Click while playing', checked: !!this.prefs.metronome, action: () => this.toggleClick() },
      { label: 'Count in one bar', detail: 'Before playback starts', checked: !!this.prefs.countIn, action: () => { this.store.setPrefs({ countIn: !this.prefs.countIn }); this.prefs = this.store.prefs; } }
    ], content: slider({ label: 'Click volume', min: 0, max: 100, value: Math.round(this.prefs.clickVolume * 100), format: v => v + '%',
      oninput: v => { this.store.setPrefs({ clickVolume: v / 100 }); this.prefs = this.store.prefs; player.voice(this.prefs); } }) });
  }

  changeSpeed(delta) { this.setSpeed(Math.round(player.speed * 100) + delta); }
  setSpeed(percent) {
    percent = Math.min(150, Math.max(25, Math.round(percent / 5) * 5));
    player.setSpeed(percent / 100);
    this.store.update(this.song.key, { speed: percent });
    this.updateSpeedLabel();
  }
  updateSpeedLabel(value = Math.round(player.speed * 100)) {
    this.speedButton.querySelector('.tp-value').textContent = Math.round(value) + '%';
    this.speedButton.classList.toggle('on', Math.round(value) !== 100);
  }
  speedSheet() {
    const presets = el('div.chips', {}, ...[50, 70, 85, 100].map(p => el('button.chip', { type: 'button', 'aria-pressed': String(Math.round(player.speed * 100) === p),
      onclick: () => { this.setSpeed(p); sheet.dismiss(); } }, p + '%')));
    const t = this.prefs.trainer;
    const trainer = el('div.trainer', {},
      el('label.switch', {}, el('span', {}, el('strong', {}, 'Speed trainer'), el('small', {}, 'Each time the loop repeats, go faster')),
        el('input', { type: 'checkbox', role: 'switch', checked: !!t.on, onchange: e => { this.store.setPrefs({ trainer: { ...this.prefs.trainer, on: e.target.checked } }); this.prefs = this.store.prefs; player.trainer = this.prefs.trainer; } })),
      slider({ label: 'Step', min: 1, max: 10, value: t.step, format: v => '+' + v + '%', oninput: v => { this.store.setPrefs({ trainer: { ...this.prefs.trainer, step: v } }); this.prefs = this.store.prefs; player.trainer = this.prefs.trainer; } }),
      slider({ label: 'Up to', min: 50, max: 150, step: 5, value: t.target, format: v => v + '%', oninput: v => { this.store.setPrefs({ trainer: { ...this.prefs.trainer, target: v } }); this.prefs = this.store.prefs; player.trainer = this.prefs.trainer; } }));
    const sheet = openSheet({ title: 'Speed', subtitle: Math.round((this.timeline?.tempos[0][1] || 120) * player.speed) + ' BPM at ' + Math.round(player.speed * 100) + '%',
      content: [slider({ label: 'Playback speed', min: 25, max: 150, step: 5, value: Math.round(player.speed * 100), format: v => v + '%', oninput: v => this.setSpeed(v) }), presets, trainer] });
  }

  voiceSheet() {
    const draw = () => {
      const tones = this.prefs.instrument === 'electric' ? segmented(TONES.map(t => ({ value: t.value, label: t.label })), this.prefs.tone, tone => this.setVoice({ tone }), 'Electric tone') : null;
      return el('div.voice', {},
        el('div.voice-cards', { role: 'radiogroup', 'aria-label': 'Instrument' }, ...INSTRUMENTS.map(i => el('button.voice-card', { type: 'button', role: 'radio', 'aria-checked': String(this.prefs.instrument === i.value),
          onclick: () => { this.setVoice({ instrument: i.value }); body.replaceWith(body = draw()); } }, el('span', { html: icon('guitar', 28) }), el('strong', {}, i.label), el('small', {}, i.detail)))),
        tones ? el('div.voice-tone', {}, el('span', {}, 'Tone'), tones) : null,
        slider({ label: 'Room', min: 0, max: 100, value: Math.round(this.prefs.reverb * 100), format: v => v + '%', oninput: v => this.setVoice({ reverb: v / 100 }, false) }),
        slider({ label: 'Volume', min: 0, max: 100, value: Math.round(this.prefs.volume * 100), format: v => v + '%', oninput: v => this.setVoice({ volume: v / 100 }, false) }));
    };
    let body = draw();
    openSheet({ title: 'Sound', subtitle: 'Real guitar samples', content: body });
  }
  setVoice(patch, reload = true) {
    this.store.setPrefs(patch); this.prefs = this.store.prefs;
    player.voice(this.prefs);
    this.updateVoiceLabel();
    if (reload && (patch.instrument || patch.tone)) {
      const was = player.playing;
      if (was) player.pause();
      this.prepareSounds(was);
    }
  }
  updateVoiceLabel() {
    const i = INSTRUMENTS.find(x => x.value === this.prefs.instrument) || INSTRUMENTS[1];
    this.voiceButton.querySelector('small').textContent = i.value === 'electric' ? (TONES.find(t => t.value === this.prefs.tone)?.label || 'Electric') : i.label;
  }

  // ----- loops --------------------------------------------------------------
  loopAction() {
    if (!player.bars) return;
    if (this.loopPick) { this.loopPick = null; this.say(''); this.sheet.querySelectorAll('.rd-loopmark.pick').forEach(n => n.remove()); if (player.loop) this.drawLoopMarks(); return; }
    if (player.loop) {
      const [a, b] = this.loopBars;
      openSheet({ title: `Looping bars ${player.bars[a].mb + 1}–${player.bars[b].mb + 1}`, items: [
        { label: 'Choose other bars', icon: 'loop', action: () => this.startPick() },
        { label: 'Loop this bar only', icon: 'restart', action: () => this.setLoopBars(this.seq, this.seq, true) },
        { label: 'Stop looping', icon: 'close', action: () => this.clearLoop(true) }
      ] });
      return;
    }
    this.startPick();
  }
  startPick() {
    this.loopPick = {};
    this.say('Tap the first bar to loop.', true);
    this.loopButton.classList.add('picking');
  }
  setLoopBars(a, b, announce) {
    const bars = player.bars;
    this.loopBars = [a, b];
    player.setLoop({ start: bars[a].s, end: bars[b].e });
    this.loopButton.classList.remove('picking');
    this.loopButton.classList.add('on');
    this.loopButton.querySelector('small').textContent = `${bars[a].mb + 1}–${bars[b].mb + 1}`;
    this.store.update(this.song.key, { loop: [a, b] });
    this.drawLoopMarks();
    if (announce) { this.say(''); toast(`Looping bars ${bars[a].mb + 1}–${bars[b].mb + 1}`); if (!player.playing) { player.seek(bars[a].s); this.frame(true); } }
  }
  clearLoop(announce) {
    this.loopBars = null; player.setLoop(null);
    this.loopButton.classList.remove('on', 'picking');
    this.loopButton.querySelector('small').textContent = 'Loop';
    this.sheet.querySelectorAll('.rd-loopmark').forEach(n => n.remove());
    this.loopBand.hidden = true;
    this.store.update(this.song.key, { loop: null });
    if (announce) toast('Loop off');
  }
  drawLoopMarks() {
    this.sheet.querySelectorAll('.rd-loopmark').forEach(n => n.remove());
    if (!this.loopBars) return;
    const [a, b] = this.loopBars, seen = new Set();
    for (let i = a; i <= b; i++) {
      const mb = player.bars[i].mb, g = this.geo.get(mb);
      if (!g || seen.has(mb)) continue;
      seen.add(mb);
      const mark = el('div.rd-loopmark');
      mark.style.transform = `translate3d(${g.x}px, ${g.node.offsetTop + g.y}px, 0)`; mark.style.width = g.w + 'px'; mark.style.height = g.h + 'px';
      this.sheet.insertBefore(mark, this.highlight);
    }
    const d = player.duration || 1;
    this.loopBand.hidden = false;
    this.loopBand.style.left = (player.loop.start / d * 100) + '%';
    this.loopBand.style.width = ((player.loop.end - player.loop.start) / d * 100) + '%';
  }
  say(message, sticky = false) {
    this.hint.hidden = !message;
    this.hint.textContent = message;
    clearTimeout(this.hintTimer);
    if (message && !sticky) this.hintTimer = setTimeout(() => { this.hint.hidden = true; }, 2500);
  }

  // ----- menus --------------------------------------------------------------
  trackSheet() {
    const list = [...this.tracks].sort((a, b) => (a.kind === 'guitar' ? 0 : 1) - (b.kind === 'guitar' ? 0 : 1));
    openSheet({ title: 'Track', subtitle: this.song.title, items: list.map(t => ({ label: t.name, detail: t.kind === 'guitar' ? (t.instrument || 'Guitar') : t.kind === 'bass' ? 'Bass' : t.instrument || 'Other',
      checked: t.id === this.trackId, action: () => { if (t.id !== this.trackId) this.showTrack(t.id); } })) });
  }

  menu() {
    const s = this.song;
    const items = [
      ...STATUSES.map(st => ({ label: st.label, detail: st.value === 'learning' ? 'Just started' : st.value === 'practicing' ? 'Working on it' : 'Ready to play', checked: s.status === st.value,
        action: () => this.setStatus(st.value) })),
      { label: s.star ? 'Unstar' : 'Star', icon: s.star ? 'starFill' : 'star', action: () => { this.song = this.store.update(s.key, { star: !s.star }) || s; toast(this.song.star ? 'Starred' : 'Star removed'); } },
      s.status ? { label: 'Remove from My songs', icon: 'trash', action: () => this.setStatus('') } : null,
      { label: 'Export PDF', detail: 'Notation and tab, A4', icon: 'file', action: () => this.exportPdf() },
      { label: 'Display', detail: 'Tab size, fretboard', icon: 'text', action: () => this.displaySheet() },
      { label: 'Audio sync', detail: this.prefs.latency ? `${this.prefs.latency > 0 ? '+' : ''}${this.prefs.latency} ms` : 'Automatic', icon: 'sync', action: () => this.syncSheet() },
      { label: 'Metronome options', icon: 'metronome', action: () => this.clickSheet() },
      { label: this.loaded?.source === 'gprotab' ? 'Open on GProTab' : 'Open on Songsterr', icon: 'link', action: () => window.open(this.loaded.link, '_blank', 'noopener') },
      { label: 'Credits', icon: 'info', action: () => { location.href = '/guitar/credits.html'; } }
    ].filter(Boolean);
    openSheet({ title: s.title, subtitle: s.artist + (this.tracks ? ' · ' + (this.tracks.find(t => t.id === this.trackId)?.name || '') : ''), items });
  }
  async setStatus(status) {
    this.song = this.store.setStatus(this.song.key, status) || this.song;
    if (status) {
      toast(`In My songs · ${STATUSES.find(s => s.value === status).label}`);
      try { await keepSong(this.loaded, this.trackId); } catch {}
    } else { toast('Removed from My songs'); forgetSaved(this.song.key); }
  }
  displaySheet() {
    openSheet({ title: 'Display', content: [
      el('div.voice-tone', {}, el('span', {}, 'Tab size'), segmented(['Small', 'Medium', 'Large'].map((label, i) => ({ value: TAB_SCALES[i], label })), this.prefs.tabScale,
        v => { this.store.setPrefs({ tabScale: v }); this.prefs = this.store.prefs; this.rerender(); }, 'Tab size')),
      el('label.switch', {}, el('span', {}, el('strong', {}, 'Fretboard'), el('small', {}, 'Shows the notes as they play')),
        el('input', { type: 'checkbox', role: 'switch', checked: !!this.prefs.fretboard, onchange: e => this.setFretboard(e.target.checked) }))
    ] });
  }
  syncSheet() {
    openSheet({ title: 'Audio sync', subtitle: 'If the cursor runs ahead of or behind the sound (for example over Bluetooth), shift it here.',
      content: slider({ label: 'Cursor delay', min: -300, max: 300, step: 10, value: this.prefs.latency, format: v => (v > 0 ? '+' : '') + v + ' ms',
        oninput: v => { this.store.setPrefs({ latency: v }); this.prefs = this.store.prefs; player.latency = v; } }) });
  }

  async exportPdf() {
    const current = this.tracks.find(t => t.id === this.trackId);
    const choose = () => new Promise(resolve => {
      if (!this.allGuitars || this.allGuitars.length < 2) { resolve([this.trackId]); return; }
      openSheet({ title: 'Export PDF', subtitle: 'Notation and tab', items: [
        { label: current?.name || 'This track', detail: 'This track', icon: 'file', action: () => resolve([this.trackId]) },
        { label: 'All guitar tracks', detail: this.allGuitars.length + ' tracks, one after another', icon: 'tracks', action: () => resolve(this.allGuitars) }
      ] });
    });
    const ids = await choose();
    const label = ids.length === 1 ? (this.tracks.find(t => t.id === ids[0])?.name || 'Guitar') : 'All guitar tracks';
    toast('Preparing PDF…', { ms: 120000 });
    try {
      const blob = await withDeadline(async signal => {
        const source = await this.loaded.printSource(ids);
        const result = await engine.print(source, ids.map(id => this.loaded.engineTrack(id)));
        signal.throwIfAborted();
        const pdf = await import('./pdf.js');
        return pdf.createPdf(result, this.loaded.printMeta(this.info), label, signal, (i, total) => toast(`Creating PDF… ${Math.round(i / total * 100)}%`, { ms: 120000 }));
      }, 120000);
      const ready = createDownload(blob, filename(this.song.title, label));
      this.urls.push(ready.url);
      toast('PDF ready', { ms: 1500 });
      const save = el('button.btn.primary', { type: 'button' }, 'Save to Files');
      const openLink = el('a.btn', { href: ready.url, target: '_blank', rel: 'noopener', onclick: () => ready.handoff() }, 'Open PDF');
      const direct = el('a.btn', { href: ready.url, download: ready.name, onclick: () => ready.handoff() }, 'Direct download');
      save.addEventListener('click', async () => {
        if (!nativeSaveMode(ready)) { triggerDownload(ready); toast('Download requested. If nothing happens, use Open PDF.'); return; }
        save.disabled = true;
        try { const mode = await saveToDevice(ready); toast(mode === 'file-picker' ? 'PDF saved.' : 'PDF handed to the app you chose.'); }
        catch (e) { toast(e?.name === 'AbortError' ? 'Save cancelled. The PDF is still ready.' : 'Couldn’t save. Try Open PDF or Direct download.', { error: e?.name !== 'AbortError' }); }
        finally { save.disabled = false; }
      });
      openSheet({ title: 'PDF ready', subtitle: ready.name, content: el('div.pdf-actions', {}, save, openLink, direct) });
    } catch (e) {
      toast(/Songsterr|GProTab|connection|source/i.test(e.message || '') ? e.message : 'Couldn’t create this PDF. Try another track.', { error: true });
    }
  }

  // ----- leaving ----------------------------------------------------------
  saveState() {
    if (!player.bars || !this.song?.key) return;
    this.store.update(this.song.key, { bar: this.seq || 0, speed: Math.round(player.speed * 100) });
  }
  close(replaced) {
    if (this.closed) return;
    this.saveState();
    this.closed = true;
    player.pause();
    this.setPlaying(false);
    cancelAnimationFrame(this.raf);
    clearInterval(this.practiceTimer);
    this.resizeObserver.disconnect();
    removeEventListener('keydown', this.keys);
    document.removeEventListener('visibilitychange', this.visibility);
    this.store.flush();
    const done = () => { this.root.remove(); for (const url of this.urls) URL.revokeObjectURL(url); };
    this.root.classList.remove('open'); this.root.classList.add('closing');
    if (replaced || reduced()) done(); else setTimeout(done, 320);
    if (!document.querySelector('.reader:not(.closing)')) document.body.classList.remove('reading');
    if (open === this) open = null;
    this.onclose?.();
  }
}
