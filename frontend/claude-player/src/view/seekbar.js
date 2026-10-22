// Platform seek bar (android.widget.SeekBar in Widget.Material.SeekBar) as an
// original stand-in: a 2dp track in colorControlNormal at the disabled alpha,
// the progress part and a round thumb in colorControlActivated, 16dp side
// paddings. A press or drag sets the progress and reports it like the
// platform OnSeekBarChangeListener: onProgressChanged(progress, fromUser)
// while it changes, onStopTrackingTouch() when the touch ends.
import {View, MeasureSpec} from './view.js';
import {register} from './inflater.js';

const css = c => `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${((c >>> 24) & 255) / 255})`;
const plain = cv => (cv ? cv.color ?? cv.list?.[cv.list.length - 1]?.color ?? null : null);

export class PlatformSeekBar extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    const dp = ctx.dpr;
    this.max = a.int('android:max', 100);
    this.progress = a.int('android:progress', 0);
    if (!a.has('android:paddingLeft') && !a.has('android:paddingStart') && !a.has('android:padding')) this.paddingLeft = this.paddingRight = Math.round(16 * dp);
    const theme = a.theme ?? ctx.theme;
    const on = plain(ctx.res.colorValue('?android:colorControlActivated', theme)) ?? 0xff80cbc4;
    const off = plain(ctx.res.colorValue('?android:colorControlNormal', theme)) ?? 0xffffffff;
    this.minH = Math.round(32 * dp);
    const px = v => ctx.px(v) + 'px';
    this.cssPx = px;
    const part = (h, color, radius = 0) => {
      const e = document.createElement('div');
      e.style.cssText = `position:absolute;height:${px(h)};background:${color};border-radius:${px(radius)};pointer-events:none`;
      this.el.appendChild(e);
      return e;
    };
    const track = Math.max(1, Math.round(2 * dp));
    this.trackEl = part(track, css(off), 0);
    this.trackEl.style.opacity = '0.3';
    this.progEl = part(track, css(on), 0);
    this.thumbD = Math.round(12 * dp);
    this.thumbEl = part(this.thumbD, css(on), this.thumbD / 2);
    this.thumbEl.style.width = px(this.thumbD);
    this.trackH = track;
  }

  onMeasure(wSpec, hSpec) {
    const w = MeasureSpec.getMode(wSpec) === MeasureSpec.UNSPECIFIED ? this.paddingLeft + this.paddingRight : MeasureSpec.getSize(wSpec);
    const hm = MeasureSpec.getMode(hSpec), hs = MeasureSpec.getSize(hSpec);
    const want = this.minH + this.paddingTop + this.paddingBottom;
    this.setMeasuredDimension(w, hm === MeasureSpec.EXACTLY ? hs : hm === MeasureSpec.AT_MOST ? Math.min(want, hs) : want);
  }

  setMax(max) { this.max = Math.max(0, max | 0); this.setProgress(this.progress); }

  setProgress(p, fromUser = false) {
    const v = Math.max(0, Math.min(this.max, Math.round(p)));
    if (v === this.progress && !fromUser) { this.invalidate(); return; }
    const changed = v !== this.progress;
    this.progress = v;
    this.invalidate();
    if (changed) this.onProgressChanged?.(v, fromUser);
  }

  draw() {
    super.draw();
    const pl = this.paddingLeft, w = Math.max(0, this.width - pl - this.paddingRight);
    const cy = this.paddingTop + (this.height - this.paddingTop - this.paddingBottom) / 2;
    const x = pl + (this.max > 0 ? w * this.progress / this.max : 0);
    const t = this.trackH, px = this.cssPx;
    Object.assign(this.trackEl.style, {left: px(pl), width: px(w), top: px(Math.round(cy - t / 2))});
    Object.assign(this.progEl.style, {left: px(pl), width: px(Math.round(x - pl)), top: px(Math.round(cy - t / 2))});
    const d = this.state.pressed ? Math.round(this.thumbD * 1.5) : this.thumbD;
    Object.assign(this.thumbEl.style, {left: px(Math.round(x - d / 2)), top: px(Math.round(cy - d / 2)), width: px(d), height: px(d), borderRadius: px(d / 2)});
  }

  onPointerDown(e) {
    this.setPressed(true);
    this.onPointerMove(e);
    return true;
  }

  onPointerMove(e) {
    const w = this.width - this.paddingLeft - this.paddingRight;
    if (w > 0) this.setProgress((e.x - this.paddingLeft) / w * this.max, true);
  }

  onPointerUp() {
    this.setPressed(false);
    this.onStopTrackingTouch?.();
  }
}

register(['SeekBar'], PlatformSeekBar);
