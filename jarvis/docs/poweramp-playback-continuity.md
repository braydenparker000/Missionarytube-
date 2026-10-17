# Playback continuity

This repair preserves the Poweramp UI, gestures, animation settings, catalog,
source URLs, and audio processing graph. It does not claim that Android will
keep a page alive or that a physical Samsung screen-off test has passed.

## Transport and state

The native R2 catalog uses `remote:false` to describe its library ownership.
Its media still comes from a verified network URL. Transport capabilities now
identify R2, Drive, and phone-server streams explicitly, independently of that
legacy flag. Local files do not receive network stall recovery.

Desired playback (`wantsPlayback()`) is distinct from confirmed media/output
playback (`playing`). A pending Play remains cancelable but does not claim
actual playback. MediaSession reflects actual playback, including while an
AudioContext resume or an incoming transition remains pending.

## Bounded recovery

- Every network source watches a silent initial Play and a no-progress stall
- Repeated waiting events do not reset a stall's original 12-second deadline
- Native and legacy R2 network failures reload the exact original clean URL
  once per selection, preserving the actual position or pending seek
- R2 never query-busts, switches to Drive/server, refreshes a manifest, or loops
- A second failure pauses visibly. A later explicit Play reloads an errored
  network slot at its position and begins a fresh bounded selection
- Current play aborts and autoplay denial yield focus and ask for explicit Play
- Stale play promises, retry callbacks, and source requests cannot restart
  playback after Pause/Stop or interfere with a later selection
- Unexpected native media pauses or context interruption relinquish desired
  playback. Lifecycle events and ordinary context checks do not restart music
  over calls or another app
- A stalled/blocked context is diagnosed separately; it cannot spend an R2
  network-recovery budget. A closed context requires a page reload

## Diagnostic evidence

`window.PA.PlaybackDiagnostics.report()` returns a detached snapshot of the
latest 80 in-memory transport/lifecycle events. It records source kind,
request/attempt numbers, desired/actual/paused/ended flags, position, readiness,
media error code, context state, visibility, and allowlisted error names and
reasons. It excludes titles/track IDs, URLs, server addresses, credentials,
artwork, arbitrary error messages, and browser fingerprints. Nothing is stored
or sent automatically; a page reload clears the log.

## Verification

```sh
node --test tests/drawercast-playback.test.js tests/r2-playback.test.js \
  tests/native-r2.test.js tests/poweramp-playback-continuity.test.js
```

The new tests use a fake clock and asynchronously queued media pauses, including
an owned pause task discarded by load. They cover native/legacy R2, initial
silence, deadline/retry bounds, pending seeks, stale promises, focus/cancellation,
context failures, and diagnostic privacy. The frozen pre-repair player can be
supplied through `POWERAMP_PLAYER_SOURCE` to reproduce the baseline failures.

The repository's mandatory browser and performance CI must also pass before
release. VM/CI coverage does not prove real Samsung background execution.
On the phone, with Pause on Screen Off disabled, play across two natural song
boundaries while locked, try a new-song start and lockscreen Pause/Play, and
confirm that calls/another media app retain focus until explicit Play.
