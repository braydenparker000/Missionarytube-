// MediaRouteButton (cc_button): the Cast button. The reference enables it
// while a cast route is available (os0) and its disabledAlpha of 0 hides it
// otherwise. Here the Remote Playback API's availability for the player's
// media elements decides, and a tap opens the browser's device picker.
import {FastButton} from '../view/text.js';
import {register} from '../view/inflater.js';

export class MediaRouteButton extends FastButton {
  constructor(ctx, a) {
    super(ctx, a);
    // ?media_route: mr_button_dark / _light (disconnected, connecting, connected).
    const d = ctx.drawables.fromValue('?media_route', a.theme);
    if (d) this.setDrawable(d);
    this.available = new Set();
    this.setEnabled(false);
    queueMicrotask(() => this.watch());
  }

  watch() {
    for (const el of this.ctx.player?.decks ?? []) {
      el.remote?.watchAvailability?.(on => {
        if (on) this.available.add(el); else this.available.delete(el);
        this.setEnabled(this.available.size > 0);
      }).catch(() => { /* not supported for this element or browser */ });
    }
  }

  onClick() {
    if (!this.state.enabled) return;
    this.ctx.player?.audio?.remote?.prompt().catch(() => { /* dismissed or unavailable */ });
  }
}

register(['MediaRouteButton'], MediaRouteButton);
