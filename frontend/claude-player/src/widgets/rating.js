// Track ratings on items (merge_item_aa_rating_thumbs / _stars): rating 5 is
// "like", 1 "unlike", 0 none (LikeUnlikeLayout); the star bar (RatingBar,
// rating_type 2/3) sets 1..5 by tapping or swiping over the stars. Both send
// cmd_data_track_rating {arg1: rating, track} on bus_data_cmd and follow
// msg_data_track_rating_changed for their item's track.
import {View} from '../view/view.js';
import {FastLayout} from '../view/fast-layout.js';
import {register} from '../view/inflater.js';
import {renderOps} from '../view/drawables.js';

export const RATING_LIKE = 5, RATING_UNLIKE = 1;

/** The track of the item a view sits in. */
function itemTrack(v) {
  for (let p = v.parent; p; p = p.parent) if (p.track !== undefined) return p.track;
  return null;
}

function sendRating(view, rating) {
  const track = itemTrack(view);
  if (track) view.ctx.bus.post('bus_data_cmd', 'cmd_data_track_rating', view, {arg1: rating, track});
}

export class LikeUnlikeLayout extends FastLayout {
  onFinishInflate() {
    this.like = this.findViewById('like');
    this.unlike = this.findViewById('unlike');
    for (const b of [this.like, this.unlike]) {
      if (!b) continue;
      // Exclusive checks: checking one clears the other.
      b.onClick = () => {
        const on = !b.state.checked;
        sendRating(this, on ? (b === this.like ? RATING_LIKE : RATING_UNLIKE) : 0);
      };
    }
  }

  setRating(r) {
    this.like?.setChecked(r === RATING_LIKE);
    this.unlike?.setChecked(r === RATING_UNLIKE);
  }
}

export class RatingBar extends View {
  constructor(ctx, a) {
    super(ctx, a);
    this.clickable = true;
    this.numStars = a.int('android:numStars', 5);
    this.rating = 0;
    const on = a.ref('android:drawable'), off = a.ref('drawableOff'), bg = a.ref('lineBackground');
    const tint = a.color('drawableTint') ?? null;
    const tinted = d => (d && tint ? d.withTint(tint) : d);
    this.starOn = tinted(on ? ctx.drawables.fromRef(on, a.theme) : null);
    this.starOff = tinted(off ? ctx.drawables.fromRef(off, a.theme) : null);
    this.lineBg = bg ? ctx.drawables.fromRef(bg, a.theme) : null;
    this.starW = a.dim('drawableWidth', Math.round(24 * ctx.dpr));
    this.starH = a.dim('drawableHeight', this.starW);
    this.opsEl = document.createElement('div');
    this.opsEl.className = 'ops';
    this.el.appendChild(this.opsEl);
  }

  setRating(r) {
    if (this.rating === r) return;
    this.rating = r;
    this.invalidate();
  }

  onMeasure(wSpec, hSpec) {
    const w = this.paddingLeft + this.paddingRight + this.numStars * this.starW;
    const h = this.paddingTop + this.paddingBottom + this.starH;
    this.setMeasuredDimension(Math.max(w, this.minWidth ?? 0), Math.max(h, this.minHeight ?? 0));
  }

  draw() {
    super.draw();
    const ops = [];
    this.lineBg?.ops(this.width, this.height, this.state, ops, 0, 0);
    for (let i = 0; i < this.numStars; i++) {
      const d = i < this.rating ? this.starOn : this.starOff;
      d?.ops(this.starW, this.starH, this.state, ops, this.paddingLeft + i * this.starW, this.paddingTop);
    }
    renderOps(this.opsEl, ops, this.ctx.px);
  }

  starAt(x) {
    return Math.max(0, Math.min(this.numStars, Math.ceil((x - this.paddingLeft) / this.starW)));
  }

  // Swiping over the stars picks a rating; releasing sends it.
  onPointerDown(e) {
    this.dragRating = this.starAt(e.x);
    this.setRating(this.dragRating);
    return true;
  }

  onPointerMove(e) {
    this.dragRating = this.starAt(e.x);
    this.setRating(this.dragRating);
  }

  onPointerUp() {
    if (this.dragRating === undefined) return;
    sendRating(this, this.dragRating);
    this.dragRating = undefined;
  }
}

register(['LikeUnlikeLayout'], LikeUnlikeLayout);
register(['RatingBar'], RatingBar);
