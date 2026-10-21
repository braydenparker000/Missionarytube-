# Build 1031 effective styles, configuration and bounds

This is a static technical contract for the supplied APK, not a screenshot description or an owner-settings profile. The resolver and fixtures distinguish resource selection, ordered theme overlays, component style bags, constructor fallback, scene properties and layout execution. Those stages must remain separate in an implementation. No V1/V2 UI informed the results.

The important closure is that built-in configurations are reproducible from explicit inputs. There is no prerequisite to obtain an owner's settings. Some final pixel outputs still require platform metrics or the remaining layout branches; these are represented as unknown outputs, not silently supplied browser defaults.

## Reproduction and artifact contract

Set `POWERAMP_RESEARCH_ROOT` to a private directory containing the verified build1031 Apktool `decoded/res` tree. Python3 with `lxml` is required. Run `style_resolver.py --skin Black --layout FullCover --attr TopAABounds`, or `style_build_fixtures.py` to regenerate the compact fixture matrix. `POWERAMP_FIXTURES_OUT` can select an output path. Scripts do not depend on private temporary logs, a running Android instance, or an application checkout.

`configuration-fixtures.json` contains 279 representative fixtures. Its 72-case core covers both built-ins × three artwork layouts × portrait/landscape × scrolling/static/plain seekbar × more-buttons off/on. Further fixtures exercise every registered built-in option choice, global overlay selectors, typography/rating interactions, qualifier boundaries, rounded-screen and rounding choices, six explicit migration-derived fresh-install cases, and editable sub-artwork button state. This is coverage of every built-in choice plus selected interactions, not every possible Cartesian product of every setting.

The shared catalogs avoid repeating evidence: C records hold full configurations; S records hold component style bags; V records hold resolved theme attributes; T records hold application steps; A records order those steps. Each S/V has compact references into the source catalog. A fixture's inputs select those records explicitly. A missing property in an S bag means absent from that bag, not disabled: use the resolver's `consumed()` API with the constructor's queried attributes, explicit layout attributes and defaults to include final-theme fallback.

The model emits resource identifiers and derived metadata, not font/image/native payloads. Its resource selector covers observed qualifier forms and exact/default locales used in fixtures. General BCP47 fallback, framework resource definitions and native palette generation remain outside it. API34+ non-unit font scale is deliberately not reduced to `sp × density × fontScale`: the platform nonlinear conversion needs its own input. See STYLE-004/005.

## Ordered resolution: control → saved value → applied theme

1. Built-in `SkinInfo` parses the Light/Black registry. Selectable controls store a resource identifier: the chosen option's overlap attribute ID, otherwise its overlap style ID. Zero means no optional overlay. These are not radio-list ordinals. Boolean options use a distinct typed boolean value. Registry defaults are fallback inputs, not a complete fresh-install state.
2. `qv1.setSkinOptions()` disables ordinary Preference persistence. Selection calls `qv1.В()`, updates the skin-specific typed store, schedules its save, and, when the active package/skin matches, invokes `wv1.O()` to unset the modal state and force skin reapplication. Switch and numeric skin controls have their own typed writes; the numeric control posts a delayed refresh. The settings-system artifact owns the complete store/refresh trace.
3. `wv1.К()` creates a theme, applies the base skin, applies global option overlays, traverses skin controls in XML order, and reapplies the global selectors mapped by that skin. The built-ins map only rating-disabled and stars-in-menu through this second pass. Later theme styles use force=true here.
4. During skin traversal `wv1.x()` reads a selectable integer, resolves it as an attribute when possible using `AUtils.F()`, then applies the resulting style. Booleans similarly resolve their overlap attribute or direct style. Dependency evaluation is a typed `getBoolean(dependency, true)` read. A saved integer layout selector is not coerced to a boolean by `x30.getBoolean`; it takes the default true branch. This differs from assuming all UI dependencies are equivalent to `layout != Default`.
5. Activity setup optionally applies the rounded-screen overlay on API31+ when the display corner queried by the activity is nonzero. It then applies `TopPoweruiStyles` and `BasePoweruiStyles` with force=false, filling missing component mappings while preserving preceding choices.
6. Component inflation resolves its style against this final theme. Any queried attribute absent from the component bag can still come from the theme. Only after that does the constructor getter's default apply. A concrete example is a knob's hole color: absence in `EqLinearKnob` alone does not establish a disabled hole. Another is NavbarExtension drag settings, discussed below.

Sources: `wv1.java:105,360,487`, `SkinInfo.java:620,934,1074`, `qv1.java:94,115`, `x30.java:180,200`, `BasePowerWidgetActivity.java:377`, and the registry lines4–140. Ledger STYLE-001/002/003/006.

Global first-pass selectors are rating, menu visibility, lyrics-button visibility, artwork aspect mode, chromecast-button placement, header metadata, FRS rounded mode, header buttons, localized A–Z, and animated long list labels. The last requires both animation booleans. Registered defaults matter: for example, `anim_long_labels_in_lists=false` wins over a conflicting XML declaration. See settings-system defaults evidence, rather than treating arbitrary XML `defaultValue` as authoritative.

Fresh install has a separate migration stage. An old-build value of −1 causes the initializer to set more-buttons=true and BoldFont for both built-ins. It also sets navbar-offset=false at API29+. If symbolic device flag `s41.C` is true, a floating device height/width ratio below2.3 chooses Alternative, and a ratio ≥2.3 chooses FullCover. The assignment/meaning of `s41.C` remains unresolved; fixtures explicitly supply it as a symbolic input. A separate Samsung/API/inset-conditioned navbar-background override must not be silently assumed. See PREF-009/011. The fixture contract therefore distinguishes explicit post-initialization state from migration-derived examples.

A deliberately retained `track_labels_align=centered` preference with Default layout is an inferred edge case: typed dependency lookup permits traversal, but the resolved attribute may not designate a style. The model records `non_style_apply`; it does not assert Android's invalid-style native fallback. That fixture is the only inferred fixture, rather than pretending the setting is simply ignored by a boolean dependency.

## Effective layout choices and interactions

For the explicit baseline API36, 360×640dp portrait, sw360, normal/long, density320, fontScale1, English, no detected rounded display corner, post-initialization registry defaults, the two skins have these common geometry-related selections:

| Selected layout | Effective artwork-bounds style | `aaMinSize` | `aaMarginBottom` | `aaPaddingBottom` |
|---|---|---:|---:|---:|
| Default | TopAABounds2 | 130sp | 200dp | absent from this bag |
| Alternative | Alt_TopAABounds | 50dp | 208dp | 64dp |
| FullCover | Alt2_TopAABounds | 50dp | 208dp | 92sp |

These values are inputs to `AABounds`, not final artwork rectangles. Density conversion must happen at each actual getter; any effective inset, title extent, navbar reference or scene change remains part of the geometry. In particular the FullCover padding is sp while Alternative's is dp. The plain `TopAABounds` named style is not the effective Default mapping; the force=false catalog maps Default to `TopAABounds2`. S1 owns the full artwork crop/corner computation. STYLE-007 and fixture provenance identify qualified definitions.

More-buttons is not a universal waveform-mode switch. In the ordinary layouts it adds or alters transport/time controls; scrolling remains the 100-bar waveform. The static seekbar selector subsequently maps to `TopWaveseekStatic` with its own mode. Plain seekbar is a structural overlay: it installs `merge_plainseekbar_morebuttons`, replaces waveform/transport/time styles, nulls the normal metadata include, and remaps the more-buttons overlap to an **empty style**. Consequently turning more-buttons off while plain seekbar is selected does not remove the controls installed by the plain-seekbar overlay itself. Alternative/FullCover use the corresponding alternative plain-seekbar wrapper. STYLE-008.

Ratings must be resolved after layout overlays, including the second mapped-global pass. Default-like layouts can place thumbs or stars alongside the secondary text; stars-in-menu chooses a different include/scene. FullCover remaps both rating-disabled and stars-in-menu to its `Alt2_OptionRatingDisabled` handling. Centered labels also change concrete scene/style references, rather than being a CSS `text-align` substitution. STYLE-009; all four ratings are fixture-covered across layouts.

| Font choice, baseline condition above | Title | Secondary line | Family |
|---|---:|---:|---|
| System | 18sp | 13.5sp | platform/theme inherited; no named family asserted |
| Alternative | 15sp | 13sp | Manrope smaller resource |
| Bold | 18sp | 13.5sp | TTNormsPro bold resource |

Bold is the built-in default at both registry and fresh-init stages. For these API36 variants `TrackItem_eatFontPads=true` comes through the API25 core theme. This is a custom FastTextView metric operation, not a CSS font weight or line-height selection. STYLE-010/018/019.

Equalizer FRS also illustrates why constructor fallback is insufficient. Light's base preset is inverted and Black's is non-inverted; default registered `vis_frs_type=2` applies the rounded preset overlay, yielding `internal://#fft2invrounded` and `internal://#fft2rounded`. API28+ `EqMilkFrsBase` reads `?corners_equ_frs`, whereas the earlier base has zero clipping radius. Under API36 the baseline radius is16dp; LessRounding changes it to8dp. The separate detected-screen-rounding overlay does not change this FRS result. STYLE-011; rendering report owns shader/draw behavior.

For NavbarExtension, the modeled final main-activity themes in both skins × all three layouts under the API36 baseline provide none of `dragThreshold`, `dragThresholdVelocity`, `dragAnimTime`, or `collapseDragDirection` in either its bag or final theme. BaseDialog does not enter this ancestry. Under these conditions the `um` constructor defaults therefore govern; the gestures report owns their values and behavior. STYLE-025. This is a bounded effective-theme assertion, not a claim about every external skin or future overlay.

## Qualifiers and unit conversions

Each resource is selected independently for the supplied configuration. A selected `values-v33` style can refer to a dimension selected from `values-sw360dp-h610dp-port`; one directory does not select an entire screen's resources. Parent style selection is also independent. The model retains the actual qualified parent paths and item-level provenance when a full trace is requested.

Fixtures test h566/567,609/610,629/630/660; sw380,600,800; portrait/landscape; RTL; night; density240/320/420; APIs21/23/25/28/29/31/33/35/36; and font scales1/1.3. The size/long/orientation flags are explicit Android configuration inputs, not guessed solely from a CSS viewport ratio. These are resource-selection probes, not a supported-device claim. Exact/default locale handling suffices for these probes; untranslated-resource fallback across locale scripts is not claimed closed.

Android pixel-offset getters truncate toward zero, pixel-size getters round with nonzero preservation, and float dimension getters retain fractional values. The navbar reference model performs each offset conversion before summing. At the explicit baseline its effective dimension inputs are bottom8dp, normalheight48dp, top4dp, mini bottom−4dp, seek top0dp, seek bottom−6dp, seekheight32dp. At density320 the normal reference is112px, the two-line amount before seek inclusion208px, and three-line amount260px. The reference named `two` selects the three-line amount when navbar-seekbar=true. They are layout reference quantities, not a claim that an inset-free screenshot's measured navbar is that height. Insets remain independent inputs; S1 inset analysis and S2 geometry consumers retain that distinction. STYLE-005/012.

## Scene bags are not CSS inheritance

There are three separate layers: resource-style parent inheritance; `do1.K()` scene-property inheritance; and scene application/fallback to a captured zero state. They must not be flattened into a single dictionary merge.

In `zn1` construction, omission of `baseScene` stores −1. Smali disproves JADX's reversed branch. An explicitly supplied zero/non-reference base selects zero; another nonzero ID refers to that view's scene tag. `do1.K()` returns without inheritance for −1. Otherwise it copies only groups absent from the target but present in the chosen base: alpha, scale, visibility, layout params, recalc/apply flags, elevation, per-view parameters and so on. Layout params are copied as an entire group, not field-by-field. Presence of `android:layout_width` is the relevant construction flag for generating the scene layout-param object; an orphan margin declaration must not be assumed to create it.

Registration still captures zero state and assigns `target.С=zero`, independently of explicit property inheritance. Zero captures visibility, alpha, scale, layout params and elevation. During application some absent flags have defined value/default behavior; this is distinct from copying an XML parent bag. The scene-engine report owns the complete application/timeline contract. The style resolver emits each scene bag independently and deliberately does not call it a fully applied rectangle. STYLE-013/014.

FastTextView's `k0()` supplies another typed per-view scene structure: it can clone a base text-parameter object and then override declared text attributes. This is not permission to merge arbitrary layout properties or all view state. STYLE-014.

## FastLayout: closed measurement kernels and remaining boundary

The important distinction is between a child's measured size, its logical consumed extent, its raw layout rectangle, and a final transformed screen rectangle.

* `r40` obtains fixed sizes, reference IDs, fraction/anchor options, and min/max dimensions from the final AttributeSet/theme. Min/max fields use pixel-size getters. A compensation scale `f` records `f` plus reciprocal `1/f`.
* `r1()` preserves the MeasureSpec mode but, when compensation applies, replaces its size with `round(size/f)`. Later `p1()` computes a logical effective measured extent using `round(measured*f)`. The raw view rectangle still uses the raw measured size. A view transform/pivot is a separate operation. Applying one scalar to every rectangle loses this distinction.
* Height/width measurement treats fixed/reference sizes as EXACT, fractions as rounded products of available extent, match-parent as remaining available extent, and wrap as AT_MOST unless explicitly unlimited. Margin-ignore flags alter the subtraction. Min/max clamp is then applied. Width has an extra wrap flag permitting the full available extent instead of remaining extent.
* Width-to-height/height-to-width constraints derive an exact target from the other spec plus the appropriate padding, clamp it, and respect the paired-anchor conditions. They are not a universal CSS aspect-ratio rule.
* In the gravity helpers, left/top are the default; right/bottom align the far edge; center uses the span midpoint. For a non-gone centered child the margin adjustment is `(startMargin − endMargin)` after the half-span computation, not half that difference. Ignore-margin and collapsed-child paths differ.
* A child collapses when GONE, or when `layout_goneWhenEmpty` is set and the relevant custom-empty/TextView-empty predicate succeeds. JADX loses the true return in `h1()`. FastTextView's empty predicate includes drawable presence, so an icon-only button is not equivalent to empty text.

Smali checked the scale-consumption, collapse and constraint branches because the reconstructed Java contains merged or inverted control flow. STYLE-015/016/017.

Still open: every recursive dependency/fallthrough branch of the large `FastLayout.p1()` solver, together with `d1()` consumption interactions and exact transition-time rounding under simultaneous scene changes. `p1()` resolves anchor dependencies recursively and has a depth/cycle guard, so a simplistic one-pass flex layout is insufficient. The closed kernels support implementation experiments, but an authoritative all-state rectangle engine should not claim pixel parity until the remaining branches are translated and compared with an Android oracle.

## FastTextView: resolved single-line height and baseline

This class measures and draws with Paint; it is not an Android TextView. Its constructor resolves text appearance, direct attributes and typeface, uses a pixel-size text dimension and optional saved multiplier, then caches `FontMetricsInt`. Let `L=fontMetrics.top`, `M=fontMetrics.bottom`, and `J=M−L` for the unspaced single-line case. It uses Paint's per-character widths and its own line records/ellipsizing, rather than browser line layout.

When `eatFontPads` is enabled, the first measure calls `getTextBounds("Z")`. Let its top/bottom be `Zt/Zb`. The trim values are `k=Zt−L` and `l=M−Zb`. For a nonempty single line without a compound drawable or extra line spacing, the text block height is:

`I = J − k − l = Zb − Zt`.

A stored line baseline is `J−M = −L`. Draw translation subtracts `k`, so the final baseline relative to the text block origin is **`−Zt`**. With view paddings `pl/pr/pt/pb`, measured view dimensions `W/H`, and text width `G`, the gravity origins are:

| Gravity | X origin | Y origin |
|---|---|---|
| Start/top | pl | pt |
| Center | round((W−pl−pr−G)/2 + pl) | round((H−pt−pb−I)/2 + pt) |
| End/bottom | W−pr−G | H−pb−I |

Thus baselineY is `originY−Zt`. `G` is the ceiling of the actual selected line's Paint advance extent. This supplies a parameterized exact metric interface: text, resolved font/size, Paint glyph advances and Z bounds. It does not invent font metrics from sp values.

Measurement also has nonstandard behavior. In the no-drawable branch desired width is `G+pl+pr`, desired height `I+pt+pb`; width respects the incoming bound outside EXACT, but height outside EXACT uses desired height and does not perform the conventional AT_MOST cap. Min-size and allow-zero-height branches then apply. Unspecified-mode cross-checks in the decompile were verified against smali. A reimplementation using ordinary browser line-height or generic `resolveSize()` will not reproduce these rules. STYLE-018/019/020.

Still open: the complete multiline wrapping, ellipsis and continuous-label algorithm in `FastTextView.o()`; drawable compound-spacing combinations; font fallback/shaping for every script; native metrics and API-specific scaled-font conversion. The default single-line metric kernel is closed symbolically, so a broad statement that all text bounds are unknown is no longer accurate. These remaining outputs belong to the platform/algorithm oracle, not an owner's preference export.

## Editable sub-artwork controls

This is an independent configurable layout system, not merely a row of hardcoded buttons. Portrait and landscape keep separate resource-ID arrays. A zero preserves an interior empty slot. Exit edit trims trailing empties, saves the appropriate array and requests the asynchronous preference save. Constructor reads the selected orientation, applies its gate/default rules, creates views for known resource IDs and caps the slot array at32.

The centered state is true when its saved orientation value is0; the two-line state is true when its saved value is2. Both Java boolean branches are misleading; smali verifies these meanings. Small-size is a boolean. The controls have separate orientation-specific preferences for alignment, size, line count and scroll; a no-gap option is shared. See PREF-024 and STYLE-021.

Baseline style inputs are normal slot width58dp, small width46dp, row height30dp, line gap4dp and slot gap4dp; fit-centered count5 or7 for normal/small and minimum slot width30dp. In centered mode with count>1, the measured slot width is clamped between the minimum and selected base width after subtracting inter-slot gaps and dividing by count. The optional no-gap branch applies another half-width packing adjustment with an80% floor. Child width/height specs are forced to these computed dimensions. Minimum container height is paddings + rowheight for one line and paddings +2×rowheight+linegap for two.

Slot geometry does not follow saved-array order visually. In the settled first row the first five slot indices lay out visually as **0,1,2,4,3**: index0 starts left, index1 follows it, index2 is centered, index3 occupies the rightmost position and index4 is immediately inward. The second row begins at array index16. Layout builds all possible slot rectangles, while the occupied-view extent is separately computed. This distinction matters for scroll bounds and internal holes. Three explicit edit fixtures preserve that behavior. STYLE-022/023.

The slot mapping is statically verified; this report does not claim a runtime drag hit-test trace for every edit gesture. The gestures artifact states that boundary explicitly.

## Readiness and exact residual work

Ready for implementation of the built-in preference model, ordered theme/style resolver, representative configuration tests, structural seekbar/layout/rating/font choices, sub-artwork saved-state model, and the documented measurement kernels. All choices can be specified without choosing an owner's configuration.

Not yet authoritative for full pixel-faithful rendering across every built-in state: finish `FastLayout.p1/d1` anchor/consumption combinations; finish FastTextView multiline/ellipsis and drawable metrics; provide native/platform metrics, dynamic system colors and nonlinear font conversion; validate scene application and transformed rectangles with the scene contract; and obtain an Android execution oracle when feasible for final parity. The current static evidence is sufficient to constrain those tasks precisely. It is not evidence that a browser rendering has already matched the APK.
