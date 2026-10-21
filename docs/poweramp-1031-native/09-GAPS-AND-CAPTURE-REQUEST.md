# Remaining gaps and minimal original-app capture request

This separates missing owner inputs from incomplete reverse engineering and unavailable runtime observations. A missing screenshot is not used to excuse a traceable source question; a source declaration is not used to pretend the screenshot is known.

## Owner inputs absent from the APK

| Input | Why it changes the reference | Minimum evidence |
|---|---|---|
| Light/Black, follow-night-mode and Material You | Changes palette and theme overlaps | Selected built-in skin and options, preferably settings export |
| Default/Alternative/Full cover | Changes art/text/control geometry | Built-in layout selection |
| Font variant, font scale, label size/background | Changes glyph metrics, wrap height and overlay footprint | Skin/font options plus Android font scale |
| Artwork aspect, corner option, rating mode | Changes crop, clipping and lower-art anchors | Appearance options |
| Scrolling/static/plain seekbar; more-buttons | Selects different drawing and input implementations | Seekbar style and transport option |
| Navbar seek line, sub-art row/order/size | Changes bottom region and touch targets | Corresponding player/navbar settings |
| Blur, scale, saturation, intensity, gradient | Changes the bitmap preprocessing and native shader inputs | Background settings |
| Android API, viewport, density, insets, navigation mode | Selects resource qualifiers and post-inset layout | Device/configuration data associated with captures |
| App animation-speed and artwork animation options | Changes clocks or suppresses selected animation paths | Relevant settings, recorded with the video |

No owner settings were selected silently. The portrait Black/Default `MODEL-P360` atlas is an explicit analytical condition, not an inferred user configuration.

## Unfinished source questions

These have bounded continuation targets. They are not certified by this report.

| Priority | Question | Exact next trace | What is already recovered |
|---|---|---|---|
| High | Final wrap-content text/control bounds, gravity and scale compensation | `FastLayout.f1/onMeasure/onLayout`, `r40` anchors, `FastTextView` metrics; correlate with live hierarchy | View ownership, selected styles, explicit anchors, portrait artwork size algorithm |
| High | Complete page-provider/match/navigation transition matrix beyond the canonical file-page route | `p31.Z(sd)` smali around file lines3697–5270; `p31.В`; shared-item/pivot transition preparation | Actual entry/progress/terminal chain, timers, generic settling and canonical matching/fallback routes in report04 |
| High | All custom shared-element matrices and text callbacks during each transition | `PowerListSharedItemTransition`, paired layout-engine `с/t`, `FastTextView` scene callbacks | Source/target ownership and common interpolation behavior; not every intermediate matrix |
| High | Regrab while a provider/page is changing, detach/focus loss, rotation during settle | `PowerList`, `x32`, `i22` navigation gates, `SceneFastLayout` deferred layout and `h5` lifecycle | Several interruption/reverse/restart branches and mutation ordering, with exceptions explicitly listed |
| Medium | Native exact backdrop pixels and rapid artwork replacement synchronization | ARM64 `libpowerampcore.so` helper0x13f3e0, texture helper0x155704; `ol0` / `MilkRenderer` slot calls | JNI map, blur iterations, shader math, gradient preprocessing and ratio/commit entry points |
| Medium | Waveform audio-to-100-floats equivalence | `ScanDecode.native_scan` and its caller/result storage | Bar rendering, fixed/scrolling modes, resampling, deterministic placeholder and seek interaction |
| Medium | Formatting outside ordinary All Songs/file context | Provider-specific `C0/e1/e`, pending tag updates, stream metadata normalization | All Songs default title/artist-album and mini-player bindings |
| Lower unless a visual mismatch appears | Artwork cache/decode size policy across every state | Provider `i/j/bh` and AAImageView load mode | Crop matrix, bitmap shader/clip primitives and local replacement animation |

The most important broad limitation is the lack of original rendering to check whether individually traced components produce the expected composition when all active state is combined.

## Runtime observations still needed

1. Native bounds and actual draw order for the settled paused/playing full player and library mini-player; measured insets, font scale and resource configuration.
2. Relative timing of list content, top controls and private navbar, including cold-start timing and disabled/reduced app animation modes.
3. Artwork tap, horizontal swipe, vertical drag, reversal and regrab, including starting gestures while a previous transition is settling.
4. Waveform tap/drag/fling in the selected mode, pending-seek commit on release/CANCEL, and mini-player seek versus play/pause ownership.
5. Dynamic art/background replacement using visibly different covers; long labels and missing-art conditions.

Static input handling establishes conditional branches. The OS's actual dispatch/gesture cancellation and final painted frames remain runtime evidence gaps.

## Minimal request to the owner

From **original Poweramp build1031 with your normal built-in settings**, provide:

- One full-player screenshot and one All Songs/library screenshot showing the mini-player.
- One 15–30-second recording: open library from the player, expand the mini-player, do a slow partial drag and reverse it, then change tracks and drag the waveform. Include one play/pause tap if time permits.
- The selected built-in skin/layout/seekbar/font options, or a settings export; Android version, screen size/density, font scale and system navigation mode if available.

Use the same settings and viewport for both screenshots and the recording. A version/about screenshot or package information can tie the capture to build1031. No media files or private library export are required. A later focused test can cover long press, multitouch, orientation and cancellation if the first capture exposes a discrepancy. Do not recreate the screens in a browser to answer this request.
