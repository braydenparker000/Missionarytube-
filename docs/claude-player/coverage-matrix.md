# Reference-to-implementation coverage matrix

Reference: Poweramp build 1031. Evidence IDs (`F..`) refer to the
[research notebook](research-notebook.md). Every planned component maps to a reference component or to
a named technical necessity (`TN`). The status columns describe **reference knowledge**; the Build column and section 5 record what the
code implements.

The **Build** column is this audit's status against the code: `Built` (implemented and exercised in
headless Chromium; gesture rows with CDP touch events), `Partial`, `Not built`, `UW` or a skip by
owner decision. Nothing here is device-verified.

Status key: `CS` confirmed static · `CR` confirmed runtime · `INF` inferred · `OPEN` unknown ·
`UW` unsupported on the web · `LEGAL` exact reproduction blocked by rights; a substitute is labelled as one.

## 1. First journey: player → library → mini-player

| Reference component | Evidence | Status | Original implementation contract | Milestone | Fidelity limitation / next evidence | Build |
| --- | --- | --- | --- | --- | --- | --- |
| Single player activity / top scene container (`TopNavSceneFastLayout`) | F01, F02 | CS | `SceneGraph` root, one document | M1 | — | Built |
| Scenes `defaultScene`, `scene_playing`, `scene_lib` | F03, F04 | CS | `SceneParams` records + engine | M1 | Runtime timing `OPEN` | Built |
| Scene transition curve and duration law | F05 | CS (code, med-high) | `SceneClock` | M1 | Call-site → duration mapping `OPEN`; needs a device recording | Built |
| Declared timing table (`animMainEnterTime` …) | F07 | CS (declared) | `TimingTable` | M1 | Elapsed time `OPEN` | Built |
| State anims (seeking, pressed) | F04, F06 | CS | `StateAnimClock` | M2 | — | Built |
| One-pass layout (`FastLayout`) | F09 | CS (doc) | `FastLayoutSolver` | M1 | Undocumented edge cases verified by the oracle | Built |
| Window-size buckets | F12 | CS | `QualifierResolver` | M1 | The browser window differs from the app window; basis made explicit | Built |
| Status/navigation bar backgrounds and insets | F02 | CS | `env(safe-area-inset-*)`, `viewport-fit=cover`, `theme-color` | M2 | Bar colour control limited (`UW` partial) | Built |
| Album art bounds (`aa_bounds`) and image | F02 | CS (structure) | `AlbumArt` view, embedded-art extraction | M2 | Cropping rules `OPEN` | Built |
| Album-art swipe ←/→ (track), more (category), ↓ (list), ↑ (lyrics) | F14, F15, F48 | CS (bytecode) | `ListWidget` pager + `ListTransition` | M2 (←/→, ↓), M7 (↑) | Shared item view hand-off not reproduced | Built: ←/→, ↓, ↑, tap and "swipe more" category change with decor pages, reference physics (F15, F48, F52); shared item hand-off not reproduced |
| Waveseek (scrollable), cursor, pressed/seeking states | F13, F02 | CS (doc) | `Waveseek` canvas + `WaveformAnalyzer` worker | M2 | Analysis algorithm `OPEN` (labelled provisional) | Built |
| Play / pause / play-behind, long press = stop | F02 | CS | `BusActionButton` → `MessageBus` → `PlaybackService` | M2 | — | Built |
| Elapsed / duration labels, long press elapsed = reset to 0:00 | F02, `ui_player.xml` | CS | `Elapsed`/`Duration` views | M2 | — | Partial (placement F31) |
| Sub-album-art buttons (shuffle, repeat …, editable) | F02 | CS (structure) | `SubAAButtons` | M2 (fixed set), M7 (editing) | — | Built: every web-feasible button kind and editing (F62) |
| Track labels (title, line 2), marquee | `ui_player.xml` | CS (options) | `TrackLabels` with marquee | M2 | Marquee speed `OPEN` | Built; line 2 tap/long press built (F49) |
| Navbar container, mini-player pager list, nav buttons | F16, F15 | CS | `Navbar` + `MiniPlayerList` pager | M2 | — | Built (pager, F15; category decor and overscroll, F52) |
| Navbar tap → player; swipe ←/→ track; long press → category | F14, F15 | CS | `MiniPlayerList` | M2 | — | Built |
| Library list widget (`ListWidget`/`PowerList`) | F02 | CS (structure) | `VirtualList` (recycled DOM pool) | M2 (Tracks/Albums/Folders) | Item layouts `OPEN` until analysed | Built |
| A–Z list scroller + indexer popup | F02, `library_lists.xml` | CS | `ListScroller` | M4 | — | Built |
| Message bus (`bus_player_cmd`, `msgId`) | F02 | CS | `MessageBus` | M1 | — | Built |
| Real audio playback, pause/next/previous/seek/completion | F20 | CS (behaviour) | `PlaybackService` over `HTMLAudioElement` | M2 | Native engine `UW` | Built; fades, crossfades and end-of-track silence over two media decks (F70, curves inferred) |
| Lock screen / notification controls | manifest, `lockscreen.xml` | CS | Media Session API | M2 | Poweramp's own lock screen `UW`; OS media notification only | Built (device unverified) |
| Background playback | `PlayerService` | CS | Media element + Media Session | M2 | Physical-phone verification required | Built (device unverified) |
| Local music source | `library.xml` (rescan, folders) | CS | `LocalFilesAdapter` (`<input type=file>`), IndexedDB index | M2 | Persistent folder access and rescans `UW` on Android Chrome | Built |
| Persistence of position/queue/settings | `restore_pos` etc. | CS | `Persistence` (IndexedDB, versioned, `claude-player:` namespace) | M2 | — | Built |
| Feature-pack/licence gating | F08, settings | CS | **Not reproduced** (TN: no commerce) | — | Gated features behave as unlocked; noted per setting | Not reproduced (by design) |

## 2. Configurable appearance families (built-in skins)

| Reference option | Evidence | Status | Contract | Milestone | Limitation | Build |
| --- | --- | --- | --- | --- | --- | --- |
| Skins Light / Black, day/night pairing, Follow Day/Night | F10, F11 | CS | `ThemeComposer` base styles; `prefers-color-scheme` | M2 (Black), M3 (Light, follow) | Default skin on first run `OPEN` | Built: skins; Follow Day/Night (F56) |
| Layout: Default / Alt / Alt2 | F11 | CS | Overlay → alternate scene/layout styles | M3 | — | Built (overlay; not checked per option) |
| Track labels centered; labels background | F11 | CS | Overlay | M3 | — | Built (overlay; not checked per option) |
| Player buttons background | F11 | CS | Overlay | M3 | — | Built (overlay; not checked per option) |
| Material You colours (more/less) | F11 | CS | Seed-colour palette from a user-chosen colour | M3 | System wallpaper palette `UW`; the substitute is labelled | Not built (no seed-colour substitute) |
| Font: System / Alt / Bold | F11, F19 | CS | `system-ui` / OFL Manrope / TT Norms Pro | M2, M3 | TT Norms Pro used with the owner's permission (private, non-commercial) | Built |
| Rounded corners more/less | F11 | CS | Corner tokens via overlay | M3 | — | Built (overlay; not checked per option) |
| Seekbar: Waveseek / Static / Plain with buttons | F11, F13 | CS | `Waveseek` scrollable/fixed, `PlainSeek` | M2 (waveseek), M3 | — | Partial: waveseek built; Static/Plain overlays unchecked |
| More (pro) buttons; Light buttons | F11 | CS | Overlay | M3 | — | Built (overlay; not checked per option) |
| Knob highlight; graphic FRS colour | F11 | CS | EQ view tokens | M6 | — | Built (overlay; not checked per option) |
| Navbar background (default/semi/none), offset, force-light | F11 | CS | Overlay | M3 | — | Built (overlay; not checked per option) |
| Transparent status bar; Android navbar background | F11 | CS | Insets + `theme-color` | M3 | Browser chrome limits (`UW` partial) | Partial (browser limits) |
| Album-art background blur/details/intensity/saturation/gradient | F23 | CS | `ArtBackdrop` | M3 | Blur kernel equivalence `OPEN` | Built (approximation) |
| Animations off / fast / normal | F08 | CS (code) | `animScale` (+ `prefers-reduced-motion`) | M2 | — | Built |
| 3rd-party skins (APK skin packages) | `ui_theme.xml` | CS | — | — | `UW`: cannot load Android skin APKs. Listed, not faked | UW |

## 3. Later feature families (summary)

| Reference family | Evidence | Status | Milestone | Known limitation | Build |
| --- | --- | --- | --- | --- | --- |
| Library categories, list options (sort/zoom), headers with meta, list transitions | F17, F18 | CS / INF | M4 | Transition semantics `INF` | Partial: categories, list options and headers built; list transitions built (F48 zooms, F53 pinch, F54 header/item morphs) except the shared item hand-off and the title morph |
| Search with category filters | F14, `library_search.xml` | CS | M4 | — | Built: the reference's ten categories with scrolling chips, toggle and long-press filter (F55); word matching, per-kind subheaders, Play through the Queue and search history (F64). Search zoom levels and targeted search not built |
| Selection menu, multi-select drag | F14, F59 | CS | M4 | — | Built: selection menu; drag reorder and multi-select drag (F59) |
| Queue, playlists, shuffle/repeat semantics and settings | `library_queue/shuffle/playlists.xml` | CS | M5 | Playlist file import/export: paths `UW` partial | Partial: the Queue with its start, end, clearing, insert and shuffle settings (F65); drag reordering built (F59); re-sort, playlist file import and export (F66) |
| Equalizer (bands, tone, preamp, limiter, reverb, presets) | F20, `audio_equ.xml`, EQ layouts | CS (UI/settings) | M6 | DSP numerics differ from the native engine; documented curves only | Partial (F33); presets: search, filters, sections, selection actions, Save/Rename/Share/Export/Import/Restore, Auto Save and Lock (F67); knob values, value dialogs, Tone and band settings (F68); reverb presets with Save, Rename, Delete and Restore (F69) |
| AutoEQ headphone presets | F22 | CS | — | `UW` within the budget (7.3 MB) | Not built (UW) |
| Lyrics, sleep timer, rating, meta-info cycling, track menu, toasts | F14, layouts | CS | M7 | — | Built: meta-info cycling (F51), rating taps/swipes/long press (F57), lyrics dialog (F61) |
| Visualization (MilkDrop presets) | F21, F41 | CS | M8 (decision: butterchurn) | Owner-approved substitute (butterchurn + its preset pack, MIT); native renderer `UW` | Built (butterchurn) |
| Output/DAC/bit-perfect/resampler/DVC/buffer/audio focus | F20 | CS | — | `UW` | UW |
| Headset plug/BT auto-resume, volume-key skip | `headset.xml` | CS | — | `UW` (partial via Media Session buttons only) | UW |
| Widgets, quick-settings tile, Android Auto, Chromecast | F01 | CS | — | `UW` | UW |
| Tag editing and file deletion | dialogs | CS | — | `UW` for picked files on Android | Skipped (owner decision) |
| Settings export/import | `singlepane.xml` | CS | M7 | Own JSON format; Poweramp backup format `OPEN` (not targeted) | Built |
| Settings breadth (452 keys) | F17 | CS | M3–M7 | Each key gets a status: implemented / UI-only / `UW` / `LEGAL` | Partial: every key has a status in `settings-status.md` (guarded by `tests/claude-player-pref-status.test.mjs`); 35 web-feasible keys not built yet |

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
| Engine | Resources/qualifiers, theme composition (incl. `android:theme` overlays), inflater, FastLayout (flex, consume, attach, gravity), SceneParams scenes, FastTextView metrics, drawables as DOM ops, ripples from the touch hotspot | Layout inferences I1 |
| Player screen | Art pager (tilt, playing scale) with the reference pager physics (F15). Swipe ↓ / tap → the track's source list, swipe ↑ → lyrics, with the move transitions and the top scene following the drag (F48), elastic without a target. Labels with marquee; line 2 tap/long press and menu-button long press (F49); like/unlike or stars, menu, sub-art buttons, waveseek, transport, playing/paused scenes, blurred backdrop; art "swipe more" category change (F52); meta-info cycling (F51); star rating taps, swipes and long press (F57); sub-art button editing (F62) | Elapsed/duration pills (F31) and tilt signs `OPEN`. Not built: long press between buttons (edit; a paid feature-pack feature in the reference, owner decision needed); meta output line is a substitute |
| Library | Home grid (reference order and mask); category, statistics and track lists; back stack with remembered scroll; list item action; header menus; List Options (sort, reverse, View as, titles only, compact header, Max Items, Min Duration, home and search categories, start category; F46, F63); Clear / Show All on the statistics lists; reference track labels, number types, split categories, album joining and article-free sort (F63); reference list scrolling and fling (F15); side swipe → parent level; zoom page transitions for opening, going back and player/library/lyrics changes (F48); header-to-item / item-to-header morphs (F54); pinch-to-zoom between "View as" levels (F53) | The shared item hand-off and the title morph not built; list memory not built |
| Navbar | 1/2/3-line scenes, mini player pager (swipe ←/→ changes track, tap → player, long press → the track's source list; F15), seek bar, menu sheet with drag to collapse (F60); category decor pages and category overscroll (F52) | Logo slot shows the hamburger glyph (trademark logo `LEGAL`) |
| Playback | Local import (folder/files, tags incl. large MP4/FLAC/Ogg blocks), R2 library (index snapshot, 12 h refresh, streaming by range), Media Session, resume, the Queue (queue mode, start/end rules, Play next / Add to queue / insert modes; F65), play/pause/seek fades, manual and automatic crossfades, end-of-track silence (F70) | m4a/AAC depends on the browser's codecs; fade curves inferred (native pipeline) |
| Covers | Local embedded art; R2 Worker images when indexed, else read from the audio file by byte ranges (3 slots, 150 ms row settle, "no cover" markers); Cache Storage covers and 256 px thumbnails; picked images per track or album (F45) | No online album-art search |
| Waveforms | Index waveforms (inline base64 or DCW1 files at `/waveform/<id>`); local files decoded on device; reference resampling (F47) | The analysis algorithm is native (`OPEN`); R2 audio is never downloaded for a waveform |
| Settings | Every preference screen from the reference XML: redirects, switches, tag lists, list dialogs, seek bars (steps, scales, value arrays, summary2, labels, ticks), notes composed of their lines with HTML and links, Tone knobs (F68); skin picker with skin options; settings font option; restore defaults; export/import (own JSON) | Platform Material colours (background, accent, switch) are inferred, not extracted. Purchase/feature-pack rows hidden (no commerce). Colour and text-entry preferences show as plain rows. Settings that change the player theme reload it when settings close (the reference recreates the activity). |
| Equalizer | EQ tab (preamp + band knobs (5–32 bands) with dB / % value lines, tap steps and value dialogs (F68), response curve with selection window, spectrum backdrop, Equ/Tone/Limit, tone knobs, presets list with search, filter chips, sections and selection actions, overflow menu with Auto Save, Lock, Save, Rename, Share, Export, Import and Restore Defaults; F67), Volume tab (balance, stereo expand, tempo, mono, volume), Reverb tab (seven knobs, reverb on/off, preset list with selection, Save; F69); tab paging; Web Audio DSP | DSP numerics inferred (F33); MilkDrop FRS backdrop substituted by a live spectrum; preset assignment (devices, songs), platform FX, AutoEQ and parametric presets not implemented; non-ISO band frequencies inferred (F68); knob stacks laid out by intent (F32) |
| Popups | Button-to-menu morph with shade, menu items, preset lists, dynamic and non-dynamic selectable buttons (F41) | Timing curve inferred (F34) |
| Item menus | Cover item menu and list header menus (same morph); go-to artist/album/folder/genre; Add to Playlist; Info/Tags; Album Art; lyrics | Delete files and tag editing skipped (owner decision); launcher shortcuts, duplicate deletion, stream URLs and Show All hidden (`UW` / skipped) |
| Dialogs | Shared `dialog` layout in each `dialog_<Activity>` theme, enter/out/toast scenes, button bar, shim and Escape (F43); drag to dismiss (F58); alert, edit name, Add to Playlist, Info/Tags, Album Art, List Options | A list's overscroll handoff to the frame (`dragByNestedScroll`) not implemented |
| Playlists | Stored playlists; Playlists category; add (top/bottom/shuffled, one/several/toggle), rename, delete, remove entries, clear, re-sort, .m3u8/.m3u/.pls/.wpl import with ratings and auto-resolve, reference .m3u8 export (F44, F66); drag reordering of playlists and the queue in selection mode, with multi-select drag (F59) | Import reads picked files, not a system library |
| Ratings and statistics | Like/unlike, stars, play count at `played_dur` %, last played; Most Played, Recently Played, Top/Low Rated (F42) | History starts from first use (owner decision) |
| Search | Search panel (native input under the drawn hint), results in list mode, category chips with toggle and long-press filter (F55) | Results carry no per-kind subheaders |
| Toasts | Upper and lower toast frames; shuffle/repeat/advance mode toasts; dialog toasts | Expand/collapse times inferred |
| Long labels | Marquee: lays out at 3000 dp, clips to the text box, scrolls the overflow at 42.5 dp/s with 1500/3000 ms waits (F35) | — |
| Sleep timer | Sub-AA button popup: four-turn knob (0–240 min), relative-time title, play-to-end, Disable/Cancel/OK; player timer (F36) | Playback stops with a plain pause (no fade; reference behaviour not verified) |
| Visualization | Vis modes (none / with UI / full screen, temp UI); butterchurn renderer (owner-approved substitute for the native MilkDrop engine, pinned CDN build with SRI); vis panel with preset pager, preset list, filter, sort, likes, advance modes (F41) | Native renderer `UW`; pager-to-list morph cross-fades; preset sources are the butterchurn pack only |
| A–Z scroller | ListScrollerView modes (A–Z column, thumb), letter bubble, press state animation, section jumps (F38); alphabet from `azChars` / `localized_azChars` | Only English resources exist, so non-Latin titles fall under # as in an English UI; bubble placement by intent |
| Selection mode | Item select boxes, selection panel with the reference's per-list action layouts, select all/none/range, counts, state-enabled actions, Queue / Play next with insert-mode menus, Add to Playlist, Info, Album Art, Rename/Delete for playlists, Share via Web Share (F39) | Deleting files skipped (owner decision) |
| Lyrics | .lrc sidecars, ID3 USLT/SYLT, Vorbis LYRICS, MP4 ©lyr; AA lyrics button per `main_lyrics_button`; swipe ↑ on the art per `main_lyrics_swipe`; back by a side swipe or a pull at the top (F48); lyrics page in the album-art frame with the scene_lyrics header, synced / unsynced line scenes, active-line follow with `lyrics_offset`, tap to seek, empty page (F40) | Page geometry, follow position and play-button state in scene_lyrics need screenshots; lyrics provider apps not built; the lyrics dialog's Search offers the query through the share sheet (substitute, F61) |
| Help | Per-screen help overlays (main, vis, library, search, EQ pages) with placement, arrows and fades | Placement fallbacks by intent |
| App shell | PWA (manifest, icons, service worker for app files only; media and covers never cached by it) | Hosting: Azure static site path `/claude-player/` (the R2 Worker answers that origin only) |
| Not yet | Playlist import, EQ preset management, Material You substitute, the dialog list overscroll handoff, the shared item hand-off and title morph | — |
