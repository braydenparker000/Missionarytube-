# Native R2 offline source rejection

The read-only live acceptance pass of Poweramp PR62 observed a remaining gap:
an explicit Next during a short browser-offline interval produced native media
error 4, not error 2. The selected URL had no metadata, the native network state
was `NETWORK_NO_SOURCE`, and Chromium reported `ERR_INTERNET_DISCONNECTED`.
Poweramp treated this as an unsupported source and dropped playback intent.
The same selection played normally after an explicit Play once online.
This does not establish the cause of the Samsung background stops or a
regression introduced by PR62.

This focused repair starts from main
`5259c117a9fad1305f3f5a1caa9cae51fcab323d`, including uploader PR64.
It retains PR62's native lifecycle, checkpoint, buffering and cancellation
behavior. It changes no uploader, Relay, UI, gesture, audio graph, source URL,
dependency, browser pin, deployment configuration or playback option.

## Recovery evidence and bounds

A current R2 HTTP(S) load can retain a RAM-only witness that it started offline
before metadata. An offline event during that same unloaded source can also
establish the witness. It is owned by the selection request, track and media
element/source. Duplicate offline events cannot renew its timestamp.

Error 4 qualifies for the existing R2 recovery only while this witness is at
most 30 seconds old, the element still has no metadata, and its native network
state is `NETWORK_NO_SOURCE`. This also covers a queued error arriving shortly
after online. Metadata or actual native playing retires the witness. An online
unsupported source without this evidence, a decode error, or a failure after
parsed media remains terminal.

The original one-retry budget, 800 ms delay and at most 30 additional seconds
waiting for online still apply. The same clean URL, selected occurrence and any
seek are retained. The reload consumes the witness; genuinely unsupported media
then stops even if connectivity notifications repeat. Expiry requires explicit
Play. Pause, Stop, newer selection and audio-focus/context interruptions cancel
the witness and recovery through the existing request/intent fences.

The existing bounded diagnostics record `r2-load-offline` and
`r2-source-rejected-offline`. The witness's URL and track identifier are not
exported. Reports remain RAM-only, detached, at most 80 entries and under 32 KB.

## Verification

The deterministic regression suite drives the production Engine, transport
wrappers and lifecycle listeners. It checks offline Next, queued error after
online, metadata/playing evidence, finite retry/expiry, later seek, duplicated
events, Pause/Stop, focus/context changes and stale completion after navigation.
The frozen main player fails 15 of the 22 new focused scenarios.

The pinned Chrome 154 suite uses the full native media/audio graph, real
generated PCM, trusted UI taps and actual browser offline/online networking.
It does not assign synthetic media errors. Frozen main fails the offline Next,
Pause-cancellation and unsupported-after-offline-probe contracts. The candidate
must recover the same selected native media online once, respect a real Pause,
and keep actual unsupported bytes terminal after at most one offline probe.
The genuine online unsupported-media control remains terminal on both versions.

Use pinned Node 22.23.3 and checksum-verified Chrome for Testing 154.0.8037.97.
Full Poweramp qualification and all three serial performance plans are release
gates. Frozen render baselines and timing/pixel thresholds are unchanged; only
the explicit candidate source hash is rebound to this player.

These are cloud browser/network tests. They do not prove physical Samsung
lockscreen behavior, Android process survival or audio-focus delivery. The
UI/jobs release owner coordinates the combined source and final deployment pin;
this repair must not deploy independently.
