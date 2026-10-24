// The full-screen player: Nuvio's layout and gestures over Astra's engine.
//
// open() must be called from a tap (it goes full screen). It follows the
// phone's rotation unless the viewer chose landscape or portrait in
// Settings; the rotate button switches for this session. Picture-in-picture
// shrinks the video into the system's floating window while the app stays
// usable. Back closes, in order: a modal or panel, then the player.
//
// Events: 'progress' {time, duration} (every 10 s, on pause and on close),
// 'close' {time, duration, reason}, 'source' {source}, 'episode' {episode}.

import {AstraPlayer, decodeSubtitleBytes} from '../engine/player.js';
import {pushLayer} from '../app/back-stack.js';
import {icon} from '../ui/icons.js';
import {h, clock, haptic} from '../ui/dom.js';
import * as G from './gestures.js';
import {loadPrefs, savePrefs, subtitleStyle, DEFAULTS, SPEEDS, ASPECTS, ASPECT_LABELS, SUBTITLE_COLORS, SUBTITLE_COLOR_NAMES, SUBTITLE_BACKGROUNDS} from './prefs.js';

const coarse = () => matchMedia('(pointer: coarse)').matches;
import {languageName, baseLanguage} from '../engine/languages.js';
import {externalPlayerUrl, canOpenExternally} from './external.js';

const HIDE_AFTER = 3500;
const PAUSE_OVERLAY_AFTER = 5000;
const FEEDBACK_MS = 900;
const SKIP_LABELS = {intro: 'Skip Intro', recap: 'Skip Recap', outro: 'Skip Outro', credits: 'Skip to post-credits'};

const iconButton = (name, label, onclick, extra = {}) => h('button', {class: 'ap-icon-btn', type: 'button', 'aria-label': label, title: label, onclick, ...extra}, icon(name, {text: extra.iconText}));

export class PlayerScreen extends EventTarget {
  /** How long a load runs before the loading screen offers other sources. */
  static SLOW_LOAD_MS = 10000;

  constructor({parent = document.body} = {}) {
    super();
    this.parent = parent;
    this.prefs = loadPrefs();
    this.isOpen = false;
    this.build();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }

  build() {
    const video = this.video = h('video', {class: 'ap-video', playsinline: true, preload: 'auto'});
    video.setAttribute('playsinline', '');
    const subs = this.subsEl = h('div', {class: 'ap-subs'});
    this.engine = new AstraPlayer(video, subs);
    this.engine.addEventListener('status', e => { this.loadingStatus.textContent = e.detail; });
    this.engine.addEventListener('error', e => this.showError(e.detail.message, e.detail.plan, e.detail));
    this.engine.addEventListener('network', e => this.networkState(e.detail));
    this.engine.addEventListener('tracks', () => { this.refreshMenus(); if (this.ready) this.autoSubtitle(); });
    this.engine.addEventListener('ready', () => this.onReady());
    this.engine.addEventListener('filefacts', e => this.emit('fileinfo', e.detail));

    // Feedback
    this.feedback = h('div', {class: 'ap-feedback', 'aria-live': 'polite'});
    this.seekPreview = h('div', {class: 'ap-seek-preview', hidden: true}, h('b'), h('span'));
    this.levelBars = {
      brightness: h('div', {class: 'ap-level left', hidden: true}, h('span'), h('div', {class: 'ap-level-track'}, h('i')), icon('brightness', {size: 20})),
      volume: h('div', {class: 'ap-level right', hidden: true}, h('span'), h('div', {class: 'ap-level-track'}, h('i')), icon('volume', {size: 20})),
    };

    // Loading
    this.loadingArt = h('div', {class: 'ap-loading-art'});
    this.loadingLogo = h('div', {class: 'ap-loading-logo'});
    this.loadingStatus = h('p', {class: 'ap-loading-status', role: 'status'});
    this.loadingInfo = h('p', {class: 'ap-loading-info'});
    this.loadingSlow = h('div', {class: 'ap-loading-slow', hidden: true});
    this.loading = h('div', {class: 'ap-loading'}, this.loadingArt, this.loadingLogo,
      h('div', {class: 'ap-loading-foot'}, this.loadingStatus, this.loadingInfo, this.loadingSlow),
      iconButton('close', 'Close player', () => this.close('user'), {class: 'ap-icon-btn ap-loading-close'}));

    // Controls
    this.titleEl = h('h2', {class: 'ap-title'});
    this.episodeEl = h('p', {class: 'ap-episode-line'});
    this.releaseEl = h('p', {class: 'ap-release'});
    this.viaEl = h('p', {class: 'ap-via'});
    this.played = h('div', {class: 'ap-played'});
    this.buffered = h('div', {class: 'ap-buffered'});
    // A thumb at the play position, and while dragging a time bubble above the finger.
    this.thumb = h('div', {class: 'ap-thumb', 'aria-hidden': 'true'});
    this.bubble = h('div', {class: 'ap-bubble', 'aria-hidden': 'true', hidden: true});
    this.timeline = h('div', {class: 'ap-timeline', role: 'slider', tabindex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0},
      h('div', {class: 'ap-track'}, this.buffered, this.played), this.thumb, this.bubble);
    this.timeEl = h('button', {class: 'ap-time', type: 'button', onclick: () => { this.remaining = !this.remaining; this.updateTime(); }});
    this.playBtn = iconButton('play', 'Play', () => this.togglePlay(), {class: 'ap-icon-btn ap-play'});
    this.spinner = h('div', {class: 'ap-spinner', hidden: true, role: 'progressbar', 'aria-label': 'Loading'});
    this.speedBtn = h('button', {class: 'ap-text-btn', type: 'button', onclick: () => this.cycleSpeed()}, 'Speed 1x');
    this.actions = h('div', {class: 'ap-actions'});
    this.actionButtons = {
      next: iconButton('next', 'Next episode', () => this.playNext()),
      subtitles: iconButton('subtitles', 'Subtitles', () => this.openModal('subtitles')),
      audio: iconButton('audio', 'Audio', () => this.openModal('audio')),
      sources: iconButton('sources', 'Sources', () => this.openPanel('sources')),
      episodes: iconButton('episodes', 'Episodes', () => this.openPanel('episodes')),
      speed: this.speedBtn,
      aspect: iconButton('aspect', 'Picture size', () => this.cycleAspect()),
      info: iconButton('info', 'Stream info', () => this.openModal('info')),
    };
    this.pipBtn = iconButton('pip', 'Picture in picture', () => this.togglePip());
    this.rotateBtn = iconButton('rotate', 'Rotate', () => this.rotate());
    const more = iconButton('chevronRight', 'More', () => this.actions.scrollBy({left: 200, behavior: 'smooth'}), {class: 'ap-icon-btn ap-more'});
    this.actions.addEventListener('scroll', () => more.hidden = this.actions.scrollLeft + this.actions.clientWidth >= this.actions.scrollWidth - 4, {passive: true});
    this.moreBtn = more;
    this.lockBtn = iconButton('lock', 'Lock controls', () => this.setLocked(true));
    this.controls = h('div', {class: 'ap-controls'},
      h('div', {class: 'ap-shade-top'}), h('div', {class: 'ap-shade-bottom'}),
      h('div', {class: 'ap-top'}, this.pipBtn, this.rotateBtn, this.lockBtn, iconButton('back', 'Close player', () => this.close('user'))),
      h('div', {class: 'ap-center'},
        iconButton('replay', 'Back 10 seconds', () => this.seekBy(-10), {class: 'ap-icon-btn ap-side', iconText: '10'}),
        h('div', {class: 'ap-play-wrap'}, this.playBtn),
        iconButton('forward', 'Forward 10 seconds', () => this.seekBy(10), {class: 'ap-icon-btn ap-side', iconText: '10'})),
      h('div', {class: 'ap-bottom'},
        h('div', {class: 'ap-meta'}, this.titleEl, this.episodeEl, this.releaseEl, this.viaEl),
        this.timeline,
        h('div', {class: 'ap-bar'}, h('div', {class: 'ap-actions-wrap'}, this.actions, more), this.timeEl)));

    // Pause overlay, skip, next episode, lock, error
    this.pauseOverlay = h('div', {class: 'ap-pause', hidden: true});
    this.skipFill = h('i');
    this.skipBtn = h('button', {class: 'ap-skip', type: 'button', hidden: true, onclick: () => this.skipSegment()}, icon('skip', {size: 18}), h('span'), this.skipFill);
    this.nextCard = h('div', {class: 'ap-next', hidden: true});
    this.lockOverlay = h('div', {class: 'ap-lock', hidden: true},
      h('button', {class: 'ap-unlock', type: 'button', onclick: e => { e.stopPropagation(); this.setLocked(false); }}, icon('unlock', {size: 34}), h('span', {}, 'Tap to unlock')),
      h('div', {class: 'ap-lock-track'}, this.lockFill = h('div')));
    this.errorCard = h('div', {class: 'ap-error', hidden: true, role: 'alert'});
    this.noticeEl = h('div', {class: 'ap-notice', hidden: true, role: 'status', onclick: () => { this.noticeEl.hidden = true; }});
    // Sound turned all the way down stays visible, and one tap brings it back.
    this.mutedChip = h('button', {class: 'ap-muted', type: 'button', hidden: true, 'aria-label': 'Sound is off. Turn it on', onclick: () => this.unmute()}, icon('mute', {size: 18}), h('span', {}, 'Sound off'));
    this.modal = h('div', {class: 'ap-modal', hidden: true, role: 'dialog', 'aria-modal': 'true'});
    this.panel = h('div', {class: 'ap-panel', hidden: true, role: 'dialog', 'aria-modal': 'true'});

    this.surface = h('div', {class: 'ap-surface'});
    this.root = h('div', {class: 'ap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Player', hidden: true, tabindex: -1},
      video, subs, this.surface, this.pauseOverlay, this.feedback, this.seekPreview, this.levelBars.brightness, this.levelBars.volume,
      this.controls, h('div', {class: 'ap-buffering'}, this.spinner), this.skipBtn, this.nextCard, this.lockOverlay, this.mutedChip, this.noticeEl, this.loading, this.errorCard, this.panel, this.modal);
    this.parent.append(this.root);
    this.bottomEl = this.controls.querySelector('.ap-bottom');
    // Moving through the controls with Tab shows them.
    this.controls.addEventListener('focusin', () => { if (!this.controlsVisible && !this.locked) this.showControls(); });
    const resized = new ResizeObserver(() => this.layout());
    resized.observe(this.root);
    resized.observe(this.bottomEl); // a two-line title or the Via line changes how much room the subtitles need
    video.addEventListener('loadedmetadata', () => this.layout());
    video.addEventListener('resize', () => this.layout());
    // Android leaves full screen on the way into and out of the floating window; those changes are not back.
    this.pipUntil = 0;
    const pipMove = () => { this.pipUntil = performance.now() + 1500; };
    video.addEventListener('enterpictureinpicture', () => {
      pipMove();
      this.root.classList.add('in-pip');
      if (this.isOpen) this.minimize(); // also when Chrome moves it by itself on leaving the app
    });
    video.addEventListener('leavepictureinpicture', () => { pipMove(); this.leftPip(); });
    this.bindVideo();
    this.bindSurface();
    this.bindTimeline();
    this.onKey = e => this.key(e);
    this.onFullscreen = () => this.fullscreenChanged();
    this.onVisibility = () => {
      if (document.visibilityState === 'hidden') this.emitProgress(true, true); // the app may not come back
      else if (!this.video.paused) this.wake(true);
    };
  }

  /**
   * @param {object} o
   * @param {{url: string, headers?: object, subtitles?: Array, name?: string, bingeGroup?: string}} o.stream
   * @param {{title: string, episodeLine?: string, release?: string, description?: string, logo?: string, background?: string, poster?: string}} o.meta
   * @param {number} [o.startTime]
   * @param {Array<{id, label, detail, stream}>} [o.sources]
   * @param {{seasons: number[], season: number, items: Array, current: string}} [o.episodes]
   * @param {{label: string, title: string, thumbnail?: string, hasAired?: boolean}} [o.next]
   * @param {Array<{type: string, start: number, end: number}>} [o.segments]
   */
  open(o) {
    this.options = o;
    this.meta = o.meta || {title: ''};
    this.sources = o.sources || [];
    this.sourceId = o.sourceId ?? this.sources[0]?.id ?? null;
    this.segments = (o.segments || []).filter(s => s.end > s.start);
    // Choices that belong to one title start fresh with the next.
    this.panelSeason = null;
    this.subLang = null;
    this.subTab = 'tracks';
    this.setBrightness(1);
    this.mutedChip.hidden = !(this.video.muted || this.video.volume === 0);
    this.nextDismissed = false;
    this.skipped = new Set();
    this.firstFrame = false;
    this.remaining = false;
    this.lastProgress = 0;
    if (this.minimized) this.restoreFromPip({exit: true});
    if (!this.isOpen) {
      this.isOpen = true;
      this.root.hidden = false;
      // Keyboard focus stays in the player: the app behind it is inert while it is open.
      this.inerted = [...this.parent.children].filter(el => el !== this.root && !el.inert);
      for (const el of this.inerted) el.inert = true;
      document.documentElement.classList.add('ap-open');
      this.popLayer = pushLayer('player', () => { this.popLayer = null; this.close('back'); });
      this.enterFullscreen();
      addEventListener('keydown', this.onKey);
      document.addEventListener('fullscreenchange', this.onFullscreen);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.root.focus({preventScroll: true});
    }
    this.renderMeta();
    this.renderNext();
    this.showLoading(true);
    this.errorCard.hidden = true;
    this.setLocked(false);
    this.closeOverlays();
    this.applyAspect();
    this.engine.subtitles.setStyle(subtitleStyle(this.prefs));
    if (o.deferred) { // the caller resolves the address, then calls load()
      this.stream = o.stream;
      this.engine.reset();
      this.showLoading(true);
      this.loadingStatus.textContent = 'Resolving the stream…';
    } else this.load(o.stream, o.startTime || 0);
    this.showControls();
  }

  load(stream, startTime, {allowSilent = false} = {}) {
    if (!this.loadingSlow.hidden) { this.loadingSince = null; this.loadingSlow.hidden = true; } // another source: count afresh
    this.stream = stream;
    this.loadedFrom = startTime || 0; // where "Try again" resumes when nothing played yet
    this.ready = false;
    this.firstFrame = false;
    this.showLoading(true);
    this.errorCard.hidden = true;
    this.viaEl.textContent = stream.name ? 'Via ' + stream.name.replace(/\s+/g, ' ') : '';
    const prefs = {languages: [...new Set([this.prefs.audioLanguage, ...((navigator.languages || []).map(baseLanguage))].filter(Boolean))], subtitleLanguage: this.prefs.subtitleLanguage || null, allowSilent};
    this.engine.load({url: stream.url, headers: stream.headers || {}, startTime, autoplay: true, prefs, subtitles: stream.subtitles || []});
    this.mediaSession();
  }

  onReady() {
    this.ready = this.engine.mode !== 'unsupported';
    this.refreshMenus();
    this.autoSubtitle();
    // Say so when playback needs the viewer to know something: software decoding, Dolby Vision colours, no sound,
    // or a file Astra cannot read (so no audio choice and no subtitles from inside it).
    const notes = (this.engine.plan?.notes || []).filter(n => /software|Dolby Vision profile \d+ has|without sound|Chrome will play it as-is/.test(n));
    if (notes.length) this.notice(notes.at(-1));
  }

  /** A short message across the top for a few seconds. */
  notice(text) {
    this.noticeEl.textContent = text;
    this.noticeEl.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.noticeEl.hidden = true; }, 7000);
  }

  /** Hands the stream to another app on the phone (VLC, MX Player…). */
  openExternally() {
    const url = externalPlayerUrl(this.stream?.url, {title: [this.meta.title, this.meta.episodeLine].filter(Boolean).join(' · '), position: this.video.currentTime || 0});
    if (!url) return;
    this.video.pause();
    location.href = url;
  }

  /** Subtitles found by add-ons for what is playing; `load` ties them to one file. */
  addSubtitles(list, load) { this.engine.addSubtitleTracks(list, load); }

  /** Loads an .srt, .vtt or .ass file the viewer picks and shows it. */
  pickSubtitleFile() {
    const input = h('input', {type: 'file', accept: '.srt,.vtt,.ass,.ssa,.sub,.txt,text/*', hidden: true});
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file || file.size > 8 << 20) return;
      const text = decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()));
      const id = this.engine.addSubtitleTrack({text, label: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Subtitles', format: file.name, source: 'This phone'});
      const cues = this.engine.cues.get(id) || [];
      if (!cues.length) { this.flash('No subtitles found in that file'); return; }
      this.subLang = 'und';
      this.engine.selectSubtitle(id);
      this.renderModal();
    }, {once: true});
    this.root.append(input);
    input.click();
  }

  /** Whether subtitle add-ons are still being asked (shown in the subtitles menu). */
  setSubtitleSearch(on) { this.subtitleSearch = on; this.refreshMenus(); }

  /**
   * Shows subtitles in the remembered language when nothing is shown yet:
   * the file's own track first, then an exact match for this release, then
   * the first add-on file. Choosing Off in the menu forgets the language.
   */
  autoSubtitle() {
    const want = this.prefs.subtitleLanguage;
    if (!want || !this.ready || this.engine.selectedSubtitle) return;
    const options = this.engine.subtitleOptions().filter(s => s.supported && baseLanguage(s.language) === want);
    const match = options.find(s => !s.forced) || options[0];
    if (match) this.engine.selectSubtitle(match.id);
  }

  close(reason = 'user') {
    if (!this.isOpen) return;
    this.isOpen = false;
    for (const el of this.inerted || []) el.inert = false;
    this.inerted = null;
    const time = this.video.currentTime, duration = this.video.duration || 0;
    this.emit('progress', {time, duration, final: true});
    this.emit('close', {time, duration, reason});
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.popLayer?.(); this.popLayer = null; // also pops an open modal's or panel's entry
    this.closeOverlays(true);
    this.exitFullscreen();
    this.wake(false);
    try { navigator.mediaSession.metadata = null; } catch {}
    if (document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {});
    this.minimized = false;
    this.orientation = null; // a rotate-button choice lasts until the player closes
    this.root.classList.remove('mini', 'in-pip');
    this.engine.reset();
    clearTimeout(this.hideTimer); clearTimeout(this.pauseTimer); clearTimeout(this.feedbackTimer);
    this.root.hidden = true;
    document.documentElement.classList.remove('ap-open');
  }

  // ——— Rendering ———

  renderMeta() {
    const m = this.meta;
    this.titleEl.textContent = m.title || '';
    this.episodeEl.textContent = m.episodeLine || '';
    this.releaseEl.textContent = m.release || '';
    this.loadingArt.style.backgroundImage = m.background ? `url(${JSON.stringify(m.background)})` : '';
    this.loadingLogo.replaceChildren(m.logo ? h('img', {src: m.logo, alt: m.title || '', referrerpolicy: 'no-referrer', onerror: e => e.target.replaceWith(h('span', {}, m.title || ''))}) : h('span', {}, m.title || ''));
    const series = !!this.options.episodes;
    this.actionButtons.episodes.hidden = !series;
    this.actionButtons.sources.hidden = !this.sources.length;
    this.actionButtons.next.hidden = !this.options.next;
    this.pipBtn.hidden = !document.pictureInPictureEnabled;
    this.actions.replaceChildren(...Object.values(this.actionButtons).filter(b => !b.hidden));
    requestAnimationFrame(() => { this.moreBtn.hidden = this.actions.scrollWidth <= this.actions.clientWidth + 4; });
  }

  showLoading(on) {
    this.loading.hidden = !on;
    if (!on) { clearInterval(this.loadingTimer); this.loadingTimer = 0; this.loadingSince = null; this.loadingSlow.hidden = true; this.loadingInfo.textContent = ''; return; }
    this.loadingStatus.textContent = 'Finding the stream…';
    // A load that takes a while says how long and how much has arrived, then offers a way out.
    this.loadingSince ??= performance.now();
    this.loadingTimer ||= setInterval(() => this.loadingTick(), 500);
  }

  loadingTick() {
    const seconds = (performance.now() - this.loadingSince) / 1000, bytes = this.engine.source?.bytesFetched || 0;
    this.loadingInfo.textContent = seconds < 5 ? '' : [`${Math.floor(seconds)} s`, bytes ? `${(bytes / 1e6).toFixed(1)} MB received` : ''].filter(Boolean).join(' · ');
    if (seconds * 1000 < PlayerScreen.SLOW_LOAD_MS || !this.loadingSlow.hidden) return;
    const status = this.loadingStatus.textContent;
    const why = /Resolving/.test(status) ? 'The debrid service is slow to answer.'
      : !bytes ? 'The host has not started sending the file.'
      : 'The host is sending the file slowly.';
    const others = this.sources.some(s => s.id !== this.sourceId);
    const external = canOpenExternally() && externalPlayerUrl(this.stream?.url);
    this.loadingSlow.replaceChildren(h('span', {}, `This is taking a while. ${why}`),
      others || external ? h('div', {class: 'ap-loading-actions'},
        others ? h('button', {class: 'ap-chip', type: 'button', onclick: () => this.openPanel('sources')}, 'Other sources') : null,
        external ? h('button', {class: 'ap-chip', type: 'button', onclick: () => this.openExternally()}, 'Play in another app') : null) : null);
    this.loadingSlow.hidden = false;
  }

  /** The host connection lost and found again: playback goes on from the buffer meanwhile, so this is a notice, not an error. */
  networkState(state) {
    if (state === 'reconnecting') { this.notice('Reconnecting…'); clearTimeout(this.noticeTimer); }
    else if (state === 'connected' && !this.noticeEl.hidden) this.notice('Connected again');
    else if (state === 'lost') this.noticeEl.hidden = true;
  }

  showError(message, plan = null, {network = false} = {}) {
    this.showLoading(false);
    this.noticeEl.hidden = true;
    const report = h('button', {class: 'ap-chip', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(await this.engine.report(), null, 2)); report.textContent = 'Report copied'; } catch { report.textContent = 'Copy failed'; }
    }}, 'Copy report');
    // What can help depends on why it stopped: a lost connection is tried again
    // (from where it stopped), a dead link needs another source, and only a file
    // the browser cannot play is worth another app.
    const connection = network || plan?.retry, gone = !!plan?.gone;
    const external = !connection && !gone && canOpenExternally() && externalPlayerUrl(this.stream?.url);
    const others = this.sources.length > 1, retry = connection || plan?.mode !== 'unsupported';
    const primary = connection ? 'retry' : external ? 'external' : others ? 'sources' : 'retry';
    this.errorCard.replaceChildren(
      h('h3', {}, gone ? 'This link no longer works' : connection ? 'Lost the connection' : plan?.mode === 'unsupported' ? 'Can’t play this here' : 'Playback stopped'), h('p', {}, message),
      external ? h('p', {class: 'ap-error-hint'}, 'Another app on your phone, such as VLC, can play it.') : null,
      h('div', {class: 'ap-error-actions'},
        external ? h('button', {class: 'ap-chip primary', type: 'button', onclick: () => this.openExternally()}, 'Play in another app') : null,
        plan?.silent ? h('button', {class: 'ap-chip', type: 'button', onclick: () => this.load(this.stream, this.video.currentTime || 0, {allowSilent: true})}, 'Play without sound') : null,
        others ? h('button', {class: 'ap-chip' + (primary === 'sources' ? ' primary' : ''), type: 'button', onclick: () => { this.errorCard.hidden = true; this.openPanel('sources'); }}, 'Choose another source') : null,
        retry ? h('button', {class: 'ap-chip' + (primary === 'retry' ? ' primary' : ''), type: 'button', onclick: () => this.load(this.stream, this.video.currentTime || this.loadedFrom || 0)}, 'Try again') : null,
        report,
        h('button', {class: 'ap-chip', type: 'button', onclick: () => this.close('user')}, 'Close')));
    this.errorCard.hidden = false;
    this.showControls(false);
  }

  updateTime() {
    const t = this.scrubTime ?? this.video.currentTime, d = this.video.duration;
    const known = Number.isFinite(d) && d > 0;
    this.timeEl.textContent = !known ? clock(t) : this.remaining ? '−' + clock(d - t) : `${clock(t)} / ${clock(d)}`;
    if (known) {
      this.played.style.transform = `scaleX(${Math.min(1, t / d)})`;
      this.thumb.style.left = `${(Math.min(1, t / d) * 100).toFixed(2)}%`;
      this.lockFill.style.transform = `scaleX(${Math.min(1, t / d)})`;
      const b = this.video.buffered;
      let end = 0;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= this.video.currentTime + 0.5) end = Math.max(end, b.end(i));
      this.buffered.style.transform = `scaleX(${Math.min(1, end / d)})`;
      this.timeline.setAttribute('aria-valuemax', Math.round(d));
      this.timeline.setAttribute('aria-valuenow', Math.round(t));
      this.timeline.setAttribute('aria-valuetext', `${clock(t)} of ${clock(d)}`);
    }
    this.updateSkip(t);
    this.updateNext(t, d);
  }

  updatePlayState() {
    const paused = this.video.paused;
    const btn = this.playBtn;
    btn.replaceChildren(icon(paused ? 'play' : 'pause', {size: 34}));
    btn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    btn.title = paused ? 'Play' : 'Pause';
    this.viaEl.classList.toggle('off', !paused); // hidden but keeping its room, so the title does not jump
    this.root.classList.toggle('paused', paused);
  }

  /**
   * Waiting for data: a spinner of its own, over the picture whether or not
   * the controls show, after 400 ms (a short wait shows nothing). The controls
   * are left as they are, so a double-tap seek or a slow host does not keep
   * popping them up.
   */
  setBuffering(on) {
    this.buffering = on;
    clearTimeout(this.bufferTimer);
    if (on) this.bufferTimer = setTimeout(() => { this.spinner.hidden = false; this.playBtn.hidden = true; }, 400);
    else { this.spinner.hidden = true; this.playBtn.hidden = false; this.scheduleHide(); }
  }

  // ——— Controls visibility ———

  showControls(autoHide = true) {
    if (this.locked) return;
    this.controlsVisible = true;
    this.root.classList.add('controls');
    this.pauseOverlay.hidden = true;
    this.skipHiddenByTimer = false;
    if (autoHide) this.scheduleHide(); else clearTimeout(this.hideTimer); // an earlier timer must not hide what should stay
    this.updateSkip(this.video.currentTime);
  }

  hideControls() {
    this.controlsVisible = false;
    this.root.classList.remove('controls');
    clearTimeout(this.hideTimer);
    if (this.video.paused && this.prefs.pauseOverlay) this.schedulePauseOverlay();
  }

  scheduleHide() {
    clearTimeout(this.hideTimer);
    if (this.video.paused || this.buffering || this.scrubbing || this.modalName || this.panelName || !this.errorCard.hidden) return;
    this.hideTimer = setTimeout(() => this.hideControls(), HIDE_AFTER);
  }

  schedulePauseOverlay() {
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      if (!this.video.paused || this.controlsVisible || this.locked || this.modalName || this.panelName || !this.firstFrame) return;
      const m = this.meta;
      this.pauseOverlay.replaceChildren(h('div', {class: 'ap-pause-text'},
        h('p', {class: 'ap-pause-kicker'}, "You're watching"),
        m.logo ? h('img', {src: m.logo, alt: m.title || '', referrerpolicy: 'no-referrer'}) : h('h3', {}, m.title || ''),
        m.episodeLine ? h('p', {class: 'ap-pause-episode'}, m.episodeLine) : null,
        m.description ? h('p', {class: 'ap-pause-description'}, m.description) : null));
      this.pauseOverlay.hidden = false;
    }, PAUSE_OVERLAY_AFTER);
  }

  flash(text, {kind = 'center'} = {}) {
    this.feedback.textContent = text;
    this.feedback.className = 'ap-feedback show ' + kind;
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => { this.feedback.className = 'ap-feedback'; }, FEEDBACK_MS);
  }

  // ——— Playback actions ———

  togglePlay() {
    if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause();
    this.showControls();
  }

  seekBy(seconds) {
    const d = this.video.duration || Infinity;
    this.video.currentTime = Math.max(0, Math.min(d - 0.5, this.video.currentTime + seconds));
    this.updateTime();
  }

  cycleSpeed() {
    const i = SPEEDS.indexOf(this.video.playbackRate);
    this.video.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
    this.speedBtn.textContent = `Speed ${this.video.playbackRate}x`;
    this.flash(`${this.video.playbackRate}x`);
    this.showControls();
  }

  cycleAspect() {
    this.prefs.aspect = ASPECTS[(ASPECTS.indexOf(this.prefs.aspect) + 1) % ASPECTS.length];
    savePrefs(this.prefs);
    this.applyAspect();
    this.flash(ASPECT_LABELS[this.prefs.aspect]);
    this.showControls();
  }

  applyAspect() { this.video.dataset.aspect = this.prefs.aspect; this.layout(); }

  /**
   * Portrait or landscape class, and the subtitle layer fitted to the picture
   * (in portrait the picture is a band across the middle of the screen).
   */
  layout() {
    const W = this.root.clientWidth, H = this.root.clientHeight, vw = this.video.videoWidth, vh = this.video.videoHeight;
    this.root.classList.toggle('portrait', H > W);
    // Skip, the next-episode card and lifted subtitles sit above the controls' measured bottom block.
    const bottomH = this.bottomEl?.offsetHeight || 0;
    this.root.style.setProperty('--ap-bottom-h', bottomH + 'px');
    const box = this.subsEl.style;
    let pictureBottom = H;
    if (!W || !H || !vw || !vh || this.prefs.aspect !== 'fit') box.left = box.top = box.width = box.height = '';
    else {
      const scale = Math.min(W / vw, H / vh), w = vw * scale, h = vh * scale;
      pictureBottom = (H + h) / 2;
      Object.assign(box, {left: ((W - w) / 2).toFixed(1) + 'px', top: ((H - h) / 2).toFixed(1) + 'px', width: w.toFixed(1) + 'px', height: h.toFixed(1) + 'px'});
    }
    // Portrait with room under the picture: subtitles go there, in the black,
    // clear of the picture and of the buttons over it.
    const below = H > W && H - pictureBottom - bottomH > 110;
    this.root.classList.toggle('subs-below', below);
    // Otherwise, when the controls show, bottom subtitles rise just clear of them.
    const zone = this.subsEl.querySelector('.astra-subs-zone.bottom');
    const zoneBottom = pictureBottom - (zone ? parseFloat(getComputedStyle(zone).bottom) || 0 : 0);
    this.root.style.setProperty('--ap-sub-lift', Math.max(0, Math.round(zoneBottom - (H - bottomH - 8))) + 'px');
  }

  /** Locks the screen to the viewer's choice; 'auto' follows the phone. Needs full screen. */
  lockOrientation(kind = this.prefs.orientation, {announce = false} = {}) {
    this.orientation = kind;
    const failed = () => { if (announce) this.flash('This screen cannot be turned from here'); };
    try {
      if (kind !== 'landscape' && kind !== 'portrait') { screen.orientation?.unlock?.(); return; }
      if (!screen.orientation?.lock) return failed();
      screen.orientation.lock(kind).then(() => { if (announce) this.flash(kind === 'landscape' ? 'Landscape' : 'Portrait'); }, failed);
    } catch { failed(); }
  }

  /** Turns the player to the other orientation for this session. */
  rotate() {
    const target = this.root.clientHeight > this.root.clientWidth ? 'landscape' : 'portrait';
    if (document.fullscreenElement) this.lockOrientation(target, {announce: true});
    else this.enterFullscreen(target, {announce: true});
    this.showControls();
  }

  /**
   * Picture-in-picture: the video moves to the system's floating window and
   * the player gets out of the way so the app can be used; tapping the
   * window's expand control brings the player back.
   */
  async togglePip() {
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
    this.pipUntil = performance.now() + 3000;
    try {
      await this.video.requestPictureInPicture();
      this.minimize();
    } catch { this.pipUntil = 0; this.flash('Picture-in-picture is not available here'); }
  }

  minimize() {
    if (this.minimized || !this.isOpen) return;
    this.minimized = true;
    this.closeOverlays(true);
    this.wantFullscreen = false;
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    this.root.classList.add('mini');
    document.documentElement.classList.remove('ap-open');
    const pop = this.popLayer; this.popLayer = null; pop?.(); // back belongs to the app again
    removeEventListener('keydown', this.onKey);
  }

  /**
   * The floating window went away. Closing it (Chrome pauses the video just
   * before) ends playback; expanding it brings the player back, paused or not.
   */
  leftPip() {
    this.root.classList.remove('in-pip');
    if (!this.minimized) return;
    // Decided a moment later: the pause that comes with closing may be dispatched just after this event.
    setTimeout(() => {
      if (!this.minimized) return;
      const closed = this.video.ended || (this.video.paused && performance.now() - (this.pausedAt || 0) < 400);
      if (closed) { this.minimized = false; this.root.classList.remove('mini'); this.close('pip'); return; }
      this.restoreFromPip();
    });
  }

  restoreFromPip({exit = false} = {}) {
    if (!this.minimized) return;
    this.minimized = false;
    if (exit && document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {});
    this.root.classList.remove('mini');
    document.documentElement.classList.add('ap-open');
    if (!this.popLayer) this.popLayer = pushLayer('player', () => { this.popLayer = null; this.close('back'); });
    addEventListener('keydown', this.onKey);
    this.wantFullscreen = true; // the next tap goes full screen again
    this.showControls();
  }

  setLocked(on) {
    this.locked = on;
    this.root.classList.toggle('locked', on);
    this.lockOverlay.hidden = true;
    if (on) { this.closeOverlays(); this.hideControls(); this.flash('Controls locked'); }
    else this.showControls();
  }

  showLockHint() {
    this.lockOverlay.hidden = false;
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => { this.lockOverlay.hidden = true; }, 2000);
  }

  // ——— Skip segments and next episode ———

  activeSegment(t) { return this.segments.find(s => t >= s.start && t < s.end - 0.5 && !this.skipped.has(s)); }

  updateSkip(t) {
    const seg = this.activeSegment(t);
    if (!seg || this.locked) { this.skipBtn.hidden = true; this.skipSegmentShown = null; return; }
    if (this.skipSegmentShown !== seg) {
      this.skipSegmentShown = seg;
      this.skipShownAt = performance.now();
      this.skipHiddenByTimer = false;
      this.skipBtn.querySelector('span').textContent = SKIP_LABELS[seg.type] || 'Skip';
    }
    // Without the controls, the button stays for 10 s, then waits for the controls.
    const age = performance.now() - this.skipShownAt;
    if (!this.controlsVisible && age > 10000) this.skipHiddenByTimer = true;
    this.skipBtn.hidden = this.skipHiddenByTimer && !this.controlsVisible;
    this.skipFill.style.transform = `scaleX(${this.controlsVisible ? 0 : Math.min(1, age / 10000)})`;
  }

  skipSegment() {
    const seg = this.activeSegment(this.video.currentTime);
    if (!seg) return;
    this.skipped.add(seg);
    this.video.currentTime = Math.min(seg.end, (this.video.duration || seg.end) - 0.5);
    this.skipBtn.hidden = true;
  }

  renderNext() {
    const n = this.options.next;
    if (!n) { this.nextCard.hidden = true; return; }
    const card = this.nextCard;
    card.replaceChildren(
      n.thumbnail ? h('img', {src: n.thumbnail, alt: '', referrerpolicy: 'no-referrer'}) : h('div', {class: 'ap-next-thumb'}),
      h('div', {class: 'ap-next-text'}, h('small', {}, 'Next Episode'), h('b', {}, n.label + (n.title ? ' • ' + n.title : '')),
        n.status || n.hasAired === false ? h('span', {}, n.status || 'Not out yet') : null),
      h('button', {class: 'ap-next-play', type: 'button', 'aria-label': `Play ${n.label}${n.title ? ', ' + n.title : ''}`, onclick: () => this.playNext(), disabled: n.hasAired === false}, icon('play', {size: 16}), 'Play'),
      h('button', {class: 'ap-next-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => { this.nextDismissed = true; card.hidden = true; }}, icon('close', {size: 16})));
    let startX = null;
    card.onpointerdown = e => { startX = e.clientX; };
    card.onpointerup = e => { if (startX != null && e.clientX - startX >= 60) { this.nextDismissed = true; card.hidden = true; } startX = null; };
  }

  updateNext(t, d) {
    if (!this.options.next || this.nextDismissed || !(d > 120)) { this.nextCard.hidden = true; return; }
    const outro = this.segments.find(s => (s.type === 'outro' || s.type === 'credits') && d - s.end < 30);
    const at = outro ? outro.start : d * 0.99;
    const credits = this.segments.some(s => s.type === 'postcredits' && t >= s.start);
    this.nextCard.hidden = t < at || credits;
  }

  playNext() {
    const n = this.options.next;
    if (n?.hasAired === false) { this.flash(`${n.label} is not out yet`); return; }
    this.emit('next', {time: this.video.currentTime});
  }

  unmute() {
    if (this.video.volume === 0) this.video.volume = 1;
    this.video.muted = false;
    this.mutedChip.hidden = true;
    this.flash('Sound on');
  }

  // ——— Modals and panels ———

  openModal(name) {
    this.closeOverlays();
    this.modalName = name;
    this.modalClose = pushLayer('player-modal', () => { this.modalClose = null; this.closeOverlays(); });
    this.renderModal();
    this.modal.hidden = false;
    this.modal.setAttribute('aria-label', {audio: 'Audio', subtitles: 'Subtitles', info: 'Stream info'}[name] || name);
    this.root.classList.add('overlay');
    this.showControls(false);
    this.focusOverlay(this.modal);
  }

  openPanel(name) {
    this.closeOverlays();
    this.panelName = name;
    this.panelClose = pushLayer('player-panel', () => { this.panelClose = null; this.closeOverlays(); });
    this.renderPanel();
    this.panel.hidden = false;
    this.panel.setAttribute('aria-label', name === 'sources' ? 'Sources' : 'Episodes');
    this.root.classList.add('overlay');
    this.showControls(false);
    // The current source or episode is in view, not a screen or two down the list.
    this.panel.querySelector('.current')?.scrollIntoView({block: 'center'});
    this.focusOverlay(this.panel);
  }

  /** Moves focus into a menu or panel (the current row, else its first button); closing gives it back. */
  focusOverlay(el) {
    this.returnFocus ??= document.activeElement;
    (el.querySelector('.current, [aria-pressed="true"], .on') || el.querySelector('button'))?.focus({preventScroll: true});
  }

  closeOverlays(silent = false) {
    const wasOpen = !!(this.modalName || this.panelName);
    if (this.modalName) { this.modalName = null; this.modal.hidden = true; this.modalClose?.(); this.modalClose = null; }
    if (this.panelName) { this.panelName = null; this.panel.hidden = true; this.panelClose?.(); this.panelClose = null; }
    if (wasOpen && this.returnFocus?.isConnected) this.returnFocus.focus({preventScroll: true});
    this.returnFocus = null;
    this.root.classList.remove('overlay');
    if (!silent) this.scheduleHide();
  }

  refreshMenus() {
    if (this.modalName) this.renderModal();
    const subs = this.engine.subtitleOptions();
    this.actionButtons.subtitles.classList.toggle('on', subs.some(s => s.selected));
  }

  renderModal() {
    const name = this.modalName;
    const close = iconButton('close', 'Close', () => this.closeOverlays(), {class: 'ap-icon-btn ap-modal-close'});
    let body;
    if (name === 'audio') body = this.audioModal();
    else if (name === 'subtitles') body = this.subtitleModal();
    else body = this.infoModal();
    // Redrawn after every tap: the lists stay where they were scrolled, and keyboard focus stays on its button.
    const kept = this.modal.hidden ? [] : [...this.modal.querySelectorAll('.ap-modal-body, .ap-rail')].map(el => ['.' + [...el.classList].join('.'), el.scrollTop]);
    const key = el => el.getAttribute('aria-label') || el.textContent;
    const focused = this.modal.contains(document.activeElement) && document.activeElement.matches('button') ? key(document.activeElement) : null;
    // Picking tracks hides the picture; styling leaves it showing, so the change can be seen.
    const scrim = 'ap-modal-scrim' + (name !== 'subtitles' ? '' : this.subTab === 'style' ? ' preview' : ' solid');
    this.modal.replaceChildren(h('div', {class: scrim, onclick: () => this.closeOverlays()}), h('div', {class: 'ap-modal-body ' + name}, close, body));
    for (const [selector, top] of kept) { const el = this.modal.querySelector(selector); if (el) el.scrollTop = top; }
    if (focused != null) [...this.modal.querySelectorAll('button')].find(b => key(b) === focused)?.focus({preventScroll: true});
  }

  pickLanguage(code) {
    this.subLang = code;
    this.renderModal();
    // Stacked in portrait, the tracks are under the languages: bring them up.
    if (this.root.classList.contains('portrait')) this.modal.querySelector('.ap-rail.tracks')?.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }

  audioModal() {
    const options = this.engine.audioOptions();
    const rows = options.length ? options.map(a => h('button', {
      class: 'ap-row' + (a.selected ? ' selected' : ''), type: 'button', disabled: !a.supported, 'aria-pressed': String(a.selected),
      onclick: () => { this.engine.selectAudio(a.id); this.prefs.audioLanguage = baseLanguage(a.language); savePrefs(this.prefs); },
    }, h('span', {class: 'ap-row-text'}, h('b', {}, a.label), a.supported ? (a.delivery === 'rebuilt' ? h('small', {}, 'Converted on this device') : null) : h('small', {}, a.reason || 'Not playable here')), a.selected ? icon('check', {size: 20}) : null))
      : [h('p', {class: 'ap-empty'}, this.engine.mode === 'native' ? 'This source plays directly in Chrome, which does not let pages choose its audio track.' : 'No other audio tracks.')];
    return [h('h3', {}, 'Audio'), h('div', {class: 'ap-rail wide'}, ...rows)];
  }

  subtitleModal() {
    const options = this.engine.subtitleOptions();
    // Languages in a useful order: the remembered one, the phone's own, then A to Z (Unknown last).
    const wanted = [baseLanguage(this.prefs.subtitleLanguage), ...navigator.languages.map(baseLanguage)].filter(Boolean);
    const rank = code => code === 'und' ? 1e4 : wanted.includes(code) ? wanted.indexOf(code) : 100;
    const langs = [...new Set(options.map(s => baseLanguage(s.language) || 'und'))]
      .sort((a, b) => rank(a) - rank(b) || (languageName(a) || a).localeCompare(languageName(b) || b));
    const selected = options.find(s => s.selected);
    this.subLang ??= selected ? baseLanguage(selected.language) || 'und' : langs[0] || null;
    if (this.subLang && !langs.includes(this.subLang)) this.subLang = langs[0] || null;
    const langName = code => code === 'und' ? 'Unknown' : languageName(code) || code;
    const languageRail = h('div', {class: 'ap-rail languages'},
      h('button', {class: 'ap-row' + (!selected ? ' selected' : ''), type: 'button', 'aria-pressed': String(!selected), onclick: () => { this.engine.selectSubtitle(null); this.prefs.subtitleLanguage = ''; savePrefs(this.prefs); }}, h('b', {}, 'Off'), !selected ? icon('check', {size: 20}) : null),
      ...langs.map(code => h('button', {class: 'ap-row' + (code === this.subLang ? ' current' : ''), type: 'button', 'aria-pressed': String(code === this.subLang), onclick: () => this.pickLanguage(code)}, h('b', {}, langName(code)), h('small', {}, String(options.filter(s => (baseLanguage(s.language) || 'und') === code).length)))),
      h('button', {class: 'ap-row file', type: 'button', onclick: () => this.pickSubtitleFile()}, icon('plus', {size: 18}), h('b', {}, 'From this phone…')));
    const trackRail = h('div', {class: 'ap-rail tracks'}, ...options.filter(s => (baseLanguage(s.language) || 'und') === this.subLang).map(s => h('button', {
      class: 'ap-row' + (s.selected ? ' selected' : ''), type: 'button', disabled: !s.supported, 'aria-pressed': String(!!s.selected),
      onclick: () => { this.engine.selectSubtitle(s.id); this.prefs.subtitleLanguage = baseLanguage(s.language); savePrefs(this.prefs); },
    }, h('span', {class: 'ap-row-text'}, h('b', {}, s.label), s.name ? h('small', {class: 'ap-file'}, s.name) : null,
      h('span', {class: 'ap-tags'}, h('em', {}, s.kind === 'embedded' ? (s.image ? 'Built-in picture' : 'Built-in') : s.kind === 'stream' ? 'Stream' : s.source || 'Add-on'),
        s.exact ? h('em', {class: 'good'}, 'Exact match') : null, s.forced ? h('em', {}, 'Forced') : null, s.loading ? h('em', {}, 'Loading…') : null),
      !s.supported ? h('small', {}, s.reason || '') : null), s.selected ? icon('check', {size: 20}) : null)));
    if (!options.length) trackRail.append(h('p', {class: 'ap-empty'}, this.subtitleSearch ? 'Looking for subtitles…'
      : this.engine.mode === 'native' && !this.engine.readable ? 'This host does not let Astra read the file, so subtitles inside it cannot be shown. Subtitles from your add-ons still appear here, and you can load a file from this phone.'
      : 'No subtitles for this source.'));
    else if (this.subtitleSearch) trackRail.append(h('p', {class: 'ap-empty small'}, 'Still asking subtitle add-ons…'));
    const tab = this.subTab === 'style' ? 'style' : 'tracks';
    const tabs = h('div', {class: 'ap-tabs', role: 'tablist'}, ...[['tracks', 'Tracks'], ['style', 'Style']].map(([id, label]) =>
      h('button', {class: 'ap-tab' + (id === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { this.subTab = id; this.renderModal(); this.modal.querySelector('.ap-modal-body').scrollTop = 0; }}, label)));
    return [h('div', {class: 'ap-modal-head'}, h('h3', {}, 'Subtitles'), tabs),
      tab === 'style' ? h('div', {class: 'ap-rails'}, this.styleRail()) : h('div', {class: 'ap-rails'}, languageRail, trackRail)];
  }

  styleRail() {
    const p = this.prefs, r = this.engine.subtitles;
    const save = () => { savePrefs(p); r.setStyle(subtitleStyle(p)); this.renderModal(); };
    const stepper = (label, value, minus, plus, reset) => h('div', {class: 'ap-step'}, h('span', {}, label),
      h('div', {}, h('button', {class: 'ap-chip', type: 'button', 'aria-label': label + ' down', onclick: minus}, '−'), h('b', {}, value), h('button', {class: 'ap-chip', type: 'button', 'aria-label': label + ' up', onclick: plus}, '+'),
        reset ? h('button', {class: 'ap-chip ghost', type: 'button', onclick: reset}, 'Reset') : null));
    const delay = r.delay;
    // Two groups: side by side in landscape, so nothing hides below the fold.
    return h('div', {class: 'ap-rail style'}, h('div', {class: 'ap-style-group'},
      stepper('Delay', `${delay > 0 ? '+' : ''}${delay.toFixed(1)} s`, () => { r.setDelay(Math.max(-60, delay - 0.1)); this.renderModal(); }, () => { r.setDelay(Math.min(60, delay + 0.1)); this.renderModal(); }, delay ? () => { r.setDelay(0); this.renderModal(); } : null),
      stepper('Size', String(p.subtitleSize), () => { p.subtitleSize = Math.max(12, p.subtitleSize - 2); save(); }, () => { p.subtitleSize = Math.min(40, p.subtitleSize + 2); save(); }),
      stepper('Position', String(p.subtitleOffset), () => { p.subtitleOffset = Math.max(0, p.subtitleOffset - 5); save(); }, () => { p.subtitleOffset = Math.min(200, p.subtitleOffset + 5); save(); }),
      h('div', {class: 'ap-toggles'},
        h('button', {class: 'ap-chip' + (p.subtitleBold ? ' on' : ''), type: 'button', 'aria-pressed': String(p.subtitleBold), onclick: () => { p.subtitleBold = !p.subtitleBold; save(); }}, 'Bold'),
        h('button', {class: 'ap-chip' + (p.subtitleOutline ? ' on' : ''), type: 'button', 'aria-pressed': String(p.subtitleOutline), onclick: () => { p.subtitleOutline = !p.subtitleOutline; save(); }}, 'Outline'))),
      h('div', {class: 'ap-style-group'},
      h('span', {class: 'ap-label'}, 'Text colour'),
      h('div', {class: 'ap-swatches'}, ...SUBTITLE_COLORS.map(c => h('button', {class: 'ap-swatch' + (c === p.subtitleColor ? ' on' : ''), type: 'button', 'aria-label': SUBTITLE_COLOR_NAMES[c] || c, 'aria-pressed': String(c === p.subtitleColor), style: {background: c}, onclick: () => { p.subtitleColor = c; save(); }}))),
      h('span', {class: 'ap-label'}, 'Background'),
      h('div', {class: 'ap-swatches'}, ...SUBTITLE_BACKGROUNDS.map(a => h('button', {class: 'ap-swatch bg' + (a === p.subtitleBackground ? ' on' : ''), type: 'button', 'aria-label': a ? `Background ${Math.round(a * 100)}%` : 'No background', 'aria-pressed': String(a === p.subtitleBackground), style: {background: a ? `rgba(0,0,0,${a})` : 'transparent'}, onclick: () => { p.subtitleBackground = a; save(); }}))),
      h('button', {class: 'ap-chip ghost', type: 'button', onclick: () => { for (const k of ['subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleOutline', 'subtitleBold', 'subtitleOffset']) p[k] = DEFAULTS[k]; r.setDelay(0); save(); }}, 'Reset defaults')));
  }

  infoModal() {
    const e = this.engine, info = e.info, plan = e.plan;
    const rows = [['How it plays', {native: 'Directly in Chrome', remux: 'Unpacked by Astra', software: 'Decoded by Astra (software)', hls: 'HLS stream', dash: 'DASH stream', unsupported: 'Not playable'}[e.mode] || '—']];
    if (info?.video?.[0]) rows.push(['Video', [info.video[0].label, info.video[0].width && `${info.video[0].width}×${info.video[0].height}`, info.video[0].hdr && 'HDR'].filter(Boolean).join(' · ')]);
    const audio = e.audioOptions().find(a => a.selected);
    if (audio) rows.push(['Audio', audio.label + (audio.delivery === 'rebuilt' ? ' (converted)' : '')]);
    if (info?.container) rows.push(['File', info.container + (info.size ? ' · ' + (info.size / 1e9).toFixed(2) + ' GB' : '')]);
    const q = this.video.getVideoPlaybackQuality?.();
    if (q) rows.push(['Frames', `${q.totalVideoFrames} shown, ${q.droppedVideoFrames} dropped`]);
    if (this.video.videoWidth) rows.push(['Picture', `${this.video.videoWidth}×${this.video.videoHeight}`]);
    for (const n of plan?.notes || []) rows.push(['Note', n]);
    const external = canOpenExternally() && externalPlayerUrl(this.stream?.url);
    return [h('h3', {}, 'Stream info'), h('dl', {class: 'ap-info'}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      external ? h('button', {class: 'ap-chip', type: 'button', onclick: () => this.openExternally()}, 'Play in another app') : null];
  }

  renderPanel() {
    const name = this.panelName;
    let body;
    if (name === 'sources') {
      body = [h('h3', {}, 'Sources'), h('div', {class: 'ap-panel-list'}, ...this.sources.map(s => h('button', {
        class: 'ap-source' + (s.id === this.sourceId ? ' current' : ''), type: 'button',
        onclick: () => { if (s.id === this.sourceId) return this.closeOverlays(); this.sourceId = s.id; this.closeOverlays(); this.emit('source', {source: s}); this.load(s.stream, this.video.currentTime || 0); },
      }, h('b', {}, s.label), s.detail ? h('span', {}, s.detail) : null)))];
    } else {
      const ep = this.options.episodes;
      const season = this.panelSeason ?? ep.season;
      body = [h('h3', {}, 'Episodes'),
        h('div', {class: 'ap-seasons'}, ...ep.seasons.map(s => h('button', {class: 'ap-chip' + (s === season ? ' on' : ''), type: 'button', onclick: () => { this.panelSeason = s; this.renderPanel(); }}, s === 0 ? 'Specials' : 'Season ' + s))),
        h('div', {class: 'ap-panel-list'}, ...ep.items.filter(i => i.season === season).map(i => h('button', {
          class: 'ap-episode' + (i.id === ep.current ? ' current' : ''), type: 'button',
          onclick: () => { this.closeOverlays(); this.emit('episode', {episode: i}); },
        }, i.thumbnail ? h('img', {src: i.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer'}) : h('div', {class: 'ap-episode-thumb'}),
        h('span', {}, h('small', {}, `E${i.episode}`), h('b', {}, i.title || 'Episode ' + i.episode))))) ];
    }
    this.panel.replaceChildren(h('div', {class: 'ap-modal-scrim', onclick: () => this.closeOverlays()}),
      h('div', {class: 'ap-panel-body'}, iconButton('close', 'Close', () => this.closeOverlays(), {class: 'ap-icon-btn ap-modal-close'}), body));
  }

  // ——— Video, surface and timeline wiring ———

  bindVideo() {
    const v = this.video;
    v.addEventListener('playing', () => {
      if (!this.firstFrame) { this.firstFrame = true; this.showLoading(false); this.showControls(); }
      this.setBuffering(false); this.updatePlayState(); this.wake(true);
    });
    v.addEventListener('waiting', () => { if (this.firstFrame) this.setBuffering(true); });
    v.addEventListener('pause', () => {
      this.pausedAt = performance.now();
      this.updatePlayState(); this.wake(false); this.showControls(false); this.emitProgress(true);
    });
    v.addEventListener('play', () => { this.updatePlayState(); this.scheduleHide(); });
    v.addEventListener('volumechange', () => { this.mutedChip.hidden = !(v.muted || v.volume === 0); });
    v.addEventListener('timeupdate', () => { this.updateTime(); this.emitProgress(false); this.positionState(); });
    v.addEventListener('progress', () => this.updateTime());
    v.addEventListener('durationchange', () => this.updateTime());
    v.addEventListener('ratechange', () => { this.speedBtn.textContent = `Speed ${this.holding ? this.holdBase : v.playbackRate}x`; });
    v.addEventListener('ended', () => { this.showControls(false); this.emitProgress(true); });
  }

  emitProgress(force, final = false) {
    const now = performance.now();
    if (!force && now - this.lastProgress < 10000) return;
    this.lastProgress = now;
    if (this.video.currentTime > 0) this.emit('progress', {time: this.video.currentTime, duration: this.video.duration || 0, final});
  }

  bindSurface() {
    const s = this.surface;
    let p = null, lastTap = null, streak = null, tapTimer = 0;
    const rect = () => s.getBoundingClientRect();
    s.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = rect();
      p = {id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height, t: performance.now(), kind: null, moved: false};
      s.setPointerCapture(e.pointerId);
      if (this.locked) return;
      if (this.prefs.gestures && !this.video.paused) p.hold = setTimeout(() => { p.kind = 'hold'; this.startHold(); }, G.HOLD_MS);
    });
    s.addEventListener('pointermove', e => {
      if (!p || e.pointerId !== p.id || this.locked) return;
      const r = rect(), x = e.clientX - r.left, y = e.clientY - r.top, dx = x - p.x, dy = y - p.y;
      if (!p.kind) {
        const kind = this.prefs.gestures ? G.classifyDrag({dx, dy, startX: p.x, startY: p.y, width: p.w, height: p.h}) : null;
        if (kind) { clearTimeout(p.hold); p.kind = kind; this.startDrag(p); }
      }
      if (p.kind === 'seek') this.dragSeek(p, dx);
      else if (p.kind === 'brightness' || p.kind === 'volume') this.dragLevel(p, dy);
    });
    const end = e => {
      if (!p || e.pointerId !== p.id) return;
      clearTimeout(p.hold);
      const done = p; p = null;
      if (this.locked) { this.showLockHint(); return; }
      if (done.kind === 'hold') return this.endHold();
      if (done.kind === 'seek') return this.endSeekDrag(e.type === 'pointercancel');
      if (done.kind === 'brightness' || done.kind === 'volume') return this.endLevel(done.kind);
      if (done.kind === 'none' || e.type === 'pointercancel') return;
      // A tap.
      const zone = G.zoneOf(done.x, done.w), now = performance.now();
      if (this.prefs.gestures && zone !== 'center' && streak && streak.zone === zone && now - streak.t < G.STREAK_MS) {
        streak.t = now; streak.total += zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP;
        this.seekBy(zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP); this.flash(G.deltaLabel(streak.total), {kind: zone}); haptic(8);
        return;
      }
      if (this.prefs.gestures && zone !== 'center' && lastTap && lastTap.zone === zone && now - lastTap.t < G.DOUBLE_TAP_MS) {
        clearTimeout(tapTimer); lastTap = null;
        const step = zone === 'left' ? -G.SEEK_STEP : G.SEEK_STEP;
        streak = {zone, t: now, total: step};
        this.seekBy(step); this.flash(G.deltaLabel(step), {kind: zone}); haptic(8);
        return;
      }
      streak = null;
      if (zone === 'center' || !this.prefs.gestures) { this.tapSurface(zone); return; }
      lastTap = {zone, t: now};
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { lastTap = null; this.tapSurface(zone); }, G.DOUBLE_TAP_MS);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('contextmenu', e => e.preventDefault());
  }

  tapSurface(zone) {
    // Full screen is lost after picture-in-picture; a tap (a user gesture) restores it.
    if (this.wantFullscreen && !document.fullscreenElement && !this.minimized && coarse()) this.enterFullscreen();
    if (this.modalName || this.panelName) return this.closeOverlays();
    if (!this.controlsVisible) this.showControls();
    else if (zone === 'center' || this.firstFrame) this.hideControls();
  }

  startHold() {
    this.holding = true;
    this.holdBase = this.video.playbackRate;
    this.video.playbackRate = this.prefs.holdSpeed;
    this.feedback.textContent = `${this.prefs.holdSpeed}x ▸▸`;
    this.feedback.className = 'ap-feedback show hold';
    haptic(15);
  }

  endHold() {
    this.holding = false;
    this.video.playbackRate = this.holdBase || 1;
    this.feedback.className = 'ap-feedback';
  }

  startDrag(p) {
    if (p.kind === 'seek') { p.from = this.video.currentTime; this.scrubbing = true; this.root.classList.add('seeking'); this.showControls(false); }
    else {
      p.level = p.kind === 'volume' ? (this.video.muted ? 0 : this.video.volume) : (this.brightness ?? 1);
      this.levelBars[p.kind].hidden = false;
    }
  }

  dragSeek(p, dx) {
    const d = this.video.duration || 0;
    const target = G.swipeTarget(p.from, dx, p.w, d);
    this.scrubTime = target;
    const [b, span] = this.seekPreview.children;
    b.textContent = clock(target);
    span.textContent = G.deltaLabel(target - p.from);
    span.className = target >= p.from ? 'fwd' : 'back';
    this.seekPreview.hidden = false;
    this.updateTime();
  }

  endSeekDrag(cancelled) {
    if (!cancelled && this.scrubTime != null) this.video.currentTime = this.scrubTime;
    this.scrubTime = null; this.scrubbing = false;
    this.root.classList.remove('seeking');
    this.seekPreview.hidden = true;
    this.updateTime(); this.scheduleHide();
  }

  dragLevel(p, dy) {
    const max = p.kind === 'brightness' ? 1.5 : 1;
    const value = G.dragLevel(p.level, dy, p.h, max);
    if (p.kind === 'volume') { this.video.volume = value; this.video.muted = value === 0; }
    else this.setBrightness(value);
    const bar = this.levelBars[p.kind];
    bar.querySelector('span').textContent = Math.round(value * 100) + '%';
    bar.querySelector('i').style.transform = `scaleY(${value / max})`;
  }

  endLevel(kind) { setTimeout(() => { this.levelBars[kind].hidden = true; }, FEEDBACK_MS); }

  setBrightness(value) {
    this.brightness = value;
    // A web page cannot change screen brightness; this changes the picture's.
    this.video.style.filter = Math.abs(value - 1) < 0.02 ? '' : `brightness(${value.toFixed(2)})`;
  }

  bindTimeline() {
    const tl = this.timeline;
    let active = null;
    const at = e => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (this.video.duration || 0); };
    const bubble = () => {
      const f = this.scrubTime / (this.video.duration || 1);
      this.bubble.textContent = clock(this.scrubTime);
      this.bubble.style.left = `clamp(28px, ${(f * 100).toFixed(2)}%, calc(100% - 28px))`;
      this.bubble.hidden = false;
    };
    tl.addEventListener('pointerdown', e => {
      if (this.locked || !(this.video.duration > 0)) return;
      active = e.pointerId; tl.setPointerCapture(e.pointerId); tl.classList.add('active');
      this.scrubbing = true; this.scrubTime = at(e); this.updateTime(); bubble(); this.showControls(false);
    });
    tl.addEventListener('pointermove', e => { if (active === e.pointerId) { this.scrubTime = at(e); this.updateTime(); bubble(); } });
    const end = e => {
      if (active !== e.pointerId) return;
      active = null; tl.classList.remove('active'); this.bubble.hidden = true;
      if (e.type === 'pointerup' && this.scrubTime != null) this.video.currentTime = this.scrubTime;
      this.scrubTime = null; this.scrubbing = false; this.updateTime(); this.scheduleHide();
    };
    tl.addEventListener('pointerup', end);
    tl.addEventListener('pointercancel', end);
    tl.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.seekBy(e.key === 'ArrowLeft' ? -5 : 5); this.showControls(); }
    });
  }

  key(e) {
    if (!this.isOpen || e.target.closest?.('input, textarea')) return;
    const k = e.key;
    // Locked means locked, keys too; only the Unlock button can be reached and pressed.
    if (this.locked) { if (k !== 'Tab' && !e.target.closest?.('.ap-unlock')) { e.preventDefault(); this.showLockHint(); } return; }
    // Space and Enter on a focused button or the seek bar press that, not play/pause.
    if ((k === ' ' || k === 'Enter') && e.target.closest?.('button, [role="slider"]')) return;
    if (k === ' ' || k === 'k') { e.preventDefault(); this.togglePlay(); }
    else if (k === 'ArrowLeft' || k === 'j') { e.preventDefault(); this.seekBy(-10); this.flash('−10s', {kind: 'left'}); }
    else if (k === 'ArrowRight' || k === 'l') { e.preventDefault(); this.seekBy(10); this.flash('+10s', {kind: 'right'}); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      this.video.volume = Math.max(0, Math.min(1, this.video.volume + (k === 'ArrowUp' ? 0.05 : -0.05)));
      this.video.muted = this.video.volume === 0;
      this.flash(`Volume ${Math.round(this.video.volume * 100)}%`);
    } else if (k === 'm') { this.video.muted = !this.video.muted; this.flash(this.video.muted ? 'Muted' : 'Sound on'); }
    else if (k === 'f') this.toggleFullscreen();
    else if (k === 'c') this.openModal('subtitles');
    else if (k === 'Escape' && (this.modalName || this.panelName)) this.closeOverlays();
    else return;
    if (!this.modalName && !this.panelName) this.showControls();
  }

  // ——— System integration ———

  enterFullscreen(orientation = this.orientation || this.prefs.orientation, {announce = false} = {}) {
    this.wantFullscreen = true;
    const el = this.root;
    const failed = () => { if (announce) this.flash('This screen cannot be turned from here'); };
    if (!el.requestFullscreen || document.fullscreenElement) return failed();
    el.requestFullscreen({navigationUI: 'hide'}).then(() => {
      this.wasFullscreen = true;
      this.lockOrientation(orientation, {announce});
    }).catch(failed);
  }

  exitFullscreen() {
    this.wantFullscreen = false;
    try { screen.orientation?.unlock?.(); } catch {}
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    this.wasFullscreen = false;
  }

  toggleFullscreen() { if (document.fullscreenElement) this.exitFullscreen(); else this.enterFullscreen(); }

  fullscreenChanged() {
    // On a phone, leaving full screen is the back button. Like back anywhere
    // else it closes what is open first (a menu or a panel); locked, it closes
    // nothing. The next tap goes full screen again. Only then does it close
    // the player, as Nuvio's does.
    if (document.fullscreenElement || !this.wasFullscreen || !this.isOpen || !this.wantFullscreen || this.minimized || document.pictureInPictureElement || !coarse()) return;
    if (performance.now() < this.pipUntil || this.root.classList.contains('in-pip')) return; // moving to or from the floating window
    if (this.modalName || this.panelName) { this.closeOverlays(); return; }
    if (this.locked) { this.showLockHint(); return; }
    this.close('back');
  }

  async wake(on) {
    try {
      if (on && !this.wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) { await this.wakeLock.release(); this.wakeLock = null; }
    } catch { this.wakeLock = null; }
  }

  mediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const m = this.meta;
    try {
      ms.metadata = new MediaMetadata({title: m.episodeLine ? `${m.title} · ${m.episodeLine}` : m.title || 'Astra', artist: 'Astra', artwork: [m.poster, m.background].filter(Boolean).map(src => ({src}))});
      const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch {} };
      set('play', () => this.video.play());
      set('pause', () => this.video.pause());
      set('seekbackward', d => this.seekBy(-(d?.seekOffset || 10)));
      set('seekforward', d => this.seekBy(d?.seekOffset || 10));
      set('seekto', d => { if (d?.seekTime != null) this.video.currentTime = d.seekTime; });
      set('nexttrack', this.options.next ? () => this.playNext() : null);
      // Where the browser offers it, leaving the app while playing opens picture-in-picture.
      set('enterpictureinpicture', this.prefs.autoPip ? () => this.video.requestPictureInPicture().catch(() => {}) : null);
    } catch {}
    try { this.video.autoPictureInPicture = !!this.prefs.autoPip; } catch {}
  }

  positionState() {
    const d = this.video.duration;
    if (!navigator.mediaSession?.setPositionState || !Number.isFinite(d) || !(d > 0)) return;
    try { navigator.mediaSession.setPositionState({duration: d, position: Math.min(d, this.video.currentTime), playbackRate: this.video.playbackRate || 1}); } catch {}
  }
}
