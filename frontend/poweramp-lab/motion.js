/**
 * Independent reconstruction of PA1031 motion contracts, not Android source.
 * S1 scene report: i22.O/do1/ao1, x32/w32, NavbarExtension.t1.
 * S1 G01–G10/G25: j0/w input ownership and PowerListTransitionBase.A (smali).
 * Initialized main↔library routes only; native cold-process +350ms,
 * lyrics-up, category overscroll and provider-replacement pivots are separate.
 */
const EPSILON = 0.0001;
const clamp = (n, low = 0, high = 1) => Math.min(high, Math.max(low, n));
const cosine = t => (1 - Math.cos(Math.PI * t)) / 2;
const decelerate2 = t => 1 - (1 - t) ** 4;
const cubicOut = t => 1 - (1 - t) ** 3;
const interactive = 'button,a,input,select,textarea,[role="button"],[role="slider"],[contenteditable="true"],[data-motion-ignore]';
const detailEvent = (type, detail) => Object.assign(new Event(type), { detail });

export class SceneMotion extends EventTarget {
  constructor({ onFrame = () => {}, onSettle = () => {}, reducedMotion = () => false,
    getHeight = () => globalThis.innerHeight || 1, getAnimationSpeed = () => 1,
    // Android supplies ViewConfiguration slop/density/velocity history. CSS px
    // approximate dp here; 8px slop and 100ms history are explicit web adaptations.
    touchSlop = 8, pixelsPerDp = 1,
    requestFrame = callback => globalThis.requestAnimationFrame(callback),
    cancelFrame = handle => globalThis.cancelAnimationFrame(handle),
    now = () => performance.now(), eventRoot = globalThis.document,
    lifecycleTarget = globalThis.window } = {}) {
    super();
    this._onFrame = onFrame;
    this._onSettle = onSettle;
    this._reducedMotion = reducedMotion;
    this._height = getHeight;
    this._animationSpeed = getAnimationSpeed;
    this._slop = touchSlop;
    this._density = pixelsPerDp;
    this._requestFrame = requestFrame;
    this._cancelFrame = cancelFrame;
    this._now = now;
    this._root = eventRoot;
    this._lifecycle = lifecycleTarget;
    this._v = { list: 0, top: 0, nav: 0, art: 0 };
    this._clocks = new Map();
    this._attachments = new Set();
    this._frameHandle = null;
    this._contact = null;
    this._suppressClick = false;
    this._generation = 0;
    this._pendingSettle = null;
    this._target = 0;
    this._route = 'tap';
    this._destroyed = false;
    this._trackCallbacks = {};
    this._tick = timestamp => this._frame(timestamp);
    this._globalDown = event => {
      if (this._contact && event.pointerId !== this._contact.id) {
        // Browser adaptation: abandon multi-contact ownership, then zero-velocity
        // settle. Native j0 can delegate pinch; this surface has no pinch owner.
        this._endPointer(event, true, true);
      } else if (!this._contact) this._suppressClick = false;
    };
    this._globalClick = event => {
      if (this._suppressClick && event.detail !== 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._suppressClick = false;
      }
    };
    this._blur = () => this.cancel('blur');
    this._resize = () => this.cancel('resize');
    this._root?.addEventListener('pointerdown', this._globalDown, true);
    this._root?.addEventListener('click', this._globalClick, true);
    this._lifecycle?.addEventListener('blur', this._blur);
    this._lifecycle?.addEventListener('resize', this._resize);
  }

  get values() { return { ...this._v, active: this.active }; }
  get progress() { return this._v.list; }
  get target() { return this._target; }
  get route() { return this._route; }
  get active() { return Boolean(this._contact || this._clocks.size); }

  /** Velocity is signed CSS pixels/second (positive toward library). */
  to(target, { route = 'tap', velocity = 0 } = {}) {
    if (this._destroyed) return;
    target = target ? 1 : 0;
    this._dropContact();
    this._generation += 1;
    this._target = target;
    this._route = route;
    this._pendingSettle = this._generation;
    const existingNav = route === 'gesture' && this._clocks.get('nav')?.target === target
      ? this._clocks.get('nav') : null;
    for (const name of ['list', 'top', 'nav']) this._clocks.delete(name);
    if (this._reducedMotion()) {
      this._v.list = this._v.top = this._v.nav = target;
      this._paint();
      this._completeScene(this._generation);
      return;
    }

    const from = this._v.list;
    const gesture = route === 'gesture';
    // om0 manual-release fields are raw. p31 tap dispatch applies AnimTimeHelper.
    const nominal = gesture ? (target === 0 ? 500 : 250) : this._duration(250);
    let duration = nominal;
    if (from > 0 && from < 1) {
      duration = target === 1 ? Math.max(100, Math.round((1 - from) * nominal))
        : Math.max(Math.floor(nominal / 3), Math.round(from * nominal));
    }
    // Smali corrects the decompiler: zero velocity near the destination, retain
    // it elsewhere. x32's retained-velocity mode has zero acceleration.
    if ((target === 1 && from > 0.8) || (target === 0 && from < 0.2)) velocity = 0;
    let speed = gesture ? velocity / Math.max(1, this._height()) : 0;
    speed = target === 1 && speed > 0 ? clamp(speed, 1000 / nominal, 8)
      : target === 0 && speed < 0 ? clamp(speed, -8, -3.5) : 0;
    this._clock('list', target, duration, cosine, {
      speed,
      followTop: gesture ? this._v.top : undefined,
    });
    if (!gesture) this._clock('top', target, this._duration(target === 0 ? 500 : 250), decelerate2);
    else if (Math.abs(from - target) < EPSILON) this._v.top = target;
    if (existingNav) this._clocks.set('nav', existingNav);
    else this._clock('nav', target, this._duration(500, false), decelerate2);
    this._paint();
    this._schedule();
    if (!this._hasSceneClocks()) this._completeScene(this._generation);
  }

  attachArtwork(element, callbacks = {}) {
    this._trackCallbacks = callbacks;
    return this._attach(element, 'artwork', callbacks);
  }

  // S1 G25: mini expansion is a tap. Its paged artwork can move horizontally;
  // there is no proven mini vertical-expansion owner in the native ancestor chain.
  attachMini(element, callbacks = {}) { return this._attach(element, 'mini', callbacks); }

  /** Explicit teardown freezes painted scene values; it is not touch CANCEL. */
  cancel(reason = 'cancel') {
    if (this._destroyed) return;
    this._generation += 1;
    this._dropContact();
    this._clocks.clear();
    this._pendingSettle = null;
    this._v.art = 0;
    if (this._frameHandle !== null) this._cancelFrame(this._frameHandle);
    this._frameHandle = null;
    this._paint();
    this.dispatchEvent(detailEvent('cancel', { reason, target: this._target, values: this.values }));
  }

  destroy() {
    if (this._destroyed) return;
    this.cancel('destroy');
    this._destroyed = true;
    this._clocks.clear();
    if (this._frameHandle !== null) this._cancelFrame(this._frameHandle);
    this._frameHandle = null;
    for (const detach of [...this._attachments]) detach();
    this._root?.removeEventListener('pointerdown', this._globalDown, true);
    this._root?.removeEventListener('click', this._globalClick, true);
    this._lifecycle?.removeEventListener('blur', this._blur);
    this._lifecycle?.removeEventListener('resize', this._resize);
  }

  _duration(milliseconds, allowDisable = true) {
    // AnimTimeHelper: mode0 disables eligible clocks, but the private navbar
    // uses allowDisable=false. The native protected-preference gate is absent.
    const mode = Number(this._animationSpeed());
    return mode === 0 && allowDisable ? 1 : mode === 0 || mode === 2 ? milliseconds * 0.6 : milliseconds;
  }

  _clock(name, target, duration, ease, extra = {}) {
    if (Math.abs(this._v[name] - target) < EPSILON) {
      this._v[name] = target;
      this._clocks.delete(name);
      return;
    }
    this._clocks.set(name, { from: this._v[name], target, duration, ease, start: null, ...extra });
  }

  _schedule() {
    if (this._clocks.size && this._frameHandle === null && !this._destroyed) {
      this._frameHandle = this._requestFrame(this._tick);
    }
  }

  _frame(timestamp) {
    this._frameHandle = null;
    if (this._destroyed) return;
    const generation = this._generation;
    let correctArt = false;
    for (const [name, clock] of this._clocks) {
      clock.start ??= timestamp; // Native h5 starts on the first frame callback.
      const elapsed = Math.max(0, timestamp - clock.start);
      let fraction = clock.ease(clamp(elapsed / clock.duration));
      if (clock.speed) {
        const value = clock.from + clock.speed * elapsed / 1000;
        fraction = clamp((value - clock.from) / (clock.target - clock.from));
      }
      const done = clock.tolerance === 0 ? fraction >= 1 : fraction > 1 - EPSILON;
      this._v[name] = done ? clock.target : clock.from + (clock.target - clock.from) * fraction;
      if (clock.followTop !== undefined) {
        this._v.top = done ? clock.target : clock.followTop + (clock.target - clock.followTop) * fraction;
      }
      // Clear running ownership before final paint/callback (native h5.Н).
      if (done) {
        this._clocks.delete(name);
        if (name === 'art' && clock.correct) correctArt = true;
      }
    }
    if (correctArt) this._clock('art', 0, 250, cubicOut, { start: timestamp, tolerance: 0 });
    this._paint();
    if (!this._hasSceneClocks()) this._completeScene(generation);
    this._schedule();
  }

  _hasSceneClocks() { return ['list', 'top', 'nav'].some(name => this._clocks.has(name)); }

  _completeScene(generation) {
    if (this._pendingSettle !== generation || generation !== this._generation) return;
    this._pendingSettle = null;
    const target = this._target, values = this.values;
    this._onSettle(target, values);
    this.dispatchEvent(detailEvent('settle', { target, values }));
  }

  _paint() {
    const values = this.values;
    this._onFrame(values);
    this.dispatchEvent(detailEvent('frame', values));
  }

  _attach(element, kind, callbacks) {
    if (this._destroyed) return () => {};
    const oldTouchAction = element.style.touchAction;
    element.style.touchAction = kind === 'mini' ? 'pan-y' : 'none';
    const down = event => this._beginPointer(event, element, kind, callbacks);
    const move = event => this._movePointer(event);
    const up = event => this._endPointer(event, false);
    const cancel = event => this._endPointer(event, true);
    const lost = event => {
      if (this._contact?.id === event.pointerId) this._endPointer(event, true);
    };
    const click = event => {
      // Pointer activation is owned by UP; preserve keyboard/assistive click.
      const child = event.target.closest?.(interactive);
      if (event.detail === 0 && (!child || child === element)) this._activate(kind, callbacks);
    };
    const handlers = { pointerdown: down, pointermove: move, pointerup: up,
      pointercancel: cancel, lostpointercapture: lost, click };
    for (const [name, handler] of Object.entries(handlers)) element.addEventListener(name, handler);
    const detach = () => {
      if (this._contact?.element === element) this.cancel('detach');
      for (const [name, handler] of Object.entries(handlers)) element.removeEventListener(name, handler);
      element.style.touchAction = oldTouchAction;
      this._attachments.delete(detach);
    };
    this._attachments.add(detach);
    return detach;
  }

  _beginPointer(event, element, kind, callbacks) {
    if (this._destroyed || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    const child = event.target.closest?.(interactive);
    if (child && child !== element) return;
    if (this._contact) return;
    // Regrab stops AA-local settling without zeroing its offset (w.f → w.x).
    this._clocks.delete('art');
    this._contact = { id: event.pointerId, element, kind, callbacks,
      x: event.clientX, y: event.clientY, anchorX: event.clientX, anchorY: event.clientY,
      art: this._v.art, list: this._v.list, top: this._v.top, axis: null,
      samples: [{ x: event.clientX, y: event.clientY, t: this._now() }] };
    this._suppressClick = false;
    try { element.setPointerCapture(event.pointerId); } catch { /* Detached DOM contact. */ }
    this._paint();
  }

  _movePointer(event) {
    const contact = this._contact;
    if (!contact || event.pointerId !== contact.id) return;
    const x = event.clientX, y = event.clientY;
    const dx = x - contact.x, dy = y - contact.y;
    this._sample(contact, x, y);
    if (!contact.axis) {
      if (Math.abs(dx) <= this._slop && Math.abs(dy) <= this._slop) return;
      const vertical = Math.abs(dy) > Math.abs(dx); // Native ties are horizontal.
      if (vertical && (contact.kind === 'mini' || (dy < 0 && contact.list === 0) || Math.abs(contact.art) >= 0.05)) {
        contact.axis = 'ignored';
        this._suppressClick = true;
        return;
      }
      contact.axis = vertical ? 'vertical' : 'horizontal';
      contact.anchorX = contact.x + (Math.abs(dx) > this._slop ? Math.sign(dx) * this._slop : 0);
      contact.anchorY = contact.y + (Math.abs(dy) > this._slop ? Math.sign(dy) * this._slop : 0);
      this._suppressClick = true;
      if (vertical) {
        this._generation += 1;
        this._pendingSettle = null;
        this._clocks.delete('list');
        this._clocks.delete('top');
        // Snapshot painted state at acquisition; no new DOWN can jump a clock.
        contact.list = this._v.list;
        contact.top = this._v.top;
        this._target = 1;
        this._route = 'gesture';
        this._clock('nav', 1, this._duration(500, false), decelerate2);
        this._schedule();
      }
    }
    if (contact.axis === 'ignored') return;
    event.preventDefault();
    if (contact.axis === 'horizontal') {
      const width = Math.max(1, contact.element.getBoundingClientRect().width);
      this._v.art = clamp(contact.art + (x - contact.anchorX) / width, -1, 1);
    } else {
      const delta = (y - contact.anchorY) / Math.max(1, this._height());
      this._v.list = clamp(contact.list + delta);
      this._v.top = clamp(contact.top + this._v.list - contact.list);
    }
    this._paint();
  }

  _sample(contact, x, y) {
    const t = this._now();
    contact.samples.push({ x, y, t });
    while (contact.samples.length > 2 && contact.samples[1].t < t - 100) contact.samples.shift();
  }

  _velocity(contact, axis) {
    const last = contact.samples.at(-1);
    // A held finger loses velocity; do not reuse a stale fast MOVE on release.
    const first = contact.samples.find(sample => sample.t >= last.t - 100) || last;
    return last.t > first.t ? (last[axis] - first[axis]) * 1000 / (last.t - first.t) : 0;
  }

  _endPointer(event, cancelled, otherPointer = false) {
    const contact = this._contact;
    if (!contact || (!otherPointer && event.pointerId !== contact.id)) return;
    if (!cancelled) this._sample(contact, event.clientX, event.clientY);
    const vx = cancelled ? 0 : this._velocity(contact, 'x');
    const vy = cancelled ? 0 : this._velocity(contact, 'y');
    this._dropContact();
    this._suppressClick = true; // Consume the one compatibility click, including moved targets.
    if (contact.axis === 'vertical') {
      // Ordinary pointer CANCEL uses zero-velocity release, not rollback.
      const commit = Math.abs(vy / this._density) >= 500 ? vy > 0 : this._v.list > 0.3;
      this.to(commit ? 1 : 0, { route: 'gesture', velocity: vy });
    } else if (contact.axis === 'horizontal') this._settleArt(contact, vx);
    else if (!contact.axis && !cancelled) this._activate(contact.kind, contact.callbacks);
    this._paint();
  }

  _dropContact() {
    const contact = this._contact;
    if (!contact) return;
    this._contact = null; // lostpointercapture must not release a second time.
    this._suppressClick = true;
    try { contact.element.releasePointerCapture(contact.id); } catch { /* Already released. */ }
  }

  _activate(kind, callbacks) {
    if (kind === 'mini') this.to(0, { route: 'mini' });
    else callbacks.onTap?.();
  }

  _settleArt(contact, velocity) {
    const offset = this._v.art;
    const changesTrack = Math.abs(offset + velocity * 0.0001) >= 0.2;
    if (changesTrack) {
      const previous = offset > 0;
      const callback = contact.callbacks[previous ? 'onPrevious' : 'onNext']
        || this._trackCallbacks[previous ? 'onPrevious' : 'onNext'];
      if (callback) {
        this._v.art = offset + (previous ? -1 : 1);
        const generation = this._generation;
        callback({ source: contact.kind, gesture: true });
        if (generation !== this._generation || this._destroyed) return;
      }
    }
    // w.K NORMAL release → fh0 cubic-out, nominal .65s, opposing velocity
    // adds 20% speed. Its small extra travel is followed by u.run's separate
    // 250ms residual correction. No spring or generic list easing is substituted.
    const width = Math.max(1, contact.element.getBoundingClientRect().width);
    const offsetNow = this._v.art;
    const fraction = Math.abs(offsetNow) % 1;
    const extraSpeed = offsetNow * velocity < 0 ? Math.abs(velocity) * 0.2 : 0;
    const extraDistance = (velocity && fraction < 0.999 ? this._density * fraction : 0) + extraSpeed * 0.01;
    const distance = Math.abs(offsetNow) * width + extraDistance;
    const duration = distance ? distance / (distance / 0.65 + extraSpeed) * 1000 : 0;
    const destination = offsetNow - Math.sign(offsetNow) * distance / width;
    if (this._reducedMotion()) this._v.art = 0;
    else this._clock('art', destination, duration, cubicOut, {
      start: this._now(), tolerance: 0, correct: Math.abs(destination) >= EPSILON,
    });
    this._schedule();
  }
}

const validRect = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
  && rect.width > 0 && rect.height > 0;
const mix = (a, b, progress) => a + (b - a) * progress;
const pixelRound = (value, pixelRatio) => Math.floor(value * pixelRatio + 0.5) / pixelRatio;

function pivotRows(rows, pivot, ratio, progress, pixelRatio) {
  const fraction = 1 - clamp(progress), scale = 1 + (ratio - 1) * fraction;
  return rows.filter(validRect).map(row => {
    // h0.j mode4 truncates the final layout coordinate in physical pixels;
    // Android then scales the view around its own center, not the list center.
    const x = Math.trunc((row.x + (row.x + row.width / 2 - pivot.x) * (scale - 1)) * pixelRatio) / pixelRatio;
    const y = Math.trunc((row.y + (row.y + row.height / 2 - pivot.y) * (scale - 1)) * pixelRatio) / pixelRatio;
    const translateX = x - row.x, translateY = y - row.y;
    return { ...row, translateX, translateY, scale, alpha: 1 - fraction,
      transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`, transformOrigin: '50% 50%' };
  });
}

/**
 * Native matched-track list half of PowerListSharedItemTransition.Х + h0.j/w/А.
 * Input rectangles share one coordinate space and represent full ITEM/ROW boxes,
 * not image boxes. Caller establishes stable track correspondence and freezes
 * measurements before applying transforms; this function never uses mini bounds.
 */
export function sharedListFrame({ progress, artworkItem, matchedRow, rows = [], columns = 1,
  matchedIndex = 0, edgePivot = false, pixelRatio = 1 }) {
  if (!validRect(artworkItem) || !validRect(matchedRow)) return null;
  pixelRatio = Math.max(1, Number(pixelRatio) || 1);
  const ratio = artworkItem.height / matchedRow.height;
  let x = matchedRow.x;
  if (columns > 1) {
    const column = matchedIndex % columns;
    x = edgePivot && column === 0 ? matchedRow.x
      : edgePivot && column === columns - 1 ? matchedRow.x + matchedRow.width
      : Math.trunc((matchedRow.x + matchedRow.width / 2) * pixelRatio) / pixelRatio;
  }
  const rowCenter = matchedRow.y + matchedRow.height / 2;
  const artworkCenter = artworkItem.y + artworkItem.height / 2;
  const pivot = { x, y: rowCenter + (rowCenter - artworkCenter) / ratio };
  return { ratio, pivot, rows: pivotRows(rows, pivot, ratio, progress, pixelRatio) };
}

/**
 * p31.Z unmatched main↔ordinary list uses FORWARD generic pivot in both routes.
 * u31.A→h0.с uses .5 incoming /1.5 outgoing; P.с uses1.25 outgoing /.75 incoming.
 * This is a separate fallback from shared-holder correspondence, not a cover morph.
 */
export function genericListFrame({ progress, viewport, rows = [], toLibrary = true, pixelRatio = 1 }) {
  if (!validRect(viewport)) return null;
  const pivot = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  const ratio = toLibrary ? 0.5 : 1.5;
  return { ratio, pivot, rows: pivotRows(rows, pivot, ratio, progress, Math.max(1, Number(pixelRatio) || 1)),
    artwork: { scale: 1 + (toLibrary ? 0.25 : -0.25) * clamp(progress), alpha: 1 - clamp(progress) } };
}

function localRect(rect, parent) {
  return { x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height };
}

function interpolateEdges(source, target, progress, pixelRatio) {
  const x = pixelRound(mix(source.x, target.x, progress), pixelRatio);
  const y = pixelRound(mix(source.y, target.y, progress), pixelRatio);
  const right = pixelRound(mix(source.x + source.width, target.x + target.width, progress), pixelRatio);
  const bottom = pixelRound(mix(source.y + source.height, target.y + target.height, progress), pixelRatio);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Dual-layout holder bridge: cy0.A87–158 (smali216–678), AAItemView.о→do1.r.
 * The holder interpolates translation and size; its child scene interpolates
 * local edges separately. One holder stays opaque when both endpoint alphas1.
 * Browser-measured text/crop/radius endpoints are caller data, not proof of
 * native font metrics or renderer parity. Missing children fade at their known
 * endpoint instead of inventing unseen destination geometry.
 */
export function sharedItemFrame({ progress, source, target, pixelRatio = 1 }) {
  if (!validRect(source?.item) || !validRect(target?.item)) return null;
  progress = clamp(progress);
  pixelRatio = Math.max(1, Number(pixelRatio) || 1);
  const roundMix = (a, b) => pixelRound(mix(a, b, progress), pixelRatio);
  // cy0 interpolates width/height independently, rather than deriving them
  // from rounded absolute edges (the nested do1 child path does the latter).
  const item = {
    x: roundMix(source.item.x, target.item.x), y: roundMix(source.item.y, target.item.y),
    width: roundMix(source.item.width, target.item.width), height: roundMix(source.item.height, target.item.height),
    alpha: mix(source.item.alpha ?? 1, target.item.alpha ?? 1, progress),
    scaleX: mix(source.item.scaleX ?? 1, target.item.scaleX ?? 1, progress),
    scaleY: mix(source.item.scaleY ?? 1, target.item.scaleY ?? 1, progress),
  };
  const children = {};
  for (const key of new Set([...Object.keys(source.children || {}), ...Object.keys(target.children || {})])) {
    const a = source.children?.[key], b = target.children?.[key];
    if (!validRect(a) && !validRect(b)) continue;
    const start = validRect(a) ? a : b, end = validRect(b) ? b : a;
    const startParent = validRect(a) ? source.item : target.item;
    const endParent = validRect(b) ? target.item : source.item;
    const rect = interpolateEdges(localRect(start, startParent), localRect(end, endParent), progress, pixelRatio);
    children[key] = { x: item.x + rect.x, y: item.y + rect.y, width: rect.width, height: rect.height,
      alpha: mix(validRect(a) ? a.alpha ?? 1 : 0, validRect(b) ? b.alpha ?? 1 : 0, progress),
      scaleX: mix(start.scaleX ?? start.scale ?? 1, end.scaleX ?? end.scale ?? 1, progress),
      scaleY: mix(start.scaleY ?? start.scale ?? 1, end.scaleY ?? end.scale ?? 1, progress),
      radius: mix(start.radius ?? 0, end.radius ?? 0, progress),
    };
  }
  return { item, children };
}
