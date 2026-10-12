# Poweramp background continuity and saved R2 startup

This candidate addresses three reproduced engine behaviors: context-only suspension permanently cleared playback intent; a missed/delayed end could lose queue advancement when output was suspended; and one recovered network failure exhausted the selection's retry budget forever. It also removes the full-catalog network prerequisite for previously validated saved R2 tracks on subsequent opens.

## Behavior and boundaries

- A suspended AudioContext with an unpaused element (or a genuinely ended element) retains a continuation bound to context, selection generation, element and source. It never calls `play()` or `AudioContext.resume()` to override suspension. When the context naturally runs, it reconciles native state. An ended selection enters ordinary queue policy exactly once, including when an end-silence timer expired during suspension.
- Explicit Pause/Stop, native focus pause, screen-off-pause preference and newer selection invalidate continuation. A paused non-ended element, interrupted/closed context, or hung explicit context-resume request remains fail-safe. This cannot revive an OS-terminated page, guarantee a suspended context will run again, or distinguish every platform audio-focus behavior.
- Network recovery remains one reload per failure episode. Eligibility renews only after 30 accumulated seconds of advancing currentTime with running output. Samples must be at most five seconds apart, plausible for wall time/playback speed, and count at most their wall duration. Seeks, stalled/readiness events, suspension and large throttled jumps do not replenish the budget. A relapse before the threshold remains terminal. Thirty seconds is a conservative evidence threshold, not an asserted device or network cutoff.
- Native R2 snapshots are saved atomically with their track records. Startup validates the snapshot, exact configured endpoint and complete saved track identities before restoring mapping. Configuration/module loading overlaps local restoration; refresh runs in the background. The Worker remains authoritative for availability and object identity on every media request. No audio is prefetched or autoplayed by cache restoration. Active R2 playback prevents refresh from replacing its current object/queue. Unchanged track records are not rewritten.
- Cloudflare R2's existing source dialog offers **Copy playback diagnostics**. Export is manual, RAM-only, bounded and excludes URLs, titles, track IDs and secrets. Clipboard failure opens selectable read-only text. No automatic submission or telemetry is added.

The deployed native path is `/music/library.json`, handled by `backend/music-upload.js`; its Range parser comes from `backend/music.js`. This change does not modify backend delivery, authentication, uploads, cache policy, schedules, effects, or player geometry. Helper import versions change to prevent a new player from loading a cached helper without snapshot support.

## Evidence

Source baseline: `0f658032340040f676b2a8517db40d49d74b5d4c`. At diagnosis, its player and the live Azure player's SHA-256 were both `8f24a32cacde9d531be4382ae41142c1ad03d9dd48a8046ad20d2000d995b074`.

- Four causal engine regressions fail against that frozen player: context-only output return, missed end, delivered end during suspension, and a second independent network episode after stable playback.
- Final focused engine/catalog/ownership suite: 262 passed, zero failed.
- Initial focused Chromium run: 32 passed, zero failed. Includes generated PCM/native media, context-only suspension versus native pause, saved startup while catalog refresh is held, selection preservation, and both mobile diagnostic-copy paths. Subsequent final checks and hosted qualification are recorded in the PR.
- Existing UI baseline/geometry thresholds remain unchanged; the render test's full-source candidate fingerprint is updated for the changed player.

These are browser and simulated lifecycle tests, not physical Android, headphone, Bluetooth or lock-screen acceptance. HTTP checks and foreground playback do not close the reported background issue. Device acceptance should exercise mid-track and boundary stops with screen off, locked, and another app foregrounded, then collect the manual report immediately after any remaining stop. A two-minute observation does not establish a deterministic timer.
