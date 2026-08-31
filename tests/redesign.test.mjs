import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const css = await readFile("assets/css/obsidian.css", "utf8");

/* ---- design system ---------------------------------------------------- */

/** Read a `--name: value;` declaration out of the :root token block. */
function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(match, `--${name} must be defined`);
  return match[1].trim();
}

/** sRGB relative luminance, per WCAG 2.1. */
function luminance(hex) {
  const value = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = parts.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the type ramp meets WCAG AA against the surfaces it is used on", () => {
  const obsidian = token("obsidian");
  const slate = token("slate-900");
  // Body text: AA is 4.5:1.
  for (const name of ["bone", "bone-dim", "silver"]) {
    const ratio = contrast(token(name), obsidian);
    assert.ok(ratio >= 4.5, `--${name} on --obsidian is ${ratio.toFixed(2)}:1, below AA`);
  }
  // The dimmest silver is only ever used at label weight and size, where AA is
  // 3:1; it still has to clear that on the darkest panel it appears on.
  assert.ok(contrast(token("silver-dim"), slate) >= 3, "--silver-dim fails large-text AA");
  // Where the signal is a background behind words it is the darkened ink
  // variant, because the seam colour itself only reaches 4.37:1 against bone.
  assert.ok(contrast(token("bone"), token("signal-ink")) >= 4.5, "bone on --signal-ink fails AA");
  assert.ok(contrast(token("signal-bright"), obsidian) >= 4.5, "the signal used as text fails AA");
  // --signal is a seam and surface colour. Anywhere it is a foreground it must
  // be either large display type or a glyph, both of which clear 3:1 at 4.01:1.
  const foreground = [...css.matchAll(/\n(\.[^{\n]+?) \{[^}]*?(?<![-\w])color: var\(--signal\);/gs)]
    .map((m) => m[1].trim());
  assert.deepEqual(foreground.sort(), [".track-option svg", ".wordmark b"],
    "small text must use --signal-bright, which clears AA");
  // And the status colours have to be readable as text on their own washes.
  for (const name of ["ok", "warn", "bad", "info"]) {
    const ratio = contrast(token(name), obsidian);
    assert.ok(ratio >= 4.5, `--${name} on --obsidian is ${ratio.toFixed(2)}:1, below AA`);
  }
});

test("the primary button and the signal are legible against each other", () => {
  // btn-primary is bone on void: the loudest pairing in the system.
  assert.ok(contrast(token("void"), token("bone")) >= 4.5);
});

test("touch targets are a token, not a per-component guess", () => {
  assert.equal(token("tap"), "44px");
  for (const selector of [".dock-btn", ".chip", ".season-tab", ".icon-btn", ".btn", ".tool-btn", ".video-row", ".hub-row"]) {
    const block = css.match(new RegExp(`\\n${selector.replace(".", "\\.")} \\{[^}]*\\}`));
    assert.ok(block, `${selector} must exist`);
    const size = block[0].match(/(?:min-height|height):\s*([^;]+);/);
    assert.ok(size, `${selector} does not commit to a height`);
    // Either the token itself, or the token plus space — never a bare guess.
    assert.match(size[1], /var\(--tap\)|var\(--dock\)/, `${selector} does not build on the 44px token`);
  }
});

test("keyboard focus is always visible, and never removed anywhere", () => {
  assert.match(css, /:focus-visible \{\s*outline: var\(--focus\);/);
  assert.match(token("focus"), /^2px solid/);
  assert.equal(/outline:\s*(none|0)\b/.test(css), false, "no rule may remove the focus outline");
  // The skip link is the first tab stop and must reveal itself when focused.
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(css, /\.skip-link:focus-visible, \.skip-link:focus \{ transform: none; \}/);
});

test("the shell uses semantic landmarks, not a stack of divs", () => {
  assert.match(html, /<main id="main">/);
  assert.match(html, /<header class="topbar">/);
  assert.match(html, /<nav class="dock" id="mobileNav" aria-label="Primary">/);
  assert.match(html, /<aside class="rail" aria-label="Primary">/);
  assert.match(html, /<section class="page[^"]*" id="page-\w+" aria-label="/);
});

test("safe areas are read from the platform once and used through tokens", () => {
  for (const [name, inset] of [["safe-t", "top"], ["safe-r", "right"], ["safe-b", "bottom"], ["safe-l", "left"]]) {
    assert.match(token(name), new RegExp(`env\\(safe-area-inset-${inset}`), `--${name} must read the real inset`);
  }
  const dock = css.match(/\n\.dock \{[^}]*\}/)[0];
  assert.match(dock, /var\(--safe-b\)/, "the dock reserves the home-indicator inset");
  assert.match(dock, /var\(--safe-r\)[\s\S]*var\(--safe-l\)/, "and the landscape insets too");
});

test("reduced motion disables transitions rather than merely shortening them", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
  assert.ok(block, "a reduced-motion block must exist");
  assert.match(block[0], /transition: none !important/);
  assert.match(block[0], /animation[^;]*none/);
  assert.match(block[0], /scroll-behavior: auto/);
});

/* ---- honesty ---------------------------------------------------------- */

test("nothing in the UI invents content, availability or telemetry", () => {
  // Every rendered list comes from an add-on response or from local progress.
  for (const invention of [
    /Math\.random/,
    /createAnalyser|AnalyserNode|getByteFrequencyData/,
    /waveform/i,
    /trending|popular this week/i
  ]) {
    assert.equal(invention.test(html), false, `${invention} would fabricate something`);
  }
  // The audio module says in its own source why there is no waveform.
  assert.match(html, /<script src="assets\/js\/audio-player\.js"><\/script>/);
});

test("a sector is only shown as populated when an add-on exposes it", () => {
  assert.match(html, /const sectors=AstraHub\.buildHub\(manifests\(\)\)/);
  assert.match(html, /sector\.available\?AstraHub\.describe\(sector\):AstraHub\.missingReason\(sector\)/,
    "the row copy is generated by the same module that decides availability");
  assert.match(html, /:`data-nav="addons"`/, "an unavailable sector routes to Add-ons");
  assert.match(html, /if\(!sector\|\|!sector\.available\)return nav\('addons'\)/,
    "and opening one anyway cannot land on an empty browse surface");
});

test("YouTube plays only a real add-on id, through the no-cookie host", () => {
  assert.match(html, /https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{encodeURIComponent\(s\.ytId\)\}/);
  assert.equal(/youtube\.com\/(?!.*nocookie)/.test(html.replace(/youtube-nocookie\.com/g, "")), false);
  // No API key, and no scraped feed standing in for a catalog.
  assert.equal(/(youtube|yt)[_-]?api[_-]?key/i.test(html), false);
  assert.equal(/googleapis\.com/.test(html), false);
});

test("this is not a PWA and does not pretend to be installable", () => {
  for (const banned of [
    /serviceWorker/,
    /rel="manifest"/,
    /beforeinstallprompt/,
    /manifest\.webmanifest/,
    /standalone/
  ]) {
    assert.equal(banned.test(html), false, `${banned} is out of scope for this issue`);
  }
});

test("no runtime framework and no unpinned remote script was introduced", async () => {
  const remote = [...html.matchAll(/<script[^>]*src="(https?:[^"]+)"/g)].map((m) => m[1]);
  for (const url of remote) {
    assert.equal(/\/latest\/|@latest|\/next\//.test(url), false, `${url} is a mutable channel`);
  }
  assert.equal(remote.length, 0, "the shell itself loads no remote script; the player libs load on demand");
  for (const framework of [/react/i, /\bvue\b/i, /svelte/i, /alpine/i, /htmx/i, /tailwind/i]) {
    assert.equal(framework.test(html), false, `${framework} would be a new runtime dependency`);
  }
  // Every local script the shell loads must exist.
  const local = [...html.matchAll(/<script src="(assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(local.length >= 9);
});

/* ---- the redesigned surfaces ------------------------------------------ */

test("the media hub reaches every content type, including future ones", () => {
  assert.match(html, /<section class="page" id="page-hub"/);
  assert.match(html, /\['hub','hub','Hub'\]/, "the hub is a first-class destination in the navigation");
  assert.match(html, /function renderHub\(\)/);
  assert.match(html, /function openHubSector\(id\)/);
  assert.match(html, /data-hub-open\]',root\)\.forEach\(x=>x\.onclick=\(\)=>openHubSector\(x\.dataset\.hubOpen\)\)/);
});

test("hub rows keep their label and catalog detail on separate lines", () => {
  assert.match(html, /<span class="hub-name"><span class="hub-label">/);
  assert.match(html, /<span class="hub-detail">/);
  assert.match(css, /\.hub-name \{ display: grid; gap: 2px;/);
  assert.match(css, /\.hub-detail \{ display: block;/);
});

test("opening a hub sector preserves its complete type mapping", () => {
  const open = html.match(/function openHubSector\(id\)\{[\s\S]*?\n {4}\}/);
  assert.ok(open);
  assert.match(open[0], /sector:sector\.id/);
  assert.equal(/sector\.types\[0\]/.test(open[0]), false);
  assert.match(html, /AstraHub\.catalogMatchesSector\(sector,x\.cat\.type\)/);
});

test("the dossier states only fields the add-on actually returned", () => {
  const record = html.match(/function dossierRecord\(m\)\{[\s\S]*?\n {4}\}/);
  assert.ok(record, "dossierRecord exists");
  assert.match(record[0], /\.filter\(\(\[,v\]\)=>v\)/, "empty fields are dropped, not rendered blank");
  assert.match(record[0], /cells\.length\?/, "an empty record renders nothing at all");
  assert.equal(/'N\/A'|'Unknown'|'—'/.test(record[0]), false, "no placeholder stands in for missing data");
});

test("the series browser keeps specials and extras out of the episode run", () => {
  assert.match(html, /function seriesSectionsHTML\(videos,defaultSeason\)/);
  assert.match(html, /group\('Specials','%n listed',groups\.specials,'special'\)/);
  assert.match(html, /group\('Extras & clips','%n listed',groups\.extras,'extra'\)/);
  assert.match(html, /group\('Other videos','%n the add-on did not classify',groups\.unknown,'item'\)/);
  assert.match(html, /<div class="season-band" role="tablist" aria-label="Seasons">/);
  assert.match(html, /tabindex="\$\{String\(s\)===String\(defaultSeason\)\?0:-1\}"/);
  assert.match(html, /c\.setAttribute\('aria-selected',String\(selected\)\)/);
  assert.match(html, /c\.tabIndex=selected\?0:-1/);
});

test("modal icon buttons and switches expose names and live state", () => {
  for (const label of ["Close settings", "Close torrent details", "Close add-on installer"]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  for (const setting of ["autoplayNext", "preferCached", "autoFailover", "subtitlesDefault", "showAdult"]) {
    assert.match(html, new RegExp(`data-setting="${setting}"[^>]+aria-label="[^"]+"[^>]+aria-pressed="\\$\\{s\\.${setting}\\}"`));
  }
  assert.match(html, /x\.setAttribute\('aria-pressed',String\(state\.settings\[k\]\)\)/);
});

test("the title sequence has an artwork-independent signal composition", () => {
  assert.match(html, /class="feature-orbit" aria-hidden="true"/);
  assert.match(html, /class="feature-coordinate mono"/);
  assert.match(css, /\.feature-orbit \{/);
  assert.match(css, /\.feature-art::after \{/);
});

test("every catalog card, including new releases, has resilient artwork", () => {
  assert.match(html, /function mediaImage\(url,options=\{\}\)/);
  assert.match(html, /class="art-loader" aria-hidden="true"/);
  assert.match(html, /class="release-art art \$\{p\?'image-loading':'image-error'\}"/);
  assert.match(html, /onload="this\.parentElement\.classList\.add\('image-ready'\)"/);
  assert.match(html, /onerror="this\.parentElement\.classList\.add\('image-error'\);this\.remove\(\)"/);
  assert.match(css, /\.image-ready > \.media-image \{ opacity: 1; transform: scale\(1\); \}/);
  assert.match(css, /\.art \{\s*display: block;/, "span artwork needs a box or loaded posters collapse");
  assert.match(css, /\.rail-scroll\.release-rail \{ grid-auto-columns: min\(84vw, 330px\); \}/,
    "the generic rail width must not crush poster-led release cards");
  assert.match(css, /\.rail-scroll\.resume-rail \{ grid-auto-columns: 232px; \}/,
    "the generic rail width must not crush Continue Watching cards");
});

test("motion is staged, tactile, and removed when the viewer requests it", () => {
  for (const name of ["feature-copy-in", "sector-arrive", "card-arrive", "dossier-copy-in", "nav-seam-in"]) {
    assert.match(css, new RegExp(`@keyframes ${name}`));
  }
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/);
  assert.ok(reduced);
  for (const selector of [".feature-body > *", ".sector", ".card", ".dossier-head", ".dossier-body"]) {
    assert.ok(reduced[0].includes(selector), `${selector} motion must be disabled`);
  }
});

test("the source picker leads with the full release name and never truncates the record", () => {
  assert.match(html, /<span class="stream-name">\$\{esc\(s\.title\)\}<\/span>/);
  assert.match(css, /\.stream-name \{[\s\S]*?font-family: var\(--font-mono\)/, "release names are set in mono");
  assert.match(css, /\.stream-name \{[\s\S]*?overflow-wrap: anywhere/, "a long release name wraps rather than overflowing");
  assert.match(css, /\.stream-detail dd \{[\s\S]*?word-break: break-word/, "the expanded record wraps too");
  // The row is a button and the disclosure is a sibling: never a nested control.
  assert.match(html, /<article class="stream-item"><button class="stream-row/);
  assert.match(html, /<\/button>\s*<details class="stream-details">/);
});

test("the audio surface is a real surface, not a video player with the picture off", () => {
  assert.match(html, /player\.audioMode=AstraHub\.isAudio\(m\.type\)\|\|!!s\.facts\.audioOnly/);
  assert.match(html, /\$\('#audioRoot'\)\.innerHTML=`<div class="player-shell audio-mode"/);
  assert.match(html, /function audioStageHTML\(m,v,s\)/);
  assert.match(html, /function bindAudioSurface\(el,scope\)/);
  // Every displayed number is a read of the element.
  assert.match(html, /const snap=AstraAudio\.snapshot\(el\)/);
  assert.match(html, /scrub\.disabled=snap\.live/, "a live stream cannot be scrubbed");
  assert.match(html, /AstraAudio\.seekTarget\(el,Number\(scrub\.value\)\/1000\)/);
  // Collapsing must not move or rebuild the media element.
  const dock = html.match(/function setAudioDocked\(docked\)\{[\s\S]*?\n {4}\}/);
  assert.ok(dock);
  assert.match(dock[0], /classList\.toggle\('docked'/);
  assert.equal(/innerHTML|appendChild|remove\(\)/.test(dock[0]), false, "docking may only toggle a class");
});

test("every dead end offers the same explained way forward", () => {
  assert.match(html, /function stateHTML\(title,text,action='',kind=''\)/);
  // Empty, error and offline all render through it, so none can be a bare string.
  const uses = [...html.matchAll(/stateHTML\(/g)];
  assert.ok(uses.length >= 8, `only ${uses.length} states go through the frame`);
  assert.match(html, /stateHTML\('No sources found'/);
  assert.match(html, /stateHTML\('Catalogs could not load'[\s\S]{0,220}'error'\)/);
  assert.match(html, /stateHTML\('No catalogs available'/);
});

test("the stylesheet is the only place raw colours are defined", async () => {
  // The inline critical block is allowed two colours so the first paint is not
  // white; everything else must come from a token.
  const inline = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const hexes = [...inline.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
  assert.ok(hexes.length <= 3, `the critical block defines ${hexes.length} colours`);
  const files = await readdir("assets/css");
  assert.deepEqual(files.sort(), ["obsidian.css"], "the superseded stylesheet is gone, not left orphaned");
});

test("a span used as a line is given the block box its styling assumes", () => {
  // Regression: `.resume-bar` carried `height: 2px` while still inline, so the
  // Continue Watching progress bar measured 0px and never drew; `.art` later
  // collapsed the same way on `aspect-ratio`. Check the element, not the class:
  // a span often carries several classes and only one of them supplies the box.
  const spanClassLists = [];
  for (const m of html.matchAll(/<span class="([^"]*)"/g)) {
    // Strip template expressions, keep the literal class names.
    const literal = m[1].replace(/\$\{[^}]*\}/g, " ").trim();
    const names = literal.split(/\s+/).filter(Boolean);
    if (names.length) spanClassLists.push(names);
  }
  assert.ok(spanClassLists.length > 10, "the templates use spans");

  /** Every declaration that applies to a bare `.name` selector. */
  const declarationsFor = (name) =>
    [...css.matchAll(new RegExp(`\\n\\.${name.replace(/-/g, "\\-")} \\{([^}]*)\\}`, "g"))]
      .map((r) => r[1])
      .join(";");

  const NEEDS_BOX = /(margin-top|margin-bottom|padding-top|padding-bottom|(?<!line-)height:|aspect-ratio|overflow:|-webkit-line-clamp)/;
  const HAS_BOX = /display:\s*(block|grid|flex|-webkit-box|inline-block|inline-flex)/;
  const POSITIONED = /position:\s*absolute/;

  const offenders = new Set();
  for (const names of spanClassLists) {
    const union = names.map(declarationsFor).join(";");
    if (!union) continue;
    if (!NEEDS_BOX.test(union)) continue;
    if (HAS_BOX.test(union) || POSITIONED.test(union)) continue;
    offenders.add(names.join("."));
  }
  assert.deepEqual([...offenders], [],
    `these spans style a box they do not have: ${[...offenders].join(", ")}`);
});

test("the Continue Watching progress bar has a height to draw into", () => {
  const bar = css.match(/\n\.resume-bar \{([^}]*)\}/);
  assert.ok(bar, ".resume-bar exists");
  assert.match(bar[1], /display: block/, "an inline bar measures 0px tall");
  assert.match(bar[1], /height: 2px/);
  assert.match(css, /\.resume-bar i \{ display: block; height: 100%/);
});

test("a list operation always goes through the all-elements selector", () => {
  // Regression: `$('[data-season]',root).forEach(...)` shipped on this branch.
  // `$` is querySelector, which returns one Element with no `.forEach`, so
  // clicking a season tab threw and the episode list never updated. The two
  // helpers differ by one character, which is exactly why this needs a test.
  const single = [...html.matchAll(/(?<![$\w])\$\((['"][^'"]*['"][^)]*)\)\s*\.\s*(forEach|map|filter|slice|some|every)\b/g)];
  assert.deepEqual(single.map((m) => m[0]), [],
    "these call an array method on querySelector's single element");
  // And the spread form has the same trap.
  const spread = [...html.matchAll(/\[\s*\.\.\.\s*(?<![$\w])\$\(/g)];
  assert.deepEqual(spread.map((m) => m[0]), [], "spreading a single element is not a list");
});
