import test from 'node:test';
import assert from 'node:assert/strict';
import { Waveform, Backdrop, resamplePeaks, waveGeometry, computeArtCrop, gradientStops,
  applyBackdropGradient, blurOffsets, processBackdropPixels } from '../frontend/poweramp-lab/graphics.js';

class Context {
  constructor(canvas) { this.canvas = canvas; this.calls = []; this.data = null; }
  setTransform() {} save() {} restore() {} beginPath() {} closePath() {} clip() {} lineTo() {}
  rect() {} moveTo() {} ellipse(...args) { this.calls.push(['ellipse', ...args]); }
  roundRect(...args) { this.calls.push(['roundRect', ...args]); }
  clearRect() { this.calls.length = 0; }
  fill() { this.calls.push(['fill', this.fillStyle, this.globalAlpha]); }
  fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); }
  drawImage(image, ...args) {
    this.calls.push(['image', image, ...args]);
    this.color = image.color || image.context?.color || [50, 100, 150, 255];
    this.data = image.context?.data || null;
  }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) {
    const result = this.createImageData(w, h);
    if (this.data?.length === result.data.length) result.data.set(this.data);
    else for (let i = 0; i < result.data.length; i += 4) result.data.set(this.color || [0, 0, 0, 255], i);
    return result;
  }
  putImageData(value) { this.data = value.data; }
}
class Canvas {
  constructor(w = 360, h = 120) {
    this.rect = { left: 0, top: 0, width: w, height: h };
    this.width = w; this.height = h; this.style = {}; this.listeners = new Map();
    this.context = new Context(this); this.capture = null;
    this.ownerDocument = { createElement: () => new Canvas() };
  }
  getBoundingClientRect() { return this.rect; }
  getContext() { return this.context; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
  event(type, x, y = 60, id = 1) {
    this.listeners.get(type)?.({ type, clientX: x, clientY: y, pointerId: id, button: 0, preventDefault() {} });
  }
}
function waveform(mode = 'scroll', extras = {}) {
  const canvas = new Canvas();
  const state = { time: 50, duration: 100, peaks: Float32Array.from({ length: 100 }, (_, i) => i / 100),
    mode, trackId: 'a', reducedMotion: true, ...extras };
  const seeks = [], previews = [];
  const view = new Waveform(canvas, { getState: () => state, onSeek: n => { seeks.push(n); state.time = n; }, onPreview: n => previews.push(n) });
  return { canvas, state, view, seeks, previews };
}
const near = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);

test('wave strip geometry: 100 scrolling bars translate under a fixed center; 60 fixed bars fit the padded box', () => {
  const a = waveGeometry(360, 120, .25, 'scroll', 1, 4);
  const b = waveGeometry(360, 120, .75, 'scroll', 1, 4);
  assert.equal(a.count, 100); assert.equal(a.barWidth, 8); assert.equal(a.spacing, 1.25);
  assert.equal(a.cursor, 180); assert.equal(b.cursor, 180);
  assert.equal(a.span, 923.75);
  near(a.origin - b.origin, a.span / 2);
  const fixed = waveGeometry(360, 120, .25, 'static', 1, 4);
  assert.equal(fixed.count, 60); assert.equal(fixed.spacing, .5);
  near(fixed.barWidth * 60 + fixed.spacing * 59, 344);
  assert.equal(fixed.origin, 8); assert.equal(fixed.cursor, 94);
  assert.equal(fixed.capHeight, 2.75); // Static overlap selects the narrower source bitmap.
});

test('nearest native resampling preserves point samples and null does not create a wave', () => {
  assert.equal(resamplePeaks(null, 100), null);
  assert.equal(resamplePeaks([], 60), null);
  assert.deepEqual([...resamplePeaks([0, 1, .2, .9, .4], 3)].map(n => +n.toFixed(3)), [0, .2, .9]);
  const { canvas, view } = waveform('scroll', { peaks: null });
  assert.equal(canvas.context.calls.filter(c => c[0] === 'ellipse').length, 0);
  view.destroy();
});

test('known silent samples use minimum bar height, distinct from unavailable peaks', () => {
  const { canvas, view } = waveform('static', { peaks: new Float32Array(100) });
  const arcs = canvas.context.calls.filter(c => c[0] === 'ellipse');
  assert.ok(arcs.length >= 120);
  assert.ok(arcs.every(a => a[2] >= 55 && a[2] <= 65));
  view.destroy();
});

test('scroll tap does not jump; left drag is relative to strip span; cancel commits and clears preview', () => {
  const { canvas, view, seeks, previews } = waveform();
  canvas.event('pointerdown', 300); canvas.event('pointerup', 300);
  assert.deepEqual(seeks, []);
  canvas.event('pointerdown', 180); canvas.event('pointermove', 90);
  const expected = Math.round((.5 + 90 / view.geometry.span) * 100000) / 1000;
  near(previews.at(-1), expected);
  canvas.event('pointercancel', 20);
  assert.deepEqual(seeks, [expected]);
  assert.equal(previews.at(-1), null); assert.equal(canvas.capture, null);
  canvas.event('pointermove', 250); canvas.event('pointerup', 250);
  assert.equal(seeks.length, 1);
  view.destroy();
});

test('static seek previews DOWN/MOVE and does not sample UP; CANCEL also commits last pending position', () => {
  const { canvas, view, seeks, previews } = waveform('static');
  canvas.event('pointerdown', 94);
  assert.equal(previews.at(-1), 25);
  canvas.event('pointermove', 180); canvas.event('pointerup', 352);
  assert.deepEqual(seeks, [50]);
  canvas.event('pointerdown', 266); canvas.event('pointercancel', 8);
  assert.deepEqual(seeks, [50, 75]);
  view.destroy();
});

test('plain Seek has 12dp padding, samples UP, and cancel does not sample cancel coordinates', () => {
  const { canvas, view, seeks } = waveform('plain');
  assert.equal(view.geometry.padding, 12);
  canvas.event('pointerdown', 12); canvas.event('pointerup', 348);
  assert.deepEqual(seeks, [100]);
  canvas.event('pointerdown', 180); canvas.event('pointercancel', 0);
  assert.deepEqual(seeks, [100, 50]);
  assert.equal(canvas.context.calls.filter(c => c[0] === 'ellipse').length, 0);
  view.destroy();
});

test('track replacement aborts the old seek; second finger cannot hijack; resize releases ownership', () => {
  const { canvas, state, view, seeks, previews } = waveform('static');
  canvas.event('pointerdown', 94);
  canvas.event('pointerdown', 300, 60, 2); canvas.event('pointermove', 300, 60, 2); canvas.event('pointerup', 300, 60, 2);
  assert.equal(previews.at(-1), 25);
  state.trackId = 'b'; state.time = 0; view.update();
  canvas.event('pointerup', 266);
  assert.deepEqual(seeks, []); assert.equal(canvas.capture, null); assert.equal(previews.at(-1), null);
  canvas.event('pointerdown', 180);
  canvas.rect.width = 400; view.update();
  assert.deepEqual(seeks, [50]); assert.equal(canvas.capture, null);
  view.destroy(); assert.equal(canvas.listeners.size, 0);
});

test('vertical movement cannot acquire a scrolling seek; reversing an acquired drag follows signed displacement', () => {
  const { canvas, view, seeks, previews } = waveform();
  canvas.event('pointerdown', 180); canvas.event('pointermove', 182, 100); canvas.event('pointerup', 190, 100);
  assert.deepEqual(seeks, []);
  canvas.event('pointerdown', 180); canvas.event('pointermove', 100); const forward = previews.at(-1);
  canvas.event('pointermove', 200); assert.ok(previews.at(-1) < 50); assert.ok(forward > 50);
  canvas.event('lostpointercapture', 200); assert.equal(seeks.length, 1);
  view.destroy();
});

test('art keep-aspect uses the source-pixel portrait threshold and width-fits a near-square image', () => {
  const nearSquare = computeArtCrop(100, 110, 200, 100);
  assert.deepEqual(nearSquare, { x: 0, y: -60, width: 200, height: 220, clip: { x: 0, y: 0, width: 200, height: 100 } });
  const portrait = computeArtCrop(100, 117, 200, 100);
  near(portrait.height, 100); near(portrait.width, 10000 / 117); assert.ok(portrait.x > 0);
  assert.equal(computeArtCrop(0, 50, 200, 100), null);
});

test('gradient uses recovered stops and ignores supplied alpha for a black endpoint', () => {
  const stops = gradientStops(4); near(stops[1], .49); near(stops[2], .94);
  const image = new Uint8ClampedArray(4 * 100).fill(255);
  const gradient = applyBackdropGradient(image, 1, 100, 4, '#00000000');
  assert.equal(gradient[0], 255);
  assert.ok(gradient[75 * 4] < 255);
  assert.equal(gradient[99 * 4], 0);
  assert.equal(gradient[99 * 4 + 3], 255);
});

test('native blur is initial pass plus count, with alternating diagonal offsets', () => {
  assert.equal(blurOffsets(0).length, 1);
  const offsets = blurOffsets(5); assert.equal(offsets.length, 6);
  near(offsets[0], .4761905074119568); near(offsets[1], 4 / 3); near(offsets[2], 5 / 3);
  assert.equal(blurOffsets(99).length, 16);
  const image = new Uint8ClampedArray(9 * 9 * 4);
  for (let i = 3; i < image.length; i += 4) image[i] = 255;
  image.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
  const zero = processBackdropPixels(image, 9, 9, { gradient: 0, blur: 0, saturation: 100 });
  const five = processBackdropPixels(image, 9, 9, { gradient: 0, blur: 5, saturation: 100 });
  const center = (4 * 9 + 4) * 4;
  assert.ok(zero[center] > five[center]); // Constant Gaussian radius would miss this count distinction.
  assert.ok(five[0] > zero[0]);
});

test('color adjustment is luminance saturation after intensity, with opaque final output', () => {
  const result = processBackdropPixels(new Uint8ClampedArray([200, 100, 50, 255]), 1, 1,
    { gradient: 0, blur: 0, saturation: 0, intensity: 50 });
  assert.deepEqual([...result], [59, 59, 59, 255]);
  const pin = processBackdropPixels(new Uint8ClampedArray([100, 100, 100, 255]), 1, 1,
    { gradient: 0, blur: 0, saturation: 100, effect: { pinLight: .7, lighten: .2, darken: .8 } });
  assert.deepEqual([...pin], [178, 178, 178, 255]);
});

function fakeImages(t) {
  const previous = globalThis.Image, images = [];
  globalThis.Image = class {
    constructor() { this.naturalWidth = 64; this.naturalHeight = 64; images.push(this); }
    set src(value) { this.url = value; }
    load(color) { this.color = color; this.onload?.(); }
    fail() { this.onerror?.(); }
  };
  t.after(() => { if (previous) globalThis.Image = previous; else delete globalThis.Image; });
  return images;
}

test('out-of-order artwork loads cannot replace the newest selection', async t => {
  const images = fakeImages(t), canvas = new Canvas(), backdrop = new Backdrop(canvas);
  const first = backdrop.setArtwork('blob:first', { blur: 0, gradient: 0, saturation: 100 });
  const staleLoad = images[0].onload;
  const second = backdrop.setArtwork('blob:second');
  images[1].load([5, 210, 12, 255]);
  assert.equal(await second, true); assert.equal(await first, false);
  staleLoad(); // Even a queued callback cannot replace the accepted generation.
  assert.equal(backdrop.image, images[1]);
  assert.deepEqual([...backdrop.texture.context.data.slice(0, 4)], [5, 210, 12, 255]);
  backdrop.destroy();
});

test('pending artwork uses the latest config and clearing/failing artwork removes prior pixels', async t => {
  const images = fakeImages(t), backdrop = new Backdrop(new Canvas());
  const first = backdrop.setArtwork('blob:a', { blur: 0, gradient: 0, saturation: 100 });
  backdrop.update({ intensity: 50 }); images[0].load([100, 100, 100, 255]);
  assert.equal(await first, true);
  assert.deepEqual([...backdrop.texture.context.data.slice(0, 4)], [50, 50, 50, 255]);
  const failure = backdrop.setArtwork('blob:bad'); images[1].fail();
  assert.equal(await failure, false); assert.equal(backdrop.texture, null);
  assert.equal(backdrop.status, 'artwork-unavailable');
  const pending = backdrop.setArtwork('blob:slow'); await backdrop.setArtwork(null);
  assert.equal(await pending, false); images[2].load([255, 0, 0, 255]);
  assert.equal(backdrop.texture, null); assert.equal(backdrop.status, 'no-artwork');
  backdrop.destroy();
});

test('destroy settles pending image work and disabled backdrop uses only its fallback', async t => {
  const images = fakeImages(t), canvas = new Canvas(), backdrop = new Backdrop(canvas);
  const pending = backdrop.setArtwork('blob:slow'); backdrop.destroy();
  assert.equal(await pending, false); images[0].load([255, 0, 0, 255]); assert.equal(backdrop.texture, null);
  const next = new Backdrop(canvas);
  const loaded = next.setArtwork('blob:ready', { enabled: false }); images[1].load([255, 0, 0, 255]); await loaded;
  canvas.context.calls.length = 0; next.redraw();
  assert.equal(canvas.context.calls.filter(c => c[0] === 'image').length, 0);
  next.destroy();
});

function animationClock(t) {
  const descriptors = Object.fromEntries(['performance', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let now = 0, id = 0;
  const callbacks = new Map();
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globalThis.requestAnimationFrame = fn => { callbacks.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = i => callbacks.delete(i);
  t.after(() => {
    for (const [k, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k];
    }
  });
  return { set: value => { now = value; }, tick(value) {
    now = value;
    const queued = [...callbacks.values()]; callbacks.clear();
    for (const callback of queued) callback(now);
  }, pending: () => callbacks.size };
}

test('scroll release defers seek through a fling, while cancellation commits with no added velocity', t => {
  const clock = animationClock(t);
  const { canvas, view, seeks, previews } = waveform('scroll', { reducedMotion: false });
  canvas.event('pointerdown', 180);
  clock.set(20); canvas.event('pointermove', 140);
  const releasedTime = previews.at(-1);
  clock.set(25); canvas.event('pointerup', 140);
  assert.equal(seeks.length, 0); assert.equal(canvas.capture, null);
  clock.tick(40); clock.tick(80); clock.tick(110);
  assert.equal(seeks.length, 1); assert.ok(seeks[0] > releasedTime);
  clock.set(200); canvas.event('pointerdown', 180);
  clock.set(220); canvas.event('pointermove', 140);
  const cancelledTime = previews.at(-1);
  canvas.event('pointercancel', 100);
  assert.equal(seeks.at(-1), cancelledTime);
  clock.tick(300); assert.equal(seeks.length, 2);
  view.destroy(); assert.equal(clock.pending(), 0);
});

test('native crop mode names do not imply browser cover for a nonsquare target', () => {
  const defaultCrop = computeArtCrop(200, 100, 100, 200, 0);
  assert.deepEqual(defaultCrop.clip, { x: 0, y: 75, width: 100, height: 50 });
  const bothAxes = computeArtCrop(200, 100, 100, 200, 2);
  assert.deepEqual(bothAxes.clip, { x: 0, y: 0, width: 100, height: 200 });
  assert.equal(bothAxes.x, -150);
  const portrait = computeArtCrop(100, 200, 100, 400, 2);
  assert.deepEqual(portrait.clip, { x: 0, y: 100, width: 100, height: 200 });
});

test('art replacement can use explicit transition duration; destroy cancels repaint ownership', async t => {
  const clock = animationClock(t), images = fakeImages(t);
  const canvas = new Canvas(), backdrop = new Backdrop(canvas);
  const first = backdrop.setArtwork('blob:a', { gradient: 0, blur: 0, transitionMs: 200 });
  images[0].load([255, 0, 0, 255]); await first;
  const second = backdrop.setArtwork('blob:b'); images[1].load([0, 0, 255, 255]); await second;
  assert.ok(backdrop.previous); assert.equal(clock.pending(), 1);
  clock.tick(100); assert.ok(backdrop.previous);
  clock.tick(200); assert.equal(backdrop.previous, null);
  assert.equal(clock.pending(), 0);
  backdrop.destroy();
});

test('landscape padding override is applied once; Light fixed bars retain their distinct source alpha', () => {
  const { canvas, view } = waveform('static', { paddingX: 0, colors: { theme: 'Light' } });
  assert.equal(view.geometry.padding, 0); assert.equal(view.geometry.contentWidth, 360);
  const fills = canvas.context.calls.filter(c => c[0] === 'fill').map(c => c[1]);
  assert.ok(fills.includes('#ffffffd9')); assert.ok(fills.includes('#7e7e7e66'));
  view.destroy();
});

test('blur between media replacement and next paint cannot commit an old preview to the new track', () => {
  const { canvas, state, view, seeks, previews } = waveform('static');
  canvas.event('pointerdown', 266);
  state.trackId = 'new-track'; state.duration = 600;
  view.onBlur();
  assert.deepEqual(seeks, []); assert.equal(previews.at(-1), null); assert.equal(canvas.capture, null);
  view.destroy();
});
