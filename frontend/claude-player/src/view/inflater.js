// Layout inflation from reference layout trees: <merge>, <include> (including
// ?attr layouts), pseudo-tags <SceneParams>/<StateAnimParams>, and a registry
// mapping reference widget classes onto engine view classes.
import {StyledAttributes} from '../res/resources.js';
import {View, ViewGroup} from './view.js';
import {FastLayout} from './fast-layout.js';
import {SceneFastLayout, attachSceneParams, attachStateAnim} from './scene.js';
import {FastTextView, FastButton, BusActionButton} from './text.js';
import {GONE} from '../res/values.js';

const registry = new Map();
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
    this.className = a?.raw('class') ?? '';
  }
}

export class Placeholder extends View {
  constructor(ctx, a, tag) {
    super(ctx, a);
    this.tag = tag;
    this.el.dataset.placeholder = tag;
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
  inflate(name, parent, {optional = false, overrides = null} = {}) {
    const tree = this.ctx.res.layout(name);
    if (!tree) {
      if (!optional) console.warn('[claude-player] missing layout', name);
      return [];
    }
    const [tag, attrs, children] = tree;
    if (tag === 'merge') {
      const made = [];
      for (const c of children ?? []) made.push(...this.inflateNode(c, parent));
      return made;
    }
    return this.inflateNode(tree, parent, overrides);
  }

  resolveLayoutName(raw) {
    const {value} = this.ctx.res.resolveRaw(raw, this.ctx.theme);
    if (typeof value !== 'string') return null;
    const m = /^@layout\/(.+)$/.exec(value);
    return m ? m[1] : null;
  }

  inflateNode(node, parent, overrides = null) {
    const [tag, rawAttrs, children] = node;
    let attrs = normaliseAttrs(rawAttrs || {});
    if (tag === 'include') {
      const layoutName = this.resolveLayoutName(attrs['layout'] ?? attrs['android:layout']);
      const optional = attrs.optional === 'true';
      if (!layoutName) {
        if (!optional) console.warn('[claude-player] unresolved include', attrs.layout);
        return [];
      }
      const ov = {};
      for (const [k, v] of Object.entries(attrs)) if (k !== 'layout' && k !== 'optional') ov[k] = v;
      return this.inflate(layoutName, parent, {optional, overrides: Object.keys(ov).length ? ov : null});
    }
    if (tag === 'SceneParams' || tag === 'StateAnimParams') {
      const target = this.pseudoTarget(parent, attrs);
      if (!target) return [];
      const sa = this.styledAttributes(attrs);
      if (tag === 'SceneParams') {
        const lpParent = target.parent ?? parent;
        attachSceneParams(target, sa, s => (lpParent.generateLayoutParams ? lpParent.generateLayoutParams(s) : null));
      } else attachStateAnim(target, sa);
      return [];
    }
    if (tag === 'requestFocus' || tag === 'tag' || tag === 'intent' || tag === 'ViewStub') return [];
    if (overrides) attrs = {...attrs, ...overrides};
    let className = tag;
    if (tag === 'view') className = attrs.class ?? 'View';
    const sa = this.styledAttributes(attrs);
    const view = this.create(className, sa, children);
    view._attrs = sa;
    view._xmlTag = className;
    if (parent) {
      view.lp = parent.generateLayoutParams ? parent.generateLayoutParams(sa) : null;
      parent.addView(view);
    }
    if (children && view instanceof ViewGroup) {
      for (const c of children) this.inflateNode(c, view);
    }
    view.onFinishInflate?.();
    return [view];
  }

  pseudoTarget(parent, attrs) {
    const forId = attrs.forId;
    if (forId && forId !== 'parent') {
      const id = forId.replace(/^@\+?id\//, '');
      return parent.findViewById(id) ?? null;
    }
    if (forId === 'parent') return parent;
    return parent.children[parent.children.length - 1] ?? null;
  }

  create(className, sa, children) {
    const short = shortName(className);
    const Cls = registry.get(className) ?? registry.get(short);
    if (Cls) return new Cls(this.ctx, sa, className);
    if (/Behavior$/.test(short)) return new BehaviorView(this.ctx, sa);
    unknownClasses.add(className);
    const hasChildren = children && children.some(c => Array.isArray(c) && c[0] !== 'SceneParams' && c[0] !== 'StateAnimParams');
    return hasChildren ? new PlaceholderGroup(this.ctx, sa, className) : new Placeholder(this.ctx, sa, className);
  }
}

// Base registrations; feature modules register their widgets too.
register(['FastLayout', 'FastLayoutWithViewCacheOpt', 'ClickableFastLayout', 'PrivateNonSceneFastLayout', 'LikeUnlikeLayout', 'DialogOuterFastLayout', 'FrameLayout', 'LinearLayout', 'RelativeLayout'], FastLayout);
register(['SceneFastLayout', 'MenuPlaceholderLayout', 'ItemSceneFastLayout'], SceneFastLayout);
register(['FastTextView', 'TextView', 'ListIndexerPopupView', 'BusStatusText', 'HtmlTextView', 'LyricsFastTextView', 'InfoTextView', 'KnobLabelAndValue'], FastTextView);
register(['FastButton', 'Button', 'ImageButton', 'FastCheckBox', 'FastCheckBoxOnly', 'CheckBox', 'RadioButton', 'LyricsButton', 'BusStatusTextButton', 'IntentActionButton', 'MediaRouteButton'], FastButton);
register(['BusActionButton', 'PlayPauseButton', 'MorphableBusActionButton', 'BusStateEnabledActionButton', 'BusCheckBox'], BusActionButton);
register(['View', 'NonOverlappingView', 'Space', 'android.widget.Space', 'SmartSpacer', 'Shim', 'AlphaDisabledView'], View);
