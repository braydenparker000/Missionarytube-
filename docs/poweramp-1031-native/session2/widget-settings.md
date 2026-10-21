# Widget configuration: bounded complete control-to-preview trace

The widget configurator is a separate reachable native configuration system. Four size activities (`Widget2x2Configure`, `Widget4x1Configure`, `Widget4x2Configure`, `Widget4x4Configure`) share `BaseWidgetConfigure`. Its concrete option layouts form four tabs: Background, Text, Buttons, Other. Across those layouts there are **37 distinct interactive option IDs**; size and API conditions decide which are visible or enabled. `widget-settings.json` maps every one to its typed model field, storage, range/value class, and known guard. Style selection, Advanced and Done are additional navigation/actions, excluded from that37. [WIDGET-001]

This is static evidence. No launcher/widget host was executed, and no final widget pixel geometry is claimed.

## Data and persistence

The current configuration is a `da2` style object. `ia2.B` opens the named `appwidgets` preference store; under this application it resolves through the named `o30` mechanism to `files/fsprefs/appwidgets`. Keys prefix the decimal widget ID directly, with no separator, for example `<id>flags` and `<id>padding_hor`. The global `x11` state is a source of track metadata/artwork for preview and rendering; it is not the widget style store. `y11` was not needed for this chain. [WIDGET-002]

Storage preserves bit semantics. `style_bits` packs background style in bits0–3, other text-size index4–7, title-size index8–11, shadow alpha16–23, and artwork alpha24–31. `style_bits2` packs corner index0–5 and alignment8–9. Font family has a separate key; read compatibility can first recover it from old style_bits bits12–15. Colors and resource references, padding floats, artwork radius, theme and button color are separate fields. Flag bits encode title/other-text visibility, bold/italic, category and playing-mode controls, artwork, shadow, metadata, metadata background, and fixed-size behavior. Negative flags such as NO_TITLE require boolean inversion in the checkbox. [WIDGET-002]

There is one significant global exception: Animate Album Art writes `c40.l0` / `animate_widget_aa`. Widget configurator `onStop` schedules a c40 save, and the provider consumes this global value. The preview explicitly sets preview mode, which suppresses artwork animation. A single widget's style JSON therefore does not independently own this switch. [WIDGET-006]

## Edit, preview, complete

User control → typed field or flag mutation → `BaseWidgetConfigure.i(style)` → mark modified → cancel pending edit/save tasks → post `wf` case2 at zero delay → serialize the widget's style fields → rebuild the visible preview.

The preview uses the real size provider's `RemoteViews` builder, then `apply` or `reapply` inside the configuration fragment; its configure button is hidden. This is a static construction path to the same rendering family as the host widget, not a screenshot approximation. Selecting another preset page has separate300ms control-refresh and1000ms serialization delays. [WIDGET-003]

Done and Back both call the completion method. It flushes pending serialization, clears provider caches, requests the selected widget ID's host update, and finishes. **Back commits**; the investigation did not find a Back-as-cancel transaction. Changes are already saved during live edits. Option pane index and advanced state persist independently as `pane` (default0) and `advanced` (defaultfalse). Animated Advanced expansion/collapse uses the native scene controller with0.25seconds; initial restoration uses zero duration. [WIDGET-004]

Color confirmation preserves the existing alpha for background and icon RGB changes; text/button colors use the selected HSV result. Color resource references remain alongside literal colors. Artwork-shadow selection also resets artwork opacity to the slider maximum; modern background shadow maps to alpha0/255. [WIDGET-009]

## Controls are indexed and conditional

Opacity sliders use0–255. Text-size sliders use indices0–10, not a literal font size. Providers select size-specific `getDimensionPixelSize` resources; the base font dimensions are declared in dip. Radius values are indices too: native conversion is4×index through10, then40+8×(index−10). A circle-enabled path treats index16 as a10240 sentinel. Full layout still depends on provider and density. [WIDGET-005]

Padding uses the unusual mapping `Math.round(progress*0.5)+minimum`, verified in smali. Although it is stored as float and inverse binding divides by0.5, user progress produces repeated integer values. A recreation must not replace this with assumed half-unit increments.

| Size | Horizontal padding | Vertical padding | Second vertical padding | Background selector |
| --- | --- | --- | --- | --- |
| 2×2 | −24…96 | −16…256 | −64…256 | 0…6 |
| 4×1 | −32…36 | −16…18 | −16…32 | 0…7 |
| 4×2 | −50…72 | −16…32 | −8…40 | 0…7 |
| 4×4 | 0…32 | 0…64 | Hidden | 0…6 |

These are stored input ranges before density and provider offsets. Background style0 is the no-style option. Corner slider maxima are8 before API31 and16 from API31 for the 2×2/4×1/4×2 family;4×4 uses16. Whether a corner control is enabled also calls the provider's style predicate.

The modern branch is exactly `SDK_INT>=31`. It replaces background shadow opacity with a shadow checkbox, exposes button color and artwork-corner controls, and changes style resources. Button color is additionally enabled only for theme indices1–4. On2×2, category-change controls are hidden and Fixed Size is exposed. On4×4, the artwork checkbox is hidden and Alternate Scale uses the same flag4096 as artwork in other sizes. The Text tab enables title and other typography controls according to each text visibility switch. [WIDGET-007]

The font selector combines13 base family labels with API-qualified extras: two at API26–30, six at API31+, for effective counts13/15/19. Theme entries number4 before API31 and5 thereafter. These are selectable-label inventories; full font-file/resource fallback behavior is not established by the counts alone.

## Presets, restoration, and remaining work

The configurator loads bundled JSON styles, saved style files and—when the widget ID has `flags` or legacy `shadow` data—a reconfigure entry. Smali confirms this guard and the array-parser return that JADX damages. On recreation, retained or serialized style state takes precedence. Each control's default comes from the selected style and this restoration sequence; no universal default is assigned merely from a zero-initialized `da2` field. [WIDGET-008]

| Bundled source | Base entries | API31-qualified entries |
| --- | --- | --- |
| `small_widget_styles` | 16 | 26 |
| `widget_2x2_styles` | 11 | 35 |
| `widget_4x4_styles` | 13 | 19 |
| `widget_4x2_styles` | not selected before API31 | 26 |

4×1 uses `small_widget_styles`;4×2 uses that source before API31 and its own source from API31. These are source-entry counts, not a sum of unique visible styles across configurations. No proprietary preset files are reproduced in the research artifact. Named style Save/Copy/Import/Delete actions and JSON serialization are present; complete menu-loop and legacy interchange compatibility still need further smali work.

The recovered control→model→store→preview→completion contracts support an implementation experiment for configuration semantics. Exact per-preset geometry, resizing by real launcher hosts, all typography/resource fallbacks, lifecycle interruption outcomes, and visual fidelity remain open. Run `settingssystem_widget_build.py --private-root <reconstructed-workspace>` to regenerate the37-control registry, qualified arrays/dimensions, seven source counts, and nine ledger records. IDs above abbreviate the prefix `PA1031-S2-`.
