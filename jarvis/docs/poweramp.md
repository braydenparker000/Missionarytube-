# Poweramp playback: architecture and acceptance

The lasting rules from the dated Poweramp reports of 2026-10-10 to 10-12. Those reports never verified behavior on a phone, Bluetooth, a headset or the lock screen, and this page doesn't claim it. The full reports, logs and captures stay recoverable at commit `0e8d89cecd15e681ae949b116e64df8f52668a6d` (links at the end).

## Playback ownership
- The Engine owns two persistent audio elements. `_playRequest` identifies a selection or cancellation, `_playAttempt` fences Play promises, and transition owners fence the spare slot.
- Playback intent is separate from audio actually flowing. Pause, a new selection, native focus pause and AudioContext interruption give up intent. Coming back to the page doesn't grant permission to restart.
- A `playing` event or fulfilled Play promise is checked against current readiness, pause, end and error state before it clears the 12 s no-progress timer. The watchdog rechecks readiness when it fires and yields if the element is paused.
- Media Session handlers register synchronously, independent of metadata. Text metadata is immediate, artwork follows, and a per-update sequence drops stale artwork.

## Bounded recovery
- Native and legacy R2 reload the original URL once per failure episode. They wait for online when appropriate, keep pending seeks, and recheck request, element, source and track ownership. Decode and unsupported-media errors stay terminal. There's no blanket retry, focus resumption or source fallback.
- The retry budget renews only after 30 s of accumulated, advancing currentTime with running output. Samples must be at most 5 s apart, plausible for wall time and playback speed, and count at most their wall duration. Seeks, stalls, suspension and large throttled jumps don't count, and a relapse before the threshold stays terminal. 30 s is a conservative evidence threshold, not a device cutoff.
- Only a suspended AudioContext keeps a continuation. With an unpaused or genuinely ended element, it binds to the context, selection generation, element and source, and never calls play() or AudioContext.resume(). When the context runs again on its own it reconciles, and an ended selection advances exactly once. Explicit Pause/Stop, focus pause, the screen-off-pause setting and a newer selection cancel it.
- Interrupted or closed AudioContext states are not suspension and keep no continuation. A paused non-ended element and a hung explicit resume request also stay fail-safe: nothing restarts on its own.
- The sleep fade has an owned completion with a generation fence, and cancelling restores the slot gain. Expiry cancels a pending load. A native end during the sleep fade stops instead of advancing.

## Queue, deletion and background jobs
- Queue occurrences are indices, not unique IDs. Deletion remaps order and position, keeps the surviving occurrence order, and cancels obsolete spare transitions and pending explicit entries. Deleting the selected track selects the first survivor paused; it never autoplays.
- Stop releases both slots, including local object URLs.
- Tag-worker deadlines start at dispatch. A failed or stalled pool is terminated and its outstanding jobs fall back to the main parser.
- Late file reads and metadata or duration results check live record identity, so deleted records aren't revived. An unreadable file counts as a failed item and doesn't strand scanning.

## Library dates
- Native R2 Date Added is the validated r2Identity.lastModified (upload time), marked addedSource=r2-upload. Original library-add dates aren't available, and nothing is inferred from filenames, titles, catalog time or import time.
- Local and Drive date behavior is unchanged. Native refresh and offline cached discovery repair legacy timestamps while keeping IDs, ratings, plays, resume positions and custom artwork.
- Default is newest first and reverse is oldest first. Unknown or non-positive dates stay last either way, and ties keep library order.

## Saved R2 startup
- Native R2 snapshots are saved atomically with their track records. Startup validates the snapshot, the exact configured endpoint and every saved track identity before restoring. Refresh runs in the background and can't replace the object or queue of active playback. Nothing is prefetched or autoplayed. The Worker stays authoritative on every media request.

## Curated playlists
- public/drawercast/curated-playlists.json is kept byte-for-byte: 968,384 B, SHA-256 86bc49aac0a6c1b1fab06e6020e956b5e40d21cd252acde97f9ee7a7d61e9bcf, 8 playlists, 3,810 R2 references.
- Import: an exact ID beats a colliding path. Path fallback needs a unique exact path within the source's constraints. Malformed or oversized files are rejected before any change, and titles or basenames are never guessed. Imported track order and intentional duplicate occurrences are kept. Import creates new playlists instead of merging into same-name ones.
- Writes are serialized and resolve when the IndexedDB transaction completes. The additions, plus a receipt when one is used, commit atomically. A failed commit publishes no partial UI state, and a persisted-state mismatch fails closed.
- A receipt is optional for ordinary imports and mandatory for the one-time seed. Seeding runs after native R2 mapping or catalog completion, only once every reference resolves, never changes a same-name playlist, and its receipt stops a deleted seed from coming back.

## Diagnostics
- "Copy playback diagnostics" in the R2 source dialog is manual, RAM-only and bounded. It excludes URLs, titles, track IDs and secrets, and nothing is sent automatically.

## Shuffle and motion
- For now these stay in docs/poweramp/shuffle-20261012.md and docs/poweramp-motion-acceptance.md, which are under review in a later batch.

## Acceptance
- Regression tests: tests/poweramp-native-reliability.test.js, poweramp-playback-continuity.test.js, poweramp-handoff-recovery.test.js, and poweramp-native-reliability-browser.test.js (POWERAMP_SOAK_SEGMENTS=5, JARVIS_CHROME set to the verified Chrome). For before/after reproduction, set POWERAMP_PLAYER_SOURCE to an older public/drawercast/player.js. Override runs don't count as release qualification.
- Browser fixtures don't prove device behavior. Real-phone acceptance applies to playback-affecting releases, not to docs-only or unrelated UI releases. For playback-affecting releases, test long locked playback, repeated headset Next/Previous, a deliberate Pause, a brief network loss with a track change, and another app taking audio focus. Export diagnostics right after any stop.

## Historical reports and evidence (pinned to 0e8d89cecd15e681ae949b116e64df8f52668a6d)
- [poweramp-playback-actions-20261010.md](https://github.com/braydenparker999/jarvis/blob/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/poweramp-playback-actions-20261010.md), evidence [poweramp-playback-actions-20261010/](https://github.com/braydenparker999/jarvis/tree/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/evidence/poweramp-playback-actions-20261010)
- [poweramp-review-20261011.md](https://github.com/braydenparker999/jarvis/blob/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/poweramp-review-20261011.md), evidence [poweramp-review-20261011/](https://github.com/braydenparker999/jarvis/tree/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/evidence/poweramp-review-20261011)
- [poweramp-curated-playlists-20261012.md](https://github.com/braydenparker999/jarvis/blob/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/poweramp-curated-playlists-20261012.md), evidence [poweramp-playlists-20261012/](https://github.com/braydenparker999/jarvis/tree/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/evidence/poweramp-playlists-20261012)
- [poweramp-background-recovery-20261012.md](https://github.com/braydenparker999/jarvis/blob/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/poweramp-background-recovery-20261012.md), evidence [poweramp-background-20261012/](https://github.com/braydenparker999/jarvis/tree/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/evidence/poweramp-background-20261012)
- [poweramp/date-added-20261012.md](https://github.com/braydenparker999/jarvis/blob/0e8d89cecd15e681ae949b116e64df8f52668a6d/docs/poweramp/date-added-20261012.md) (no evidence folder)
