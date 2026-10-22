// Moveable toolbar (yv0 / xv0; notebook F75): the library list moves its
// moveableToolbar (the navbar, TopListWidget) with the scroll.
// - Anchor (moveableToolbarAnchor): fixedTop 0, top 1, bottom 2, fixedBottom 3;
//   static_navbar turns bottom into fixedBottom (ListWidget).
// - Scrolling by f px (content movement, negative towards the list end) moves
//   the offset H (0 shown .. -height hidden). At the list top (or pulled past
//   it) and at its end the toolbar is shown; near the end it comes back as the
//   remaining scroll shrinks. Bottom: height = the reserved navbar space plus
//   the bottom toolbar (list_bottom_toolbar).
// - Fully moved away it turns invisible; a non-list layout (the art) shows it
//   at once with a 250 ms move back; a level change shows it over 100 ms.
// - Pins (cmd_list_force_ab_on_screen 1 / 2: the library and search help)
//   fix it while held; selection mode fades it out and back over 250 ms.
import {VISIBLE, INVISIBLE} from '../res/values.js';
import {setExtraState} from '../view/view.js';

export const ANCHOR_FIXED_TOP = 0, ANCHOR_TOP = 1, ANCHOR_BOTTOM = 2, ANCHOR_FIXED_BOTTOM = 3;
// List layout status (h0.H): at the top, pulled past the top, between, at the end, pushed past the end.
export const AT_TOP = 1, PAST_TOP = 2, BETWEEN = 4, AT_END = 16, PAST_END = 32;

const SHOW_MS = 250, LEVEL_SHOW_MS = 100, FADE_MS = 250;

export class MoveableToolbar {
  /**
   * reserved(): the list's reserved space under its rows (bottomReservedSpace
   * plus the bottom inset, om0.o0); bottomToolbar: the bottom toolbar size.
   */
  constructor(ctx, view, {anchor = ANCHOR_BOTTOM, extraStates = false, bottomToolbar = 0, reserved = () => 0} = {}) {
    this.ctx = ctx;
    this.view = view;
    this.baseAnchor = anchor;
    this.anchor = anchor;
    this.extraStates = extraStates;
    this.bottomToolbar = bottomToolbar;
    this.reserved = reserved;
    this.offset = 0;
    // 0 moved away (invisible), 1 following the list, 2 shown by showNow().
    this.state = view.visibility === VISIBLE ? 1 : 0;
    this.pins = 0;
    this.saved = null;
    this.moveAnim = null; // {cancel, kind: 1 to a position, 2 back in place, to}
    this.faded = false;
    this.fadeAnim = null;
    this.onMove = null;
  }

  get bottomAnchored() { return this.anchor === ANCHOR_BOTTOM || this.anchor === ANCHOR_FIXED_BOTTOM; }

  /** How far the toolbar is moved down now (zv0.H; the bottom toolbar follows it). */
  movedDown() {
    return Math.max(0, Math.round(this.view.translationY + (this.view.lp?.bottomMargin ?? 0)));
  }

  setTranslation(y) {
    const v = this.view;
    if (v.translationY === y) return;
    v.translationY = y;
    v.invalidate();
    this.onMove?.();
  }

  stopMove() {
    if (!this.moveAnim) return;
    this.moveAnim.cancel();
    this.moveAnim = null;
  }

  /** Linear move of the translation to `to` (m3713); kind 2 moves it back in place. */
  move(to, ms, kind) {
    const a = this.moveAnim;
    if (a && a.kind === kind && a.to === to) return;
    this.stopMove();
    const from = this.view.translationY;
    const dur = Math.max(1, ms * (this.ctx.animScale ?? 1));
    let t0 = null;
    const anim = {kind, to};
    const cancel = this.ctx.onFrame(now => {
      t0 ??= now;
      const k = Math.min(1, (now - t0) / dur);
      const y = from + (to - from) * k;
      this.setTranslation(y);
      // xv0.P: the offset takes the animated translation.
      this.offset = y;
      if (k < 1) return true;
      if (this.moveAnim === anim) this.moveAnim = null;
      return false;
    });
    anim.cancel = cancel;
    this.moveAnim = anim;
  }

  /** Shown in place at once (A): a move back over 250 ms when moved. */
  showNow() {
    if (this.state === 2) return;
    const v = this.view;
    if (this.state === 0) { v.visibility = VISIBLE; v.invalidate(); }
    if (this.faded) this.fade(false);
    if (v.background && v.background.level) { v.background.level = 0; v.invalidate(); }
    this.stopMove();
    if (v.translationY !== 0) this.move(0, SHOW_MS, 2);
    this.state = 2;
    this.offset = 0;
  }

  /** Pins (x): fixed at its edge while held; released, the configured anchor again. */
  pin(on) {
    if (!on) {
      if (--this.pins <= 0) { this.pins = 0; this.anchor = this.baseAnchor; }
      return;
    }
    this.pins++;
    const a = this.anchor;
    if (a === ANCHOR_FIXED_TOP || a === ANCHOR_TOP) this.anchor = ANCHOR_FIXED_TOP;
    else if (a === ANCHOR_BOTTOM || a === ANCHOR_FIXED_BOTTOM) this.anchor = ANCHOR_FIXED_BOTTOM;
  }

  /** Selection mode (m3712): alpha 1 → 0 when hidden, 0 → 1 back, linear over 250 ms. */
  fade(hidden) {
    if (this.faded === hidden) return;
    this.faded = hidden;
    this.fadeAnim?.();
    const from = hidden ? 1 : 0, to = hidden ? 0 : 1, v = this.view;
    const dur = Math.max(1, FADE_MS * (this.ctx.animScale ?? 1));
    let t0 = null;
    this.fadeAnim = this.ctx.onFrame(now => {
      t0 ??= now;
      const k = Math.min(1, (now - t0) / dur);
      v.alpha = from + (to - from) * k;
      v.invalidate();
      if (k < 1) return true;
      this.fadeAnim = null;
      return false;
    });
  }

  /** A new list layout (om0.i): the configured anchor again, then placed for it. */
  levelChanged(list, transitioning) {
    this.saved = {anchor: this.anchor, pins: this.pins};
    this.anchor = this.baseAnchor;
    this.pins = 0;
    if (list) this.scrolled(list, 0, false, transitioning);
    else if (this.state !== 2) this.showNow();
  }

  /** A cancelled level change (mo337) restores the pins. */
  levelChangeCancelled() {
    if (!this.saved) return;
    this.anchor = this.saved.anchor;
    this.pins = this.saved.pins;
    this.saved = null;
  }

  /**
   * The list scrolled by f (m3714). list: {flags, endGap, lastShown} or null
   * for a layout that is not a list; touch: a finger drag; transitioning: a
   * level transition runs.
   */
  scrolled(list, f, touch = false, transitioning = false) {
    if (!list) { this.showNow(); return; }
    // extraStates (h30 / i30): state_toolbar_in_header down the toolbar while the list shows its first item.
    if (this.extraStates) setExtraState(this.view, 'toolbar_in_header', !!list.first);
    const v = this.view, mode = this.anchor, bottom = this.bottomAnchored;
    const reserved = this.reserved();
    const height = bottom ? reserved + this.bottomToolbar : v.height + (v.lp?.topMargin ?? 0);
    if (this.state === 2) this.stopMove();
    let d = this.offset + f;
    const r = Math.round(d);
    const flags = list.flags;
    let off = r;
    const zero = () => { d = 0; off = 0; };
    if (mode === ANCHOR_BOTTOM) {
      if (flags & (AT_TOP | PAST_TOP)) zero();
      else if (flags & PAST_END) { if (reserved !== 0) zero(); else { d -= f; off = Math.round(d); } }
      else if (flags & AT_END) zero();
      else if (reserved !== 0 && f <= 0 && list.lastShown && list.endGap > 0 && list.endGap < height) {
        // Near the end the toolbar comes back as the remaining scroll shrinks.
        const limit = Math.min(0, -list.endGap);
        if (limit > r) { d = limit; off = limit; }
      }
    } else if (mode === ANCHOR_FIXED_BOTTOM) zero();
    else if (mode === ANCHOR_TOP) { if (flags & (AT_TOP | PAST_TOP)) zero(); }
    else if (mode === ANCHOR_FIXED_TOP && r < 0) zero();
    let hidden = false, pos = 0, next = 0;
    if (off > 0) { pos = 0; next = 0; }
    else if (off <= -height) { hidden = true; next = -height; }
    else { pos = off; next = d; }
    if (hidden) {
      if (this.state !== 0) {
        this.state = 0;
        this.stopMove();
        this.setTranslation(bottom ? height : -height);
        v.visibility = INVISIBLE;
        v.invalidate();
      }
      this.offset = -height;
      return;
    }
    if (this.state !== 1) {
      this.state = 1;
      v.visibility = VISIBLE;
      v.invalidate();
    }
    if (bottom) pos = -pos;
    if (!touch && f === 0 && transitioning) this.move(0, LEVEL_SHOW_MS, 2);
    else if (this.moveAnim?.kind !== 2) { this.stopMove(); this.setTranslation(pos); }
    this.offset = next;
  }
}
