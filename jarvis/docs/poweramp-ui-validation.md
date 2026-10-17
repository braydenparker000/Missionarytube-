# Poweramp UI reliability and smoothness

Implementation date: October 2, 2026. The artwork-first layout, pills, navigation, and waveform beneath transport remain intact.

## Changes

- Outgoing screens become inert as soon as navigation begins; delegated row actions also validate screen ownership. Mini-player expansion cannot activate the outgoing song list.
- Gesture clicks are suppressed for the contact that moved or held, while a fresh deliberate contact and keyboard activation remain usable. Pending swipes, holds, and seek contacts cancel on navigation, replacement, capture loss, and backgrounding.
- Artwork, mini-player, EQ, A–Z, visualizer, and timeline gestures validate pointer ownership. Tap eligibility uses maximum travel; reversed vertical swipes use signed progress.
- Track menus render immediately and load artwork afterward. Request identity prevents late artwork or menu customization from affecting a newer or dismissed sheet. Shuffle owns its context-menu event.
- Mini-player seeking supports pointer capture, cancellation, song-change checks, and keyboard input. Queue has separate Added queue and Playback order views; the latter follows current engine indices, shuffle, and repeat settings without rebuilding the engine queue. Added queue interruption and completion remain governed by existing Queue settings.
- Library display hides a Drive migration copy only when an enabled R2 copy has the same migration identity, byte count, and checksum. Files, source settings, and saved playlists are retained.
- Library controls, song rows, groups, playlists, and folder navigation expose accessible names and keyboard actions.
- Seek progress uses transforms instead of repeated width/position layout changes. Row construction yields in small batches with a time budget and pauses during contacts unless needed for an A–Z jump. A–Z anchors are computed from metadata and deferred jumps reject obsolete views. Player fitting skips redundant style writes and retains scale-aware spacing.

## Regression evidence

The original repository suite contained 251 passing tests. The completion suite contains 326 passing tests, including 70 focused gesture, menu, navigation, queue, and accessibility regressions and 11 waveform tests. Existing playback sequencing and audio fidelity tests remain included. Playback progress cannot overwrite the mini-player seek preview while the contact owns it. Live browser testing also found that padding caused a Z tap to select W and an accented Ö title could preempt the Z jump. Alphabet input now uses cached visible letter bounds and folds accented Latin initials into their letter buckets; non-Latin titles cannot preempt an A–Z target.

Source-handler tests use simulated DOM nodes, pointer/touch events, timers, and display frames. They verify event ownership and state transitions; they do not establish physical-device smoothness. The deployed build must also be checked with real browser interaction.

## Completion follow-up

- Mini-player progress now uses a transform at display-frame cadence while visible. Labels and accessibility values retain their lower update budget. Seeking measures the rail once per contact, and cancellation still restores actual playback progress.
- A contact that interrupts artwork, mini-player, or vertical screen settling resumes from the displayed transform. Old completion callbacks are canceled. Tapping to stop an animation returns to the current track/screen; a fast reversal cancels rather than committing the old direction. Window resizing cancels active contacts before cached geometry can seek to an incorrect time. These ownership/position cases are source-handler regressions, not physical rotation measurements.
- The R2 public media handler previously read, parsed, and validated the complete library for every range request. It now retains one validated snapshot per R2 binding and checks the catalog's current ETag, size, and modification time before every use. Track lookup uses a Map. A catalog replacement is read conditionally against that ETag; invalid, missing, oversized, or concurrently replaced catalogs fail closed. Each audio/art request still verifies the object's original identity and verified hash metadata.
- The cached catalog response uses its already validated text, with serialization only when album membership sanitization changes it. Validation no longer clones discarded analysis data or groups every album when no complete-album claims exist. Signed registration and analysis writes retain their separate current reads and conditional writes; no upload access or storage policy changes were added.
- Regression coverage verifies repeated ranges without repeated catalog-body reads, immediate new-upload/removal visibility, invalid replacements/deletion, storage-binding isolation, concurrent catalog replacement, and changed media identity. A local 2,613-track, 2,884,423-byte snapshot required one body read across 101 version checks. The in-memory warm path had a median of 0.000814 ms and p95 of 0.005864 ms with mocked R2 I/O. These are local algorithm measurements, not network latency or production Worker CPU measurements. Cold isolates still validate the full current catalog.
- Loaded prepared waveform and progressive live-sample rendering are covered in both whole-track and centered views. Unloaded time remains empty; streamed audio is not downloaded a second time for waveform generation. The earlier faint waveform observation does not by itself justify a styling change.

The observed HTTP 503/1102 is documented by Cloudflare as a Worker CPU-limit failure. Removing repeated whole-library processing addresses a measured hot path; attributing every prior failure to that path would require production profiling. Release acceptance includes real Range/CORS/hash/decode verification, independent Drive and R2 browser playback/seek/artwork checks, and review of the mobile viewport evidence. Existing public-by-link access, Muse signing keys, bucket privacy, source settings, and stored tracks must be preserved during deployment.

## Reported UI lag follow-up

The user reported lag across the whole interface after release. Source-handler reproduction found that visibility recovery zeroed the current animation handle without canceling the hidden timer. Five background/return cycles left six independent frame chains running. The fix stops rendering immediately on backgrounding and uses a generation guard so canceled callbacks cannot restart or interfere with the current loop. The same regression now retains exactly one chain and no hidden polling timer. This is a reproduced lifecycle defect, not a measured A15 frame-rate result.

The mini-player thumb previously changed a CSS `left` expression every display frame even though the fill itself used a transform. The thumb now belongs to the translating fill layer; its endpoints, size, and appearance remain the same. Progress no longer paints a hidden player rail or rewrites unchanged time labels and accessibility attributes. Owned scrubs retain their preview without competing periodic canvas work, and navigation refreshes the newly visible progress values.

Waveform bars entirely before or after the playhead now draw once without a clipping stack. Only a bar crossing the playhead receives both clipped colors. For the 44-bar whole-track test fixture, ordinary drawing falls from 88 paths and 88 clipping operations to 44 paths with zero clips; a crossing bar adds one path and two clips. Prepared and progressive data, exact playhead color boundaries, seeking, and the existing gesture regressions remain covered. These operation counts do not measure GPU time or establish 60 fps on the phone. Full-screen visualization keeps its existing animation cadence.

Eleven additional regressions cover render lifecycle, stale callbacks, hidden work, scrub ownership, navigation progress, thumb updates, and waveform clipping. The full current suite is recorded by source CI. The current launcher/Relay release is retained; this hotfix changes only the Poweramp rendering paths and their tests/documentation.

## Galaxy A15 acceptance checks

- Rapidly tap the mini-player title over different song rows, including while paused. Current track, playback intent, and queue must stay unchanged until a deliberate player control is used.
- Scroll and pinch All Songs, then immediately tap a row. The moved contact must not play a song; the new tap must work. Interrupt momentum with a new contact.
- Scrub the waveform, then immediately tap Play and Next. Verify no delayed or duplicate activation.
- Test artwork diagonals, direction reversal, two fingers, capture loss, and background/resume. Check EQ, A–Z, mini seeking, and visualizer recovery.
- Open Shuffle by long press. Open successive track menus and dismiss while artwork is loading; the latest action must win.
- Check Queue views with shuffle, repeat, duplicate occurrences, added songs, and queue-end settings. Verify row and header Play actions keep the selected playback order.
- Check loaded waveform data, safe areas, font scaling, portrait/landscape, reduced motion, and keyboard focus.
- Record cold and warm visits with several thousand tracks: interaction-to-paint latency, frame times/dropped frames, layout/paint time, memory, and background resource use.

Physical Galaxy A15 input and performance are not available in the implementation environment. The plan's latency and 60 fps targets are acceptance targets, not measured results. Native scrolling and viewport virtualization remain conditional on device measurements and pinch/momentum validation; this release retains the existing scrolling model. Optional visual restyling was not applied.
