# Poweramp build 1031 — Session 1 status

**Session 1 research is delivered as a conditional, source-traceable native reference. It is not a certification of visual fidelity, and the owner's actual UI is not yet ready for faithful implementation.** No player code was written or modified and nothing was deployed.

The supplied APK matches the required 23,936,965 bytes and SHA-256 `27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e`. Its resources, DEX/smali and a narrowly scoped ARM64 rendering path were investigated. V1 and V2 were not used as native references.

## What was recovered

1. **The effective full-player hierarchy and artwork model.** Art, title, subtitle and rating belong to a reusable `AAItemView` inside `ListWidget`; `AABounds` is a geometry proxy. Stock `TopAABounds` resolves to `TopAABounds2 → ListSubstyle2 → ListSubstyleBase2`. Smali corrected a decompiler branch that would otherwise stretch the stock art item. The portrait model includes a parameterized square-size/position algorithm, 8dp foreground margins, .975 paused/1 playing art scale and conditional corner/theme values. [UI atlas](02-RESOLVED-PLAYER-UI.md), evidence `PA1031-UI-002`, `006–015`.
2. **Active resource selection rather than isolated dimensions.** Each resource independently selects a matching qualifier. Under the explicit API36, 360×640dp `MODEL-P360`, the waveform maximum is 112dp, not the base 128dp. Navbar proxy sizes are computed through `dc0`, not taken from a similarly named rounded-navbar dimension. Font, rating, more-buttons, waveform and layout defaults are traced through selectors and theme overlays. [Styles and qualifiers](03-STYLE-THEME-AND-QUALIFIERS.md), `PA1031-UI-003–005`, `016–020`, `029`, `033`.
3. **Player/library motion has multiple owners.** Normal navbar and mini-player taps use independently timed top controls, list content and navbar. Canonical settled All Songs routes are traced through ready-page/track correspondence and shared-item versus pivot selection. Direct artwork drag can instead make top controls follow list progress. Recorded source clocks, easing, helper preferences, distance/velocity settling and early-completion behavior are distinct from measured durations. [Motion specification](04-SCENE-ANIMATION-ENGINE.md), `PA1031-MOTION-007–024`, `033–040`.
4. **Gesture behavior differs substantially by surface and mode.** The default scrolling waveform does not seek to arbitrary tap x; the fixed variant does. Waveform cancellation commits a pending seek rather than restoring the initial position. Artwork cancellation settles with zero velocity, which can still change the selected page. Mini play/pause consumes its own target; the normal closed mini-player has no traced vertical drag-to-full expansion owner. Held transport seeking has a separate service timer. Damaged input decompilations were checked in smali. [Gesture specification](05-GESTURE-STATE-MACHINES.md), `PA1031-GESTURE-011`, `014–026`, `037–038`.
5. **Rendering crosses both custom Android drawing and JNI.** Artwork uses a custom bitmap shader/crop rule; labels use custom font measurement, marquee and per-line backgrounds; waveform bars use bitmap slices. Backdrop preprocessing and ARM64 blur/color shader control are traced: default blur level 5 is an iteration parameter, not a Gaussian pixel radius. [Rendering specification](06-DRAWING-AND-WAVEFORM.md), `PA1031-RENDER-002–009`, `011–024`.

## Evidence and its limits

The [ledger](08-EVIDENCE-LEDGER.jsonl) contains **151 records: 144 CONFIRMED_STATIC, 4 OPEN and 3 BLOCKED; zero CONFIRMED_RUNTIME**. Status applies to each claim under its stated conditions. The three blocked records cover the environment and the resulting motion/input observation gaps; they are not three separate runtime attempts. The small number of OPEN records does not mean only four unknown details remain: broader unresolved boundaries are enumerated in the reports and [gap table](09-GAPS-AND-CAPTURE-REQUEST.md).

`NATIVE_RUNTIME_UNAVAILABLE`: the host has no connected Android device, installed Android OS/system image/emulator or hardware-virtualization device. The APK has ARM native libraries while the host is x86_64. The supported phone connector also reported no connected phone. No authentic screenshots, videos, live bounds or observed frame timings were obtained. This documents the environment actually available; it does not assert that no other environment could run the app. [Runtime report](07-RUNTIME-OBSERVATIONS.md).

Unknown owner inputs include skin/layout, font and scale, artwork/rating options, waveform mode, sub-art/navbar options, backdrop settings, animation settings, device density and insets. `MODEL-P360` is an analytical example, not the owner's configuration. Remaining source work includes final custom-layout/text bounds, exceptional provider/regrab/lifecycle paths, remaining shared-element callbacks, exact native texture/pixel behavior and audio-to-waveform peak generation. Each has a concrete next trace in reports 04–06 and 09.

## Acceptance assessment

| Handoff milestone | Result and evidence boundary |
|---|---|
| Correct package; resource/code/smali analysis | Met. Exact hash, signature verification, successful extraction; nine JADX errors disclosed and pivotal damaged methods checked in smali. |
| Resolved major hierarchy, qualifiers and style chains | Met conditionally. Defaults/selectors and explicit model documented; owner's active settings unknown. |
| Art size/position/crop/corners for a defined condition | Met statically. Parameterized stock portrait model and custom drawing; no observed pixel bounds. |
| Text, waveform, transport and navbar relationships | Met as anchor/ownership/style reference. Final wrap-content and custom-layout bounds remain open. |
| Main/library transitions beyond duration names | Met. Canonical All Songs selection, tap/drag distinction, timer and settle control flow recovered; exceptional matrix and rendered continuity remain open. |
| Gesture ownership/swipe/seek/long press | Met statically. Essential event tables, known thresholds and service cadence; device thresholds and runtime dispatch unobserved. |
| Rendering and default-versus-active distinction | Met. Canvas/resources/custom text/JNI ownership and conditional properties; exact compositor output remains open. |
| Authentic original-app runtime investigated | Investigated and blocked. No captures exist; minimal capture request provided. |
| Sourced, confidence-labeled ledger | Met. Schema, IDs, cited-file hashes, source dimensions and links validated. Checks do not prove semantic or runtime parity. |
| Research isolation | Met. No V1/V2/application edits, merge, release, deployment or public proprietary payloads. Research publication is confined to a new documentation branch. |

These are investigation milestones, not a declaration that every runtime value was recovered.

## Readiness and next evidence

**Do not begin a fidelity claim from this evidence alone.** Architecture and many conditional layout, input and animation rules are ready to guide a later implementation. The selected target appearance and its combined native output are not verified. The minimum next input is the owner's built-in settings, one original full-player screenshot, one All Songs/mini-player screenshot and a 15–30-second transition/gesture recording from build1031 with a known viewport. Complete the remaining traces for that selected configuration, then compare against the original. [Readiness verdict](10-IMPLEMENTATION-READINESS.md), [capture request](09-GAPS-AND-CAPTURE-REQUEST.md), [continuation checkpoint](11-CONTINUATION-CHECKPOINT.md).

The [README](README.md) indexes all artifacts. The reference includes only original findings, identifiers and structured evidence metadata. The original APK, decoded resources/smali/DEX, binaries, fonts and artwork remain private scratch.
