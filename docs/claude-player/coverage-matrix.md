# Reference-to-implementation coverage matrix

Reference: Poweramp build 1031. Evidence IDs (`F..`) refer to the
[research notebook](research-notebook.md). Every planned component maps to a reference component or to
a named technical necessity (`TN`). The status columns describe **reference knowledge**; section 5 records what the
code implements so far.

Status key: `CS` confirmed static · `CR` confirmed runtime · `INF` inferred · `OPEN` unknown ·
`UW` unsupported on the web · `LEGAL` exact reproduction blocked by rights; a substitute is labelled as one.

## 1. First journey: player → library → mini-player

| Reference component | Evidence | Status | Original implementation contract | Milestone | Fidelity limitation / next evidence |
| --- | --- | --- | --- | --- | --- |
| Single player activity / top scene container (`TopNavSceneFastLayout`) | F01, F02 | CS | `SceneGraph` root, one document | M1 | — |
| Scenes `defaultScene`, `scene_playing`, `scene_lib` | F03, F04 | CS | `SceneParams` records + engine | M1 | Runtime timing `OPEN` |
| Scene transition curve and duration law | F05 | CS (code, med-high) | `SceneClock` | M1 | Call-site → duration mapping `OPEN`; needs a device recording |
| Declared timing table (`animMainEnterTime` …) | F07 | CS (declared) | `TimingTable` | M1 | Elapsed time `OPEN` |
| State anims (seeking, pressed) | F04, F06 | CS | `StateAnimClock` | M2 | — |
| One-pass layout (`FastLayout`) | F09 | CS (doc) | `FastLayoutSolver` | M1 | Undocumented edge cases verified by the oracle |
| Window-size buckets | F12 | CS | `QualifierResolver` | M1 | The browser window differs from the app window; basis made explicit |
| Status/navigation bar backgrounds and insets | F02 | CS | `env(safe-area-inset-*)`, `viewport-fit=cover`, `theme-color` | M2 | Bar colour control limited (`UW` partial) |
| Album art bounds (`aa_bounds`) and image | F02 | CS (structure) | `AlbumArt` view, embedded-art extraction | M2 | Cropping rules `OPEN` |
| Album-art swipe ←/→ (track), more (category), ↓ (list), ↑ (lyrics) | F14 | CS (semantics) | `GestureArena` + `AAScroller` | M2 (←/→, ↓), M7 (↑) | Thresholds/physics `OPEN` (F15) |
| Waveseek (scrollable), cursor, pressed/seeking states | F13, F02 | CS (doc) | `Waveseek` canvas + `WaveformAnalyzer` worker | M2 | Analysis algorithm `OPEN` (labelled provisional) |
| Play / pause / play-behind, long press = stop | F02 | CS | `BusActionButton` → `MessageBus` → `PlaybackService` | M2 | — |
| Elapsed / duration labels, long press elapsed = reset to 0:00 | F02, `ui_player.xml` | CS | `Elapsed`/`Duration` views | M2 | — |
| Sub-album-art buttons (shuffle, repeat …, editable) | F02 | CS (structure) | `SubAAButtons` | M2 (fixed set), M7 (editing) | Default button set per layout `OPEN` |
| Track labels (title, line 2), marquee | `ui_player.xml` | CS (options) | `TrackLabels` with marquee | M2 | Marquee speed `OPEN` |
| Navbar container, mini-player pager list, nav buttons | F16 | CS | `Navbar` + pager | M2 | Paging physics `OPEN` |
| Navbar tap → player; swipe ←/→ track; long press → category | F14 | CS | `GestureArena` | M2 | Thresholds `OPEN` |
| Library list widget (`ListWidget`/`PowerList`) | F02 | CS (structure) | `VirtualList` (recycled DOM pool) | M2 (Tracks/Albums/Folders) | Item layouts `OPEN` until analysed |
| A–Z list scroller + indexer popup | F02, `library_lists.xml` | CS | `ListScroller` | M4 | — |
| Message bus (`bus_player_cmd`, `msgId`) | F02 | CS | `MessageBus` | M1 | — |
| Real audio playback, pause/next/previous/seek/completion | F20 | CS (behaviour) | `PlaybackService` over `HTMLAudioElement` | M2 | Native engine `UW` |
| Lock screen / notification controls | manifest, `lockscreen.xml` | CS | Media Session API | M2 | Poweramp's own lock screen `UW`; OS media notification only |
| Background playback | `PlayerService` | CS | Media element + Media Session | M2 | Physical-phone verification required |
| Local music source | `library.xml` (rescan, folders) | CS | `LocalFilesAdapter` (`<input type=file>`), IndexedDB index | M2 | Persistent folder access and rescans `UW` on Android Chrome |
| Persistence of position/queue/settings | `restore_pos` etc. | CS | `Persistence` (IndexedDB, versioned, `claude-player:` namespace) | M2 | — |
| Feature-pack/licence gating | F08, settings | CS | **Not reproduced** (TN: no commerce) | — | Gated features behave as unlocked; noted per setting |

## 2. Configurable appearance families (built-in skins)

| Reference option | Evidence | Status | Contract | Milestone | Limitation |
| --- | --- | --- | --- | --- | --- |
| Skins Light / Black, day/night pairing, Follow Day/Night | F10, F11 | CS | `ThemeComposer` base styles; `prefers-color-scheme` | M2 (Black), M3 (Light, follow) | Default skin on first run `OPEN` |
| Layout: Default / Alt / Alt2 | F11 | CS | Overlay → alternate scene/layout styles | M3 | — |
| Track labels centered; labels background | F11 | CS | Overlay | M3 | — |
| Player buttons background | F11 | CS | Overlay | M3 | — |
| Material You colours (more/less) | F11 | CS | Seed-colour palette from a user-chosen colour | M3 | System wallpaper palette `UW`; the substitute is labelled |
| Font: System / Alt / Bold | F11, F19 | CS | `system-ui` / OFL Manrope / labelled substitute | M2 (Bold substitute), M3 | Bold = TT Norms Pro is `LEGAL` (substitute) |
| Rounded corners more/less | F11 | CS | Corner tokens via overlay | M3 | — |
| Seekbar: Waveseek / Static / Plain with buttons | F11, F13 | CS | `Waveseek` scrollable/fixed, `PlainSeek` | M2 (waveseek), M3 | — |
| More (pro) buttons; Light buttons | F11 | CS | Overlay | M3 | — |
| Knob highlight; graphic FRS colour | F11 | CS | EQ view tokens | M6 | — |
| Navbar background (default/semi/none), offset, force-light | F11 | CS | Overlay | M3 | — |
| Transparent status bar; Android navbar background | F11 | CS | Insets + `theme-color` | M3 | Browser chrome limits (`UW` partial) |
| Album-art background blur/details/intensity/saturation/gradient | F23 | CS | `ArtBackdrop` | M3 | Blur kernel equivalence `OPEN` |
| Animations off / fast / normal | F08 | CS (code) | `animScale` (+ `prefers-reduced-motion`) | M2 | — |
| 3rd-party skins (APK skin packages) | `ui_theme.xml` | CS | — | — | `UW`: cannot load Android skin APKs. Listed, not faked |

## 3. Later feature families (summary)

| Reference family | Evidence | Status | Milestone | Known limitation |
| --- | --- | --- | --- | --- |
| Library categories, list options (sort/zoom), headers with meta, list transitions | F17, F18 | CS / INF | M4 | Transition semantics `INF` |
| Search with category filters | F14, `library_search.xml` | CS | M4 | — |
| Selection menu, multi-select drag | F14 | CS | M4 | — |
| Queue, playlists, shuffle/repeat semantics and settings | `library_queue/shuffle/playlists.xml` | CS | M5 | Playlist file import/export: paths `UW` partial |
| Equalizer (bands, tone, preamp, limiter, reverb, presets) | F20, `audio_equ.xml`, EQ layouts | CS (UI/settings) | M6 | DSP numerics differ from the native engine; documented curves only |
| AutoEQ headphone presets | F22 | CS | — | `UW` within the budget (7.3 MB) |
| Lyrics, sleep timer, rating, meta-info cycling, track menu, toasts | F14, layouts | CS | M7 | — |
| Visualization (MilkDrop presets) | F21 | CS | M8 (decision) | Presets `LEGAL` review; native renderer `UW` |
| Output/DAC/bit-perfect/resampler/DVC/buffer/audio focus | F20 | CS | — | `UW` |
| Headset plug/BT auto-resume, volume-key skip | `headset.xml` | CS | — | `UW` (partial via Media Session buttons only) |
| Widgets, quick-settings tile, Android Auto, Chromecast | F01 | CS | — | `UW` |
| Tag editing and file deletion | dialogs | CS | — | `UW` for picked files on Android |
| Settings export/import | `singlepane.xml` | CS | M7 | Own JSON format; Poweramp backup format `OPEN` (not targeted) |
| Settings breadth (452 keys) | F17 | CS | M3–M7 | Each key gets a status: implemented / UI-only / `UW` / `LEGAL` |

## 4. Technical necessities with no reference component

| TN | Why |
| --- | --- |
| `GestureArena` (pointer ownership, axis lock, cancel, multi-touch invalidation, click-through suppression) | Android's view-system touch dispatch has no browser equivalent |
| `QualifierResolver` window basis | The browser window ≠ the app window (F12) |
| `LocalFilesAdapter` re-pick flow, OPFS opt-in | Android Chrome lacks persistent folder handles |
| Persistence namespace `claude-player:` | No reads or writes to other routes' storage (handoff §5) |
| Original icon set, licensed fonts | Proprietary drawables/fonts cannot ship (F19) |
| CSP meta, route budget | Repo build gates (F25) |

## 5. Implementation status

| Area | Implemented | Substitutes and gaps |
| --- | --- | --- |
| Engine | Resources/qualifiers, theme composition, inflater, FastLayout, SceneParams scenes, FastTextView metrics, drawables as DOM ops | — |
| Player screen | Art pager (tilt, swipe, playing scale), labels, rating/menu buttons, sub-art buttons, waveseek, transport, playing/paused scenes, blurred backdrop | Elapsed/duration pills (F31) and tilt signs `OPEN`; waveform analysis provisional; marquee not yet |
| Library | Home grid (reference order and mask), category lists, track lists, back stack, list item action | Sort/zoom menus, search, selection menu, A–Z scroller not yet |
| Navbar | 1/2/3-line scenes, mini player, seek bar, menu sheet | Logo slot shows the hamburger glyph (trademark logo `LEGAL`) |
| Playback | Local import (folder/files), tags, covers, waveforms, Media Session, resume | m4a/AAC depends on the browser's codecs |
| Settings | Every preference screen from the reference XML: redirects, switches, tag lists, list dialogs, seek bars, notes; skin picker with skin options; settings font option; restore defaults; export/import (own JSON) | Platform Material colours (background, accent, switch) are inferred, not extracted. Purchase/feature-pack rows hidden (no commerce). Colour, knob, tags and text-entry preferences show as plain rows. Settings that change the player theme reload it when settings close (the reference recreates the activity). |
| Equalizer | EQ tab (preamp + ten band knobs, response curve with selection window, spectrum backdrop, Equ/Tone/Limit, tone knobs, presets list, overflow menu), Volume tab (balance, stereo expand, tempo, mono, volume), Reverb tab (seven knobs, reverb on/off); tab paging; Web Audio DSP | DSP numerics inferred (F33); MilkDrop FRS backdrop substituted by a live spectrum; preset save/rename/share/import/export, platform FX and AutoEQ not implemented; knob stacks laid out by intent (F32) |
| Popups | Button-to-menu morph with shade, menu items, preset list | Timing curve inferred (F34) |
| Player menus | Shuffle and repeat mode menus (reference mode enums, play order, repeat semantics); track item menu with go-to artist/album/folder/genre; header Play and Shuffle | Item actions (delete, playlists, info, art) and their dialogs not yet |
| Search | Search panel (native input under the drawn hint), results in list mode, category chips | Chip visibility in `scene_search` follows the layout (gone) |
| Toasts | Upper and lower toast frames; shuffle/repeat mode toasts | Expand/collapse times inferred |
| Long labels | Marquee: lays out at 3000 dp, clips to the text box, scrolls the overflow at 42.5 dp/s with 1500/3000 ms waits (F35) | — |
| Sleep timer | Sub-AA button popup: four-turn knob (0–240 min), relative-time title, play-to-end, Disable/Cancel/OK; player timer (F36) | Playback stops with a plain pause (no fade; reference behaviour not verified) |
| Visualization modes | Vis button popup (none / with UI / full screen), playing-scene choice by mode, full-screen tap shows temporary UI (F37) | No visualization renderer behind it (MilkDrop presets `LEGAL`/`UW`; see §3) |
| A–Z scroller | ListScrollerView modes (A–Z column, thumb), letter bubble, press state animation, section jumps (F38) | `localized_az` alphabets not yet; bubble placement by intent |
| Selection mode | Item select boxes, selection panel with the reference's per-list action layouts, select all/none/range, counts, state-enabled actions, Queue / Play next with insert-mode menus, Share via Web Share (F39) | Playlists, delete, info/tags and album art actions have no handlers yet |
| Not yet | Lyrics, ripple masks, help overlays, item-menu dialogs | — |
