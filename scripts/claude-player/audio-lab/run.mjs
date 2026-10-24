// Audio lab runner: renders the Claude Player's playback chain offline in
// Chrome and reports clipping, clicks, level dips and render cost per
// scenario. With --base <git ref> the same scenarios also run against that
// revision's player source, side by side.
//
//   node scripts/claude-player/audio-lab/run.mjs [--base origin/main] [--only a,b|/regex/]
//        [--track file.opus ...] [--json out.json] [--md out.md]
//
// Chrome: JARVIS_CHROME, CHROME_PATH, /usr/bin/google-chrome or /usr/bin/chromium.
// --track files are decoded by Chrome and run through the hot-signal
// scenarios; they are read locally and never leave the machine.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, rm, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep, extname, basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav'};

export function findChrome() {
  return [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
}

/** Serves the lab page, the player source and optional base snapshot and tracks. */
export async function startLab({baseDir = null, tracks = []} = {}) {
  const roots = [
    ['/lab/', join(repo, 'scripts/claude-player/audio-lab')],
    ['/claude-player/', join(repo, 'frontend/claude-player')],
    ...(baseDir ? [['/base/claude-player/', join(baseDir, 'frontend/claude-player')]] : []),
  ];
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://lab').pathname);
      if (path === '/' || path === '/lab.html') {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('<!doctype html><meta charset="utf-8"><title>Audio lab</title><script type="module">import "/lab/lab.js"; window.audioLabReady = true;</script>');
        return;
      }
      const track = /^\/tracks\/(\d+)$/.exec(path);
      if (track && tracks[+track[1]]) {
        res.writeHead(200, {'Content-Type': TYPES[extname(tracks[+track[1]])] ?? 'application/octet-stream'});
        res.end(await readFile(tracks[+track[1]]));
        return;
      }
      for (const [prefix, dir] of roots) {
        if (!path.startsWith(prefix)) continue;
        const file = resolve(dir, '.' + path.slice(prefix.length - 1));
        if (!file.startsWith(dir + sep) || !(await stat(file)).isFile()) break;
        res.writeHead(200, {'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream'});
        res.end(await readFile(file));
        return;
      }
      res.writeHead(404); res.end();
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const chrome = findChrome();
  if (!chrome) throw new Error('The audio lab needs Chrome. Set JARVIS_CHROME.');
  const browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/lab.html`);
  await page.waitForFunction(() => window.audioLabReady === true && window.audioLab);
  return {
    page, errors,
    run: (opts = {}) => page.evaluate(o => window.audioLab.runScenarios({...o, names: (o.names ?? []).map(n => (n.startsWith('/') ? new RegExp(n.slice(1, -1)) : n))}), opts),
    scenarios: () => page.evaluate(() => window.audioLab.scenarios()),
    close: async () => { await browser.close(); await new Promise(done => { server.closeAllConnections(); server.close(done); }); },
  };
}

/** A checkout of frontend/claude-player at `ref` in a temporary directory. */
export async function snapshot(ref) {
  const dir = await mkdtemp(join(tmpdir(), 'audio-lab-base-'));
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', ref, 'frontend/claude-player/src'], {maxBuffer: 1 << 28});
  execFileSync('tar', ['-x', '-C', dir], {input: tar});
  return dir;
}

const fmt = v => (v === undefined || v === null ? '' : typeof v === 'number' ? String(v) : String(v));

function table(rows, base) {
  const keys = new Set();
  for (const r of rows) for (const k of Object.keys(r.metrics)) keys.add(k);
  const lines = [];
  for (const r of rows) {
    const b = base?.find(x => x.name === r.name);
    const cells = Object.keys(r.metrics).map(k => `${k}=${b ? fmt(b.metrics[k]) + ' → ' : ''}${fmt(r.metrics[k])}`);
    lines.push(`| ${r.name} | ${r.title ?? ''} | ${cells.join(', ')} |${r.errors?.length ? ' errors: ' + r.errors.join(' / ').slice(0, 300) : ''}`);
  }
  return ['| scenario | what | metrics' + (base ? ' (base → current)' : '') + ' |', '| --- | --- | --- |', ...lines].join('\n');
}

async function main() {
  const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const tracks = args.flatMap((a, i) => (a === '--track' ? [resolve(args[i + 1])] : []));
  const names = (opt('--only') ?? '').split(',').filter(Boolean);
  const baseRef = opt('--base');
  const baseDir = baseRef ? await snapshot(baseRef) : null;
  const lab = await startLab({baseDir, tracks});
  try {
    const info = Object.fromEntries((await lab.scenarios()).map(s => [s.name, s]));
    const variants = tracks.flatMap((t, i) => [
      {name: `real${i}-default`, from: 'hot-default', title: `${basename(t)}: default chain`, signal: {kind: 'file', url: `/tracks/${i}`, at: 45}},
      {name: `real${i}-limiter-off`, from: 'hot-limiter-off', title: `${basename(t)}: limiter off`, signal: {kind: 'file', url: `/tracks/${i}`, at: 45}},
    ]);
    const want = [...names, ...variants.map(v => v.name)];
    const current = await lab.run({names: names.length ? want : [], variants});
    const base = baseDir ? await lab.run({names: names.length ? want : [], variants, srcBase: '/base/claude-player/src/'}) : null;
    for (const r of current) r.title = info[r.name]?.title ?? variants.find(v => v.name === r.name)?.title;
    const md = table(current, base);
    console.log(md);
    if (lab.errors.length) console.log('page errors:', lab.errors.join('\n'));
    if (opt('--json')) await writeFile(opt('--json'), JSON.stringify({base, current}, null, 2));
    if (opt('--md')) await writeFile(opt('--md'), md + '\n');
  } finally {
    await lab.close();
    if (baseDir) await rm(baseDir, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
