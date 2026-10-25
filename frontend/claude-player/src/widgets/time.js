// Elapsed / Duration labels of the player screen.
import {FastTextView, measureText} from '../view/text.js';
import {register} from '../view/inflater.js';
import {formatTime, msToLabelSeconds, STATE_PLAYING, STATE_STOPPED} from '../player/player.js';

/** Elapsed time: whole seconds rounded from ms, refreshed every 250 ms while playing. */
export class Elapsed extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    this.shownSeconds = -1;
    this.seeking = false;
    this.timer = 0;
    this.longClickable = true;
    ctx.bus.subscribe('bus_player', (msg, src, d) => {
      if (msg === 'msg_player_playing_state_changed') this.onPlayingState(d.arg1);
      else if (msg === 'msg_player_track_changed' || msg === 'msg_player_track_seek') this.refresh(true);
    });
    ctx.bus.subscribe('bus_gui', (msg, src, d) => {
      if (msg === 'msg_gui_intermediate_seek_start') { this.stopTimer(); this.seeking = true; }
      else if (msg === 'msg_gui_intermediate_seek') this.show(d.arg1, true);
      else if (msg === 'msg_gui_intermediate_seek_end') { this.seeking = false; if (ctx.player?.state === STATE_PLAYING) this.startTimer(); }
    });
    this.refresh(true);
  }

  refresh(force) {
    const p = this.ctx.player;
    this.show(p ? p.positionMs() : 0, force);
  }

  show(ms, relayout) {
    const s = msToLabelSeconds(ms);
    if (s === this.shownSeconds) return;
    const text = formatTime(s, false);
    // Same-length updates keep the measured layout (Elapsed.W: FastTextView.T
    // flag 1, the text laid out again in the view's width). The reference's
    // centred label without ellipsis may run into its padding; digits differ
    // in width, so a text the width does not hold is measured again instead
    // of losing a character.
    const [pl, pr] = this.textPaddings();
    if (!relayout && text.length === this.text.length && this.width > 0 && measureText(text, this.font, this.effectiveTextSize(), this.letterSpacing) <= this.width - pl - pr) {
      this.text = text;
      this.layoutText(this.width - pl - pr);
      this.positionText();
    } else this.setText(text);
    this.shownSeconds = s;
  }

  onPlayingState(state) {
    this.refresh(false);
    if (state === STATE_PLAYING) this.startTimer();
    else {
      this.stopTimer();
      if (state === STATE_STOPPED) this.show(0, true);
    }
  }

  startTimer() {
    if (this.timer || this.seeking) return;
    const tick = () => {
      // Hidden (the screen off, another app): nothing to show; it goes on when the page shows again.
      if (document.hidden) {
        this.timer = 0;
        document.addEventListener('visibilitychange', () => { if (this.ctx.player?.state === STATE_PLAYING) this.startTimer(); }, {once: true});
        return;
      }
      this.refresh(false);
      this.timer = setTimeout(tick, 250);
    };
    this.timer = setTimeout(tick, 500);
  }

  stopTimer() {
    clearTimeout(this.timer);
    this.timer = 0;
  }

  onLongClick() {
    this.ctx.bus.post('bus_player_cmd', 'cmd_player_seek', this, {arg1: 0});
    return true;
  }
}

/** Track duration ("-:--" without a track; a stream icon for streams). */
export class Duration extends FastTextView {
  constructor(ctx, a) {
    super(ctx, a);
    ctx.bus.subscribe('bus_player', msg => {
      if (msg === 'msg_player_track_changed') this.refresh();
    });
    this.refresh();
  }

  refresh() {
    const t = this.ctx.player?.track;
    this.setText(formatTime(msToLabelSeconds(t?.durationMs ?? 0), true));
  }
}

register(['Elapsed'], Elapsed);
register(['com.maxmpz.widget.player.Duration'], Duration);
