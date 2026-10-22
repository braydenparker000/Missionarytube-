// Sleep timer popup (SleepTimerBehavior over merge_sleep_timer_popup_layout):
// the round knob spans 180°..1620° (four turns) for 0..240 minutes; the value
// label reads "%d min" or "Disabled"; the title reads "Sleep Timer: in 25 min"
// (relative time, abbreviated, periods dropped, lower case) while the timer
// runs. OK sets the timer (minutes × 60 s) and remembers the minutes and
// "play last song to end"; Disable clears it; Cancel closes. The labels
// refresh every 500 ms while the popup is open.
import {View} from '../view/view.js';
import {register} from '../view/inflater.js';

const MAX_MINUTES = 240, REFRESH_MS = 500;
const STORE_KEY = 'cp-sleep';

/**
 * Java-style format (String.format): positional (%1$s) and sequential
 * arguments, conversions s d f x %, flags "-", "0" and "+", width and
 * precision (%.1f, %02d).
 */
export function formatString(fmt, ...args) {
  let i = 0;
  return String(fmt).replace(/%(?:(\d+)\$)?([-+0]*)(\d+)?(?:\.(\d+))?([sSdfxX%n])/g, (m, pos, flags, width, prec, kind) => {
    if (kind === '%') return '%';
    if (kind === 'n') return '\n';
    const v = args[pos ? +pos - 1 : i++];
    let out;
    if (kind === 'd') out = String(Math.trunc(+v || 0));
    else if (kind === 'f') out = (+v || 0).toFixed(prec === undefined ? 6 : +prec);
    else if (kind === 'x' || kind === 'X') { out = (Math.trunc(+v || 0) >>> 0).toString(16); if (kind === 'X') out = out.toUpperCase(); }
    else { out = String(v ?? ''); if (prec !== undefined) out = out.slice(0, +prec); if (kind === 'S') out = out.toUpperCase(); }
    if (flags.includes('+') && (kind === 'd' || kind === 'f') && !out.startsWith('-')) out = '+' + out;
    if (width && out.length < +width) {
      const pad = +width - out.length;
      if (flags.includes('-')) out += ' '.repeat(pad);
      else if (flags.includes('0') && kind !== 's') out = (out[0] === '-' || out[0] === '+' ? out[0] + '0'.repeat(pad) + out.slice(1) : '0'.repeat(pad) + out);
      else out = ' '.repeat(pad) + out;
    }
    return out;
  });
}

function loadStored() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

function store(v) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

/**
 * DateUtils.getRelativeTimeSpanString(end, now, SECOND, FORMAT_ABBREV_RELATIVE)
 * with periods removed; past 3660 s the remaining minutes of the hour follow
 * ("in 2 hr 5 min").
 */
export function relativeSpan(ctx, endMs, nowMs) {
  const ms = endMs - nowMs;
  const rtf = new Intl.RelativeTimeFormat('en', {style: 'short', numeric: 'always'});
  const [n, unit] = ms < 60000 ? [Math.trunc(ms / 1000), 'second'] : ms < 3600000 ? [Math.trunc(ms / 60000), 'minute'] : [Math.trunc(ms / 3600000), 'hour'];
  let s = rtf.format(n, unit).replace(/\./g, '');
  const secs = Math.trunc(ms / 1000);
  if (secs > 3660) {
    const mins = Math.trunc(secs / 60) % 60;
    if (mins > 0) s += ' ' + formatString(ctx.res.stringByName('d_min') ?? '%d min', mins);
  }
  return s;
}

export class SleepTimerBehavior extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.visibility = 8;
    this.isBehavior = true;
    queueMicrotask(() => this.attach());
  }

  attach() {
    const host = this.host = this.parent;
    if (!host) return;
    host.sleepBehavior = this;
    const find = id => host.findViewById(id);
    this.title = find('sleep_timer_title');
    this.value = find('sleep_timer_value');
    this.playToEnd = find('play_to_end');
    this.knob = find('round_knob');
    const stored = loadStored();
    if (this.knob) {
      this.knob.minDeg = 180;
      this.knob.maxDeg = 1620;
      this.knob.setValue((stored.minutes ?? 0) / MAX_MINUTES);
      this.knob.onChange = () => this.update();
    }
    this.playToEnd?.setChecked(!!stored.playToEnd);
    for (const id of ['button1', 'button2', 'button3']) {
      const b = find(id);
      if (b) b.onClick = () => this.onButton(id);
    }
    this.ctx.bus.subscribe('bus_player', msg => { if (msg === 'msg_player_sleep_timer') this.update(); });
    this.update();
  }

  minutes() {
    return Math.round((this.knob?.value ?? 0) * MAX_MINUTES);
  }

  update() {
    const res = this.ctx.res, str = n => res.stringByName(n) ?? n;
    const sleep = this.ctx.player?.sleep;
    let state;
    if (sleep) {
      const now = performance.now();
      state = sleep.end > now ? relativeSpan(this.ctx, sleep.end, now) : '-:--';
    } else state = str('disabled');
    this.title?.setText(formatString(str('key_colon_value_s_s'), str('sleep_timer'), state.toLowerCase()));
    const m = this.minutes();
    this.value?.setText(m > 0 ? formatString(str('d_min'), m) : str('disabled'));
  }

  onButton(id) {
    const pte = !!this.playToEnd?.isChecked;
    if (id === 'button1') {
      const m = this.minutes();
      this.ctx.bus.post('bus_player_cmd', 'cmd_player_set_sleep_timer', this, {arg1: m > 0 ? m * 60 : 0, arg2: pte});
      store({minutes: m, playToEnd: pte});
    } else if (id === 'button3') {
      this.ctx.bus.post('bus_player_cmd', 'cmd_player_set_sleep_timer', this, {arg1: 0, arg2: pte});
    }
    this.host.close();
  }

  start() {
    this.update();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.update(), REFRESH_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }
}

register(['SleepTimerBehavior'], SleepTimerBehavior);
