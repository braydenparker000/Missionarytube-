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
import {Library} from './library/library.js';
import {Settings, loadStoredSettings, runtimeSettings, prefDefaults} from './settings/settings.js';
import {DSP} from './dsp/dsp.js';
import {PlaybackLog} from './player/playback-log.js';
import {AudioCache, retireDefaultCopies} from './library/audio-cache.js';
import {AudioHeads} from './library/heads.js';
import {installEqPresets} from './widgets/eq-preset-ui.js';
import './widgets/basic.js';
import './view/seekbar.js';
import './view/html-text.js';
import './widgets/topnav.js';
import './widgets/time.js';
import './widgets/waveseek.js';
import './widgets/subaa.js';
import './widgets/milk.js';
import './widgets/navbar.js';
import './widgets/eq.js';
import './widgets/eq-param.js';
import './widgets/popup.js';
import './widgets/search.js';
import './widgets/toast.js';
import './widgets/sleeptimer.js';
import './widgets/vispanel.js';
import './widgets/rating.js';
import './widgets/cast.js';
import {installHelp} from './widgets/help.js';
import {installMetaInfo} from './widgets/meta-info.js';
import {openLyricsDialog} from './widgets/lyrics-dialog.js';
import {installSubAAEditor} from './widgets/subaa-edit.js';
import {installScreenPrefs} from './widgets/screen.js';
import './list/list-widget.js';
import './list/selection.js';

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
  // Resolved once per attribute: lists read these on every scroll step.
  const known = new Map();
  const off = a => known.get(a) ?? known.set(a, res.dimensionPixelOffset('?' + a, theme) ?? 0).get(a);
  const two = () => off('navbar_marginB') + off('navbar_marginT') + off('Navbar_height') * 2 + off('NavbarList_marginBottom');
  const three = () => two() + off('NavbarSeekbar_marginTop') + off('NavbarSeekbar_marginBottom') + off('NavbarSeekbar_height');
  Object.assign(ctx.dynamicDimensions, {
    navbar_bounds_size: () => off('navbar_marginB') + off('Navbar_height'),
    navbar_bounds_2lines_size: () => (ctx.settings.navbar_seekbar ? three() : two()),
    navbar_bounds_3lines_size: three,
    Alt_TopAABounds_marginBottom_plus_8dp: () => (res.dimensionPixelOffset('@dimen/Alt_TopAABounds_marginBottom', theme) ?? 0) + Math.round(8 * ctx.dpr),
  });
}

/**
 * Follow Day/Night (follow_night_mode, SkinnableThemeManager): at night a
 * light skin (one with a darkMode pair) loads as its pair, by day a dark skin
 * (lightMode pair) as its pair. The stored skin stays the user's choice; the
 * pair only applies to this theme load. Returns the skin index to use.
 */
function followNightMode(stored, skins, night) {
  let index = +(stored.skin ?? 1);
  const skin = skins[index];
  if (stored.follow_night_mode === true || stored.follow_night_mode === 'true') {
    const pair = night ? skin?.darkMode : skin?.lightMode;
    const to = pair ? skins.findIndex(x => x.style === pair) : -1;
    if (to >= 0) index = to;
  }
  // A system day/night change re-applies the rule (the reference recreates the activity).
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    const now = loadStoredSettings();
    if (now.follow_night_mode === true || now.follow_night_mode === 'true') location.reload();
  });
  return index;
}

export async function boot() {
  const stored = loadStoredSettings();
  const settings = runtimeSettings(stored);
  const [model] = await Promise.all([loadModel(new URL('../model/reference.json.gz', import.meta.url)), loadFonts()]);
  const {dpr, config} = deviceConfig();
  const res = new Resources(model, config, {density: dpr, scaledDensity: dpr, xdpi: 160 * dpr});
  const skins = parseSkins(res);
  const skinIndex = followNightMode(stored, skins, config.night);
  const prefs = stored['skin_prefs_' + skinIndex] ?? {};
  const skin = skins[skinIndex] ?? skins[0];
  const {theme, applied} = composeTheme(res, skin, prefs, {settings});
  const ctx = new Context({res, theme, dpr});
  Object.assign(ctx.settings, settings);
  ctx.prefDefaults = prefDefaults(res);
  // The first run's time (b40.G1, set once at the first launch).
  try {
    ctx.firstRunAt = +localStorage.getItem('cp-first-run') || 0;
    if (!ctx.firstRunAt) localStorage.setItem('cp-first-run', String(ctx.firstRunAt = Date.now()));
  } catch { ctx.firstRunAt = Date.now(); }
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
  // Offline copies of the queue's next tracks (Cache Storage; none on an insecure origin).
  ctx.audioCache = new AudioCache();
  ctx.audioHeads = new AudioHeads();
  retireDefaultCopies(ctx.audioCache);
  const player = new Player(ctx);
  new DSP(ctx);
  new PlaybackLog(ctx);
  installEqPresets(ctx);
  new Settings(ctx);
  // Window decor: a plain FastLayout filling the viewport hosts the main layout.
  const decor = new FastLayout(ctx, null);
  decor.id = 'decor';
  decor.insets = ctx.windowInsets;
  const container = document.getElementById('cp-root');
  ctx.setRoot(decor, container);
  inflater.inflate('activity_main', decor);
  installInput(ctx, container);
  player.installMediaSession();
  const library = await new Library(ctx).open();
  installHelp(ctx);
  installMetaInfo(ctx);
  installSubAAEditor(ctx);
  ctx.screenPrefs = installScreenPrefs(ctx);
  ctx.bus.subscribe('bus_data_cmd', (msg, src, d) => { if (msg === 'cmd_data_lyrics') openLyricsDialog(ctx, d?.track, {pluginFirst: d?.arg1 === 1}); });
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    const {demoTracks} = await import('./dev/demo.js');
    player.setQueue(await demoTracks(), +(params.get('demo') || 0));
    if (params.has('playing')) player.play();
  } else {
    // First start without a snapshot: wait for the R2 index before choosing.
    if (!library.tracks.length) await library.r2Ready;
  }
  if (params.has('demo')) { /* demo queue set above */ } else if (library.tracks.length) {
    const saved = await library.db?.getState('queue').catch(() => null);
    const index = Math.max(0, library.tracks.findIndex(t => t.id === saved?.trackId));
    if (saved?.shuffle !== undefined) player.shuffle = saved.shuffle;
    if (saved?.repeat !== undefined) player.repeat = saved.repeat;
    player.restoreQueue(saved?.entries ?? saved?.userQueue, library.byId);
    // In queue mode the list to return to is saved by its track.
    const npIndex = saved?.queueMode ? Math.max(0, library.tracks.findIndex(t => t.id === saved.npTrackId)) : index;
    player.setQueue(library.tracks, npIndex);
    if (saved?.queueMode) player.resumeQueueMode(saved.trackId);
    if (saved?.positionMs) player.seek(saved.positionMs);
    // The song left off: its start on the phone, so the first play starts at once.
    player.wantStartHead();
  }
  // A library that arrives later (R2 index refresh) fills an empty player.
  // A refreshed index replaces the records: the player takes the new ones.
  ctx.bus.subscribe('bus_library', () => {
    if (!player.queue.length && library.tracks.length) player.setQueue(library.tracks, 0);
    else player.adoptRecords(library.byId);
  });
  // Remember the current track and position (reference: resume where left off).
  const saveState = () => {
    const t = player.track;
    if (!t || !library.byId.has(t.id)) return;
    const np = player.savedNP;
    library.db?.setState('queue', {
      trackId: t.id, positionMs: player.positionMs(), shuffle: player.shuffle, repeat: player.repeat,
      entries: player.entries.map(e => ({id: e.track.id, created: e.created, played: e.played})),
      queueMode: player.queueMode, npTrackId: np?.queue?.[np.index]?.id ?? null,
    }).catch(() => {});
  };
  ctx.bus.subscribe('bus_player', m => { if (m === 'msg_player_track_changed' || m === 'msg_player_playing_state_changed' || m === 'msg_player_shuffle_mode_changed' || m === 'msg_player_repeat_mode_changed' || m === 'msg_player_queue_changed') saveState(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
  // The home screen: the player, or the library with start_at_lib (the
  // app starts there and Back from the player or the EQ returns to it).
  const home = () => (ctx.pref('start_at_lib') ? 'nav_lib' : 'nav_main');
  if (home() === 'nav_lib') ctx.topNav?.navigate('nav_lib', false);
  // System back (browser history): library levels first, then back home.
  ctx.bus.subscribe('bus_gui', (m, src, d) => {
    if (m === 'msg_nav_changed' && d.nav !== home() && !history.state?.cpNav) history.pushState({cpNav: d.nav}, '');
  });
  window.addEventListener('popstate', () => {
    if (ctx.subAAEditor?.onPopState()) return;
    if (ctx.settingsUi?.isOpen || ctx.settingsUi?.consumeClose()) return;
    const tn = ctx.topNav, h = home();
    if (h === 'nav_lib' && tn && tn.nav !== 'nav_lib') { tn.navigate('nav_lib'); return; }
    if (ctx.listWidget?.back()) return;
    if (tn && tn.nav !== h) tn.navigate(h);
  });
  ctx.scheduleLayout();
  // Installable app: the service worker keeps the app's files offline.
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // The service worker stays awake while the app is in use: Chrome stops an idle one after about 30 s,
  // and waking it delays the next play or skip by up to a second. A message every 20 s keeps it, while
  // the page shows or plays (none otherwise).
  setInterval(() => {
    if (!document.hidden || player.state === 1) navigator.serviceWorker?.controller?.postMessage({type: 'ping'});
  }, 20000);
  window.addEventListener('resize', () => {
    applyViewport();
    decor.insets = ctx.windowInsets;
    decor.forceLayoutTree();
    ctx.scheduleLayout();
  });
  document.getElementById('cp-boot')?.remove();
  // ?diag opens the playback diagnostics (Settings › Audio Outputs Detection Log).
  if (params.has('diag')) ctx.settingsUi?.open('audio_platform_log');
  const diag = {skin: skin.name, applied, unknown: [...unknownClasses], missingIcons: [...ctx.drawables.missingIcons], config};
  window.__cp = {ctx, res, theme, decor, skins, diag, player, library, dsp: ctx.dsp};
  return window.__cp;
}

boot().catch(e => {
  const b = document.getElementById('cp-boot');
  if (b) b.textContent = 'Failed to start: ' + e.message;
  console.error(e);
});
