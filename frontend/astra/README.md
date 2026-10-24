# Astra (new)

The ground-up rebuild of Astra, the media module. The home tile opens it.
Classic Astra (`frontend/media/`) is retired. Its software decoder (libmedia)
lives on in `frontend/assets/libmedia/`, and My Media hands files Chrome
refuses to this engine.

Design reference: Nuvio (Android) for screens and behaviour, Stremio's web
client for browser-only details. Both are GPL; nothing is copied from either.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `src/main.js` | The app at `/astra/`. Installable (`manifest.webmanifest`); `sw.js` opens it from a saved copy (below). |
| `src/app/` | `app.js` (tabs, screen stack, playing a stream), `store.js` (saved data under `astra.v2.*`), `content.js` (rows, hero, what Play means), `cache.js` (add-on answers kept between visits), `back-stack.js` (Android back, one history entry per open screen, sheet or menu). |
| `src/screens/` | Home, Details, Streams, Catalog ("View all"), Search and Discover, Library, Settings. |
| `lab/` | Playback lab at `/astra/lab/`: play a link or a stream from your add-ons, see what the file holds and how it plays, switch audio and subtitles, copy a report. |
| `src/engine/` | The playback engine (below). |
| `src/player/` | The full-screen player (Nuvio's layout and gestures): `player-screen.js`, pure gesture rules in `gestures.js`, saved choices in `prefs.js`. |
| `src/ui/` | Icons drawn for Astra, poster cards, the long-press lift menu, sheets, toasts and small DOM helpers. |
| `src/subtitles/` | SRT, WebVTT and ASS parsing, and the renderer that draws cues over the video. |
| `src/addons/` | The Stremio add-on protocol client, and TorBox link resolution (`debrid.js`). |
| `src/styles/tokens.css` | Colours, type, radii, motion and shared controls. |
| `vendor/` | Mediabunny and its AC-3 and DTS decoders, copied by `node scripts/astra/vendor.mjs` (see `vendor/LICENSES.md`). |

## The app

- Four tabs (Home, Search, Library, Settings) stay alive, so switching keeps
  each one's scroll; the floating nav shrinks to icons once a page scrolls.
  Back from another tab returns to Home; back on Home leaves the app.
  Every open screen, sheet and menu is one history entry (`back-stack.js`);
  a screen opened while a menu is closing waits for that menu's entry to go,
  and a reload on an open screen first returns the history to Home.
- Long-press opens one menu (Android's own long-press is folded into it), and
  the release of that press never taps an item. Sheets (Nuvio's floating
  card) close with a drag on their top, following the finger, or a quick
  flick.
- Anything that removes or replaces what you have (remove or replace an
  add-on, clear Continue Watching, copy again from classic Astra, reset
  Astra's data) asks first in a centred dialog, Cancel beside the action
  (`confirm()` in `src/ui/components.js`). Back, Escape or a tap outside
  cancel; a second tap on the action, or on a sheet row, runs nothing.
- Page headers stay at the top while their page scrolls (Library, Settings
  and its pages, View all, and Streams' add-on chips).
- **Home**: a hero of up to eight titles with art that turns every 8 s (or
  by swipe), Continue Watching, then one row per add-on catalog that needs no
  search text. Long-press any poster to save it or mark it watched.
- **Details**: Play says what it will do (Play, Resume, Play S1 E2,
  Upcoming). Series open on the season of the next unwatched episode. The
  page draws at once from the card that was tapped (its art, title and, when
  the catalog has it, the description) and fills in when the full details
  arrive; the hero art is kept, not re-faded. The story shows three lines;
  "Show more" appears only when that cuts it, at any width, and a tap on the
  story opens it too.
- **Streams**: every add-on is asked at once and fills in as it answers, in
  the add-ons' own order, with a chip per add-on. Each add-on's section holds
  its place with placeholder cards while it is asked and is filled in place,
  so cards already on screen never move to a new element under the finger.
  Continue Watching opens Streams at once from what was saved. Nothing is
  ranked or picked for you. Long-press a stream to copy it, open it in VLC or check it in the
  lab. TorBox links from add-ons are resolved to the file just before play.
- **Nothing plays without a tap.** The next-episode card and skip buttons are
  taps; there are no countdowns.
- Progress is saved every 10 s while playing, and on pause, close and leaving the app. Streams under 121 s are
  placeholder clips and are not tracked. At 90% a title counts as watched and
  Continue Watching offers the next episode instead.
- **Settings**: appearance, which catalogs Home shows, add-ons (install,
  enable, reorder, configure, remove), playback defaults (preferred audio and
  subtitle language, subtitle style) and your data (export, restore, clear).
  Install takes what people paste (`stremio://`, a `/configure` page, a
  trailing slash or `#…`), installs on Enter, ignores a second tap while
  checking, and offers to replace an add-on already installed from another
  address (same manifest id). Each add-on says Loading…, Active, or why it
  could not load, with Retry.

## When add-ons misbehave

- **At the boundary**: `fetchManifest` normalises every manifest
  (`normaliseManifest`: catalogs, extras, resources, types and id prefixes
  are arrays; catalogs without an id and type are dropped) and `normaliseMeta`
  every title (names as string lists, season and episode as numbers or null,
  unreadable dates dropped and counted as aired). Home, Search and Discover
  also skip, one add-on at a time, anything that still fails.
- **Failures are shown, not hidden**: a Home row whose catalog fails keeps
  its title with "Couldn't load this row · Retry"; Streams marks an add-on
  that did not answer and offers Retry for it alone; Search says "Couldn't
  search" when every add-on failed, and names the add-ons still being waited
  for once others have answered; Details says "Couldn't load details" (Play
  waits for a series' episodes) and tries again when the add-ons or the
  connection come back. Browser errors read as sentences ("The add-on took
  too long", "The add-on answered 404"; `addonError` in `client.js`).
- A series whose videos have no seasons (channels) lists them under Videos.
- On first launch Astra copies add-ons, library and progress from classic
  Astra (`astra.v1.*`) once, and leaves the classic data as it was.

## Opening fast

- **A saved copy of the app** (`sw.js`, over https). A release of Astra is the
  Git tree of `frontend/astra` named in the site's `/release.json`. The first
  visit saves the files it loaded under that release; later visits open from
  the saved copy, offline too, and look for a newer release in the
  background (one small request). A newer release is saved whole before open
  pages are told; they offer **Reload** and never mix files from two releases.
  On a local `http` server the worker is off unless `localStorage`
  `astra.dev.sw` is `1`.
- **Add-on answers are kept** (`src/app/cache.js`, Cache Storage
  `astra-data-v1`). Manifests (6 h), Home's catalogs (30 min) and title pages
  (12 h) paint at once from the last answer while a fresh one is fetched;
  Home redraws only the rows that changed, keeping where they were scrolled.
  Entries unused for a week are dropped.
- **Nothing waits on a slow add-on.** Manifests have 6 s; Home starts 2.5 s
  after the first one answers and adds the rest as they come. Catalogs load
  four at a time, title pages ask every add-on at once. When no add-on
  answers, Home says so with Retry, and tries again when the phone is back
  online.
- **Only the start-up code loads at start-up.** `index.html` preloads the
  modules `main.js` imports (`tests/astra-startup.test.mjs` keeps the list
  exact); the player and the engine load on the first Play, fetched early
  while Details or Streams is open.

## Saved data

Everything is kept in this browser under `astra.v2.*` (`src/app/store.js`).

- Each saved value is checked when read: a damaged entry is dropped and a
  value of the wrong shape counts as unsaved, so one bad value cannot stop
  the app. If Astra still cannot start, a card (`src/app/recovery.js`)
  offers **Export raw data** (what is stored, as text) and **Reset Astra
  data** (removes only `astra.v2.*`; classic Astra's data stays and is
  copied again, as on a first launch).
- A backup holds add-ons, library, progress, watched, settings and recent
  searches.
- **Restore** (Settings > Your data) checks the whole file first. A file that
  isn't an Astra backup, or has a part of the wrong shape, is refused and
  nothing changes; damaged entries inside a good part are skipped and
  counted. Otherwise it replaces this device's data all or nothing: what the
  backup lacks is removed. Player choices, Library layout and sort, and the
  last stream filter stay, because they describe this phone rather than what
  you saved or watched. The message says what came back.
- After a restore or "Copy again from classic Astra" nothing is written until
  the reload, and progress is only written when there is something new to
  save, so leaving the page cannot undo either.
- Two Astra windows (the installed app and a Chrome tab) share the data. Each
  follows the other's changes, and a write changes only its own entries in
  what is stored now: progress entry by entry (the later save wins), add-ons
  by addition, removal, switch and order.
- When the browser cannot save (storage full, or site data blocked) Astra
  says so once instead of failing silently; with site data blocked it still
  opens.

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
   play, `software` when the phone has no browser decoder for the video
   (HEVC, AV1 or VP9 without hardware support, 10-bit H.264) or Mediabunny
   cannot read the container (AVI, FLV, MPEG-PS), `hls`/`dash` for adaptive
   streams, or `unsupported` with a reason and an offer to play the file in
   another app. Audio tracks are `direct` (AAC, Opus, FLAC), `rebuilt` (AC-3,
   E-AC-3, DTS, Vorbis, MP3, PCM: decoded and re-encoded to Opus on the
   device) or `unsupported` (TrueHD and other codecs no browser decoder
   exists for); a file with only unplayable audio can be played without
   sound when the viewer asks. Dolby Vision profiles are read from the MKV
   header and explained (profile 5 has no standard picture underneath).
3. **Play** (`remux.js`, `mse.js`). Video packets are re-wrapped as
   fragmented MP4 untouched, so the phone's hardware decoder does the work;
   audio has its own SourceBuffer, so changing track refills only the audio.
   Fragments carry absolute timestamps, so a seek outside the buffer starts
   fresh pipelines at the nearest key frame. Text subtitles in MKV are read
   from clusters already downloaded (`embedded-subtitles.js`) and drawn by
   `src/subtitles/renderer.js`. Files whose timestamps start after zero
   (MPEG-TS) are shifted to start at 0:00.
4. **Software decoding** (`software.js`): libmedia's AVPlayer (LGPL-3.0,
   served from `frontend/assets/libmedia/`, loaded only when needed) decodes with
   WebCodecs where the browser has the decoder and WebAssembly otherwise,
   into a MediaStream on the same `<video>`, reading through the same range
   reader. The session gives the element the file's clock, so the player,
   subtitles and picture-in-picture work unchanged. If Astra's own unpacking
   or Chrome fails to decode before the first frame, playback switches to it
   once by itself.
5. **Another app**: when nothing in the browser can play a file, the player
   offers it to the phone's video apps (VLC, MX Player…) through an Android
   intent with the title and position (`src/player/external.js`).

## The player screen

`new PlayerScreen().open({stream, meta, sources, episodes, next, segments})`
must be called from a tap: it goes full screen. It follows the phone's
rotation unless Settings > Playback > Rotation says Landscape or Portrait;
the rotate button in the top bar switches until the player closes (and says
so where the screen cannot be turned, as on a desktop). In
portrait the picture is a band across the middle; when there is room,
subtitles sit in the black under it. With the controls showing, bottom
subtitles, Skip and the next-episode card are placed from the controls'
measured height, so nothing covers the title or the buttons.

- Tap toggles the controls; they hide 3.5 s after the last touch while playing.
- Double tap left or right seeks 10 s; more taps within 0.8 s add 10 s each.
- Horizontal swipe seeks (a full width is 60, 90 or 120 s by length), with a
  preview; vertical swipe on the left changes the picture's brightness (a page
  cannot change the screen's), on the right the volume.
- Hold anywhere but a button plays at 2x until release.
- Lock hides everything; any touch shows "Tap to unlock" and how far along
  playback is.
- Sound turned all the way down shows a "Sound off" chip in the corner; a tap
  turns it back on.
- Menus: audio, subtitles (a Tracks tab with language and track; a Style tab
  with delay, size, position, colour, background, outline and bold, which
  leaves the picture showing so changes can be seen), stream info; side
  panels for sources and episodes, opened at the current one. Back closes the
  menu first, then the player; on a phone in full screen, Android's back
  (which leaves full screen) does the same, and does nothing while locked.
- With a keyboard, a menu takes focus and Escape gives it back; the app
  behind the player cannot be reached while it is open.
- Skip intro/recap/outro from `segments`; the next-episode card appears at
  99% (or when the outro starts) and plays only when tapped. An episode not
  out yet says when it is out, and Next does not play it.
- Picture-in-picture (top bar): the video moves to Android's floating window
  and the app can be used; expanding the window brings the player back (also
  after pausing in the window), closing it ends playback. Leaving Astra while playing opens it by itself
  where Chrome allows (Settings > Playback > Picture-in-picture). Android leaves full screen on the way
  into and out of the window; those changes are not taken for the back button.
- A load that runs past 5 s shows how long and how much has arrived; past 10 s it says what it is
  waiting on (the debrid service, a host that has not answered, or a slow one) and offers the other
  sources and another app.
- Waiting for data shows a spinner of its own after 400 ms; the controls
  stay as they were.
- A lost connection is retried for up to a minute (at once when the phone is
  back online) while the buffer plays, with "Reconnecting…"; only then does
  the player stop, offering Try again from where it stopped. A dead link
  (404/410) asks for another source; a host that does not answer in 15 s
  says so. Another app is offered only for files the browser cannot play.
- Media Session controls, screen kept awake.
- Unpacking a file gives the page a turn every 8 ms, so taps (Close
  included) answer while a film starts.
- While a file is being described, Astra reads only 2 MB ahead of what it
  asked for; resuming halfway then closes the connection at the start, so it
  does not share the phone's bandwidth with the one that is needed.

## Subtitles

- **Add-ons**: every add-on with a `subtitles` resource is asked, plus
  OpenSubtitles v3 unless turned off in Settings > Playback. When Astra can
  read the file it sends the OpenSubtitles hash and size (`file-hash.js`), so
  subtitles timed for that exact release are marked "Exact match" and come
  first. Files are downloaded only when chosen (`src/addons/subtitles.js`).
- **Inside the file**: SRT, ASS and WebVTT in MKV; PGS (Blu-ray) and VobSub
  (DVD) picture subtitles in MKV (`src/subtitles/pgs.js`, `vobsub.js`); 3GPP
  timed text and WebVTT in MP4 (`src/engine/mp4.js`). They are read from data
  the video pipeline already downloaded (`embedded-subtitles.js`), block by
  block as it arrives, so seeking works with or without a cue index.
- **In adaptive streams**: an HLS or DASH stream's own subtitle tracks are
  listed; hls.js and dash.js load them and Astra copies each cue once into
  its own renderer, so they take the same style as every other subtitle.
- **From the phone**: the subtitles menu can load an .srt, .vtt or .ass file.
- The remembered language is shown by itself: the file's own track first,
  then an exact match, then the first add-on file. Choosing Off forgets it.
- Old code pages (Cyrillic, Arabic, Central European and others) and UTF-16
  files are decoded by language, from add-ons' two- or three-letter codes.
- A file's format is read from its first line (an .srt named
  "Glass.Onion" stays SRT); a file one reader finds empty is offered to the
  others. A host that blocks reading the file is said in the subtitles menu
  (add-on subtitles still work).

## Tests

- `tests/astra-*.test.mjs` (root `npm test`): planner, subtitles (text and
  picture decoders, the MP4 reader, the block scanner, the file hash, add-on
  subtitles), the MKV reader, the range reader, the add-on client, saved
  data (`astra-store.test.mjs`: sanitising, restore, two windows, saving
  only what changed), rows and the Play button.
- `backend/tests/astra-playback-browser.test.js` (`npm run test:backend`
  with `JARVIS_CHROME`): real playback in Chrome against synthetic files on a
  separate origin, including audio switching measured by pitch, subtitles,
  seeking, blocked hosts and HEVC refusal. The HLS subtitle test runs when
  `ASTRA_HLS_JS` names a local copy of the pinned `hls.min.js` (tests never
  reach the CDN).
- `backend/tests/astra-player-browser.test.js`: the player screen at phone
  landscape size: gestures, hold, lock, back order, menus, skip; and in
  portrait: rotation settings, the rotate button, picture-in-picture.
- `backend/tests/astra-shell-browser.test.js`: Android back in the awkward
  cases, long-press and sheet dragging with real touch input, and the
  confirm dialog (back, Escape, focus, one run per choice).
- `backend/tests/astra-app-browser.test.js`: the app at phone portrait size
  against a fixture add-on (`backend/tests/helpers/astra-media-server.js`):
  Home, back, Continue Watching, the lift menu, Library, episodes, paging,
  Search, add-on settings, the classic import, add-on subtitles, the saved
  copy (offline start, a new release announced), backup restore, damaged and
  blocked storage, the recovery card and two windows at once, and
  misbehaving add-ons (`/broken`, `/flaky`, `/small` on the fixture server:
  a malformed manifest, failing streams and meta, five-item pages, a
  seasonless channel).
- `tests/astra-addon-data.test.mjs`: manifest and metadata normalisation,
  pasted addresses, and how failed requests are described.
- Fixtures: `bash scripts/astra/make-fixtures.sh` regenerates
  `tests/fixtures/astra/` (needs ffmpeg). Each audio track is a sine tone at a
  different pitch.
- Vendored files: `node scripts/astra/vendor.mjs --check`.
