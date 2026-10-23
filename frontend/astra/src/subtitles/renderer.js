// Draws subtitle cues over the picture. Text is built from text nodes only.
// Style and timing offset are the viewer's; positions come from the cue.

export const DEFAULT_STYLE = Object.freeze({
  size: 1, // multiple of the base size (5.2% of the picture height)
  color: '#ffffff',
  background: 0, // 0..1 opacity of a box behind each line
  outline: true,
  bold: false,
  offset: 6, // % of the picture height above the bottom
});

const ZONES = ['top', 'middle', 'bottom'];
const zoneOf = align => align >= 7 ? 'top' : align >= 4 ? 'middle' : 'bottom';
const columnOf = align => ['left', 'center', 'right'][(align - 1) % 3];

export class CueList {
  constructor() { this.cues = []; this.keys = new Set(); this.longest = 0; }
  add(cues) {
    let added = 0;
    for (const cue of cues) {
      const key = cue.start.toFixed(3) + '|' + cue.spans.map(s => s.text).join('');
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.longest = Math.max(this.longest, cue.end - cue.start);
      // Cues mostly arrive in order: insert from the end.
      let i = this.cues.length;
      while (i > 0 && this.cues[i - 1].start > cue.start) i--;
      this.cues.splice(i, 0, cue);
      added++;
    }
    return added;
  }
  /** Cues showing at time t. */
  at(t) {
    let lo = 0, hi = this.cues.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cues[mid].start <= t) lo = mid + 1; else hi = mid; }
    const active = [];
    for (let i = lo - 1; i >= 0 && this.cues[i].start >= t - this.longest; i--) if (this.cues[i].end > t) active.unshift(this.cues[i]);
    return active;
  }
  get size() { return this.cues.length; }
}

export class SubtitleRenderer {
  /**
   * @param {HTMLElement} layer  positioned over the video, same box
   * @param {HTMLVideoElement} video
   */
  constructor(layer, video) {
    this.layer = layer;
    this.video = video;
    this.list = new CueList();
    this.delay = 0; // seconds; positive shows subtitles later
    this.style = {...DEFAULT_STYLE};
    this.shown = '';
    this.frame = 0;
    layer.classList.add('astra-subs');
    layer.setAttribute('aria-live', 'off');
    this.zones = Object.fromEntries(ZONES.map(z => { const el = document.createElement('div'); el.className = 'astra-subs-zone ' + z; layer.append(el); return [z, el]; }));
    this.free = document.createElement('div');
    this.free.className = 'astra-subs-free';
    layer.append(this.free);
    this.resize = new ResizeObserver(() => this.applyStyle());
    this.resize.observe(layer);
    this.tick = () => { this.frame = 0; this.render(); if (!this.video.paused) this.schedule(); };
    for (const type of ['play', 'seeked', 'timeupdate', 'loadeddata']) video.addEventListener(type, () => this.schedule());
    this.applyStyle();
  }

  schedule() {
    if (this.frame) return;
    this.frame = this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(this.tick) : requestAnimationFrame(this.tick);
    this.frameKind = this.video.requestVideoFrameCallback ? 'video' : 'animation';
  }

  /** Replaces all cues (switching track). */
  setCues(cues = []) { this.list = new CueList(); this.list.add(cues); this.shown = null; this.render(); }
  /** Adds cues found while playing. */
  addCues(cues) { if (this.list.add(cues)) { this.shown = null; this.render(); } }
  clear() { this.setCues([]); }

  setStyle(style) { this.style = {...this.style, ...style}; this.applyStyle(); }
  setDelay(seconds) { this.delay = Math.round(seconds * 10) / 10; this.shown = null; this.render(); }

  applyStyle() {
    const h = this.layer.clientHeight || 360, s = this.style;
    const px = Math.max(12, h * 0.052 * s.size);
    const L = this.layer.style;
    L.setProperty('--sub-size', px.toFixed(1) + 'px');
    L.setProperty('--sub-color', s.color);
    L.setProperty('--sub-box', `rgba(0,0,0,${s.background})`);
    L.setProperty('--sub-weight', s.bold ? '700' : '500');
    L.setProperty('--sub-offset', s.offset + '%');
    const o = Math.max(1, px / 14).toFixed(1);
    L.setProperty('--sub-shadow', s.outline ? `0 0 ${o}px #000, ${o}px ${o}px 0 #000, -${o}px -${o}px 0 #000, ${o}px -${o}px 0 #000, -${o}px ${o}px 0 #000` : '0 1px 3px rgba(0,0,0,.6)');
  }

  render() {
    const t = this.video.currentTime - this.delay;
    const active = this.list.at(t);
    const key = active.map(c => c.start + ':' + c.end).join(',');
    if (key === this.shown) return;
    this.shown = key;
    for (const z of Object.values(this.zones)) z.replaceChildren();
    this.free.replaceChildren();
    for (const cue of active) {
      const el = document.createElement('div');
      el.className = 'astra-sub ' + columnOf(cue.align || 2);
      for (const span of cue.spans) {
        const lines = span.text.split('\n');
        lines.forEach((line, i) => {
          if (i) el.append(document.createElement('br'));
          if (!line) return;
          const node = document.createElement('span');
          node.textContent = line;
          if (span.i) node.style.fontStyle = 'italic';
          if (span.b) node.style.fontWeight = '700';
          if (span.u) node.style.textDecoration = 'underline';
          if (span.color && /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(span.color)) node.style.color = span.color;
          el.append(node);
        });
      }
      if (cue.pos) {
        el.style.left = (cue.pos.x * 100).toFixed(2) + '%';
        el.style.top = (cue.pos.y * 100).toFixed(2) + '%';
        const col = (cue.align - 1) % 3, row = cue.align >= 7 ? 0 : cue.align >= 4 ? 50 : 100;
        el.style.transform = `translate(${-col * 50}%, -${row}%)`;
        this.free.append(el);
      } else this.zones[zoneOf(cue.align || 2)].append(el);
    }
  }

  destroy() {
    this.resize.disconnect();
    if (this.frame && this.frameKind === 'video') this.video.cancelVideoFrameCallback?.(this.frame); else cancelAnimationFrame(this.frame);
    this.layer.replaceChildren();
  }
}
