// Dialogs: Poweramp shows each dialog as its own themed activity over the
// player (dialog_<Activity> theme overlay on BottomsheetDialog /
// CenteredDialog). Here a private-scene host over the main layout inflates
// the shared `dialog` layout in that theme: shim, frame with title (and the
// theme's dialogTitleExtraLayout), dialogContentLayout and the button bar.
// The frame enters with scene_dialog_in over animTime (350 ms bottom sheets,
// 450 ms centered), leaves to the default scene (or scene_dialog_out_alt
// with dialogAltOutScene); scene_dialog_in_toast shows a message in the
// frame before closing (DialogBehavior). Releasing a touch on the shim or
// Escape cancels; dragging the frame in its collapse direction dismisses it.
import {SceneFastLayout, DEFAULT_SCENE} from '../view/scene.js';
import {GONE, VISIBLE} from '../res/values.js';
import {TOUCH_SLOP_DP, MAX_FLING_DP, VelocityTracker} from '../gesture.js';

export class DialogHost extends SceneFastLayout {
  constructor(ctx) {
    super(ctx, null);
    this.privateScene = true;
    this.isDialogHost = true;
  }
}

let keysInstalled = false;

/**
 * Opens a dialog. style: the dialog theme (e.g. 'dialog_PlaylistSelectActivity');
 * buttons: {positive, negative, neutral} labels (absent ones hide);
 * onButton(which: 1 positive, 2 negative, 3 neutral) returns false to keep it open.
 */
export function openDialog(ctx, {style, title = '', buttons = {}, onButton = null, onCancel = null, onClosed = null, setup = null} = {}) {
  const decor = ctx.root;
  const theme = ctx.inflater.overlayTheme(ctx.theme, style);
  const host = new DialogHost(ctx);
  host.viewTheme = theme;
  host.lp = decor.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'fill_parent'}));
  decor.addView(host);
  const layout = /^@layout\/(.+)$/.exec(ctx.res.resolveRaw('?dialogLayout', theme).value ?? '')?.[1] ?? 'dialog';
  ctx.inflater.inflate(layout, host);
  const animMs = ctx.res.integer('?animTime', theme) ?? 350;
  const altOut = ctx.res.resolveRaw('?dialogAltOutScene', theme).value === 'true';
  const find = id => (id ? host.findViewById(id) : null);

  const dialog = {
    host, theme, find, closed: false,
    close(result) { close(result); },
    setTitle(t) { find('title')?.setText(t); },
    setButton(which, label, onClick) {
      const b = find('button' + which);
      if (!b) return;
      if (label == null) { b.setVisibility(GONE); return; }
      b.setVisibility(VISIBLE);
      b.setText(label);
      b.onClick = onClick ?? (() => press(which));
    },
    /** A message in the frame (scene_dialog_in_toast), then the dialog closes. */
    toast(text, ms = 2000, {button = null, onButton: onToastButton = null} = {}) {
      const line = find('dialog_toast_line_only_1');
      line?.setText(text);
      line?.setVisibility(VISIBLE);
      const tb = find('dialog_toast_button');
      if (tb) {
        if (button) { tb.setVisibility(VISIBLE); tb.setText(button); tb.onClick = () => { onToastButton?.(); close(); }; }
        else tb.setVisibility(GONE);
      }
      host.scenes.go('scene_dialog_in_toast', {duration: animMs / 1000});
      clearTimeout(dialog.toastTimer);
      dialog.toastTimer = setTimeout(() => close(), ms);
    },
  };

  const press = which => {
    if (onButton?.(which, dialog) === false) return;
    close();
  };
  const labels = {1: buttons.positive, 2: buttons.negative, 3: buttons.neutral};
  for (const which of [1, 2, 3]) dialog.setButton(which, labels[which] ?? null);
  dialog.setTitle(title);
  // The shim cancels on any release that did not drag the frame (wm.H): a
  // drag that starts on it still dismisses when lifted.
  const shim = find('dialog_shim');
  if (shim) {
    shim.onPointerDown = () => !dialog.closed;
    shim.onPointerUp = e => { if (!e.cancelled) cancel(); };
  }
  const outScene = altOut ? 'scene_dialog_out_alt' : DEFAULT_SCENE;

  function cancel() {
    if (onCancel?.(dialog) === false) return false;
    close();
    return true;
  }

  function close(result, {animate = true} = {}) {
    if (dialog.closed) return;
    dialog.closed = true;
    clearTimeout(dialog.toastTimer);
    ctx.dialogs = ctx.dialogs.filter(d => d !== dialog);
    const done = () => {
      decor.removeView(host);
      ctx.scheduleLayout();
      onClosed?.(result, dialog);
    };
    if (!animate) { done(); return; }
    if (shim) ctx.tween(shim, {alpha: 0}, animMs / 1000);
    host.scenes.go(outScene, {duration: animMs / 1000, onEnd: done});
  }
  dialog.cancel = cancel;
  installDrag(ctx, dialog, {outScene, animMs, cancelled: () => {
    // A committed drag collapses the dialog (m576), unless it refuses to
    // close, which brings the frame back in (F).
    if (onCancel?.(dialog) === false) { host.scenes.go('scene_dialog_in', {duration: animMs / 1000}); return; }
    close(undefined, {animate: false});
  }});

  (ctx.dialogs ??= []).push(dialog);
  if (!keysInstalled) {
    keysInstalled = true;
    window.addEventListener('keydown', e => {
      const top = ctx.dialogs?.at(-1);
      if (e.key === 'Escape' && top) { e.preventDefault(); top.cancel(); }
    });
  }
  // Content is filled in before the first layout so the enter scene sees it.
  setup?.(dialog);
  // Lay out in the out state, then enter.
  ctx.layoutRoot();
  if (shim) { shim.alpha = 0; ctx.tween(shim, {alpha: 1}, animMs / 1000); }
  host.scenes.go('scene_dialog_in', {duration: animMs / 1000});
  ctx.scheduleLayout();
  return dialog;
}

/**
 * Drag to dismiss (DialogBehavior's vm / wm over the shared touch handler j0,
 * F58). With collapseDragDirection down (bottom sheets) or up (centered and
 * top sheets), a drag that starts inside the frame, past touch slop on either
 * axis (the start point moves by the slop on each axis it crossed), drives the
 * frame towards the out scene: progress = dy / span, span = frame height
 * (down) or frame bottom (up), dy negated for up. Past either end the
 * progress follows ln(over / 0.05 + 1) * 0.05 and stops at -0.2 / 1. On
 * release a fling over dragThresholdVelocity in the collapse direction
 * commits and one against it cancels; otherwise progress > dragThreshold
 * commits. The settle runs over 1 / (1 / (dragAnimTime * max(0.25, rest)) + rate)
 * s, rate = |v| / span (0..10, commits only), decelerating (2.0). A drag that
 * starts on a list or another scrolling view belongs to that view (it starts
 * a nested scroll first); the list's overscroll handoff to the frame
 * (dragByNestedScroll) is not built.
 */
function installDrag(ctx, dialog, {outScene, cancelled}) {
  const {host, theme} = dialog, res = ctx.res;
  const dir = res.integer('?collapseDragDirection', theme, res.attrDef('collapseDragDirection')) ?? 1;
  const frame = dialog.find('dialog_frame'), outer = frame?.parent;
  if (!dir || !frame || !outer) return;
  const manualS = Math.max(0, res.integer('?dragAnimTime', theme) ?? 500) / 1000;
  const threshold = res.float('?dragThreshold', theme) ?? 0.8;
  const velocity = res.dimensionPixelSize('?dragThresholdVelocity', theme) ?? 1000;
  const slop = TOUCH_SLOP_DP * ctx.dpr;
  let g = null;
  outer.onInterceptStart = (start, now) => {
    if (dialog.closed || host.scenes.running) return false;
    // Lists and other scrolling views own their drags (nested scroll).
    for (let v = start.target; v && v !== frame; v = v.parent) if (v.interceptible) return false;
    const sx = start.x + (Math.abs(now.x - start.x) >= slop ? Math.sign(now.x - start.x) * slop : 0);
    const sy = start.y + (Math.abs(now.y - start.y) >= slop ? Math.sign(now.y - start.y) * slop : 0);
    const fx = sx - frame.left - frame.translationX, fy = sy - frame.top - frame.translationY;
    if (fx < 0 || fy < 0 || fx > frame.width || fy > frame.height) return false;
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    g = {y0: sy - start.y + start.rootY, span: dir === 2 ? frame.bottom : frame.height, vt};
    return true;
  };
  outer.onPointerMove = e => {
    if (!g) return;
    g.vt.add(e.time, e.rootX, e.rootY);
    let f = ((dir === 2 ? -1 : 1) * (e.rootY - g.y0)) / g.span;
    const over = f > 1 ? 1 - f : f < 0 ? -f : 0;
    if (over) {
      const log = Math.log(Math.abs(over) / 0.05 + 1) * 0.05;
      f = f > 1 ? 1 + log : -log;
    }
    host.scenes.drag(outScene, f, {min: -0.2, max: 1});
  };
  outer.onPointerUp = e => {
    if (!g) return;
    const span = g.span;
    let v = 0;
    if (!e.cancelled) {
      g.vt.up(e.time);
      v = g.vt.compute(MAX_FLING_DP * ctx.dpr).vy;
    }
    g = null;
    const sc = host.scenes;
    if (!sc.running?.manual) return;
    const p = sc.ratio;
    // Velocity in the collapse direction: positive commits.
    const vc = dir === 2 ? -v : v;
    const commit = vc > velocity ? true : vc < -velocity ? false : p > threshold;
    const rate = commit ? Math.min(10, Math.abs(v) / span) : 0;
    let rest = p < 0 ? (commit ? 1 - p : -p) : commit ? 1 - p : p;
    rest = Math.max(0.25, rest);
    const seconds = Math.abs(1 / (1 / (manualS * rest || 1) + rate));
    sc.settleTo(commit, manualS > 0 ? seconds : 0, done => { if (done) cancelled(); });
  };
}

const str = (ctx, name, fallback = name) => ctx.res.stringByName(name) ?? fallback;

/** Message dialog (BottomsheetAlertDialog): title, message, OK/Cancel style buttons. */
export function alertDialog(ctx, {title = '', message = '', positive = null, negative = null, onPositive = null} = {}) {
  const d = openDialog(ctx, {
    style: 'BottomsheetAlertDialog', title,
    buttons: {positive: positive ?? str(ctx, 'ok', 'OK'), negative: negative === false ? null : negative ?? str(ctx, 'cancel', 'Cancel')},
    onButton: which => { if (which === 1) onPositive?.(); },
    setup: dd => {
      const content = dd.find('content');
      if (!content) return;
      ctx.inflater.inflate('dialog_content_alert_dialog_msg', content);
      const msg = dd.find('message');
      msg?.setText(message);
      msg?.setVisibility(message ? VISIBLE : GONE); // layout_goneWhenEmpty
      dd.find('message_hint')?.setVisibility(GONE);
    },
  });
  return d;
}

/** Name input (dialog_EditNameActivity): returns the trimmed text through onDone. */
export function editNameDialog(ctx, {title = '', value = '', onDone} = {}) {
  let input = null;
  const d = openDialog(ctx, {
    style: 'dialog_EditNameActivity', title,
    setup: dd => dd.find('edit_text')?.setValue?.(value),
    buttons: {positive: str(ctx, 'ok', 'OK'), negative: str(ctx, 'cancel', 'Cancel')},
    onButton: which => {
      if (which !== 1) return true;
      const v = (input?.value ?? '').trim();
      if (!v) return false;
      onDone?.(v);
      return true;
    },
  });
  input = d.find('edit_text');
  if (input?.setValue) {
    input.input.addEventListener('keydown', e => { if (e.key === 'Enter') d.find('button1')?.onClick?.(); });
    // Focus once the frame has entered (a hidden input cannot take focus).
    const focus = () => { input.input.focus({preventScroll: true}); input.input.select(); };
    setTimeout(focus, (ctx.res.integer('?animTime', d.theme) ?? 350) + 30);
  }
  return d;
}
