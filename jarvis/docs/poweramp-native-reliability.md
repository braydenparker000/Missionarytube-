# Native R2 playback reliability, October 8, 2026

This pass starts from deployed source `c770d9e62d556ce2a173ad0d385f250ad7114ac0`
and preserves PR59's ended handoff and fresh crossfade recovery budgets. Release
integration also preserves Relay source `c0931ed2c3e8f9770ebec2aa9892261051ac141e`.
The default Transparent, crossfade-off, gapless-on path is the main test subject.
There are no changes to touch input, animation, audio processing, uploads,
credentials, source URLs, deployment configuration, or available playback options.

## Reproduced behavior and fixes

- **Startup checkpoint:** native R2's `remote:false` entered the local-file
  restoration path before its mapping was installed, losing the saved position.
  All network transports now restore the queue and position without loading
  media until explicit Play. This is a confirmed startup defect; the owner's
  tentative memory of restarting at zero is not evidence that it caused the
  reported background stops.
- **Stalled seek:** metadata or a manual seek jumped the playhead and cancelled
  a no-progress deadline without flowing audio. Seek application now updates
  the watcher's baseline, and unconfirmed output cannot clear its deadline.
  Genuine playback progress still cancels recovery.
- **Missed end/pause callback:** lifecycle return only logged state. It now
  consumes a native `ended` flag through the existing fenced end handler, so
  repeat, shuffled occurrences, explicit queues and configured silence retain
  their normal policy. An unreported native pause relinquishes intent; it does
  not trigger Play. A current explicit context resume can finish normally.
- **Offline recovery:** the one R2 reload ran while offline and could exhaust
  recovery before connectivity returned. Its existing 800 ms delay now owns
  the reload and Play together. If the browser reports offline at that point,
  the attempt waits at most another 30 seconds for online. Duplicate errors or
  online events cannot create more attempts. Expiry stops visibly and requires
  explicit Play. Pause, Stop, focus actions and newer selections cancel both
  stages, including the reload before it spends network resources.
- **Repeat-one recovery:** a fully completed loop inherited the previous
  loop's spent retry budget. A real native end now resets recovery before the
  repeat starts; metadata, Play completion and stalls within a loop cannot do so.
- **Catalog races:** pending Play and buffering counted as idle, allowing a
  refresh to scan the library or replace a queue during an asynchronous commit.
  Refresh defers while playback is desired and rechecks after the commit. Its
  queue remapping now preserves indices and duplicate occurrences rather than
  collapsing every repeated track to its first index.

## Evidence

`tests/poweramp-native-reliability.test.js` runs the real Engine, production
transport wrappers, R2 refresh implementation and lifecycle listeners with a
controlled clock and media tasks. Its 47 scenarios include delayed timers,
explicit Pause, missing events, stale preloads, network and codec failures,
offline/online races, retry expiry, context interruptions and queue policies.
Against frozen deployed source, 25 of the 47 scenarios fail. They cover the
behavior above and missing diagnostic fields. The candidate passes all 47.

`tests/poweramp-native-reliability-browser.test.js` uses repository-pinned
Chrome for Testing 154.0.8037.97, real native media elements, the full audio
graph, generated PCM and isolated HTTP fixtures. Its three contracts reproduce
on the frozen source and pass on the candidate: native checkpoint restore,
an intentionally withheld real end followed by a controlled resume notification,
and a real held network body whose seek metadata must retain a recovery deadline.
The freeze fixture explicitly delivers the lifecycle notification; it does not
claim that every OS/browser always delivers it.

Use the pinned Node 22.23.3 runtime and verified browser:

```sh
node scripts/install-qualification-browser.mjs
node --test tests/poweramp-native-reliability.test.js \
  tests/poweramp-native-reliability-browser.test.js \
  tests/poweramp-playback-continuity.test.js \
  tests/poweramp-handoff-recovery.test.js
```

Set `JARVIS_CHROME` to the verified executable. To reproduce the before result,
extract `public/drawercast/player.js` from the deployed commit above and pass
that file as `POWERAMP_PLAYER_SOURCE` to just the two new suites. Source override
runs are reproduction evidence and cannot qualify a release.

The two earlier continuity suites retain their invariants. Their timing checks
now observe the reload after the 800 ms deadline, and the queued-pause case
models a throttled pause task that is genuinely discarded by that delayed load.
Full repository qualification and serial Poweramp performance measurements
remain mandatory publication gates.

## Phone evidence and limits

`PA.PlaybackDiagnostics.report()` remains a detached RAM-only report bounded to
80 entries and less than 32 KB of serialized data.
It now includes playback mode, gapless/crossfade flags, screen-off pause setting,
online hint, bounded recovery phase, buffering elapsed time and spare-slot error
state. Titles, track IDs, URLs, credentials, arbitrary error text and browser
fingerprints remain excluded. The report is not stored or sent automatically.

Chrome/VM tests do not prove Android process survival, physical Samsung audio
focus delivery, carrier/Wi-Fi recovery, lockscreen behavior or every screen-off
case. No lifecycle event is treated as permission to restart a paused song.
Codec failure, closed output and genuine focus interruptions still require user
action. Online is only a browser connectivity hint; the normal one-retry bound
still applies if the service remains unreachable.

On the Samsung phone, play normal R2 with its saved settings across two natural
song boundaries while locked; then exercise lockscreen Pause/Play, a short
network interruption and a call/another media app. Record whether the page was
reloaded and export the bounded report soon after a stop. Intentional Pause and
audio focus must remain respected until explicit Play.

Publication requires a qualified source PR and merge, then the existing
Missionarytube pinned-release checks and deployment. Preserve the current
Relay release and configuration, coordinate the pin with Lucy, and verify live
player bytes against the released source before calling it deployed.
