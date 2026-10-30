/** Original browser renderers reconstructed from the build 1031 technical reference.
 * PA1031-RENDER-003/005–020; PA1031-GESTURE-011–015/021.
 * No APK source, bitmap, shader, font, or audio payload is included.
 * Browser substitutions and unverified native pixels are listed in RENDERING_LIMITS.
 */
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const number = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const clock = () => globalThis.performance?.now() ?? Date.now();
const frame = callback => globalThis.requestAnimationFrame?.(callback) ?? null;
const cancelFrame = id => { if (id != null) globalThis.cancelAnimationFrame?.(id); };

export const RENDERING_LIMITS = Object.freeze([
  'Independent vector bar caps replace proprietary antialiased bar bitmaps; native pixels are unverified.',
  'Audio peaks are supplied by the browser analyzer; equivalence to native_scan is unverified. Unknown peaks draw no fabricated waveform.',
  'Browser input defaults (8 CSS px slop, 50 CSS px/s minimum fling) are adaptations, not recovered Android ViewConfiguration values.',
  'Browser pointer ownership stays with the first pointer. Endpoint fling clamps; native overscroll rebound is not reproduced.',
  'Backdrop follows recovered sampling and color math, but GPU precision, final texture composition, and scale-zero native palette selection are unverified.',
  'Backdrop preprocessing is capped at256px for browser CPU cost; settings above that native size expose an explicit capped status.',
]);

/** Native nearest-index resampling, not bucket averaging. null remains unknown. */
export function resamplePeaks(peaks, count) {
  if (!peaks?.length) return null;
  const result = new Float32Array(count);
  const step = peaks.length / count;
  let index = 0;
  for (let i = 0; i < count; i++, index += step) {
    result[i] = clamp(number(peaks[Math.min(peaks.length - 1, Math.floor(index + .5))]));
  }
  return result;
}

export function waveGeometry(width, height, fraction, mode = 'scroll', unitScale = 1, dpr = 1, paddingX) {
  const density = Math.max(.1, number(unitScale, 1));
  const ratio = Math.max(.1, number(dpr, 1));
  const dp = value => Math.round(value * density * ratio) / ratio;
  const padding = paddingX == null ? dp(mode === 'plain' ? 12 : 8) : Math.max(0, number(paddingX));
  const contentWidth = Math.max(0, width - padding * 2);
  const staticMode = mode === 'static';
  const count = staticMode ? 60 : 100;
  const bitmapWidth = dp(staticMode ? 5.5 : 8);
  let spacing = dp(staticMode ? .5 : 1.25);
  let barWidth = bitmapWidth;
  if (staticMode) {
    const pitch = (contentWidth + spacing) / count;
    barWidth = Math.max(1 / ratio, pitch - spacing);
    spacing = pitch - barWidth;
  }
  const pitch = barWidth + spacing;
  const span = Math.ceil((pitch * count - spacing) * ratio) / ratio;
  const q = clamp(number(fraction));
  const cursor = padding + (staticMode || mode === 'plain' ? q * contentWidth : .5 * contentWidth);
  return { width, height, padding, contentWidth, count, barWidth, spacing, pitch, span, cursor,
    origin: staticMode || mode === 'plain' ? padding : cursor - q * span,
    capHeight: Math.floor(bitmapWidth * ratio / 2) / ratio,
    minHeight: Math.max(bitmapWidth, dp(10)), dpr: ratio, unitScale: density };
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(0, rect.width), height = Math.max(0, rect.height);
  const dpr = Math.max(1, number(globalThis.devicePixelRatio, 1));
  const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
  const changed = canvas.width !== w || canvas.height !== h;
  if (changed) { canvas.width = w; canvas.height = h; }
  return { width, height, dpr, changed };
}

// Two independently drawn half-ellipses and a stretched middle preserve the native
// cap height even when fixed-mode bar width becomes narrow.
function barPath(ctx, x, y, width, height, cap, append = false) {
  const ry = Math.min(cap, height / 2), rx = width / 2;
  if (!append) ctx.beginPath();
  ctx.moveTo(x, y + ry);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(x + width, y + height - ry);
  ctx.ellipse(x + rx, y + height - ry, rx, ry, 0, 0, Math.PI);
  ctx.closePath();
}

// Measurements describe the rim, not a copied image. Drawing an independent
// ellipse ring deliberately does not claim the native PNG's corner rasterization.
function paintBar(ctx, x, y, width, height, cap, fill, rim, rimX, rimY) {
  if (!rim) { ctx.fillStyle = fill; barPath(ctx, x, y, width, height, cap); ctx.fill(); return; }
  const ix = Math.min(rimX, width / 2), iy = Math.min(rimY, height / 2);
  barPath(ctx, x, y, width, height, cap);
  barPath(ctx, x + ix, y + iy, width - 2 * ix, height - 2 * iy, Math.max(0, cap - iy), true);
  ctx.fillStyle = rim; ctx.fill('evenodd');
  barPath(ctx, x + ix, y + iy, width - 2 * ix, height - 2 * iy, Math.max(0, cap - iy));
  ctx.fillStyle = fill; ctx.fill();
}

function cubicBezier(t, x1, y1, x2, y2) {
  const sample = (s, a, b) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (sample(mid, x1, x2) < t) lo = mid; else hi = mid;
  }
  return sample((lo + hi) / 2, y1, y2);
}

/**
 * getState: {time,duration,peaks,mode:'scroll'|'static'|'plain',playing,colors,
 *   trackId?,unitScale?,paddingX?,reducedMotion?,touchSlop?,minFlingVelocity?}.
 * colors: {theme,remaining?,elapsed?,cursor?,plainBg?,thumb?,pressed?,track?,progress?};
 * paddingX is resolved CSS pixels; callbacks use seconds, preview end=null.
 * Native pointercancel commits last pending seek. Track replacement/destroy abort
 * ownership without applying an old time to a new track. Plain Seek samples UP;
 * fixed Waveseek does not. Call update after application state changes.
 */
export class Waveform {
  constructor(canvas, { getState, onSeek = () => {}, onPreview = () => {} }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getState = getState;
    this.onSeek = onSeek;
    this.onPreview = onPreview;
    this.gesture = null;
    this.fling = null;
    this.pending = null;
    this.destroyed = false;
    this.raf = null;
    this.data = null;
    this.target = null;
    this.peaks = undefined;
    this.identity = undefined;
    this.cursorLevel = 0;
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    this.listeners = new Map();
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      const fn = event => this.handlePointer(event);
      canvas.addEventListener(type, fn);
      this.listeners.set(type, fn);
    }
    this.onBlur = () => this.finish(true);
    globalThis.addEventListener?.('blur', this.onBlur);
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.update()) : null;
    this.resizeObserver?.observe(canvas);
    this.update();
  }

  readState() {
    const s = this.getState() || {};
    return { ...s, mode: ['static', 'plain'].includes(s.mode) ? s.mode : 'scroll',
      time: Math.max(0, number(s.time)), duration: Math.max(0, number(s.duration)) };
  }

  synchronize(s, now) {
    // A null id is meaningful too: it denotes no selected media.
    const identity = 'trackId' in s ? s.trackId : s.peaks;
    const changedTrack = this.initialized && identity !== this.identity;
    const changedMode = this.initialized && s.mode !== this.mode;
    if (changedTrack || changedMode) this.finish(!changedTrack, false);
    if (changedTrack) { this.data = null; this.target = null; }
    this.identity = identity;
    this.mode = s.mode;
    this.initialized = true;
    const count = s.mode === 'static' ? 60 : 100;
    if (s.peaks !== this.peaks || changedMode || changedTrack) {
      const next = resamplePeaks(s.peaks, count);
      this.data = this.blended(now);
      this.peaks = s.peaks;
      if (!next || !this.data || this.data.length !== count || s.reducedMotion) {
        this.data = next; this.target = null;
      } else { this.target = next; this.morphStarted = now; }
    }
  }

  blended(now) {
    if (!this.target) return this.data;
    const t = clamp((now - this.morphStarted) / 400);
    const blend = 1 - (1 - t) ** 3;
    const result = Float32Array.from(this.target, (p, i) => this.data[i] + (p - this.data[i]) * blend);
    if (t >= 1) { this.data = this.target; this.target = null; return this.data; }
    return result;
  }

  queueFrame() {
    if (this.raf == null && !this.destroyed) this.raf = frame(() => { this.raf = null; this.update(); });
  }

  update() {
    if (this.destroyed || !this.ctx) return;
    const now = clock(), s = this.readState();
    this.synchronize(s, now);
    const size = fitCanvas(this.canvas);
    if (this.size && (size.width !== this.size.width || size.height !== this.size.height) && (this.gesture || this.fling)) this.finish(true, false);
    this.size = size;
    const q = this.pending == null ? (s.duration ? s.time / s.duration : 0) : this.pending;
    this.geometry = waveGeometry(size.width, size.height, q, s.mode, s.unitScale, size.dpr, s.paddingX);
    if (this.fling) this.stepFling(now, s);
    const elapsed = Math.min(50, Math.max(0, now - (this.lastDraw ?? now)));
    this.lastDraw = now;
    const pressed = !!(this.gesture || this.fling);
    const wanted = pressed ? 1 : 0;
    this.cursorLevel = s.reducedMotion ? wanted : this.cursorLevel + clamp(wanted - this.cursorLevel, -elapsed / 250, elapsed / 250);
    const fraction = this.pending == null ? (s.duration ? s.time / s.duration : 0) : this.pending;
    this.geometry = waveGeometry(size.width, size.height, fraction, s.mode, s.unitScale, size.dpr, s.paddingX);
    this.draw(s, this.blended(now));
    if (s.playing || this.fling || this.target || this.cursorLevel !== wanted) this.queueFrame();
  }

  draw(s, peaks) {
    const ctx = this.ctx, g = this.geometry, color = s.colors || {};
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, g.width, g.height);
    const light = color.theme === 'Light' || color.theme === 'light';
    const remaining = color.remaining || (light ? (s.mode === 'static' ? '#ffffffd9' : '#ffffff') : '#ffffffa8');
    const elapsed = color.elapsed || (light ? (s.mode === 'static' ? '#7e7e7e66' : '#ffffffa1') : '#7e7e7e40');
    if (s.mode === 'plain') {
      ctx.fillStyle = color.plainBg || (light ? '#f5f5f555' : '#33333344');
      ctx.beginPath(); ctx.roundRect(0, 10 * g.unitScale, g.width, Math.max(0, g.height - 20 * g.unitScale), (s.lessRounding ? 8 : 28) * g.unitScale); ctx.fill();
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(s.mode === 'plain' ? 0 : g.padding, 0, s.mode === 'plain' ? g.width : g.contentWidth, g.height); ctx.clip();
    if (s.mode === 'plain') {
      const thickness = 2 * g.unitScale;
      ctx.fillStyle = color.track || 'transparent';
      ctx.fillRect(g.padding, (g.height - thickness) / 2, g.contentWidth, thickness);
      ctx.fillStyle = color.progress || 'transparent';
      ctx.fillRect(g.padding, (g.height - thickness) / 2, g.cursor - g.padding, thickness);
      ctx.fillStyle = color.thumb || (light ? '#333333' : '#eeeeee77');
      ctx.beginPath(); ctx.roundRect(g.cursor - 9 * g.unitScale, (g.height - 10 * g.unitScale) / 2, 18 * g.unitScale, 10 * g.unitScale, 5 * g.unitScale); ctx.fill();
      ctx.globalAlpha = this.cursorLevel;
      ctx.fillStyle = color.pressed || (light ? '#000000' : '#ffffff');
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (peaks) {
      // Native's partially visible first/last bars fade by visible-width fraction.
      for (let i = 0; i < peaks.length; i++) {
        const x = g.origin + i * g.pitch;
        const visible = Math.max(0, Math.min(x + g.barWidth, g.width - g.padding) - Math.max(x, g.padding));
        if (!visible) continue;
        const h = Math.max(g.minHeight, peaks[i] * g.height);
        const top = Math.round((g.height - h) / 2 * g.dpr) / g.dpr;
        const bottom = Math.round((g.height + h) / 2 * g.dpr) / g.dpr;
        ctx.globalAlpha = s.mode === 'scroll' ? Math.floor(visible / g.barWidth * 255) / 255 : 1;
        const narrow = s.mode === 'static';
        const remainingRim = light ? (narrow ? '#78787873' : '#000000') : (narrow ? '#00000026' : '#51515173');
        const elapsedRim = light && !narrow ? '#888888' : null;
        for (const [a, b, fill, rim, rimPixels] of [[g.padding, g.cursor, elapsed, elapsedRim, 1], [g.cursor, g.width - g.padding, remaining, remainingRim, light && narrow ? 2 : 1]]) {
          if (x >= b || x + g.barWidth <= a) continue;
          ctx.save(); ctx.beginPath(); ctx.rect(a, 0, b - a, g.height); ctx.clip();
          paintBar(ctx, x, top, g.barWidth, bottom - top, g.capHeight, fill, rim, g.barWidth * rimPixels / (narrow ? 22 : 32), rimPixels / 4 * g.unitScale); ctx.restore();
        }
      }
    }
    ctx.globalAlpha = s.mode === 'plain' ? 0 : this.cursorLevel;
    ctx.fillStyle = color.cursor || '#000000';
    const scale = .55 + .45 * this.cursorLevel;
    const cursorHeight = g.height * scale;
    ctx.fillRect(g.cursor - .75 * g.unitScale * scale, (g.height - cursorHeight) / 2, 1.5 * g.unitScale * scale, cursorHeight);
    ctx.restore();
  }

  preview(q, s) {
    this.pending = s.mode === 'plain' ? Math.round(clamp(q) * 10000) / 10000 : clamp(q);
    this.onPreview(Math.round(this.pending * s.duration * 1000) / 1000);
  }

  handlePointer(event) {
    if (this.destroyed) return;
    const s = this.readState();
    this.synchronize(s, clock());
    if (!s.duration) return;
    const rect = this.canvas.getBoundingClientRect();
    const rawX = event.clientX - rect.left, y = event.clientY - rect.top;
    const ratio = this.size?.dpr || 1;
    const x = s.mode === 'plain' ? Math.round(rawX * ratio) / ratio : rawX;
    const g = this.geometry || waveGeometry(rect.width, rect.height, s.time / s.duration, s.mode, s.unitScale, ratio, s.paddingX);
    if (event.type === 'pointerdown') {
      if (this.gesture || event.button > 0) return;
      if (x < (s.mode === 'plain' ? 0 : g.padding) || x > g.width - (s.mode === 'plain' ? 0 : g.padding) || y < 0 || y > g.height || !g.contentWidth) return;
      // Re-grab captures the last painted preview and stops the old fling.
      this.fling = null;
      const q = this.pending ?? clamp(s.time / s.duration);
      this.gesture = { id: event.pointerId, startX: x, startY: y, lastX: x, q, acquired: false,
        samples: [[clock(), x]], mode: s.mode };
      this.canvas.setPointerCapture?.(event.pointerId);
      if (s.mode !== 'scroll') this.preview((x - g.padding) / g.contentWidth, s);
      event.preventDefault();
      this.update();
      return;
    }
    if (!this.gesture || event.pointerId !== this.gesture.id) return;
    const gesture = this.gesture;
    if (event.type === 'pointermove') {
      if (s.mode !== 'scroll') this.preview((x - g.padding) / g.contentWidth, s);
      else {
        const dx = x - gesture.startX, dy = y - gesture.startY;
        if (!gesture.acquired && Math.hypot(dx, dy) >= number(s.touchSlop, 8)) {
          if (Math.abs(dy) > Math.abs(dx)) { this.finish(true); return; }
          gesture.acquired = true;
        }
        if (gesture.acquired) {
          // Logical strip length, never viewport width. Reversal uses signed dx.
          this.preview(gesture.q - dx / g.span, s);
        }
      }
      gesture.lastX = x;
      const now = clock();
      gesture.samples.push([now, x]);
      while (gesture.samples.length > 2 && now - gesture.samples[0][0] > 100) gesture.samples.shift();
      event.preventDefault(); this.update();
    } else if (event.type === 'pointerup') {
      if (s.mode === 'plain') this.preview((x - g.padding) / g.contentWidth, s);
      let velocity = 0;
      const first = gesture.samples[0], last = gesture.samples.at(-1);
      if (last[0] > first[0] && clock() - last[0] <= 100) velocity = -(last[1] - first[1]) * 1000 / (last[0] - first[0]);
      if (s.mode === 'scroll' && gesture.acquired && Math.abs(velocity) >= number(s.minFlingVelocity, 50) && !s.reducedMotion) {
        this.gesture = null;
        const now = clock();
        this.fling = { velocity, started: now, last: now, duration: Math.abs(velocity / 30000) * 1000 };
        this.releaseCapture(gesture.id);
        this.queueFrame();
      } else this.finish(true);
      event.preventDefault();
    } else if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      // Native CANCEL is a zero-velocity release and commits the pending value.
      this.finish(true); event.preventDefault();
    }
  }

  stepFling(now, s) {
    const f = this.fling;
    const end = f.started + f.duration;
    const t = clamp((Math.min(now, end) - f.started) / f.duration);
    const prior = clamp((f.last - f.started) / f.duration);
    const v0 = f.velocity * (1 - cubicBezier(prior, .103, .389, .307, .966));
    const v1 = f.velocity * (1 - cubicBezier(t, .103, .389, .307, .966));
    const delta = (v0 + v1) / 2 * (Math.min(now, end) - f.last) / 1000;
    f.last = Math.min(now, end);
    this.preview((this.pending ?? s.time / s.duration) + delta / this.geometry.span, s);
    if (t >= 1 || this.pending === 0 || this.pending === 1) this.finish(true, false);
  }

  releaseCapture(id) {
    if (id != null && this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
  }

  finish(commit, redraw = true) {
    const gesture = this.gesture;
    const pending = this.pending;
    this.gesture = null; this.fling = null; this.pending = null;
    this.releaseCapture(gesture?.id);
    if (pending != null && commit) {
      const s = this.readState();
      const identity = 'trackId' in s ? s.trackId : s.peaks;
      // Blur/lost ownership can arrive between application track change and paint.
      if (identity === this.identity) this.onSeek(Math.round(clamp(pending) * s.duration * 1000) / 1000);
    }
    if (gesture || pending != null) this.onPreview(null);
    if (redraw && !this.destroyed) this.update();
  }

  destroy() {
    this.destroyed = true;
    this.finish(false, false);
    cancelFrame(this.raf);
    this.resizeObserver?.disconnect();
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    globalThis.removeEventListener?.('blur', this.onBlur);
    this.canvas.style.touchAction = this.previousTouchAction;
  }
}

/** Native modes: 0/centerCrop width-fits; 1/keepAspect has a portrait exception;
 * 2/centerCropXY chooses the fit axis by SOURCE orientation. Names do not mean
 * browser cover/contain. The portrait threshold16 is source pixels, not dp.
 * AAImageView.A calls К with z=true; centerCropXY alone forces it false. */
export function computeArtCrop(sourceWidth, sourceHeight, width, height, mode = 'keepAspect') {
  if (![sourceWidth, sourceHeight, width, height].every(v => v > 0 && Number.isFinite(v))) return null;
  let scale;
  if (mode === 0 || mode === 'crop' || mode === 'centerCrop') scale = width / sourceWidth;
  else if (mode === 2 || mode === 'cropXY' || mode === 'centerCropXY') scale = sourceHeight >= sourceWidth ? width / sourceWidth : height / sourceHeight;
  else if (sourceWidth + 16 < sourceHeight) scale = Math.min(width / sourceWidth, height / sourceHeight);
  else scale = width / sourceWidth;
  const w = sourceWidth * scale, h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h,
    clip: { x: Math.max(0, (width - w) / 2), y: Math.max(0, (height - h) / 2), width: Math.min(w, width), height: Math.min(h, height) } };
}

export function drawArtCrop(ctx, image, width, height, { mode = 'keepAspect', radius = 0 } = {}) {
  const crop = computeArtCrop(image.naturalWidth || image.width, image.naturalHeight || image.height, width, height, mode);
  if (!crop) return;
  const r = crop.clip;
  ctx.save(); ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, Math.max(0, Math.min(radius === -1 ? height / 2 : radius, r.width / 2, r.height / 2)));
  ctx.clip(); ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height); ctx.restore();
}

export const BACKDROP_EFFECTS = Object.freeze({
  blackList: Object.freeze({ size: 4, saturation: 1.75, intensity: .125, darken: .175, pinLight: .17 }),
  lightList: Object.freeze({ size: 8, saturation: 1.5, intensity: 1, lighten: .85, pinLight: .9 }),
  blackLyrics: Object.freeze({ size: 8, saturation: 1.5, intensity: .45, pinLight: -1 }),
  lightLyrics: Object.freeze({ size: 4, saturation: 2.25, intensity: 1.75, darken: 1, lighten: .7, pinLight: .975 }),
});

export const BACKDROP_DEFAULTS = Object.freeze({ enabled: true, blur: 5, scale: 5, saturation: 150,
  intensity: 100, gradient: 4, gradientColor: '#FF000000', fallback: '#000000', transitionMs: 0 });

function backdropConfig(config = {}) {
  const c = { ...BACKDROP_DEFAULTS, ...config };
  return { ...c, blur: Math.round(clamp(number(c.blur, 5), 0, 15)),
    scale: Math.round(clamp(number(c.scale, 5), 0, 10)), saturation: Math.max(0, number(c.saturation, 150)),
    intensity: Math.max(0, number(c.intensity, 100)), gradient: clamp(number(c.gradient, 4), 0, 10) };
}

function rgbColor(value) {
  const hex = String(value).replace(/^#/, '');
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  if (/^[0-9a-f]{6}$/i.test(rgb)) return [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16));
  if (/^[0-9a-f]{3}$/i.test(rgb)) return [...rgb].map(c => parseInt(c + c, 16));
  return [0, 0, 0];
}

export function gradientStops(amount) {
  const g = clamp(number(amount), 0, 10) / 10;
  return [0, .75 - .65 * g, 1 - .15 * g];
}

/** Gradient is composited into the bitmap BEFORE any blur/color pass. */
export function applyBackdropGradient(data, width, height, amount, color = '#FF000000') {
  const result = new Uint8ClampedArray(data);
  if (!(amount > 0)) return result;
  const [, start, end] = gradientStops(amount), rgb = rgbColor(color);
  const g = clamp(amount, 0, 10) / 10;
  const endpointAlpha = rgb.every(c => c === 0) ? 1 : Math.round(170 + 85 * g) / 255;
  for (let y = 0; y < height; y++) {
    const a = clamp(((y + .5) / height - start) / (end - start)) * endpointAlpha;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, oldAlpha = data[i + 3] / 255;
      const alpha = a + oldAlpha * (1 - a);
      for (let c = 0; c < 3; c++) result[i + c] = alpha ? (rgb[c] * a + data[i + c] * oldAlpha * (1 - a)) / alpha : 0;
      result[i + 3] = alpha * 255;
    }
  }
  return result;
}

/** Recovered diagonal offset schedule, in texels. ARM64:13a1e4/13f3e0.
 * Initial constant at44688=.4761905074; subsequent pass divisors .75,.6.
 */
export function blurOffsets(level) {
  const count = Math.round(clamp(number(level), 0, 15));
  return [.4761905074119568, ...Array.from({ length: count }, (_, i) => 1 / (i % 2 ? .6 : .75))];
}

function bilinear(data, width, height, x, y, channel) {
  x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = data[(y0 * width + x0) * 4 + channel], b = data[(y0 * width + x1) * 4 + channel];
  const c = data[(y1 * width + x0) * 4 + channel], d = data[(y1 * width + x1) * 4 + channel];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Independent CPU equivalent of recovered sampling/color equations.
 * Ping-pong targets were RGBA8, LINEAR, CLAMP_TO_EDGE (native1554a0).
 * JS float/Canvas resampling cannot certify native mediump/lowp GPU pixels.
 */
export function processBackdropPixels(data, width, height, config = {}) {
  const c = backdropConfig(config);
  let pixels = applyBackdropGradient(data, width, height, c.gradient, c.gradientColor);
  // Android bitmap upload uses premultiplied RGB; Canvas ImageData is straight RGBA.
  for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) pixels[i + channel] *= pixels[i + 3] / 255;
  const offsets = blurOffsets(c.blur);
  const saturation = c.effect?.saturation ?? c.saturation / 100;
  const intensity = c.effect?.intensity ?? c.intensity / 100;
  const pin = c.effect?.pinLight ?? -1, lighten = c.effect?.lighten ?? 0, darken = c.effect?.darken ?? 1;
  for (let pass = 0; pass < offsets.length; pass++) {
    const next = new Uint8ClampedArray(pixels.length), p = offsets[pass], final = pass === offsets.length - 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const values = [0, 0, 0];
      for (let channel = 0; channel < 3; channel++) {
        values[channel] = (bilinear(pixels, width, height, x - p, y - p, channel) + bilinear(pixels, width, height, x + p, y - p, channel)
          + bilinear(pixels, width, height, x - p, y + p, channel) + bilinear(pixels, width, height, x + p, y + p, channel)) / (4 * 255);
      }
      const i = (y * width + x) * 4;
      const luma = (.2125 * values[0] + .7154 * values[1] + .0721 * values[2]) * intensity;
      for (let channel = 0; channel < 3; channel++) {
        let value = values[channel];
        if (final) {
          value = luma + (value * intensity - luma) * saturation;
          if (pin >= 0) value = value < pin / 2 ? 2 * value : (value >= (pin + 1) / 2 ? Math.max(0, 2 * value - 1) : pin);
          value = clamp(value, lighten, darken);
        }
        next[i + channel] = clamp(value) * 255;
      }
      next[i + 3] = 255;
    }
    pixels = next;
  }
  return pixels;
}

/** Artwork decoding is generation guarded. Caller retains ownership of blob URLs.
 * Config uses native preference units (percent values, pass count, size exponent).
 * effect optionally overrides {size,saturation,intensity,pinLight,lighten,darken}.
 * scale0's native palette scorer is unresolved; status explicitly reports the
 * independent single-pixel color substitution. Large preprocessing sizes cap at256 to
 * keep CPU rendering responsive on phones; status reports this browser limit.
 */
export class Backdrop {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = { ...BACKDROP_DEFAULTS };
    this.generation = 0;
    this.destroyed = false;
    this.image = null;
    this.texture = null;
    this.url = null;
    this.raf = null;
    this.previous = null;
    this.status = 'no-artwork';
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  makeCanvas(width, height) {
    const canvas = this.canvas.ownerDocument.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  async setArtwork(url, config = {}) {
    if (this.destroyed) return false;
    this.update(config);
    if (url && url === this.url && this.image) return true;
    const generation = ++this.generation;
    this.cancelLoad?.();
    this.url = url || null;
    if (!url) { this.stopFade(); this.image = null; this.texture = null; this.status = 'no-artwork'; this.redraw(); return true; }
    this.status = 'loading';
    const image = await new Promise(resolve => {
      const img = new Image();
      const done = value => { img.onload = null; img.onerror = null; resolve(value); };
      this.cancelLoad = () => done(null);
      img.onload = () => done(img);
      img.onerror = () => done(null);
      // The application supplies local object URLs; CORS avoids taint for an
      // explicitly supplied public artwork URL without accessing credentials.
      if (!String(url).startsWith('blob:') && !String(url).startsWith('data:')) img.crossOrigin = 'anonymous';
      img.src = url;
    });
    if (this.destroyed || generation !== this.generation) return false;
    this.cancelLoad = null;
    this.image = image;
    if (!image) { this.stopFade(); this.texture = null; this.status = 'artwork-unavailable'; this.redraw(); return false; }
    this.rebuild(true);
    return !!this.texture;
  }

  update(config = {}) {
    if (this.destroyed) return;
    const next = backdropConfig({ ...this.config, ...config });
    const changed = JSON.stringify(next) !== JSON.stringify(this.config);
    this.config = next;
    if (changed && this.image) this.rebuild();
    else this.redraw();
  }

  rebuild(artworkChanged = false) {
    if (!this.image || this.destroyed) return;
    const c = this.config;
    let retained = this.texture;
    if (this.previous && this.texture) {
      retained = this.makeCanvas(this.canvas.width, this.canvas.height);
      retained.getContext('2d').drawImage(this.canvas, 0, 0);
    }
    this.stopFade();
    const sourceWidth = this.image.naturalWidth || this.image.width;
    const sourceHeight = this.image.naturalHeight || this.image.height;
    const requested = c.effect?.size ?? (c.scale < 10 ? 2 ** c.scale : Math.max(sourceWidth, sourceHeight));
    const size = Math.max(1, Math.min(256, requested));
    // MilkLoader's wg.A=1 stretches the selected art into a square. Gradient
    // requires at least32px; smaller textures first scale without filtering.
    const downscale = sourceWidth > size || sourceHeight > size;
    const prep = this.makeCanvas(downscale ? size : sourceWidth, downscale ? size : sourceHeight);
    const prepCtx = prep.getContext('2d', { willReadFrequently: true });
    prepCtx.imageSmoothingEnabled = requested === 1 || c.blur === 0;
    prepCtx.drawImage(this.image, 0, 0, prep.width, prep.height);
    let work = prep;
    if (c.gradient > 0 && prep.height < 32) {
      work = this.makeCanvas(32, 32);
      const context = work.getContext('2d', { willReadFrequently: true });
      context.imageSmoothingEnabled = false; context.drawImage(prep, 0, 0, 32, 32);
    }
    try {
      const ctx = work.getContext('2d', { willReadFrequently: true });
      const input = ctx.getImageData(0, 0, work.width, work.height);
      const processed = processBackdropPixels(input.data, work.width, work.height, c);
      const output = ctx.createImageData(work.width, work.height);
      output.data.set(processed); ctx.putImageData(output, 0, 0);
      this.texture = work;
      if (artworkChanged && retained && number(c.transitionMs) > 0 && !c.reducedMotion) {
        this.previous = retained; this.fadeStart = clock(); this.fadeDuration = number(c.transitionMs);
      }
      this.status = requested === 1 ? 'artwork-single-pixel-color-substitution' : requested > 256 ? 'artwork-size-capped-256' : 'artwork';
    } catch {
      this.texture = null; this.status = 'artwork-unreadable';
    }
    this.redraw();
  }

  resize() { if (!this.destroyed) { this.size = fitCanvas(this.canvas); this.redraw(); } }

  redraw() {
    if (this.destroyed || !this.ctx) return;
    const { width, height, dpr } = this.size || fitCanvas(this.canvas);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = this.config.fallback;
    this.ctx.fillRect(0, 0, width, height);
    if (this.config.enabled && this.texture) {
      this.ctx.imageSmoothingEnabled = true;
      const progress = this.previous ? clamp((clock() - this.fadeStart) / this.fadeDuration) : 1;
      if (this.previous) this.ctx.drawImage(this.previous, 0, 0, width, height);
      this.ctx.globalAlpha = progress;
      this.ctx.drawImage(this.texture, 0, 0, width, height);
      this.ctx.globalAlpha = 1;
      if (progress >= 1) this.stopFade();
      else if (this.raf == null) this.raf = frame(() => { this.raf = null; this.redraw(); });
    }
  }

  stopFade() { cancelFrame(this.raf); this.raf = null; this.previous = null; }

  destroy() {
    this.destroyed = true; this.generation++;
    this.stopFade();
    this.cancelLoad?.(); this.cancelLoad = null;
    this.resizeObserver?.disconnect();
    this.image = null; this.texture = null;
  }
}
