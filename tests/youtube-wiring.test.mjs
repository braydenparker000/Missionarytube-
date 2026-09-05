import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The YouTube provider is only worth anything if it is wired into the app the
 * viewer already has: the same search surface, the same source picker, the
 * same player, the same progress. These check the seams, in the shipped file.
 */

const shell = await readFile("index.html", "utf8");
const appSource = await readFile("assets/js/app.js", "utf8");
const html = `${shell}\n${appSource}`;
const css = await readFile("assets/css/obsidian.css", "utf8");

const region = (pattern) => {
  const match = html.match(pattern);
  assert.ok(match, `expected to find ${pattern}`);
  return match[0];
};

test("the provider modules ship and load before the app that uses them", () => {
  const order = ["config", "instances", "api", "playback"].map(
    (name) => shell.indexOf(`assets/js/youtube/${name}.js`)
  );
  assert.equal(order.every((at) => at > 0), true, "every module is loaded");
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, "in dependency order");
  assert.ok(order[0] > shell.indexOf("assets/js/playback/streams.js"),
    "the planner asks the shared stream module for the browser's capabilities");
});

test("a YouTube item's Astra id is youtube:VIDEO_ID and cannot collide", () => {
  // `contentKey` is type + ":" + id, so a meta of type `youtube` whose id is
  // the video id produces exactly the required key.
  const meta = region(/function youtubeMeta\(video\)\{[\s\S]*?\n {4}\}/);
  assert.match(meta, /id:video\.videoId/);
  assert.match(meta, /type:'youtube'/);
  assert.match(meta, /_providerKey:'youtube'/);
  assert.match(html, /function isYouTubeMeta\(m\)\{return !!m&&m\.type==='youtube'&&!!m\._youtube&&YT\.api\.isVideoId\(m\._youtube\.videoId\)\}/,
    "an add-on's own youtube-typed item is not mistaken for one of ours");
});

test("configuration lives in one module and is stored per browser", () => {
  assert.match(html, /const YOUTUBE_DEFAULTS=YT\.config\.storable\(\{\}\)/);
  assert.match(html, /function youtubeStored\(\)/);
  assert.match(html, /store\.set\('youtube',next\)/);
  // Changing a setting throws the provider away, so measured instance health
  // never outlives the configuration it was measured against.
  const apply = region(/function youtubeApply\(patch\)\{[\s\S]*?\n {4}\}/);
  assert.match(apply, /youtube\.client=null;youtube\.manager=null;youtube\.playbackManager=null;youtube\.config=null;youtube\.browse=null/);
  assert.match(apply, /youtube\.searchAbort\?\.abort\(\)/);
  const stored = region(/function youtubeStored\(\)\{[\s\S]*?\n {4}\}/);
  assert.doesNotMatch(stored, /publicFallbackInstances/, "stale stored server pools are discarded");
});

test("nothing YouTube-shaped runs during the app's first paint", () => {
  const init = region(/async function init\(\)\{.*?\n/);
  assert.equal(/youtube/i.test(init), false, "the provider is not built on startup");
  // It is built on first use, and no sweep runs on its own. The pool is other
  // people's servers, so a full probe only happens when Settings asks for one.
  const provider = region(/function youtubeProvider\(\)\{[\s\S]*?\n {4}\}/);
  assert.match(provider, /if\(!youtube\.client\)\{/);
  assert.equal(/probe\(/.test(provider), false, "nothing sweeps the pool unasked");
  assert.match(provider, /requestTimeout:25000,maxAttempts:1/);
  assert.match(provider, /publicFallbackInstances\.slice\(0,1\)/,
    "playback is pinned to Astra's relay instead of a volunteer fallback");
  assert.match(html, /function testYouTubeInstances\(\)[\s\S]*?manager\.reset\(\)/,
    "a sweep is a deliberate action on the settings screen");
  assert.match(html, /\/\/ Deliberately not awaited: the add-on catalogs must not wait on YouTube\.\s*\n\s*renderYouTubeBrowse\(\)/);
});

test("search is debounced, cancelled and answered as its own provider lane", () => {
  const search = region(/function searchYouTube\(run,group,q\)\{[\s\S]*?\n {4}\}/);
  assert.match(search, /youtube\.searchAbort\?\.abort\(\)/, "a newer query cancels the older request");
  assert.match(search, /const controller=new AbortController\(\)/);
  assert.match(search, /signal:controller\.signal/);
  assert.match(search, /const live=\(\)=>state\.searchRun===run&&run\.token===state\.searchSequence/);
  assert.match(search, /YT\.api\.videoIdFromInput\(q\)/, "a pasted link resolves to that video");
  // The existing 450ms debounce still owns when a search starts.
  assert.match(html, /searchTimer=setTimeout\(\(\)=>search\(q\),450\)/);
  // The group joins the same progressive run the add-ons report into.
  assert.match(html, /const youtubeGroup=youtubeEnabled\(\)\?\{key:'youtube',name:'YouTube'/);
  assert.match(html, /total:searchable\.length\+extra,pending:searchable\.length\+extra/,
    "the progress line counts YouTube honestly");
});

test("thumbnails are lazily loaded, escaped, and shaped like the artwork", () => {
  const card = region(/function youtubeCardHTML\(m,index=0\)\{[\s\S]*?\n {4}\}/);
  assert.match(card, /mediaImage\(art\)/, "the shared image helper carries loading=lazy");
  assert.match(card, /safeUrl\(m\.poster\|\|m\.background\|\|''\)/);
  // Every value interpolated into the card markup is either escaped, produced
  // by a helper that escapes, or a number this file computed itself.
  const SAFE = /^(?:esc\(|icon\(|mediaImage\(|Math\.|pct\b|art\?|duration\?|info\.live\?|info\.author\?' by '\+esc\()/;
  const interpolated = [...card.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(interpolated.length >= 8, "the card does interpolate");
  assert.deepEqual(interpolated.filter((expression) => !SAFE.test(expression)), []);
  assert.match(css, /\.yt-art \{ aspect-ratio: 16 \/ 9; \}/);
});

test("a YouTube video resolves into ordinary Astra streams, in the same picker", () => {
  const load = region(/async function loadYouTubeSources\(m,videoId,options=\{\}\)\{[\s\S]*?\n {4}\}/);
  // The same staleness contract the add-on lookup uses.
  assert.match(load, /const lookup=\{mediaKey:mediaKey\(m\),videoId:String\(videoId\),token:\+\+state\.searchToken\}/);
  assert.match(load, /const stale=\(\)=>player\.lookup!==lookup/);
  assert.match(load, /if\(stale\(\)\)return\[\]/);
  // The plan becomes streams, and the streams go through the existing pipeline.
  assert.match(load, /YT\.playback\.buildPlan\(record,\{/);
  assert.match(load, /capabilities:YT\.playback\.browserCapabilities\(window\)/);
  assert.match(load, /const raw=YT\.playback\.toStreams\(plan,record\)/);
  assert.match(load, /player\.sources=prepareStreams\(raw\)/);
  assert.match(load, /renderStreams\(\)/);
  assert.match(html, /if\(isYouTubeMeta\(m\)\)return loadYouTubeSources\(m,m\._youtube\.videoId\)/);
});

test("the ladder is one session, so a failed delivery falls to the next", () => {
  const open = region(/function openPlayer\(entry,options=\{\}\)\{[\s\S]*?\n {4}\}/);
  assert.match(open, /const ladder=isYouTubeEntry\(entry\)\?player\.sources\.filter\(isYouTubeEntry\):null/);
  assert.match(open, /autoFailover:!!ladder/);
  assert.match(open, /maxAttempts:ladder\?ladder\.length:PB\.engine\.DEFAULT_MAX_ATTEMPTS/,
    "bounded by the number of deliveries, so it cannot loop");
  assert.match(open, /if\(ladder\)player\.session\.play\(candidateKey\(entry\)\)/, "the tapped delivery is the one that starts");
});

test("changing quality keeps the position, in place where it can and by seek where it cannot", () => {
  const select = region(/function selectQuality\(id\)\{[\s\S]*?\n {4}\}/);
  // Adaptive: the adapter swaps the representation, so nothing moves.
  assert.match(select, /if\(entry\.variantId===currentYouTubeVariant\(\)&&entry\.inPlace\)\{/);
  assert.match(select, /player\.adapter\.selectVideoQuality\(target\.id\)/);
  // Progressive: a different file, so the playhead is carried across.
  assert.match(select, /const at=Number\(el&&el\.currentTime\)/);
  assert.match(select, /player\.pendingSeek=Number\.isFinite\(at\)&&at>1\?at:null/);
  assert.match(select, /player\.session\.play\(candidateId\)/);

  // And the attempt honours a switch seek exactly, unlike a history resume
  // which deliberately stops short of the end.
  const attempt = region(/const switching=Number\.isFinite\(player\.pendingSeek\)[\s\S]*?scope\.listen\(el,'loadedmetadata',[\s\S]*?\n {6}\}\);/);
  assert.match(attempt, /const limit=switching\?el\.duration-1:el\.duration\*\.93/);
  assert.match(attempt, /player\.pendingSeek=null/);
});

test("only qualities that will play are offered, and the active one is marked", () => {
  const options = region(/function qualityOptions\(\)\{[\s\S]*?\n {4}\}/);
  assert.match(options, /const plan=player\.youtube&&player\.youtube\.plan/);
  assert.match(options, /plan\.qualities\.map/, "the ladder is the plan's, which already filtered by capability");
  assert.match(options, /player\.adapter\.getVideoQualities\(\)/, "and a non-YouTube adaptive stream still gets its own list");
  assert.match(html, /qualities\.length>1\?'<button class="track-option" data-track-menu="quality"/, "quality lives in Options and only appears when there is a choice");
  assert.match(html, /data-quality\]',root\)\.forEach\(x=>x\.onclick=\(\)=>selectQuality\(x\.dataset\.quality\)\)/);
});

test("captions travel the existing subtitle path, marked for the fetch they need", () => {
  assert.match(html, /const captions=player\.youtube\?YT\.playback\.toSubtitles\(player\.youtube\.plan\):\[\]/);
  assert.match(html, /const raw=\[\.\.\.\(s\.subtitles\|\|\[\]\),\.\.\.captions,/);
});

test("progress, Continue Watching and the library work on a YouTube item unchanged", () => {
  // Nothing special: the meta is an ordinary meta with an ordinary key, so the
  // existing recorder, the resume list and the save button all already apply.
  assert.match(html, /function youtubeMeta\(video\)\{[\s\S]*?return recordMeta\(\{/);
  const detail = region(/function showDetail\(m,loading=false\)\{[\s\S]*?\n {4}\}/);
  assert.match(detail, /cta=m\.type==='youtube'\s*\n\s*\?`\$\{resumeProg&&!resumeProg\.completed\?'Continue':'Play'\} this video`/);
  assert.match(detail, /data-get-streams="\$\{esc\(resume\.id\)\}"/);
});

test("a failed playback link is re-resolved once, never in a loop", () => {
  const refresh = region(/function youtubeMaybeRefresh\(\)\{[\s\S]*?\n {4}\}/);
  assert.match(refresh, /if\(!yt\|\|yt\.refreshed\)return false/);
  assert.match(refresh, /yt\.refreshed=true/, "one refresh per resolution, so a dead video cannot loop");
  assert.match(refresh, /\{fresh:true\}/);
  assert.match(html, /if\(options\.fresh\)youtubeProvider\(\)\.client\.forget\(videoId\)/);
});

test("every failure ends in a MissionaryTube error, never a redirect to YouTube", () => {
  assert.match(html, /YouTube playback is temporarily unavailable/);
  const text = region(/function youtubeErrorText\(error\)\{[\s\S]*?\n {4}\}/);
  assert.match(text, /YT\.instances\.describeFailure\(error\.kind\)/);
  assert.match(text, /error\.kind==='content'/, "an unavailable video says what YouTube said");
  assert.match(text, /error\.kind==='no-instance'/);
  // No path anywhere sends the viewer to YouTube to watch it instead.
  assert.equal(/window\.open\([^)]*youtu/i.test(html), false);
  assert.equal(/href="https:\/\/(?:www\.)?youtu/i.test(html), false);
});

test("the settings screen owns the whole provider and stores no address in the repo", () => {
  assert.match(html, /youtube:renderYouTubeSettings/, "it has a route");
  const settings = region(/function renderYouTubeSettings\(\)\{[\s\S]*?\n {4}\}/);
  assert.match(settings, /data-youtube-toggle="enabled"/);
  assert.match(settings, /data-youtube-toggle="preferAdaptive"/);
  assert.match(settings, /id="youtubeInstance"/);
  assert.match(settings, /data-youtube-select="maxHeight"/);
  assert.match(settings, /data-youtube-test/);
  assert.match(settings, /const usingPrivate=!!config\.privateInstanceUrl/,
    "a configured private relay unlocks adaptive playback");
  assert.doesNotMatch(settings, /snapshot\.instances\.map\(youtubeInstanceRowHTML\)/,
    "raw relay rows stay out of the customer-facing settings screen");
  assert.match(settings, /YT\.config\.describeInstanceProblem\(value\)/, "a bad address is explained, not silently dropped");
  assert.match(settings, /placeholder="https:\/\/piped\.example\.org"/, "the only address in the file is a placeholder");
  assert.match(settings, /id="youtubeInstanceApi"/, "and it says which protocol that server speaks");
  assert.match(settings, /Stored in this browser only/);
});
