# Claude Player audio quality on Android Chrome

What reaches the speaker when the player streams the R2 library, measured
rather than assumed. This page records the measurement tools, the baseline
of the shipped chain (`main` at `e033d3c`) and the platform facts the fixes
rely on. Later changes update the results table in place.

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
  latency category, state), **dropouts** (`AudioContext.playbackStats`
  underruns: the device asked for audio the renderer did not deliver in time),
  the output level (peaks and reads with clipping, metered once the log has
  been shown), the stream (format, buffered audio, rebuffers, stalls, media
  errors), device and page facts (long tasks, time hidden) and recent events.
  **Copy report** puts the whole log on the clipboard as JSON.
- `tests/claude-player-audio-lab.test.mjs` calibrates the measurements and
  renders the chain; `tests/claude-player-playback-browser.test.mjs` plays
  fixture tracks through the real app (synthetic R2 index, range-capable WAV
  audio) and checks the log.

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
