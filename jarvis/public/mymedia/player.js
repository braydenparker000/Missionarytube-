// Plays a Drive file in a <video>. The browser's own decoder handles MP4 and
// WebM. When it refuses a file (MKV, AC-3/DTS audio, codecs without hardware
// support), Astra's compatibility remuxer and software decoder take over.
const ASTRA = '/media/assets/js/playback/';
// Order matters: the software decoder needs request policy, and the
// compatibility player hands off to the software decoder when present.
const FALLBACK_SCRIPTS = ['request-policy.js', 'software-player.js', 'compatibility.js'];
let fallbackLoad = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(Error('The compatibility player could not load.')); };
    document.head.append(script);
  });
}

function loadFallback() {
  if (globalThis.AstraCompatibility) return Promise.resolve();
  fallbackLoad ??= FALLBACK_SCRIPTS.reduce((chain, name) => chain.then(() => loadScript(ASTRA + name)), Promise.resolve())
    .catch(error => { fallbackLoad = null; throw error; });
  return fallbackLoad;
}

// MEDIA_ERR_DECODE (3) and MEDIA_ERR_SRC_NOT_SUPPORTED (4) mean the format,
// not the network, is the problem.
const formatProblem = media => [3, 4].includes(media.error?.code);

// A refused Drive request (sharing, quota, key) also surfaces as "not
// supported". Ask for one byte to tell the two apart before switching decoders.
export async function driveProblem(url, fetcher = fetch) {
  try {
    const response = await fetcher(url, {headers:{Range:'bytes=0-0'}, credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store'});
    await response.body?.cancel();
    if (response.ok) return '';
    if (response.status === 404) return 'This video is no longer in Drive. Refresh the library.';
    if (response.status === 403 || response.status === 429) return 'Drive refused this video right now. If it was played a lot today, Drive may limit it for up to a day; otherwise check the folder is shared as Anyone with the link.';
    return 'Drive could not send this video (HTTP ' + response.status + ').';
  } catch {
    return 'The video could not be reached. Check your connection, then try again.';
  }
}

export function play(media, url, {startTime = 0, onError = () => {}, onMode = () => {}, stallMs = 12000, retryDelayMs = 650} = {}) {
  let adapter = null, closed = false, fellBack = false, retries = 0, failed = false;
  let resumeAt = startTime, restartTimer = null, stallTimer = null;
  const cleanup = [];
  const listen = (type, fn) => { media.addEventListener(type, fn); cleanup.push(() => media.removeEventListener(type, fn)); };
  const clearStall = () => { clearTimeout(stallTimer); stallTimer = null; };
  const fail = message => {
    if (closed || failed) return;
    failed = true;
    clearStall();
    onError(message);
  };
  const startNative = () => {
    if (closed || fellBack) return;
    media.src = url;
    media.load();
    media.play().catch(() => {});
  };
  const retryNative = reason => {
    if (closed || fellBack || retries >= 1) return false;
    retries++;
    resumeAt = media.currentTime || resumeAt;
    clearStall();
    onMode('retrying', reason);
    media.pause();
    media.removeAttribute('src');
    media.load();
    restartTimer = setTimeout(startNative, retryDelayMs);
    return true;
  };
  const armStallRetry = () => {
    if (closed || fellBack || failed || media.paused || media.ended) return;
    clearStall();
    stallTimer = setTimeout(() => {
      if (closed || fellBack || failed) return;
      if (!retryNative('stalled')) fail('The video stopped loading. Check your connection, then retry.');
    }, stallMs);
  };

  async function fallback() {
    if (fellBack || closed || failed) return;
    fellBack = true;
    clearStall();
    clearTimeout(restartTimer);
    const at = media.currentTime || startTime;
    onMode('compatibility');
    try {
      await loadFallback();
      if (closed) return;
      media.removeAttribute('src'); media.load();
      adapter = globalThis.AstraCompatibility.createAdapter({media, url, startTime:at, autoplay:true,
        onError:e => !closed && onError(e?.detail || 'This video could not be played on this device.')});
      await adapter.attach();
    } catch (error) {
      if (!closed && error?.name !== 'AbortError') onError(error?.message || 'This video could not be played on this device.');
    }
  }

  listen('error', async () => {
    if (closed || fellBack || failed) return;
    if (!formatProblem(media)) {
      if (!retryNative('network')) fail('The video stopped loading. Check your connection, then retry.');
      return;
    }
    const problem = await driveProblem(url);
    if (closed) return;
    if (problem) fail(problem); else fallback();
  });
  // A transient Drive connection can stall without emitting a media error.
  // Give it one clean reload, preserving the playhead, before surfacing failure.
  listen('waiting', armStallRetry);
  listen('stalled', armStallRetry);
  listen('play', () => { if (retries) armStallRetry(); });
  listen('playing', clearStall);
  listen('timeupdate', clearStall);
  // Chrome sometimes plays the audio of an unsupported video track with no picture.
  // Wait for actual frame data: loadedmetadata can fire before dimensions settle.
  listen('loadeddata', () => {
    clearStall();
    if (!fellBack && media.videoWidth === 0 && media.duration > 0 && !media.error) fallback();
  });
  listen('loadedmetadata', () => {
    if (resumeAt > 0 && !fellBack) {
      try { media.currentTime = Math.min(resumeAt, Number.isFinite(media.duration) ? Math.max(0, media.duration - .25) : resumeAt); } catch {}
    }
  });
  onMode('native');
  startNative();

  return {
    get mode() { return fellBack ? 'compatibility' : 'native'; },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(restartTimer);
      clearStall();
      cleanup.forEach(fn => fn());
      adapter?.destroy();
      media.pause(); media.removeAttribute('src'); media.load();
    },
    seek(seconds) {
      const target = Math.max(0, Math.min(media.duration || Infinity, seconds));
      if (adapter?.seekTo) adapter.seekTo(target); else media.currentTime = target;
    }
  };
}
