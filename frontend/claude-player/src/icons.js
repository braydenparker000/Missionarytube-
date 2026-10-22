// Original icon set for Claude Player. Glyphs are constructed here from
// geometric primitives on a 24-unit grid; reference drawable names are mapped
// onto them by pattern so each icon keeps the reference's size and colour role.

const f = n => +n.toFixed(3);

/** Closed polygon with circular corner rounding r (0 = sharp). */
function poly(pts, r = 0) {
  if (!r) return 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z';
  let d = '';
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    const ang = Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2));
    const t = Math.min(r / Math.tan(ang / 2), l1 / 2, l2 / 2);
    const a = [p1[0] + (v1[0] / l1) * t, p1[1] + (v1[1] / l1) * t];
    const b = [p1[0] + (v2[0] / l2) * t, p1[1] + (v2[1] / l2) * t];
    d += (i === 0 ? 'M' : 'L') + f(a[0]) + ' ' + f(a[1]) + 'Q' + f(p1[0]) + ' ' + f(p1[1]) + ' ' + f(b[0]) + ' ' + f(b[1]);
  }
  return d + 'Z';
}

function rect(x, y, w, h, r = 0) {
  r = Math.min(r, w / 2, h / 2);
  if (!r) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
  return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`;
}

function circle(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}

/** Ring segment (thick arc) from angle a0 to a1 (degrees, clockwise from 3 o'clock). */
function arc(cx, cy, r, w, a0, a1) {
  const rad = d => (d * Math.PI) / 180;
  const ro = r + w / 2, ri = r - w / 2;
  const p = (rr, a) => [cx + rr * Math.cos(rad(a)), cy + rr * Math.sin(rad(a))];
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [x0, y0] = p(ro, a0), [x1, y1] = p(ro, a1), [x2, y2] = p(ri, a1), [x3, y3] = p(ri, a0);
  return `M${f(x0)} ${f(y0)}A${f(ro)} ${f(ro)} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${f(ri)} ${f(ri)} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

const tri = (x, y, w, h, r) => poly([[x, y], [x + w, y + h / 2], [x, y + h]], r);

// --- Glyph library (24x24 unless stated) ---
const G = {};
G.play = poly([[6.5, 3.5], [21, 12], [6.5, 20.5]], 0);
G.play_rounded = poly([[6.5, 3.8], [20.6, 12], [6.5, 20.2]], 1.9);
G.pause = rect(5.5, 4, 4.4, 16) + rect(14.1, 4, 4.4, 16);
G.pause_rounded = rect(5.3, 3.6, 4.8, 16.8, 2.4) + rect(13.9, 3.6, 4.8, 16.8, 2.4);
G.ff = tri(2.5, 5, 9.5, 14, 0) + tri(12, 5, 9.5, 14, 0);
G.ff_rounded = tri(2.5, 5.2, 9.6, 13.6, 1.3) + tri(12, 5.2, 9.6, 13.6, 1.3);
G.rw = poly([[21.5, 5], [12, 12], [21.5, 19]]) + poly([[12, 5], [2.5, 12], [12, 19]]);
G.rw_rounded = poly([[21.5, 5.2], [11.9, 12], [21.5, 18.8]], 1.3) + poly([[12.1, 5.2], [2.5, 12], [12.1, 18.8]], 1.3);
G.next_cat = tri(1.5, 7, 7, 10, 0) + tri(8.5, 7, 7, 10, 0) + tri(15.5, 7, 7, 10, 0);
G.next_cat_rounded = tri(1.5, 7.2, 7.1, 9.6, 1) + tri(8.5, 7.2, 7.1, 9.6, 1) + tri(15.5, 7.2, 7.1, 9.6, 1);
G.prev_cat = poly([[8.5, 7], [1.5, 12], [8.5, 17]]) + poly([[15.5, 7], [8.5, 12], [15.5, 17]]) + poly([[22.5, 7], [15.5, 12], [22.5, 17]]);
// Platform check box stand-in (32 dp drawable, 18 dp box, 2 dp stroke, scaled to 24).
G.check_off = 'M5.25 6.75a1.5 1.5 0 0 1 1.5-1.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5ZM6.75 6.75v10.5h10.5V6.75Z';
G.check_on = 'M5.25 6.75a1.5 1.5 0 0 1 1.5-1.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10.5a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5ZM7.6 12.1L10.5 15L16.4 9.1L15.3 8L10.5 12.8L8.7 11Z';
G.stop = rect(5, 5, 14, 14, 1.2);
G.menu = circle(12, 5, 2.1) + circle(12, 12, 2.1) + circle(12, 19, 2.1);
// Help: a question mark in a ring.
G.support = arc(12, 12, 8.6, 2.4, 0, 359.99) + arc(12, 10.2, 2.7, 2.2, -175, 60) + rect(10.9, 12.2, 2.2, 2.6, 0.6) + circle(12, 16.7, 1.35);
G.hamburger = rect(3, 4.5, 18, 3) + rect(3, 10.5, 18, 3) + rect(3, 16.5, 18, 3);
G.hamburger_rounded = rect(3, 4.4, 18, 3.4, 1.7) + rect(3, 10.3, 18, 3.4, 1.7) + rect(3, 16.2, 18, 3.4, 1.7);
G.lyrics = rect(5, 6, 14, 2.6, 1.3) + rect(3.5, 10.7, 17, 2.6, 1.3) + rect(6.5, 15.4, 11, 2.6, 1.3);
G.search = arc(10, 10, 5.6, 3.2, 0, 359.9) + poly([[13.9, 16.1], [16.1, 13.9], [21.4, 19.2], [19.2, 21.4]], 0.9);
G.equ = rect(4, 13, 4.4, 8) + rect(9.8, 4, 4.4, 17) + rect(15.6, 9, 4.4, 12);
G.equ_rounded = rect(4, 13, 4.4, 8, 2.2) + rect(9.8, 4, 4.4, 17, 2.2) + rect(15.6, 9, 4.4, 12, 2.2);
G.lists = rect(3.5, 3.5, 7.5, 7.5) + rect(13, 3.5, 7.5, 7.5) + rect(3.5, 13, 7.5, 7.5) + rect(13, 13, 7.5, 7.5);
G.lists_rounded = rect(3.5, 3.5, 7.5, 7.5, 2.4) + rect(13, 3.5, 7.5, 7.5, 2.4) + rect(3.5, 13, 7.5, 7.5, 2.4) + rect(13, 13, 7.5, 7.5, 2.4);
G.vis = rect(3.2, 9.5, 2.4, 5, 1.2) + rect(7.1, 6.5, 2.4, 11, 1.2) + rect(11, 3.5, 2.4, 17, 1.2) + rect(14.9, 6.5, 2.4, 11, 1.2) + rect(18.8, 9.5, 2.4, 5, 1.2);
G.shuffle = poly([[3, 6.2], [7.2, 6.2], [16.2, 17.8], [17.5, 17.8], [17.5, 15.2], [21.6, 18.9], [17.5, 22.6], [17.5, 20.4], [14.9, 20.4], [5.9, 8.8], [3, 8.8]], 0.4)
  + poly([[3, 15.2], [5.9, 15.2], [8.3, 12.1], [9.9, 14.2], [7.2, 17.8], [3, 17.8]], 0.4)
  + poly([[11.6, 9.8], [14.9, 3.6], [17.5, 3.6], [17.5, 1.4], [21.6, 5.1], [17.5, 8.8], [17.5, 6.2], [16.2, 6.2], [13.2, 11.9]], 0.4);
G.repeat = poly([[4, 13], [4, 8.6], [6.8, 5.8], [16, 5.8], [16, 3], [20.5, 7.1], [16, 11.2], [16, 8.4], [6.6, 8.4], [6.6, 13]], 0.5)
  + poly([[20, 11], [20, 15.4], [17.2, 18.2], [8, 18.2], [8, 21], [3.5, 16.9], [8, 12.8], [8, 15.6], [17.4, 15.6], [17.4, 11]], 0.5);
G.repeat_song = G.repeat + rect(11, 9.6, 2, 4.8, 0.4);
G.repeat_advance = rect(2.5, 9, 4.4, 4.4, 1) + rect(8, 9, 4.4, 4.4, 1) + poly([[14, 6], [21, 11.2], [14, 16.4]], 0.8) + poly([[2.5, 15.5], [11.5, 15.5], [11.5, 13.8], [14.5, 16.8], [11.5, 19.8], [11.5, 18], [2.5, 18]], 0.3);
G.single_song = rect(10, 3, 2.6, 12.5, 1.2) + circle(9.2, 16.8, 3.6) + poly([[12.6, 3], [18, 5.5], [18, 8.6], [12.6, 6.4]], 0.5);
G.like = poly([[3, 10], [6.5, 10], [6.5, 20.5], [3, 20.5]], 0.8) + poly([[8.2, 10], [12.3, 3.2], [14.6, 3.8], [13.8, 9], [20, 9], [21.2, 10.6], [19, 19.5], [17.4, 20.5], [8.2, 20.5]], 1.2);
G.unlike = poly([[3, 14], [6.5, 14], [6.5, 3.5], [3, 3.5]], 0.8) + poly([[8.2, 14], [12.3, 20.8], [14.6, 20.2], [13.8, 15], [20, 15], [21.2, 13.4], [19, 4.5], [17.4, 3.5], [8.2, 3.5]], 1.2);
G.love = 'M12 20.6C5.8 15.6 2.8 12.6 2.8 8.9 2.8 6 5 3.8 7.8 3.8c1.7 0 3.2.8 4.2 2.1 1-1.3 2.5-2.1 4.2-2.1 2.8 0 5 2.2 5 5.1 0 3.7-3 6.7-9.2 11.7Z';
G.unlove = G.love + poly([[3.3, 2.2], [21.8, 20.7], [20.3, 22.2], [1.8, 3.7]], 0.3);
G.star = poly(Array.from({length: 10}, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.4 : 9.6;
  return [12 + r * Math.cos(a), 12.6 + r * Math.sin(a)];
}), 0.8);
// Outlined star: the star with an inset star cut out (reverse winding).
G.star_stroke = G.star + poly(Array.from({length: 10}, (_, i) => {
  const a = -Math.PI / 2 - (i * Math.PI) / 5, r = i % 2 ? 2.6 : 6.6;
  return [12 + r * Math.cos(a), 12.9 + r * Math.sin(a)];
}), 0.4);
G.chromecast = 'M3 6.5C3 5.7 3.7 5 4.5 5h15c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5H14v-2.2h4.8V7.2H5.2v2.6H3Z' + 'M3 19h2.6c0-1.4-1.2-2.6-2.6-2.6Z' + arc(3, 19, 4.7, 1.8, 270, 360) + arc(3, 19, 8.2, 1.8, 270, 360);
G.back_10s = arc(12, 13, 7, 2.2, 200, 375) + poly([[2.6, 7.4], [8.2, 4.4], [7.6, 10.4]], 0.4);
G.forward_10s = arc(12, 13, 7, 2.2, 165, 340) + poly([[21.4, 7.4], [15.8, 4.4], [16.4, 10.4]], 0.4);
G.up_nav = poly([[12, 3], [18, 9.5], [14.2, 9.5], [14.2, 21], [6, 21], [6, 18.2], [11.2, 18.2], [11.2, 9.5], [6, 9.5]], 0.5);
G.scroll_up = poly([[12, 5], [18, 11], [16.3, 12.7], [12, 8.4], [7.7, 12.7], [6, 11]], 0.4) + poly([[12, 11], [18, 17], [16.3, 18.7], [12, 14.4], [7.7, 18.7], [6, 17]], 0.4);
G.radio_off = arc(12, 12, 8.25, 2, 0, 359.9);
G.radio_on = arc(12, 12, 8.25, 2, 0, 359.9) + circle(12, 12, 4.6);
G.circle_off = arc(12, 12, 8, 2, 0, 359.9);
G.skip_next = poly([[5, 5], [15.5, 12], [5, 19]], 0.8) + rect(16.5, 5, 2.6, 14, 1);
G.check = poly([[3.5, 12.5], [5.6, 10.4], [9.4, 14.2], [18.4, 5.2], [20.5, 7.3], [9.4, 18.4]], 0.4);
G.close = poly([[5.2, 3.5], [12, 10.3], [18.8, 3.5], [20.5, 5.2], [13.7, 12], [20.5, 18.8], [18.8, 20.5], [12, 13.7], [5.2, 20.5], [3.5, 18.8], [10.3, 12], [3.5, 5.2]], 0.3);
G.add = rect(10.6, 4, 2.8, 16, 1) + rect(4, 10.6, 16, 2.8, 1);
G.info = circle(12, 6.5, 1.9) + rect(10.4, 9.8, 3.2, 10.2, 1.2);
G.exclamation = rect(10.4, 3.5, 3.2, 11.5, 1.4) + circle(12, 19, 1.9);
G.folder = poly([[2.5, 5], [9.2, 5], [11.2, 7], [21.5, 7], [21.5, 19.5], [2.5, 19.5]], 1.4);
G.folders_hier = poly([[2.5, 3.5], [7.5, 3.5], [9, 5], [14, 5], [14, 11], [2.5, 11]], 1) + poly([[9.5, 13], [14.5, 13], [16, 14.5], [21.5, 14.5], [21.5, 20.5], [9.5, 20.5]], 1) + rect(5, 11, 1.8, 6.4) + rect(5, 15.6, 4.5, 1.8);
G.album = (() => circle(12, 12, 9.5) + circle(12, 12, 2.2))();
G.artist = circle(12, 7.5, 4.3) + 'M3.5 21c0-4.7 3.8-8.3 8.5-8.3s8.5 3.6 8.5 8.3Z';
G.album_artist = circle(9, 7.5, 3.8) + 'M1.8 20.5c0-4.1 3.2-7.3 7.2-7.3s7.2 3.2 7.2 7.3Z' + arc(17.5, 9, 4.4, 1.8, 0, 359.9);
G.composer = rect(5, 3.5, 2.6, 13.5, 1.2) + rect(14.5, 2, 2.6, 13.5, 1.2) + poly([[5, 3.5], [17.1, 2], [17.1, 5.6], [5, 7.1]], 0.4) + circle(4.4, 17.6, 3.2) + circle(13.9, 16.1, 3.2);
G.genre = poly([[4, 12.5], [12.6, 3.9], [20.5, 3.5], [20.1, 11.4], [11.5, 20]], 1.4) + circle(16, 8, 1.6);
G.playlist = rect(3, 5, 12, 2.6, 1) + rect(3, 10, 12, 2.6, 1) + rect(3, 15, 7.5, 2.6, 1) + poly([[13.5, 13], [21, 17], [13.5, 21]], 0.8);
G.queue = rect(3, 4, 18, 3, 1) + rect(3, 10.5, 18, 3, 1) + rect(3, 17, 10, 3, 1) + poly([[15.5, 15.5], [21, 18.5], [15.5, 21.5]], 0.6);
G.song = rect(11.8, 3, 2.6, 13, 1.2) + circle(9.6, 17, 3.9) + poly([[14.4, 3], [19.5, 5.6], [19.5, 8.8], [14.4, 6.4]], 0.5);
G.most_played = poly([[12, 2.5], [20.5, 11], [15, 11], [15, 21], [9, 21], [9, 11], [3.5, 11]], 1);
G.top_rated = G.like;
G.low_rated = G.unlike;
G.recently_played = arc(12, 12, 8, 2.4, 0, 359.9) + rect(10.8, 6.5, 2.4, 6.5, 1) + poly([[11.2, 12.4], [16.2, 15.4], [15, 17.4], [10.2, 14.4]], 0.6);
G.recently_added = arc(12, 12, 8, 2.4, 0, 359.9) + rect(10.8, 7, 2.4, 10, 1) + rect(7, 10.8, 10, 2.4, 1);
G.long_files = rect(2.5, 9.5, 2.6, 5, 1) + rect(6.5, 6.5, 2.6, 11, 1) + rect(10.5, 4, 2.6, 16, 1) + rect(14.5, 7.5, 2.6, 9, 1) + rect(18.5, 10.5, 2.6, 3, 1);
G.stream = circle(12, 12, 2.6) + arc(12, 12, 6, 2, 210, 330) + arc(12, 12, 6, 2, 30, 150) + arc(12, 12, 9.6, 2, 210, 330) + arc(12, 12, 9.6, 2, 30, 150);
G.years = rect(3, 5, 18, 16, 2) + rect(6.5, 2.5, 2.6, 5, 1) + rect(14.9, 2.5, 2.6, 5, 1);
// List Memory (keep_*_12dp): List Position marks a row of a list; Per Track
// Progress a position on a track's bar; both stack the two.
G.keep_list = rect(10, 4.6, 11.5, 2.6, 1.3) + rect(10, 10.7, 11.5, 2.6, 1.3) + rect(10, 16.8, 11.5, 2.6, 1.3) + circle(5, 12, 2.9);
G.keep_track = rect(2, 10.8, 6, 2.4, 1.2) + circle(13, 12, 3.6) + rect(18, 10.8, 4, 2.4, 1.2);
G.keep_list_track = rect(4, 3, 16, 2.6, 1.3) + rect(4, 8.4, 16, 2.6, 1.3) + rect(2, 16.8, 5.6, 2.4, 1.2) + circle(12.5, 18, 3.4) + rect(17.4, 16.8, 4.6, 2.4, 1.2);
G.bookmark = poly([[6, 2.5], [18, 2.5], [18, 21.5], [12, 16.5], [6, 21.5]], 1.2);
G.raw_file = poly([[5, 2.5], [14, 2.5], [19.5, 8], [19.5, 21.5], [5, 21.5]], 1.2);
G.delete = rect(5.5, 7, 13, 14.5, 1.6) + rect(3.5, 3.6, 17, 2.4, 1) + rect(9.3, 2, 5.4, 2.6, 1);
G.edit = poly([[4, 16.5], [15.5, 5], [19, 8.5], [7.5, 20], [4, 20]], 0.6) + poly([[17, 3.5], [18.5, 2], [22, 5.5], [20.5, 7]], 0.5);
G.sort = rect(3, 5, 18, 2.6, 1) + rect(3, 10.7, 12, 2.6, 1) + rect(3, 16.4, 6, 2.6, 1);
G.share = circle(18, 5, 3) + circle(6, 12, 3) + circle(18, 19, 3) + poly([[7.2, 10.6], [16.6, 5.2], [17.6, 7], [8.2, 12.4]], 0.4) + poly([[8.2, 11.6], [17.6, 17], [16.6, 18.8], [7.2, 13.4]], 0.4);
G.timer = arc(12, 13.5, 8, 2.4, 0, 359.9) + rect(10.8, 8.5, 2.4, 6, 1) + rect(9, 1.8, 6, 2.4, 1);
// A polyline drawn w thick, as one outline (forward on the left, back on the right).
function strokeLine(pts, w) {
  const h = w / 2, L = [], R = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l * h, ny = dx / l * h;
    L.push([p[0] + nx, p[1] + ny]);
    R.push([p[0] - nx, p[1] - ny]);
  });
  return poly([...L, ...R.reverse()]);
}
const curve = (fn, x0 = 3, x1 = 21, n = 36) => strokeLine(Array.from({length: n + 1}, (_, i) => { const x = x0 + (x1 - x0) * i / n; return [x, fn(x)]; }), 2.4);
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// Parametric band types (eq_param_type_icons_24dp): the filter's response shape.
G.low_pass = curve(x => 7 + 12 * smooth((x - 9) / 11));
G.high_pass = curve(x => 7 + 12 * smooth((15 - x) / 11));
G.band_pass = curve(x => 19 - 13 * Math.exp(-((x - 12) ** 2) / 14));
G.peaking_band = curve(x => 15 - 9 * Math.exp(-((x - 12) ** 2) / 9));
G.low_shelf = curve(x => 8 + 9 * smooth((x - 7) / 10));
G.high_shelf = curve(x => 8 + 9 * smooth((17 - x) / 10));
// Channels (eq_param_lr_icons_24dp): L, R and both.
const letterL = (x, y, s) => rect(x, y, 2.4 * s, 12 * s, 0.4) + rect(x, y + 9.6 * s, 7 * s, 2.4 * s, 0.4);
const letterR = (x, y, s) => rect(x, y, 2.4 * s, 12 * s, 0.4) + arc(x + 3.2 * s, y + 3.6 * s, 2.4 * s, 2.4 * s, -90, 90) + rect(x, y, 3.4 * s, 2.4 * s) + rect(x, y + 4.8 * s, 3.4 * s, 2.4 * s) + poly([[x + 3 * s, y + 6.6 * s], [x + 5.6 * s, y + 6 * s], [x + 8.4 * s, y + 12 * s], [x + 5.6 * s, y + 12 * s]]);
G.l_ch = letterL(8.5, 6, 1);
G.r_ch = letterR(8, 6, 1);
G.l_plus_r_ch = letterL(2.5, 7.5, 0.85) + rect(10.1, 11.9, 3.8, 1.8, 0.4) + rect(11.1, 10.9, 1.8, 3.8, 0.4) + letterR(15, 7.5, 0.75);
G.unlock = rect(4.5, 10.5, 15, 11, 2) + arc(16.6, 7, 4.6, 2.6, 180, 360) + rect(19.9, 7, 2.6, 2.4);
G.lock = rect(4.5, 10.5, 15, 11, 2) + arc(12, 10.5, 4.6, 2.6, 180, 360) + rect(5.4, 9, 2.6, 2) + rect(16, 9, 2.6, 2);
G.palette = 'M12 2.5c5.4 0 9.5 3.8 9.5 8.4 0 2.9-2.4 4.6-5.1 4.6h-2c-1.1 0-1.7 1.2-1 2.1.5.6.7 1.2.7 1.8 0 1.2-1 2.1-2.1 2.1-5.2 0-9.5-4.3-9.5-9.5S6.8 2.5 12 2.5Z';
G.speaker = rect(3, 9, 5, 6, 0.8) + poly([[8, 9], [14, 4], [14, 20], [8, 15]], 0.6);
G.headphones = arc(12, 13, 8.5, 2.4, 180, 360) + rect(2.3, 13, 5.2, 8, 1.6) + rect(16.5, 13, 5.2, 8, 1.6);
G.bt = poly([[11, 2], [17.5, 7.6], [13.4, 12], [17.5, 16.4], [11, 22], [11, 14.6], [7.3, 18.2], [5.8, 16.7], [10.4, 12], [5.8, 7.3], [7.3, 5.8], [11, 9.4]], 0.4);
G.usb = rect(10.8, 4, 2.4, 15, 1) + circle(12, 19.2, 2.6) + poly([[12, 1.5], [15, 5.5], [9, 5.5]], 0.3);
G.global = arc(12, 12, 8.6, 2.2, 0, 359.9) + rect(3.4, 10.9, 17.2, 2.2) + 'M12 3.4c2.6 2.4 3.8 5.3 3.8 8.6s-1.2 6.2-3.8 8.6h-1.6c-2.6-2.4-3.8-5.3-3.8-8.6s1.2-6.2 3.8-8.6Zm.8 2.9c-1.6 1.8-2.4 3.7-2.4 5.7s.8 3.9 2.4 5.7c1.6-1.8 2.4-3.7 2.4-5.7s-.8-3.9-2.4-5.7Z';
G.image = rect(3, 4, 18, 2.4, 1) + rect(3, 17.6, 18, 2.4, 1) + rect(3, 4, 2.4, 16, 1) + rect(18.6, 4, 2.4, 16, 1) + poly([[6.5, 16.5], [10.5, 11], [13.5, 14.5], [15.2, 12.6], [17.5, 16.5]], 0.4) + circle(15, 8.6, 1.6);
G.filter = poly([[3, 4], [21, 4], [14, 12.5], [14, 20], [10, 18], [10, 12.5]], 0.8);
G.vol = G.speaker + arc(12.5, 12, 4.4, 2, 300, 420) + arc(12.5, 12, 8, 2, 300, 420);
G.reverb = arc(5, 12, 3, 2, 270, 450) + arc(5, 12, 7.5, 2, 290, 430) + arc(5, 12, 12, 2, 300, 420);
G.tone = circle(7, 8, 3.2) + circle(17, 16, 3.2) + rect(2.5, 15, 10, 2.2, 1) + rect(11.5, 6.9, 10, 2.2, 1);
G.grid_drag = circle(9, 6, 1.6) + circle(15, 6, 1.6) + circle(9, 12, 1.6) + circle(15, 12, 1.6) + circle(9, 18, 1.6) + circle(15, 18, 1.6);
G.list_drag = rect(4, 8, 16, 2.2, 1) + rect(4, 13.8, 16, 2.2, 1);
// Pinch-to-zoom: two arrowheads pointing apart along the diagonal.
G.zoom_arrows = poly([[20.5, 3.5], [20.5, 11], [17.6, 8.1], [13.3, 12.4], [11.6, 10.7], [15.9, 6.4], [13, 3.5]], 0.4)
  + poly([[3.5, 20.5], [3.5, 13], [6.4, 15.9], [10.7, 11.6], [12.4, 13.3], [8.1, 17.6], [11, 20.5]], 0.4);
// Up/back arrow: a shaft with a chevron head pointing left.
G.back_arrow = poly([[4, 12], [11, 5], [12.6, 6.6], [8.3, 10.9], [20, 10.9], [20, 13.1], [8.3, 13.1], [12.6, 17.4], [11, 19]], 0.3);
G.question = 'M8.4 8.7c.3-2.4 1.9-4.2 4.1-4.2 2.4 0 4.2 1.6 4.2 3.8 0 2.8-3.4 3.3-3.4 6.2h-2.8c0-4.2 3.4-4.4 3.4-6.2 0-.9-.6-1.6-1.4-1.6-.9 0-1.5.7-1.6 2Z' + circle(12.3, 18.6, 1.8);
G.account = circle(12, 8.5, 4.2) + 'M4.5 20.5c0-4 3.4-6.9 7.5-6.9s7.5 2.9 7.5 6.9Z';
G.bars_peak = rect(4, 4, 4, 16, 1.2) + rect(10, 8, 4, 12, 1.2) + rect(16, 12, 4, 8, 1.2);
G.zap = poly([[13.5, 2], [5, 13.5], [11, 13.5], [10, 22], [19, 10], [12.8, 10]], 0.5);
G.pak = rect(3, 7, 18, 13.5, 1.8) + rect(10.5, 7, 3, 13.5) + poly([[12, 7], [8, 3], [10, 2], [12, 4.6], [14, 2], [16, 3]], 0.4);
G.export = rect(10.8, 3.5, 2.4, 11, 1) + poly([[12, 1.6], [17, 6.6], [7, 6.6]], 0.4) + poly([[4, 12], [6.4, 12], [6.4, 18.6], [17.6, 18.6], [17.6, 12], [20, 12], [20, 21], [4, 21]], 0.5);
G.import = rect(10.8, 2, 2.4, 11, 1) + poly([[12, 15.6], [7, 10.6], [17, 10.6]], 0.4) + poly([[4, 12], [6.4, 12], [6.4, 18.6], [17.6, 18.6], [17.6, 12], [20, 12], [20, 21], [4, 21]], 0.5);
G.equ_thumbs = rect(5, 4, 2.4, 16, 1) + rect(10.8, 4, 2.4, 16, 1) + rect(16.6, 4, 2.4, 16, 1) + circle(6.2, 15, 2.6) + circle(12, 8, 2.6) + circle(17.8, 12, 2.6);
G.sine = 'M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0l2 0v2.2h-2.6c-1.8 5-5 5-6.8-.2-1.8-5.2-2.8-5.2-4.6 0s-5 5.2-6.8 0H2Z';
G.eq_band = 'M2 17c4 0 5-9 10-9s6 9 10 9v2.4c-5 0-6-8.8-10-8.8S7 19.4 2 19.4Z';
G.percent = circle(7, 7, 3) + circle(17, 17, 3) + poly([[16.5, 3], [19, 4.5], [7.5, 21], [5, 19.5]], 0.3);
G.save = poly([[3.5, 3.5], [17, 3.5], [20.5, 7], [20.5, 20.5], [3.5, 20.5]], 1.4) + rect(7, 3.5, 9, 5.5, 0.6) + circle(12, 14.5, 2.8);
G.autosave = G.save + arc(19, 19, 3.4, 1.6, 200, 470);
// Glyphs measured against the reference's drawables (24-unit boxes).
// {svg} glyphs paint in the icon colour (fill and currentColor strokes).
const line = (d, w) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
// A rect wound the other way, so it cuts a hole in the shape it follows.
const hole = (x, y, w, h) => `M${f(x)} ${f(y)}v${f(h)}h${f(w)}v${f(-h)}Z`;
// Six-tooth gear as one outline: teeth at 30 + 60k degrees, ho / hb the
// tooth half-angles at the tip and the body.
function gear(ro = 8.8, rb = 6.6, ho = 15, hb = 23) {
  const pts = [], P = (r, deg) => [12 + r * Math.cos(deg * Math.PI / 180), 12 + r * Math.sin(deg * Math.PI / 180)];
  for (let i = 0; i < 6; i++) {
    const a = 30 + i * 60;
    pts.push(P(rb, a - hb), P(ro, a - ho), P(ro, a + ho), P(rb, a + hb), P(rb, a + 30));
  }
  return poly(pts, 0.6);
}
G.settings = {svg: `<path fill-rule="evenodd" d="${gear()}${circle(12, 12, 2.8)}"/>`};
G.list_options = {svg: [7.2, 11, 14.8].map(y => `<path d="${rect(2.6, y, 3.8, 1.6, 0.3)}"/>`).join('') +
  `<g transform="translate(15.6 12.1) scale(0.68) translate(-12 -12)"><path d="${gear(9.2, 6.9)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` +
  `<circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/></g>`};
G.advance_by_time = {svg: '<circle cx="5.2" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' + line('M5.2 9.9V12L4.1 13.2', 1.1) +
  `<path d="${poly([[11.3, 9], [16.9, 9], [16.9, 6.2], [23.3, 12], [16.9, 17.8], [16.9, 15], [11.3, 15]], 0.8)}"/>`};
G.info_stroke = {svg: '<circle cx="12" cy="12.1" r="8.8" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  `<path d="${circle(12, 7.9, 1.1)}${rect(11.1, 10.4, 1.8, 6, 0.9)}"/>`};
G.refresh = {svg: line('M6.08 13.93A6.3 6.3 0 0 1 15.15 6.84', 1.6) + line('M18.09 10.67A6.3 6.3 0 0 1 8.85 17.76', 1.6) +
  `<path d="${poly([[17.4, 8.14], [16.35, 4.76], [13.95, 8.92]], 0.3)}${poly([[6.6, 16.46], [7.65, 19.84], [10.05, 15.68]], 0.3)}"/>`};
G.reverb = {svg: '<mask id="cpm_reverb"><rect width="24" height="24" fill="#fff"/><g fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round">' +
  '<circle cx="12.05" cy="12.1" r="2.9" stroke-width="1.6"/><path d="M7.4 7.6A6.4 6.4 0 0 0 7.4 16.6M16.7 7.6A6.4 6.4 0 0 1 16.7 16.6"/></g></mask>' +
  `<path mask="url(#cpm_reverb)" d="${rect(1.3, 3.3, 21.5, 17.6, 1.6)}"/>`};
G.clock = {svg: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/>' + line('M11.7 7.1V12.2L15 15.2', 1.4)};
G.support_filled = {svg: '<mask id="cpm_support_f"><rect width="24" height="24" fill="#fff"/>' +
  '<path d="M9.3 9.4A2.7 2.7 0 1 1 13.5 11.6C12.5 12.2 12 12.7 12 13.7V14.5" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="square"/>' +
  `<path fill="#000" d="${rect(11.05, 15.9, 1.9, 1.8)}"/></mask><circle cx="12" cy="12.45" r="8.55" mask="url(#cpm_support_f)"/>`};
G.like_stroke = poly([[8.2, 10], [12.3, 3.2], [14.6, 3.8], [13.8, 9], [20, 9], [21.2, 10.6], [19, 19.5], [17.4, 20.5], [8.2, 20.5]], 1.2)
  + poly([[10, 10.5], [10, 18.8], [17, 18.8], [19.4, 10.9], [12, 10.7], [13, 5.4], [12.9, 5.3]], 0.6)
  + rect(2.8, 10, 2.6, 10.5, 0.8) + hole(3.6, 10.8, 1, 8.9);
G.unlike_stroke = {svg: `<path transform="translate(0 25.8) scale(1 -1) translate(24.4 0) scale(-1 1)" d="${G.like_stroke}"/>`};
G.vis_w_ui = {svg: `<path d="${rect(5.1, 7.2, 1.9, 4, 0.95)}${rect(8, 5.6, 2, 7.4, 1)}${rect(11.1, 3.8, 1.8, 10.8, 0.9)}${rect(14, 5.6, 2, 7.4, 1)}${rect(17.1, 7.2, 1.9, 4, 0.95)}` +
  `${rect(6.2, 17.5, 2.1, 1.9, 0.3)}${circle(12, 18.4, 1.9)}${rect(15.7, 17.5, 2.2, 1.9, 0.3)}"/>`};
G.knob = {svg: '<mask id="cpm_knob"><rect width="24" height="24" fill="#fff"/>' + line('M8.3 7.4L9.9 9', 1.6).replace('currentColor', '#000') +
  '</mask><circle cx="12.05" cy="11.9" r="8.65" mask="url(#cpm_knob)"/>'};
G.zigzag = {svg: '<path d="M0.9 12.6L2.4 10.6L3.8 12.9L6 9.9L8.4 13.6L11.4 8.7L14.4 14.7L18 7.7L22.9 17.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="miter" stroke-miterlimit="8"/>'};
G.zoom_in_arrows = {svg: '<mask id="cpm_zoomin"><rect width="24" height="24" fill="#fff"/><g fill="none" stroke="#000" stroke-width="1.9">' +
  '<path d="M19 5.6L14.3 10.3M13.6 6.6V10.9H17.9M6.7 18.9L11.4 14.2M12 18V13.7H7.7"/></g></mask><circle cx="12.8" cy="12.25" r="10.75" mask="url(#cpm_zoomin)"/>'};
G.play_24 = poly([[6.1, 3.9], [20.2, 12.25], [6.1, 20.6]], 1.5);
G.close_stroke = {svg: line('M6.6 6.6L17.4 17.4M17.4 6.6L6.6 17.4', 1.5).replace('stroke-linecap="round"', 'stroke-linecap="butt"')};
// The reference's song marks (song_12dp) are a treble clef.
G.clef = {svg: '<g transform="translate(-3.1 -2.6) scale(1.3 1.2)">' +
  line('M12.6 2.3C15.6 4.2 15.1 7.6 11.9 10.1C8.6 12.7 6.2 14.4 6.4 16.9C6.6 19.4 9 20.6 11.7 20.3C14.4 20 16.4 18.4 16.2 16.1C16 13.9 14 12.6 12 12.9C10.2 13.2 9 14.6 9.5 16.2', 1.9) +
  line('M12.5 2.3C11.4 2.1 10.8 3.6 10.9 6.1L12.7 20.4C12.9 22 11.7 22.7 10.6 22.4', 1.9) + '<circle cx="9.9" cy="21.2" r="1.4"/></g>'};
G.dot = circle(12, 12, 4);
G.placeholder = rect(4, 4, 16, 16, 3);

/** Round button: filled circle with a knocked-out glyph scaled into it. */
function round(glyph, scale = 0.5) {
  const t = (12 * (1 - scale));
  return {circle: true, glyph, transform: `translate(${f(t)} ${f(t)}) scale(${scale})`};
}

// Library category badges (the *_alt bitmaps, tinted by *_colored): a disc
// with the glyph cut out. Original glyphs drawn to the reference's extents.
const stroke = (d, w = 2.1) => `<path d="${d}" fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ellipse = (cx, cy, rx, ry, rot) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})"/>`;
G.badge_all_songs = {svg:
  stroke('M12.6 2.3C15.6 4.2 15.1 7.6 11.9 10.1C8.6 12.7 6.2 14.4 6.4 16.9C6.6 19.4 9 20.6 11.7 20.3C14.4 20 16.4 18.4 16.2 16.1C16 13.9 14 12.6 12 12.9C10.2 13.2 9 14.6 9.5 16.2') +
  stroke('M12.5 2.3C11.4 2.1 10.8 3.6 10.9 6.1L12.7 20.4C12.9 22 11.7 22.7 10.6 22.4') +
  '<circle cx="9.9" cy="21.2" r="1.4"/>'};
G.badge_folders = poly([[5.8, 6.6], [10.6, 6.6], [12.2, 8.2], [19, 8.2], [19, 17.2], [5.8, 17.2]], 1.1);
G.badge_folders_hier = {svg:
  `<path d="${poly([[5, 5.4], [8.4, 5.4], [9.7, 6.7], [14.6, 6.7], [14.6, 14.6], [5, 14.6]], 0.9)}"/>` +
  `<path d="${poly([[9, 9.6], [12.6, 9.6], [13.9, 10.9], [19, 10.9], [19, 19], [9, 19]], 1)}" stroke="#fff" stroke-width="1.6" paint-order="stroke"/>`};
G.badge_albums = {svg: ellipse(12, 12.1, 8.9, 6.1, -45) + `<g fill="#fff">${ellipse(12.4, 11.7, 2.5, 1.7, -45)}</g>` + ellipse(12.4, 11.7, 1, 0.7, -45)};
G.badge_artists = {svg:
  `<path d="${rect(8.4, 2, 7.2, 12.2, 3.6)}"/>` +
  stroke('M5.2 10.8A6.8 6.8 0 0 0 18.8 10.8', 2) + stroke('M12 17.8V22', 2.2)};
G.badge_album_artists = {svg:
  `<path fill-rule="evenodd" d="${rect(8.4, 2.2, 7.2, 12.2, 3.6)}${circle(12, 6.6, 2)}"/>` + '<circle cx="12" cy="6.6" r="0.8"/>' +
  stroke('M5.2 10.8A6.8 6.8 0 0 0 18.8 10.8', 2) + stroke('M12 17.8V22', 2.2)};
G.badge_genres = {svg:
  `<path fill-rule="evenodd" d="${circle(8.9, 15.4, 4.3)}${circle(9.4, 15, 1.1)}"/>` + '<circle cx="11.5" cy="12.6" r="3.1"/>' +
  stroke('M11 13.8L17.6 6.2', 1.9) + `<path d="${poly([[16.9, 5.2], [18.3, 3.9], [19.5, 5.1], [18.2, 6.5]], 0.3)}"/>`};
G.badge_years = {svg:
  '<g font-family="cp-ttnorms,sans-serif" font-weight="700" text-anchor="middle">' +
  '<text x="11.6" y="8.4" font-size="4.2" fill="#666">\u201970</text>' +
  '<text x="11.4" y="13" font-size="4.6" fill="#444">\u201990</text>' +
  '<text x="11.2" y="19" font-size="6.2">\u201920</text></g>'};
G.badge_composers = {svg: '<circle cx="12" cy="9.2" r="3" fill="none" stroke="#000" stroke-width="1.9"/>' +
  '<path d="M5.8 18.6C6.2 15.6 8.8 13.8 12 13.8C15.2 13.8 17.8 15.6 18.2 18.6Z"/>'};
G.badge_playlists = [7.7, 12, 16.3].map(y => circle(6.5, y, 1.1) + rect(9, y - 1.1, 9.4, 2.2, 1.1)).join('');
G.badge_streams = circle(12.1, 12, 1.7) + arc(12.1, 12, 4, 1.6, 140, 220) + arc(12.1, 12, 4, 1.6, -40, 40) + arc(12.1, 12, 7, 1.6, 135, 225) + arc(12.1, 12, 7, 1.6, -45, 45);
G.badge_queue = poly([[4.8, 7.6], [8.9, 7.6], [13.4, 12.1], [8.9, 16.6], [4.8, 16.6], [9.3, 12.1]], 0.3) + poly([[11.6, 7.6], [15.7, 7.6], [20.2, 12.1], [15.7, 16.6], [11.6, 16.6], [16.1, 12.1]], 0.3);
G.badge_bookmarks = poly([[7.6, 6], [16.4, 6], [16.4, 17.8], [12, 14.6], [7.6, 17.8]], 0.9);
G.badge_most_played = {svg: `<path d="${poly([[8.2, 6.6], [17.8, 12], [8.2, 17.4]], 0.9)}"/>` +
  `<path fill="#fff" d="${poly([[8.2, 9.4], [12.7, 12], [8.2, 14.6]], 0.2)}"/>` + `<path d="${poly([[8.2, 10.9], [10.2, 12], [8.2, 13.1]], 0)}"/>`};
G.badge_top_rated = G.like;
G.badge_low_rated = G.unlike;
G.badge_recently_played = {svg: `<path d="${poly([[7.6, 5.6], [19, 12.1], [7.6, 18.6]], 1)}"/>` +
  '<path d="M10.4 9.4V13.6H13.2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'};
G.badge_recently_added = rect(10.4, 5.8, 3.4, 12.4, 0.6) + rect(5.8, 10.3, 12.6, 3.4, 0.6);
G.badge_long_files = [5.7, 9.97, 14.23, 18.5].map(x => circle(x, 12.1, 1.1)).join('');
// Micro category icons (*_12dp) use the badge glyphs, enlarged to fill the
// box: a mask turns the glyph's cut-outs and knock-ins around.
function micro(key, scale = 1.05) {
  const g = G['badge_' + key], t = `translate(${f(12 - 12 * scale)} ${f(12 - 12 * scale)}) scale(${scale})`;
  const body = typeof g === 'object' ? g.svg.replace(/#000/g, '#tmp').replace(/#fff/g, '#000').replace(/#tmp/g, '#fff') : `<path d="${g}"/>`;
  return {svg: `<mask id="cpm_micro_${key}"><rect width="24" height="24" fill="#000"/><g fill="#fff" transform="${t}">${body}</g></mask><rect width="24" height="24" mask="url(#cpm_micro_${key})"/>`};
}
for (const k of ['albums', 'artists', 'album_artists', 'genres', 'playlists', 'queue']) G['micro_' + k] = micro(k);
G.micro_composers = {svg: `<path d="${circle(12, 7.9, 4.2)}"/><path d="M3.8 20.2C4.3 15.6 7.6 12.9 12 12.9C16.4 12.9 19.7 15.6 20.2 20.2Z"/>`};
G.micro_years = {svg: '<text x="12" y="17.4" font-family="cp-ttnorms,sans-serif" font-weight="700" font-size="12.5" text-anchor="middle">’20</text>'};
// Outlined sub-art button glyphs (*_stroke_32dp).
const outline = (d, w = 1.6) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linejoin="round"/>`;
G.folder_stroke = {svg: outline(poly([[3.3, 5.6], [9.2, 5.6], [11, 7.4], [20.7, 7.4], [20.7, 18.6], [3.3, 18.6]], 1.2))};
G.albums_stroke = {svg: '<g fill="none" stroke="currentColor" stroke-width="1.6">' + ellipse(12, 12, 9.2, 6.3, -45) + ellipse(12.3, 11.7, 2.4, 1.6, -45) + '</g>'};
G.artists_stroke = {svg: outline(rect(9.3, 2.6, 5.4, 10.8, 2.7)) + line('M6 10.6A6 6 0 0 0 18 10.6M12 16.6V21.4', 1.6)};
G.genres_stroke = {svg: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">' +
  '<path d="M8.1 11.4C6.4 11.1 4.6 12.1 4.2 14C3.8 15.6 4.6 16.6 4.2 18C3.9 19.3 5.6 20.5 7.2 19.9C8.4 19.5 9.3 18.5 10.7 18.4C12.4 18.3 13.4 16.9 13 15.1C12.8 14 12.1 13.6 12.3 12.7C12.5 11.4 11.2 10 9.6 10.6Z"/>' +
  '<circle cx="8.8" cy="15.2" r="1.3"/></g>' + line('M10.4 13.6L18.2 5.8', 1.5) + `<path d="${poly([[17.4, 4.3], [19, 2.8], [20.8, 4.6], [19.3, 6.2]], 0.3)}"/>`};
G.add_stroke = {svg: outline(poly([[9.6, 3], [14.4, 3], [14.4, 9.6], [21, 9.6], [21, 14.4], [14.4, 14.4], [14.4, 21], [9.6, 21], [9.6, 14.4], [3, 14.4], [3, 9.6], [9.6, 9.6]], 1.4), 1.7)};
G.insert_top = {svg: `<path d="${rect(5, 3.4, 14, 1.8, 0.4)}${rect(11.1, 8.6, 1.8, 12.4, 0.4)}"/>` + line('M6.8 13.8L12 8.6L17.2 13.8', 1.8).replace('stroke-linecap="round"', 'stroke-linecap="butt"')};
G.sort_az = {svg: '<text x="12" y="15.8" font-family="cp-ttnorms,sans-serif" font-weight="700" font-size="10" letter-spacing="-0.6" text-anchor="middle">AZ</text>' +
  `<path d="${poly([[12, 1.4], [14.6, 4.2], [9.4, 4.2]], 0.3)}${poly([[9.4, 19.8], [14.6, 19.8], [12, 22.6]], 0.3)}"/>`};
G.check_circle = {svg: '<mask id="cpm_check_circle"><rect width="24" height="24" fill="#fff"/>' + line('M7.6 12.3L10.6 15.2L16.6 9.2', 2).replace('currentColor', '#000') + '</mask><circle cx="12" cy="12" r="9.6" mask="url(#cpm_check_circle)"/>'};
G.info_circle = {svg: '<mask id="cpm_info_circle"><rect width="24" height="24" fill="#fff"/><g fill="#000">' + `<path d="${circle(12, 7.6, 1.3)}${rect(10.9, 10, 2.2, 7.4, 0.5)}${rect(9.6, 10, 2.4, 1.6)}${rect(9.6, 15.9, 4.8, 1.6)}"/>` +
  '</g></mask><circle cx="12" cy="12" r="9.6" mask="url(#cpm_info_circle)"/>'};
G.reverb_plain = {svg: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2.2"/>' + line('M6.6 6.6A7.6 7.6 0 0 0 6.6 17.4M17.4 6.6A7.6 7.6 0 0 1 17.4 17.4', 2.2)};
const tenText = x => `<text x="${x}" y="21.6" font-family="cp-ttnorms,sans-serif" font-weight="700" font-size="5.4" text-anchor="middle">10</text>`;
G.back_10s_text = {svg: line('M8 8.4A7 7 0 0 1 19.6 11.4', 1.4) + `<path d="${poly([[4.6, 8.8], [9, 5.6], [9.5, 10.9]], 0.3)}"/>` + tenText(16.4)};
G.forward_10s_text = {svg: line('M16 8.4A7 7 0 0 0 4.4 11.4', 1.4) + `<path d="${poly([[19.4, 8.8], [15, 5.6], [14.5, 10.9]], 0.3)}"/>` + tenText(7.6)};
G.lyrics_dashed = {svg: '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' +
  '<path d="M6.3 7.3H10.3M13.7 7.3H17.7M4.3 12H7.1M10.6 12H13.4M16.9 12H19.7M7.5 16.7H10.5M13.5 16.7H16.5"/></g>'};
// Light skins' outlined variants (*_stroke): the filled glyph's edge drawn as a line.
for (const k of ['equ', 'equ_rounded', 'hamburger', 'hamburger_rounded', 'lists', 'lists_rounded', 'shuffle', 'repeat']) G['stroke_' + k] = {svg: outline(G[k], 1.3)};
G.stroke_search = {svg: '<circle cx="10" cy="10" r="6.1" fill="none" stroke="currentColor" stroke-width="1.5"/>' + outline(poly([[14.2, 15.9], [15.9, 14.2], [21, 19.3], [19.3, 21]], 0.9), 1.4)};
G.vis_thin = rect(3.6, 9.5, 1.5, 5, 0.75) + rect(7.5, 6.5, 1.5, 11, 0.75) + rect(11.25, 3.5, 1.5, 17, 0.75) + rect(15, 6.5, 1.5, 11, 0.75) + rect(18.9, 9.5, 1.5, 5, 0.75);
// Glyph extents per badge (reference *_alt measured in the harness), for the thumbs.
const BADGE_FIT = {top_rated: [6.2, 5.8, 18.2, 16.6], low_rated: [5.8, 7.6, 17.8, 18.6]};

function badge(key) {
  const b = BADGE_FIT[key];
  if (!b) return {circle: true, glyph: 'badge_' + key, transform: ''};
  // The thumbs reuse the like / unlike glyphs (drawn on 3..21.2 x 3.2..20.8), fitted to the box.
  const [x0, y0, x1, y1] = b, sx = (x1 - x0) / 18.2, sy = (y1 - y0) / 17.6;
  return {circle: true, glyph: 'badge_' + key, transform: `translate(${f(x0 - 3 * sx)} ${f(y0 - 3.2 * sy)}) scale(${f(sx)} ${f(sy)})`};
}

/**
 * A glyph scaled about the grid centre by sx, sy, then moved right by dx
 * units: the transport's core glyphs fill their inset box (the measured
 * reference bitmaps) more than the plain glyphs fill the grid.
 */
function fit(glyph, sx, sy, dx = 0) {
  return {glyph, transform: `translate(${f(12 - 12 * sx + dx)} ${f(12 - 12 * sy)}) scale(${f(sx)} ${f(sy)})`};
}

// Reference drawable name -> glyph mapping (ordered; first match wins).
const RULES = [
  [/^(all_songs|folders_hier|folders|albums_by_artist|albums|artists|album_artists|genres|years|composers|playlists|streams|queue|bookmarks|most_played|top_rated|low_rated|recently_played|recently_added|long_files)(_thumb)?_alt$/, m => badge(m[1] === 'albums_by_artist' ? 'albums' : m[1])],
  [/^settings_close/, () => 'close'],
  [/^(equ|hamburger|lists)(_rounded)?_stroke/, m => 'stroke_' + m[1] + (m[2] ?? '')],
  [/^search(_rounded)?_stroke/, () => 'stroke_search'],
  [/^shuffle_stroke/, () => 'stroke_shuffle'],
  [/^repeat_stroke/, () => 'stroke_repeat'],
  [/^vis_stroke/, () => 'vis_thin'],
  [/^sleep_timer_stroke/, () => 'clock'],
  [/^(albums|album_artists|artists|composers|genres|playlists|years)_12dp$/, m => 'micro_' + m[1]],
  [/^toast_queue/, () => 'micro_queue'],
  [/^folder_stroke/, () => 'folder_stroke'],
  [/^albums_stroke/, () => 'albums_stroke'],
  [/^artists_stroke/, () => 'artists_stroke'],
  [/^genres_stroke/, () => 'genres_stroke'],
  [/^add_to_pl_stroke/, () => 'add_stroke'],
  [/^insert_top/, () => 'insert_top'],
  [/^sort_24dp/, () => 'sort_az'],
  [/^pl_toggle/, () => 'check_circle'],
  [/^(info_32dp|toast_info)/, () => 'info_circle'],
  [/^reverb_24dp/, () => 'reverb_plain'],
  [/^back_10s_32dp/, () => 'back_10s_text'],
  [/^forward_10s_32dp/, () => 'forward_10s_text'],
  [/^lyrics_none/, () => 'lyrics_dashed'],
  [/^close_stroke/, () => 'close_stroke'],
  [/^unlike_stroke/, () => 'unlike_stroke'],
  [/^info_stroke/, () => 'info_stroke'],
  [/^vis_w_ui/, () => 'vis_w_ui'],
  [/^zoom_arrows/, () => 'zoom_in_arrows'],
  [/^play_24dp/, () => 'play_24'],
  [/^(song_12dp|all_songs)/, () => 'clef'],
  [/^like_stroke/, () => 'like_stroke'],
  [/^plus_check/, () => 'add'],
  [/^circle_unchecked/, () => 'circle_off'],
  [/^pl_one/, () => 'playlist'],
  [/^pl_add/, () => 'add'],
  [/^pl_toggle/, () => 'check'],
  [/^add_to_pl/, () => 'add'],
  [/^list_options/, () => 'list_options'],
  [/^(vis_)?advance_by_time/, () => 'advance_by_time'],
  [/^(vis_)?advance_24dp/, () => 'skip_next'],
  [/^vis_shuffle/, () => 'shuffle'],
  [/^vis_lock/, () => 'lock'],
  [/^sort_author/, () => 'artist'],
  [/^sort_source/, () => 'folder'],
  [/^sort_rating/, () => 'star'],
  [/^cp_check_on$/, () => 'check_on'],
  [/^cp_check_off$/, () => 'check_off'],
  [/^cp_radio_on$/, () => 'radio_on'],
  [/^cp_radio_off$/, () => 'radio_off'],
  [/^support/, () => 'support_filled'],
  // Inline glyphs (play_rounded_12dp) are plain, not the round button.
  [/^play_rounded_\d+dp$/, () => 'play_rounded'],
  [/^play_round(_inv)?(_rounded)?/, m => round(m[2] ? 'play_rounded' : 'play', 0.52)],
  [/^pause_round(_inv)?(_rounded)?/, m => round(m[2] ? 'pause_rounded' : 'pause', 0.44)],
  [/^ff_round(_inv)?(_rounded)?/, m => round(m[2] ? 'ff_rounded' : 'ff', 0.46)],
  [/^rw_round(_inv)?(_rounded)?/, m => round(m[2] ? 'rw_rounded' : 'rw', 0.46)],
  [/^next_cat_round(_inv)?(_rounded)?/, m => round(m[2] ? 'next_cat_rounded' : 'next_cat', 0.5)],
  [/^prev_cat_round(_inv)?(_rounded)?/, () => round('prev_cat', 0.5)],
  [/^(back_10s_round|back_10s)/, () => 'back_10s'],
  [/^(forward_10s_round|forward_10s)/, () => 'forward_10s'],
  // Transport core glyphs, fitted to the reference's glyph extents in their
  // inset boxes (play 25%, pause 30%, ff 19%, next category 20% of the disc).
  [/^play_core/, (m, n) => fit(n.includes('rounded') ? 'play_rounded' : 'play', 1.486, 1.506, 1.24)],
  [/^pause_core/, (m, n) => fit(n.includes('rounded') ? 'pause_rounded' : 'pause', 1.441, 1.4)],
  [/^ff_core/, (m, n) => fit(n.includes('rounded') ? 'ff_rounded' : 'ff', 1.136, 1, 1.744)],
  [/^rw_core/, (m, n) => fit(n.includes('rounded') ? 'rw_rounded' : 'rw', 1.136, 1, -1.744)],
  [/^next_cat_core/, (m, n) => fit(n.includes('rounded') ? 'next_cat_rounded' : 'next_cat', 1.047, 1.115, 1.436)],
  [/^prev_cat_core/, () => fit('prev_cat', 1.047, 1.115, -1.436)],
  [/^play_(core|small|24dp|12dp)/, (m, n) => (n.includes('rounded') ? 'play_rounded' : 'play')],
  [/^pause_(core|small)/, (m, n) => (n.includes('rounded') ? 'pause_rounded' : 'pause')],
  [/^ff_core/, (m, n) => (n.includes('rounded') ? 'ff_rounded' : 'ff')],
  [/^rw_core/, (m, n) => (n.includes('rounded') ? 'rw_rounded' : 'rw')],
  [/^next_cat/, (m, n) => (n.includes('rounded') ? 'next_cat_rounded' : 'next_cat')],
  [/^prev_cat/, () => 'prev_cat'],
  [/^next_12dp/, () => 'ff'],
  [/^(back|abc_ic_ab_back)/, () => 'back_arrow'],
  [/^shuffle/, () => 'shuffle'],
  [/^repeat_song/, () => 'repeat_song'],
  [/^repeat_advance/, () => 'repeat_advance'],
  [/^repeat_none|^repeat/, () => 'repeat'],
  [/^single_song/, () => 'single_song'],
  [/^menu/, () => 'menu'],
  [/^(hamburger|logo_navbar_hamburger)/, (m, n) => (n.includes('rounded') ? 'hamburger_rounded' : 'hamburger')],
  [/^lyrics|^song_w_lyrics/, () => 'lyrics'],
  [/^(like|thumb_up)/, () => 'like'],
  [/^unlike/, () => 'unlike'],
  [/^love/, () => 'love'],
  [/^unlove/, () => 'unlove'],
  [/^search/, () => 'search'],
  [/^equ_rounded|^equ_thumbs/, (m, n) => (n.includes('thumbs') ? 'equ_thumbs' : 'equ_rounded')],
  [/^(equ|eqbuttons_eq|eq_and_tone|assign_eq|logo_navbar_peq)/, () => 'equ'],
  [/^lists_rounded/, () => 'lists_rounded'],
  [/^lists|^list_16dp|^list_badge/, () => 'lists'],
  [/^vis/, () => 'vis'],
  // Settings screen category icons (settings_<topic>[_colored]).
  [/^settings_look_feel/, () => 'palette'],
  [/^settings_audio/, () => 'vol'],
  [/^settings_vis/, () => 'vis'],
  [/^settings_aa_bg/, () => 'image'],
  [/^settings_aa/, () => 'album'],
  [/^settings_folders_library/, () => 'folder'],
  [/^settings_headset/, () => 'headphones'],
  [/^settings_lockscreen/, () => 'lock'],
  [/^settings_misc/, () => 'menu'],
  [/^settings_general/, () => 'info'],
  [/^settings_equ/, () => 'equ'],
  [/^settings_support/, () => 'support'],
  [/^settings_export/, () => 'export'],
  [/^settings_import/, () => 'import'],
  [/^settings_send_errors/, () => 'exclamation'],
  [/^settings_restore_purchase/, () => 'refresh'],
  [/^settings_pak/, () => 'pak'],
  [/^settings_thumb_up/, () => 'like'],
  [/^settings_utils/, () => 'zap'],
  [/^settings_excl/, () => 'exclamation'],
  [/^settings/, () => 'settings'],
  [/^(chromecast|pre_chromecast|ic_mr)/, () => 'chromecast'],
  [/^up_nav/, () => 'up_nav'],
  [/^scroll_up/, () => 'scroll_up'],
  [/^star_stroke/, () => 'star_stroke'],
  [/^star/, () => 'star'],
  [/^check/, () => 'check'],
  [/^(close|clear|settings_close|ic_dialog_close)/, () => 'close'],
  [/^(add_|pl_add|enqueue|insert_)/, () => 'add'],
  [/^info/, () => 'info'],
  [/^(excl|exclamation|toast_exclamation|fail|unhappy|toast_unhappy)/, () => 'exclamation'],
  [/^folders_hier/, () => 'folders_hier'],
  [/^folder/, () => 'folder'],
  [/^album_art/, () => 'image'],
  [/^albums/, () => 'album'],
  [/^album_artists/, () => 'album_artist'],
  [/^artists/, () => 'artist'],
  [/^composers/, () => 'composer'],
  [/^genres/, () => 'genre'],
  [/^playlists|^playlist|^pl_/, () => 'playlist'],
  [/^(queue|toast_queue|q_|clear_q)/, () => 'queue'],
  [/^(all_songs|song_12dp|pre_song)/, () => 'song'],
  [/^most_played/, () => 'most_played'],
  [/^top_rated/, () => 'like'],
  [/^low_rated/, () => 'unlike'],
  [/^recently_played/, () => 'recently_played'],
  [/^recently_added/, () => 'recently_added'],
  [/^long_files/, () => 'long_files'],
  [/^streams?/, () => 'stream'],
  [/^years/, () => 'years'],
  [/^keep_list_track_pos/, () => 'keep_list_track'],
  [/^keep_list_pos/, () => 'keep_list'],
  [/^keep_track_pos/, () => 'keep_track'],
  [/^(bookmark|keep_)/, () => 'bookmark'],
  [/^raw_file/, () => 'raw_file'],
  [/^(delete|del_dups)/, () => 'delete'],
  [/^(edit|rename)/, () => 'edit'],
  [/^sort/, () => 'sort'],
  [/^share|^send/, () => 'share'],
  [/^sleep_timer/, () => 'clock'],
  [/^unlock_solid/, () => 'unlock'],
  [/^(lock|unlock)/, () => 'lock'],
  [/^l_plus_r_ch/, () => 'l_plus_r_ch'],
  [/^l_ch/, () => 'l_ch'],
  [/^r_ch/, () => 'r_ch'],
  [/^palette/, () => 'palette'],
  [/^(speaker|pre_speaker|ic_vol_type_speaker)/, () => 'speaker'],
  [/^(wired|pre_wired)/, () => 'headphones'],
  [/^(bt_|pre_bt)/, () => 'bt'],
  [/^(usb|pre_usb)/, () => 'usb'],
  [/^global/, () => 'global'],
  [/^image/, () => 'image'],
  [/^(refresh|reset|redo)/, () => 'refresh'],
  [/^filter/, () => 'filter'],
  [/^vol/, () => 'knob'],
  [/^reverb/, () => 'reverb'],
  [/^tone/, () => 'tone'],
  [/^grid_drag/, () => 'grid_drag'],
  [/^list_drag/, () => 'list_drag'],
  [/^question/, () => 'question'],
  [/^account/, () => 'account'],
  [/^zap/, () => 'zigzag'],
  [/^(pak|package|box_badge|app_unlock|unlock_badge)/, () => 'pak'],
  [/^autosave/, () => 'autosave'],
  [/^save/, () => 'save'],
  [/^export/, () => 'export'],
  [/^import/, () => 'import'],
  [/^sine/, () => 'sine'],
  [/^band_pass/, () => 'band_pass'],
  [/^high_pass/, () => 'high_pass'],
  [/^low_pass/, () => 'low_pass'],
  [/^peaking/, () => 'peaking_band'],
  [/^lsf/, () => 'low_shelf'],
  [/^hsf/, () => 'high_shelf'],
  [/^percent/, () => 'percent'],
  [/^(bars|bit|limit|compressor|dvc|range)/, () => 'bars_peak'],
  [/^ic_media_play/, () => 'play'],
  [/^ic_media_pause/, () => 'pause'],
  [/^ic_media_stop/, () => 'stop'],
];

const resolved = new Map();

function resolve(name) {
  if (resolved.has(name)) return resolved.get(name);
  let out = null;
  for (const [re, fn] of RULES) {
    const m = re.exec(name);
    if (m) {
      out = fn(m, name);
      break;
    }
  }
  resolved.set(name, out);
  return out;
}

export function hasIcon(name) {
  return resolve(name) !== null;
}

const svgCache = new Map();

/** SVG markup for a reference drawable name in the given CSS colour. */
export function iconSvg(name, color, mono = true) {
  const key = name + '|' + color + '|' + mono;
  const hit = svgCache.get(key);
  if (hit) return hit;
  const r = resolve(name) ?? 'placeholder';
  let body;
  if (typeof r === 'string' && typeof G[r] === 'object') {
    body = `<g fill="${color}" color="${color}">${G[r].svg}</g>`;
  } else if (typeof r === 'string') {
    body = `<path fill="${color}" d="${G[r] ?? G.placeholder}"/>`;
  } else if (!r.circle) {
    body = `<path fill="${color}" transform="${r.transform}" d="${G[r.glyph]}"/>`;
  } else {
    // Round buttons: tinted -> knocked-out glyph; untinted -> dark disc with light glyph.
    const g = G[r.glyph];
    const glyph = typeof g === 'object' ? `<g transform="${r.transform}">${g.svg}</g>` : `<path transform="${r.transform}" d="${g}"/>`;
    // Mask content depends only on the glyph, so one id per glyph is safe to share.
    const id = 'cpm_' + r.glyph;
    if (mono) body = `<mask id="${id}"><rect width="24" height="24" fill="#fff"/><g fill="#000">${glyph}</g></mask><circle cx="12" cy="12" r="12" fill="${color}" mask="url(#${id})"/>`;
    else body = `<circle cx="12" cy="12" r="12" fill="${color}"/><g fill="#fff">${glyph}</g>`;
  }
  const svg = `<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`;
  svgCache.set(key, svg);
  return svg;
}

export const GLYPHS = G;
