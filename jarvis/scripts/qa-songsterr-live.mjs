// Optional live acceptance-data capture. Temporary JSON is never shipped.
// Curl uses the development environment's proxy; production uses Worker fetch.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { searchSongs, getSong, getRevisions } from '../backend/songsterr.js';
const run = promisify(execFile);
const fetcher = async (url, { signal }) => {
  const { stdout } = await run('curl', ['--max-time', '20', '-sS', '-D', '-', '-w', '\n%{http_code}', url], { signal, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  const split = stdout.lastIndexOf(10);
  let bytes = stdout.subarray(0, split), headers = {};
  while (bytes.subarray(0, 5).toString() === 'HTTP/') {
    const end = bytes.indexOf('\r\n\r\n');
    for (const line of bytes.subarray(0, end).toString().split('\r\n').slice(1)) { const colon = line.indexOf(':'); if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim(); }
    bytes = bytes.subarray(end + 4);
  }
  return new Response(bytes, { status: Number(stdout.subarray(split + 1).toString()), headers });
};
const data = { searches: {}, songs: {}, scores: {} };
for (const query of ['Greensleeves', 'Mediterranean Sundance', 'Sultans of Swing', 'Money Pink Floyd', 'xqzzv999887766nonsense']) {
  const results = await searchSongs(query, { fetcher, timeout: 25000 });
  data.searches[query.toLowerCase()] = { results };
  console.log(query, results.slice(0, 4).map(r => ({ id: r.songId, title: r.title, artist: r.artist, tracks: r.tracks.length })));
  if (!results.length) continue;
  const candidate = query === 'Greensleeves' ? results.find(s => s.tracks.filter(t => t.kind === 'guitar').length === 1) : results[0];
  const meta = await getSong(candidate.songId, { fetcher, timeout: 25000 });
  data.songs[meta.songId] = { song: meta };
  const guitars = meta.tracks.filter(t => t.kind === 'guitar');
  const revisions = await getRevisions(meta, query === 'Mediterranean Sundance' ? guitars : guitars.slice(0, 1), { fetcher, timeout: 25000 });
  data.scores[meta.songId] = { meta, revisions };
  console.log('captured', meta.songId, revisions.map(r => ({ partId: r.trackMeta.partId, bars: r.revision.measures.length })));
  await writeFile(process.argv[2] || '/tmp/guitar-live-fixtures.json', JSON.stringify(data));
}
