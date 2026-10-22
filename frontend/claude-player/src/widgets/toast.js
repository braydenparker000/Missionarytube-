// Toasts (ToastFrameLayout / UpperToastFrameLayout): the frame sits in a
// private-scene container whose scenes expand it (scene_expanded with an
// icon, scene_expanded_no_icon without) and collapse it again after
// toastDuration (2000 ms). cmd_gui_show_toast carries {title, line2, icon,
// ms (a shorter stay, u12.A's duration)};
// the lower toast also announces shuffle and repeat mode changes with the
// mode's icon and long description. Expand/collapse times are inferred.
import {FastLayout} from '../view/fast-layout.js';
import {register} from '../view/inflater.js';
import {animTime} from './topnav.js';

const idOf = raw => (raw ? /^@\+?id\/(.+)$/.exec(raw)?.[1] ?? null : null);
const IN_S = 0.3, OUT_S = 0.25;

export class ToastLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.duration = a.int('toastDuration', 2000);
    this.cmdId = idOf(a.raw('cmdId')) ?? 'cmd_gui_show_toast';
    this.queueMinMs = a.int('queueMinMs', 0);
    this.shownAt = 0;
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === this.cmdId) this.show(d ?? {});
      else if (msg === 'cmd_gui_close_toast') this.hide();
    });
  }

  container() {
    return this.parent?.scenes ? this.parent : null;
  }

  show({title = '', line2 = '', icon = null, ms = null} = {}) {
    const c = this.container();
    if (!c) return;
    // While a dialog is open its own toast shows, else the main screen's.
    let host = null;
    for (let p = this.parent; p; p = p.parent) if (p.isDialogHost) { host = p; break; }
    if (host !== (this.ctx.dialogs?.at(-1)?.host ?? null)) return;
    this.findViewById('title')?.setText(title);
    const l2 = this.findViewById('line2');
    l2?.setText(line2);
    const iv = this.findViewById('icon');
    const d = icon ? this.ctx.drawables.fromValue(icon, this.ctx.theme) : null;
    iv?.setDrawable?.(d);
    clearTimeout(this.timer);
    c.scenes.go(d ? 'scene_expanded' : 'scene_expanded_no_icon', {duration: animTime(this.ctx, IN_S)});
    this.shownAt = performance.now();
    this.timer = setTimeout(() => this.hide(), ms ?? this.duration);
  }

  hide() {
    clearTimeout(this.timer);
    this.container()?.scenes.go('defaultScene', {duration: animTime(this.ctx, OUT_S)});
  }

  onClick() {
    this.hide();
  }
}

/** The lower toast: also shows shuffle / repeat mode changes. */
export class ToastFrameLayout extends ToastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_shuffle_mode_changed') this.modeToast('shuffle', d.arg1);
      else if (msg === 'msg_player_repeat_mode_changed') this.modeToast('repeat', d.arg1);
    });
  }

  modeToast(kind, mode) {
    const res = this.ctx.res, th = this.ctx.theme;
    const arr = n => res.entry('array', n) ?? [];
    const repeat = kind === 'repeat';
    const values = arr(repeat ? 'repeat_modes_enum' : 'shuffle_modes_enum').map(v => res.integer(v, th));
    const i = values.indexOf(mode);
    if (i < 0) return;
    const title = res.string(arr(repeat ? 'repeat_modes' : 'shuffle_modes')[i], th) ?? '';
    const line2 = res.string(arr(repeat ? 'repeat_modes_line2' : 'shuffle_modes_line2')[i], th) ?? '';
    const iconsName = repeat ? 'repeat_icons_reordered_32dp' : 'shuffle_icons_32dp';
    this.show({title, line2, icon: arr(iconsName)[i] ?? null});
  }
}

register(['ToastFrameLayout'], ToastFrameLayout);
register(['UpperToastFrameLayout'], ToastLayout);
