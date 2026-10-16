import vm from "node:vm";
import { extractIndentedFunction } from "./app-extract.mjs";

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  };
}

function element() {
  const listeners = new Map();
  return {
    dataset: {},
    classList: classList(),
    children: [],
    parentElement: null,
    removed: false,
    src: "",
    complete: false,
    currentSrc: "",
    naturalWidth: 0,
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatch(type) {
      for (const fn of listeners.get(type) || []) fn.call(this);
    },
    remove() {
      this.removed = true;
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
        this.parentElement = null;
      }
    }
  };
}

function hostWith(image) {
  const host = element();
  image.parentElement = host;
  host.children.push(image);
  return host;
}

function queryImages(selector, root) {
  if (!selector.includes("media-image")) return [];
  return (root.children || []).filter((child) => child.dataset && child.dataset.artBound !== "true");
}

function artworkContext(source) {
  const context = vm.createContext({
    esc: (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]),
    safeUrl: (value) => /^https?:\/\//.test(String(value || "")) ? String(value) : "",
    document: {},
    queueMicrotask,
    Set,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
    $$(selector, root) {
      return queryImages(selector, root);
    }
  });
  context.globalThis = context;
  const fallbackStart = source.indexOf("globalThis.AstraArtworkFallback=function(image){");
  if (fallbackStart >= 0) {
    const fallbackEnd = source.indexOf("\n    };", fallbackStart);
    vm.runInContext(source.slice(fallbackStart, fallbackEnd + "\n    };".length), context);
  }
  const bind = extractIndentedFunction(source, "bindArtwork");
  if (bind) vm.runInContext(bind, context);
  const mediaImage = extractIndentedFunction(source, "mediaImage");
  if (!mediaImage) throw new Error("mediaImage is not in the application");
  vm.runInContext(mediaImage, context);
  return context;
}

function imageFromMarkup(markup) {
  const image = element();
  const fallbacks = markup.match(/data-art-fallbacks="([^"]*)"/)?.[1];
  if (fallbacks) image.dataset.artFallbacks = fallbacks.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
  image.src = markup.match(/\ssrc="([^"]*)"/)?.[1] || "";
  return image;
}

/**
 * Prove a catalog image reaches a ready state, and that a broken URL falls
 * through to the next candidate or the visible fallback. Inline handlers and
 * bindArtwork are both exercised by firing the events, not by matching source.
 */
export function assertArtworkResilience(source, assert) {
  const context = artworkContext(source);
  const primary = "https://images.example.test/primary.jpg";
  const next = "https://images.example.test/fallback.jpg";
  const markup = context.mediaImage(primary, { fallbacks: [next] });
  assert.match(markup, /class="media-image"/);
  assert.match(markup, /loading="lazy"/);
  assert.doesNotMatch(context.mediaImage(primary, { priority: true }), /loading="lazy"/);

  const image = imageFromMarkup(markup);
  const host = hostWith(image);
  if (typeof context.bindArtwork === "function") {
    context.bindArtwork(host);
    assert.equal(image.dataset.artBound, "true");
    image.dispatch("error");
    assert.equal(image.src, next, "a broken poster advances to the next candidate");
    assert.equal(host.classList.contains("image-loading"), true);
    assert.equal(image.removed, false);
    image.dispatch("error");
    assert.equal(image.removed, true, "the last broken candidate gets out of the way");
    assert.equal(host.classList.contains("image-error"), true);
    const ready = element();
    ready.src = primary;
    const readyHost = hostWith(ready);
    context.bindArtwork(readyHost);
    ready.dispatch("load");
    assert.equal(readyHost.classList.contains("image-ready"), true);
    assert.equal(ready.removed, false);
    return;
  }

  const onload = markup.match(/onload="([^"]*)"/)?.[1];
  const onerror = markup.match(/onerror="([^"]*)"/)?.[1];
  assert.ok(onload && onerror, "inline artwork handlers are present when bindArtwork is not");
  Function(`"use strict";\n${onload}`).call(image);
  assert.equal(host.classList.contains("image-ready"), true);
  host.classList.remove("image-ready");
  Function(`"use strict";\n${onerror}`).call(image);
  assert.equal(host.classList.contains("image-error"), true);
  assert.equal(image.removed, true, "a broken inline image reveals the fallback mark");
}
