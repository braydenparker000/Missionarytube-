import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The repository is public. These checks fail the build if a configured add-on
 * URL, credential, or personal stream URL is ever committed.
 */

// External pinned checkouts and deployment/rollback artifacts are not committed source.
const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".github", ".jarvis-source", "rollback", "upload", ".backend-release", ".runtime-release", ".runtime-parent"]);
const TEXT = /\.(?:js|mjs|cjs|html|css|json|jsonc|md|yml|yaml|py)$/;

async function sourceFiles(directory = ".") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const editable = directory === 'frontend' || directory.startsWith('frontend/');
    if ((!editable && SKIP_DIRS.has(entry.name))) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (TEXT.test(entry.name)) found.push(path);
  }
  return found;
}

// All current source is scanned; there is no exempt archive tree.
const files = await sourceFiles();
const contents = new Map();
for (const path of files) contents.set(path, await readFile(path, "utf8"));

/** Hosts the app is allowed to reference, with why each is acceptable. */
const ALLOWED_HOSTS = [
  "api.torbox.app", // Read-only JSON lookup for the selected TorBox source
  "torrentio.strem.fun", // Only recognize the public resolver URL shape
  "v3-cinemeta.strem.io", // the public default add-on, no configuration or token
  "opensubtitles-v3.strem.io", // Stremio's public subtitle add-on, no configuration or token
  "cdn.jsdelivr.net", // pinned, integrity-checked player runtimes
  "registry.npmjs.org", // used by the dependency pinning script
  "api.anthropic.com", // the scheduled-task trigger shape Jarvis Chats fires (its URL itself is a Worker secret)
  // The public pool the provider resolves through. All are public
  // infrastructure run by volunteers, with no token anywhere in the URL.
  // Piped leads because its API is CORS-enabled by design, which is what a
  // browser-only static site needs.
  "astra-youtube-relay.braydenparker999.chatgpt.site", // Astra's controlled search and media relay
  "api.piped.private.coffee",
  "pipedapi.ducks.party",
  "api.piped.yt",
  "api.piped.privacydev.net",
  "pipedapi.reallyaweso.me",
  "pipedapi.kavin.rocks",
  "pipedapi.adminforge.de",
  "pipedapi.leptons.xyz",
  "pipedapi.nosebs.ru",
  "yewtu.be",
  "inv.nadeko.net",
  "invidious.nerdvpn.de",
  // The link shapes the search box accepts when one is pasted in. They are
  // parsed to recover a video id; nothing is ever requested from them.
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "github.com",
  "storage.googleapis.com", // exact checksum-verified official Chrome-for-Testing archive, CI fixtures only
  "api.github.com", // bounded read-only public qualification and production-run provenance
  "token.actions.githubusercontent.com", // public GitHub OIDC issuer documented for the existing federation
  "claude.ai",
  "code.claude.com",
  "raw.githubusercontent.com",
  "avatars.githubusercontent.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "gsap.com", // license notices embedded in the pinned self-hosted motion bundle
  "schema.org",
  "json-schema.org",
  "www.w3.org",
  "developer.mozilla.org",
  "creativecommons.org",
  "missionarytube.z13.web.core.windows.net", // the owner's own public site URL
  "missionarytube.blob.core.windows.net", // same existing Azure account data-plane endpoint for authenticated rollback download
  "gray-meadow-09216fd10.1.azurestaticapps.net", // retired Jarvis Static Web App, named in historical docs
  "jarvis-hub-api.braydenparker999.workers.dev", // unchanged Jarvis backend
  "api.cloudflare.com", // CI-only preflight for the existing Worker's bindings
  "developers.google.com", // official Drive download and error handling documentation
  "support.google.com", // Google's documented source-access recovery process
  "www.googleapis.com", // existing Drive playback origin checked without logging query credentials
  "cdn.dashjs.org" // negative fixture only: proves validation rejects the mutable /latest/ URL
];

// Public references already present in the selected frontend. Scope these to
// their actual consumers instead of exempting an editable source snapshot.
const FRONTEND_PUBLIC_HOSTS = {
  'scripts/migrate-drive-to-r2.py': ['oauth2.googleapis.com'], // existing owner OAuth token endpoint
  'tests/python/test_r2_oauth.py': ['oauth2.googleapis.com'], // mocked token endpoint
  'scripts/drive-publisher-auth.mjs': ['oauth2.googleapis.com'], // unchanged scheduled publisher token endpoint
  'backend/connector.js': ['chatgpt.com'], // existing OAuth client policy
  'backend/wrangler.jsonc': ['jarvis-relay-egress.vercel.app'], // unchanged configured public relay endpoint
  'backend/relay-common.js': ['chatgpt.com'],
  'backend/relay-connector.js': ['chatgpt.com'],
  'backend/relay-makima-policy.js': ['cursor.com', 'www.cursor.com'], // existing client policy
  'backend/relay-makima.js': ['www.cursor.com'],
  'backend/relay-core-alarm.js': ['developers.cloudflare.com'], // API documentation reference
  'backend/podcasts.js': ['gpodder.net'], // existing fallback directory
  'backend/songsterr.js': ['www.songsterr.com', 'dqsljvtekg760.cloudfront.net', 'd3d3l6a6rcgkaf.cloudfront.net'], // existing score provider
  'package-lock.json': ['opencollective.com'], // locked package funding metadata
  'backend/tests/hub.test.js': ['chatgpt.com'], // synthetic tests of actual client policy
  'backend/tests/oauth-consent-browser.test.js': ['chatgpt.com', 'chromedevtools.github.io'],
  'backend/tests/podcast-directory-contract.test.js': ['itunes.apple.com'],
  // Captured public provider contracts, not synthetic account fixtures. Requests
  // are mocked; retaining these public URLs also exercises the SSRF validator.
  'backend/tests/contracts/podcasts/apple-search.json': ['itunes.apple.com', 'podcasts.apple.com', 'rss.amperwave.net', 'is1-ssl.mzstatic.com', 'feeds.megaphone.fm'],
  'backend/tests/contracts/podcasts/apple-alternate.json': ['itunes.apple.com', 'www.itunes.com', 'podcasts.apple.com', 'rss.amperwave.net', 'is1-ssl.mzstatic.com', 'feeds.megaphone.fm'],
  'backend/tests/podcasts.test.js': ['www.itunes.com', 'a.internal', '127.0.0.1.nip.io', 'metadata.google.internal', 'itunes.apple.com', 'gpodder.net'], // SSRF refusals and mocked directory calls
  'backend/tests/publications.test.js': ['chatgpt.com'],
  'backend/tests/relay-oauth.test.js': ['chatgpt.com'],
  'backend/tests/relay-owner-assistant-attachments-runtime.test.js': ['chatgpt.com'],
  'backend/tests/relay-makima.test.js': ['cursor.com', 'www.cursor.com'],
  'backend/tests/relay-makima-callback-redirect-browser.test.js': ['cursor.com'],
  'backend/tests/relay-makima-cookie-browser.test.js': ['cursor.com'],
  'backend/tests/relay-makima-diagnostics.test.js': ['cursor.com'],
  'backend/tests/relay-makima-double-submit-browser.test.js': ['cursor.com'],
  'backend/tests/relay-makima-token-diagnostics.test.js': ['www.cursor.com'],
  'frontend/assets/app.js': ['scripts.sil.org'], // embedded font license
  'frontend/assets/relay.css': ['scripts.sil.org'], // embedded font license
  'frontend/assets/connect.js': ['chatgpt.com'], // existing user-facing link
  'frontend/assets/quick-ai-providers.js': ['api.tavily.com', 'generativelanguage.googleapis.com', 'api.groq.com'], // existing direct providers
  'frontend/drawercast/player.js': ['drive.google.com', 'play.google.com', 'www.google.com', 'www.sqlite.org'], // existing Drive links and bundled license notices
  'frontend/guitar/pdf.js': ['cdnjs.cloudflare.com', 'jspdf.default.namespaceuri'], // bundled PDF loader and XML namespace, not a service
  'frontend/guitar/engine.js': ['www.alphatab.net'], // bundled renderer license
  'frontend/guitar/sources.js': ['www.songsterr.com', 'gprotab.net'], // "Open on…" links to the tab's source page
  'frontend/guitar/credits.html': ['www.songsterr.com', 'gprotab.net', 'creativecommons.org'], // attribution links
  'backend/guitar-sources.js': ['gprotab.net', 'gleitz.github.io', 'itunes.apple.com'], // fixed tab, sample and cover upstreams
  'backend/tests/guitar-sources.test.js': ['gprotab.net', 'gleitz.github.io', 'itunes.apple.com', 'is1-ssl.mzstatic.com'], // mocked upstream calls
  'frontend/astra/vendor/mediabunny.js': ['mozilla.org', 'www.webmproject.org', 'aomediacodec.github.io'], // vendored package license and codec spec notices
  'frontend/astra/vendor/mediabunny-ac3.js': ['mozilla.org', 'streams.videolan.org'],
  'frontend/astra/vendor/mediabunny-dts.js': ['mozilla.org', 'streams.videolan.org'],
  'frontend/astra/vendor/LICENSES.md': ['mozilla.org', 'ffmpeg.org'], // third-party notices
  'frontend/mymedia/app.js': ['i.ytimg.com'], // existing thumbnails
  'frontend/mymedia/library.js': ['i.ytimg.com'],
  'frontend/podcasts/directory.js': ['itunes.apple.com'], // existing public podcast directory
  'frontend/portal/index.html': ['cdnjs.cloudflare.com'], // existing portal runtime
  'frontend/quick-ai/index.html': ['generativelanguage.googleapis.com', 'api.groq.com', 'api.tavily.com'], // unchanged deployed document policy
  'frontend/mymedia/index.html': ['i.ytimg.com'], // unchanged deployed document policy
  'frontend/youtube-archive/privacy.html': ['myaccount.google.com'], // existing account-management link
  'docs/daily-board-premium-plan.md': ['openai.com', 'a2ui.org'], // research references in the plan
  'backend/tests/relay-mast-board.test.js': ['particle.news', 'en.wikipedia.org'], // weak-source examples for the quality check
  'tests/daily-board-report.test.mjs': ['particle.news'] // weak-source example for the quality check
};

function isAllowed(host, path) {
  if (ALLOWED_HOSTS.includes(host)) return true;
  if (FRONTEND_PUBLIC_HOSTS[path]?.includes(host)) return true;
  // Reserved documentation/test names can never resolve to a real service.
  return /(?:^|\.)(?:example\.(?:test|com|org|net)|example|test|invalid|localhost)$/.test(host);
}

test("no committed file references a non-allowlisted external host", () => {
  const offenders = [];
  for (const [path, source] of contents) {
    for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi)) {
      const host = match[1].toLowerCase();
      if (!isAllowed(host, path)) offenders.push(`${path}: ${host}`);
    }
  }
  assert.deepEqual(offenders, [], "an unexpected host may be a configured add-on or personal stream URL");
});

test('editable frontend files are privacy-scanned and archived endpoint allowances cannot authorize a new consumer', () => {
  assert.ok(files.includes('frontend/daily-board/v1/live.js'));
  assert.ok(files.includes('frontend/astra/src/engine/player.js'));
  assert.ok(files.includes('frontend/assets/app.js'));
  assert.equal(isAllowed('api.tavily.com', 'frontend/assets/quick-ai-providers.js'), true);
  assert.equal(isAllowed('api.tavily.com', 'frontend/daily-board/v1/live.js'), false);
  assert.equal(isAllowed('private-addon.invalid-provider.com', 'frontend/daily-board/v1/live.js'), false);
});

test('editable frontend rejects configured URLs, credential literals and unknown hosts through the actual privacy gate', async t => {
  const root = await mkdtemp(join(tmpdir(), 'frontend-privacy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'frontend/daily-board/v1'), {recursive: true});
  const childEnv = {...process.env};
  delete childEnv.NODE_TEST_CONTEXT;
  for (const source of [
    `const url = "https://example.invalid/${'x'.repeat(28)}/manifest.json";`,
    `const client_${'secret'} = "${'synthetic-placeholder-value'}";`,
    'const url = "https://private-service.' + 'example-provider.com/data";'
  ]) {
    await writeFile(join(root, 'frontend/daily-board/v1/live.js'), source);
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^no committed file', fileURLToPath(import.meta.url)], {cwd: root, encoding: 'utf8', env: childEnv});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /not ok .*no committed file/);
  }
});

test("no committed file contains a Stremio-style configured manifest path", () => {
  // A configured AIOStreams/Comet manifest carries its token in the path.
  const configured = /https?:\/\/[^\s"'`]*\/[A-Za-z0-9_=-]{24,}\/manifest\.json/g;
  const offenders = [];
  for (const [path, source] of contents) {
    for (const match of source.matchAll(configured)) offenders.push(`${path}: ${match[0].slice(0, 60)}…`);
  }
  assert.deepEqual(offenders, []);
});

test("no committed file contains credential-shaped values", () => {
  const patterns = [
    [/\bAccountKey\s*=/i, "Azure storage account key"],
    [/\bDefaultEndpointsProtocol\s*=/i, "Azure connection string"],
    [/\bsig=[A-Za-z0-9%+/=]{20,}/, "SAS signature"],
    [/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']{12,}["']/i, "credential literal"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "JWT"],
    [/\brealdebrid|\balldebrid|\bpremiumize|\btorbox\b.{0,40}[:=]\s*["'][^"']{12,}/i, "debrid credential"]
  ];

  const offenders = [];
  for (const [path, source] of contents) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(source)) offenders.push(`${path}: ${label}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("test fixtures use only reserved, non-resolvable hosts", async () => {
  const fixtureFiles = files.filter((path) => path.includes("fixtures"));
  assert.ok(fixtureFiles.length > 0, "there are fixtures to check");

  for (const path of fixtureFiles) {
    for (const match of contents.get(path).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].toLowerCase();
      assert.match(
        host,
        /(?:^|\.)(?:example\.(?:test|com|org|net)|example|test|invalid|localhost)$/,
        `${path} references ${host}, which is not a reserved test name`
      );
    }
  }
});

test("no fixture carries a plausible real infohash or token", () => {
  for (const path of files.filter((file) => file.includes("fixtures"))) {
    const source = contents.get(path);
    for (const match of source.matchAll(/\b[0-9a-f]{40}\b/gi)) {
      assert.match(
        match[0],
        /^(.)\1{39}$/i,
        `${path} contains ${match[0]}, which looks like a real infohash`
      );
    }
  }
});
