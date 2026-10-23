// Draws subtitle cues over the picture. Text is built from text nodes only.
// Style and timing offset are the viewer's; positions come from the cue.
// Picture subtitles (PGS, VobSub) are drawn on canvases placed over the part
// of the element the video actually fills, so Fit, Fill and Zoom line up.

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
      const key = cue.key || cue.start.toFixed(3) + '|' + cue.spans.map(s => s.text).join('');
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
  /** Recomputes the longest cue after end times were changed in place. */
  refresh() { this.longest = this.cues.reduce((m, c) => Math.max(m, c.end - c.start), 0); }
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
    this.pictures = document.createElement('div');
    this.pictures.className = 'astra-subs-pictures';
    layer.append(this.free, this.pictures);
    this.canvases = new WeakMap(); // cue part -> drawn canvas
    this.resize = new ResizeObserver(() => { this.applyStyle(); this.shown = null; this.render(); });
    this.resize.observe(layer);
    this.tick = () => { this.frame = 0; this.render(); if (!this.video.paused) this.schedule(); };
    // Frame callbacks keep cues exact while playing; the events also draw at
    // once, since a paused seek may not present a frame callback.
    for (const type of ['play', 'seeked', 'timeupdate', 'loadeddata']) video.addEventListener(type, () => { this.render(); this.schedule(); });
    video.addEventListener('resize', () => { this.shown = null; this.render(); });
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
  /** Cue end times changed in place (picture subtitles learn their end later). */
  refresh() { this.list.refresh(); this.shown = null; this.render(); }

  setStyle(style) { this.style = {...this.style, ...style}; this.applyStyle(); }
  setDelay(seconds) { this.delay = Math.round(seconds * 10) / 10; this.shown = null; this.render(); }

  applyStyle() {
    // Sized from the picture's height, but never below a phone-readable size
    // (a portrait screen shows a short picture band).
    const h = Math.max(this.layer.clientHeight || 360, 340), s = this.style;
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
    this.pictures.replaceChildren();
    for (const cue of active) {
      if (cue.image) { this.drawPicture(cue.image); continue; }
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

  /** The rectangle (in layer pixels) the video picture occupies, measured from the video element itself. */
  pictureRect() {
    const box = this.video.getBoundingClientRect(), layer = this.layer.getBoundingClientRect();
    const W = box.width, H = box.height, vw = this.video.videoWidth, vh = this.video.videoHeight;
    const ox = box.left - layer.left, oy = box.top - layer.top;
    if (!vw || !vh || !W || !H) return {x: ox, y: oy, w: W || layer.width, h: H || layer.height};
    const fit = getComputedStyle(this.video).objectFit;
    if (fit === 'fill') return {x: ox, y: oy, w: W, h: H};
    const scale = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
    const w = vw * scale, h = vh * scale;
    return {x: ox + (W - w) / 2, y: oy + (H - h) / 2, w, h};
  }

  drawPicture(image) {
    const rect = this.pictureRect();
    const sx = rect.w / (image.frameWidth || this.video.videoWidth || rect.w), sy = rect.h / (image.frameHeight || this.video.videoHeight || rect.h);
    for (const part of image.parts) {
      let canvas = this.canvases.get(part);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = part.width; canvas.height = part.height;
        canvas.className = 'astra-sub-picture';
        try {
          const pixels = part.draw();
          canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), part.width, part.height), 0, 0);
        } catch { continue; }
        this.canvases.set(part, canvas);
      }
      Object.assign(canvas.style, {left: (rect.x + part.x * sx).toFixed(1) + 'px', top: (rect.y + part.y * sy).toFixed(1) + 'px', width: (part.width * sx).toFixed(1) + 'px', height: (part.height * sy).toFixed(1) + 'px'});
      this.pictures.append(canvas);
    }
  }

  destroy() {
    this.resize.disconnect();
    if (this.frame && this.frameKind === 'video') this.video.cancelVideoFrameCallback?.(this.frame); else cancelAnimationFrame(this.frame);
    this.layer.replaceChildren();
  }
}
