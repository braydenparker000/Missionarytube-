import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
const css = await readFile("assets/css/obsidian.css", "utf8");
const hubSource = await readFile("assets/js/hub.js", "utf8");

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

test("YouTube, podcasts and radio are gone from navigation and product scope", () => {
  // The taxonomy owns the decision; the app asks it rather than re-listing it.
  assert.match(hubSource, /var OUT_OF_SCOPE = \[/);
  for (const type of ["youtube", "podcast", "radio"]) {
    assert.match(hubSource, new RegExp(`"${type}"`), `${type} must be named as out of scope`);
  }
  assert.equal(/id: "(?:youtube|podcast|radio)"/.test(hubSource), false, "no sector may remain");
  assert.match(html, /excludeType:AstraHub\.isOutOfScope/, "the registry drops them too");
  assert.match(html, /AstraHub\.isOutOfScope\(t\)/, "and so does the add-on row's own type list");
  // The four destinations are Home, Search, Library and Settings.
  assert.match(html, /const navs=\[\['home','home','Home'\],\['search','search','Search'\],\['library','library','Library'\],\['settings','settings','Settings'\]\]/);
  for (const gone of ["'Podcasts'", "'Radio'", "'YouTube'"]) {
    assert.equal(html.includes(gone), false, `${gone} must not be a label in the app`);
  }
});

test("playback keeps its YouTube adapter, through the no-cookie host", () => {
  // Removing YouTube as a destination must not rewrite a playback contract: a
  // stream an add-on returns as a YouTube id still plays.
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

test("content coverage reaches every content type, including future ones", () => {
  assert.match(html, /<section class="page" id="page-settings"/);
  assert.match(html, /settingsRouteHTML\('coverage'/, "coverage is a named settings destination");
  assert.match(html, /coverage:renderHub/, "and it renders the same honest list");
  assert.match(html, /function renderHub\(\)/);
  assert.match(html, /function openHubSector\(id\)/);
  assert.match(html, /data-hub-open\]',root\)\.forEach\(x=>x\.onclick=\(\)=>openHubSector\(x\.dataset\.hubOpen\)\)/);
});

test("settings is an information architecture, not one endless sheet", () => {
  // Every group is a destination with the same header, and the dock keeps
  // four one-handed tabs instead of growing one per surface.
  for (const route of ["addons", "catalogs", "coverage", "audio", "data"]) {
    assert.match(html, new RegExp(`settingsRouteHTML\\('${route}'`), `${route} must be a settings route`);
    assert.match(html, new RegExp(`${route}:render`), `${route} must resolve to a renderer`);
  }
  assert.match(html, /function screenHead\(title\)/, "one sub-screen header, used by all of them");
  assert.match(html, /data-settings-route="root" aria-label="Back to settings"/);
  // Changing a control is the save, and the schema migration runs on the way.
  assert.match(html, /data-select-setting\]',root\)\.forEach\(x=>x\.onchange=\(\)=>saveSettings\(\)\)/);
  assert.match(html, /state\.settings=AstraPlayback\.settings\.migrate\(state\.settings\);\s*store\.set\('settings'/);
});

test("every catalog names the add-on that published it", () => {
  assert.match(html, /function providerChip\(name,extra=''\)/);
  // A rail says it once in the section head; a genuinely mixed browse grid
  // says it per result. Search V2 keeps providers in separate result lanes.
  assert.match(html, /function catalogNote\(entry,type\)/);
  assert.match(html, /parts\.push\(providerChip\(entry\.providerName\)\)/);
  assert.match(html, /options\.showSource&&source\?`<span class="card-source">\$\{esc\(source\)\}<\/span>`:''/);
  assert.match(html, /function searchProviderHTML\(group,run\)/);
  assert.match(html, /<div class="rail-scroll search-result-rail">\$\{cardsHTML\(items\)\}<\/div>/);
  assert.match(html, /Results remain separated by source/);
  assert.match(html, /function browseSourceLine\(list\)/, "browse states which add-ons produced the grid");
  assert.match(css, /\.provider-chip \{/);
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
  assert.match(html, /const DETAIL_KINDS=\[\['episodes','Episodes','episode'\],\['specials','Specials','special'\],\['extras','Extras','extra'\],\['unknown','Other','item'\]\]/);
  assert.match(html, /data-detail-kind="\$\{id\}"/, "video groups are switched explicitly rather than concatenated");
  assert.match(html, /function detailKindVideos\(groups,browser\)/);
  assert.match(html, /<div class="season-band" role="tablist" aria-label="Seasons">/);
  assert.match(html, /tabindex="\$\{String\(season\)===String\(browser\.season\)\?0:-1\}"/);
  assert.match(html, /data-episode-search/);
  assert.match(html, /data-episode-load-more/);
  assert.match(html, /hasVideoBrowser\?seriesSectionsHTML\(videos,defaultSeason\):''/, "the browser renders before story metadata");
  assert.match(css, /\.episode-nav-sticky \{[\s\S]*?position: sticky;/);
  assert.match(css, /\.episode-focus \{/);
});

test("source selection exposes reported audio and subtitle capabilities before playback", () => {
  assert.match(html, /function sourceCapabilitiesHTML\(list\)/);
  assert.match(html, /Dual audio/);
  assert.match(html, /data=>!!\(data&&Array\.isArray\(data\.subtitles\)\)/, "subtitle add-ons still load after choosing a source");
  assert.match(html, /\.slice\(0,3\)\.map\(language=>tag\(String\(language\)\.toUpperCase\(\),'info'\)\)/);
  assert.match(html, /s\.subtitles\?\.length&&tag/);
  assert.match(css, /\.source-intel \{/);
});

test("modal icon buttons and switches expose names and live state", () => {
  for (const label of ["Close torrent details", "Close add-on installer"]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  for (const setting of ["subtitlesDefault", "showAdult"]) {
    assert.match(html, new RegExp(`data-setting="${setting}"[^>]+aria-label="[^"]+"[^>]+aria-pressed="\\$\\{s\\.${setting}\\}"`));
  }
  // A control that no longer changes anything is removed, not left switchable.
  for (const gone of ["autoplayNext", "preferCached", "autoFailover", "hdrPreference", "maxResolution"]) {
    assert.equal(html.includes(gone), false, `${gone} no longer decides anything`);
  }
  assert.match(html, /x\.setAttribute\('aria-pressed',String\(state\.settings\[k\]\)\)/);
});

test("the lead deck holds real titles and never auto-advances", () => {
  // The deck is a scroller of catalog items, so nothing moves under a thumb.
  assert.match(html, /<div class="feature-deck" id="heroDeck">/);
  assert.match(html, /function bindHeroDeck\(\)/);
  assert.match(html, /deck\.scrollLeft\/Math\.max\(1,deck\.clientWidth\)/, "position is read, not tracked");
  assert.equal(/setInterval|autoplay.*hero|heroTimer/i.test(html), false, "no auto-advance timer");
  assert.match(css, /\.feature-deck \{[\s\S]*?scroll-snap-type: inline mandatory;/);
  // With no provider, the standby composition is the surface itself: it never
  // stands in for artwork that does not exist.
  assert.match(html, /function welcomeFeatureHTML\(\)/);
  assert.match(html, /<div class="feature-empty">/);
  assert.match(css, /\.feature-empty \{/);
  assert.match(css, /\.feature-art::after \{/, "one hard scrim keeps copy readable over any artwork");
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
  // Continue Watching progress bar measured 0px and never drew. The sibling
  // cases were only saved by the block element above them.
  const spanClasses = new Set();
  for (const m of html.matchAll(/<span class="([^"$]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) spanClasses.add(c);
  }
  const offenders = [];
  for (const cls of [...spanClasses].sort()) {
    // Take the last declaration, since a later section may override an earlier one.
    const rules = [...css.matchAll(new RegExp(`\\n\\.${cls.replace(/-/g, "\\-")} \\{([^}]*)\\}`, "g"))];
    if (!rules.length) continue;
    const all = rules.map((r) => r[1]).join(";");
    const needsBlock = /(margin-top|margin-bottom|padding-top|padding-bottom|(?<!line-)height:|-webkit-line-clamp)/.test(all);
    if (!needsBlock) continue;
    const isBlock = /display:\s*(block|grid|flex|-webkit-box|inline-block|inline-flex)/.test(all);
    const isPositioned = /position:\s*absolute/.test(all);
    if (!isBlock && !isPositioned) offenders.push(cls);
  }
  assert.deepEqual(offenders, [], `these spans style a box they do not have: ${offenders.join(", ")}`);
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


test("mobile navigation is a floating capsule with safe-area clearance", () => {
  const dock = css.match(/\n\.dock \{[^}]*\}/)?.[0] || "";
  assert.match(dock, /inset: auto/, "the dock must float away from the viewport edges");
  assert.match(dock, /border-radius: 24px/);
  assert.match(dock, /backdrop-filter: blur\(26px\)/);
  assert.match(dock, /box-shadow:/);
  assert.equal(/border-top:/.test(dock), false, "a floating dock is not a full-width bottom rule");
  assert.match(css, /\.dock-btn\.active \{[^}]*background:/, "the whole active destination is a pill");
  assert.match(css, /\.content \{[\s\S]*?padding:[^;]*var\(--dock\)/, "content clears the floating dock");
});

test("episode and movie source selection opens an immediate independent drawer", () => {
  assert.match(html, /<div id="streamOverlayRoot"><\/div>/);
  assert.match(html, /const root=\$\('#streamOverlayRoot'\);if\(!root\)return\[\];/);
  assert.match(html, /root\.innerHTML=streamDrawerHTML\('<div class="source-loading">/, "loading feedback opens immediately");
  assert.match(html, /function closeStreamPicker\(\)/);
  assert.match(html, /data-dismiss-streams/);
  const load = html.match(/async function loadStreams[\s\S]*?return state\.currentStreams;/)?.[0] || "";
  assert.equal(load.includes("scrollIntoView"), false, "episode selection must not jump below the episode list");
  assert.match(css, /\.source-drawer-backdrop \{[\s\S]*?position: fixed/);
  assert.match(css, /\.source-drawer \{[\s\S]*?max-height: 91svh/);
  assert.match(css, /\.source-drawer-body \{[\s\S]*?overflow-y: auto/);
});
