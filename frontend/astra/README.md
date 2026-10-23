# Astra (new)

The ground-up rebuild of Astra, the media module. It is being built beside
classic Astra (`frontend/media/`), which stays live and untouched until this
one replaces it; then the home tile moves here and `frontend/media/` retires.

Design reference: Nuvio (Android) for screens and behaviour, Stremio's web
client for browser-only details. Both are GPL; nothing is copied from either.

## Layout

| Path | What it is |
| --- | --- |
| `lab/` | Playback lab at `/astra/lab/`: play a link or a stream from your add-ons, see what the file holds and how it plays, switch audio and subtitles, copy a report. |
| `src/engine/` | The playback engine (below). |
| `src/player/` | The full-screen player (Nuvio's layout and gestures): `player-screen.js`, pure gesture rules in `gestures.js`, saved choices in `prefs.js`. |
| `src/app/back-stack.js` | Android back, one history entry per open screen, sheet or menu. |
| `src/ui/` | Icons drawn for Astra and small DOM helpers. |
| `src/subtitles/` | SRT, WebVTT and ASS parsing, and the renderer that draws cues over the video. |
| `src/addons/` | The Stremio add-on protocol client. |
| `src/styles/tokens.css` | Colours, type, radii, motion and shared controls. |
| `vendor/` | Mediabunny and its AC-3 and DTS decoders, copied by `node scripts/astra/vendor.mjs` (see `vendor/LICENSES.md`). |

## How a file plays

`AstraPlayer.load()` (`src/engine/player.js`) does three things, in order, and
never switches pipeline mid-play:

1. **Read before playing** (`probe.js`, `http-source.js`, `mkv.js`). One
   open-ended range request streams the file into a 1 MiB block cache. The
   header gives the container, video codec, every audio track (language,
   codec, channels) and every subtitle track. If the host does not let a web
   page read the file (CORS) or ignores ranges, that is known at once.
2. **Decide once** (`plan.js`, pure and unit-tested). Using answers from the
   browser itself (`capabilities.js`): `native` for a plain one-track
   MP4/WebM or an unreadable host, `remux` for everything else Astra can
   play, `hls`/`dash` for adaptive streams, or `unsupported` with a reason.
   Audio tracks are `direct` (AAC, Opus, FLAC), `rebuilt` (AC-3, E-AC-3,
   DTS, Vorbis, MP3, PCM: decoded and re-encoded to Opus on the device) or
   `unsupported` (TrueHD and other codecs no browser decoder exists for).
3. **Play** (`remux.js`, `mse.js`). Video packets are re-wrapped as
   fragmented MP4 untouched, so the phone's hardware decoder does the work;
   audio has its own SourceBuffer, so changing track refills only the audio.
   Fragments carry absolute timestamps, so a seek outside the buffer starts
   fresh pipelines at the nearest key frame. Text subtitles in MKV are read
   from clusters already downloaded (`embedded-subtitles.js`) and drawn by
   `src/subtitles/renderer.js`.

## The player screen

`new PlayerScreen().open({stream, meta, sources, episodes, next, segments})`
must be called from a tap: it goes full screen and turns to landscape.

- Tap toggles the controls; they hide 3.5 s after the last touch while playing.
- Double tap left or right seeks 10 s; more taps within 0.8 s add 10 s each.
- Horizontal swipe seeks (a full width is 60, 90 or 120 s by length), with a
  preview; vertical swipe on the left changes the picture's brightness (a page
  cannot change the screen's), on the right the volume.
- Hold anywhere but a button plays at 2x until release.
- Lock hides everything; any touch shows "Tap to unlock".
- Menus: audio, subtitles (language, track, delay, size, position, colour,
  background, outline, bold), stream info; side panels for sources and
  episodes. Back closes the menu first, then the player.
- Skip intro/recap/outro from `segments`; the next-episode card appears at
  99% (or when the outro starts) and plays only when tapped.
- Media Session controls, screen kept awake, picture-in-picture where allowed.

## Tests

- `tests/astra-*.test.mjs` (root `npm test`): planner, subtitles, the MKV
  reader, the range reader and the add-on client.
- `backend/tests/astra-playback-browser.test.js` (`npm run test:backend`
  with `JARVIS_CHROME`): real playback in Chrome against synthetic files on a
  separate origin, including audio switching measured by pitch, subtitles,
  seeking, blocked hosts and HEVC refusal.
- `backend/tests/astra-player-browser.test.js`: the player screen at phone
  landscape size: gestures, hold, lock, back order, menus, skip.
- Fixtures: `bash scripts/astra/make-fixtures.sh` regenerates
  `tests/fixtures/astra/` (needs ffmpeg). Each audio track is a sine tone at a
  different pitch.
- Vendored files: `node scripts/astra/vendor.mjs --check`.
