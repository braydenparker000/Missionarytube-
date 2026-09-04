# Handoff: make YouTube playback reliable

**Status: works sometimes. Not trusted. Root causes identified but not fixed.**

Written 2026-09-04 against `49089da` (main). Everything below was verified in this
repo unless it says otherwise. Where something is a hypothesis, it says so.

---

## The one-paragraph version

YouTube playback is built and shipped. The unit tests pass (386) and the app
genuinely does play video — verified by driving the real UI in a real browser
today. It is flaky in the field for two reasons: **(1) video resolution is pinned
to a single backend with no fallback and a cooldown that disables playback for
2–8 minutes after one transient failure**, and **(2) that backend is a relay whose
source is not in this repository, sitting behind YouTube's datacenter-IP bot
check**. The second is the hard problem and will need research. The first is a
confirmed bug with a reproduction below and is probably an hour of work.

---

## Current architecture

Static site on Azure Storage. No server of our own. The browser asks a backend
to turn a YouTube video id into a playable media URL, then plays that URL in
Player V3.

```
Astra (Azure static)  ──JSON──▶  backend pool  ──▶  YouTube
        │                         (relay, Piped, Invidious)
        └──────media bytes────────────────────────────▶ (direct or via backend)
```

Two backend protocols, normalized to one internal record so nothing downstream
knows which answered:

- **Piped** — CORS-enabled by design (its own frontend is a separate-origin
  static app) and it proxies its own stream URLs, so they carry CORS and are not
  bound to the IP that resolved them. This is why Piped works for us and raw
  Google URLs do not.
- **Invidious** — kept as a last resort.

**There is no YouTube iframe or embed anywhere, by explicit product decision.**
A test fails the build if one reappears. Do not reintroduce one.

### Files

| Path | What it does |
| --- | --- |
| `assets/js/youtube/config.js` | The **only** place backends are listed. Pool, timeouts, cooldown. |
| `assets/js/youtube/instances.js` | Instance selection: health, latency, cooldown, bounded failover. |
| `assets/js/youtube/api.js` | Both protocols' endpoints + normalizers. Treats all responses as untrusted. |
| `assets/js/youtube/playback.js` | Turns a video record into a playback plan + quality ladder. |
| `assets/js/app.js` | The app. YouTube wiring lives around lines 1020–1250 and 1350–1520. |
| `tools/instance-probe.html` | Standalone pool tester. See *How to test*. |
| `tests/browser/youtube-flow.mjs` | Real-browser end-to-end check. **Currently failing — see below.** |

Note: the app moved out of `index.html` into `assets/js/app.js` in commit
`16bf4b3`. Older notes referring to an inline script in `index.html` are stale.

---

## Confirmed problems

### 1. One failure disables playback for 2–8 minutes — with zero retries

**This is the most likely cause of the flakiness you are seeing.** High
confidence. Reproduced.

`assets/js/app.js` builds a second, separate manager for video resolution:

```js
const playbackConfig={...config,requestTimeout:25000,maxAttempts:1};
const playbackManager=YT.instances.createManager({
  config:playbackConfig,
  instances:config.publicFallbackInstances.slice(0,1).map(entry=>({...entry,kind:'private'})),
  ...
});
```

So video resolution uses **one** instance (the relay) with **`maxAttempts: 1`**.
Search still uses the full 13-instance pool.

The instance manager excludes any instance that is in cooldown. With a pool of
one, a single failure leaves **zero** candidates, and the request fails
immediately as `no-instance` — no network call is even attempted.

Reproduction (run from the repo root):

```js
// tests/helpers/youtube.mjs gives you the doubles; full script in the commit
// that added this file. Result observed today:
attempt 1 (relay cold):            server
attempt 2 (relay HEALTHY again):   no-instance   ← 0 network calls made
attempt 3 (+60s, relay healthy):   no-instance
attempt 4 (+121s):                 PLAYS
```

`instanceCooldown` is 120s. A `403` doubles it (240s). A `429` quadruples it
(480s). During that window **search works and playback is dead**, which is
exactly the "flaky" symptom.

Directions, roughly in order of preference:

- Let playback fall back through the pool like search does, instead of pinning
  to one instance. The pin exists because public instances were returning
  metadata but unplayable streams — so keep the relay *first*, don't make it
  *only*.
- If the pin must stay, give the playback manager `maxAttempts >= 2` and a much
  shorter cooldown (say 10–15s), or exempt a single-instance manager from
  cooldown entirely — resting the only server you have is never useful.
- Surface the real reason in the UI. "Temporarily unavailable" for 8 minutes
  with no explanation reads as broken.

### 2. "Test servers" cannot clear a poisoned playback cooldown

`testYouTubeInstances()` in `app.js` calls `youtubeProvider().manager.reset()`
and never touches `playbackManager`. So the one recovery affordance in the UI
does not fix the thing most likely to be broken. The only current workarounds
are toggling any YouTube setting (which nulls both managers) or waiting.

One-line fix; do it alongside #1.

### 3. The end-to-end browser check is failing, so nothing guards regressions

`npm run test:browser` currently gets **4/6** before aborting:

```
ok    3. search returns results
FAIL  5. selecting a result loads metadata — 0 record cells
FAIL  unexpected failure during: sources — waitForSelector timeout
```

**The app is fine.** I drove the same flow manually in the same browser today
and got a fully rendered detail sheet (6 record cells), a working "Play this
video" CTA, an open source drawer and 4 playable sources, with no page errors.

The harness is racing the detail sheet's two-phase paint: `showDetail(item, true)`
renders a loading state first, then the full record lands. The redesign changed
that timing and the harness was never updated. Fix the harness (wait for the
record to populate rather than for `.cinema-detail` to exist).

This matters more than it looks: **386 green unit tests are all mocks.** They do
not touch the DOM, the media element, or a real network. The browser check is
the only thing that would have caught a broken play path, and it has been
red — so real breakage has been able to hide.

---

## The hard problem

YouTube blocks datacenter IP ranges for the requests that resolve a video to a
stream URL. AWS, GCP, Azure, Hetzner, DigitalOcean, Vultr and Oracle are all
routinely blocked. A blocked backend returns *"Sign in to confirm you're not a
bot."* This is why public instances mostly do not work and why self-hosting on a
cheap VPS does not fix it.

Measured, not assumed: a probe of **11 public instances**, run from the actual
phone against the actual Azure origin on 2026-09-02, found **exactly one** that
could play a video (`api.piped.private.coffee`, a Piped instance).

The current relay at
`https://astra-youtube-relay.braydenparker999.chatgpt.site/api/youtube`
was added afterwards to get off that single point of failure. It speaks the
Piped protocol.

**Its source is not in this repository.** Nothing here can version, test, debug
or redeploy it. That is a real fragility and the next session should establish,
early, where it lives and whether it can be maintained.

---

## Ruled out — please do not spend time redoing these

Each was tested or researched to a conclusion.

| Idea | Verdict | Why |
| --- | --- | --- |
| YouTube iframe / IFrame API | **Forbidden** | Product decision by the owner, reaffirmed explicitly. A test enforces it. |
| Browser resolves video itself via InnerTube | **Impossible** | `youtubei.googleapis.com` sends no permissive CORS header. No browser-side workaround exists. |
| Free serverless hosting for a resolver | **Dead** | Cloudflare Workers / Deno Deploy cannot run subprocesses; Vercel/Netlify time out. |
| VPS + Invidious | **Dead as configured** | Playback now needs the `invidious-companion` sidecar (absent from `deploy/invidious/`), *and* the datacenter IP is blocked anyway. |
| yt-dlp + cookies on a cheap VPS | **Poor** | Cookies are invalidated faster from datacenter IPs; risks a Google account ban; needs a burner account and constant re-export. |
| ffmpeg muxing in the media path | **Rejected** | Costs full video bandwidth, breaks byte-range seeking, breaks quality switching. If proxying is ever needed, proxy DASH segments — that path already exists. |
| Owner self-hosting at home | **Not available** | No hardware. Phone only. |

The genuinely promising unexplored direction is **a residential-IP egress** for
whatever resolves the video — that is the single variable that separates working
from not working. Everything else is downstream of it.

---

## What I don't know

- **What the relay actually is.** Not in this repo. Unknown implementation,
  unknown host, unknown IP reputation, unknown cold-start behaviour. The 25s
  timeout and `maxAttempts: 1` suggest whoever added it was working around
  slow cold starts.
- **Whether the pool is still alive.** Last measured 2026-09-02. Instances come
  and go weekly. Re-run the probe before drawing any conclusion.
- **Real-device behaviour.** Nothing here has been verified on a physical
  Android phone by an automated check. The browser harness runs headless
  Chromium at a phone viewport, which is not the same thing.
- **Codec fidelity in the harness.** Playwright's Chromium ships without
  H.264/AAC, so the harness uses VP9/Opus. The app asks `canPlayType` /
  `isTypeSupported` rather than naming codecs, so the code paths match — but the
  exact decode differs from a real phone.

---

## Suggested order of work

1. **Re-run the probe** (below) from the phone. Nothing else is worth doing
   until you know which backends are alive *today*, including the relay.
2. **Fix the cooldown poisoning and the reset gap** (#1, #2). Highest
   reliability-per-hour in the whole list, and independent of the research.
3. **Repair the browser harness** (#3), then keep it green. Without it you are
   flying blind and this will regress again.
4. **Then** research egress. Find out what the relay is; establish whether a
   residential-IP path exists at zero or near-zero cost. That is the only thing
   that makes this durable rather than lucky.

---

## How to test

```bash
npm test              # 386 unit tests. All mocks — proves logic, not playback.
npm run build
npm run test:browser  # real Chromium + real media. Currently 4/6; fix it.
```

The browser check needs `ffmpeg` (or `FFMPEG_PATH`) and a Chromium binary, and
skips cleanly without them. It stands up mock Piped, Invidious, Google and
Stremio servers; the Google stand-in deliberately sends **no CORS headers**,
which is what proves direct progressive playback needs none.

**The pool probe** is the important one, because it tests the real world:

1. Upload `tools/instance-probe.html` next to `index.html` in the Azure `$web`
   container.
2. Open it on the phone, tap **Run the probe**.
3. It tests every backend in `config.js` through four steps — reachable →
   search → resolve → **actually decodes a video** — using two different test
   videos. Passing entries get a "Play with sound" button.
4. "Copy results" produces a pasteable summary.

Keep its instance list in step with `publicFallbackInstances` in
`assets/js/youtube/config.js`.

In-app, **Settings → YouTube** shows live per-server health and has a **Test
servers** button (subject to bug #2).

---

## Ground rules that still apply

- No iframe, no embed, no redirect to YouTube. Enforced by test.
- No secrets in the repo. A private instance address is set at runtime in
  Settings and stored in the browser only; `tests/privacy.test.mjs` fails the
  build on a non-allowlisted host or a credential-shaped string.
- Static Azure Storage compatibility: browser HTML/CSS/JS only.
- Android Chrome is the primary client.
- Merging to `main` deploys automatically. The deploy workflow has succeeded on
  every push since 2026-08-29; the README line calling deployment "disabled" is
  **stale and wrong**.
