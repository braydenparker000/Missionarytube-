import { gsap } from "gsap";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import {
  clamp,
  dragProgress,
  movedPastTapSlop,
  navigationDirection,
  shouldDismiss
} from "./interaction-logic.js";

gsap.registerPlugin(Draggable, InertiaPlugin);

const reduceQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const coarseQuery = window.matchMedia?.("(pointer: coarse)");
const compactQuery = window.matchMedia?.("(max-width: 820px)");
const surfaceBindings = new WeakMap();
const elementBindings = new WeakMap();
const heroBindings = new WeakMap();
const ART_SELECTOR = ".art, .release-art, .resume-art, .feature-art, .briefing-pick-art";
const REVEAL_SELECTOR = [
  ".feature",
  ".sector",
  ".briefing-launch",
  ".page-head",
  ".screen-head",
  ".screen-lede",
  ".source-line",
  ".grid > .card",
  ".search-report",
  ".search-type-row",
  ".search-provider-strip",
  ".search-provider-result",
  ".state",
  ".settings-section",
  ".settings-note",
  ".hub-row",
  ".health-overview",
  ".health-totals",
  ".health-card",
  ".layout-summary",
  ".layout-catalog",
  ".episode-focus",
  ".video-row",
  ".source-intel",
  ".stream-item",
  ".briefing-pick"
].join(",");
const PRESS_SELECTOR = [
  ".card",
  ".resume-card",
  ".briefing-pick",
  ".briefing-trigger",
  ".video-row",
  ".stream-row",
  ".settings-route",
  ".hub-row",
  ".dock-btn",
  ".btn",
  ".icon-btn"
].join(",");

let initialized = false;
let sharedSource = null;
let sharedTransition = null;
let pageEdge = null;
let pageDrag = null;
let pageBack = null;
let press = null;
let suppressed = null;
let dockResize = null;
let revealObserver = null;
let revealFrame = 0;
let navigationUpdating = false;
const revealQueue = new Set();
const revealPending = new Set();

function reduced() {
  return Boolean(reduceQuery?.matches);
}

function constrainedMotion() {
  if (!coarseQuery?.matches || !compactQuery?.matches) return false;
  const memory = Number(navigator.deviceMemory) || Infinity;
  const cores = Number(navigator.hardwareConcurrency) || Infinity;
  return memory <= 4 || cores <= 4;
}

function clearTransitionState() {
  delete document.documentElement.dataset.astraNav;
  delete document.documentElement.dataset.astraTransition;
  sharedTransition = null;
}

function transitionAvailable() {
  return !reduced() && !constrainedMotion() && typeof document.startViewTransition === "function" && !sharedTransition;
}

function artWithin(source) {
  if (!(source instanceof Element)) return null;
  return source.matches(ART_SELECTOR) ? source : source.querySelector(ART_SELECTOR);
}

function visible(element) {
  if (!(element instanceof Element) || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < window.innerHeight;
}

function revealEligible(element) {
  if (!(element instanceof Element) || !element.isConnected) return false;
  if (element.closest(".player-shell, [data-motion-static]")) return false;
  return !element.dataset.astraReveal;
}

function revealVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 4 && rect.height > 4 && rect.bottom > -24 && rect.top < window.innerHeight * 1.08;
}

function finishReveal(element) {
  revealObserver?.unobserve?.(element);
  revealQueue.delete(element);
  revealPending.delete(element);
  element.dataset.astraReveal = "done";
  gsap.killTweensOf(element);
  gsap.set(element, { clearProps: "transform,opacity,willChange" });
}

function flushRevealQueue() {
  revealFrame = 0;
  const elements = [...revealQueue].filter((element) => revealPending.has(element) && element.isConnected);
  revealQueue.clear();
  if (!elements.length) return;
  if (reduced() || navigationUpdating) {
    elements.forEach(finishReveal);
    return;
  }
  elements.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return Math.abs(ar.top - br.top) > 8 ? ar.top - br.top : ar.left - br.left;
  });
  const lean = constrainedMotion();
  const budget = lean ? 8 : 14;
  const animated = elements.slice(0, budget);
  const deferred = elements.slice(budget);
  deferred.forEach(finishReveal);
  animated.forEach((element) => {
    element.dataset.astraReveal = "running";
    gsap.set(element, {
      y: lean ? 12 : 18,
      scale: lean ? 1 : 0.992,
      opacity: 0,
      willChange: "transform,opacity"
    });
  });
  const staggerWindow = lean ? 0.12 : 0.24;
  const stagger = animated.length > 1 ? Math.min(lean ? 0.025 : 0.04, staggerWindow / (animated.length - 1)) : 0;
  gsap.to(animated, {
    y: 0,
    scale: 1,
    opacity: 1,
    duration: lean ? 0.4 : 0.54,
    stagger,
    ease: "power3.out",
    overwrite: "auto",
    onComplete: () => animated.forEach(finishReveal)
  });
}

function queueReveal(element) {
  revealObserver?.unobserve?.(element);
  revealQueue.add(element);
  if (!revealFrame) revealFrame = requestAnimationFrame(flushRevealQueue);
}

function installRevealObserver() {
  if (revealObserver || typeof IntersectionObserver !== "function") return;
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) queueReveal(entry.target);
    });
  }, { rootMargin: "0px 0px 12% 0px", threshold: 0.015 });
}

function refresh(root = document) {
  if (!(root instanceof Element) && root !== document) return 0;
  const candidates = [];
  if (root instanceof Element && root.matches(REVEAL_SELECTOR)) candidates.push(root);
  candidates.push(...root.querySelectorAll(REVEAL_SELECTOR));
  const fresh = candidates.filter(revealEligible);
  if (!fresh.length) return 0;
  if (reduced() || navigationUpdating) {
    fresh.forEach((element) => {
      element.dataset.astraReveal = "done";
      gsap.set(element, { clearProps: "transform,opacity,willChange" });
    });
    return fresh.length;
  }
  installRevealObserver();
  fresh.forEach((element) => {
    element.dataset.astraReveal = "queued";
    revealPending.add(element);
    if (!revealObserver || revealVisible(element)) queueReveal(element);
    else revealObserver.observe(element);
  });
  return fresh.length;
}

function handleReducedMotionChange() {
  if (!reduced()) return;
  cancelAnimationFrame(revealFrame);
  revealFrame = 0;
  [...revealPending].forEach(finishReveal);
}

function installPressFeedback() {
  const release = (cancelled = false) => {
    if (!press) return;
    const { target, moved } = press;
    if (moved || cancelled) suppressed = { target, until: performance.now() + 420 };
    gsap.killTweensOf(target);
    gsap.to(target, {
      scale: 1,
      duration: moved || cancelled ? 0.16 : 0.34,
      ease: moved || cancelled ? "power2.out" : "back.out(3)",
      clearProps: "transform"
    });
    press = null;
  };

  document.addEventListener("pointerdown", (event) => {
    if (reduced() || !event.isPrimary || event.button > 0) return;
    const target = event.target.closest?.(PRESS_SELECTOR);
    if (!target || target.matches(":disabled") || target.closest("[data-motion-static]")) return;
    press = { target, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    gsap.killTweensOf(target);
    gsap.to(target, { scale: 0.972, duration: 0.12, ease: "power2.out" });
  }, { capture: true, passive: true });

  document.addEventListener("pointermove", (event) => {
    if (!press || press.pointerId !== event.pointerId || press.moved) return;
    if (movedPastTapSlop(press.x, press.y, event.clientX, event.clientY)) {
      press.moved = true;
      release(true);
    }
  }, { capture: true, passive: true });

  document.addEventListener("pointerup", (event) => {
    if (press?.pointerId === event.pointerId) release(false);
  }, { capture: true, passive: true });
  document.addEventListener("pointercancel", () => release(true), { capture: true, passive: true });
  document.addEventListener("click", (event) => {
    if (!suppressed || performance.now() > suppressed.until) return;
    if (event.target === suppressed.target || suppressed.target.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressed = null;
    }
  }, true);
}

function progressSurface(backdrop, progress) {
  backdrop?.style.setProperty("--motion-dismiss", String(clamp(progress, 0, 1)));
}

function makeAxisDrag({ target, trigger, axis, size, onProgress, onDismiss }) {
  let tracked = false;
  let lastPosition = 0;
  let lastAt = performance.now();
  let fallbackVelocity = 0;
  const property = axis === "x" ? "x" : "y";
  const bounds = axis === "x" ? { minX: 0, maxX: size } : { minY: 0, maxY: size };
  const instance = Draggable.create(target, {
    type: property,
    trigger,
    bounds,
    minimumMovement: 4,
    dragClickables: false,
    allowNativeTouchScrolling: false,
    edgeResistance: 0.82,
    onPress() {
      gsap.killTweensOf(target);
      target.classList.add("motion-dragging");
      lastPosition = Math.max(0, Number(this[property]) || 0);
      lastAt = performance.now();
      fallbackVelocity = 0;
      try {
        InertiaPlugin.track(target, property);
        tracked = true;
      } catch {
        tracked = false;
      }
    },
    onDrag() {
      const position = Math.max(0, Number(this[property]) || 0);
      const now = performance.now();
      fallbackVelocity = (position - lastPosition) / Math.max(1, now - lastAt) * 1000;
      lastPosition = position;
      lastAt = now;
      onProgress(position, dragProgress(position, size));
    },
    onRelease() {
      let velocity = fallbackVelocity;
      if (tracked) {
        try { velocity = InertiaPlugin.getVelocity(target, property); } catch {}
        try { InertiaPlugin.untrack(target, property); } catch {}
        tracked = false;
      }
      target.classList.remove("motion-dragging");
      const distance = Math.max(0, Number(this[property]) || 0);
      if (shouldDismiss({ distance, velocity, size })) {
        onDismiss({ axis: property, distance, velocity, size });
        return;
      }
      gsap.to(target, {
        [property]: 0,
        duration: 0.36,
        ease: "power4.out",
        onUpdate: () => onProgress(Number(gsap.getProperty(target, property)) || 0, dragProgress(Number(gsap.getProperty(target, property)) || 0, size)),
        onComplete: () => onProgress(0, 0)
      });
    }
  })[0];
  return instance;
}

function finishDrag({ target, axis, distance = 0, velocity = 0, size, onProgress, onComplete }) {
  const remaining = Math.max(1, size - distance);
  const duration = clamp(remaining / Math.max(900, Math.abs(velocity || 0)), 0.16, 0.32);
  gsap.killTweensOf(target);
  gsap.to(target, {
    [axis]: size,
    opacity: 0.76,
    duration,
    ease: "power3.in",
    onUpdate: () => {
      const value = Number(gsap.getProperty(target, axis)) || 0;
      onProgress(value, dragProgress(value, size));
    },
    onComplete
  });
}

function createGrip(panel) {
  const grip = document.createElement("div");
  grip.className = "motion-drag-grip";
  grip.setAttribute("aria-hidden", "true");
  grip.innerHTML = "<i></i>";
  panel.append(grip);
  return grip;
}

function createEdge(backdrop) {
  const edge = document.createElement("div");
  edge.className = "motion-surface-edge";
  edge.setAttribute("aria-hidden", "true");
  backdrop.prepend(edge);
  return edge;
}

function releaseSurface(root) {
  const binding = surfaceBindings.get(root);
  if (binding) binding.dispose();
  surfaceBindings.delete(root);
  if (root instanceof Element) delete root.dataset.motionSurface;
}

function mountSurface({ root, key, panelSelector, onDismiss, edge = true, down = true } = {}) {
  if (!(root instanceof Element)) return false;
  const backdrop = root.firstElementChild;
  const panel = panelSelector ? root.querySelector(panelSelector) : backdrop?.firstElementChild;
  if (!(backdrop instanceof Element) || !(panel instanceof Element)) return false;

  const previousKey = root.dataset.motionSurface;
  const old = surfaceBindings.get(root);
  if (old) old.dispose();
  root.dataset.motionSurface = key || "surface";
  backdrop.classList.add("motion-surface");
  progressSurface(backdrop, 0);

  let closing = false;
  const drags = [];
  const controls = [];
  const dispose = () => {
    drags.splice(0).forEach((drag) => drag?.kill?.());
    controls.splice(0).forEach((control) => control.remove());
    gsap.killTweensOf(panel);
    panel.classList.remove("motion-dragging");
    gsap.set(panel, { clearProps: "transform,opacity" });
    progressSurface(backdrop, 0);
    backdrop.classList.remove("motion-surface");
  };
  const completeDismiss = ({ axis = edge ? "x" : "y", distance = 0, velocity = 0, size = axis === "x" ? window.innerWidth : window.innerHeight } = {}, done = onDismiss) => {
    if (closing) return;
    closing = true;
    drags.forEach((drag) => drag?.disable?.());
    finishDrag({
      target: panel,
      axis,
      distance,
      velocity,
      size,
      onProgress: (_value, progress) => progressSurface(backdrop, progress),
      onComplete: () => {
        dispose();
        surfaceBindings.delete(root);
        delete root.dataset.motionSurface;
        done?.();
      }
    });
  };

  const binding = {
    dispose,
    dismiss(done) {
      if (reduced()) {
        dispose();
        surfaceBindings.delete(root);
        delete root.dataset.motionSurface;
        done?.();
        return;
      }
      const axis = edge ? "x" : "y";
      completeDismiss({ axis, size: axis === "x" ? window.innerWidth : window.innerHeight }, done);
    }
  };
  surfaceBindings.set(root, binding);

  if (!reduced()) {
    if (edge) {
      const trigger = createEdge(backdrop);
      controls.push(trigger);
      drags.push(makeAxisDrag({
        target: panel,
        trigger,
        axis: "x",
        size: Math.max(320, window.innerWidth),
        onProgress: (_value, progress) => progressSurface(backdrop, progress),
        onDismiss: completeDismiss
      }));
    }
    if (down) {
      const trigger = createGrip(panel);
      controls.push(trigger);
      drags.push(makeAxisDrag({
        target: panel,
        trigger,
        axis: "y",
        size: Math.max(480, window.innerHeight),
        onProgress: (_value, progress) => progressSurface(backdrop, progress),
        onDismiss: completeDismiss
      }));
    }
    if (!previousKey && !sharedTransition) {
      progressSurface(backdrop, 1);
      gsap.fromTo(panel, { y: 34, opacity: 0.72 }, { y: 0, opacity: 1, duration: 0.48, ease: "power4.out", clearProps: "transform,opacity" });
      gsap.to(backdrop, { "--motion-dismiss": 0, duration: 0.34, ease: "power2.out" });
    }
  }
  return true;
}

function dismissSurface(root, done) {
  const binding = surfaceBindings.get(root);
  if (!binding) return false;
  binding.dismiss(done);
  return true;
}

function mountTrackSheet(element, onDismiss) {
  if (!(element instanceof Element)) return false;
  const old = elementBindings.get(element);
  if (old) old.dispose();
  let closing = false;
  const grip = createGrip(element);
  const size = Math.max(320, element.getBoundingClientRect().height || window.innerHeight * 0.62);
  let drag = null;
  const progress = (_value, amount) => gsap.set(element, { opacity: 1 - amount * 0.28 });
  const dispose = () => {
    drag?.kill?.();
    grip.remove();
    gsap.killTweensOf(element);
    gsap.set(element, { clearProps: "transform,opacity" });
  };
  const finish = ({ distance = 0, velocity = 0 } = {}, done = onDismiss) => {
    if (closing) return;
    closing = true;
    drag?.disable?.();
    finishDrag({ target: element, axis: "y", distance, velocity, size, onProgress: progress, onComplete: () => {
      dispose();
      elementBindings.delete(element);
      done?.();
    }});
  };
  const binding = {
    dispose,
    dismiss(done) {
      if (reduced()) { dispose(); elementBindings.delete(element); done?.(); return; }
      finish({}, done);
    }
  };
  elementBindings.set(element, binding);
  if (!reduced()) {
    drag = makeAxisDrag({ target: element, trigger: grip, axis: "y", size, onProgress: progress, onDismiss: finish });
    gsap.fromTo(element, { y: 34, opacity: 0.78 }, { y: 0, opacity: 1, duration: 0.4, ease: "power4.out", clearProps: "transform,opacity" });
  }
  return true;
}

function dismissElement(element, done) {
  const binding = elementBindings.get(element);
  if (!binding) return false;
  binding.dismiss(done);
  return true;
}

function releaseElement(element) {
  const binding = elementBindings.get(element);
  binding?.dispose();
  elementBindings.delete(element);
}

function sharedOpen({ source, update, targetSelector = ".dossier-poster" } = {}) {
  const sourceArt = artWithin(source);
  const openingSource = visible(sourceArt) ? sourceArt : null;
  sharedSource = openingSource;
  if (!transitionAvailable() || !openingSource) {
    update?.();
    return Promise.resolve(false);
  }
  const name = "astra-art";
  let target = null;
  document.documentElement.dataset.astraTransition = "detail-open";
  openingSource.style.viewTransitionName = name;
  try {
    sharedTransition = document.startViewTransition(() => {
      openingSource.style.viewTransitionName = "";
      update?.();
      target = document.querySelector(targetSelector);
      if (target) target.style.viewTransitionName = name;
    });
    const updated = sharedTransition.updateCallbackDone.then(() => true).catch(() => false);
    sharedTransition.finished.catch(() => {}).finally(() => {
      if (target) target.style.viewTransitionName = "";
      openingSource.style.viewTransitionName = "";
      clearTransitionState();
    });
    return updated;
  } catch {
    openingSource.style.viewTransitionName = "";
    clearTransitionState();
    update?.();
    return Promise.resolve(false);
  }
}

function sharedClose({ target, update } = {}) {
  const closingSource = sharedSource;
  if (!transitionAvailable() || !visible(target) || !visible(closingSource)) return false;
  const name = "astra-art";
  document.documentElement.dataset.astraTransition = "detail-close";
  target.style.viewTransitionName = name;
  try {
    sharedTransition = document.startViewTransition(() => {
      target.style.viewTransitionName = "";
      update?.();
      if (closingSource.isConnected) closingSource.style.viewTransitionName = name;
    });
    sharedTransition.finished.catch(() => {}).finally(() => {
      closingSource.style.viewTransitionName = "";
      clearTransitionState();
    });
    return true;
  } catch {
    target.style.viewTransitionName = "";
    clearTransitionState();
    return false;
  }
}

function navigate({ from, to, direction = "auto", update } = {}) {
  const travel = navigationDirection(from, to, direction);
  const commit = () => {
    navigationUpdating = true;
    try { update?.(); } finally { navigationUpdating = false; }
  };
  if (!transitionAvailable()) {
    commit();
    if (!reduced()) {
      const page = document.querySelector(".page.active");
      if (page) {
        const lean = constrainedMotion();
        gsap.fromTo(
          page,
          { x: travel === "back" ? (lean ? -10 : -18) : (lean ? 12 : 22), opacity: lean ? 0.72 : 0.45 },
          { x: 0, opacity: 1, duration: lean ? 0.28 : 0.38, ease: "power4.out", clearProps: "transform,opacity" }
        );
      }
    }
    return false;
  }
  document.documentElement.dataset.astraNav = travel;
  try {
    sharedTransition = document.startViewTransition(commit);
    sharedTransition.finished.catch(() => {}).finally(clearTransitionState);
    return true;
  } catch {
    clearTransitionState();
    update?.();
    return false;
  }
}

function syncDock(root, activeId) {
  if (!(root instanceof Element)) return;
  const active = root.querySelector(`[data-nav="${CSS.escape(activeId)}"]`);
  const indicator = root.querySelector(".dock-indicator");
  if (!active || !indicator) return;
  const place = (animate = true) => {
    const values = { x: active.offsetLeft, width: active.offsetWidth };
    gsap.killTweensOf(indicator);
    if (reduced() || !animate) gsap.set(indicator, values);
    else gsap.to(indicator, { ...values, duration: 0.46, ease: "power4.out" });
  };
  place(indicator.dataset.ready === "true");
  indicator.dataset.ready = "true";
  if (!reduced()) gsap.fromTo(active.querySelector(".dock-icon"), { y: 4, scale: 0.86 }, { y: 0, scale: 1, duration: 0.42, ease: "back.out(2.6)", clearProps: "transform" });
  dockResize?.disconnect?.();
  if (typeof ResizeObserver === "function") {
    dockResize = new ResizeObserver(() => place(false));
    dockResize.observe(root);
  }
}

function bindHero(deck, dots) {
  if (!(deck instanceof Element)) return;
  heroBindings.get(deck)?.();
  const slides = [...deck.querySelectorAll(".feature-slide")];
  const marks = dots ? [...dots.querySelectorAll("i")] : [];
  let frame = 0;
  const render = () => {
    frame = 0;
    const width = Math.max(1, deck.clientWidth);
    const position = deck.scrollLeft / width;
    const index = clamp(Math.round(position), 0, Math.max(0, slides.length - 1));
    marks.forEach((mark, i) => mark.classList.toggle("on", i === index));
    if (reduced() || constrainedMotion()) return;
    slides.forEach((slide, i) => {
      const offset = clamp(i - position, -1.25, 1.25);
      const image = slide.querySelector(".feature-art img");
      const body = slide.querySelector(".feature-body");
      if (image) gsap.set(image, { xPercent: offset * 4.5, scale: 1.045 });
      if (body) gsap.set(body, { x: offset * 11, opacity: 1 - Math.abs(offset) * 0.28 });
    });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  const start = () => deck.classList.add("motion-interacting");
  const end = () => { deck.classList.remove("motion-interacting"); schedule(); };
  deck.addEventListener("scroll", schedule, { passive: true });
  deck.addEventListener("pointerdown", start, { passive: true });
  deck.addEventListener("pointerup", end, { passive: true });
  deck.addEventListener("pointercancel", end, { passive: true });
  deck.addEventListener("scrollend", end, { passive: true });
  render();
  heroBindings.set(deck, () => {
    cancelAnimationFrame(frame);
    deck.removeEventListener("scroll", schedule);
    deck.removeEventListener("pointerdown", start);
    deck.removeEventListener("pointerup", end);
    deck.removeEventListener("pointercancel", end);
    deck.removeEventListener("scrollend", end);
  });
}

function syncPageBack(enabled) {
  if (!pageEdge || !pageDrag) return;
  pageEdge.classList.toggle("is-disabled", !enabled || reduced());
  if (enabled && !reduced()) pageDrag.enable();
  else pageDrag.disable();
}

function installPageEdge() {
  const main = document.querySelector("main");
  if (!main) return;
  pageEdge = document.createElement("div");
  pageEdge.className = "motion-page-edge is-disabled";
  pageEdge.setAttribute("aria-hidden", "true");
  document.body.append(pageEdge);
  const size = Math.max(320, window.innerWidth);
  pageDrag = makeAxisDrag({
    target: main,
    trigger: pageEdge,
    axis: "x",
    size,
    onProgress: (_value, progress) => gsap.set(main, { opacity: 1 - progress * 0.24 }),
    onDismiss: ({ distance, velocity }) => finishDrag({
      target: main,
      axis: "x",
      distance,
      velocity,
      size: Math.min(size, 118),
      onProgress: () => {},
      onComplete: () => {
        gsap.set(main, { clearProps: "transform,opacity" });
        pageBack?.();
      }
    })
  });
  pageDrag.disable();
}

function init({ onPageBack } = {}) {
  pageBack = onPageBack || pageBack;
  if (initialized) return;
  initialized = true;
  document.documentElement.classList.add("motion-ready");
  document.documentElement.classList.toggle("motion-lean", constrainedMotion());
  installRevealObserver();
  reduceQuery?.addEventListener?.("change", handleReducedMotionChange);
  installPressFeedback();
  installPageEdge();
}

globalThis.AstraMotion = Object.freeze({
  version: "2.0.0",
  init,
  reduced,
  navigate,
  syncDock,
  syncPageBack,
  bindHero,
  refresh,
  mountSurface,
  dismissSurface,
  releaseSurface,
  mountTrackSheet,
  dismissElement,
  releaseElement,
  sharedOpen,
  sharedClose
});
