// Song covers from Apple's iTunes Search API, looked up from the browser
// (Apple refuses the Worker's requests). The artist must match; the title
// only ranks the matches.
const simple = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

export function coverSearchURL(artist, title) {
  const t = String(title || '').replace(/\s+\d+$/, '').replace(/\s*\((?:acoustic|live|solo|intro|cover|easy|fingerstyle|ver(?:sion)?\.?\s*\d*)\)\s*$/i, '').replace(/\s*\(.*?\)\s*/g, ' ');
  const term = `${String(artist || '').trim().slice(0, 120)} ${t.trim().slice(0, 160)}`.trim();
  return `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&media=music&limit=8`;
}

// The best match's 300px artwork on Apple's image CDN, or ''.
export function pickArtwork(results, artist, title) {
  const a = simple(artist), t = simple(title);
  if (!a) return '';
  const scored = (Array.isArray(results) ? results : []).filter(r => typeof r?.artworkUrl100 === 'string' && /^https:\/\/is\d-ssl\.mzstatic\.com\//.test(r.artworkUrl100))
    .map(r => {
      const name = simple(r.artistName), track = simple(r.trackName);
      return { r, artist: name === a ? 4 : name && (name.includes(a) || a.includes(name)) ? 2 : 0, title: track === t ? 2 : track.startsWith(t) ? 1 : 0 };
    })
    .filter(x => x.artist).sort((x, y) => y.artist + y.title - x.artist - x.title);
  return scored.length ? scored[0].r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg') : '';
}
