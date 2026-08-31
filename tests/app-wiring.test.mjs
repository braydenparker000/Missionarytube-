import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");
// The design system moved out of the inline <style> into a reviewable, cacheable
// stylesheet. The guarantees the player chrome depends on are asserted against
// that file now; they are the same guarantees, in the same terms.
const css = await readFile("assets/css/obsidian.css", "utf8");

test("the app loads the progress store before its own script", () => {
  const module = html.indexOf('<script src="assets/js/progress-store.js"></script>');
  const app = html.indexOf("<script>\n  (()=>{'use strict';");
  assert.ok(module > -1, "progress-store.js must be loaded");
  assert.ok(app > module, "the app script must run after the store is defined");
  assert.match(html, /const progress=AstraProgress\.createProgressStore\(/);
});

test("no progress write embeds add-on metadata any more", () => {
  assert.equal(html.includes("meta:m}"), false, "progress records must not carry a meta object");
  assert.equal(html.includes("store.set('progress'"), false, "progress is owned by the store module");
  assert.equal(html.includes("state.progress"), false, "the raw progress map is gone");
  assert.match(html, /progress\.record\(m,v,\{time:el\.currentTime,duration:el\.duration\}\)/);
  assert.match(html, /progress\.record\(m,v,\{time:el\.duration,duration:el\.duration,completed:true,immediate:true\}\)/);
});

test("localStorage writes cannot throw out of the app", () => {
  const setter = html.match(/set\(k,v\)\{[^}]*\}[^}]*\}/);
  assert.ok(setter, "store.set must exist");
  assert.match(setter[0], /try\{/);
  assert.match(setter[0], /catch\{storageFailed\(\)/);
  assert.match(html, /const storageArea=\(\(\)=>\{try\{/, "localStorage access itself is guarded");
});

test("pending progress is flushed when playback or the page ends", () => {
  assert.match(html, /window\.addEventListener\('pagehide',\(\)=>progress\.flush\(\)\)/);
  assert.match(html, /document\.visibilityState==='hidden'\)progress\.flush\(\)/);
  // Playback Engine v2 registers the pause listener through the attempt's
  // resource scope, so it is released with the rest of the attempt.
  assert.match(html, /scope\.listen\(el,'pause',\(\)=>progress\.flush\(\)\)/);
  assert.match(html, /function closePlayer\(silent\)\{[\s\S]{0,500}?progress\.flush\(\)/);
});

test("completion is only ever recorded from a real ended event", () => {
  const completions = [...html.matchAll(/progress\.record\([^;]*completed:true[^;]*\)/g)];
  assert.equal(completions.length, 1, "exactly one place marks an episode complete");

  // That one place must sit inside the 'ended' listener, never in an error path.
  const endedListener = html.match(/scope\.listen\(el,'ended',\(\)=>\{[\s\S]*?\n\s*\}\);/);
  assert.ok(endedListener, "the ended listener exists");
  assert.ok(endedListener[0].includes(completions[0][0]), "completion is recorded from the ended event");
  assert.ok(!/report\('error'[^;]*completed:true/.test(html), "no failure path marks progress complete");
});

test("a continue watching card still opens after a reload", () => {
  assert.match(html, /state\.homeItems\.find\(x=>mediaKey\(x\)===key\)\|\|progress\.meta\(key\)/);
});

test("backups round-trip the normalized progress shape", () => {
  assert.match(html, /progress:progress\.snapshot\(\)/);
  assert.match(html, /progress\.replace\(d\.progress\|\|\{\}\)/);
  assert.equal(html.includes("['addons','library','progress','settings']"), false);
});

/* ---- Playback Engine v2 wiring ---------------------------------------- */

test("every playback module is loaded before the app script", () => {
  const app = html.indexOf("<script>\n  (()=>{'use strict';");
  for (const name of ["settings", "streams", "adapters", "engine", "episodes", "subtitles"]) {
    const at = html.indexOf(`<script src="assets/js/playback/${name}.js"></script>`);
    assert.ok(at > -1, `${name}.js is not loaded`);
    assert.ok(at < app, `${name}.js must load before the app script`);
  }
  // settings.js is read by streams.js for the resolution ceiling.
  assert.ok(
    html.indexOf('playback/settings.js') < html.indexOf('playback/streams.js'),
    "settings must load before streams"
  );
});

test("the v1 playback path is fully removed", () => {
  for (const gone of ["function streamFacts(", "function bestCompatibleStream(", "function playStream(", "function streamKind("]) {
    assert.equal(html.includes(gone), false, `${gone} still present`);
  }
  assert.equal(html.includes("data-play-stream="), false, "the old index-based stream binding is gone");
});

test("settings are migrated through the schema on load, save and import", () => {
  assert.match(html, /const DEFAULT_SETTINGS=AstraPlayback\.settings\.DEFAULTS/);
  assert.match(html, /settings:AstraPlayback\.settings\.migrate\(store\.get\('settings',\{\}\)\)/);
  assert.match(html, /state\.settings=AstraPlayback\.settings\.migrate\(state\.settings\)/, "save validates");
  assert.match(html, /state\.settings=AstraPlayback\.settings\.migrate\(\{\.\.\.state\.settings,\.\.\.d\.settings\}\)/, "import validates");
});

test("the player is driven by engine snapshots, not ad-hoc state", () => {
  assert.match(html, /PB\.engine\.createSession\(\{/);
  assert.match(html, /onAttempt:startAttempt,onChange:renderPlayerState/);
  assert.match(html, /player\.session\.report\(attemptId,event,detail\)/, "events are scoped to their attempt");
  assert.match(html, /snapshot\(\)\.attemptId===attemptId/, "stale attempts are filtered at the DOM boundary");
});

test("closing the player cancels the session, adapter, scope and countdown", () => {
  const close = html.match(/function closePlayer\(silent\)\{[\s\S]*?\n {4}\}/);
  assert.ok(close, "closePlayer exists");
  for (const required of ["player.session.cancel()", "teardownAttempt()", "progress.flush()", "$('#countdownCard')"]) {
    assert.ok(close[0].includes(required), `closePlayer must call ${required}`);
  }
  const teardown = html.match(/function teardownAttempt\(\)\{[\s\S]*?\n {4}\}/);
  assert.ok(teardown[0].includes("player.adapter.destroy()"), "the adapter is destroyed");
  assert.ok(teardown[0].includes("player.scope.dispose()"), "the resource scope is disposed");
});

test("the close binding cannot silence the player teardown", () => {
  // onclick=closePlayer would hand the click Event in as the silent flag,
  // tearing down the session but leaving the player on screen.
  assert.match(html, /data-close-player\]',root\)\.forEach\(x=>x\.onclick=\(\)=>closePlayer\(\)\)/);
  assert.equal(html.includes("x.onclick=closePlayer)"), false, "never pass the handler directly");
  assert.match(html, /if\(silent===true\)return;/, "only an explicit true suppresses the restore");
});

test("a next episode always starts from a fresh stream lookup", () => {
  const goTo = html.match(/async function goToEpisode\(video\)\{[\s\S]*?\n {4}\}/);
  assert.ok(goTo, "goToEpisode exists");
  assert.ok(goTo[0].includes("state.currentStreams=[];player.sources=[]"), "previous streams are discarded");
  assert.ok(goTo[0].includes("closePlayer(true)"), "the previous player is torn down first");
  assert.ok(goTo[0].includes("loadStreams(video.id)"), "the next episode opens its own source list");
  assert.equal(/openPlayer/.test(goTo[0]), false, "and nothing starts playing on its own");
});

test("the player offers every required recovery action", () => {
  for (const action of ["retry", "next", "choose"]) {
    assert.ok(html.includes(`data-player-action="${action}"`), `missing the ${action} action`);
  }
  assert.match(html, /data-close-player>Close/, "a close action is offered on the error card");
  assert.match(html, /playerAction\(x\.dataset\.playerAction\)/);
});

test("fullscreen is user-initiated and feature-detected", () => {
  assert.match(html, /document\.fullscreenEnabled\?/, "the control only renders when supported");
  assert.match(html, /requestFullscreen\?\.\(\)/, "the call is optional-chained");
  assert.ok(
    html.indexOf("data-player-action=\"fullscreen\"") > -1,
    "fullscreen runs from a click handler, never automatically"
  );
});

test("the picker surfaces compatibility instead of hiding sources", () => {
  assert.match(html, /class="stream-row \$\{ev\.playable\?'':'blocked'\}/);
  assert.match(html, /class="stream-why">\$\{esc\(entry\.why\)\}/, "each row explains itself");
  assert.match(html, /chip-sm state-\$\{ev\.state\}/, "the compatibility state is labelled");
  // Nothing filters, sorts or ranks: the add-on's order is what is shown.
  for (const gone of ["STREAM_FILTERS", "data-stream-filter", "data-stream-sort", "data-play-best", "sortedStreams", "bestCandidate"]) {
    assert.equal(html.includes(gone), false, `${gone} would edit the add-on's own result list`);
  }
  assert.match(html, /player\.sources=prepareStreams\(state\.currentStreams\)/);
  assert.match(html, /const list=player\.sources,total=list\.length/, "the picker renders the prepared list as-is");
});

test("the close control can never be faded out or made unclickable", () => {
  // A YouTube iframe swallows pointer events, so if the whole top bar faded the
  // viewer would have no way to bring it back: they would be trapped.
  assert.match(css, /\.player-shell\.idle \.player-title, \.player-shell\.idle \.player-tools \{ opacity: 0; pointer-events: none; \}/);
  assert.equal(/\.player-shell\.idle \.player-top\s*\{/.test(css), false, "the top bar itself must not fade");
  assert.match(css, /\.player-top \[data-close-player\] \{ opacity: 1; pointer-events: auto; \}/);
  // The audio surface has its own close control, and it is never in the fading set.
  assert.match(html, /<div class="audio-dock-actions">[\s\S]*?data-close-player/, "the docked audio bar keeps a close control");
});

test("the mobile overlay respects safe areas and reduced motion", () => {
  // The top bar clears the notch on every edge, with a floor so a device that
  // reports no inset still gets a real touch margin.
  assert.match(css, /\.player-top \{[\s\S]*?padding:\s*max\(14px, calc\(var\(--safe-t\) \+ var\(--s2\)\)\)/);
  assert.match(css, /--safe-t:\s*env\(safe-area-inset-top/, "the safe-area token reads the real inset");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}\.stream-row/);
  assert.match(html, /function motionOk\(\)\{return !window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches\}/);
  // Player v3 owns the video controls and keeps every layer above the stage.
  assert.match(css, /\.player-v3 \.player-tools \{[\s\S]*?z-index: 5;/);
  // The stage must sit below the chrome or it swallows every control tap.
  assert.match(css, /\.player-stage \{ position: absolute; z-index: 1;/);
  assert.match(html, /<video id="mediaEl" autoplay playsinline preload="metadata"><\/video>/, "video uses the custom mobile controls");
  assert.match(html, /id="videoScrub"[\s\S]*?data-player-action="seek-back"|data-player-action="seek-back"[\s\S]*?id="videoScrub"/, "seek and timeline controls ship together");
  assert.match(html, /<audio id="mediaEl" controls autoplay><\/audio>/, "the audio surface keeps native controls too");
});

test("episode ordering is used everywhere videos are listed", () => {
  assert.match(html, /AstraPlayback\.episodes\.canonicalEpisodes\(videos\)/, "the main episode list uses only canonical episodes");
  assert.match(html, /AstraPlayback\.episodes\.groupVideos\(videos\)/, "specials and extras remain visible in separate groups");
  assert.match(html, /AstraPlayback\.episodes\.resumeTarget\(m,id=>videoProgress\(m,id\)\)/, "continue uses the resume target");
  assert.match(html, /PB\.episodes\.isEpisodic\(player\.meta\)/, "episode controls are gated on real series");
  assert.match(html, /const PB=AstraPlayback;/, "PB is the in-app alias for the module namespace");
});

test("the end of an episode offers the next one and never starts it", () => {
  assert.match(html, /function offerNextEpisode\(next\)/);
  assert.match(html, /data-countdown="cancel"/);
  assert.match(html, /data-countdown="now"/);
  // The offer opens the next episode's own source list on a tap.
  assert.match(html, /const next=player\.nextEpisode;cancelCountdown\(\);if\(x\.dataset\.countdown!=='cancel'&&next\)goToEpisode\(next\)/);
  assert.equal(/createCountdown/.test(html), false, "no timer starts anything by itself");
  assert.match(html, /function cancelCountdown\(\)\{\s*player\.nextEpisode=null;/);
});

test("a terminal failure releases the attempt before the error card renders", () => {
  // Otherwise the detached media element and library instance stay referenced
  // behind the error UI until the viewer happens to retry, switch or close.
  assert.match(
    html,
    /if\(snap\.state==='failed'\|\|snap\.state==='exhausted'\)\{teardownAttempt\(\);renderPlayerError\(snap\)/,
    "teardownAttempt must run when the session goes terminal"
  );
});

test("a stream response is scoped to the lookup that asked for it", () => {
  const load = html.match(/async function loadStreams\(videoId\)\{[\s\S]*?\n {4}\}/);
  assert.ok(load, "loadStreams exists");

  // The search counter alone does not change when the viewer closes one detail
  // modal and opens another, so the lookup carries its own identity.
  assert.match(load[0], /const lookup=\{mediaKey:mediaKey\(m\),videoId:String\(videoId\),token:\+\+state\.searchToken\}/);
  assert.match(load[0], /player\.lookup=lookup/);
  assert.match(load[0], /const stale=\(\)=>player\.lookup!==lookup/);
  assert.match(load[0], /mediaKey\(state\.currentMeta\)!==lookup\.mediaKey/, "the current media is re-checked");
  assert.match(load[0], /String\(state\.currentVideo\?\.id\)!==lookup\.videoId/, "so is the current video");
  assert.match(load[0], /!root\.isConnected\|\|!root\.children\.length/, "and the independent drawer root must still exist");

  // Every continuation is guarded, including the delayed autoplay.
  assert.match(load[0], /if\(stale\(\)\)return\[\];/, "the response is dropped when stale");
  assert.match(load[0], /\.then\(refined=>\{if\(stale\(\)\)return;player\.sources=refined;renderStreams\(\)\}\)/,
    "so is the decoding-info re-render, which keeps the refreshed entries");
  assert.equal(/autoPlayTimer|openPlayer\(/.test(load[0]), false, "a lookup only lists sources; it never starts one");
  assert.equal(load[0].includes("if(token!==state.searchToken)return[]"), false, "the counter-only guard is gone");
});

test("switching or dismissing a title cancels the in-flight lookup", () => {
  assert.match(html, /function cancelStreamLookup\(\)\{\s*player\.lookup=null;player\.metaRequest=null;/);
  assert.match(html, /async function openMedia\(key\)\{\s*\n\s*cancelStreamLookup\(\);/, "opening another title invalidates it");
  assert.match(html, /data-dismiss\]',root\)\.forEach\(x=>x\.onclick=e=>\{if\(e\.target===x\)closeModal\(\)\}\)/, "so does dismissing the modal");
});

test("the subtitle menu selects one specific track, not a language", () => {
  assert.match(html, /player\.subtitleAttached=attached/);
  assert.match(html, /player\.subtitleTracks\.map\(t=>\(\{id:t\.id,label:t\.label,active:player\.activeSubtitle===t\.id\}\)\)/,
    "options are keyed by the track id");
  assert.match(html, /PB\.subtitles\.selectAttachedTrack\(el,player\.subtitleAttached,chosen\?chosen\.id:null\)/);
  assert.equal(html.includes("selectSubtitle(lang)"), false, "the language-keyed handler is gone");
  // The persisted preference is still a language, since ids are per-session.
  assert.match(html, /state\.settings\.subtitleLanguage=chosen\.lang/);
});

test("the audio menu offers what it can, and says plainly when it cannot", () => {
  // Chromium implements no audioTracks API, so a direct file exposes nothing
  // to switch. Rather than an empty menu, the menu lists the other sources for
  // this same episode that advertise a language the current one does not.
  assert.match(html, /function audioAlternateSources\(\)/);
  assert.match(html, /const alternates=tracks\.length\?\[\]:audioAlternateSources\(\)/);
  assert.match(html, /data-switch-source="\$\{esc\(candidateKey\(entry\)\)\}"/);
  assert.match(html, /data-switch-source\]',root\)\.forEach\(x=>x\.onclick=\(\)=>\{const entry=entryById\(x\.dataset\.switchSource\);closeTrackMenu\(\);if\(entry\)openPlayer\(entry\)\}\)/);
  assert.match(html, /only adaptive HLS and DASH streams expose them/, "the limitation is stated, not hidden");

  // Only languages an add-on actually advertised are listed; nothing guesses
  // at what is inside a file.
  const alternates = html.match(/function audioAlternateSources\(\)\{[\s\S]*?\n {4}\}/);
  assert.ok(alternates, "audioAlternateSources exists");
  assert.match(alternates[0], /entry\.stream\.facts\.audioLanguages/);
  assert.match(alternates[0], /!entry\.evaluation\.playable/, "an unplayable alternative is not offered");
});

test("adaptive audio tracks stay selectable and remember a language preference", () => {
  assert.match(html, /onAudioTracksChanged:tracks=>\{if\(live\(\)&&!scope\.disposed\)refreshAudioTracks\(tracks\)\}/);
  assert.match(html, /data-audio-track/);
  assert.match(html, /state\.settings\.audioLanguage=chosen\.lang\|\|'original'/);
  assert.match(html, /state\.settings\.audioLanguage=\$\('#audioLanguage'\)\?\.value\|\|'original'/);
  assert.match(html, /if\(value&&!choices\.some\(\(\[id\]\)=>id===value\)\)choices\.push\(\[value,value\.toUpperCase\(\)\]\)/, "a learned arbitrary language remains saveable");
  assert.match(html, /Direct files depend on Android Chrome/, "the unsupported native-file limitation is honest");
});

test("stream rows keep the full release and exact series file details inspectable", () => {
  assert.match(html, /<details class="stream-details">/);
  assert.match(html, /Full source details/);
  assert.match(html, /\['Release',s\.title\]/);
  assert.match(html, /File index/);
  assert.match(html, /Pack status/);
  assert.match(html, /f\.audioLanguages/);
  assert.match(html, /\['Cached',f\.cached\?'Yes':''\]/);
  assert.match(html, /Does not match selected episode/);
});

test("the decoding probe refreshes verdicts without reordering the list", () => {
  assert.match(
    html,
    /\.then\(refined=>\{if\(stale\(\)\)return;player\.sources=refined;renderStreams\(\)\}\)/
  );
  assert.equal(html.includes(".then(()=>{if(!stale())renderStreams()})"), false, "the discarding callback is gone");
});

test("a deferred metadata response cannot replace another title", () => {
  const openMedia = html.match(/async function openMedia\(key\)\{[\s\S]*?\n {4}\}/);
  assert.ok(openMedia, "openMedia exists");
  assert.match(openMedia[0], /const request=\{key\};player\.metaRequest=request;/, "the request is stamped");
  assert.match(openMedia[0], /const full=await fullMeta\(item\);\s*\n\s*if\(player\.metaRequest!==request\)return;/,
    "both post-await mutations are guarded");
  assert.equal(
    openMedia[0].includes("item=await fullMeta(item);state.currentMeta=item;showDetail(item,false)"),
    false,
    "the unguarded assignment is gone"
  );
  assert.match(html, /function cancelStreamLookup\(\)\{\s*\n?\s*player\.lookup=null;player\.metaRequest=null;/,
    "dismissing or switching invalidates a pending metadata request");
});

test("the failover notice stays on screen long enough to read", () => {
  // The engine clears lastFailure the moment something plays, which is exactly
  // when the viewer needs to see what just happened, so the view layer holds
  // its own copy for a readable minimum.
  assert.match(html, /const NOTICE_DWELL_MS=\d{4}/);
  assert.match(html, /player\.notice=\{failed:[^;]*until:Date\.now\(\)\+NOTICE_DWELL_MS\}/);
  assert.match(html, /if\(snap\.state==='playing'\)\{showSettledNotice\(status\)/, "playing does not wipe it immediately");

  const settled = html.match(/function showSettledNotice\(status\)\{[\s\S]*?\n {4}\}/);
  assert.ok(settled, "showSettledNotice exists");
  assert.match(settled[0], /const remaining=notice\.until-Date\.now\(\)/, "the remaining dwell is honoured");
  assert.match(settled[0], /player\.noticeTimer=setTimeout/, "and it clears itself afterwards");

  // The dwell timer must not outlive the player or leak into the error card.
  const close = html.match(/function closePlayer\(silent\)\{[\s\S]*?\n {4}\}/);
  assert.match(close[0], /clearTimeout\(player\.noticeTimer\)/);
  const error = html.match(/function renderPlayerError\(snap\)\{[\s\S]*?\n {4}\}/);
  assert.match(error[0], /clearTimeout\(player\.noticeTimer\)/);
});

test("every modal dismissal invalidates pending work", () => {
  // A deferred metadata response must not reopen a detail the viewer closed,
  // so every path that clears the modal goes through one cancelling helper.
  assert.match(html, /function closeModal\(\)\{cancelStreamLookup\(\);\$\('#modalRoot'\)\.innerHTML=''\}/);

  // The X button and the Escape key are the paths that previously slipped past.
  assert.match(html, /data-close\]',root\)\.forEach\(x=>x\.onclick=\(\)=>closeModal\(\)\)/, "the close button cancels");
  assert.match(html, /if\(\$\('#mediaEl'\)\|\|\$\('#playerStage iframe'\)\)closePlayer\(\);else closeModal\(\)/, "Escape cancels");

  // Counting one literal selector is not enough: `root` and other aliases point
  // at the same container. Check every blanking assignment in the file and
  // allow only targets that are demonstrably not the modal.
  const NON_MODAL_TARGETS = new Set([
    "sections", // the home page rail container
    "status", // the player status area
    "el", // the status element inside the notice timer
    "home", // #homeRoot, dropped when the add-on set changes under it
    "$('#audioRoot')" // the audio surface, a sibling of the modal and never it
  ]);
  const blanking = [...html.matchAll(/([\w$.'#()]+)\.innerHTML=''/g)].map((m) => m[1]);
  const modalClears = blanking.filter((target) => !NON_MODAL_TARGETS.has(target.replace(/^if\(\w+\)/, "")));
  assert.deepEqual(modalClears, ["$('#modalRoot')"], `an alias clears the modal: ${modalClears.join(", ")}`);
});

test("an async modal action cannot erase a modal it no longer owns", () => {
  // `root` in installModal aliases #modalRoot, so a held manifest response
  // could blank whatever modal the viewer opened while it was pending.
  assert.match(html, /function currentModal\(\)\{return \$\('#modalRoot'\)\?\.firstElementChild\|\|null\}/);

  const install = html.match(/\$\('#installForm'\)\.onsubmit=async e=>\{.*?\};/);
  assert.ok(install, "the install handler exists");
  assert.match(install[0], /owned=currentModal\(\)/, "ownership is captured before the await");
  assert.match(install[0], /await installAddon\(input\.value\);if\(currentModal\(\)!==owned\)return;closeModal\(\)/,
    "success only closes the modal it still owns");
  assert.match(install[0], /catch\(err\)\{if\(currentModal\(\)!==owned\)return;/,
    "and the failure path is guarded too, so a stale toast cannot re-enable a gone form");
  assert.equal(install[0].includes("root.innerHTML=''"), false, "the aliased clear is gone");

  // importData reads a file across an await and had the same shape.
  const importer = html.match(/async function importData\(file\)\{.*?\n/);
  assert.match(importer[0], /const owned=currentModal\(\)/);
  assert.match(importer[0], /if\(currentModal\(\)===owned\)closeModal\(\)/);
});

