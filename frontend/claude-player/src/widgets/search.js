// Search screen: the search panel (clear button, edit text with the search
// icon and hint) and the category chips; results show in the list widget in
// list mode (scene_search). The edit text is drawn by the view; a transparent
// native input overlays it for the keyboard and caret.
import {FastTextView, FastButton, BusActionButton} from '../view/text.js';
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {StyledAttributes, colorForState} from '../res/resources.js';
import {colorToCss, GONE, VISIBLE} from '../res/values.js';
import {cssFontFamily} from '../fonts.js';
import {RECALC_NONE} from '../view/scene.js';
import {VelocityTracker, Fling, TOUCH_SLOP_DP, MIN_FLING_DP, MAX_FLING_DP} from '../gesture.js';

// The searched categories (jj1.v1 order) after "All"; the chip titles are
// the categories' names.
export const SEARCH_CATS = [
  {kind: 'all', title: 'select_all_short'},
  {kind: 'albums', title: 'albums'},
  {kind: 'artists', title: 'artists'},
  {kind: 'albumArtists', title: 'album_artists'},
  {kind: 'folders', title: 'folders'},
  {kind: 'genres', title: 'genres'},
  {kind: 'years', title: 'years'},
  {kind: 'composers', title: 'composers'},
  {kind: 'playlists', title: 'playlists'},
  {kind: 'songs', title: 'all_songs'},
  {kind: 'streams', title: 'streams'},
];

export class ListSearchEditText extends FastTextView {
  static listBound = true;

  constructor(ctx, a) {
    super(ctx, a);
    // The platform EditText style's text appearance (textAppearanceMediumInverse,
    // 18sp) sits under the theme's text size; it is not among the app's styles.
    if (a.local('android:textSize') === undefined) { this.textSize = ctx.res.dimensionPixelSize('18sp', a.theme) ?? this.textSize; this.updateFont(); }
    this.hint = a.string('android:hint', '') ?? '';
    const dl = a.ref('android:drawableLeft');
    if (dl) { this.drawablePosition = 0; this.setDrawable(ctx.drawables.fromRef(dl, a.theme)); }
    this.hintColor = a.color('android:textColorHint') ?? null;
    this.query = '';
    const input = this.input = document.createElement('input');
    input.type = 'search';
    input.enterKeyHint = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', this.hint);
    input.className = 'cp-search-input';
    this.el.appendChild(input);
    input.addEventListener('input', () => this.onQuery(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    this.showHint();
    if (!new.target.listBound) return;
    ctx.bus.subscribe('list', (msg, src, d) => {
      if (msg === 'cmd_list_search_text' && src !== this) { input.value = d?.string ?? ''; this.onQuery(input.value); }
    });
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'msg_nav_changed' && d.nav === 'nav_search') setTimeout(() => input.focus({preventScroll: true}), 0);
      else if (msg === 'msg_nav_changed') input.blur();
    });
  }

  // A platform EditText: drawableLeft sits at the left padding (TextView
  // compound drawables), where FastTextView puts it at drawablePaddingStart.
  drawableRect() {
    const r = super.drawableRect();
    if (this.drawablePosition === 0) r.x += this.paddingLeft;
    return r;
  }

  showHint() {
    // The hint draws as the view's text in the hint colour while the query is empty.
    if (!this.query) {
      this._normalColor ??= this.textColor;
      if (this.hintColor) this.textColor = this.hintColor;
      this.setText(this.hint);
    } else {
      if (this._normalColor) this.textColor = this._normalColor;
      this.setText('');
    }
  }

  onQuery(q) {
    this.query = q;
    this.showHint();
    this.invalidate();
    this.ctx.bus.post('list', 'cmd_list_search_text', this, {string: q});
  }

  onClick() {
    this.input.focus({preventScroll: true});
  }

  get clickable() { return true; }
  set clickable(v) {}

  draw() {
    super.draw();
    // The native input covers the text area with the same font and colour.
    const px = this.ctx.px, st = this.input.style;
    const [n, q] = this._pads ?? this.textPaddings();
    st.left = px(n) + 'px';
    st.width = px(Math.max(0, this.width - n - q)) + 'px';
    st.top = '0px';
    st.height = px(this.height) + 'px';
    st.font = `${this.font.weight} ${px(this.effectiveTextSize())}px ${cssFontFamily(this.font)}`;
    const c = colorForState(this._normalColor ?? this.textColor, this.state);
    st.color = c === null ? '#fff' : colorToCss(c);
    st.caretColor = st.color;
  }
}

/**
 * Category chips (catButtonStyle) over a category mask (ListSearchCatsLayout;
 * bit i = category i after "All", default all set): a tap toggles a category
 * and "All" checks every one; a long press keeps only that category. "All"
 * shows checked while every bit is set.
 */
export const SEARCH_ALL = (1 << (SEARCH_CATS.length - 1)) - 1;
const MASK_STORE = 'cp-search-mask';

/** The searched categories (z30 search categories; persisted, all by default). */
export function searchMask() {
  try {
    const v = localStorage.getItem(MASK_STORE);
    if (v !== null && /^\d+$/.test(v)) return +v & SEARCH_ALL;
  } catch { /* storage unavailable */ }
  return SEARCH_ALL;
}

const ORDER_STORE = 'cp-search-order';

/**
 * The order of the categories (chips and result sections): indexes into the
 * categories after "All". The reference's order is fixed (jj1.v1); the owner
 * asked for a choice, set by dragging in the search's List Options.
 */
export function searchOrder() {
  const n = SEARCH_CATS.length - 1;
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_STORE) ?? 'null');
    if (Array.isArray(v) && v.length === n && new Set(v).size === n && v.every(i => Number.isInteger(i) && i >= 0 && i < n)) return v;
  } catch { /* storage unavailable */ }
  return Array.from({length: n}, (_, i) => i);
}

/** Sets the categories' order: saved, the chips follow and the results re-run. */
export function setSearchOrder(ctx, order) {
  try { localStorage.setItem(ORDER_STORE, JSON.stringify(order)); } catch { /* storage unavailable */ }
  ctx.searchCats?.applyOrder();
  ctx.bus.post('list', 'cmd_list_search_cat', ctx.searchCats ?? null, {mask: searchMask()});
}

/** Sets the searched categories: saved, the chips follow and the results re-run. */
export function setSearchMask(ctx, mask) {
  try { localStorage.setItem(MASK_STORE, String(mask)); } catch { /* storage unavailable */ }
  if (ctx.searchCats && ctx.searchCats.mask !== mask) ctx.searchCats.setMask(mask, false);
  ctx.bus.post('list', 'cmd_list_search_cat', ctx.searchCats ?? null, {mask});
}

export class ListSearchCatsLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const style = a.theme.styleName(a.raw('catButtonStyle'));
    this.mask = SEARCH_ALL;
    this.buttons = SEARCH_CATS.map((c, i) => {
      const sa = new StyledAttributes(ctx.res, ctx.theme, {}, null, style);
      const b = new FastButton(ctx, sa);
      b._attrs = sa;
      b.setText(ctx.res.stringByName(c.title) ?? c.title);
      b.kind = c.kind;
      b.bit = i === 0 ? 0 : 1 << (i - 1);
      b.lp = this.generateLayoutParams(sa);
      b.onClick = () => this.setMask(b.bit ? this.mask ^ b.bit : SEARCH_ALL);
      b.longClickable = true;
      b.onLongClick = () => { this.setMask(b.bit || SEARCH_ALL); return true; };
      this.addView(b);
      return b;
    });
    this.mask = -1;
    this.setMask(searchMask(), false);
    this.applyOrder();
    ctx.searchCats = this;
    // The layout starts gone; entering search shows it and makes its
    // scene_search record visible (x1()); a targeted search hides it behind
    // the target chip until the target is cleared.
    this.visibility = GONE;
    // The panel may inflate after a targeted search has begun.
    this.wanted = !ctx.listWidget?.searchTarget;
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg !== 'msg_nav_changed' || d.nav !== 'nav_search' || this.shown) return;
      this.shown = true;
      if (this.wanted) showInSearchScene(ctx, this, true);
    });
  }

  /** "All", then the categories in the chosen order (searchOrder). */
  applyOrder() {
    const [all, ...cats] = this.buttons, order = searchOrder();
    const wanted = [all, ...order.map(i => cats[i])];
    if (wanted.every((b, i) => this.children[i] === b)) return;
    for (const b of this.buttons) this.removeView(b);
    for (const b of wanted) this.addView(b);
    this.requestLayout();
  }

  setShown(on) {
    this.wanted = on;
    if (this.shown || !on) showInSearchScene(this.ctx, this, on);
  }

  // The row scrolls sideways when the chips pass its width (im0's b82
  // scroller): a horizontal drag scrolls it, a fast release flings it, and
  // the ends clamp. The stretch overscroll is not drawn.
  onLayout(changed, l, t, r, b) {
    super.onLayout(changed, l, t, r, b);
    let extent = 0;
    for (const c of this.children) if (c.visibility !== GONE) extent = Math.max(extent, c.right + (c.lp?.rightMargin ?? 0));
    this.chipsExtent = extent + this.paddingRight;
    const sx = Math.min(this.scrollX ?? 0, this.maxScrollX);
    this.scrollX = sx;
    if (sx) for (const c of this.children) c.layout(c.left - sx, c.top, c.right - sx, c.bottom);
  }

  get maxScrollX() { return Math.max(0, (this.chipsExtent ?? 0) - this.width); }

  setScrollX(x) {
    const v = Math.max(0, Math.min(this.maxScrollX, x));
    if (v === (this.scrollX ?? 0)) return false;
    this.scrollX = v;
    this.requestLayout();
    return true;
  }

  onInterceptStart(start, now) {
    if (!this.maxScrollX || Math.abs(now.rootX - start.rootX) <= Math.abs(now.rootY - start.rootY)) return false;
    this._fling?.();
    this._fling = null;
    const vt = new VelocityTracker();
    vt.add(start.time, start.rootX, start.rootY);
    this.hScroll = {x: start.rootX + Math.sign(now.rootX - start.rootX) * TOUCH_SLOP_DP * this.ctx.dpr, scroll: this.scrollX ?? 0, vt};
    return true;
  }

  onPointerMove(e) {
    const h = this.hScroll;
    if (!h) return;
    h.vt.add(e.time, e.rootX, e.rootY);
    this.setScrollX(h.scroll - (e.rootX - h.x));
  }

  onPointerUp(e) {
    const h = this.hScroll;
    this.hScroll = null;
    if (!h || e?.cancelled) return;
    h.vt.up(e.time);
    const v = -h.vt.compute(MAX_FLING_DP * this.ctx.dpr).vx;
    if (Math.abs(v) < MIN_FLING_DP * this.ctx.dpr) return;
    const f = new Fling(v);
    let last = performance.now();
    this._fling = this.ctx.onFrame(now => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      const moved = this.setScrollX((this.scrollX ?? 0) + f.step(dt));
      return moved && !f.done;
    });
  }

  setMask(mask, notify = true) {
    const changed = mask !== this.mask;
    this.mask = mask;
    for (const b of this.buttons) {
      const on = b.bit ? (mask & b.bit) !== 0 : (mask & SEARCH_ALL) === SEARCH_ALL;
      b.setChecked(on);
      b.setActivated(on);
    }
    if (notify && changed) setSearchMask(this.ctx, mask);
  }
}

/**
 * Shows or hides a view of the search panel in the search scene: its
 * scene_search record and, while the scene change runs, the change's
 * target (taken while the view was gone, so the frame is left to the
 * layout pass).
 */
function showInSearchScene(ctx, v, on) {
  const vis = on ? VISIBLE : GONE;
  v.visibility = vis;
  v.alpha = 1;
  const rec = v.sceneParams?.get('scene_search');
  if (rec) { rec.visibility = vis; rec.alpha = 1; }
  const it = ctx.topNav?.scenes.items.find(x => x.view === v);
  if (it) { it.toVisibility = vis; it.toAlpha = 1; it.fade = on; it.fromAlpha = on ? 0 : 1; it.recalc = RECALC_NONE; }
  v.requestLayout();
  v.parent?.requestLayout?.();
}

/**
 * ListSearchTargetButton (TopSearchTarget): the targeted search's chip, the
 * searched list's label with a clear (X) icon on its right; shown while the
 * search is targeted (state_list_targeted_search). A press hides it and
 * posts cmd_list_clear_target_search.
 */
export class ListSearchTargetButton extends BusActionButton {
  constructor(ctx, a) {
    super(ctx, a);
    this.visibility = GONE;
    ctx.searchTarget = this;
    const t = ctx.listWidget?.searchTarget;
    if (t) queueMicrotask(() => this.setTarget(t.label));
  }

  setTarget(label) {
    if (label) this.setText(label);
    showInSearchScene(this.ctx, this, !!label);
  }

  onClick() {
    showInSearchScene(this.ctx, this, false);
    super.onClick();
  }
}

/**
 * Plain edit text (EditText): the same drawn text and native input, without
 * the list search binding; onTextChanged(text) reports edits.
 */
export class EditTextView extends ListSearchEditText {
  static listBound = false;

  onQuery(q) {
    this.query = q;
    this.showHint();
    this.invalidate();
    this.onTextChanged?.(q);
  }

  get value() { return this.input.value; }

  setValue(v) {
    this.input.value = v;
    this.onQuery(v);
  }

  clear() {
    this.setValue('');
  }
}

register(['ListSearchEditText'], ListSearchEditText);
register(['EditText', 'AppCompatEditText', 'AutoCompleteTextView', 'LocalListSearchEditText'], EditTextView);
register(['ListSearchCatsLayout'], ListSearchCatsLayout);
register(['ListSearchTargetButton'], ListSearchTargetButton);
