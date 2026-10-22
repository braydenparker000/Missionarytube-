// Demo queue for development and screenshots (?demo): original generated
// artwork and virtual-clock playback; no third-party media.

const SPECS = [
  {title: 'Northern Lights', artist: 'Glass Harbor', album: 'Low Tide', ms: 214000, hues: [205, 265]},
  {title: 'Paper Satellites', artist: 'The Quiet Hours', album: 'Orbit Songs', ms: 187000, hues: [18, 340]},
  {title: 'Saltwater Static', artist: 'Mira Okafor', album: 'Coastlines', ms: 246000, hues: [160, 95]},
  {title: 'A Very Long Song Title That Does Not Fit On One Line', artist: 'Glass Harbor', album: 'Low Tide', ms: 305000, hues: [45, 10]},
];

function makeArt(hues, seed) {
  const size = 600;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hues[0]} 70% 45%)`);
  grad.addColorStop(1, `hsl(${hues[1]} 65% 18%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.fillStyle = `hsla(${hues[i % 2]} 80% ${40 + rnd() * 40}% / ${0.25 + rnd() * 0.35})`;
    g.arc(rnd() * size, rnd() * size, 40 + rnd() * 180, 0, Math.PI * 2);
    g.fill();
  }
  return new Promise(resolve => c.toBlob(b => resolve({url: URL.createObjectURL(b), width: size, height: size}), 'image/png'));
}

export async function demoTracks() {
  const out = [];
  let i = 0;
  for (const s of SPECS) {
    const art = await makeArt(s.hues, ++i);
    out.push({id: 'demo' + i, title: s.title, artist: s.artist, album: s.album, durationMs: s.ms, art, src: null, wave: null, meta: 'FLAC 44.1kHz 16bit'});
  }
  return out;
}
