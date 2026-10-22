// Fades (fade.xml / b40: crossfade_auto_advance, fade_manual_advance,
// fade_play_pause, fade_seek, track_end_silence_ms and their lengths;
// notebook F70). The reference hands these to its native pipeline
// (Pipeline2.l / q / n / r / u); the curves there are not in the bytecode,
// so here every fade is a linear gain ramp on the element's own gain in the
// DSP graph (its volume before the graph exists).

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

/** Gain ramps per media element. */
export class DeckFader {
  constructor(ctx) {
    this.ctx = ctx;
    this.pending = new Map();
  }

  gain(el) {
    return this.ctx.dsp?.deckGain?.(el) ?? null;
  }

  value(el) {
    const g = this.gain(el);
    return g ? g.gain.value : el.volume;
  }

  stop(el) {
    const p = this.pending.get(el);
    if (!p) return;
    clearTimeout(p.timer);
    p.cancel?.();
    this.pending.delete(el);
    const g = this.gain(el);
    if (g) {
      const t = g.context.currentTime, v = g.gain.value;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(v, t);
    }
  }

  set(el, v) {
    this.stop(el);
    const g = this.gain(el);
    if (g) {
      const t = g.context.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(v, t);
      el.volume = 1;
    } else el.volume = v;
  }

  /** Ramps el's gain to `to` over ms (linear), then calls done. */
  ramp(el, to, ms, done = null) {
    this.stop(el);
    const g = this.gain(el), entry = {};
    this.pending.set(el, entry);
    if (g) {
      const t = g.context.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(to, t + ms / 1000);
    } else {
      const from = el.volume;
      let t0 = null;
      entry.cancel = this.ctx.onFrame?.(now => {
        t0 ??= now;
        const k = Math.min(1, (now - t0) / Math.max(1, ms));
        el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
        return k < 1;
      });
    }
    entry.timer = setTimeout(() => {
      if (this.pending.get(el) === entry) this.pending.delete(el);
      done?.();
    }, ms);
  }
}
