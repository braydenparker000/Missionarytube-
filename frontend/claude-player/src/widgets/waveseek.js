// Waveseek: the track waveform as rounded bars. In the default (scrolling)
// layout the cursor stays at cursorPosition and the waveform moves under it;
// bars left of the cursor use the elapsed bar style. Partly clipped edge bars
// fade with their visible fraction (fadeSidebars).
import {ViewGroup, MeasureSpec, getDefaultSize, getChildMeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {parseColor} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';

const WAVE_SCROLLING = 0, WAVE_STATIC = 1;
// While playing, the bar redraws at most this often (each draw moves it a sub-pixel step).
const MAX_FOLLOW_FPS = 30;

function argbCss(c, alphaMul = 1) {
  return `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${(((c >>> 24) & 255) / 255) * alphaMul})`;
}

/** Placeholder waveform for tracks without wave data (|sin| bands). */
export function placeholderWave(n, layout) {
  const periods = layout === WAVE_STATIC ? 1.5 : 3;
  const amp = layout === WAVE_STATIC ? 0.25 : 0.33;
  const phase = layout === WAVE_STATIC ? 0.25 : 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = Math.abs(Math.sin((((i + 0.5) * periods) / n + phase) * Math.PI * 2)) * amp;
    out[i] = v <= 0.01 ? 0.01 : v > 1 ? 1 : v;
  }
  return out;
}

/** Resamples wave data to n bars (nearest source bin). */
/** Nearest-sample resampling with a rounded source index (the reference's c22.A). */
function resample(n, src) {
  const out = new Float32Array(n);
  const step = src.length / n;
  for (let i = 0; i < n; i++) out[i] = src[Math.min(src.length - 1, Math.trunc(0.5 + i * step))];
  return out;
}

export class Waveseek extends ViewGroup {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    const density = ctx.dpr;
    this.layoutMode = a.int('waveLayout', WAVE_SCROLLING);
    this.numBars = Math.max(1, a.int('numBars', 100));
    this.cursorPos = a.fraction('cursorPosition', 0.5);
    this.cursorOffset = a.dimOffset('cursorOffset', 0);
    this.fadeSidebars = a.bool('fadeSidebars', true);
    this.dataAnimTime = a.int('dataAnimTime', 400) / 1000;
    this.noDataAnimTime = a.int('noDataAnimTime', 150) / 1000;
    this.barStyle = this.readBarStyle(a, 'barBitmap');
    this.elapsedStyle = this.readBarStyle(a, 'elapsedBarBitmap') ?? this.barStyle;
    const bmpW = this.barStyle?.width ?? Math.trunc(4 * density + 0.5);
    const autoWidth = a.raw('barWidth') === undefined || !/(dip|dp|px|sp|mm|in|pt)$/.test(a.string('barWidth', ''));
    this.barW = autoWidth ? bmpW : a.dim('barWidth', Math.trunc(4 * density + 0.5));
    this.spacing = a.dim('barSpacing', Math.trunc(2 * density + 0.5));
    this.minBarH = Math.max(a.dim('minBarHeight', Math.trunc(5 * density + 0.5)), bmpW, this.elapsedStyle?.width ?? 0);
    this.fraction = 0; // progress 0..1
    this.scrollX = 0; // waveform offset under the cursor (px)
    this.values = null; // displayed values
    this.target = null; // values being animated to
    this.blend = 1;
    this.noData = true;
    this.waveLen = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cv';
    this.el.appendChild(this.canvas);
    this.setWave(null, false);
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_track_changed') this.onTrack(d?.track, !d?.meta);
      else if (msg === 'msg_player_track_wave') this.setWave(d.track.wave, true);
      else if (msg === 'msg_player_track_seek') this.syncPosition();
      else if (msg === 'msg_player_playing_state_changed') this.onPlaying(d.arg1 === STATE_PLAYING);
    });
    this._follow = null;
  }

  readBarStyle(a, name) {
    const ref = a.ref(name);
    if (!ref || !ref.name) return null;
    const d = this.ctx.drawables.byName(ref.name, a.theme);
    const meta = d?.meta;
    if (!meta) return null;
    return {
      width: d.intrinsicWidth,
      scale: d.intrinsicWidth / (meta.size?.[0] || d.intrinsicWidth || 1),
      fill: parseColor(meta.fill ?? meta.color) ?? 0xffffffff,
      edge: meta.edge ? parseColor(meta.edge) : null,
    };
  }

  onFinishInflate() {
    this.cursor = this.findViewById('waveseek_cursor');
  }

  onTrack(track, animate) {
    if (!track) {
      this.setWave(null, animate);
      this.state.enabled = false;
      return;
    }
    let wave = track.wave ?? null;
    if (!wave && track.durationMs > 0) wave = placeholderWave(this.numBars, this.layoutMode);
    this.setWave(wave, animate);
    this.setEnabled(track.durationMs > 0);
    this.syncPosition();
  }

  /** New wave data, cross-faded from the current bars (dataAnimTime / noDataAnimTime). */
  setWave(data, animate) {
    const n = this.numBars;
    const noData = !data || data.length === 0;
    const next = noData ? new Float32Array(n) : data.length !== n ? resample(n, data) : Float32Array.from(data);
    // One cross-fade at a time: a new one starts from the bars on screen (a
    // waveform that arrives just after the track change lands mid-fade).
    this._anim?.();
    this._anim = null;
    if (animate && this.values) {
      const from = this.currentValues();
      this.values = from;
      this.target = next;
      this.blend = 0;
      const dur = (noData ? this.noDataAnimTime : this.dataAnimTime) * 1000;
      const start = performance.now();
      this._anim = this.ctx.onFrame(now => {
        this.blend = Math.min(1, (now - start) / dur);
        this.invalidate();
        if (this.blend >= 1) {
          this.values = next;
          this.target = null;
          this._anim = null;
          return false;
        }
        return true;
      });
    } else {
      this.values = next;
      this.target = null;
      this.blend = 1;
      this.invalidate();
    }
    this.noData = noData;
  }

  currentValues() {
    if (!this.target) return this.values;
    const out = new Float32Array(this.numBars), b = this.blend;
    for (let i = 0; i < out.length; i++) out[i] = this.target[i] * b + (1 - b) * this.values[i];
    return out;
  }

  valueAt(i) {
    const v = this.values?.[i] ?? 0;
    return this.target ? this.target[i] * this.blend + (1 - this.blend) * v : v;
  }

  onPlaying(playing) {
    clearTimeout(this._follow);
    this._follow = 0;
    if (playing) this.follow();
    else this.syncPosition();
  }

  /**
   * Follows the position while playing, a step each time it moves a third
   * of a device pixel (drawn anti-aliased, so it glides), at most
   * MAX_FOLLOW_FPS a second: not every frame, so a slow song's bar draws
   * a few times a second, never 60. Hidden (the screen off), it stops
   * until shown again.
   */
  follow() {
    const p = this.ctx.player;
    if (p?.state !== STATE_PLAYING) { this._follow = 0; return; }
    if (document.hidden) {
      this._follow = 0;
      document.addEventListener('visibilitychange', () => { if (!this._follow && this.ctx.player?.state === STATE_PLAYING) this.follow(); }, {once: true});
      return;
    }
    if (!this.state.pressed) this.syncPosition();
    const msPerStep = (p.track?.durationMs || 0) * this.step() / (this.waveLen || 1) / (p.audio?.playbackRate || 1);
    this._follow = setTimeout(() => this.follow(), Math.max(1000 / MAX_FOLLOW_FPS, Math.min(1000, msPerStep || 250)));
  }

  /** The smallest move drawn: a third of a device pixel (layout units are device pixels). */
  step() {
    return 1 / 3;
  }

  syncPosition() {
    const p = this.ctx.player, t = p?.track;
    const f = t?.durationMs ? p.positionMs() / t.durationMs : 0;
    this.setFraction(f);
  }

  setFraction(f) {
    if (!(f >= 0)) f = 0;
    if (f > 1) f = 1;
    this.fraction = f;
    const x = this.waveLen * f, s = this.step();
    if (Math.round(x / s) !== Math.round(this.scrollX / s)) {
      this.scrollX = x;
      this.invalidate();
    } else this.scrollX = x;
  }

  onMeasure(wSpec, hSpec) {
    this.setMeasuredDimension(getDefaultSize(this.suggestedMinimumWidth, wSpec), getDefaultSize(this.suggestedMinimumHeight, hSpec));
    for (const c of this.children) {
      const lp = c.lp ?? {width: -2, height: -2};
      c.measure(getChildMeasureSpec(wSpec, this.paddingLeft + this.paddingRight, lp.width), getChildMeasureSpec(hSpec, this.paddingTop + this.paddingBottom, lp.height));
    }
  }

  onLayout() {
    const w = this.width, h = this.height;
    this.contentH = h - this.paddingTop - this.paddingBottom;
    const contentW = Math.max(0, w - this.paddingLeft - this.paddingRight);
    if (this.layoutMode === WAVE_STATIC) {
      const pitch = (contentW + this.spacing) / this.numBars;
      this.barW = Math.max(1, pitch - this.spacing);
    }
    this.waveLen = Math.ceil((this.barW + this.spacing) * this.numBars - this.spacing);
    this.cursorX = this.layoutMode === WAVE_SCROLLING ? contentW * this.cursorPos + this.cursorOffset + this.paddingLeft : 0;
    const c = this.cursor;
    if (c) {
      const half = c.measuredWidth / 2;
      c.layout(Math.trunc(this.cursorX - half - 0.5), 0, Math.trunc(this.cursorX + half + 0.5), Math.trunc(this.contentH + 0.5));
    }
    this.scrollX = this.waveLen * this.fraction;
    this.invalidate();
  }

  draw() {
    super.draw();
    const cv = this.canvas, w = this.width, h = this.height, px = this.ctx.px;
    if (cv.width !== w || cv.height !== h) {
      cv.width = Math.max(1, w);
      cv.height = Math.max(1, h);
      cv.style.width = px(w) + 'px';
      cv.style.height = px(h) + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    if (!this.values) return;
    const pl = this.paddingLeft, pr = this.paddingRight, pt = this.paddingTop, pb = this.paddingBottom;
    const contentW = w - pl - pr;
    const H = this.barW, pitch = H + this.spacing, K = this.numBars;
    let cursor, offset, right, scroll;
    if (this.layoutMode === WAVE_SCROLLING) {
      scroll = this.scrollX;
      cursor = this.cursorPos * contentW + this.cursorOffset;
      right = contentW - cursor;
      offset = pl + cursor;
    } else {
      scroll = 0; cursor = 0; right = contentW; offset = pl;
    }
    g.save();
    g.beginPath();
    g.rect(pl, pt, contentW, h - pt - pb);
    g.clip();
    g.translate(offset - scroll, pt);
    let first, last, firstAlpha = 1, lastAlpha = 1;
    if (this.layoutMode === WAVE_SCROLLING) {
      const leftEdge = scroll - cursor, rightEdge = scroll + right;
      first = Math.max(0, Math.min(K - 1, Math.trunc((this.spacing + leftEdge) / pitch)));
      last = Math.max(0, Math.min(K - 1, Math.ceil(rightEdge / pitch) - 1));
      if (this.fadeSidebars) {
        const a = first * pitch + H - leftEdge;
        firstAlpha = a >= H ? 1 : Math.trunc((a / H) * 255) / 255;
        const b = last * pitch + H - rightEdge;
        lastAlpha = b >= H || b < 0 ? 1 : Math.trunc((1 - b / H) * 255) / 255;
      }
    } else {
      first = 0;
      last = Math.max(0, Math.min(K - 1, Math.ceil(contentW / pitch) - 1));
    }
    const curBar = this.layoutMode === WAVE_SCROLLING ? Math.trunc(scroll / pitch) : -1;
    const enabled = this.state.enabled;
    for (let i = first; i <= last; i++) {
      const x = i * pitch;
      const alpha = i === first ? firstAlpha : i === last ? lastAlpha : 1;
      if (alpha <= 0) continue;
      const v = this.valueAt(i);
      let bh = v * this.contentH;
      if (bh < this.minBarH) bh = this.minBarH;
      const top = (this.contentH - bh) / 2;
      // Bars are split at the cursor: the played part uses the elapsed style.
      if (this.layoutMode === WAVE_SCROLLING && x < scroll) {
        g.save();
        g.beginPath();
        g.rect(x - 1, -1, Math.max(0, scroll - x + 1), this.contentH + 2);
        g.clip();
        this.bar(g, this.elapsedStyle, x, top, H, bh, alpha);
        g.restore();
        if (x + H > scroll) {
          g.save();
          g.beginPath();
          g.rect(scroll, -1, x + H - scroll + 1, this.contentH + 2);
          g.clip();
          this.bar(g, enabled ? this.barStyle : this.elapsedStyle, x, top, H, bh, alpha);
          g.restore();
        }
      } else this.bar(g, enabled ? this.barStyle : this.elapsedStyle, x, top, H, bh, alpha);
    }
    void curBar;
    g.restore();
  }

  /** One bar: a pill of width w (caps of w/2), outlined when the style has an edge colour. */
  bar(g, style, x, top, w, h, alpha) {
    if (!style) return;
    const top0 = Math.round(top), bottom = Math.round(top + h);
    const pill = (l, t, r, b) => {
      const rad = Math.min((r - l) / 2, (b - t) / 2);
      g.moveTo(l + rad, t);
      g.arcTo(r, t, r, t + rad, rad);
      g.arcTo(r, b, r - rad, b, rad);
      g.arcTo(l, b, l, b - rad, rad);
      g.arcTo(l, t, l + rad, t, rad);
      g.closePath();
    };
    if (style.edge !== null && style.edge !== undefined) {
      const e = Math.max(0.5, style.scale);
      g.beginPath();
      pill(x, top0, x + w, bottom);
      pill(x + e, top0 + e, x + w - e, bottom - e);
      g.fillStyle = argbCss(style.edge, alpha);
      g.fill('evenodd');
      g.beginPath();
      pill(x + e, top0 + e, x + w - e, bottom - e);
    } else {
      g.beginPath();
      pill(x, top0, x + w, bottom);
    }
    g.fillStyle = argbCss(style.fill, alpha);
    g.fill();
  }

  // Touch: drag scrubs the waveform under the cursor; release seeks.
  onPointerDown(e) {
    if (!this.state.enabled) return false;
    this._drag = {x: e.x, start: this.scrollX};
    this.setPressed(true);
    this.ctx.bus.post('bus_gui', 'msg_gui_intermediate_seek_start', this);
    return true;
  }

  onPointerMove(e) {
    const d = this._drag;
    if (!d) return;
    const x = this.layoutMode === WAVE_SCROLLING ? Math.max(0, Math.min(this.waveLen, d.start - (e.x - d.x))) : Math.max(0, Math.min(this.waveLen, e.x - this.paddingLeft));
    this.setFraction(this.waveLen ? x / this.waveLen : 0);
    const t = this.ctx.player?.track;
    if (t) this.ctx.bus.post('bus_gui', 'msg_gui_intermediate_seek', this, {arg1: Math.round(this.fraction * t.durationMs)});
  }

  onPointerUp() {
    if (!this._drag) return;
    this._drag = null;
    this.setPressed(false);
    const t = this.ctx.player?.track;
    if (t) this.ctx.bus.post('bus_player_cmd', 'cmd_player_seek', this, {arg1: Math.round(this.fraction * t.durationMs)});
    this.ctx.bus.post('bus_gui', 'msg_gui_intermediate_seek_end', this);
  }

  onStateChanged() {
    super.onStateChanged();
    const c = this.cursor;
    const root = this.ctx.topNav;
    if (c && root) root.stateAnim('anim_waveseek_pressed', this.state.pressed, 250);
  }
}

register(['Waveseek'], Waveseek);
