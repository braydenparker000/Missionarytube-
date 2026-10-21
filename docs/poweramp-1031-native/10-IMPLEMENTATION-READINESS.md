# Implementation readiness

**Verdict: NOT READY to claim a faithful recreation of the owner's actual Poweramp UI.** The investigation is sufficient for a substantial conditional technical reference. It is not sufficient for pixel/motion parity, and Session2 implementation has not begun.

| Area | Ready evidence | Remaining prerequisite |
|---|---|---|
| Screen architecture | Actual root/list/art item hierarchy; distinct top controls and mini-player ownership | Confirm current runtime child/overlay visibility |
| Stock portrait geometry | Effective `TopAABounds2` chain and smali-checked parameterized square geometry; resource qualifier example | Owner viewport/insets/font scale; native FastLayout/text final bounds |
| Built-in options | Defaults and selection/overlay order; Default/Alternative/Full cover and waveform variants identified | Owner active selections; alternate-layout complete measured geometry if selected |
| Artwork | Custom scale matrix, rounded clipping, .975/1 scene scale, local image-replacement path | Native crop/outline/shadow results with representative cover aspect ratios |
| Labels | Default bundled font identifiers, text style chain, custom metrics/background drawing; All Songs default `artist - album` path | Actual strings, font rendering, wrap/marquee and overlay placement |
| Motion architecture | Canonical tap routes use independent list/top/navbar clocks; direct gestures can couple list/top progress; frame driver, interpolators, preference handling, distance/velocity settling and interruption paths | Native frame phasing and complete exceptional provider/regrab routes |
| Gesture rules | Smali-confirmed waveform event paths, scroll/static distinction, page thresholds, mini-player input, command/long-press ownership | Observe Android dispatch and cancellation for owner's surface/settings |
| Backdrop | Java/settings/preprocess/shader/JNI map and narrow native blur-pass analysis | GPU/compositor output and exact cross-track synchronization |
| Waveform drawing | 100 scrolling /60 static samples, bar placement, bitmap caps/colors, resampling/placeholder and data morph | Native scan algorithm if exact audio-derived peaks are required; rendered reference |
| Icons/fonts | Correct source identifiers and composition mechanisms | Independent/licensed asset decision and native comparison; asset bytes are not shipped here |

An implementation engineer can use this reference to make precise experiments without inheriting V1/V2 assumptions. They should not silently replace the three motion owners with one timer, use generic image `contain`, copy a random base dimension, select a different waveform mode, treat CANCEL as rollback, or equate app blur level with a Gaussian pixel radius.

## Evidence gate for a future implementation session

The minimum next gate is owner settings + known-configuration original full-player/library screenshots + a transition recording. Those resolve which conditional specification is the target and expose the highest-impact composition/motion discrepancies. Then complete source traces for the specific active layout and exceptional behaviors that matter. Runtime captures complement the source; they do not retroactively prove untraced branches.

There is no recommendation here for React, Canvas, DOM, WebGL, a browser animation library or an audio stack. Those choices belong to later implementation experiments after the target reference is selected. No V2 source was written or modified; no merge, release or deployment occurred.
