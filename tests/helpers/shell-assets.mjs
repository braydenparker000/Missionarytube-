/** Cache-key and script-order helpers for the historical placeholder and a stamped release. */

export const RELEASE_PLACEHOLDER = "__ASTRA_VERSION__";

export function releaseMeta(shell) {
  return shell.match(/<meta name="astra-release" content="([^"]+)">/)?.[1] ?? "";
}

/** Local shell assets, including a root-absolute `/assets/...` URL. */
export function localShellAssets(shell) {
  return [...shell.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1]);
}

export function cacheKeyOf(asset) {
  return asset.match(/\?v=([^"#]+)$/)?.[1] ?? "";
}

/**
 * One release owns every local cache key. Source trees keep the build
 * placeholder; a stamped checkout uses the visible astra-release value.
 */
export function sharedCacheKey(shell) {
  const assets = localShellAssets(shell);
  const keys = assets.map(cacheKeyOf);
  return { assets, keys, key: keys[0] ?? "", meta: releaseMeta(shell) };
}

function escapePath(assetPath) {
  return assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attributeSource(attrs) {
  return attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1] || "";
}

function matchesAsset(url, assetPath) {
  const bare = url.replace(/^\//, "").split(/[?#]/)[0];
  return bare === assetPath;
}

/**
 * Parser-blocking scripts run in document order as they are reached.
 * Deferred scripts, including modules, run later in document order.
 * `async` (including a tag that sets both async and defer) does not.
 * A blocking script and a deferred script do not share an order.
 */
export function scriptMode(tag) {
  if (tag.async) return "async";
  if (tag.defer || tag.module) return "defer";
  return "blocking";
}

export function scriptElements(shell) {
  const tags = [];
  for (const match of shell.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1];
    const flags = attrs.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*')/g, "");
    tags.push({
      index: match.index,
      src: attributeSource(attrs),
      async: /\basync\b/.test(flags),
      defer: /\bdefer\b/.test(flags),
      module: /\btype\s*=\s*["']module["']/.test(flags)
    });
  }
  return tags;
}

export function findScript(shell, assetPath) {
  return scriptElements(shell).find((tag) => matchesAsset(tag.src, assetPath)) || null;
}

/**
 * Document position of a classic or deferred script. Async scripts, preload
 * links, and stylesheet links do not count: they cannot prove execution order.
 */
export function assetIndex(shell, assetPath) {
  const tag = findScript(shell, assetPath);
  if (!tag || scriptMode(tag) === "async") return -1;
  return tag.index;
}

/**
 * True only when `earlier` is guaranteed to execute before `later`.
 * Async scripts and mixed async/defer or blocking/defer pairs return false.
 */
export function scriptRunsBefore(shell, earlierPath, laterPath) {
  const earlier = findScript(shell, earlierPath);
  const later = findScript(shell, laterPath);
  if (!earlier || !later) return false;
  const earlierMode = scriptMode(earlier);
  const laterMode = scriptMode(later);
  if (earlierMode === "async" || laterMode === "async") return false;
  if (earlierMode !== laterMode) return false;
  return earlier.index < later.index;
}

/** A stylesheet link, not a preload that happens to name the same file. */
export function stylesheetIndex(shell, assetPath) {
  const escaped = escapePath(assetPath);
  const href = new RegExp(`\\bhref\\s*=\\s*["']\\/?${escaped}(?:\\?[^"']*)?["']`);
  for (const match of shell.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (!/\brel\s*=\s*["']stylesheet["']/.test(attrs)) continue;
    if (href.test(attrs)) return match.index;
  }
  return -1;
}
