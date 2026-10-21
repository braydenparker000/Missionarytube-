# Session 3 implementation entry

The combined Sessions 1–2 evidence is sufficient for architecture selection and bounded implementation experiments. It is not evidence that the entire application can already be reproduced faithfully. Session 2 makes the configurable software system, rather than one saved setup, the implementation target. No implementation was started here.

## Contracts safe to use

Use the Settings page factory and typed declarations to build a configuration schema with explicit storage scope, control type, labels/value identities, dependencies, capability predicates and consumer invalidation. Keep XML defaults, constructor defaults, loaded values, first-install initialization, reset values and effective values separate. Do not treat an Android `persistent=false` control as transient: output profiles, skin selectors and tone controls deliberately bind elsewhere. Preserve per-skin, per-orientation, per-category, per-output-profile, per-preset and per-list-instance scopes.

The resource/style experiments can use the verified inheritance and ordered overlay rules, the TopPoweruiStyles mapping, separate SceneParams/StateAnimParams, unit conversion and scene flags. Black/Light, all built-in layout choices, More Buttons, seekbar modes, typography, ratings, artwork/background choices and editable sub-art controls must remain selectable. A single hardcoded full-cover screen would discard recovered behavior. Fixtures accept explicit post-initialization settings; they are not a claim that every new installation starts in the fixture's configuration.

Use the native component ownership as the behavioral reference: ListWidget/AAItemView owns main art/text; AABounds supplies geometry; top controls, list/artwork, navbar and modal controllers have independent transitions. Retain programmatic versus direct-gesture routes. Do not select a DOM, canvas or hybrid architecture before comparing text, clip, shader, layout and interaction requirements against these ownership contracts.

Use a navigation model with page history, conditional library factories, Settings fragment routes and modal ownership. Treat screen families and dynamic instances separately. Use typed command/state interfaces for player/DSP/native-output boundaries. Audio settings can be represented and their UI effects tested before a corresponding platform audio feature is supported; platform capability and unsupported behavior must remain explicit instead of silently choosing a different native option.

## First experiments and acceptance evidence

1. **Configuration state and invalidation:** choose representative ordinary, skin, per-output, per-list and sub-art settings. Verify selected value identity, persistence scope, fresh/reset distinction, dependency enablement and which model/view/pipeline is refreshed. Use the 68 complete selected non-skin traces, built-in option chains and dynamic list contracts, with each row's limits.
2. **Style resolver:** reproduce the 279 fixture cases against the supplied static model, including the 72-case theme/layout/orientation/seekbar/buttons matrix. Assert provenance and resolved attributes; keep final Android glyph bounds, dynamic system colors and unknown scene rectangles unresolved. Static-model agreement alone is not native fidelity.
3. **Main-player and library geometry:** implement a disposable research slice driven by resolved attributes and measured host inputs. Include no-art/art-loaded, font-scale, portrait/landscape, list/grid, titles-only and compact-header variants. Test clipping and intermediate scene geometry, not just the resting screen.
4. **Interaction owners:** exercise taps, reversals, interruption and cancellation separately for main transitions, waveform, knobs, selection, reorder, dialogs and Back. Preserve continuous knob updates, dialog/reorder zero-velocity cancellation behavior, and delayed reorder cleanup. Do not impose one universal animation or cancellation policy.
5. **Secondary graphics:** compare native-style text/artwork with EQ response, preset miniatures, selection affordances, search and lyrics. Keep MilkFRS/visualizer and Canvas frequency-response ownership separate. Test approximation choices against a declared error budget before choosing the rendering architecture.

These are future-session experiments, not an approved production rollout or a request to modify the existing players. The Session 3 owner should read the evidence and explicitly choose the experimental architecture after these constraints are understood.

## Remaining boundaries

Native Android execution was rechecked and is still unavailable. No current pixel, animation-frame or real-device capability claim is runtime-confirmed. Authentic original-build execution should validate the reconstructed system across chosen configurations; no owner's settings export is needed. Runtime validation complements code tracing and does not replace it.

Important static work remains: complete grouped-reorder geometry and concurrent mutations; all data-result/history races; remaining Settings helper effects; hardware-specific output initialization/capabilities; all platform notification/widget states; original text metrics and native shader precision; the resource-only EQ-button-editor candidate; full external-skin/plugin compatibility. Preserve these as explicit gaps and capability boundaries. Full DSP equivalence, licensing and store services are outside the present mission.

The readiness decision is **yes for Session 3 architecture and bounded implementation experiments; no for an assertion of complete native parity or production readiness**. [Unresolved questions](unresolved-questions.json) prioritize the next investigations and name concrete evidence targets.
