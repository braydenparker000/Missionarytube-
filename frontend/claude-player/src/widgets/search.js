// Search screen: the search panel (clear button, edit text with the search
// icon and hint) and the category chips; results show in the list widget in
// list mode (scene_search). The edit text is drawn by the view; a transparent
// native input overlays it for the keyboard and caret.
import {FastTextView, FastButton} from '../view/text.js';
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {StyledAttributes, colorForState} from '../res/resources.js';
import {colorToCss, GONE, VISIBLE} from '../res/values.js';
import {cssFontFamily} from '../fonts.js';

/** Search categories (chips): all, then the library's searchable categories. */
export const SEARCH_CATS = [
  {kind: 'all', title: 'select_all_short'},
  {kind: 'songs', title: 'songs'},
  {kind: 'albums', title: 'albums'},
  {kind: 'artists', title: 'artists'},
  {kind: 'genres', title: 'genres'},
  {kind: 'folders', title: 'folders'},
  {kind: 'composers', title: 'composers'},
];

export class ListSearchEditText extends FastTextView {
  static listBound = true;

  constructor(ctx, a) {
    super(ctx, a);
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
const MASK_STORE = 'cp-search-cats';

/** The searched categories (z30 search categories; persisted, all by default). */
export function searchMask() {
  try {
    const v = localStorage.getItem(MASK_STORE);
    if (v !== null && /^\d+$/.test(v)) return +v & SEARCH_ALL;
  } catch { /* storage unavailable */ }
  return SEARCH_ALL;
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
    ctx.searchCats = this;
    // The layout starts gone; entering search shows it and makes its
    // scene_search record visible (x1(); targeted searches are not built).
    this.visibility = GONE;
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg !== 'msg_nav_changed' || d.nav !== 'nav_search' || this.shown) return;
      this.shown = true;
      this.visibility = VISIBLE;
      this.alpha = 1;
      const rec = this.sceneParams?.get('scene_search');
      if (rec) { rec.visibility = VISIBLE; rec.alpha = 1; }
      // The running scene change already took the old record: retarget it.
      const it = ctx.topNav?.scenes.items.find(x => x.view === this);
      if (it) { it.toVisibility = VISIBLE; it.toAlpha = 1; it.fade = true; it.fromAlpha = 0; }
      this.parent?.requestLayout();
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
register(['EditText', 'AppCompatEditText'], EditTextView);
register(['ListSearchCatsLayout'], ListSearchCatsLayout);
