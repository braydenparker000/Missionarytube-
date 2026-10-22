import { genericListFrame, sharedItemFrame, sharedListFrame } from './motion.js';

const clamp = n => Math.min(1, Math.max(0, Number(n) || 0));
const rectOf = element => {
  const rect = element?.getBoundingClientRect();
  return rect ? { x: rect.x ?? rect.left, y: rect.y ?? rect.top, width: rect.width, height: rect.height } : null;
};
const valid = rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const place = (element, rect) => {
  if (!element || !valid(rect)) return;
  Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
};
const saveStyles = (element, names) => Object.fromEntries(names.map(name => [name, element.style[name] || '']));
const rowProperties = ['transform', 'transformOrigin', 'opacity', 'visibility'];

/**
 * DOM adapter for the source-derived list/item engines. Stable track identity is
 * required; a matching image URL is insufficient. Full AA item + actual library
 * row are the only geometry endpoints. Mini-player rendering has another owner.
 *
 * Sources: S1 scene report shared geometry; PowerListSharedItemTransition.Х,
 * cy0.A87–158, h0.j/w/А and P.с; exact math lives in motion.js.
 * Remaining limits: native holder type compatibility is represented by a track
 * row with shared art/text children; native FastTextView metrics, scene-specific
 * child visibility/crop, and P.T/S's last-touched-item displacement are unresolved
 * browser parity boundaries. No claim of captured Android visual equivalence.
 */
export class SceneRenderer {
  constructor({ artOwner, artFrame, title, secondary, artActions, libraryHost,
    getGeometry, getTrackId, library, getTarget = () => 1, getRoute = () => 'tap',
    pixelRatio = () => globalThis.devicePixelRatio || 1 }) {
    Object.assign(this, { artOwner, artFrame, title, secondary, artActions, libraryHost,
      getGeometry, getTrackId, library, getTarget, getRoute, pixelRatio });
    this.snapshot = null;
    this.dirty = true;
    this.wasActive = false;
    this.destroyed = false;
    this.gaps = [
      'FastTextView native font metrics and child crop/visibility scenes remain caller-dependent.',
      'P.T/S last-touched-item displacement is not modeled; matched tap trajectory remains conditional.',
      'Radius interpolation uses caller endpoints; native rounded-outline interpolation is unverified.',
    ];
  }

  invalidate() { this.dirty = true; }

  _restoreRows() {
    for (const row of this.snapshot?.rows || []) Object.assign(row.element.style, row.saved);
    for (const part of this.snapshot?.chrome || []) part.element.style.opacity = part.opacity;
  }

  _restoreArtwork(geometry = this.getGeometry()) {
    if (!geometry) return;
    place(this.artFrame, geometry.art);
    place(this.title, geometry.title);
    place(this.secondary, geometry.secondary);
    if (this.artFrame) {
      this.artFrame.style.borderRadius = `${geometry.art.radius || 0}px`;
      this.artFrame.style.transform = '';
      this.artFrame.style.opacity = '';
    }
    for (const element of [this.title, this.secondary, this.artActions]) {
      if (element) { element.style.transform = ''; element.style.opacity = ''; }
    }
  }

  _capture(geometry) {
    this._restoreRows();
    this._restoreArtwork(geometry);
    this.artOwner.style.transform = '';
    this.artOwner.style.opacity = '';
    this.libraryHost.style.opacity = '1';
    const elements = [...(this.library.list?.children || [])];
    const trackId = this.getTrackId();
    const entries = this.library.entries || [];
    const rows = elements.map((element, index) => ({ ...rectOf(element), element, index,
      saved: saveStyles(element, rowProperties), entry: entries[index] })).filter(valid);
    const matched = rows.find(row => row.entry?.kind === 'track' && row.entry.track?.id === trackId);
    const art = matched?.element.querySelector('.pa-lib-art');
    const targetArt = rectOf(art);
    const targetTitle = rectOf(matched?.element.querySelector('.pa-lib-row-title'));
    const targetSecondary = rectOf(matched?.element.querySelector('.pa-lib-row-subtitle'));
    const source = { item: { ...geometry.item }, children: {
      art: { ...geometry.art }, title: { ...geometry.title },
      ...(geometry.secondary?.visible !== false ? { secondary: { ...geometry.secondary } } : {}),
    } };
    const children = {};
    if (valid(targetArt)) children.art = { ...targetArt,
      radius: parseFloat(globalThis.getComputedStyle?.(art)?.borderTopLeftRadius) || 0 };
    if (valid(targetTitle)) children.title = targetTitle;
    if (valid(targetSecondary)) children.secondary = targetSecondary;
    // Hidden/no-art list layouts cannot serve as a visible artwork holder here.
    const shared = matched && valid(targetArt) && valid(geometry.item);
    const columns = Number(this.library.element?.style.getPropertyValue?.('--pa-lib-columns')) || 1;
    const chromeElements = [
      ...[...(this.library.element?.children || [])].filter(element => element !== this.library.scroll && element !== this.library.overlay),
      ...[...(this.library.list?.parentElement?.children || [])].filter(element => element !== this.library.list),
    ];
    const chrome = [...new Set(chromeElements)].map(element => ({ element, opacity: element.style.opacity || '' }));
    this.snapshot = { source, target: shared ? { item: matched, children } : null,
      rows, matched, trackId, columns, viewport: rectOf(this.libraryHost),
      elements, entries, chrome, route: this.getRoute(), toLibrary: Boolean(this.getTarget()), hasProgress: false };
    this.dirty = false;
  }

  apply(values) {
    if (this.destroyed) return;
    const geometry = this.getGeometry();
    if (!geometry) return;
    const p = clamp(values.list), active = Boolean(values.active);
    const elements = [...(this.library.list?.children || [])];
    const changedRows = this.snapshot && (elements.length !== this.snapshot.elements.length
      || elements.some((element, index) => element !== this.snapshot.elements[index]));
    if (this.dirty || !this.snapshot || changedRows || this.snapshot.trackId !== this.getTrackId()
      || (active && !this.wasActive)) this._capture(geometry);
    this.wasActive = active;
    const snapshot = this.snapshot;
    this.libraryHost.style.opacity = '1';
    if (!active && (p === 0 || p === 1)) {
      this._restoreRows();
      this._restoreArtwork(geometry);
      this.artOwner.style.opacity = String(1 - p);
      this.artOwner.style.transform = `translateX(${(values.art || 0) * geometry.art.width}px)`;
      return;
    }

    if (!snapshot.hasProgress && p > 0 && p < 1) {
      snapshot.route = this.getRoute();
      snapshot.toLibrary = Boolean(this.getTarget());
      snapshot.hasProgress = true;
    }
    const route = snapshot.route;
    // Shared-move (direct artwork drag) configures h0.с with .5 and viewport
    // center, not the matched-row ratio of the tap shared-item transition.
    const list = snapshot.target && route !== 'gesture'
      ? sharedListFrame({ progress: p, artworkItem: snapshot.source.item, matchedRow: snapshot.target.item,
        rows: snapshot.rows, columns: snapshot.columns, matchedIndex: snapshot.matched.index, pixelRatio: this.pixelRatio() })
      : genericListFrame({ progress: p, viewport: snapshot.viewport, rows: snapshot.rows,
        toLibrary: route === 'gesture' ? true : snapshot.toLibrary, pixelRatio: this.pixelRatio() });
    for (const row of list?.rows || []) {
      Object.assign(row.element.style, { transform: row.transform, transformOrigin: row.transformOrigin,
        opacity: String(row.alpha), visibility: row.saved.visibility });
    }
    // Headers/chrome are not children of native h0's item engine. Their scene
    // geometry is a separate boundary; retain a bounded alpha bridge there.
    for (const part of snapshot.chrome) part.element.style.opacity = String(p);

    if (snapshot.target) {
      const frame = sharedItemFrame({ progress: p, source: snapshot.source, target: snapshot.target, pixelRatio: this.pixelRatio() });
      snapshot.matched.element.style.visibility = 'hidden'; // one visible holder; restored at either endpoint
      this.artOwner.style.opacity = String(frame.item.alpha);
      this.artOwner.style.transform = `translateX(${(values.art || 0) * geometry.art.width}px)`;
      for (const [key, element] of [['art', this.artFrame], ['title', this.title], ['secondary', this.secondary]]) {
        const child = frame.children[key];
        if (!child || !element) continue;
        place(element, child);
        element.style.opacity = String(child.alpha);
        // Geometry already represents the visible art rectangle; do not apply
        // the source AA playing scale a second time on top of those bounds.
        element.style.transform = '';
        if (key === 'art') element.style.borderRadius = `${child.radius}px`;
      }
      if (this.artActions) this.artActions.style.opacity = String(1 - p);
    } else {
      this._restoreArtwork(geometry);
      const artwork = list?.artwork || { scale: 1, alpha: 1 - p };
      this.artOwner.style.opacity = String(artwork.alpha);
      const item = geometry.item;
      this.artOwner.style.transformOrigin = `${item.x + item.width / 2}px ${item.y + item.height / 2}px`;
      this.artOwner.style.transform = `translateX(${(values.art || 0) * geometry.art.width}px) scale(${artwork.scale})`;
    }
  }

  destroy() {
    this._restoreRows();
    this._restoreArtwork();
    this.artOwner.style.transform = '';
    this.artOwner.style.transformOrigin = '';
    this.artOwner.style.opacity = '';
    this.libraryHost.style.opacity = '';
    this.destroyed = true;
    this.snapshot = null;
  }
}
