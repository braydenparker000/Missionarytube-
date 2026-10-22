// Help overlays (HelpLayout + Help bubbles + the help controller sb0).
// cmd_gui_open_help opens the layout given in arg1, else the current
// screen's (main / vis / library / search / equalizer) over the whole window;
// cmd_gui_close_help closes it. Bubbles anchor to views anywhere in the UI
// (help_anchor) at help_position (top, right, bottom, left, center), outside
// the anchor or inside it from its centre (help_inside); one that does not
// fit or overlaps an earlier bubble tries the other sides, else hides
// (HelpLayout.u1/v1). Arrows point from the bubble centre to the anchor edge
// facing it (Help.onLayout) as hg0.A draws them: an arrowWidth × arrowHeight
// head on an arrowLineWeight shaft, filled and stroked, cut out of the
// bubble. Everything fades in from ×1.25 (anim_help_visible) and back out
// over 250 ms before the layout is removed.
import {FastTextView} from '../view/text.js';
import {FastLayout} from '../view/fast-layout.js';
import {GONE, VISIBLE} from '../res/values.js';
import {register} from '../view/inflater.js';
import {colorForState} from '../res/resources.js';
import {colorToCss} from '../res/values.js';

const idOf = raw => (raw ? /^@\+?id\/(.+)$/.exec(raw)?.[1] ?? null : null);
const TOP = 0, RIGHT = 1, BOTTOM = 2, LEFT = 3, CENTER = 4;
const ANIM_S = 0.25;

/** Html.fromHtml subset for help strings: line breaks kept, tags dropped, entities decoded. */
export function htmlToText(s) {
  // Inline arrow images become arrow characters (the 12 dp arrow drawables).
  const ARROWS = {left: '\u2190', right: '\u2192', up: '\u2191', down: '\u2193'};
  return (s ?? '')
    .replace(/<img\s+src=["']?arrow_(left|right|up|down)[^>]*>/gi, (m, d) => ARROWS[d.toLowerCase()])
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

export class Help extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    const parts = [];
    const html = a.string('html', null);
    const main = html ? htmlToText(html) : this.text;
    if (main) parts.push(main);
    for (const k of ['line1', 'line2', 'line3', 'line4']) {
      const t = a.string(k, null);
      if (t) parts.push(htmlToText(t));
    }
    this.setText(parts.join('\n'));
    this.anchorId = idOf(a.raw('help_anchor'));
    this.position = a.int('help_position', TOP);
    this.inside = a.bool('help_inside', false);
    this.oneAxis = a.bool('help_oneAxis', false);
    this.showArrow = a.bool('showArrow', true);
    this.arrowTo = [idOf(a.raw('showArrowTo')), idOf(a.raw('showArrowTo2'))].filter(Boolean);
    const dp = v => Math.round(v * ctx.dpr);
    this.arrow = {
      width: a.dimFloat('arrowWidth', dp(10)), height: a.dimFloat('arrowHeight', dp(8)), offset: a.dimFloat('arrowOffset', 0),
      stroke: a.dimFloat('arrowStrokeWidth', 2), line: a.dimFloat('arrowLineWeight', dp(4)),
      fill: colorForState(a.color('arrowFillColor') ?? {color: 0}, {}) ?? 0,
      strokeColor: colorForState(a.color('arrowStrokeColor') ?? {color: 0}, {}) ?? 0,
    };
    this.bgAlpha = a.float('bgAlpha', 1);
  }

  draw() {
    super.draw();
    if (this._bgLayer) this._bgLayer.style.opacity = this.bgAlpha === 1 ? '' : String(this.bgAlpha);
  }
}

export class HelpLayout extends FastLayout {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'cp-help-arrows');
    this.el.insertBefore(this.svg, this.el.firstChild);
  }

  onClick() {
    this.ctx.bus.post('bus_gui', 'cmd_gui_close_help', this);
  }

  /** Rect of a view in this layout's coordinates, or null when it is not shown. */
  rectOf(v) {
    for (let p = v; p; p = p.parent) if (p.visibility !== VISIBLE || p.alpha <= 0) return null;
    const a = v.getLocationIn(null), b = this.getLocationIn(null);
    return {x: a.x - b.x, y: a.y - b.y, w: v.width, h: v.height};
  }

  root() {
    let r = this;
    while (r.parent) r = r.parent;
    return r;
  }

  onLayout(changed, l, t, r, b) {
    const ins = this.ctx.windowInsets;
    this.paddingLeft = ins.left; this.paddingTop = ins.top; this.paddingRight = ins.right; this.paddingBottom = ins.bottom;
    super.onLayout(changed, l, t, r, b);
    const root = this.root();
    const placed = [];
    for (const c of this.children) {
      if (!(c instanceof Help) || c.visibility === GONE) continue;
      const anchorView = c.anchorId ? root.findViewById(c.anchorId) : this;
      const a = anchorView ? this.rectOf(anchorView) : null;
      c.anchorView = anchorView;
      if (!a) { c.helpHidden = true; c.el.style.display = 'none'; continue; }
      let frame = this.place(c, c.position, a, placed);
      for (let p = 0; !frame && p < 4; p++) if (p !== c.position) frame = this.place(c, p, a, placed);
      c.helpHidden = !frame;
      c.el.style.display = frame ? '' : 'none';
      if (!frame) continue;
      c.placedPosition = frame.position;
      c.layout(frame.x, frame.y, frame.x + c.measuredWidth, frame.y + c.measuredHeight);
      if (!c.oneAxis) placed.push({x: frame.x, y: frame.y, r: frame.x + c.measuredWidth, b: frame.y + c.measuredHeight});
    }
    this.placeAttached();
    this.drawArrows();
  }

  /** HelpLayout.v1: the bubble's frame for a position, or null if it does not fit or overlaps. */
  place(c, pos, a, placed) {
    const lp = c.lp, W = c.measuredWidth, H = c.measuredHeight;
    const mL = lp.leftMargin ?? 0, mT = lp.topMargin ?? 0, mR = lp.rightMargin ?? 0, mB = lp.bottomMargin ?? 0;
    const cx = Math.trunc((a.w - W) / 2) + a.x, cy = Math.trunc((a.h - H) / 2) + a.y;
    const keepX = c.left, keepY = c.top;
    let x, y;
    if (pos === TOP) { x = c.oneAxis ? keepX : cx; y = c.inside ? Math.trunc(a.h / 2) + a.y - H - mB : a.y - H - mB; }
    else if (pos === RIGHT) { x = c.inside ? Math.trunc(a.w / 2) + a.x + mL : a.x + a.w + mL; y = c.oneAxis ? keepY : cy; }
    else if (pos === BOTTOM) { x = c.oneAxis ? keepX : cx; y = c.inside ? Math.trunc(a.h / 2) + a.y + mT : a.y + a.h + mT; }
    else if (pos === LEFT) { x = c.inside ? Math.trunc(a.w / 2) + a.x - W - mR : a.x - W - mR; y = c.oneAxis ? keepY : cy; }
    else { x = cx; y = cy; }
    if (y < this.paddingTop) y = this.paddingTop + mT;
    if (x < this.paddingLeft) x = this.paddingLeft + mL;
    if (x + W > this.measuredWidth - this.paddingRight) {
      x = this.measuredWidth - mR - this.paddingRight - W;
      if (x < this.paddingTop) return null; // the reference compares with the top padding here
    }
    if (y + H > this.measuredHeight - this.paddingBottom) {
      y = this.measuredHeight - mB - this.paddingBottom - H;
      if (y < this.paddingBottom) return null;
    }
    if (!c.oneAxis) {
      for (const p of placed) if (p.x < x + W && x < p.r && p.y < y + H && y < p.b) return null;
    }
    return {x, y, position: pos};
  }

  /** Non-bubble children attached to bubbles (close button, title) follow them. */
  placeAttached() {
    const byId = id => (id ? this.children.find(v => v.id === id) : null);
    for (const c of this.children) {
      const a = c._attrs;
      if (!a || c instanceof Help || c.visibility === GONE) continue;
      const lp = c.lp, W = c.measuredWidth, H = c.measuredHeight;
      const ref = name => byId(idOf(a.raw(name)));
      let x = c.left, y = c.top, w = W;
      const rr = ref('layout_attachRightToRight'), ll = ref('layout_attachLeftToLeft'), tt = ref('layout_attachTopToTop'), rOf = ref('layout_attachRight');
      if (ll) x = ll.left + (lp.leftMargin ?? 0);
      if (rr) x = rr.right - (lp.rightMargin ?? 0) - W;
      if (tt) y = tt.top + (lp.topMargin ?? 0);
      if (rOf && ll) w = Math.max(0, Math.min(W, rOf.left - (lp.rightMargin ?? 0) - x));
      if (rr?.helpHidden || ll?.helpHidden || tt?.helpHidden) { c.el.style.display = 'none'; continue; }
      c.el.style.display = '';
      c.layout(x, y, x + w, y + H);
    }
  }

  /** Arrows (Help.onLayout targets, hg0.A shape), clipped out of every bubble. */
  drawArrows() {
    const px = this.ctx.px, svg = this.svg;
    svg.setAttribute('width', px(this.width));
    svg.setAttribute('height', px(this.height));
    svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    let holes = '', paths = '';
    for (const c of this.children) {
      if (!(c instanceof Help) || c.helpHidden || c.visibility === GONE) continue;
      const s = c.arrow.stroke;
      holes += `<rect x="${c.left + s}" y="${c.top + s}" width="${Math.max(0, c.width - 2 * s)}" height="${Math.max(0, c.height - 2 * s)}" fill="#000"/>`;
      const targets = [];
      if (c.showArrow && c.anchorView) targets.push(c.anchorView);
      for (const id of c.arrowTo) { const v = this.root().findViewById(id); if (v) targets.push(v); }
      for (const v of targets) {
        const r = this.rectOf(v);
        if (!r) continue;
        let tx = r.x + r.w / 2, ty = r.y + r.h / 2;
        const pos = c.placedPosition;
        if (pos === TOP) ty -= r.h / 2;
        else if (pos === BOTTOM) ty += r.h / 2;
        else if (pos === RIGHT) tx += r.w / 2;
        else if (pos === LEFT) tx -= r.w / 2;
        paths += this.arrowPath(c, c.left + c.width / 2, c.top + c.height / 2, tx, ty);
      }
    }
    svg.innerHTML = `<defs><mask id="cp-help-m" maskUnits="userSpaceOnUse"><rect width="${this.width}" height="${this.height}" fill="#fff"/>${holes}</mask></defs><g mask="url(#cp-help-m)">${paths}</g>`;
  }

  arrowPath(c, cx, cy, tx, ty) {
    const A = c.arrow;
    const dist = Math.max(Math.hypot(cx - tx, cy - ty), A.height - A.offset);
    const pts = [[0, 0], [-A.width / 2, A.height], [-A.line / 2, A.height - A.offset], [-A.line / 2, dist], [A.line / 2, dist], [A.line / 2, A.height - A.offset], [A.width / 2, A.height]];
    const ang = Math.atan2(100 * (tx - cx), -100 * (ty - cy)) * 180 / Math.PI;
    const d = 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
    return `<path transform="translate(${tx} ${ty}) rotate(${ang.toFixed(2)})" d="${d}" fill="${colorToCss(A.fill)}" stroke="${colorToCss(A.strokeColor)}" stroke-width="${A.stroke}" stroke-linejoin="round"/>`;
  }
}

/** The help controller (sb0): one overlay at a time on the root layout. */
export function installHelp(ctx) {
  const layoutForScreen = () => {
    const nav = ctx.topNav?.nav ?? 'nav_main', scene = ctx.topNav?.scenes.scene;
    if (nav === 'nav_main') return scene === 'scene_vis' || scene === 'scene_vis_temp_ui' ? 'merge_help_vis' : 'merge_help_main';
    if (nav === 'nav_lib') return 'merge_help_lib';
    if (nav === 'nav_search') return 'merge_help_search';
    if (nav === 'nav_eq') return ['merge_help_equ_eq', 'merge_help_equ_vol', 'merge_help_equ_reverb'][ctx.eqPage ?? 0];
    return null;
  };
  let open = null;
  // sb0.y: the library and search help pin the list's moveable toolbar until closed.
  let pinned = false;
  const close = () => {
    const h = open;
    if (!h) return;
    open = null;
    if (pinned) { pinned = false; ctx.bus.post('list', 'cmd_list_force_ab_on_screen', null, {arg1: 2}); }
    for (const c of h.children) ctx.tween(c, {alpha: 0, scaleX: c._helpFrom?.scaleX ?? 1, scaleY: c._helpFrom?.scaleY ?? 1}, ANIM_S);
    setTimeout(() => { h.parent?.removeView(h); ctx.scheduleLayout(); }, ANIM_S * 1000);
  };
  ctx.bus.subscribe('bus_gui', (msg, src, d) => {
    if (msg === 'cmd_gui_close_help') { close(); return; }
    if (msg !== 'cmd_gui_open_help') return;
    if (open) { close(); return; }
    const name = typeof d?.arg1 === 'string' ? d.arg1 : layoutForScreen();
    if (!name) return;
    let root = ctx.root;
    const made = ctx.inflater.inflate(name, root);
    open = made[0];
    if (!open) return;
    for (const c of open.children) {
      c._helpFrom = {scaleX: c.scaleX, scaleY: c.scaleY};
      const vis = {alpha: 1, scaleX: 1, scaleY: 1};
      ctx.tween(c, vis, ANIM_S);
    }
    if (name === 'merge_help_lib' || name === 'merge_help_search') { pinned = true; ctx.bus.post('list', 'cmd_list_force_ab_on_screen', null, {arg1: 1}); }
    ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close', null);
    root.forceLayoutTree?.();
    ctx.scheduleLayout();
  });
}

register(['Help'], Help);
register(['HelpLayout'], HelpLayout);
