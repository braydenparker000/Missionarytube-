# Poweramp interaction and playback reliability

Source: `braydenparker999/jarvis` at `ed66ef2dd14bcdd875a189c0332fc8007c218075`.
Deployment: `braydenparker000/Missionarytube-` at `429997c61fab8de8ae84d8c1b5098a9407ebb51d`.

## Fixed behavior

- Next, Previous, category skip, and Pause retain the user's intent while cloud audio loads. Abandoned requests cannot start later.
- Shuffle anchors the selected occurrence at the start. Album grouping includes artist identity. Catalog metadata refresh preserves the current order.
- Queue display follows playback order. Returning from an explicit queue preserves duplicate occurrences, remaps removed tracks, and applies the resume position only to the intended selection.
- Playback checkpoints every 10 seconds and at page-hide/visibility boundaries, with a synchronous fallback for an unfinished IndexedDB commit. Explicit queue and playhead are saved together.
- Remote playback restores a saved playhead without loading audio until Play. Deferred seeks wait for usable metadata and cannot affect a later selection.
- End-of-track handling rejects repeated, paused, or stale callbacks. Preloading respects repeat-one and explicit queued tracks. Crossfade cannot bypass an explicit queue's exit.
- Held category buttons seek without also skipping on release. Movement cancels the hold. Seek gestures track pointer and playback request identity and clean up after lost capture.
- List scrolling and long presses suppress accidental trailing taps. Art double-tap initialization and gesture cancellation on focus loss are corrected.
- Hidden sheets are inert and absent from accessibility navigation; open dialogs focus and contain keyboard navigation. Global shortcuts do not intercept editable controls or buttons.

## Automated checks

- 170 source tests passed, including 21 new playback and interaction regression checks.
- 519 deployment repository tests passed.
- Production build passed: 147 frontend files, 19.03 MiB, no media payloads.
- JavaScript syntax and whitespace checks passed. Diff reviewed: no credentials, private addon URLs, new dependencies, or deployment identity changes.

## Browser verification

Cloud Chrome at the production URL, September 28, 2026:

- Restored a Drive song at 0:50 without preloading audio; Play resumed the stream past 1:03 with readyState 4 and no media error.
- Two quick Next taps followed by Pause selected the final song and left both audio elements paused.
- Selected 1LDK in All Songs and used Play Next. Next entered that song while paused. Play streamed it; repeated UI keyboard seeking to its end triggered natural automatic return to the next song in the original playlist.
- Shuffle selected a different song and continued playback. Cycled all modes and restored Shuffle Off.
- Mini-player left swipe changed All Falls Apart to Bloodbath; right swipe returned to All Falls Apart, preserving paused state.
- Holding the forward-seek control moved to the end of All Falls Apart without changing songs. Repeat One restarted that song and playback advanced past 17 seconds. Restored Repeat Off.
- Track-menu Escape dismissal removed the hidden controls from the accessibility tree. Settings search accepted typing without triggering playback shortcuts.
- The automated artwork drag held long enough to open its long-press menu; no claim of an artwork finger-swipe hardware test.
- Waveform drag moved a paused playhead from 0:18 to 0:50 without changing songs or starting playback.
- Final checkpoint revision deployed successfully in Actions run `36484420158`, job `109137733013`. CI verified the pinned source, all tests, and 149 deployed files byte-for-byte plus directory routes/root.
- Final revision restored the seek position (0:20) after an immediate reload. The subsequent streaming/resume test could not complete: requests stalled with readyState 0 and bounded retry stopped playback.
- An independent request to the same Google Drive media route returned HTTP 403, HTML, and an explicit automated-query network denial from Google. Configuration still returned HTTP 200 JSON. This identifies an upstream test-network restriction, not a demonstrated checkpoint regression. It does not prove how the user's device will behave.
- Stopped retrying after identifying the restriction. Both audio elements were paused in the final screenshot. A successful final-revision live resume remains unverified.

## Limits

Cloud Chrome testing cannot certify physical Android multi-touch, screen-lock/background playback, Bluetooth controls, every codec, or behavior under every Drive/network outage. No claim of zero defects or guaranteed uninterrupted remote playback.

## Evidence

`player.jpg` captures the final deployed player in its paused state. It is UI evidence, not proof of uninterrupted streaming.
