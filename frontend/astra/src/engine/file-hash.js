// The OpenSubtitles file hash: the file size plus the sum of the first and
// last 64 KiB read as little-endian 64-bit integers, modulo 2^64. Subtitle
// add-ons use it to return subtitles timed for this exact release.

export const HASH_CHUNK = 65536;

/** Hashes from the two chunks; null when the file is too small. */
export function openSubtitlesHash(size, head, tail) {
  if (!(size >= HASH_CHUNK * 2) || head.length < HASH_CHUNK || tail.length < HASH_CHUNK) return null;
  let sum = BigInt(size);
  for (const bytes of [head, tail]) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, HASH_CHUNK);
    for (let i = 0; i < HASH_CHUNK; i += 8) sum += view.getBigUint64(i, true);
  }
  return (sum & 0xffffffffffffffffn).toString(16).padStart(16, '0');
}

/**
 * Hashes a remote file. `head` is the first 64 KiB when already at hand; the
 * last 64 KiB is one small range request of its own.
 */
export async function remoteFileHash(url, size, {headers = {}, head = null, signal, fetchFn = (...a) => globalThis.fetch(...a)} = {}) {
  if (!(size >= HASH_CHUNK * 2)) return null;
  const range = async (start, end) => {
    const r = await fetchFn(url, {headers: {...headers, Range: `bytes=${start}-${end - 1}`}, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
    if (r.status !== 206) { r.body?.cancel().catch(() => {}); throw Error('range'); }
    return new Uint8Array(await r.arrayBuffer());
  };
  const [first, last] = await Promise.all([head && head.length >= HASH_CHUNK ? head : range(0, HASH_CHUNK), range(size - HASH_CHUNK, size)]);
  return openSubtitlesHash(size, first, last);
}
