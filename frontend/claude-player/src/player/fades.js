// Fades (fade.xml / b40: crossfade_auto_advance, fade_manual_advance,
// fade_play_pause, fade_seek, track_end_silence_ms and their lengths;
// notebook F70). The reference hands these to its native pipeline
// (Pipeline2.l / q / n / r / u); the curves there are not in the bytecode.
// Here each deck's fade gain runs in the audio engine (dsp.js): cross-fades
// are equal power, pause / play / seek fades a smooth S-curve, and a fade-in
// starts with the deck's sound, not before it (a stream can take a moment).
// Before the graph exists the element's volume ramps instead.

export const AUTO_NONE = 0, AUTO_NON_GAPLESS = 1, AUTO_ALL = 2, AUTO_SHUFFLED = 3;
export const MANUAL_NONE = 0, MANUAL_SHORT = 1, MANUAL_CROSSFADE = 2;

/** The fade preferences with their reference defaults. */
export function fadePrefs(ctx) {
  const n = (k, d) => { const v = +ctx.pref?.(k); return Number.isFinite(v) ? v : d; };
  const b = (k, d) => { const v = ctx.pref?.(k); return v === undefined ? d : v === true || v === 'true'; };
  return {
    auto: n('crossfade_auto_advance', AUTO_NONE),
    manual: n('fade_manual_advance', MANUAL_SHORT),
    playPause: b('fade_play_pause', true),
    seek: b('fade_seek', true),
    endSilenceMs: n('track_end_silence_ms', 0),
    crossfadeMs: n('crossfade_length_ms', 5000),
    shortXfadeMs: n('fade_short_xfade_ms', 400),
    shortMs: n('fade_short_ms', 400),
    seekMs: n('fade_seek_ms', 100),
  };
}

/**
 * "Non-gapless/cue" leaves gapless pairs alone: the next track continues the
 * same album in the same folder (track number + 1, same disc). Inferred.
 */
export function gaplessPair(a, b) {
  if (!a || !b || !a.album || a.album.toLowerCase() !== String(b.album ?? '').toLowerCase()) return false;
  const dir = t => { const p = t.path || ''; return p.slice(0, p.lastIndexOf('/')); };
  return dir(a) === dir(b) && (a.disc || 0) === (b.disc || 0) && +b.track === +a.track + 1;
}

/** A fade short enough to go unheard as a fade: it only keeps a cut or a start from clicking. */
export const DECLICK_MS = 8;

/** Gain ramps per deck (media element). */
export class DeckFader {
  constructor(ctx) {
    this.ctx = ctx;
    this.pending = new Map();
  }

  /** The DSP when el plays through its graph (fades run in the engine), else null. */
  graph(el) {
    const dsp = this.ctx.dsp;
    return dsp?.hasDeck?.(el) ? dsp : null;
  }

  /** Forgets el's pending ramp (its done callback will not run); the gain goes on as it was. */
  cancel(el) {
    const p = this.pending.get(el);
    if (!p) return false;
    clearTimeout(p.timer);
    p.cancel?.();
    if (p.seeked) el.removeEventListener('seeked', p.seeked);
    this.pending.delete(el);
    return true;
  }

  /** Stops el's fade where it is. */
  stop(el) {
    if (this.cancel(el)) this.graph(el)?.fadeHold(el);
  }

  set(el, v) {
    this.cancel(el);
    const dsp = this.graph(el);
    if (dsp) {
      dsp.fadeSet(el, v);
      el.volume = 1;
    } else el.volume = v;
  }

  /**
   * Ramps el's gain to `to` over ms, then calls done. opts.curve: 'linear',
   * 'equal' (equal power) or 'smooth'; opts.gate: start when the deck's sound
   * begins; opts.after: start when that deck's sound begins (opts.keepEnd:
   * still end on time; opts.timeoutMs: the longest wait); opts.seeked: wait
   * for the element's seek to finish before gating on its sound.
   */
  ramp(el, to, ms, done = null, opts = {}) {
    // The new fade takes over from the running one (no hold between them, so the gain turns smoothly).
    this.cancel(el);
    const entry = {};
    this.pending.set(el, entry);
    const finish = () => {
      if (this.pending.get(el) !== entry) return;
      this.pending.delete(el);
      clearTimeout(entry.timer);
      done?.();
    };
    const dsp = this.graph(el);
    if (dsp) {
      const send = () => {
        if (entry.seeked) { el.removeEventListener('seeked', entry.seeked); entry.seeked = null; }
        clearTimeout(entry.timer);
        dsp.fade(el, to, ms, opts, finish);
        // A safety net should the engine stop answering: the longest the fade can take.
        entry.timer = setTimeout(finish, ms + (opts.gate || opts.after ? opts.timeoutMs ?? 4000 : 0) + 1000);
      };
      if (opts.seeked && el.seeking) {
        entry.seeked = () => { if (this.pending.get(el) === entry) send(); };
        el.addEventListener('seeked', entry.seeked);
        entry.timer = setTimeout(send, 5000);
      } else send();
      return;
    }
    const from = el.volume;
    let t0 = null;
    entry.cancel = this.ctx.onFrame?.(now => {
      t0 ??= now;
      const k = Math.min(1, (now - t0) / Math.max(1, ms));
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      return k < 1;
    });
    entry.timer = setTimeout(finish, ms);
  }
}

/**
 * ReplayGain (rg.xml; F71): rg_type 0 none, 1 gain, 2 gain limited by the
 * peak; rg_source 0 album (track when absent), 1 track (album when absent);
 * rg_preamp_mb adds to tagged songs, rg_default_mb is the gain of songs
 * without ReplayGain (millibels). Linear gain.
 */
export function replayGainOf(ctx, t) {
  const type = +(ctx.pref?.('rg_type') ?? 0) || 0;
  if (!type || !t) return 1;
  const album = +(ctx.pref?.('rg_source') ?? 0) === 0;
  const rg = t.replayGain ?? {};
  const pick = (a, b) => (a !== undefined && a !== null && Number.isFinite(+a) ? +a : b !== undefined && b !== null && Number.isFinite(+b) ? +b : null);
  const gain = album ? pick(rg.album, rg.track) : pick(rg.track, rg.album);
  const peak = album ? pick(rg.albumPeak, rg.trackPeak) : pick(rg.trackPeak, rg.albumPeak);
  const db = gain === null ? (+(ctx.pref?.('rg_default_mb') ?? 0) || 0) / 100 : gain + (+(ctx.pref?.('rg_preamp_mb') ?? 0) || 0) / 100;
  let lin = Math.pow(10, db / 20);
  if (type === 2 && gain !== null && peak > 0) lin = Math.min(lin, 1 / peak);
  return lin;
}
