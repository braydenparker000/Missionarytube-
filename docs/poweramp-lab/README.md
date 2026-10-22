# Poweramp 1031 implementation checkpoint

**Usable engineering checkpoint; native acceptance INCOMPLETE. Not deployed.**

New independent browser implementation in `frontend/poweramp-lab/`, based on current main `4fd9547d37d5845fbafb3f0edad53b6150a8cedd`. Branch: `feat/poweramp-1031-lab-native-reconstruction`. No V1/experimental V2 source was used. No workflows, launchers, Workers, provider settings or credentials changed.

Authority: [Session 1](https://github.com/braydenparker000/Missionarytube-/tree/0f4276fe556560c027497a70b76b0bd2bf3a361f/docs/poweramp-1031-native) and [Session 2](https://github.com/braydenparker000/Missionarytube-/tree/0a78ca83326fe72df2beae014c15b1757185a6c2/docs/poweramp-1031-native/session2). Static facts remain static facts; there is no original Android rendering oracle here. The user's Session 3 handoff governs acceptance. Read `acceptance.json` before making completion claims.

## Working implementation

The persistent Player owns local IndexedDB Blobs, metadata/artwork, actual decoded peaks, queue occurrences, shuffle/repeat, Media Session, and Web Audio EQ. Navigation/settings do not replace its active media element. Selecting another track deliberately creates a new element to isolate stale events. Decoding is limited to 48 MiB/600 seconds; unsupported analysis leaves peaks empty.

The layout resolver selects native qualifiers and integer device-pixel dimensions for three layouts, two skins, three seek modes, More Buttons, sub-art slots, typography, ratings, rounding and insets. Alternative uses independently licensed OFL Manrope. Proprietary TTNorms is not redistributed; Bold uses system fonts and remains a visible metric gap.

The DOM preserves separate art/list, top-control and navbar ownership. Motion includes independent clocks, reversal, direct ownership, shared-item holder math, row pivots, cancellation and stale-click protection. Canvas handles native-derived crop, procedural waveform bars and multipass artwork backgrounds. Graphics exports its known native GPU/bitmap and browser-input differences.

Library includes category/detail browsing, metadata search, selection, queue operations, playlist CRUD, scoped density and ratings. Settings persist per-skin/per-orientation/per-category values and independent Settings Theme. EQ gains and presets work through a real audio graph. Lyrics accepts editable text/LRC; visualization displays actual analyser output. These secondary screens are functional but not complete native visual/state-machine reproductions.

## Verification and reproduction

Use `npm ci`, then `npm run build`. Serve **dist**, opening `/poweramp-lab/index.html`; do not serve source and call it production verification.

```
node --test tests/poweramp-lab-*.test.mjs
POWERAMP_TEST_MEDIA=/private/licensed-music.ogg \
POWERAMP_LAB_EVIDENCE=/tmp/poweramp-lab-evidence \
node tests/poweramp-lab-browser.mjs
npm test
```

Browser script requires Chromium (`POWERAMP_CHROME` override), tests the built dependency closure/MIME/CSP, real music import/play/seek/reload, independent mini pause, EQ, and 108 configuration combinations over 360×780, 430×932 and 780×360 at DPR2/fontScale1/zero effective insets. This is causal browser evidence, not a native pixel score. Layout tests project all279 Session2 fixture inputs and compare selected qualified declarations, not every effective property.

`npm test` needs the immutable historical `.jarvis-source` fixture required by existing CI. Restore it at the exact `jarvis-release.json` commit; do not use it as a new app implementation reference. Local tools: Node24.19.0, npm11.9.0, Chromium154. CI's exact Node22/24 qualification and successful Validate on reviewed main remain required before release.

Latest bounded production browser check: PASS,108 configurations, zero page errors; see `browser-report.json`. Focused checks passed90 cases before the last library rating additions; the earlier whole-repository suite passed1177 cases. Final commit checks are recorded in the continuation receipt. The OFL license intentionally preserves upstream whitespace.

Private fixture used: Kevin MacLeod, “Vibe Ace”, CC BY3.0, obtained from the official librosa/data example-audio mirror. SHA256 `6c23aed3dd5aa57f2b1652ecab68d15d9b82ad257f54e639eb2880ca09bc118a`. Audio, cover payload and private test captures are not committed. Attribution/source manifest and logs are in `/workspace/work/poweramp/session3/`. No user media is uploaded by the app.

`baseline-hashes.json` records all246 prior frontend source files and248 prior built files except release metadata. Both comparisons were unchanged after the new route build. Whole-site build:20.85MiB, no media payloads. The existing publisher assigns no-cache to these unversioned assets and font/woff to the licensed WOFF; no publisher change was necessary.

## Resume here, in priority order

1. Reproduce the exact checkpoint using the branch commit and browser script. Preserve any final failing log; do not equate unit-test success with acceptance.
2. Close core motion gaps: upward lyrics route, mini horizontal page painting, native top-control scene transforms instead of the current bounded translation, and remaining shared-child font/crop/visibility interpolation. Current clocks and pivot formulas are useful, but do not establish visible native parity.
3. Finish native EQ shell/tab/preset/knob behavior. Current standard/custom-count practical EQ lacks parametric Q, volume/reverb tabs and full native preset assignment. Settings has only working supported controls, not the entire recovered native settings inventory.
4. Close library collapsing headers, group reorder and persistent sorting/history. Validate all typography, contained artwork, labels, transport glyphs, mini seek geometry and dialogs against an actual matched Android runtime. Original icons and default-font substitution remain explicit gaps.
5. Test Android Chrome/A15 audio focus, screen-off continuity, system font/insets and rapid multitouch after authorized publication. Remote R2 integration was not attempted; local playback is independent and mandatory.

## Publication boundary

Proposed phone URL, **not live-verified**: `https://missionarytube.z13.web.core.windows.net/poweramp-lab/index.html`.

No merge or publish approval has been given. A draft PR/checkpoint is not a release. First obtain explicit approval to merge a reviewed revision. After successful **Validate on the exact main SHA**, separately obtain approval to run **Deploy to Azure Storage** with `action=publish`, `expected_commit=<that exact main SHA>`, blank `rollback_run_id`. Reuse the qualified artifact, preserve rollback evidence, and verify actual-origin HTML/MIME/hashes/playback. If parent-receipt/adoption guards reject the new path, report the blocker; do not weaken the publisher or use alternate hosting.

The user reported low remaining weekly usage during integration. Feature expansion stopped to preserve a coherent runnable checkpoint, rather than claim the full recreation complete.
