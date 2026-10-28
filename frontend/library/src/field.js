// The soft, slowly moving light behind the page. Drawn small and stretched, so
// it stays smooth and cheap; it rests while a book is open.

const TINTS = {
  shelf: ['#c9d8c6', '#e8d9bf', '#c8d1e8'],
  reader: ['#d9d3c4', '#cfd6dd', '#e1d6c6'],
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
let cur = TINTS.shelf.map(hex), target = cur.map(c => c.slice()), resting = false;

export function tintField(name) {
  target = (TINTS[name] || TINTS.shelf).map(hex);
  resting = name === 'reader';
}

export function startField(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let bg = '#eef0ec', alpha = 0.55;
  const theme = () => {
    const cs = getComputedStyle(document.documentElement);
    bg = cs.getPropertyValue('--bg').trim() || bg;
    alpha = parseFloat(cs.getPropertyValue('--field-a')) || alpha;
  };
  const size = () => { canvas.width = Math.ceil(innerWidth / 6); canvas.height = Math.ceil(innerHeight / 6); };
  theme(); size();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
  addEventListener('resize', size);
  const blobs = [[0.15, 0.18, 0.65, 0.07], [0.88, 0.3, 0.55, 0.09], [0.25, 0.85, 0.6, 0.06], [0.82, 0.92, 0.5, 0.08]];
  let last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!resting || dt === 0) {
      const w = canvas.width, h = canvas.height, M = Math.max(w, h), t = still ? 0 : now / 1000, k = Math.min(1, dt * 1.5);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (target[i][j] - cur[i][j]) * k;
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      blobs.forEach(([bx, by, br, s], i) => {
        const x = (bx + Math.sin(t * s * 6 + i * 1.7) * 0.09) * w, y = (by + Math.cos(t * s * 5 + i) * 0.07) * h, c = cur[i % 3];
        const g = ctx.createRadialGradient(x, y, 0, x, y, br * M);
        g.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`); g.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
