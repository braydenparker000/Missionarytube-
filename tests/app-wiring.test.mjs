import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html", "utf8");

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
  for (const required of ["player.countdown.cancel()", "player.session.cancel()", "teardownAttempt()", "progress.flush()", "$('#countdownCard')"]) {
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
  assert.ok(goTo[0].includes("state.currentStreams=[];player.ranked=[]"), "previous streams are discarded");
  assert.ok(goTo[0].includes("closePlayer(true)"), "the previous player is torn down first");
  assert.ok(goTo[0].includes("loadStreams(video.id,true)"), "streams are re-fetched for the new episode");
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
  assert.match(html, /class="stream-row \$\{isBest\?'recommended':''\} \$\{ev\.playable\?'':'blocked'\}/);
  assert.match(html, /class="stream-why">\$\{esc\(entry\.why\)\}/, "each row explains itself");
  assert.match(html, /chip-sm state-\$\{ev\.state\}/, "the compatibility state is labelled");
  // Filters must never remove a source permanently; "All" is always offered.
  assert.match(html, /STREAM_FILTERS=\[\['all','All'\]/);
});

test("the close control can never be faded out or made unclickable", () => {
  // A YouTube iframe swallows pointer events, so if the whole top bar faded the
  // viewer would have no way to bring it back: they would be trapped.
  assert.match(html, /\.player-shell\.idle \.player-title,\.player-shell\.idle \.player-tools\{opacity:0;pointer-events:none\}/);
  assert.equal(html.includes(".player-shell.idle .player-top{"), false, "the top bar itself must not fade");
  assert.match(html, /\.player-top \[data-close-player\]\{opacity:1;pointer-events:auto\}/);
});

test("the mobile overlay respects safe areas and reduced motion", () => {
  assert.match(html, /\.player-top\{padding:max\(14px,env\(safe-area-inset-top\)\)/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\s*\.stream-row/);
  assert.match(html, /function motionOk\(\)\{return !window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches\}/);
  // Native controls must stay reachable: the tool rail sits above them.
  assert.match(html, /\.player-tools\{position:absolute;z-index:4/);
  // The stage must sit below the chrome or it swallows every control tap.
  assert.match(html, /\.player-stage\{position:absolute;z-index:1/);
  assert.match(html, /controls autoplay playsinline/, "native controls are kept");
});

test("episode ordering is used everywhere videos are listed", () => {
  assert.match(html, /AstraPlayback\.episodes\.orderVideos\(videos\)/, "the episode list is ordered");
  assert.match(html, /AstraPlayback\.episodes\.resumeTarget\(m,id=>videoProgress\(m,id\)\)/, "continue uses the resume target");
  assert.match(html, /PB\.episodes\.isEpisodic\(player\.meta\)/, "episode controls are gated on real series");
  assert.match(html, /const PB=AstraPlayback;/, "PB is the in-app alias for the module namespace");
});

test("the autoplay countdown is cancellable and tied to the player", () => {
  assert.match(html, /data-countdown="cancel"/);
  assert.match(html, /data-countdown="now"/);
  assert.match(html, /if\(player\.countdown\)\{player\.countdown\.cancel\(\);player\.countdown=null\}/);
  assert.match(html, /if\(!state\.settings\.autoplayNext\)return/, "autoplay honours the setting");
});
