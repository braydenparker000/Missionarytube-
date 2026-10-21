// MilkWidget: the player background. The reference renders it natively (GL):
// the visualisation and the blurred album-art backdrop (aa_blur: level 5,
// downscale 2^5, saturation 150%, intensity 100%, bottom gradient level 4 to
// #FF000000). Here the backdrop is the art behind CSS blur/saturate filters
// with a gradient overlay; the exact native blur kernel is not reproducible,
// so radius and gradient curve are approximations to be tuned against
// reference screenshots.
import {View} from '../view/view.js';
import {register} from '../view/inflater.js';
import {colorToCss, parseColor} from '../res/values.js';

export class MilkWidget extends View {
  constructor(ctx, a) {
    super(ctx, a);
    const bg = a.color('bgColor');
    this.bgColor = bg?.color ?? 0xff000000;
    this.blurSaturationMul = a.float('aaBlurSaturation', 1);
    this.blurIntensityMul = a.float('aaBlurIntensity', 1);
    this.layer = document.createElement('div');
    this.layer.className = 'milk-art';
    this.shade = document.createElement('div');
    this.shade.className = 'milk-shade';
    this.el.append(this.layer, this.shade);
    this.el.style.background = colorToCss(this.bgColor);
    this.art = null;
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_track_changed') this.setArt(ctx.player?.track?.art ?? null);
    });
  }

  settings() {
    const s = this.ctx.settings;
    return {
      enabled: s.aa_blur_enabled ?? true,
      level: s.aa_blur ?? 5,
      scale: s.aa_blur_scale ?? 5,
      saturation: ((s.aa_blur_saturation ?? 150) / 100) * this.blurSaturationMul,
      intensity: ((s.aa_blur_intensity ?? 100) / 100) * this.blurIntensityMul,
      gradient: Math.max(0, Math.min(10, s.aa_bg_gradient ?? 4)),
      gradientColor: parseColor(s.aa_bg_gradient_color ?? '#FF000000') ?? 0xff000000,
    };
  }

  setArt(art) {
    this.art = art;
    this.invalidate();
  }

  draw() {
    const st = this.settings();
    const url = st.enabled ? this.art?.url ?? null : null;
    const ls = this.layer.style;
    if (this._url !== url) {
      this._url = url;
      ls.backgroundImage = url ? `url("${url}")` : '';
    }
    // Downscale factor 2^scale approximated as a blur radius of a fraction of it.
    const radius = (1 << Math.min(st.scale, 9)) * 0.5 * (st.level / 5);
    ls.filter = url ? `blur(${radius.toFixed(1)}px) saturate(${st.saturation})` : '';
    ls.opacity = url ? String(Math.min(1, st.intensity)) : '0';
    const g = st.gradient / 10;
    const c = st.gradientColor;
    const rgba = a => `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${a.toFixed(3)})`;
    this.shade.style.background = url && g > 0 ? `linear-gradient(to bottom, ${rgba(g * 0.35)} 0%, ${rgba(g * 1.6 > 1 ? 1 : g * 1.6)} 100%)` : '';
  }
}

register(['MilkWidget'], MilkWidget);
