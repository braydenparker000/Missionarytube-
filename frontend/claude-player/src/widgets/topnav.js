// Top-level navigation: the main container's scenes (paused/playing player,
// library, search, equalizer, visualisation) and the durations between them.
import {SceneFastLayout, DEFAULT_SCENE} from '../view/scene.js';
import {register} from '../view/inflater.js';

const PLAYING_FAMILY = new Set(['scene_playing', 'scene_vis', 'scene_vis_temp_ui', 'scene_vis_w_ui']);
const VIS_FAMILY = new Set(['scene_vis', 'scene_vis_temp_ui', 'scene_vis_w_ui']);
const NAV_SCENES = {nav_lib: 'scene_lib', nav_lyrics: 'scene_lib', nav_search: 'scene_search', nav_eq: 'scene_eq'};

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
    ctx.topNav = this;
  }

  onFinishInflate() {
    const bus = this.ctx.bus;
    bus.subscribe('bus_gui', msg => {
      if (msg === 'cmd_nav_to_lib') this.navigate('nav_lib');
      else if (msg === 'cmd_nav_to_search') this.navigate('nav_search');
      else if (msg === 'cmd_nav_to_eq') this.navigate('nav_eq');
      else if (msg === 'cmd_nav_to_main' || msg === 'cmd_gui_back') this.navigate('nav_main');
    });
    bus.subscribe('bus_player', (msg, src, data) => {
      if (msg === 'msg_player_status_changed') this.setPlaying(!!data?.playing, true);
    });
  }

  /** Scene for the main (player) screen in the current play state. */
  mainScene() {
    return this.playing ? 'scene_playing' : DEFAULT_SCENE;
  }

  setPlaying(playing, animate) {
    if (this.playing === playing) return;
    this.playing = playing;
    if (this.nav === 'nav_main') this.go(this.mainScene(), 'nav_main', animate);
  }

  navigate(nav, animate = true) {
    if (nav === 'nav_main') this.go(this.mainScene(), nav, animate);
    else this.go(NAV_SCENES[nav] ?? 'scene_lib', nav, animate);
  }

  /** Scene change with the reference's duration selection. */
  go(scene, nav, animate = true) {
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
