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
import {MilkRenderer} from './vis.js';
import {STATE_PLAYING} from '../player/player.js';

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
    // The visualization draws over the backdrop while a vis mode is on and music plays.
    this.visCanvas = document.createElement('canvas');
    this.visCanvas.className = 'milk-vis';
    this.el.append(this.layer, this.shade, this.visCanvas);
    this.renderer = new MilkRenderer(ctx, this.visCanvas);
    ctx.bus.subscribe('bus_gui', msg => { if (msg === 'msg_gui_vis_mode_changed') this.syncVis(); });
    this.el.style.background = colorToCss(this.bgColor);
    this.art = null;
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_track_changed') this.setArt(ctx.player?.track?.art ?? null);
      else if (msg === 'msg_player_playing_state_changed') this.syncVis();
    });
    // The backdrop behind the library lists and the lyrics (i22: list_aa_blur_enabled /
    // lyrics_aa_blur_enabled; MilkWidget: aa_bg_gradient_for_list).
    this.place = 'main';
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg !== 'msg_nav_changed') return;
      const place = d.nav === 'nav_lyrics' ? 'lyrics' : d.nav === 'nav_lib' || d.nav === 'nav_search' ? 'list' : d.nav === 'nav_eq' ? 'eq' : 'main';
      if (place !== this.place) { this.place = place; this.invalidate(); this.syncVis(); }
    });
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg !== 'msg_app_setting_changed') return;
      if (/^(aa_blur|aa_bg|list_aa|lyrics_aa)/.test(d?.key)) this.invalidate();
      if (d?.key === 'vis_in_lib') this.syncVis();
    });
  }

  settings() {
    const s = this.ctx.settings, pref = k => !!this.ctx.pref(k);
    const where = this.place === 'list' ? pref('list_aa_blur_enabled') : this.place === 'lyrics' ? pref('lyrics_aa_blur_enabled') : true;
    return {
      enabled: (s.aa_blur_enabled ?? true) && where,
      listGradient: this.place !== 'list' || pref('aa_bg_gradient_for_list'),
      level: s.aa_blur ?? 5,
      scale: s.aa_blur_scale ?? 5,
      saturation: ((s.aa_blur_saturation ?? 150) / 100) * this.blurSaturationMul,
      intensity: ((s.aa_blur_intensity ?? 100) / 100) * this.blurIntensityMul,
      gradient: Math.max(0, Math.min(10, s.aa_bg_gradient ?? 4)),
      gradientColor: parseColor(String(s.aa_bg_gradient_color ?? '#FF000000').split('|')[0]) ?? 0xff000000,
    };
  }

  syncVis() {
    const ctx = this.ctx;
    // vis_in_lib (i22): the visualization goes on behind the library, search and lyrics.
    const here = this.place === 'main' || ((this.place === 'list' || this.place === 'lyrics') && !!ctx.pref('vis_in_lib'));
    const on = ctx.settings?.enable_vis !== false && (ctx.gui?.visMode ?? 0) !== 0 && ctx.player?.state === STATE_PLAYING && !!ctx.dsp?.nodes && here;
    this.visCanvas.style.display = on ? '' : 'none';
    if (on) this.renderer.start(); else this.renderer.stop();
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
    this.shade.style.background = url && g > 0 && st.listGradient ? `linear-gradient(to bottom, ${rgba(g * 0.35)} 0%, ${rgba(g * 1.6 > 1 ? 1 : g * 1.6)} 100%)` : '';
  }
}

register(['MilkWidget'], MilkWidget);
