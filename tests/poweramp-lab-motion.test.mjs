import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneMotion } from '../frontend/poweramp-lab/motion.js';

class Surface extends EventTarget {
  constructor({ interactive = false } = {}) {
    super();
    this.style = { touchAction: '' };
    this.interactive = interactive;
    this.captured = new Set();
  }
  closest() { return this.interactive ? this : null; }
  getBoundingClientRect() { return { width: 400, height: 400 }; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}

function harness(options = {}) {
  let now = 0, serial = 0;
  const scheduled = new Map(), frames = [], settled = [];
  const root = new EventTarget(), lifecycle = new EventTarget();
  const motion = new SceneMotion({
    onFrame: values => frames.push(values),
    onSettle: (target, values) => settled.push({ target, values }),
    getHeight: () => 400,
    now: () => now,
    requestFrame: callback => { scheduled.set(++serial, callback); return serial; },
    cancelFrame: handle => scheduled.delete(handle),
    eventRoot: root, lifecycleTarget: lifecycle,
    ...options,
  });
  return { motion, root, lifecycle, frames, settled, scheduled,
    advance(ms = 0) {
      now += ms;
      const pending = [...scheduled.values()];
      scheduled.clear();
      for (const callback of pending) callback(now);
    },
    elapse(ms) { now += ms; },
  };
}

function pointer(surface, type, { x = 100, y = 100, id = 1, primary = true, target = surface, root } = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: id, isPrimary: primary, button: 0 });
  if (target !== surface) Object.defineProperty(event, 'target', { value: target });
  if (type === 'pointerdown' && root) {
    const capture = new Event(type);
    Object.assign(capture, { pointerId: id });
    root.dispatchEvent(capture);
  }
  surface.dispatchEvent(event);
  return event;
}

function click(surface, detail = 1, target = surface) {
  const event = new Event('click', { cancelable: true });
  Object.assign(event, { detail });
  if (target !== surface) Object.defineProperty(event, 'target', { value: target });
  surface.dispatchEvent(event);
  return event;
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test('tap list/top/navbar advance on independent clocks and settle once after last owner', () => {
  const h = harness();
  h.motion.to(1);
  h.advance(); // First frame starts all clocks, not elapsed request time.
  h.advance(125);
  close(h.motion.values.list, 0.5);
  close(h.motion.values.top, 0.9375);
  close(h.motion.values.nav, 1 - 0.75 ** 4);
  h.advance(125);
  close(h.motion.values.list, 1);
  close(h.motion.values.top, 1);
  assert.ok(h.motion.values.nav < 1);
  assert.equal(h.settled.length, 0);
  h.advance(250);
  assert.equal(h.settled.length, 1);
  assert.equal(h.settled[0].target, 1);
  assert.equal(h.settled[0].values.active, false);
  assert.equal(h.scheduled.size, 0);
});

test('mini expansion keeps the 250ms list and separate 500ms top/navbar clocks', () => {
  const h = harness({ reducedMotion: () => true });
  h.motion.to(1);
  h.motion._reducedMotion = () => false;
  h.motion.to(0, { route: 'mini' });
  h.advance();
  h.advance(125);
  close(h.motion.values.list, 0.5);
  close(h.motion.values.top, 0.75 ** 4);
  close(h.motion.values.nav, h.motion.values.top);
  h.advance(125);
  close(h.motion.values.list, 0);
  assert.ok(h.motion.values.top > 0);
  h.advance(250);
  assert.equal(h.settled.at(-1).target, 0);
});

test('reversal snapshots every painted owner without jumping or completing the obsolete target', () => {
  const h = harness();
  h.motion.to(1);
  h.advance();
  h.advance(100);
  const interrupted = h.motion.values;
  h.motion.to(0, { route: 'mini' });
  assert.deepEqual(h.motion.values, interrupted);
  h.advance();
  assert.deepEqual(h.motion.values, interrupted);
  h.advance(100);
  assert.ok(h.motion.values.list < interrupted.list);
  assert.ok(h.motion.values.top < interrupted.top);
  assert.ok(h.motion.values.nav < interrupted.nav);
  h.advance(500);
  assert.deepEqual(h.settled.map(value => value.target), [0]);
});

test('explicit cancellation freezes scene values, cancels scheduled work and emits no stale completion', () => {
  const h = harness();
  const reasons = [];
  h.motion.addEventListener('cancel', event => reasons.push(event.detail.reason));
  h.motion.to(1);
  h.advance();
  h.advance(150);
  const before = h.motion.values;
  h.motion.cancel('trackchange');
  assert.deepEqual(h.motion.values, { ...before, active: false });
  h.advance(1000);
  assert.equal(h.settled.length, 0);
  assert.deepEqual(reasons, ['trackchange']);
  h.motion.to(0);
  h.advance();
  h.advance(600);
  assert.equal(h.motion.values.list, 0);
});

test('downward artwork drag owns list/top progress; CANCEL above .3 commits at zero velocity', () => {
  const h = harness();
  const surface = new Surface();
  h.motion.attachArtwork(surface);
  pointer(surface, 'pointerdown', { root: h.root });
  pointer(surface, 'pointermove', { y: 268 }); // (168 - slop8) / 400 = .4
  close(h.motion.values.list, 0.4);
  close(h.motion.values.top, 0.4);
  close(h.motion.values.nav, 0);
  pointer(surface, 'pointercancel', { y: 268 });
  assert.equal(h.motion.target, 1);
  assert.equal(surface.captured.size, 0);
  h.advance();
  h.advance(75); // remaining .6 *250 =150ms, halfway cosine
  close(h.motion.values.list, 0.7);
  close(h.motion.values.top, 0.7);
  h.advance(500);
  assert.equal(h.settled.at(-1).target, 1);
});

test('slow progress exactly .3 cancels; retained negative velocity can cancel a larger drag', () => {
  const h = harness();
  const surface = new Surface();
  h.motion.attachArtwork(surface);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { y: 228 });
  close(h.motion.progress, 0.3);
  pointer(surface, 'pointercancel', { y: 228 });
  assert.equal(h.motion.target, 0);
  h.advance();
  h.advance(500);
  pointer(surface, 'pointerdown', { y: 100 });
  h.elapse(100);
  pointer(surface, 'pointermove', { y: 348 });
  h.elapse(30);
  pointer(surface, 'pointermove', { y: 288 });
  h.elapse(10);
  pointer(surface, 'pointerup', { y: 268 });
  assert.ok(h.motion.progress > 0.3);
  assert.equal(h.motion.target, 0);
  h.advance();
  h.advance(25);
  // -2000px/s /400 => -5 progress/s, no guessed spring/easing.
  close(h.motion.progress, 0.45 - 0.125);
});

test('vertical acquisition rejects upward lyrics path and horizontal displaced artwork', () => {
  const h = harness();
  const surface = new Surface();
  let taps = 0;
  h.motion.attachArtwork(surface, { onTap: () => taps++ });
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { y: 50 });
  pointer(surface, 'pointerup', { y: 50 });
  close(h.motion.progress, 0);
  assert.equal(taps, 0);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { x: 180 });
  pointer(surface, 'pointerup', { x: 180 });
  assert.ok(h.motion.values.art > 0.05);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { y: 300 });
  pointer(surface, 'pointerup', { y: 300 });
  close(h.motion.progress, 0);
});

test('art page selects once on release, rebases incoming page and cubic-settles independently', () => {
  const h = harness();
  const surface = new Surface();
  const changes = [];
  h.motion.attachArtwork(surface, { onNext: info => changes.push(info) });
  pointer(surface, 'pointerdown', { x: 300 });
  pointer(surface, 'pointermove', { x: 132 });
  close(h.motion.values.art, -0.4);
  pointer(surface, 'pointercancel', { x: 132 }); // zero-velocity CANCEL still selects at .4
  assert.deepEqual(changes, [{ source: 'artwork', gesture: true }]);
  close(h.motion.values.art, 0.6);
  h.advance();
  h.advance(325);
  close(h.motion.values.art, 0.6 * 0.125);
  close(h.motion.progress, 0);
  h.advance(325);
  close(h.motion.values.art, 0);
  assert.equal(changes.length, 1);
});

test('horizontal regrab preserves offset and track change during callback invalidates stale settle', () => {
  const h = harness();
  const surface = new Surface();
  let count = 0;
  h.motion.attachArtwork(surface, { onNext: () => { count++; h.motion.cancel('trackchange'); } });
  pointer(surface, 'pointerdown', { x: 300 });
  pointer(surface, 'pointermove', { x: 252 }); // -.1 snaps back, no track selection.
  pointer(surface, 'pointercancel');
  h.advance();
  h.advance(100);
  const before = h.motion.values.art;
  pointer(surface, 'pointerdown', { x: 300 });
  close(h.motion.values.art, before);
  h.advance(400);
  close(h.motion.values.art, before);
  pointer(surface, 'pointermove', { x: 100 });
  pointer(surface, 'pointercancel');
  assert.equal(count, 1);
  close(h.motion.values.art, 0);
  assert.equal(h.scheduled.size, 0);
});

test('second pointer releases ownership once and stale pointer UP cannot trigger an artwork tap', () => {
  const h = harness();
  const surface = new Surface();
  let taps = 0;
  h.motion.attachArtwork(surface, { onTap: () => taps++ });
  pointer(surface, 'pointerdown', { root: h.root });
  pointer(surface, 'pointermove', { y: 268 });
  pointer(surface, 'pointerdown', { id: 2, primary: false, root: h.root });
  assert.equal(surface.captured.size, 0);
  pointer(surface, 'pointerup');
  pointer(surface, 'pointerup', { id: 2, primary: false });
  h.advance();
  h.advance(500);
  assert.equal(taps, 0);
  assert.deepEqual(h.settled.map(value => value.target), [1]);
});

test('mini tap expands, vertical swipe does not; nested control never acquires parent ownership', () => {
  const h = harness({ reducedMotion: () => true });
  const surface = new Surface(), button = new Surface({ interactive: true });
  h.motion.attachMini(surface);
  h.motion.to(1);
  pointer(surface, 'pointerdown', { target: button });
  pointer(surface, 'pointermove', { y: 300, target: button });
  pointer(surface, 'pointerup', { target: button });
  assert.equal(surface.captured.size, 0);
  close(h.motion.progress, 1);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { y: 50 });
  pointer(surface, 'pointerup', { y: 50 });
  close(h.motion.progress, 1);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointerup');
  close(h.motion.progress, 0);
});

test('owned release suppresses moved-target compatibility click while allowing next contact and keyboard', () => {
  const h = harness();
  const surface = new Surface();
  let taps = 0;
  h.motion.attachArtwork(surface, { onTap: () => taps++ });
  pointer(surface, 'pointerdown', { root: h.root });
  pointer(surface, 'pointermove', { x: 150 });
  pointer(surface, 'pointerup', { x: 150 });
  assert.equal(click(h.root).defaultPrevented, true);
  assert.equal(taps, 0);
  assert.equal(click(h.root, 0).defaultPrevented, false);
  pointer(surface, 'pointerdown', { root: h.root });
  pointer(surface, 'pointerup');
  assert.equal(taps, 1);
  assert.equal(click(h.root).defaultPrevented, true);
  click(surface, 0);
  assert.equal(taps, 2);
});

test('blur/resize/destroy invalidate contacts, timers and late callbacks', () => {
  const h = harness();
  const surface = new Surface();
  let taps = 0;
  h.motion.attachArtwork(surface, { onTap: () => taps++ });
  pointer(surface, 'pointerdown');
  h.lifecycle.dispatchEvent(new Event('blur'));
  pointer(surface, 'pointerup');
  assert.equal(taps, 0);
  h.motion.to(1);
  h.advance();
  h.advance(100);
  h.lifecycle.dispatchEvent(new Event('resize'));
  const before = h.motion.values;
  h.advance(1000);
  assert.deepEqual(h.motion.values, before);
  assert.equal(h.settled.length, 0);
  h.motion.destroy();
  assert.equal(surface.style.touchAction, '');
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointerup');
  h.motion.to(1);
  assert.equal(taps, 0);
  assert.equal(h.scheduled.size, 0);
});

test('reduced motion snaps every scene owner, and settlement callback may start another route safely', () => {
  const h = harness({ reducedMotion: () => true });
  h.motion.to(1);
  assert.deepEqual(h.motion.values, { list: 1, top: 1, nav: 1, art: 0, active: false });
  assert.equal(h.scheduled.size, 0);
  h.motion._reducedMotion = () => false;
  let calls = 0;
  h.motion._onSettle = target => { calls++; if (target === 0) h.motion.to(1); };
  h.motion.to(0);
  h.advance();
  h.advance(500);
  assert.equal(calls, 1);
  assert.equal(h.motion.target, 1);
  assert.ok(h.motion.active);
  h.advance();
  h.advance(500);
  assert.equal(calls, 2);
  assert.equal(h.motion.values.list, 1);
});

test('animation-speed fast scales tap clocks; disabled mode retains a 300ms navbar clock', () => {
  let speed = 2;
  const h = harness({ getAnimationSpeed: () => speed });
  h.motion.to(1);
  h.advance();
  h.advance(75); // 250*.6 =150ms
  close(h.motion.values.list, 0.5);
  close(h.motion.values.top, 0.9375);
  close(h.motion.values.nav, 1 - 0.75 ** 4);
  h.advance(225);
  speed = 0;
  h.motion.to(0, { route: 'mini' });
  h.advance();
  h.advance(1);
  close(h.motion.values.list, 0);
  close(h.motion.values.top, 0);
  assert.ok(h.motion.values.nav > 0.9);
  assert.equal(h.motion.active, true);
  h.advance(299);
  close(h.motion.values.nav, 0);
  assert.equal(h.motion.active, false);
});

test('animation preference leaves raw manual-release list duration unchanged', () => {
  const h = harness({ getAnimationSpeed: () => 0 });
  const surface = new Surface();
  h.motion.attachArtwork(surface);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { y: 268 });
  pointer(surface, 'pointercancel', { y: 268 });
  h.advance();
  h.advance(75);
  close(h.motion.values.list, 0.7); // .6*250=150ms; not a disabled 1ms clock.
  close(h.motion.values.top, 0.7);
  close(h.motion.values.nav, 1 - 0.75 ** 4); // nav500*.6=300ms
});

test('horizontal fling residual correction finishes at zero without selecting another track', () => {
  const h = harness();
  const surface = new Surface();
  let changes = 0;
  h.motion.attachArtwork(surface, { onNext: () => changes++ });
  pointer(surface, 'pointerdown', { x: 300 });
  h.elapse(80);
  pointer(surface, 'pointermove', { x: 140 });
  h.elapse(20);
  pointer(surface, 'pointerup', { x: 100 });
  assert.equal(changes, 1);
  h.advance(650);
  assert.ok(h.motion.values.art < 0); // native extra travel is a separate residual, not a spring.
  assert.ok(h.motion.active);
  h.advance(250);
  close(h.motion.values.art, 0);
  assert.equal(h.motion.active, false);
  assert.equal(changes, 1);
});

test('keyboard activation on an accessible mini container preserves expansion', () => {
  const h = harness({ reducedMotion: () => true });
  const surface = new Surface({ interactive: true });
  h.motion.attachMini(surface);
  h.motion.to(1);
  click(surface, 0);
  close(h.motion.progress, 0);
});

test('gesture release continues an existing navbar clock instead of restarting it', () => {
  const h = harness();
  const surface = new Surface();
  h.motion.attachArtwork(surface);
  pointer(surface, 'pointerdown');
  pointer(surface, 'pointermove', { y: 268 });
  h.advance();
  h.advance(200);
  pointer(surface, 'pointercancel', { y: 268 });
  h.advance();
  h.advance(150);
  close(h.motion.values.nav, 1 - 0.3 ** 4);
});

const { sharedListFrame, genericListFrame, sharedItemFrame } = await import('../frontend/poweramp-lab/motion.js');
const { SceneRenderer } = await import('../frontend/poweramp-lab/scene-renderer.js');

test('matched list pivot uses full item/row heights and shifts different row centers independently', () => {
  const artworkItem = { x: 0, y: 0, width: 400, height: 400 };
  const matchedRow = { x: 0, y: 200, width: 400, height: 80 };
  const rows = [matchedRow, { ...matchedRow, y: 280 }];
  const frame = sharedListFrame({ progress: 0.5, artworkItem, matchedRow, rows });
  close(frame.ratio, 5);
  assert.deepEqual(frame.pivot, { x: 0, y: 248 });
  assert.deepEqual(frame.rows.map(row => [row.translateX, row.translateY, row.scale, row.alpha]),
    [[400, -16, 3, 0.5], [400, 144, 3, 0.5]]);
  const end = sharedListFrame({ progress: 1, artworkItem, matchedRow, rows });
  assert.ok(end.rows.every(row => row.translateX === 0 && row.translateY === 0 && row.scale === 1 && row.alpha === 1));
});

test('shared grid pivot picks center or conditional outer edge; invalid correspondence is rejected', () => {
  const artworkItem = { x: 0, y: 0, width: 400, height: 400 };
  const matchedRow = { x: 200, y: 200, width: 200, height: 120 };
  const input = { progress: 0.5, artworkItem, matchedRow, rows: [matchedRow], columns: 2, matchedIndex: 1 };
  assert.equal(sharedListFrame(input).pivot.x, 300);
  assert.equal(sharedListFrame({ ...input, edgePivot: true }).pivot.x, 400);
  assert.equal(sharedListFrame({ ...input, matchedRow: null }), null);
});

test('unmatched forward pivot differs on outgoing and incoming main routes', () => {
  const viewport = { x: 0, y: 0, width: 400, height: 800 };
  const rows = [{ x: 0, y: 0, width: 400, height: 80 }];
  const out = genericListFrame({ progress: 0.5, viewport, rows, toLibrary: true });
  const back = genericListFrame({ progress: 0.5, viewport, rows, toLibrary: false });
  close(out.rows[0].scale, 0.75);
  close(back.rows[0].scale, 1.25);
  close(out.artwork.scale, 1.125);
  close(back.artwork.scale, 0.875);
});

test('one shared holder retains opacity while holder and local child bounds interpolate separately', () => {
  const source = { item: { x: 100, y: 100, width: 400, height: 400 }, children: {
    art: { x: 108, y: 108, width: 384, height: 384 },
    rating: { x: 110, y: 440, width: 90, height: 20 },
  } };
  const target = { item: { x: 0, y: 400, width: 400, height: 80 }, children: {
    art: { x: 12, y: 408, width: 64, height: 64 },
  } };
  const frame = sharedItemFrame({ progress: 0.5, source, target });
  assert.deepEqual(frame.item, { x: 50, y: 250, width: 400, height: 240, alpha: 1, scaleX: 1, scaleY: 1 });
  assert.deepEqual(frame.children.art, { x: 60, y: 258, width: 224, height: 224, alpha: 1, scaleX: 1, scaleY: 1, radius: 0 });
  close(frame.children.rating.alpha, 0.5);
  assert.equal(sharedItemFrame({ progress: 0.5, source, target: null }), null);
});

class RenderNode {
  constructor(rect = { x: 0, y: 0, width: 400, height: 800 }) {
    this.rect = rect;
    this.style = {};
    this.children = [];
    this.parts = {};
    this.reads = 0;
  }
  getBoundingClientRect() { this.reads++; return this.rect; }
  querySelector(name) { return this.parts[name] || null; }
}

function rendererHarness(match = true) {
  const item = { x: 0, y: 0, width: 400, height: 400 };
  const geometry = { item, art: { x: 8, y: 8, width: 384, height: 384, radius: 18 },
    title: { x: 18, y: 330, width: 360, height: 20 }, secondary: { x: 18, y: 352, width: 360, height: 16 } };
  const artOwner = new RenderNode(), artFrame = new RenderNode(geometry.art), title = new RenderNode(geometry.title);
  const secondary = new RenderNode(geometry.secondary), artActions = new RenderNode(), libraryHost = new RenderNode();
  const row = new RenderNode({ x: 0, y: 200, width: 400, height: 80 });
  row.parts = {
    '.pa-lib-art': new RenderNode({ x: 12, y: 208, width: 64, height: 64 }),
    '.pa-lib-row-title': new RenderNode({ x: 96, y: 212, width: 250, height: 20 }),
    '.pa-lib-row-subtitle': new RenderNode({ x: 96, y: 240, width: 250, height: 16 }),
  };
  const list = new RenderNode(), scroll = new RenderNode(), element = new RenderNode(), header = new RenderNode();
  list.children = [row]; list.parentElement = scroll; scroll.children = [list]; element.children = [header, scroll];
  const library = { list, scroll, element, entries: [{ kind: 'track', track: { id: match ? 'current' : 'other' } }] };
  let target = 1;
  const renderer = new SceneRenderer({ artOwner, artFrame, title, secondary, artActions, libraryHost,
    getGeometry: () => geometry, getTrackId: () => 'current', library, getTarget: () => target, pixelRatio: () => 1 });
  return { renderer, row, artOwner, artFrame, header, library, geometry, setTarget: value => { target = value; } };
}

test('DOM renderer keeps one matched holder, snapshots once across reversal and restores endpoint ownership', () => {
  const h = rendererHarness();
  h.renderer.apply({ list: 0, art: 0, active: true });
  h.renderer.apply({ list: 0.5, art: 0, active: true });
  assert.equal(h.row.style.visibility, 'hidden');
  assert.equal(h.artOwner.style.opacity, '1');
  const reads = h.row.reads;
  const previous = h.artFrame.style.top;
  h.setTarget(0);
  h.renderer.apply({ list: 0.5, art: 0, active: true });
  assert.equal(h.artFrame.style.top, previous);
  assert.equal(h.row.reads, reads);
  h.renderer.apply({ list: 0, art: 0, active: false });
  assert.equal(h.row.style.visibility, '');
  assert.equal(h.row.style.transform, '');
  assert.equal(h.artFrame.style.top, '8px');
  assert.equal(h.header.style.opacity, '');
});

test('unmatched DOM renderer uses a pivot and retains its trajectory on reversal', () => {
  const h = rendererHarness(false);
  h.renderer.apply({ list: 0.5, art: 0, active: true });
  assert.match(h.artOwner.style.transform, /scale\(1\.125\)/);
  const transform = h.artOwner.style.transform;
  h.setTarget(0);
  h.renderer.apply({ list: 0.5, art: 0, active: true });
  assert.equal(h.artOwner.style.transform, transform);
  h.renderer.destroy();
  assert.equal(h.row.style.transform, '');
  assert.equal(h.artOwner.style.opacity, '');
});
