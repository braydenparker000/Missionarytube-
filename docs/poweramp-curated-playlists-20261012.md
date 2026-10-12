# Playlist import and curated-seed preparation

Preparation is based on the live release `ed9ab565d4c4147f3a2a5582474ad6915f15c798`; the literal main branch was behind that release when inspected. The curated artifact has not yet been supplied. `PlaylistFiles.seedURL` remains null, so no preinstalled content is fetched or enabled. This is not a completed eight-playlist integration.

The existing `PlaylistFiles` importer is retained. Exact IDs now take precedence over colliding paths, fallback uses unique exact paths with source constraints, and malformed/oversized files are rejected before mutation. Basename/title guessing is removed. Imported track order and intentional duplicate occurrences remain intact; importing creates new playlists rather than silently merging same-name user playlists. Counts distinguish matched, unavailable and ambiguous references.

Playlist writes are serialized and resolve on IndexedDB transaction completion. Import additions and the optional one-time receipt are atomic. Failed commits do not publish partial UI state. Concurrent edits/deletions remain in memory and subsequent queued saves include the imported additions. A persisted-state mismatch fails closed instead of overwriting another tab's changes.

The prepared seed hook runs asynchronously after native R2 mapping restoration or catalog completion, not after an arbitrary nonempty library. It waits until all curated references resolve to available mapped R2 tracks. Exact same-name existing playlists are preserved without modification. A durable one-time receipt prevents repeated insertion and resurrection after deletion. No recurring timer, automatic audio playback or credential change is added.

Before enabling: obtain and review the actual eight-playlist JSON; validate its names and references against the intended native catalog; confirm the authoritative PR base; set the static artifact URL; rerun focused/browser and required hosted qualification. Do not substitute test fixtures for the curated data.

Prepared checks: 257 focused tests passed; one Chromium integration check passed, including real file selection, durable storage and forced transaction abort. That browser check fails against the frozen live source at the reproduced exact-ID-versus-path collision. Evidence is under `docs/evidence/poweramp-playlists-20261012/`. Existing playback code is unchanged apart from the asynchronous catalog-ready seed hooks.
