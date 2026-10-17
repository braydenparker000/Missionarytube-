# Media reliability acceptance, October 9, 2026

This focused branch starts from Jarvis main
`ea9c09c1ddb172c1f0d668b58a5e7066f1c8318f`. The separately inspected
Missionarytube main is `bf12a379754225db770429d01bf730758fab9a4b`; its release
pin is `c4d62409a3b67e4e5dac88809c6a4a0290b6e39e`. That pin was built and
tested as published, not changed to this candidate. Integration and deployment
remain with the release owner.

## Confirmed repair

Astra 0.34.5 throttled position recording to every four seconds. Pause,
pagehide and visibility loss only flushed the previous recorded position;
closing a player could release its media before recording the live position.
A repeated real Chromium run exposed this gap. The deterministic reproduction
fixes only `Date.now` so media, timers, user input and decoding remain native.
After seeking and pausing at **10.034096 seconds**, main saved **0.252644
seconds** and resumed at **0.290191 seconds** after a real reload.

Astra 0.34.6 checkpoints finite-duration media at Pause, seek completion,
player close, pagehide and visibility loss. Scoped callbacks retain their
attempt/disposal checks. Existing periodic coalescing, bounded history and
quota handling remain in place. A native-ended element is not recorded as
incomplete by a later Pause/close checkpoint; the real ended handler still
owns completion. The candidate saved **10.164296 seconds** and resumed at
**10.189891 seconds** in the same reproduction.

Only the playback callbacks/helper, release metadata and uniform asset cache
versions change. Poweramp, its shipped offline-Next recovery, all CSS, motion,
artwork, UI templates and Podcasts provider/JSONP code are untouched.

## Browser evidence and limits

`tests/media-reliability-browser.test.js` requires an executable browser rather
than silently skipping. It uses production pages, normal trusted UI controls,
native HTML media and generated fixtures. Native media errors are not assigned
synthetically. All external network traffic is blocked.

| Acceptance | Evidence |
| --- | --- |
| Astra saved resume | Native decode, seek, Pause, persisted live checkpoint, real reload and explicit Play; no media opens on reload. |
| Astra audio browsing/interruption | Non-silent generated PCM over HTTP, retained media element while browsing, real Pause and CDP freeze/return; only explicit Play resumes. Freeze notification is controlled, not Android suspension evidence. |
| Astra completion | Real native end, close and reload retain completed history. |
| Astra source recovery | Actual HTTP 503 stays bounded; explicit Retry recovers the selected source. |
| Astra stalled seek | A real unfinished HTTP Range body carries metadata/initial PCM but no bytes at 87 seconds. Pause cancels the deadline; explicit Play reaches a bounded terminal error; Retry preserves 87 seconds. Native Play delivery is awaited before advancing the JS clock. |
| Astra cancellation | Closing a pending HTTP source aborts its response; late bytes and offline/online notifications do not resurrect the player. |
| Poweramp interruption/navigation | Nonzero samples measured through the actual output analyser; browsing retains the selected slot/element. A real `AudioContext.suspend()` yields intent and native playback. Returning the context does not restart playback; explicit Play restores nonzero output. This is not Android audio-focus delivery. |
| Poweramp checkpoint | Real IndexedDB/checkpoint persistence and full-page reload restore native R2 position without requesting media or autoplay; explicit Play restores output at 67 seconds. |
| Shipped Poweramp recovery | Existing native suite still verifies offline Next error 4, same-selection recovery once, Pause cancellation, genuine unsupported bytes staying terminal, a held seek deadline and a withheld native end/resume callback. |
| Native PiP API | Inline and fullscreen entry with a one-second dwell on each path, native enter/leave events, route retention, Pause retention and Back cleanup. Astra uses its actual controls; My Media's fullscreen leg invokes the native API after activation. |

Astra and Poweramp media/add-on legs use real local HTTP including 206 Range
responses. My Media's fixed Google API/media transport is intercepted with
generated VP8 bytes, as in its existing tests. That leg proves native decoding
and PiP callbacks, not Google's delivery reliability. No copyrighted media,
real account, upload or production catalog was accessed.

The headless desktop Chrome run kept the original My Media page `visible`
after another page was brought forward. Its native hidden-tab exit policy is
therefore **not exercised** by this run. The existing diagnostics test covers
controlled event orderings, which also do not prove Android behavior.
Screenshots capture page content, not the OS PiP window or its entry animation.

The reported A15 fullscreen → Home entry glitch and alternative route
foregrounding were **not reproduced or resolved on Android**. Home, native
close/remove/expand controls, native focus transfer, screen-off execution and
Android process survival remain physical acceptance gaps. Do not infer an exit
control from a `leavepictureinpicture` event. The
[PiP specification](https://w3c.github.io/picture-in-picture/#event-types) gives
enter/leave notifications, and
[native exit controls may change playback](https://w3c.github.io/picture-in-picture/#exit-pip);
it does not supply a native close-versus-expand reason.

## Reproduction and validation

Use Node **22.23.3**, Playwright Core **1.56.1** and checksum-verified official
Chrome for Testing **154.0.8037.97**. The Chrome archive SHA-256 is
`487c3b0e89f786d9257a6265a29bacf18b893e90f29c0ef6f7be9706ecc8c7a2`.
The existing installer selects and verifies it:

```sh
RUNNER_TEMP=/tmp node scripts/install-qualification-browser.mjs
export JARVIS_CHROME=/tmp/jarvis-qualification-browser/installed/chrome-linux64/chrome
export MEDIA_RELIABILITY_EVIDENCE_DIR=/tmp/media-reliability
node --test tests/media-reliability-browser.test.js \
  tests/poweramp-native-reliability-browser.test.js \
  tests/pip-diagnostics-browser.test.js
npm test
```

The focused command passed **24/24 tests, zero skips**. Machine-readable
snapshots, focused TAP output and the frozen-main failure are in
`docs/evidence/media-reliability-20261009/`.

The Astra artwork/state/reliability contracts passed **15/15**, and the tracked
source/qualification inventory passed **26/26**. The unchanged Poweramp scene
and snapshot visual suites passed **19/19** when run serially. Both dark and
light canonical list/player endpoint comparisons reported **zero changed
pixels**. Their intermediate-scene assertions and thresholds are unchanged.

The aggregate `npm test` run is **not a qualification pass**: 2,032 tests,
2,022 passes, six failures, two cancellations and two skips. It overlapped the
final cache-version correction and staging of this new suite. The version and
tracked-inventory failures are corrected and separately pass above. Its
unchanged My Media live archive-cover case timed out waiting for an external
thumbnail. Its Poweramp late-art scene assertion and light visual timeout
passed in the unchanged isolated 19-test rerun. Do not erase the aggregate
failure or treat those separate reruns as a complete release qualification.

To reproduce the before behavior, extract main's app script and run only the
saved-resume case with `ASTRA_APP_SOURCE` pointing to it. Override runs are
reproduction evidence, not candidate qualification:

```sh
git show ea9c09c1ddb172c1f0d668b58a5e7066f1c8318f:public/media/assets/js/app.js > /tmp/astra-before.js
ASTRA_APP_SOURCE=/tmp/astra-before.js node --test \
  --test-name-pattern=Astra \
  --test-skip-pattern='non-silent|native end|failed HTTP|real held|native inline|closing a pending|closing or leaving' \
  tests/media-reliability-browser.test.js
```

The committed before snapshots record the original app and index release
0.34.5. A later frozen-script-only replay also fails the resume assertion; its
index still reports the candidate version, so it is recorded separately as an
app-body reproduction, not a full baseline release.

Missionarytube's unmodified current-main `npm test` passed **852/852** with
zero skips, and `npm run build` passed for its existing pin: **172 files,
19.58 MiB**, with no media payloads. This is not a candidate-release build or
deployment. The release owner's complete qualification, serial performance
gates and combined pinned build remain required before publication.

## Minimal actual Samsung A15 test

WorkDroid status at **2026-10-09 02:48:27 UTC**, rechecked at
**03:10:20 UTC**, reports
`phone_connected:false`, `session_id:null`, `bridge_version:null` and
`last_heartbeat_at:null`. No device action or physical test was performed.
Recheck connection before trying any phone action. WorkDroid exposes Home,
Back, Recents, inspection and media controls; its key tool does not expose the
Power/lock button. A physical observer must lock/unlock the phone and assess
the PiP transition animation. The Android chat client is not connection proof.

Use the release owner's approved test build and already available authorized
media/fixtures. Record `/release.json`'s source commit, My Media/Astra release
numbers, actual Chrome/Android/One UI versions, normal tab versus installed or
custom-tab context, orientation and audio route. Keep one tab, video, position,
orientation and native exit control identical between PiP runs. No music
uploads, credentials or deployment/settings changes are part of this test.

1. **Controlled one-second PiP comparison, about 30 seconds.** In My Media,
   play the chosen video from a normal Chrome tab. Run A: enter fullscreen,
   press Android Home, wait exactly one second, then use the native **X/close**.
   Run B: return deliberately, reset the same video/position/orientation,
   request inline PiP, press Home, wait exactly one second and use the same
   **X/close**. Observe entry smoothness and whether Chrome becomes foreground
   *before any deliberate return*. Inspect current app/screen immediately
   after each close. Return only afterward to export each PiP report. If the
   actual control was Expand or swipe-to-remove, label that separately rather
   than treating it as the close comparison. Repeat only a failing route once
   to determine whether it is intermittent. Repeat the same two routes in
   Astra only if it also exhibits the report.
2. **Locked Poweramp handoff.** Record existing playback settings, including
   Pause on Screen Off, gapless/crossfade and repeat mode. For a continuation
   claim, Pause on Screen Off must already be disabled. Start near a track's
   end and physically lock. Listen across two real ends using short existing
   authorized fixtures if available. Verify selected-song continuity, then
   lock-screen Pause; wait five seconds and confirm silence. Explicit Play
   must resume. Missing short fixtures are a test-input blocker, not permission
   to run an uploader. This check cannot prove long-duration process survival.
3. **Real focus and connection interruption, about 30 seconds each.** With
   authorized playback active, let an existing second media app take audio
   focus. Return to Jarvis without Play: it must remain yielded. Explicit Play
   resumes. Perform this for Poweramp and Astra audio. For Poweramp source
   recovery, use a short ordinary connectivity interruption and Next; restore
   connectivity and verify the same selected R2 song recovers at most once.
   A separate Pause during the interruption must prevent later recovery. If
   connectivity controls are unavailable, record that case as untested.

After a failure, capture the existing bounded Poweramp playback report or
Astra playback details/PiP report promptly, plus the clock time, observed
native control and foreground app. Keep the raw report local; inspect it
before sharing. Record whether Chrome reloaded or the source changed. For the
PiP entry glitch, an observer or actual device recording is required; a later
screenshot is not animation evidence. No polling or automated job is created.
