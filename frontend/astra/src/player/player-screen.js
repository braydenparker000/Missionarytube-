// The full-screen player: Nuvio's layout and gestures over Astra's engine.
//
// open() must be called from a tap (it goes full screen and turns to
// landscape). Back closes, in order: a modal or panel, then the player.
//
// Events: 'progress' {time, duration} (every 10 s, on pause and on close),
// 'close' {time, duration, reason}, 'source' {source}, 'episode' {episode}.

import {AstraPlayer} from '../engine/player.js';
import {pushLayer} from '../app/back-stack.js';
import {icon} from '../ui/icons.js';
import {h, clock, haptic} from '../ui/dom.js';
import * as G from './gestures.js';
import {loadPrefs, savePrefs, subtitleStyle, DEFAULTS, SPEEDS, ASPECTS, ASPECT_LABELS, SUBTITLE_COLORS, SUBTITLE_BACKGROUNDS} from './prefs.js';
import {languageName, baseLanguage} from '../engine/languages.js';

const HIDE_AFTER = 3500;
const PAUSE_OVERLAY_AFTER = 5000;
const FEEDBACK_MS = 900;
const SKIP_LABELS = {intro: 'Skip Intro', recap: 'Skip Recap', outro: 'Skip Outro', credits: 'Skip to post-credits'};

const iconButton = (name, label, onclick, extra = {}) => h('button', {class: 'ap-icon-btn', type: 'button', 'aria-label': label, title: label, onclick, ...extra}, icon(name, {text: extra.iconText}));

export class PlayerScreen extends EventTarget {
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
    const subs = h('div', {class: 'ap-subs'});
    this.engine = new AstraPlayer(video, subs);
    this.engine.addEventListener('status', e => { this.loadingStatus.textContent = e.detail; });
    this.engine.addEventListener('error', e => this.showError(e.detail.message));
    this.engine.addEventListener('tracks', () => this.refreshMenus());
    this.engine.addEventListener('ready', () => this.onReady());

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
    this.loading = h('div', {class: 'ap-loading'}, this.loadingArt, this.loadingLogo, this.loadingStatus,
      iconButton('close', 'Close player', () => this.close('user'), {class: 'ap-icon-btn ap-loading-close'}));

    // Controls
    this.titleEl = h('h2', {class: 'ap-title'});
    this.episodeEl = h('p', {class: 'ap-episode-line'});
    this.releaseEl = h('p', {class: 'ap-release'});
    this.viaEl = h('p', {class: 'ap-via'});
    this.played = h('div', {class: 'ap-played'});
    this.buffered = h('div', {class: 'ap-buffered'});
    this.timeline = h('div', {class: 'ap-timeline', role: 'slider', tabindex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0},
      h('div', {class: 'ap-track'}, this.buffered, this.played));
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
      pip: iconButton('pip', 'Picture in picture', () => this.togglePip()),
      info: iconButton('info', 'Stream info', () => this.openModal('info')),
    };
    const more = iconButton('chevronRight', 'More', () => this.actions.scrollBy({left: 200, behavior: 'smooth'}), {class: 'ap-icon-btn ap-more'});
    this.actions.addEventListener('scroll', () => more.hidden = this.actions.scrollLeft + this.actions.clientWidth >= this.actions.scrollWidth - 4, {passive: true});
    this.moreBtn = more;
    this.lockBtn = iconButton('lock', 'Lock controls', () => this.setLocked(true));
    this.controls = h('div', {class: 'ap-controls'},
      h('div', {class: 'ap-shade-top'}), h('div', {class: 'ap-shade-bottom'}),
      h('div', {class: 'ap-top'}, this.lockBtn, iconButton('back', 'Close player', () => this.close('user'))),
      h('div', {class: 'ap-center'},
        iconButton('replay', 'Back 10 seconds', () => this.seekBy(-10), {class: 'ap-icon-btn ap-side', iconText: '10'}),
        h('div', {class: 'ap-play-wrap'}, this.playBtn, this.spinner),
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
      h('div', {class: 'ap-lock-track'}, h('div')));
    this.errorCard = h('div', {class: 'ap-error', hidden: true, role: 'alert'});
    this.modal = h('div', {class: 'ap-modal', hidden: true});
    this.panel = h('div', {class: 'ap-panel', hidden: true});

    this.surface = h('div', {class: 'ap-surface'});
    this.root = h('div', {class: 'ap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Player', hidden: true, tabindex: -1},
      video, subs, this.surface, this.pauseOverlay, this.feedback, this.seekPreview, this.levelBars.brightness, this.levelBars.volume,
      this.controls, this.skipBtn, this.nextCard, this.lockOverlay, this.loading, this.errorCard, this.panel, this.modal);
    this.parent.append(this.root);
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
    this.nextDismissed = false;
    this.skipped = new Set();
    this.firstFrame = false;
    this.remaining = false;
    this.lastProgress = 0;
    if (!this.isOpen) {
      this.isOpen = true;
      this.root.hidden = false;
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

  load(stream, startTime) {
    this.stream = stream;
    this.firstFrame = false;
    this.showLoading(true);
    this.errorCard.hidden = true;
    this.viaEl.textContent = stream.name ? 'Via ' + stream.name.replace(/\s+/g, ' ') : '';
    const prefs = {languages: [...new Set([this.prefs.audioLanguage, ...((navigator.languages || []).map(baseLanguage))].filter(Boolean))], subtitleLanguage: this.prefs.subtitleLanguage || null};
    this.engine.load({url: stream.url, headers: stream.headers || {}, startTime, autoplay: true, prefs, subtitles: stream.subtitles || []});
    this.mediaSession();
  }

  onReady() {
    this.refreshMenus();
    if (this.engine.mode === 'unsupported') return;
    // Subtitles from add-ons in the remembered language, when the file has none in it.
    const want = this.prefs.subtitleLanguage;
    if (want && !this.engine.selectedSubtitle) {
      const match = this.engine.subtitleOptions().find(s => s.supported && baseLanguage(s.language) === want);
      if (match) this.engine.selectSubtitle(match.id);
    }
  }

  close(reason = 'user') {
    if (!this.isOpen) return;
    this.isOpen = false;
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
    this.actionButtons.pip.hidden = !document.pictureInPictureEnabled;
    this.actions.replaceChildren(...Object.values(this.actionButtons).filter(b => !b.hidden));
    requestAnimationFrame(() => { this.moreBtn.hidden = this.actions.scrollWidth <= this.actions.clientWidth + 4; });
  }

  showLoading(on) {
    this.loading.hidden = !on;
    if (on) this.loadingStatus.textContent = 'Finding the stream…';
  }

  showError(message) {
    this.showLoading(false);
    const report = h('button', {class: 'ap-chip', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(await this.engine.report(), null, 2)); report.textContent = 'Report copied'; } catch { report.textContent = 'Copy failed'; }
    }}, 'Copy report');
    this.errorCard.replaceChildren(
      h('h3', {}, 'Playback stopped'), h('p', {}, message),
      h('div', {class: 'ap-error-actions'},
        this.sources.length > 1 ? h('button', {class: 'ap-chip primary', type: 'button', onclick: () => { this.errorCard.hidden = true; this.openPanel('sources'); }}, 'Choose another source') : null,
        h('button', {class: 'ap-chip', type: 'button', onclick: () => this.load(this.stream, this.video.currentTime || 0)}, 'Try again'),
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
    this.viaEl.hidden = !paused;
    this.root.classList.toggle('paused', paused);
  }

  setBuffering(on) {
    this.buffering = on;
    this.spinner.hidden = !on;
    this.playBtn.hidden = on;
    if (on) this.showControls(false);
    else this.scheduleHide();
  }

  // ——— Controls visibility ———

  showControls(autoHide = true) {
    if (this.locked) return;
    this.controlsVisible = true;
    this.root.classList.add('controls');
    this.pauseOverlay.hidden = true;
    this.skipHiddenByTimer = false;
    if (autoHide) this.scheduleHide();
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

  applyAspect() { this.video.dataset.aspect = this.prefs.aspect; }

  async togglePip() {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await this.video.requestPictureInPicture(); } catch {}
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
      h('div', {class: 'ap-next-text'}, h('small', {}, 'Next Episode'), h('b', {}, n.label + (n.title ? ' • ' + n.title : '')), n.status ? h('span', {}, n.status) : null),
      h('button', {class: 'ap-next-play', type: 'button', onclick: () => this.playNext(), disabled: n.hasAired === false}, icon('play', {size: 16}), 'Play'),
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

  playNext() { this.emit('next', {time: this.video.currentTime}); }

  // ——— Modals and panels ———

  openModal(name) {
    this.closeOverlays();
    this.modalName = name;
    this.modalClose = pushLayer('player-modal', () => { this.modalClose = null; this.closeOverlays(); });
    this.renderModal();
    this.modal.hidden = false;
    this.root.classList.add('overlay');
    this.showControls(false);
  }

  openPanel(name) {
    this.closeOverlays();
    this.panelName = name;
    this.panelClose = pushLayer('player-panel', () => { this.panelClose = null; this.closeOverlays(); });
    this.renderPanel();
    this.panel.hidden = false;
    this.root.classList.add('overlay');
    this.showControls(false);
  }

  closeOverlays(silent = false) {
    if (this.modalName) { this.modalName = null; this.modal.hidden = true; this.modalClose?.(); this.modalClose = null; }
    if (this.panelName) { this.panelName = null; this.panel.hidden = true; this.panelClose?.(); this.panelClose = null; }
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
    this.modal.replaceChildren(h('div', {class: 'ap-modal-scrim', onclick: () => this.closeOverlays()}), h('div', {class: 'ap-modal-body ' + name}, close, body));
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
    const langs = [...new Set(options.map(s => baseLanguage(s.language) || 'und'))];
    const selected = options.find(s => s.selected);
    this.subLang ??= selected ? baseLanguage(selected.language) || 'und' : langs[0] || null;
    if (this.subLang && !langs.includes(this.subLang)) this.subLang = langs[0] || null;
    const langName = code => code === 'und' ? 'Unknown' : languageName(code) || code;
    const languageRail = h('div', {class: 'ap-rail languages'},
      h('button', {class: 'ap-row' + (!selected ? ' selected' : ''), type: 'button', onclick: () => { this.engine.selectSubtitle(null); this.prefs.subtitleLanguage = ''; savePrefs(this.prefs); }}, h('b', {}, 'Off'), !selected ? icon('check', {size: 20}) : null),
      ...langs.map(code => h('button', {class: 'ap-row' + (code === this.subLang ? ' current' : ''), type: 'button', onclick: () => { this.subLang = code; this.renderModal(); }}, h('b', {}, langName(code)), h('small', {}, String(options.filter(s => (baseLanguage(s.language) || 'und') === code).length)))));
    const trackRail = h('div', {class: 'ap-rail tracks'}, ...options.filter(s => (baseLanguage(s.language) || 'und') === this.subLang).map(s => h('button', {
      class: 'ap-row' + (s.selected ? ' selected' : ''), type: 'button', disabled: !s.supported,
      onclick: () => { this.engine.selectSubtitle(s.id); this.prefs.subtitleLanguage = baseLanguage(s.language); savePrefs(this.prefs); },
    }, h('span', {class: 'ap-row-text'}, h('b', {}, s.label), h('span', {class: 'ap-tags'}, h('em', {}, s.kind === 'embedded' ? 'Built-in' : s.kind === 'stream' ? 'Stream' : 'Add-on'), s.forced ? h('em', {}, 'Forced') : null), !s.supported ? h('small', {}, s.reason || '') : null), s.selected ? icon('check', {size: 20}) : null)));
    if (!options.length) trackRail.append(h('p', {class: 'ap-empty'}, 'This source has no subtitles.'));
    return [h('h3', {}, 'Subtitles'), h('div', {class: 'ap-rails'}, languageRail, trackRail, this.styleRail())];
  }

  styleRail() {
    const p = this.prefs, r = this.engine.subtitles;
    const save = () => { savePrefs(p); r.setStyle(subtitleStyle(p)); this.renderModal(); };
    const stepper = (label, value, minus, plus, reset) => h('div', {class: 'ap-step'}, h('span', {}, label),
      h('div', {}, h('button', {class: 'ap-chip', type: 'button', 'aria-label': label + ' down', onclick: minus}, '−'), h('b', {}, value), h('button', {class: 'ap-chip', type: 'button', 'aria-label': label + ' up', onclick: plus}, '+'),
        reset ? h('button', {class: 'ap-chip ghost', type: 'button', onclick: reset}, 'Reset') : null));
    const delay = r.delay;
    return h('div', {class: 'ap-rail style'},
      stepper('Delay', `${delay > 0 ? '+' : ''}${delay.toFixed(1)} s`, () => { r.setDelay(Math.max(-60, delay - 0.1)); this.renderModal(); }, () => { r.setDelay(Math.min(60, delay + 0.1)); this.renderModal(); }, delay ? () => { r.setDelay(0); this.renderModal(); } : null),
      stepper('Size', String(p.subtitleSize), () => { p.subtitleSize = Math.max(12, p.subtitleSize - 2); save(); }, () => { p.subtitleSize = Math.min(40, p.subtitleSize + 2); save(); }),
      stepper('Position', String(p.subtitleOffset), () => { p.subtitleOffset = Math.max(0, p.subtitleOffset - 5); save(); }, () => { p.subtitleOffset = Math.min(200, p.subtitleOffset + 5); save(); }),
      h('div', {class: 'ap-toggles'},
        h('button', {class: 'ap-chip' + (p.subtitleBold ? ' on' : ''), type: 'button', 'aria-pressed': String(p.subtitleBold), onclick: () => { p.subtitleBold = !p.subtitleBold; save(); }}, 'Bold'),
        h('button', {class: 'ap-chip' + (p.subtitleOutline ? ' on' : ''), type: 'button', 'aria-pressed': String(p.subtitleOutline), onclick: () => { p.subtitleOutline = !p.subtitleOutline; save(); }}, 'Outline')),
      h('span', {class: 'ap-label'}, 'Text colour'),
      h('div', {class: 'ap-swatches'}, ...SUBTITLE_COLORS.map(c => h('button', {class: 'ap-swatch' + (c === p.subtitleColor ? ' on' : ''), type: 'button', 'aria-label': 'Colour ' + c, style: {background: c}, onclick: () => { p.subtitleColor = c; save(); }}))),
      h('span', {class: 'ap-label'}, 'Background'),
      h('div', {class: 'ap-swatches'}, ...SUBTITLE_BACKGROUNDS.map(a => h('button', {class: 'ap-swatch bg' + (a === p.subtitleBackground ? ' on' : ''), type: 'button', 'aria-label': a ? `Background ${Math.round(a * 100)}%` : 'No background', style: {background: a ? `rgba(0,0,0,${a})` : 'transparent'}, onclick: () => { p.subtitleBackground = a; save(); }}))),
      h('button', {class: 'ap-chip ghost', type: 'button', onclick: () => { for (const k of ['subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleOutline', 'subtitleBold', 'subtitleOffset']) p[k] = DEFAULTS[k]; r.setDelay(0); save(); }}, 'Reset defaults'));
  }

  infoModal() {
    const e = this.engine, info = e.info, plan = e.plan;
    const rows = [['How it plays', {native: 'Directly in Chrome', remux: 'Unpacked by Astra', hls: 'HLS stream', dash: 'DASH stream', unsupported: 'Not playable'}[e.mode] || '—']];
    if (info?.video?.[0]) rows.push(['Video', [info.video[0].label, info.video[0].width && `${info.video[0].width}×${info.video[0].height}`, info.video[0].hdr && 'HDR'].filter(Boolean).join(' · ')]);
    const audio = e.audioOptions().find(a => a.selected);
    if (audio) rows.push(['Audio', audio.label + (audio.delivery === 'rebuilt' ? ' (converted)' : '')]);
    if (info?.container) rows.push(['File', info.container + (info.size ? ' · ' + (info.size / 1e9).toFixed(2) + ' GB' : '')]);
    const q = this.video.getVideoPlaybackQuality?.();
    if (q) rows.push(['Frames', `${q.totalVideoFrames} shown, ${q.droppedVideoFrames} dropped`]);
    if (this.video.videoWidth) rows.push(['Picture', `${this.video.videoWidth}×${this.video.videoHeight}`]);
    for (const n of plan?.notes || []) rows.push(['Note', n]);
    return [h('h3', {}, 'Stream info'), h('dl', {class: 'ap-info'}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))];
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
      this.updatePlayState(); this.wake(false); this.showControls(false); this.emitProgress(true);
    });
    v.addEventListener('play', () => { this.updatePlayState(); this.scheduleHide(); });
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
    if (p.kind === 'seek') { p.from = this.video.currentTime; this.scrubbing = true; this.showControls(false); }
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
    tl.addEventListener('pointerdown', e => {
      if (this.locked || !(this.video.duration > 0)) return;
      active = e.pointerId; tl.setPointerCapture(e.pointerId); tl.classList.add('active');
      this.scrubbing = true; this.scrubTime = at(e); this.updateTime(); this.showControls(false);
    });
    tl.addEventListener('pointermove', e => { if (active === e.pointerId) { this.scrubTime = at(e); this.updateTime(); } });
    const end = e => {
      if (active !== e.pointerId) return;
      active = null; tl.classList.remove('active');
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

  enterFullscreen() {
    this.wantFullscreen = true;
    const el = this.root;
    if (!el.requestFullscreen || document.fullscreenElement) return;
    el.requestFullscreen({navigationUI: 'hide'}).then(() => {
      this.wasFullscreen = true;
      screen.orientation?.lock?.('landscape').catch(() => {});
    }).catch(() => {});
  }

  exitFullscreen() {
    this.wantFullscreen = false;
    try { screen.orientation?.unlock?.(); } catch {}
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    this.wasFullscreen = false;
  }

  toggleFullscreen() { if (document.fullscreenElement) this.exitFullscreen(); else this.enterFullscreen(); }

  fullscreenChanged() {
    // On a phone, leaving full screen is the back button: close, as Nuvio does.
    if (!document.fullscreenElement && this.wasFullscreen && this.isOpen && this.wantFullscreen && matchMedia('(pointer: coarse)').matches) this.close('back');
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
    } catch {}
  }

  positionState() {
    const d = this.video.duration;
    if (!navigator.mediaSession?.setPositionState || !Number.isFinite(d) || !(d > 0)) return;
    try { navigator.mediaSession.setPositionState({duration: d, position: Math.min(d, this.video.currentTime), playbackRate: this.video.playbackRate || 1}); } catch {}
  }
}
