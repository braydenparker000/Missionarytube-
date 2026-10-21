// Boot: load the reference model, resolve the device configuration, compose
// the skin theme, inflate the main scene layout and start the frame loop.
import {Resources} from './res/resources.js';
import {makeConfig} from './res/qualifiers.js';
import {Context} from './context.js';
import {Inflater, unknownClasses} from './view/inflater.js';
import {FastLayout} from './view/fast-layout.js';
import {parseSkins, composeTheme} from './skin.js';
import {loadFonts} from './fonts.js';
import {Player} from './player/player.js';
import {installInput} from './input.js';
import './widgets/basic.js';
import './widgets/topnav.js';
import './widgets/time.js';
import './widgets/waveseek.js';
import './widgets/subaa.js';
import './list/list-widget.js';

export async function loadModel(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('model ' + resp.status);
  const stream = resp.body.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/** Window basis: screen size in dp drives resource buckets (the app window on Android). */
export function deviceConfig() {
  const dpr = window.devicePixelRatio || 1;
  const sw = window.screen?.width || window.innerWidth;
  const sh = window.screen?.height || window.innerHeight;
  const portrait = window.innerHeight >= window.innerWidth;
  const widthDp = portrait ? Math.min(sw, sh) : Math.max(sw, sh);
  const heightDp = portrait ? Math.max(sw, sh) : Math.min(sw, sh);
  const night = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const widecg = window.matchMedia?.('(color-gamut: p3)').matches ?? false;
  const hdr = window.matchMedia?.('(dynamic-range: high)').matches ?? false;
  return {dpr, config: makeConfig({widthDp, heightDp, density: dpr, night, widecg, hdr})};
}

/** Safe-area insets and the large-viewport height, via a CSS probe element. */
function measureViewport() {
  let probe = document.getElementById('cp-probe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'cp-probe';
    probe.className = 'cp-probe';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  const n = v => parseFloat(v) || 0;
  return {
    insets: {left: n(cs.paddingLeft), top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom)},
    largeHeight: n(cs.height) || window.innerHeight,
  };
}

/** Runtime-computed sizes the layouts refer to by id (navbar bounds). */
function installDynamicDimensions(ctx) {
  const {res, theme} = ctx;
  const off = a => res.dimensionPixelOffset('?' + a, theme) ?? 0;
  const two = () => off('navbar_marginB') + off('navbar_marginT') + off('Navbar_height') * 2 + off('NavbarList_marginBottom');
  const three = () => two() + off('NavbarSeekbar_marginTop') + off('NavbarSeekbar_marginBottom') + off('NavbarSeekbar_height');
  Object.assign(ctx.dynamicDimensions, {
    navbar_bounds_size: () => off('navbar_marginB') + off('Navbar_height'),
    navbar_bounds_2lines_size: () => (ctx.settings.navbar_seekbar ? three() : two()),
    navbar_bounds_3lines_size: three,
    Alt_TopAABounds_marginBottom_plus_8dp: () => (res.dimensionPixelOffset('@dimen/Alt_TopAABounds_marginBottom', theme) ?? 0) + Math.round(8 * ctx.dpr),
  });
}

export async function boot({skinIndex = 1, prefs = {}} = {}) {
  const [model] = await Promise.all([loadModel(new URL('../model/reference.json.gz', import.meta.url)), loadFonts()]);
  const {dpr, config} = deviceConfig();
  const res = new Resources(model, config, {density: dpr, scaledDensity: dpr, xdpi: 160 * dpr});
  const skins = parseSkins(res);
  const skin = skins[skinIndex] ?? skins[0];
  const {theme, applied} = composeTheme(res, skin, prefs);
  const ctx = new Context({res, theme, dpr});
  const applyViewport = () => {
    const vp = measureViewport();
    ctx.viewportWidth = window.innerWidth;
    ctx.viewportHeight = window.innerHeight;
    ctx.windowInsets = {left: Math.round(vp.insets.left * dpr), top: Math.round(vp.insets.top * dpr), right: Math.round(vp.insets.right * dpr), bottom: Math.round(vp.insets.bottom * dpr)};
    ctx.transientBarHeight = Math.max(0, Math.round((vp.largeHeight - window.innerHeight) * dpr));
  };
  applyViewport();
  installDynamicDimensions(ctx);
  const inflater = new Inflater(ctx);
  ctx.inflater = inflater;
  const player = new Player(ctx);
  // Window decor: a plain FastLayout filling the viewport hosts the main layout.
  const decor = new FastLayout(ctx, null);
  decor.id = 'decor';
  decor.insets = ctx.windowInsets;
  const container = document.getElementById('cp-root');
  ctx.setRoot(decor, container);
  inflater.inflate('activity_main', decor);
  installInput(ctx, container);
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    const {demoTracks} = await import('./dev/demo.js');
    player.setQueue(await demoTracks(), +(params.get('demo') || 0));
    if (params.has('playing')) player.play();
  }
  ctx.scheduleLayout();
  window.addEventListener('resize', () => {
    applyViewport();
    decor.insets = ctx.windowInsets;
    decor.forceLayoutTree();
    ctx.scheduleLayout();
  });
  document.getElementById('cp-boot')?.remove();
  const diag = {skin: skin.name, applied, unknown: [...unknownClasses], missingIcons: [...ctx.drawables.missingIcons], config};
  window.__cp = {ctx, res, theme, decor, skins, diag, player};
  return window.__cp;
}

boot().catch(e => {
  const b = document.getElementById('cp-boot');
  if (b) b.textContent = 'Failed to start: ' + e.message;
  console.error(e);
});
