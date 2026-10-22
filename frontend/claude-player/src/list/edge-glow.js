// Edge glow (hj0, PowerList's own copy of the platform's pre-12 EdgeEffect;
// notebook F80). A pull at a list end grows a glow arc there; a release fades
// it; a fling into the end absorbs its velocity. PowerList draws the top glow
// as is and the bottom one turned half round. The colour is the theme's
// android:colorEdgeEffect: transparent (no glow) in the default themes.
const SIN = Math.sin(Math.PI / 6), COS = Math.cos(Math.PI / 6);
const IDLE = 0, PULL = 1, ABSORB = 2, RECEDE = 3, PULL_DECAY = 4;
const decelerate = t => 1 - (1 - t) * (1 - t);

export class EdgeGlow {
  constructor(color) {
    this.color = color;
    this.state = IDLE;
    this.w = 0; this.h = 0; this.radius = 0; this.baseScale = 1;
    this.alpha = 0; this.scaleY = 0;
    this.alphaStart = 0; this.alphaEnd = 0; this.scaleStart = 0; this.scaleEnd = 0;
    this.start = 0; this.duration = 0;
    this.pull = 0; this.disp = 0.5; this.dispTarget = 0.5;
  }

  get finished() { return this.state === IDLE; }

  /** X(): the arc for an edge of width w over a list h high (ratio 0.75 vertical). */
  setSize(w, h, ratio = 0.75) {
    const r = (w * ratio) / SIN, arc = r - COS * r;
    const r2 = (0.75 * h) / SIN, arc2 = r2 - COS * r2;
    this.radius = r;
    this.baseScale = arc > 0 ? Math.min(arc2 / arc, 1) : 1;
    this.w = w;
    this.h = Math.min(h, arc);
  }

  /** Height the glow may cover (B()). */
  get extent() { return Math.round(this.h * 2); }

  /** onPull (m1941): deltaDistance of the list's size, displacement across it (0..1). */
  onPull(delta, displacement, now) {
    this.dispTarget = displacement;
    if (this.state === PULL_DECAY && now - this.start < this.duration) return;
    if (this.state !== PULL) this.scaleY = Math.max(0, this.scaleY);
    this.state = PULL;
    this.start = now;
    this.duration = 167;
    this.pull += delta;
    const a = Math.min(0.5, Math.abs(delta) * 0.8 + this.alpha);
    this.alphaStart = this.alpha = a;
    if (this.pull <= 0) {
      this.pull = 0;
      this.scaleStart = this.scaleY = 0;
    } else {
      const s = Math.max(0, 1 - 1 / Math.sqrt(Math.abs(this.pull) * this.h) - 0.3) / 0.7;
      this.scaleStart = this.scaleY = s;
    }
    this.alphaEnd = this.alpha;
    this.scaleEnd = this.scaleY;
  }

  /** onRelease (m1940). */
  onRelease(now) {
    this.pull = 0;
    if (this.state !== PULL && this.state !== PULL_DECAY) return;
    this.state = RECEDE;
    this.alphaStart = this.alpha;
    this.scaleStart = this.scaleY;
    this.alphaEnd = 0;
    this.scaleEnd = 0;
    this.start = now;
    this.duration = 600;
  }

  /** onAbsorb (A): a fling hits the edge at v px/s (PowerList passes v / 5). */
  onAbsorb(v, now) {
    this.state = ABSORB;
    const vel = Math.min(Math.max(100, Math.abs(v)), 10000);
    this.start = now;
    this.duration = vel * 0.02 + 0.15;
    this.alphaStart = 0.3;
    this.scaleStart = Math.max(this.scaleY, 0);
    this.scaleEnd = Math.min(((Math.floor(vel / 100) * vel * 1.5e-4) / 2) + 0.025, 1);
    this.alphaEnd = Math.max(this.alphaStart, Math.min(vel * 6 * 1e-5, 0.5));
    this.dispTarget = 0.5;
  }

  /**
   * Draws the glow into a 2D context set up for the top edge (m1939); returns
   * true while it needs more frames.
   */
  draw(g, now) {
    const t = Math.min((now - this.start) / this.duration, 1);
    const k = decelerate(t);
    this.alpha = this.alphaStart + (this.alphaEnd - this.alphaStart) * k;
    this.scaleY = this.scaleStart + (this.scaleEnd - this.scaleStart) * k;
    this.disp = (this.disp + this.dispTarget) / 2;
    let done = false;
    if (t >= 0.999) {
      const s = this.state;
      if (s === PULL) this.decay(PULL_DECAY, 2000);
      else if (s === ABSORB) this.decay(RECEDE, 600);
      else if (s === RECEDE) this.state = IDLE;
      else if (s === PULL_DECAY) this.state = RECEDE;
    }
    const cx = this.w / 2, cy = this.h - this.radius;
    g.save();
    g.translate(cx, 0);
    g.scale(1, Math.min(this.scaleY, 1) * this.baseScale);
    g.translate(-cx, 0);
    const shift = (this.w * (Math.max(0, Math.min(this.disp, 1)) - 0.5)) / 2;
    g.globalAlpha = Math.round(this.alpha * 255) / 255;
    g.fillStyle = this.color;
    g.beginPath();
    g.arc(cx + shift, cy, this.radius, 0, Math.PI * 2);
    g.fill();
    g.restore();
    if (this.state === RECEDE && this.scaleY === 0) { this.state = IDLE; done = true; }
    return this.state !== IDLE || done;
  }

  decay(state, ms) {
    this.state = state;
    this.start = performance.now();
    this.duration = ms;
    this.alphaStart = this.alpha;
    this.scaleStart = this.scaleY;
    this.alphaEnd = 0;
    this.scaleEnd = 0;
  }
}
