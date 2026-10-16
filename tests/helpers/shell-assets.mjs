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

export function assetIndex(shell, assetPath) {
  const escaped = assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:src|href)="\\/?${escaped}(?:\\?[^"]*)?"`).exec(shell);
  return match ? match.index : -1;
}
