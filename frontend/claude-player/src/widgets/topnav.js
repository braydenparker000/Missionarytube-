// Top-level navigation: the main container's scenes (paused/playing player,
// library, search, equalizer, visualisation) and the durations between them.
import {SceneFastLayout, DEFAULT_SCENE} from '../view/scene.js';
import {register} from '../view/inflater.js';

const PLAYING_FAMILY = new Set(['scene_playing', 'scene_vis', 'scene_vis_temp_ui', 'scene_vis_w_ui']);
const VIS_FAMILY = new Set(['scene_vis', 'scene_vis_temp_ui', 'scene_vis_w_ui']);
const VIS_NONE = 0, VIS_W_UI = 1, VIS_FULL_SCREEN = 2;
const VIS_KEY = 'cp-vis-mode';
const NAV_SCENES = {nav_lib: 'scene_lib', nav_lyrics: 'scene_lyrics', nav_search: 'scene_search', nav_eq: 'scene_eq'};

/** Duration scaling from the Animations setting (normal, fast, disabled). */
export function animTime(ctx, seconds) {
  const mode = ctx.settings?.animations ?? 'normal';
  if (mode === 'disabled') return 0.001;
  if (mode === 'fast') return seconds * 0.6;
  return seconds;
}

export class TopNavSceneFastLayout extends SceneFastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const ms = (k, d) => a.int(k, d) * 0.001;
    this.times = {
      anim: ms('animTime', 250), mainEnter: ms('animMainEnterTime', 250), mainExit: ms('animMainExitTime', 250),
      playState: ms('playStateAnimTime', 250), state: ms('stateAnimTime', 250), vis: ms('visAnimTime', 250),
      tempUI: ms('tempUITime', 250), forced: ms('forcedAnimTime', 250),
    };
    this.nav = 'nav_main';
    this.firstAnimationDone = false;
    this.playing = false;
    let vis = VIS_NONE;
    try { vis = +(localStorage.getItem(VIS_KEY) ?? VIS_NONE) || VIS_NONE; } catch { /* storage unavailable */ }
    ctx.gui = Object.assign(ctx.gui ?? {}, {visMode: vis});
    ctx.topNav = this;
  }

  onFinishInflate() {
    const bus = this.ctx.bus;
    bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'cmd_nav_to_lib') this.navigate('nav_lib');
      else if (msg === 'cmd_nav_to_search') this.navigate('nav_search');
      else if (msg === 'cmd_nav_to_eq') this.navigate('nav_eq');
      else if (msg === 'cmd_nav_to_lyrics') this.navigate('nav_lyrics');
      else if (msg === 'cmd_nav_to_main' || msg === 'cmd_gui_back') this.navigate('nav_main');
      else if (msg === 'cmd_gui_set_vis_mode') this.setVisMode(d?.arg1 ?? 0);
      else if (msg === 'msg_gui_layout_loaded' && d?.parent === this) this.applyFadedAlphas();
      else if (msg === 'cmd_gui_set_modal') this.setModal(d?.arg1, true);
      else if (msg === 'cmd_gui_unset_modal') this.setModal(d?.arg1, false);
    });
    // Visualisation (i22.y): a touch shows the UI for tempUITime, from full
    // screen or from faded controls; with vis_ignore_touch_faded the first
    // touch on faded controls only shows them.
    this.el.addEventListener('pointerdown', e => {
      const s = this.scenes.scene;
      // A modal (the navbar sheet) keeps the UI: no temporary UI (i22.m2030).
      if (!this.playing || this.modals?.length || (s !== 'scene_vis' && s !== 'scene_vis_temp_ui' && s !== 'scene_vis_w_ui')) return;
      if (s === 'scene_vis_w_ui' && this.ctx.pref('vis_ignore_touch_faded')) { e.stopPropagation(); e.preventDefault(); }
      this.showTempUI();
    }, true);
    bus.subscribe('bus_player', (msg, src, data) => {
      if (msg === 'msg_player_status_changed') this.setPlaying(!!data?.playing, true);
    });
    bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && /^vis_(panel|controls|list)_faded_alpha$/.test(d?.key)) this.applyFadedAlphas();
    });
    queueMicrotask(() => this.applyFadedAlphas());
  }

  /**
   * Faded controls (i22.m): in scene_vis_w_ui the vis panel takes
   * vis_panel_faded_alpha, the list vis_list_faded_alpha and every other
   * child with a record for the scene vis_controls_faded_alpha (percent).
   */
  applyFadedAlphas() {
    const pct = k => (+this.ctx.pref(k) || 0) / 100;
    const panel = pct('vis_panel_faded_alpha'), controls = pct('vis_controls_faded_alpha');
    // vis_list_faded_alpha is a float seek bar (floatScale 100): stored as 0..1.
    // (Values above 1 were stored as percent by earlier builds.)
    let list = +this.ctx.pref('vis_list_faded_alpha') || 0;
    if (list > 1) list /= 100;
    list = Math.max(0, Math.min(1, list));
    const now = this.scenes?.scene === 'scene_vis_w_ui';
    for (const c of this.children) {
      if (c.isBehavior) continue;
      const rec = c.sceneParams?.get('scene_vis_w_ui');
      if (!rec) continue;
      rec.alpha = c.id === 'vis_panel_container' ? panel : c.id === 'list' ? list : controls;
      if (now) { c.alpha = rec.alpha; c.invalidate(); }
    }
  }

  /**
   * Scene for the main (player) screen: while playing, the visualisation mode
   * picks scene_vis_w_ui (with UI) or scene_vis (full screen), else
   * scene_playing; paused is the default scene.
   */
  mainScene() {
    if (!this.playing) return DEFAULT_SCENE;
    // While a modal is up the player shows its full UI (i22.m2030 with state_gui_is_modal_now).
    if (this.modals?.length) return 'scene_playing';
    const vis = this.ctx.gui.visMode;
    return vis === VIS_FULL_SCREEN ? 'scene_vis' : vis === VIS_W_UI ? 'scene_vis_w_ui' : 'scene_playing';
  }

  setVisMode(mode) {
    this.ctx.gui.visMode = mode;
    try { localStorage.setItem(VIS_KEY, String(mode)); } catch { /* storage unavailable */ }
    this.ctx.bus.post('bus_gui', 'msg_gui_vis_mode_changed', this, {arg1: mode});
    if (this.nav === 'nav_main') this.go(this.mainScene(), 'nav_main', true);
  }

  /** Temporary UI over the full-screen visualisation: tempUITime + vis_temp_ui_ms (1500). */
  /**
   * cmd_gui_set_modal / cmd_gui_unset_modal (i22): modals stack by id. With
   * the last one gone the player screen takes its scene again, or the
   * temporary UI restarts its timer.
   */
  setModal(id, on) {
    this.modals ??= [];
    if (on) { this.modals.push(id ?? 0); return; }
    const at = id ? this.modals.lastIndexOf(id) : this.modals.length - 1;
    if (at < 0) return;
    this.modals.splice(at, 1);
    if (this.modals.length || this.nav !== 'nav_main') return;
    const s = this.scenes.scene;
    if (s === 'scene_vis_temp_ui') this.showTempUI();
    else if (s === DEFAULT_SCENE || s === 'scene_playing') this.go(this.mainScene(), 'nav_main', true);
  }

  showTempUI() {
    clearTimeout(this.tempTimer);
    if (this.scenes.scene !== 'scene_vis_temp_ui') this.go('scene_vis_temp_ui', 'nav_main', true);
    this.tempTimer = setTimeout(() => {
      if (this.scenes.scene === 'scene_vis_temp_ui' && this.nav === 'nav_main') this.go(this.mainScene(), 'nav_main', true);
    }, this.times.tempUI * 1000 + (+this.ctx.pref('vis_temp_ui_ms') || 0));
  }

  setPlaying(playing, animate) {
    if (this.playing === playing) return;
    this.playing = playing;
    if (this.nav === 'nav_main') this.go(this.mainScene(), 'nav_main', animate);
  }

  navigate(nav, animate = true) {
    // i22: going to the equalizer shows the list's moveable toolbar at once.
    if (nav === 'nav_eq' && this.nav !== 'nav_eq') this.ctx.bus.post('list', 'cmd_list_force_ab_on_screen', this, {arg1: 0});
    if (nav === 'nav_main') this.go(this.mainScene(), nav, animate);
    else this.go(NAV_SCENES[nav] ?? 'scene_lib', nav, animate);
  }

  /**
   * A list transition dragged the scene to the target (state_list_transition
   * with its ratio): adopt the navigation it reached without animating again.
   */
  adoptNav(nav) {
    this.nav = nav;
    this.firstAnimationDone = true;
    this.ctx.bus.post('bus_gui', 'msg_nav_changed', this, {nav, scene: this.scenes.scene});
  }

  /** Scene the navigation shows (the player screen's scene for nav_main). */
  sceneFor(nav) {
    return nav === 'nav_main' ? this.mainScene() : NAV_SCENES[nav] ?? 'scene_lib';
  }

  /** Scene change with the reference's duration selection. */
  go(scene, nav, animate = true) {
    // Views loaded since (the vis panel) take the faded alphas too.
    if (scene === 'scene_vis_w_ui') this.applyFadedAlphas();
    const cur = this.scenes.scene;
    const prevNav = this.nav;
    this.nav = nav;
    if (scene === cur) return;
    const t = this.times;
    let seconds = 0;
    if (animate) {
      const isMain = s => s === DEFAULT_SCENE;
      if ((isMain(cur) && PLAYING_FAMILY.has(scene)) || (isMain(scene) && PLAYING_FAMILY.has(cur))) seconds = t.playState;
      else if (((isMain(cur) || PLAYING_FAMILY.has(cur)) && VIS_FAMILY.has(scene)) || ((isMain(scene) || PLAYING_FAMILY.has(scene)) && VIS_FAMILY.has(cur))) seconds = t.vis;
      else if (nav === 'nav_main') seconds = animTime(this.ctx, t.mainEnter);
      else if (prevNav !== 'nav_main' || scene === 'scene_eq') seconds = animTime(this.ctx, t.anim);
      else seconds = animTime(this.ctx, t.mainExit);
      if (!this.firstAnimationDone) {
        this.firstAnimationDone = true;
        seconds += 0.35;
      }
    }
    this.scenes.go(scene, {duration: seconds});
    this.ctx.bus.post('bus_gui', 'msg_nav_changed', this, {nav, scene});
  }
}

register(['TopNavSceneFastLayout'], TopNavSceneFastLayout);
