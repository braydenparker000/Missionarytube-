// Search screen: the search panel (clear button, edit text with the search
// icon and hint) and the category chips; results show in the list widget in
// list mode (scene_search). The edit text is drawn by the view; a transparent
// native input overlays it for the keyboard and caret.
import {FastTextView, FastButton} from '../view/text.js';
import {FastLayout} from '../view/fast-layout.js';
import {MeasureSpec} from '../view/view.js';
import {register} from '../view/inflater.js';
import {StyledAttributes, colorForState} from '../res/resources.js';
import {colorToCss} from '../res/values.js';
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

/** Category chips (catButtonStyle); the selected one is checked. */
export class ListSearchCatsLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    const style = a.theme.styleName(a.raw('catButtonStyle'));
    this.selected = 'all';
    this.buttons = SEARCH_CATS.map(c => {
      const sa = new StyledAttributes(ctx.res, ctx.theme, {}, null, style);
      const b = new FastButton(ctx, sa);
      b._attrs = sa;
      b.setText(ctx.res.stringByName(c.title) ?? c.title);
      b.kind = c.kind;
      b.lp = this.generateLayoutParams(sa);
      b.onClick = () => this.select(c.kind);
      this.addView(b);
      return b;
    });
    this.select('all', false);
  }

  select(kind, notify = true) {
    this.selected = kind;
    for (const b of this.buttons) { b.setChecked(b.kind === kind); b.setActivated(b.kind === kind); }
    if (notify) this.ctx.bus.post('list', 'cmd_list_search_cat', this, {kind});
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
