import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { loadPlayback, createClock } from "./helpers/playback.mjs";

const source = await readFile(new URL("../assets/js/app.js", import.meta.url), "utf8");
const PB = await loadPlayback();

// Execute the shipped UI functions with the real engine. Only the DOM and
// browser side effects are doubles, so an unbound button or a missing terminal
// candidate fails these tests even if its markup still looks correct.
function appFunction(name, required = true) {
  const start = source.search(new RegExp(`^    (?:async )?function ${name}\\(`, "m"));
  if (start < 0) {
    if (required) throw new Error(`Missing application function: ${name}`);
    return "";
  }
  const lines = source.slice(start).split("\n");
  if (lines[0].trimEnd().endsWith("}")) return lines[0];
  const end = lines.findIndex((line, index) => index > 0 && /^    }\s*$/.test(line));
  assert.ok(end > 0, `Find the end of ${name}`);
  return lines.slice(0, end + 1).join("\n");
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle(name, force) {
      const enabled = force ?? !values.has(name);
      if (enabled) values.add(name); else values.delete(name);
      return enabled;
    }
  };
}

function node() {
  let markup = "";
  return {
    children: [], dataset: {}, style: {}, classList: classList(),
    setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {},
    set innerHTML(value) {
      markup = String(value);
      this.children = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => {
        const attrs = new Map([...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((attr) => [attr[1], attr[2] ?? ""]));
        const button = node();
        button.attrs = attrs;
        button.textContent = match[2].replace(/<[^>]*>/g, "").trim();
        for (const [name, value] of attrs) {
          if (name.startsWith("data-")) button.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        }
        button.click = () => {
          assert.equal(typeof button.onclick, "function", `${button.textContent} has a working click handler`);
          return button.onclick({ target: button });
        };
        return button;
      });
    },
    get innerHTML() { return markup; }
  };
}

function fixture({ failure = "network", youtube = false, compatibility = false } = {}) {
  const clock = createClock();
  const stage = node(), shell = node(), status = node(), streamRoot = node();
  const nodes = new Map([["#playerStage", stage], ["#playerShell", shell], ["#playerStatus", status], ["#streamRoot", streamRoot]]);
  const calls = { attempts: [], opened: [], external: [], menus: [], closed: 0, sources: 0, tornDown: 0 };
  const entry = {
    stream: { kind: "direct", url: "https://media.example.test/chosen.mkv", urlSafe: true,
      title: "Chosen release", addonName: "Provider", facts: { audioOnly: false, container: "mkv", audioCodec: "AC3" } },
    evaluation: { playable: true }
  };
  const player = { youtube, compatibility, triedModes: compatibility ? ["native", "compatibility"] : ["native"],
    audioMode: false, subtitleTracks: [], video: {}, meta: {}, sources: [entry] };
  const state = { currentMeta: { id: "movie", type: "movie", name: "A movie" } };
  const document = { body: { classList: classList() }, fullscreenEnabled: false };
  const queryAll = (selector, root = document) => {
    const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (!match) return [];
    const children = root === document ? [...nodes.values()].flatMap((item) => item.children) : root.children || [];
    return children.filter((child) => child.attrs?.has(match[1]) && (match[2] === undefined || child.attrs.get(match[1]) === match[2]));
  };
  const queued = [];
  const context = vm.createContext({
    player, state, PB, AstraPlayback: PB, document, URL, AbortController, DOMException,
    navigator: { userAgent: "Chrome test" }, location: {},
    window: { MediaSource: function MediaSource() {}, open: (...args) => calls.external.push(args) },
    $: (selector, root) => nodes.get(selector) || (root ? queryAll(selector, root)[0] : null),
    $$: queryAll,
    esc: (value) => String(value ?? ""), icon: () => "",
    hydrateIcons() {}, bindMotionSurface() {}, Motion: { refresh() {} },
    clearTimeout: clock.clearTimeout, setTimeout: clock.setTimeout,
    queueMicrotask: (callback) => queued.push(callback),
    closeTrackMenu() {}, miniPlayer() {}, renderTools() {}, youtubeMaybeRefresh: () => false,
    openTrackMenu: kind => calls.menus.push(kind), loadCompatibility: async () => {},
    teardownAttempt: () => { calls.tornDown += 1; },
    closePlayer: () => { calls.closed += 1; },
    renderStreams: () => { calls.sources += 1; },
    motionOk: () => false, toast() {}, NOTICE_DWELL_MS: 4000,
    openPlayer: (chosen, options) => calls.opened.push({ entry: chosen, options }),
    capsNow: () => ({ mse: true }),
    playbackRate: 1
  });
  for (const name of ["activePlayerCandidate", "canRepairPlayback", "cancelPlaybackRepair", "repairPlayback", "recoveryMode"]) {
    vm.runInContext(appFunction(name, false), context);
  }
  for (const name of ["bindDynamic", "setAudioDocked", "renderPlayerError", "playerAction", "renderPlayerState"]) {
    vm.runInContext(appFunction(name), context);
  }
  player.session = PB.engine.createSession({
    candidates: [{ id: "chosen", ...entry, entry }], autoFailover: false,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    onAttempt: (attempt) => calls.attempts.push(attempt)
  });
  player.session.start();
  player.session.report(player.session.snapshot().attemptId, "error", { type: failure });
  const snapshot = player.session.snapshot();
  assert.equal(snapshot.candidate, null, "a terminal engine snapshot has no current candidate");
  return {
    context, stage, shell, player, snapshot, calls, entry, nodes, clock,
    render: () => context.renderPlayerError(snapshot),
    button: (action) => stage.children.find((button) => button.dataset.playerAction === action),
    flush: () => { while (queued.length) queued.shift()(); }
  };
}

test("the rendered failure card retries the same source after the engine has settled", () => {
  const f = fixture();
  f.render();
  const retry = f.button("retry");
  assert.ok(retry, "retry is available after failure");
  retry.click();
  const restarted = f.calls.attempts.slice(1).map((attempt) => attempt.candidate.entry.entry)
    .concat(f.calls.opened.map((opened) => opened.entry));
  assert.deepEqual(restarted, [f.entry], "one click restarts exactly the release that failed");
});

test('a timed-out seek offers restarting from zero without repeating the stuck position',()=>{
  const f=fixture({failure:'timeout'});f.snapshot.resumeTime=487.2;
  f.render();f.button('restart').click();
  assert.equal(f.calls.opened.length,1);assert.equal(f.calls.opened[0].entry,f.entry);
  assert.equal(f.calls.opened[0].options.resumeAt,0);
});

test('expired stream recovery can request a fresh source list for the same episode',()=>{
  const f=fixture();f.player.video={id:'episode-7'};const fetched=[];
  f.context.showDetail=()=>{};f.context.loadStreams=id=>fetched.push(id);
  f.render();f.button('refresh').click();
  assert.deepEqual(fetched,['episode-7']);assert.equal(f.calls.closed,1);
});

test('stream lookups revalidate HTTP cache while catalogs keep normal caching',async()=>{
  const calls=[];
  const context=vm.createContext({AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push(options);return {ok:true,json:async()=>({streams:[]})}},recordAddonHealth(){}});
  vm.runInContext(appFunction('fetchJSON')+'\n'+appFunction('fetchAddonJSON'),context);
  await context.fetchAddonJSON({},'stream','https://media.example.test/streams.json');
  await context.fetchAddonJSON({},'catalog','https://media.example.test/catalog.json');
  assert.equal(calls[0].cache,'no-cache');assert.equal(calls[1].cache,undefined);
});

test("the rendered failure card can return to the source picker", () => {
  const f = fixture();
  f.render();
  const choose = f.button("choose");
  assert.ok(choose, "a different source can be chosen after failure");
  choose.click();
  assert.equal(f.calls.closed, 1, "the failed player closes");
  assert.equal(f.calls.sources, 1, "the existing sources reopen");
  assert.equal(f.player.sources[0], f.entry, "the source list is preserved");
});

test("the rendered failure card's close button is bound after replacing the media element", () => {
  const f = fixture();
  f.render();
  const close = f.stage.children.find((button) => button.attrs.has("data-close-player"));
  assert.ok(close, "the recovery card provides an exit");
  close.click();
  assert.equal(f.calls.closed, 1);
});

test("external playback can read the failed source when the current attempt is gone", () => {
  const f = fixture();
  f.render();
  const external = f.button("external-player");
  assert.ok(external, "the direct source offers an external player");
  external.click();
  assert.equal(f.calls.external.length, 1, "the external action actually opens the failed source");
  assert.equal(f.calls.external[0][0], f.entry.stream.url);
});

test("a native decode failure repairs the same release automatically", () => {
  const f = fixture({ failure: "decode" });
  f.context.renderPlayerState(f.snapshot);
  f.flush();
  assert.equal(f.calls.opened.length, 1, "the native failure starts one compatibility attempt");
  assert.equal(f.calls.opened[0].entry, f.entry, "recovery retains the viewer's chosen release");
  assert.equal(f.calls.opened[0].options.compatibility, true);
});

test("a failed compatibility attempt does not repeatedly reopen itself", () => {
  const f = fixture({ failure: "decode", compatibility: true });
  f.context.renderPlayerState(f.snapshot);
  f.flush();
  assert.equal(f.calls.opened.length, 0, "compatibility recovery is bounded");
  assert.ok(f.button("retry"), "a failed repair leaves an actionable recovery card");
});

function repairFixture(prepare) {
  const f=fixture();
  const media=Object.assign(new EventTarget(),{currentTime:490.4,paused:false});
  f.nodes.set('#mediaEl',media);
  f.player.diagnostics=PB.diagnostics.create();
  f.player.diagnostics.select(f.entry.stream);
  f.context.AstraCompatibility={prepareRepair:prepare};
  return {...f,media};
}

test('failed audio preparation leaves the original video, playhead, and play state intact',async()=>{
  const f=repairFixture(async()=>{throw Object.assign(new TypeError('Failed to fetch'),{playbackType:'network'})});
  await f.context.playerAction('compatibility');
  assert.equal(f.nodes.get('#mediaEl'),f.media);
  assert.equal(f.media.currentTime,490.4);assert.equal(f.media.paused,false);
  assert.equal(f.calls.opened.length,0);assert.equal(f.calls.tornDown,0);
  assert.equal(f.player.repairPending,null);
  assert.deepEqual(f.calls.menus,['repair','repair']);
  const report=JSON.parse(f.player.diagnostics.report({media:f.media}));
  assert.equal(report.events.at(-1).event,'repair-unavailable');
  assert.equal(report.events.at(-1).failure,'NETWORK_OR_BROWSER_ACCESS');
  assert.equal(report.playback.position,490.4);
});

test('successful audio preparation transfers its input once at the current playhead',async()=>{
  let finish,calls=0,disposals=0;
  const prepared={dispose:()=>disposals++};
  const f=repairFixture(()=>{calls++;return new Promise(resolve=>finish=resolve)});
  const first=f.context.playerAction('compatibility');
  await Promise.resolve();await Promise.resolve();
  await f.context.playerAction('compatibility');
  assert.equal(calls,1);assert.equal(f.calls.opened.length,0);
  f.media.currentTime=494;f.media.paused=true;
  finish(prepared);await first;
  assert.equal(f.calls.opened.length,1);
  const opened=f.calls.opened[0];
  assert.equal(opened.entry,f.entry);assert.equal(opened.options.prepared,prepared);
  assert.equal(opened.options.resumeAt,494);assert.equal(opened.options.paused,true);
  assert.equal(disposals,0,'the new adapter owns the prepared input');
});

test('seeking cancels pending audio repair and prevents an obsolete switch',async()=>{
  let signal,started;
  const ready=new Promise(resolve=>started=resolve);
  const f=repairFixture(config=>{signal=config.signal;started();return new Promise(()=>{})});
  const attempt=f.context.playerAction('compatibility');
  await ready;
  f.media.currentTime=900;f.media.dispatchEvent(new Event('seeking'));
  await attempt;
  assert.equal(signal.aborted,true);assert.equal(f.calls.opened.length,0);
  assert.equal(f.media.currentTime,900);assert.equal(f.player.repairPending,null);
});

test('audio preparation times out without interrupting native playback or trapping the controls',async()=>{
  const f=repairFixture(()=>new Promise(()=>{}));
  const attempt=f.context.playerAction('compatibility');
  f.clock.advance(15000);await attempt;
  assert.equal(f.player.repairFailure.type,'timeout');
  assert.equal(f.player.repairPending,null);assert.equal(f.calls.opened.length,0);
  assert.equal(f.media.paused,false);assert.equal(f.media.currentTime,490.4);
});

test('a manual repair that fails after switching restores the same native source once',()=>{
  const f=fixture({failure:'network',compatibility:true});
  f.player.repairFallback={paused:true};
  f.context.renderPlayerState(f.snapshot);f.flush();
  assert.equal(f.calls.opened.length,1);
  assert.equal(f.calls.opened[0].entry,f.entry);
  assert.equal(f.calls.opened[0].options.compatibility,false);
  assert.equal(f.calls.opened[0].options.paused,true);
  assert.equal(f.calls.opened[0].options.repairFailure,f.snapshot.lastFailure);
  assert.equal(f.calls.opened[0].options.repairFallback,undefined,'restoration cannot loop');
});

test('readiness without playback does not discard manual repair restoration',()=>{
  const f=fixture({compatibility:true});
  const fallback={paused:true};f.player.repairFallback=fallback;
  f.context.showSettledNotice=()=>{};
  f.context.renderPlayerState({...f.snapshot,state:'playing'});
  assert.equal(f.player.repairFallback,fallback);
});

test('explicit repair restoration preserves positions near the end while saved history can restart',()=>{
  const context=vm.createContext({});vm.runInContext(appFunction('restorePlaybackPosition'),context);
  const media={duration:1000,currentTime:0};
  context.restorePlaybackPosition(media,990,true);assert.equal(media.currentTime,990);
  media.currentTime=0;context.restorePlaybackPosition(media,990,false);assert.equal(media.currentTime,0);
  context.restorePlaybackPosition(media,1000,true);assert.ok(media.currentTime>999&&media.currentTime<1000);
});

test("closing before a queued repair prevents the old source from reopening", () => {
  const f = fixture({ failure: "decode" });
  f.context.renderPlayerState(f.snapshot);
  f.player.session = null;
  f.flush();
  assert.equal(f.calls.opened.length, 0, "an abandoned player cannot resurrect itself");
});

test("failure unlocks controls and exposes its recovery state", () => {
  const f = fixture();
  f.player.locked = true;
  f.shell.classList.add("idle", "locked");
  f.render();
  assert.equal(f.player.locked, false);
  assert.equal(f.shell.classList.contains("locked"), false);
  assert.equal(f.shell.classList.contains("idle"), false);
  assert.equal(f.shell.dataset.playbackState, f.snapshot.state);
});

test("a source connection failure does not start unnecessary format conversion", () => {
  const f = fixture({ failure: "network" });
  f.context.renderPlayerState(f.snapshot);
  f.flush();
  assert.equal(f.calls.opened.length, 0);
  assert.ok(f.button("retry"), "the viewer can retry the connection directly");
});

test("YouTube keeps its own playback recovery instead of the file converter", () => {
  const f = fixture({ failure: "decode", youtube: { videoId: "test-video" } });
  f.context.renderPlayerState(f.snapshot);
  f.flush();
  assert.equal(f.calls.opened.length, 0);
});

test("a docked audio failure expands to an accessible recovery screen", () => {
  const f = fixture();
  f.player.audioMode = true;
  f.context.setAudioDocked(true);
  assert.equal(f.shell.classList.contains("docked"), true);
  f.render();
  assert.equal(f.player.audioDocked, false, "the failed audio player leaves dock mode");
  assert.equal(f.shell.classList.contains("docked"), false, "the recovery card gets the full player surface");
  assert.equal(f.context.document.body.classList.contains("audio-docked"), false);
  f.button("retry").click();
  assert.equal(f.calls.attempts.length, 2, "retry remains functional after expanding the failed dock");
});
