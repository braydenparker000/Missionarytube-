// Layout inflation from reference layout trees: <merge>, <include> (including
// ?attr layouts), pseudo-tags <SceneParams>/<StateAnimParams>, and a registry
// mapping reference widget classes onto engine view classes.
import {StyledAttributes} from '../res/resources.js';
import {View, MeasureSpec, ViewGroup} from './view.js';
import {FastLayout} from './fast-layout.js';
import {SceneFastLayout, attachSceneParams, attachStateAnim} from './scene.js';
import {FastTextView, FastButton, FastCheckBox, FastRadioButton, BusActionButton, BusStatusTextButton} from './text.js';
import {GONE} from '../res/values.js';

const registry = new Map();
const PSEUDO_TAGS = new Set(['SceneParams', 'StateAnimParams']);
export const unknownClasses = new Set();

export function register(names, cls) {
  for (const n of [].concat(names)) registry.set(n, cls);
}

function shortName(tag) {
  const i = tag.lastIndexOf('.');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

/** Normalises attribute names: android:* kept, any other prefix dropped. */
function normaliseAttrs(attrs) {
  const out = {};
  if (!attrs) return out;
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('xmlns')) continue;
    const i = k.indexOf(':');
    if (i < 0) out[k] = v;
    else if (k.startsWith('android:')) out[k] = v;
    else if (!k.startsWith('tools:')) out[k.slice(i + 1)] = v;
  }
  return out;
}

/** Non-visual helper objects declared as layout children (behaviors). */
export class BehaviorView extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.visibility = GONE;
    this.isBehavior = true;
    this.className = a?.raw('class') ?? '';
  }
}

/**
 * LoadableBehavior: inflates a layout into its parent the first time the
 * parent enters one of the loadForScene scenes (insertAt: here, end, start).
 */
export class LoadableBehaviorView extends BehaviorView {
  constructor(ctx, a) {
    super(ctx, a);
    const v = a.raw('android:layout');
    const m = v ? /^@layout\/(.+)$/.exec(a.res.resolveRaw(v, a.theme).value ?? '') : null;
    this.layoutName = m ? m[1] : null;
    this.loadForScenes = [];
    for (const k of ['loadForScene', 'loadForScene_2', 'loadForScene_3', 'loadForScene_4', 'loadForScene_5', 'loadForScene_6', 'loadForScene_7', 'loadForScene_8', 'loadForScene_9']) {
      const r = a.raw(k);
      if (!r) break;
      const id = /^@\+?id\/(.+)$/.exec(a.res.resolveRaw(r, a.theme).value ?? '');
      if (id) this.loadForScenes.push(id[1]);
    }
    this.insertAt = a.int('insertAt', -1);
    this.loaded = false;
  }

  /** Inflates the layout into the parent; returns the new views. */
  load() {
    if (this.loaded || !this.layoutName || !this.parent) return [];
    this.loaded = true;
    const parent = this.parent;
    const at = this.insertAt === -2 ? parent.children.indexOf(this) : this.insertAt === 0 ? 0 : -1;
    const made = this.ctx.inflater.inflate(this.layoutName, parent, {insertAt: at});
    for (let p = parent; p; p = p.parent) {
      if (p.loadHooks) p.loadHooks = p.loadHooks.filter(h => { const f = p.findViewById(h.id); if (f) h.fn(f); return !f; });
    }
    this.ctx.bus?.post('bus_gui', 'msg_gui_layout_loaded', this, {parent});
    return made;
  }
}

/**
 * Calls fn with root's descendant id now, or when a LoadableBehavior first
 * inflates it (item views load their art and header part per scene).
 */
export function withView(root, id, fn) {
  const v = root.findViewById(id);
  if (v) fn(v);
  else (root.loadHooks ??= []).push({id, fn});
}

export class Placeholder extends View {
  constructor(ctx, a, tag) {
    super(ctx, a);
    this.tag = tag;
    this.el.dataset.placeholder = tag;
  }

  // Unimplemented views take no space unless sized exactly.
  onMeasure(wSpec, hSpec) {
    const size = (spec, min) => (MeasureSpec.getMode(spec) === MeasureSpec.EXACTLY ? MeasureSpec.getSize(spec) : min);
    this.setMeasuredDimension(size(wSpec, this.suggestedMinimumWidth), size(hSpec, this.suggestedMinimumHeight));
  }
}

export class PlaceholderGroup extends FastLayout {
  constructor(ctx, a, tag) {
    super(ctx, a);
    this.tag = tag;
    this.el.dataset.placeholder = tag;
  }
}

export class Inflater {
  constructor(ctx) {
    this.ctx = ctx;
  }

  styledAttributes(attrs, theme = this.ctx.theme) {
    const style = attrs.style ? theme.styleName(attrs.style) : null;
    return new StyledAttributes(this.ctx.res, theme, attrs, style);
  }

  /** Inflates a layout resource into parent (appending). Returns the created root view(s). */
  inflate(name, parent, {optional = false, overrides = null, insertAt = -1} = {}) {
    const tree = this.ctx.res.layout(name);
    if (!tree) {
      if (!optional) console.warn('[claude-player] missing layout', name);
      return [];
    }
    const [tag, attrs, children] = tree;
    const pos = {at: insertAt};
    if (tag === 'merge') {
      const made = [];
      for (const c of children ?? []) made.push(...this.inflateNode(c, parent, null, pos));
      return made;
    }
    return this.inflateNode(tree, parent, overrides, pos);
  }

  resolveLayoutName(raw, theme = this.ctx.theme) {
    const {value} = this.ctx.res.resolveRaw(raw, theme);
    if (typeof value !== 'string') return null;
    const m = /^@layout\/(.+)$/.exec(value);
    return m ? m[1] : null;
  }

  inflateNode(node, parent, overrides = null, pos = null) {
    const [tag, rawAttrs, children] = node;
    let attrs = normaliseAttrs(rawAttrs || {});
    if (tag === 'include') {
      // Theme attributes (?dialogContentLayout) resolve in the parent's theme.
      const layoutName = this.resolveLayoutName(attrs['layout'] ?? attrs['android:layout'], parent?.viewTheme ?? this.ctx.theme);
      const optional = attrs.optional === 'true';
      if (!layoutName) {
        if (!optional) console.warn('[claude-player] unresolved include', attrs.layout);
        return [];
      }
      const ov = {};
      for (const [k, v] of Object.entries(attrs)) if (k !== 'layout' && k !== 'optional') ov[k] = v;
      return this.inflate(layoutName, parent, {optional, overrides: Object.keys(ov).length ? ov : null});
    }
    const short = shortName(tag);
    if (short === 'SceneParams' || short === 'StateAnimParams') {
      const target = this.pseudoTarget(parent, attrs, pos);
      if (!target) return [];
      const sa = this.styledAttributes(attrs, target.viewTheme ?? parent?.viewTheme ?? this.ctx.theme);
      if (short === 'SceneParams') {
        const lpParent = target.parent ?? parent;
        attachSceneParams(target, sa, s => (lpParent.generateLayoutParams ? lpParent.generateLayoutParams(s) : null));
      } else attachStateAnim(target, sa);
      return [];
    }
    if (tag === 'requestFocus' || tag === 'tag' || tag === 'intent' || tag === 'ViewStub') return [];
    if (overrides) attrs = {...attrs, ...overrides};
    let className = tag;
    if (tag === 'view') className = attrs.class ?? 'View';
    // android:theme (from the element or its style) overlays the parent's theme
    // for the view and its children (ContextThemeWrapper).
    const parentTheme = parent?.viewTheme ?? this.ctx.theme;
    let sa = this.styledAttributes(attrs, parentTheme);
    const overlay = parentTheme.styleName(sa.raw('android:theme'));
    if (overlay) sa = this.styledAttributes(attrs, this.overlayTheme(parentTheme, overlay));
    const view = this.create(className, sa, children);
    view._attrs = sa;
    view._xmlTag = className;
    if (sa.theme !== this.ctx.theme) view.viewTheme = sa.theme;
    if (parent) {
      view.lp = parent.generateLayoutParams ? parent.generateLayoutParams(sa) : null;
      if (pos && pos.at >= 0) parent.addView(view, pos.at++);
      else parent.addView(view);
      if (pos) pos.last = view;
    }
    if (children && view instanceof ViewGroup) {
      for (const c of children) this.inflateNode(c, view);
    }
    view.onFinishInflate?.();
    return [view];
  }

  overlayTheme(base, style) {
    const cache = this.overlays ??= new WeakMap();
    let m = cache.get(base);
    if (!m) cache.set(base, m = new Map());
    if (!m.has(style)) m.set(style, base.clone().applyStyle(style));
    return m.get(style);
  }

  /** The view a pseudo-tag applies to: forId, the parent, or the preceding sibling. */
  pseudoTarget(parent, attrs, pos = null) {
    const forId = attrs.forId;
    if (forId && forId !== 'parent') {
      const id = forId.replace(/^@\+?id\//, '');
      return parent.findViewById(id) ?? null;
    }
    if (forId === 'parent') return parent;
    // Inserted (not appended) merge roots: the sibling inflated just before.
    if (pos?.last) return pos.last;
    return parent.children[parent.children.length - 1] ?? null;
  }

  create(className, sa, children) {
    const short = shortName(className);
    const Cls = registry.get(className) ?? registry.get(short);
    if (Cls) return new Cls(this.ctx, sa, className);
    if (/Behavior$/.test(short)) return sa.raw('android:layout') ? new LoadableBehaviorView(this.ctx, sa) : new BehaviorView(this.ctx, sa);
    unknownClasses.add(className);
    const hasChildren = children && children.some(c => Array.isArray(c) && !PSEUDO_TAGS.has(shortName(c[0])));
    return hasChildren ? new PlaceholderGroup(this.ctx, sa, className) : new Placeholder(this.ctx, sa, className);
  }
}

// Base registrations; feature modules register their widgets too.
register(['FastLayout', 'FastLayoutWithViewCacheOpt', 'SeparatorItemView', 'ClickableFastLayout', 'PrivateNonSceneFastLayout', 'DialogOuterFastLayout', 'FrameLayout', 'LinearLayout', 'RelativeLayout'], FastLayout);
register(['SceneFastLayout', 'MenuPlaceholderLayout', 'ItemSceneFastLayout'], SceneFastLayout);
register(['FastTextView', 'TextView', 'ImageView', 'ListIndexerPopupView', 'BusStatusText', 'LyricsFastTextView', 'InfoTextView', 'KnobLabelAndValue'], FastTextView);
register(['FastCheckBox', 'FastCheckBoxOnly', 'CheckBox'], FastCheckBox);
register(['RadioButton'], FastRadioButton);
register(['FastButton', 'DragHandler', 'Button', 'ImageButton', 'LyricsButton', 'IntentActionButton'], FastButton);
register(['BusStatusTextButton'], BusStatusTextButton);
register(['BusActionButton', 'MorphableBusActionButton', 'BusStateEnabledActionButton', 'BusCheckBox'], BusActionButton);
register(['View', 'NonOverlappingView', 'Space', 'android.widget.Space', 'SmartSpacer', 'AlphaDisabledView'], View);
