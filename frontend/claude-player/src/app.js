// Boot: load the reference model, resolve the device configuration, compose
// the skin theme, inflate the main scene layout and start the frame loop.
import {Resources} from './res/resources.js';
import {makeConfig} from './res/qualifiers.js';
import {Context} from './context.js';
import {Inflater, unknownClasses} from './view/inflater.js';
import {FastLayout} from './view/fast-layout.js';
import {parseSkins, composeTheme} from './skin.js';
import {loadFonts} from './fonts.js';

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

export async function boot({skinIndex = 1, prefs = {}} = {}) {
  const [model] = await Promise.all([loadModel(new URL('../model/reference.json.gz', import.meta.url)), loadFonts()]);
  const {dpr, config} = deviceConfig();
  const res = new Resources(model, config, {density: dpr, scaledDensity: dpr, xdpi: 160 * dpr});
  const skins = parseSkins(res);
  const skin = skins[skinIndex] ?? skins[0];
  const {theme, applied} = composeTheme(res, skin, prefs);
  const ctx = new Context({res, theme, dpr});
  ctx.viewportWidth = window.innerWidth;
  ctx.viewportHeight = window.innerHeight;
  const inflater = new Inflater(ctx);
  ctx.inflater = inflater;
  // Window decor: a plain FastLayout filling the viewport hosts the main layout.
  const decor = new FastLayout(ctx, null);
  decor.id = 'decor';
  decor.insets = {left: 0, top: 0, right: 0, bottom: 0};
  const container = document.getElementById('cp-root');
  ctx.setRoot(decor, container);
  inflater.inflate('activity_main', decor);
  ctx.scheduleLayout();
  document.getElementById('cp-boot')?.remove();
  const diag = {skin: skin.name, applied, unknown: [...unknownClasses], missingIcons: [...ctx.drawables.missingIcons], config};
  window.__cp = {ctx, res, theme, decor, skins, diag};
  return window.__cp;
}

boot().catch(e => {
  const b = document.getElementById('cp-boot');
  if (b) b.textContent = 'Failed to start: ' + e.message;
  console.error(e);
});
