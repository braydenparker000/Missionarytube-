# Claude Player audio quality on Android Chrome

What reaches the speaker when the player streams the R2 library, measured
rather than assumed. This page records the measurement tools, the platform
facts, the baseline of the original chain (`main` at `e033d3c`) and the
audio engine that replaced it, with both measured by the same scenarios.

## Tools

- **Audio lab** (`scripts/claude-player/audio-lab/`): renders the player's
  real playback chain (`player.js`, `fades.js`, `dsp.js`) on an
  `OfflineAudioContext` in Chrome. Media elements are replaced by buffers that
  start, pause and seek like Chrome's (output cut at once, start at full level,
  configurable start and seek latency); timers and `performance.now()` follow
  render time, and the context time the code sees can lag the render position
  as the main thread's view of a live context does. Scenarios
  (`scenarios.js`) script user actions; `analysis.js` measures sample peak,
  true peak (4× Kaiser-windowed sinc), overs, clicks, level envelopes, THD+N
  and latency.

  ```sh
  JARVIS_CHROME=/path/to/chrome node scripts/claude-player/audio-lab/run.mjs --base origin/main
  node scripts/claude-player/audio-lab/run.mjs --only hot-default --track some-song.opus
  ```

  `--base` runs the same scenarios against another revision side by side;
  `--track` decodes local files with Chrome's own decoder and runs them through
  the clipping scenarios (files are read locally only).
- **Click metric**: click tests play a 440 Hz tone at −12 dBFS and read the
  output above 3 kHz (8th-order Butterworth), where only steps, cuts and
  restarts leave energy. A steady tone reads about −145 dBFS there, a 15 ms
  ramp about −86 dBFS and an instant gain step −50 dBFS. Under −80 dBFS is
  clean; above −65 dBFS is an audible click.
- **Playback log** (on the phone): Settings › Audio › Audio Outputs ›
  Advanced Tweaks › **Audio Outputs Detection Log**, or open the player with
  `?diag`. It shows the output Chrome opened (rate, base and output latency,
  latency category, state, whether the audio engine runs), **dropouts**
  (`AudioContext.playbackStats` underruns: the device asked for audio the
  renderer did not deliver in time), the output level from the engine's
  meters (every sample of the session: peaks, limiter reduction, clipped
  samples and the overs the limiter caught), the stream (format, buffered
  audio, rebuffers, stalls, media errors), device and page facts (long tasks,
  time hidden) and recent events. **Copy report** puts the whole log on the
  clipboard as JSON.
- `tests/claude-player-audio-lab.test.mjs` calibrates the measurements and
  holds every scenario to the results below (no click above −80 dBFS, nothing
  over −1 dBTP with the limiter on, equal-power cross-fades that start with
  the sound); `tests/claude-player-audio-engine.test.mjs` tests the limiter
  and the equalizer bank directly; `tests/claude-player-playback-browser.test.mjs`
  plays fixture tracks through the real app (synthetic R2 index,
  range-capable WAV audio) and checks the engine and the log.

## Source quality

The library index (7,494 tracks, read 2026-10-24):

| Format | Tracks | Notes |
| --- | --- | --- |
| Opus, 48 kHz | 7,434 (99.2%) | 4,785 at 192–255 kbps, 662 at 160–191, 1,714 at 128–159, 189 at 96–127, 84 above 256 |
| AAC (.m4a) | 57 | 50 are served as `audio/mpeg` although they are MP4 |
| FLAC | 2 | |
| MP3 | 1 | |

Opus at 128 kbps and above is transparent for stereo music in published
listening tests, and its native rate is 48 kHz, the usual Android output
rate, so no sample-rate conversion is needed on most phones. The masters are
lossy already; re-encoding to a lossless format would only make files larger.
Source quality is not the limiting factor.

The loudness is. A seeded random sample of 33 tracks, decoded to float with no
clipping (as Chrome does, below): 31 decode with **sample peaks above 0 dBFS**
(median +1.2 dBFS, maximum +3.1 dBFS for Opus and +4.9 dBFS for AAC; true peak
up to +5.2 dBTP), median integrated loudness −7.7 LUFS, some at −3.3 LUFS.
Everything above full scale is clipped by the phone's mixer unless the player
reduces it first.

## Platform facts (Chromium source)

- **Opus decodes to float, unclipped.** `media/filters/opus_audio_decoder.cc`
  calls `opus_multistream_decode_float` into `kSampleFormatF32`; overs reach
  the Web Audio graph intact.
- **Latency category on Android.** `media/audio/android/aaudio_stream_wrapper.cc`:
  `interactive` (the default) opens AAudio in `PERFORMANCE_MODE_LOW_LATENCY`;
  `playback` opens `PERFORMANCE_MODE_POWER_SAVING`. `media/base/audio_latency.cc`:
  `interactive` uses the hardware burst (often 96–256 frames, 2–5 ms per
  callback, at most 512 frames when it is below 128); `playback` uses at least
  20 ms (1,024 frames at 48 kHz). The streams are float.
- **DynamicsCompressorNode is not a limiter.**
  `third_party/blink/renderer/platform/audio/dynamics_compressor.cc`: an
  automatic makeup gain `pow(1 / Saturate(1, k), 0.6)` is applied to all
  audio (+0.57 dB with threshold −1 dB, ratio 20, knee 0), a fixed 6 ms
  pre-delay, a sample-peak (not true-peak) detector and an exponential attack.
- **StereoPannerNode pans, it does not balance.** `stereo_panner.cc`: for
  stereo input and pan < 0, `L = inL + inR·cos θ` and `R = inR·sin θ`, so the
  right channel is moved into the left (up to +6 dB at full left).
- **AudioWorklet runs at real-time priority** in a top-level page
  (`kAudioWorkletThreadRealtimePriority` is enabled by default;
  `realtime_audio_worklet_thread.cc`), rendering through a FIFO whose
  buffering grows after an underrun (`audio_destination.cc`).
- **A media element reaches Web Audio at its stream's own rate** and is
  resampled per element. For `src=` playback the renderer keeps the stream's
  rate (`ComputeStreamOutputConfig`, `media/renderers/audio_renderer_impl.cc`).
  `media_element_audio_source_handler.cc` resamples to the context's rate with
  a `SincResampler` of 64 taps (its request size, a render quantum, is at least
  96 frames), Blackman-windowed, that runs on (pulling silence) while the
  element is paused. A resampled track's start and end therefore ring over 32
  input frames each.
- **`AudioContext.playbackStats`** is stable (`runtime_enabled_features.json5`):
  `underrunEvents`, `underrunDuration`, `totalDuration` and latency figures.

## Baseline results (`main` at `e033d3c`)

Clicks (tone at −12 dBFS, worst output above 3 kHz around the action):

| Action | Click | Cause |
| --- | --- | --- |
| Limiter on / off, DSP off | −26.5 / −36.4 / −36.4 dBFS | the output is rewired between the compressor (6 ms delay, +0.57 dB) and a bypass |
| Parametric preset loaded, band locked, band count changed | −33.2 / −34.8 / −26.1 dBFS | all band filters disconnected and rebuilt (a lock changes nothing audible, yet rebuilds) |
| Reverb size changed while on / reverb switched on | −40.1 / −59.8 dBFS | the convolver's impulse replaced in place |
| Bass knob dragged (100 Hz tone) | −63.0 dBFS (−60.9 with the main thread 10.7 ms behind) | a new IIR filter cross-faded in 20 ms per step |
| Parametric band dragged | −73.9 dBFS | the same, per pointer move |
| Graphic band, EQ off, graphic preset, volume, mono, balance, ReplayGain | −117 to −83 dBFS | ramped parameters: clean |

Fades (the player's own fades on two decks):

| Action | Result |
| --- | --- |
| Pause, resume (400 ms fades) | clean (−109 dBFS) |
| Seek with fade, local file (20 ms seek) | −41.1 dBFS: the fade-in starts before the audio returns |
| Seek with fade, streamed (250 ms seek) | −59.2 dBFS: the fade-in has ended when the audio returns |
| Seek with `fade_seek` off | −26.0 dBFS |
| Next track (default 400 ms cross-fade) | the incoming track is never faded in: full level by the midpoint (+0.6 dB instead of −6 dB); `DeckFader.ramp` reads `gain.value` before the just-scheduled 0 has rendered |
| Next track with 300 ms to first audio | the outgoing track is gone (−52.6 dB) before the incoming starts, unfaded |
| Pause during an automatic cross-fade | −49.2 dBFS: the outgoing deck is cut |
| Track end to the next track (no cross-fade, 300 ms to first audio) | 295 ms of silence: nothing is preloaded |

Clipping (output above full scale clips in the phone's mixer):

| Input | Sample peak / true peak | Samples over 0 dBFS |
| --- | --- | --- |
| Hot master (+3 dBFS peaks), default chain, limiter on | +0.44 dBFS / +0.63 dBTP | 44 in 3.5 s |
| Same, limiter off | +3.0 / +3.0 | 725 |
| Same, bass-boost preset, limiter on | +1.43 / +1.47 | 6,368 |
| Same, preamp +6 dB, bass tone, ReplayGain +6 dB, limiter on | +2.47 / +2.47 | 9,448 |
| Two hot masters, automatic 3 s cross-fade, limiter on | +0.57 / +0.75 | 84 |
| 50 Hz tone at +3 dBFS, limiter on | +0.12, THD+N −44 dB | 19,380 |
| Quiet music through the limiter | +0.57 dB louder, 288 frames (6 ms) late | |
| Real library tracks (4 s excerpts decoded by Chrome), limiter on / off | hottest: +0.49 / +2.67 dBFS, true peak +2.0 / +3.0 dBTP | 292 / 9,875 |

Render cost (20 s offline, this machine; a phone is several times slower):
default chain 47× real time, 31 bands 25×, 64 parametric bands 11×, reverb
at full size 9×, and **10× after reverb is switched off** (the convolver keeps
running with its impulse). With `interactive` latency, a 2–5 ms callback
leaves little margin for that load.

## The audio engine

The native graph was replaced by one AudioWorklet engine
(`src/dsp/engine-worklet.js`): decks → `cp-eq` → `cp-out` → output.

- **Output path**: the context asks for the `playback` latency category
  (Android's power-saving path, at least 20 ms per callback instead of the
  2–5 ms low-latency burst). Measured live by the playback log's dropout
  counter.
- **Equalizer** (`eq-engine.js`): the graphic or parametric bands and the
  tone shelves (with their Q) as one direct-form-I biquad cascade in double
  precision, built from the same maths the curves draw (`filters.js`), so the
  curve is what plays. Every parameter glides: gain in dB and frequency and Q
  logarithmically, with coefficients interpolated per sample. A type or
  channel change passes through 0 dB, where every band type is flat; a
  removed band fades first. Band order, locks and colours change nothing
  audible. A band resting at 0 dB costs nothing.
- **Limiter** (`limiter.js`), at −1 dBTP: a 4× oversampled true-peak
  detector, 2 ms lookahead, 15 ms hold, 120 ms release, and the gain smoothed
  by two moving averages so it reaches what each peak needs as the peak leaves
  the delay line. Below the ceiling it passes audio bit for bit; there is no
  makeup gain; the latency is a constant 103 frames (2.1 ms at 48 kHz), also
  while switched off (with the gapless lookahead below, the engine's is 423
  frames, 8.8 ms). Off, it reduces nothing, and the output stage clamps at
  full scale exactly as the phone's mixer would (most library tracks then
  clip).
- **Fades** run in the engine: cross-fades are equal power and begin when
  the incoming track starts sounding, however long the network took and in
  whichever render block the main thread's messages land; play and seek
  fade-ins begin with the sound (a seek's only once the seek has finished);
  a pause during a cross-fade fades the outgoing track instead of cutting it;
  with the fade settings off, 8 ms fades still keep cuts and starts from
  clicking (fades under 50 ms take an S-curve: an equal-power curve's corner
  clicks when it is that short). A fade that takes over a running one (play
  just after pause) carries on from its slope, so the gain turns without a
  corner.
- **Track changes in a hurry**: Next pressed again before the incoming track
  has sounded gives the new track that deck, and the outgoing track plays on
  until the new one sounds; pressed while both sound, the older track fades
  out over 32 ms before its deck is reused. An automatic cross-fade still
  ends with the outgoing track when the incoming one is late: the outgoing
  fade is shortened by the wait, and gives up waiting in time to fade out.
- **Balance** turns the far channel down instead of panning one channel into
  the other.
- **Reverb**: two convolvers, each on its own faded send from `cp-eq`, with
  the predelay built into the impulse. A new impulse fades in on the free
  convolver while the old one fades out; switched off, the convolvers are
  disconnected and cost nothing.
- **Before the engine has loaded** the decks play straight to the output
  (fades on the elements' volume), so a play pressed early is never silent;
  the engine takes over at the first moment nothing plays (a switch while a
  deck sounds would jump). The context is suspended until something plays,
  also where the page may autoplay.
- **Fallback**: without AudioWorklet, or if the engine stops, the decks play
  through plain gains with no effects (a deck that was fading out is
  silenced); the playback log says which.
- **Service worker**: the app's files come from the network first (one
  consistent version of the modules after a deploy) with a 3 s limit; after
  a failure the offline copies serve at once for a minute, so a bad network
  costs one wait per launch, not one per module.

## Results (baseline → engine)

Same scenarios as the baseline (lab, Chrome 153):

| Scenario | Baseline | Engine |
| --- | --- | --- |
| Limiter on / off, DSP off (click) | −26.5 / −36.4 / −36.4 dBFS | −144.8 (silence floor) |
| Parametric preset / band locked / band count changed | −33.2 / −34.8 / −26.1 | −89.0 / −140.8 / −105.3 |
| Bass knob / parametric band dragged | −63.0 / −73.9 | −138.9 / −135.3 (also with the main thread 10.7 ms behind) |
| Reverb switched on / size changed | −60.1 / −34.5 | −101.0 / −97.8 |
| Seek with fade, local / streamed; seek without fade | −41.1 / −59.2 / −26.0 | −143.3 / −143.3 / −105.3 |
| Pause during a cross-fade | −49.2 | −132.1 |
| Next pressed twice 150 ms apart (300 ms to first audio): short cross-fade / fades off | −24.6 / −43.4 | −101.4 / −96.1 (the first track plays on until the third sounds; before, it was gone) |
| Next with manual fades off | −26.0 (cut) | −98.3 (8 ms S-curve) |
| Play 5 ms after pause, play/pause fades off | −26.0 (gain jump) | −103.3 |
| Automatic 2 s cross-fade into a track ending cold, incoming 600 ms / 1.2 s late | −119.6 / −119.6 | −113.4 / −108.3 (outgoing at −21 / −20 dB at its end) |
| Default cross-fade: incoming at start / midpoint | −6.4 / +0.6 dB (not faded in) | −32.8 / −3.2 dB (equal power) |
| Same, 300 ms to first audio: outgoing at the midpoint | −52.6 dB (gone before the new track) | −2.8 dB |
| Hot master, limiter on: true peak, overs | +0.63 dBTP, 44 | −1.06 dBTP, 0 |
| Bass-boost preset / preamp + tone + ReplayGain stacking | 6,368 / 9,448 overs | 0 / 0 (≤ −1.07 dBTP) |
| Two hot masters cross-fading | +0.75 dBTP, 84 overs | −1.06 dBTP, 0 |
| 50 Hz at +3 dBFS through the limiter: THD+N | −44.1 dB, 19,380 overs | −149.3 dB, 0 |
| Quiet music through the limiter: level, delay | +0.57 dB, 288 frames | 0 dB, 103 frames |
| Balance fully left, tone at −3 dBFS | −0.05 dBFS (channels summed) | −3.0 dBFS |
| Real library excerpts (decoded by Chrome), hottest | +2.03 dBTP, 292 overs | −1.11 dBTP, 0 |

Render cost in real-time multiples (higher is better; the lab's own stepping
is included, so only the ratios mean much): default chain 18 → 27, 31 bands
13 → 32, 64 parametric bands 7 → 17, reverb used and switched off 6 → 26;
reverb at its largest size stays 6 (the convolution itself).

Still open after the engine: nothing is preloaded, so a track that ends
without a cross-fade is followed by the next one's network start (300 ms in
the lab); a long pause keeps the audio thread running. Both are handled
below.

## Reliability

What Chrome does by itself (`resource_multi_buffer_data_provider.cc`): a read
that fails in the middle of a file is retried up to 30 times over about 29 s,
but not one at the file's start, not one a service worker answered, and not a
connection that hangs without failing (a phone moving between networks).
Then the element errors or waits, and the music stops while the player still
said it was playing. The player now handles the rest:

- **Preload** (`player.js`): the next track in play order loads on the idle
  deck a minute before the playing one ends, or once the playing one is
  buffered to its end. At the end it starts there, and a cross-fade into it
  starts without a network wait. When what comes next changes (the queue,
  shuffle, repeat), the new next track loads instead. A track that failed to
  preload is not tried again until the track changes. A preloaded track whose
  offline copy arrives moves to the copy.
- **Offline copies** (`library/audio-cache.js`): what comes next downloads
  whole, one track at a time, at low priority, into Cache Storage, a few
  seconds after a track starts (the start needs the bandwidth).
  - How far ahead depends on the connection: on Wi-Fi the playing track and
    the next 8; on a cellular connection the next 3, since the playing track
    already streams; with Data Saver, none.
  - On a metered connection the next track's preload waits for its copy
    rather than streaming it too, unless the end is near.
  - A copy counts only once its size matches the index.
  - Copies play as blob URLs. These are same origin, so the engine processes
    them.
  - The least recently used copies go when the 512 MB budget or 90% of the
    browser's quota is full. Copies of tracks wanted next, or playing, never
    go. A track that does not fit even then waits, without evicting anything,
    and the others still download.
  - A copy that cannot be read, or one deleted behind the player's back, is
    dropped from the index and downloads again.
  - The playback log shows the copies and has *Delete offline copies*.
- **Recovery** (`player/stream-guard.js`) watches the playing deck:
  - An error, or 10 s without data while online, reloads the track where it
    was: from its offline copy if one has arrived, else from the stream. Tries
    are 1, 2, 4, 8, 15 and then 30 s apart, and the sound fades back in.
  - Offline, a track with no copy gives way to the next one that has a copy.
    Otherwise the player waits for the network and goes on where it was when
    the network returns.
  - The track's own offline copy, when the deck is not on it already, takes
    over at once, online or offline.
  - A file that will not decode: a bad copy is dropped and the stream tried,
    and a stored file is skipped. A file that keeps failing while it answers
    is skipped with *Failed to play*, at most 8 in a row, then the player
    pauses. With repeat one it moves to the next track instead of starting
    the failing one again.
  - A reload keeps the tempo.
- **The system pausing playback** (a call, headphones unplugged, the
  notification's pause): the player follows, and a system resume fades in.
  A play the browser refuses (no gesture yet) leaves the player paused,
  rather than showing it playing in silence.
- **Lock screen**: the Media Session gets the track's length, position and
  rate, so the notification's seek bar runs.
- **Idle**: after 30 s paused, the audio thread sleeps (a phone in a pocket
  no longer wakes every 20 ms to play silence). Play wakes it, and the
  fade-in waits for the sound.

Fixed along the way:
- **Repeat one** played a track once more and then stopped: at the end the
  element is paused, and the seek back did not start it.
- **Next during a pause's fade-out** cut the fading deck (−45.3 dBFS). It now
  fades out over 32 ms (−130.9 dBFS).
- **The service worker's update deleted every other cache on the site**: the
  offline copies, the cover caches and other apps' downloads, such as the
  podcasts app's audio. It now deletes only its own older caches.

Results:

| Check | Before | Now |
| --- | --- | --- |
| Track end to the next track, lab (300 ms to first audio) | 295 ms of silence | 0 ms |
| Track end to the next track, Chrome (local fixture network) | 62 ms of silence, plus the network's time to first audio | 17 ms (Chrome starting a prepared element) |
| Short cross-fade into the next track, 300 ms network | starts 300 ms late (fade-in gated) | starts at once, equal power |
| Network hangs during a seek (Chrome) | silence; nothing reloads the stream | reloaded after 10 s without data, plays on at the seek target |
| Offline in the middle of a track (Chrome) | element errors after about 29 s; silence | waits; plays on where it was when back online |
| Offline at a track change with copies (Chrome) | silence | the next track plays from its copy; a track without a copy gives way to the next one with a copy |

The remaining 17 ms between tracks matters for continuous albums (live
recordings, DJ mixes): the gapless join below closes it.

## Gapless

When the playing track ends with no cross-fade and no silence setting, the
next track follows its last frame exactly, as on a CD:

- **In the engine** (`engine-worklet.js`): each deck plays through a ring
  buffer whose mix point trails the newest frame by 320 frames (6.7 ms at
  48 kHz), so the end of a track is seen before it is heard.
- **Early start, held**: half a second before the end, the player starts the
  preloaded next track. The engine holds it, filling its ring without it
  being heard.
- **The join**: the outgoing deck's input goes exactly silent for 128 frames
  at or after its expected end (the element has delivered its last frame).
  The engine then mixes the held deck from its beginning, on the frame after
  the outgoing track's last one. The new track plays on delayed by however
  early it started, about 0.5 s.
- **Resampled tracks.** The audio context runs at 48 kHz, the library's rate
  (Opus always decodes at 48 kHz), so on any phone its tracks reach the engine
  unresampled and join exactly; Chrome resamples the finished mix once if the
  phone runs at another rate. A track at another rate (an MP3 or AAC at
  44.1 kHz) is resampled on its way in, per element, by Chrome's 64-tap
  SincResampler (`media_element_audio_source_handler.cc`): its start and end
  ring over 32 input frames each. Back to back, two such edges leave a
  14–21-frame near-silence and a click. The engine overlaps ringing edges
  (outermost sample under 10⁻³) by their modelled length, and searches six
  frames either way for the overlap whose sum bends least: each element's
  resampler has its own sub-sample phase, which moves the best overlap by a
  frame. Abrupt (unresampled) edges join back to back.
- **Position**: the player subtracts that delay, at the track's tempo, from
  the position. In the delay's last half-second (the tail) the element has
  already ended while the engine still plays its end; the track ends once the
  tail has been heard.
- **Controls in a delayed track**:
  - A pause drops the delay and steps the element back to what was heard last,
    so nothing heard is skipped or repeated. A pause during the tail steps back
    into the tail; resumed while the pause still fades out, the tail fades back
    in and ends as it would have.
  - A seek drops the delay; during the tail it restarts the element.
  - Next or picking a track during the tail fades it out like any playing
    track.
  - A system pause (a call, headphones unplugged) stops at once: what the
    engine holds fades out in 8 ms, and the element goes back to what was
    heard. In the last tail the only playing element is the held next track;
    its pause counts as the player's.
- **Flushes never click.** Dropping what a deck has not played yet (a pause,
  seek, cancel or reload) fades out what was about to be heard over 8 ms. At a
  track's end the rest of it is heard as it is.
- **Leading and trailing silence are kept.**
  - The next track begins where its deck started: the start message plus the
    decks' start latency, the shortest of the last 8 starts. So its leading
    silence plays, even a silence still going on when the outgoing track ends.
    A first sound within 150 ms of that point is start jitter, and the track
    begins exactly with it. So a leading silence under 150 ms is not kept, but
    a slower start than usual never adds silence.
  - The outgoing track's trailing silence plays out, all but the last 120 ms.
  - Until a start has been seen, the guess is high (250 ms). Early in a
    session a little leading silence may be lost, but no silence is added.
- **When it applies**: not for a cross-fade (`crossfade_auto_advance`), end
  silence (`track_end_silence_ms`), repeat-song, CUE ranges (their ends are
  watched on the element, which runs ahead), or a track that resumes where it
  was left. The join is cancelled when, while the next track is held:
  - the user seeks, pauses or picks another track;
  - what comes next changes (queue, shuffle, repeat, a sleep timer running
    out);
  - or the playing stream stalls or reloads (its silence would look like its
    end).

  The held deck stops and waits at its start again. If the outgoing track
  does not end within the ring (2.5 s), the join is given up and the usual
  end starts the next track. A join the engine made just as the player
  cancelled it is not taken for the next one (each splice has an id).
- **Limits**:
  - 2.7 ms or more of digital silence within a track's last 120 ms, followed
    by more sound, is taken for its end.
  - When nothing plays but the engine's last tail (the end of a gapless run),
    a system pause that Chrome reports to no element plays out up to that
    tail's 0.5 s.
  - Resampled joins are aligned to the frame, not to the sub-sample. Measured
    offline on recorded Chrome output, aligning to the sub-sample would take
    the audible error from about −30 dBFS to under −50 dBFS.

Results:

| Check | Before (preload only) | Gapless |
| --- | --- | --- |
| A continuous recording split into two tracks, lab: gap, click | 0 ms, −93.9 dBFS (edge-faded tones); a cut waveform clicks | 0 ms, −144.8 dBFS (the silence floor: no click) |
| Three tracks back to back, lab | | 0 ms, −144.8 dBFS, level unchanged |
| The same with 300 ms to a stream's first audio, lab | | 0 ms, −144.8 dBFS |
| Start latency 10 ms at one join, 130 ms at the next, lab | | 0 ms, −144.8 dBFS |
| Real Chrome, continuous tone split into two WAV tracks (48 kHz) | 17 ms of silence between them | no gap; the largest bend across the join is the tone's own curvature |
| Real Chrome, the same at 44.1 kHz on the 48 kHz output: audible error (12 kHz low-pass) at the join | back to back: about −7 dBFS, a 17–21-frame near-silence | −30.6 to −40.7 dBFS (overlap 69 frames) |
| Real Chrome, 48 kHz tracks on a 44.1 kHz output | back to back: about −6 dBFS, a 14-frame near-silence | −29 to −46 dBFS (overlap 58–59 frames) |
| Engine, unit tests: a sine split at a non-zero phase; ringing edges with the modelled length 3 frames off | | sample-exact (error < 10⁻⁶) |

Fixed after an adversarial review (lab unless noted):

| Check | Before | Now |
| --- | --- | --- |
| System pause of a joined track (Chrome) | played on about 490 ms | 0–12 ms |
| Seek to the start in the tail | −21.9 dBFS click, then the next track | −102 dBFS; the track plays again |
| Next in the tail | −21.9 dBFS click | −111 dBFS |
| Pause in the tail, play 0.8 s later | the last 0.5 s heard again | not repeated; on to the next track |
| A next track of 0.3 s | heard twice | heard once |
| Start latency 10 ms, then 130 ms | 120 ms of silence added | none |
| 2 ms of digital silence 50 ms before the end | joined there: the end lost, a −21 dBFS click | joined at the end |
| Next track a CUE range of another image | its last 0.5 s lost | plays whole (not joined) |
| Tempo 1.5×: position at the join | 241 ms | 0 ms |
| Next pressed as the engine joins (the engine's report crossing the cancel; dsp unit test) | position 0.5 s off, 378 ms gap at the next join | the stale report is dropped |
| Sleep timer (to the end of the track) running out while held | the next track heard for a moment | not heard |
