// Dialogs: Poweramp shows each dialog as its own themed activity over the
// player (dialog_<Activity> theme overlay on BottomsheetDialog /
// CenteredDialog). Here a private-scene host over the main layout inflates
// the shared `dialog` layout in that theme: shim, frame with title (and the
// theme's dialogTitleExtraLayout), dialogContentLayout and the button bar.
// The frame enters with scene_dialog_in over animTime (350 ms bottom sheets,
// 450 ms centered), leaves to the default scene (or scene_dialog_out_alt
// with dialogAltOutScene); scene_dialog_in_toast shows a message in the
// frame before closing (DialogBehavior). Tapping the shim or Escape cancels.
import {SceneFastLayout, DEFAULT_SCENE} from '../view/scene.js';
import {GONE, VISIBLE} from '../res/values.js';

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
  const shim = find('dialog_shim');
  if (shim) shim.onClick = () => cancel();

  function cancel() {
    if (onCancel?.(dialog) === false) return;
    close();
  }

  function close(result) {
    if (dialog.closed) return;
    dialog.closed = true;
    clearTimeout(dialog.toastTimer);
    ctx.dialogs = ctx.dialogs.filter(d => d !== dialog);
    if (shim) ctx.tween(shim, {alpha: 0}, animMs / 1000);
    host.scenes.go(altOut ? 'scene_dialog_out_alt' : DEFAULT_SCENE, {duration: animMs / 1000, onEnd: () => {
      decor.removeView(host);
      ctx.scheduleLayout();
      onClosed?.(result, dialog);
    }});
  }
  dialog.cancel = cancel;

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
