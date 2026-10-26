// The player's face: controls over the <video>, gestures, and the morph between
// the watch page, the miniplayer and full screen. Playback itself (Drive URLs,
// the Astra fallback, saved progress) stays in player.js and app.js.
//
// Modes: 'hidden', 'full' (top of the watch page), 'mini' (docked above the
// tabs). Gestures in full: tap shows or hides the controls, double tap on the
// left or right seeks 10 s (repeat to add more), drag down minimizes. In mini:
// tap expands, swipe down closes.
import {icon} from './icons.js';
import {formatDuration} from './library.js';

const HIDE_MS = 3000, DOUBLE_MS = 300, SEEK_STEP = 10;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (name === 'html') node.innerHTML = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

export class PlayerUI {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.mode = 'hidden';
    this.duration = 0;
    this.build();
    this.wire();
  }

  build() {
    const button = (name, label, onclick, cls = '') => h('button', {class:'pl-btn ' + cls, type:'button', 'aria-label':label, title:label, html:icon(name), onclick});
    this.video = h('video', {class:'pl-video', playsinline:true, preload:'metadata'});
    this.surface = h('div', {class:'pl-surface', 'aria-hidden':'true'});
    this.rippleLeft = h('div', {class:'pl-ripple left', 'aria-hidden':'true'}, h('span', {html:icon('prev', 20)}), h('b'));
    this.rippleRight = h('div', {class:'pl-ripple right', 'aria-hidden':'true'}, h('span', {html:icon('next', 20)}), h('b'));
    this.spinner = h('div', {class:'pl-spinner', 'aria-hidden':'true'});

    this.minimizeBtn = button('chevronDown', 'Minimize player', () => this.hooks.onMinimize?.(), 'pl-minimize');
    this.captionsBtn = button('captions', 'Subtitles', () => this.hooks.onCaptions?.(), 'pl-cc');
    this.captionsBtn.hidden = true;
    this.settingsBtn = button('settings', 'Player settings', () => { this.keepControls(); this.hooks.onSettings?.(); });
    this.prevBtn = button('prev', 'Previous video', () => this.hooks.onPrev?.(), 'pl-skip');
    this.playBtn = button('play', 'Play', () => this.toggle(), 'pl-play');
    this.nextBtn = button('next', 'Next video', () => this.hooks.onNext?.(), 'pl-skip');
    this.fsBtn = button('fullscreen', 'Full screen', () => this.toggleFullscreen(), 'pl-fs');
    this.time = h('span', {class:'pl-time'}, h('b', {}, '0:00'), h('span', {}, ' / 0:00'));

    this.buffered = h('i', {class:'pl-buffered'});
    this.played = h('i', {class:'pl-played'});
    this.thumb = h('i', {class:'pl-thumb'});
    this.bubble = h('span', {class:'pl-bubble', 'aria-hidden':'true'});
    this.scrub = h('div', {class:'pl-scrub', role:'slider', tabindex:'0', 'aria-label':'Seek', 'aria-valuemin':'0', 'aria-valuemax':'0', 'aria-valuenow':'0', 'aria-valuetext':'0:00'},
      h('div', {class:'pl-track'}, this.buffered, this.played), this.thumb, this.bubble);

    this.errorText = h('p');
    this.error = h('div', {class:'pl-error', hidden:true, role:'alert'}, this.errorText,
      h('button', {class:'pl-pill', type:'button', onclick:() => this.hooks.onRetry?.()}, 'Try again'));

    this.countTitle = h('strong');
    this.countSub = h('small');
    this.countImg = h('img', {alt:'', referrerpolicy:'no-referrer', decoding:'async'});
    this.countRing = h('span', {class:'pl-ring', 'aria-hidden':'true'}, h('span', {html:icon('play', 22)}));
    this.countLabel = h('p', {class:'pl-count-label'});
    this.countdownEl = h('div', {class:'pl-countdown', hidden:true, role:'dialog', 'aria-label':'Up next'},
      this.countLabel,
      h('div', {class:'pl-count-card'}, h('div', {class:'pl-count-thumb'}, this.countImg), h('div', {class:'pl-count-text'}, this.countTitle, this.countSub)),
      h('div', {class:'pl-count-actions'},
        h('button', {class:'pl-pill ghost', type:'button', onclick:() => this.endCountdown(false)}, 'Cancel'),
        h('button', {class:'pl-count-play', type:'button', 'aria-label':'Play now', onclick:() => this.endCountdown(true)}, this.countRing)));

    this.replayBtn = h('button', {class:'pl-btn pl-replay', type:'button', hidden:true, 'aria-label':'Watch again', html:icon('replay', 30), onclick:() => { this.video.currentTime = 0; this.video.play().catch(() => {}); }});

    this.controls = h('div', {class:'pl-controls'},
      h('div', {class:'pl-scrim', 'aria-hidden':'true'}),
      h('div', {class:'pl-top'}, this.minimizeBtn, h('span', {class:'pl-spacer'}), this.captionsBtn, this.settingsBtn),
      h('div', {class:'pl-center'}, this.prevBtn, this.playBtn, this.nextBtn),
      h('div', {class:'pl-bottom'}, this.time, h('span', {class:'pl-spacer'}), this.fsBtn));

    this.stage = h('div', {class:'pl-stage'}, this.video, this.surface, this.rippleLeft, this.rippleRight, this.spinner,
      this.controls, this.replayBtn, this.scrub, this.error, this.countdownEl);

    this.miniTitle = h('strong', {class:'pl-mini-title'});
    this.miniSub = h('span', {class:'pl-mini-sub'});
    this.miniPlay = h('button', {class:'pl-btn', type:'button', 'aria-label':'Play', html:icon('play'), onclick:() => this.toggle()});
    this.miniFill = h('i');
    this.mini = h('div', {class:'pl-mini'},
      h('button', {class:'pl-mini-info', type:'button', 'aria-label':'Open player', onclick:() => this.hooks.onExpand?.()}, this.miniTitle, this.miniSub),
      this.miniPlay,
      h('button', {class:'pl-btn', type:'button', 'aria-label':'Close player', html:icon('close'), onclick:() => this.hooks.onClose?.()}),
      h('span', {class:'pl-mini-progress', 'aria-hidden':'true'}, this.miniFill));

    this.el = h('div', {class:'pl', id:'player', 'data-mode':'hidden', 'data-controls':'on', 'data-state':'paused', hidden:true}, this.stage, this.mini);
    document.body.append(this.el);
  }

  wire() {
    const v = this.video;
    const sync = () => this.paint();
    for (const type of ['play', 'pause', 'playing', 'timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'ended', 'seeked', 'emptied']) v.addEventListener(type, sync);
    v.addEventListener('waiting', () => this.setLoading(true));
    v.addEventListener('seeking', () => this.setLoading(true));
    for (const type of ['playing', 'canplay', 'seeked', 'pause']) v.addEventListener(type, () => this.setLoading(false));
    v.addEventListener('playing', () => { this.error.hidden = true; this.armHide(); });
    v.addEventListener('pause', () => this.showControls(false));
    v.addEventListener('ended', () => { this.showControls(false); this.hooks.onEnded?.(); });

    document.addEventListener('fullscreenchange', () => {
      const on = document.fullscreenElement === this.el;
      this.el.toggleAttribute('data-fs', on);
      this.fsBtn.innerHTML = icon(on ? 'fullscreenExit' : 'fullscreen');
      this.fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      if (on && v.videoWidth > v.videoHeight) screen.orientation?.lock?.('landscape').catch(() => {});
      else if (!on) screen.orientation?.unlock?.();
    });

    this.wireSurface();
    this.wireScrub();
    this.wireMini();
  }

  /* ---- state ---------------------------------------------------------- */

  /** A new video: clears every overlay and shows its title in the miniplayer. */
  load({title = '', sub = '', poster = '', duration = 0, hasPrev = false, hasNext = false} = {}) {
    this.endCountdown(null);
    this.duration = duration || 0;
    this.error.hidden = true;
    this.replayBtn.hidden = true;
    this.miniTitle.textContent = title;
    this.miniSub.textContent = sub;
    if (poster) this.video.poster = poster; else this.video.removeAttribute('poster');
    this.setNav(hasPrev, hasNext);
    this.setLoading(true);
    this.showControls(false);
    this.paint();
  }

  setNav(hasPrev, hasNext) { this.prevBtn.disabled = !hasPrev; this.nextBtn.disabled = !hasNext; }
  setCaptions(available, on) {
    this.captionsBtn.hidden = !available;
    this.captionsBtn.innerHTML = icon(on ? 'captionsFill' : 'captions');
    this.captionsBtn.setAttribute('aria-pressed', String(!!on));
  }
  setLoading(on) { this.el.toggleAttribute('data-loading', !!on); }
  showError(message) {
    this.setLoading(false);
    this.errorText.textContent = message;
    this.error.hidden = false;
    this.showControls(false);
  }

  paint() {
    const v = this.video, playing = !v.paused && !v.ended;
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : this.duration;
    const state = v.ended ? 'ended' : playing ? 'playing' : 'paused';
    this.el.dataset.state = state;
    for (const b of [this.playBtn, this.miniPlay]) {
      b.innerHTML = icon(playing ? 'pause' : 'play', b === this.playBtn ? 34 : 24);
      b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      b.title = playing ? 'Pause' : 'Play';
    }
    this.replayBtn.hidden = state !== 'ended' || !this.countdownEl.hidden;
    this.playBtn.hidden = state === 'ended';
    if (this.scrubbing) return;
    const t = v.currentTime || 0, fraction = duration ? Math.min(1, t / duration) : 0;
    this.setFraction(fraction);
    let end = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= t + 1) end = Math.max(end, v.buffered.end(i));
    this.buffered.style.transform = `scaleX(${duration ? Math.min(1, end / duration) : 0})`;
    this.time.firstChild.textContent = formatDuration(t);
    this.time.lastChild.textContent = ' / ' + formatDuration(duration);
    this.scrub.setAttribute('aria-valuemax', String(Math.round(duration)));
    this.scrub.setAttribute('aria-valuenow', String(Math.round(t)));
    this.scrub.setAttribute('aria-valuetext', `${formatDuration(t)} of ${formatDuration(duration)}`);
  }

  setFraction(fraction) {
    this.played.style.transform = `scaleX(${fraction})`;
    this.thumb.style.left = `${fraction * 100}%`;
    this.miniFill.style.transform = `scaleX(${fraction})`;
  }

  toggle() {
    const v = this.video;
    if (v.ended) v.currentTime = 0;
    if (v.paused || v.ended) v.play().catch(() => {}); else v.pause();
    this.flash();
  }

  flash() { this.playBtn.classList.remove('pop'); void this.playBtn.offsetWidth; this.playBtn.classList.add('pop'); }

  /* ---- controls visibility -------------------------------------------- */

  showControls(autoHide = true) {
    if (this.el.dataset.controls !== 'on') {
      this.el.toggleAttribute('data-revealing', true);
      clearTimeout(this.revealTimer);
      this.revealTimer = setTimeout(() => this.el.removeAttribute('data-revealing'), 350);
    }
    this.el.dataset.controls = 'on';
    clearTimeout(this.hideTimer);
    if (autoHide) this.armHide();
  }
  hideControls() {
    if (this.scrubbing || this.video.paused || this.mode !== 'full' || this.el.contains(document.activeElement) && document.activeElement !== this.scrub && matchMedia('(pointer: fine)').matches) return;
    this.el.dataset.controls = 'off';
  }
  armHide() { clearTimeout(this.hideTimer); if (!this.video.paused) this.hideTimer = setTimeout(() => this.hideControls(), HIDE_MS); }
  keepControls() { this.showControls(false); }

  /* ---- gestures on the video ------------------------------------------ */

  wireSurface() {
    let start = null, lastTap = {t:0, side:''}, seekTotal = 0, seekTimer = 0, singleTimer = 0;
    const side = x => {
      const box = this.stage.getBoundingClientRect(), f = (x - box.left) / box.width;
      return f < 0.38 ? 'left' : f > 0.62 ? 'right' : 'center';
    };
    const ripple = (where) => {
      const el = where === 'left' ? this.rippleLeft : this.rippleRight;
      const other = where === 'left' ? this.rippleRight : this.rippleLeft;
      other.classList.remove('show');
      seekTotal += SEEK_STEP;
      el.querySelector('b').textContent = `${seekTotal} seconds`;
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      const v = this.video, d = Number.isFinite(v.duration) ? v.duration : this.duration;
      const target = Math.max(0, Math.min(d || Infinity, (v.currentTime || 0) + (where === 'left' ? -SEEK_STEP : SEEK_STEP)));
      this.hooks.onSeek?.(target);
      clearTimeout(seekTimer);
      seekTimer = setTimeout(() => { seekTotal = 0; el.classList.remove('show'); }, 700);
    };
    // The whole stage takes the drag (YouTube lets you pull the player down from
    // anywhere, buttons included); only taps on bare video toggle the controls.
    this.stage.addEventListener('pointerdown', event => {
      if (event.button > 0 || this.mode !== 'full' || event.target.closest('.pl-scrub, .pl-countdown, .pl-error')) return;
      start = {x:event.clientX, y:event.clientY, t:performance.now(), id:event.pointerId, drag:false, bare:event.target === this.surface};
    });
    this.stage.addEventListener('pointermove', event => {
      if (!start || event.pointerId !== start.id || document.fullscreenElement) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.drag && dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        start.drag = true;
        // Capturing on the stage means no button under the finger gets the click.
        this.stage.setPointerCapture(event.pointerId);
        this.el.classList.add('dragging');
        this.hooks.onDragStart?.();
      }
      if (start.drag) {
        const p = Math.max(0, Math.min(1, dy / (innerHeight * 0.6)));
        this.stage.style.transform = `translateY(${Math.max(0, dy)}px) scale(${1 - p * 0.35})`;
        this.hooks.onDrag?.(p);
      }
    });
    const end = event => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y, dt = performance.now() - start.t;
      const wasDrag = start.drag, bare = start.bare;
      start = null;
      if (wasDrag) {
        this.el.classList.remove('dragging');
        if (event.type !== 'pointercancel' && (dy > innerHeight * 0.18 || dy / dt > 0.6)) this.hooks.onMinimize?.();
        else {
          const from = this.stage.style.transform;
          this.stage.style.transform = '';
          if (!reduced()) this.stage.animate([{transform:from}, {transform:'none'}], {duration:260, easing:EASE});
          this.hooks.onDrag?.(0, true);
        }
        return;
      }
      if (!bare || event.type === 'pointercancel' || Math.hypot(dx, dy) > 12) return;
      const where = side(event.clientX), now = performance.now();
      if (where !== 'center' && now - lastTap.t < DOUBLE_MS && lastTap.side === where) {
        clearTimeout(singleTimer);
        lastTap = {t:now, side:where};
        ripple(where);
        return;
      }
      if (seekTotal && where !== 'center') { lastTap = {t:now, side:where}; ripple(where); return; }
      lastTap = {t:now, side:where};
      // Show at once; hiding waits to see whether this is a double tap.
      if (this.el.dataset.controls !== 'on') this.showControls();
      else { clearTimeout(singleTimer); singleTimer = setTimeout(() => { if (performance.now() - lastTap.t >= DOUBLE_MS - 5) { this.el.dataset.controls = 'off'; } }, DOUBLE_MS); }
    };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', end);
    this.controls.addEventListener('pointerdown', () => this.showControls());
  }

  /* ---- scrubber ------------------------------------------------------- */

  wireScrub() {
    const s = this.scrub;
    const fractionAt = x => { const box = s.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - box.left) / box.width)); };
    const durationNow = () => { const d = this.video.duration; return Number.isFinite(d) && d > 0 ? d : this.duration; };
    const preview = f => {
      this.setFraction(f);
      this.bubble.textContent = formatDuration(f * durationNow());
      this.bubble.style.left = `${f * 100}%`;
      this.time.firstChild.textContent = formatDuration(f * durationNow());
    };
    let pointer = null;
    s.addEventListener('pointerdown', event => {
      if (event.button > 0 || this.mode !== 'full' && !document.fullscreenElement) return;
      event.stopPropagation();
      pointer = event.pointerId;
      s.setPointerCapture(pointer);
      this.scrubbing = true;
      this.el.classList.add('scrubbing');
      this.showControls(false);
      preview(fractionAt(event.clientX));
    });
    s.addEventListener('pointermove', event => { if (event.pointerId === pointer) preview(fractionAt(event.clientX)); });
    const release = event => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      const f = fractionAt(event.clientX);
      this.scrubbing = false;
      this.el.classList.remove('scrubbing');
      if (event.type !== 'pointercancel' && durationNow()) this.hooks.onSeek?.(f * durationNow());
      this.armHide();
      this.paint();
    };
    s.addEventListener('pointerup', release);
    s.addEventListener('pointercancel', release);
    s.addEventListener('keydown', event => {
      const step = {ArrowLeft:-5, ArrowRight:5, PageDown:-30, PageUp:30}[event.key];
      const d = durationNow();
      if (step) { event.preventDefault(); this.hooks.onSeek?.(Math.max(0, Math.min(d, (this.video.currentTime || 0) + step))); this.showControls(); }
      else if (event.key === 'Home') { event.preventDefault(); this.hooks.onSeek?.(0); }
      else if (event.key === 'End' && d) { event.preventDefault(); this.hooks.onSeek?.(Math.max(0, d - 1)); }
    });
  }

  /* ---- miniplayer ----------------------------------------------------- */

  wireMini() {
    let start = null;
    this.el.addEventListener('pointerdown', event => {
      if (this.mode !== 'mini' || event.button > 0 || event.target.closest('.pl-btn')) return;
      start = {x:event.clientX, y:event.clientY, id:event.pointerId, moved:false};
    });
    this.el.addEventListener('pointermove', event => {
      if (!start || event.pointerId !== start.id) return;
      const dy = event.clientY - start.y;
      if (!start.moved && Math.abs(dy) > 8) { start.moved = true; this.el.setPointerCapture(event.pointerId); }
      if (start.moved) { this.el.style.transform = `translateY(${Math.max(0, dy)}px)`; this.el.style.opacity = String(1 - Math.min(0.8, Math.max(0, dy) / 160)); }
    });
    const end = event => {
      if (!start || event.pointerId !== start.id) return;
      const dy = event.clientY - start.y, moved = start.moved;
      start = null;
      if (!moved) {
        if (event.type === 'pointerup' && !event.target.closest('.pl-mini-info')) this.hooks.onExpand?.();
        return;
      }
      if (dy > 48 && event.type !== 'pointercancel') { this.hooks.onClose?.(); return; }
      const from = this.el.style.transform;
      this.el.style.transform = ''; this.el.style.opacity = '';
      if (!reduced()) this.el.animate([{transform:from}, {transform:'none'}], {duration:220, easing:EASE});
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  /* ---- modes and the morph -------------------------------------------- */

  /** Moves between modes. `from` is the on-screen rect the video should grow out of. */
  show(mode, {from = null} = {}) {
    const before = from || (this.mode !== 'hidden' ? this.stage.getBoundingClientRect() : null);
    const previous = this.mode;
    if (mode === 'hidden') return this.hide();
    this.el.hidden = false;
    this.el.style.transform = ''; this.el.style.opacity = '';
    this.stage.style.transform = '';
    this.mode = mode;
    this.el.dataset.mode = mode;
    if (mode === 'full') this.showControls(); else clearTimeout(this.hideTimer);
    if (reduced() || !before || previous === mode && !from) return;
    const after = this.stage.getBoundingClientRect();
    if (!after.width || !before.width) return;
    const dx = before.left - after.left, dy = before.top - after.top;
    const sx = before.width / after.width, sy = before.height / after.height;
    this.stage.animate([
      {transformOrigin:'0 0', transform:`translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius:previous === 'full' ? '0px' : '12px'},
      {transformOrigin:'0 0', transform:'none', borderRadius:mode === 'mini' ? '6px' : '0px'}
    ], {duration:mode === 'mini' ? 300 : 360, easing:EASE});
    if (mode === 'mini') this.mini.animate([{opacity:0}, {opacity:1}], {duration:200, delay:120, easing:EASE, fill:'backwards'});
  }

  hide() {
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
    const done = () => { this.el.hidden = true; this.mode = 'hidden'; this.el.dataset.mode = 'hidden'; this.el.style.transform = ''; this.el.style.opacity = ''; };
    if (this.mode === 'mini' && !reduced()) {
      this.mode = 'closing';
      this.el.animate([{transform:this.el.style.transform || 'none', opacity:Number(this.el.style.opacity || 1)}, {transform:'translateY(110%)', opacity:0}], {duration:220, easing:EASE}).finished.then(done, done);
    } else done();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.el.requestFullscreen?.({navigationUI:'hide'}).catch(() => {});
  }

  /* ---- autoplay countdown --------------------------------------------- */

  /** Shows "Up next" over the ended video. Resolves true to play it, false if cancelled. */
  countdown({title, sub, image}, seconds = 5) {
    this.endCountdown(null);
    this.countTitle.textContent = title;
    this.countSub.textContent = sub || '';
    this.countImg.hidden = !image;
    if (image) this.countImg.src = image;
    this.countdownEl.hidden = false;
    this.replayBtn.hidden = true;
    this.countRing.style.setProperty('--secs', `${seconds}s`);
    this.countRing.classList.remove('run'); void this.countRing.offsetWidth; this.countRing.classList.add('run');
    let left = seconds;
    this.countLabel.textContent = `Up next in ${left}`;
    return new Promise(resolve => {
      this.countResolve = resolve;
      this.countTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) this.endCountdown(true);
        else this.countLabel.textContent = `Up next in ${left}`;
      }, 1000);
    });
  }

  endCountdown(play) {
    clearInterval(this.countTimer);
    this.countdownEl.hidden = true;
    const resolve = this.countResolve;
    this.countResolve = null;
    if (resolve) resolve(!!play);
    this.paint();
  }
}
