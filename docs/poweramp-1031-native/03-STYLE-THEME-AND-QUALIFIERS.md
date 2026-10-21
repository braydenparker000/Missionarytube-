# Poweramp 1031 — themes, effective styles and configuration qualifiers

The APK describes a family of built-in configurations. “Stock skin” does not identify a unique screenshot. This report resolves a representative condition and preserves the selectors needed to choose another. No owner settings file or native configuration was present.

## Theme construction order, not just style names

The primary path is `wv1.К(Resources,SkinInfo)` (`jadx/sources/ׅ/wv1.java:487–520`): create a theme, apply the selected `SkinInfo.O` style with force=true, apply global appearance options through `X`, apply any legacy compatibility overlays, apply each selected built-in skin option through `x`, and then reapply explicitly remapped global options. `x` reads stored selectable values with the parsed default, resolves overlap attributes into style IDs, and uses `applyStyle(...,true)` (`wv1.java:360–455`).

For the activity, `BasePowerWidgetActivity.А(Resources.Theme)` first applies a rounded-screen overlay on API31+ when a nonzero display corner radius is reported, then resolves `TopPoweruiStyles` and `BasePoweruiStyles` and applies them with **force=false** (`.../BasePowerWidgetActivity.java:377–397`). Consequently the main style catalog supplies defaults only where earlier theme/option layers have not already supplied a mapping. Resolving `?TopPlay`, `?ItemTrackTitle_scene_aa` or `?TopAABounds` directly from the catalog while skipping options is wrong.

The builtin skin registry is `decoded/res/xml/poweramp_builtin_skins.xml`. It contains Light (`ActivityTheme_White`) and Black (`ActivityTheme_Black`) definitions, each declaring the opposite mode and `forceGlobalOptions=true`. `c40` contains a `follow_night_mode` setting, default false, so a `values-night` folder alone does not establish which built-in skin is active. The persistent theme package/ID also remain unknown.

For the API36 portrait model used in report02, the relevant Black lineage is:

```text
ActivityTheme_Black                    values-v33/styles.xml:3
  → Base_ActivityTheme_Black            values-v23/styles.xml:7
    → Base_ActivityTheme_Default        values-v33/styles.xml:9
      → Base_ActivityTheme_Core         values-v25/styles.xml:3
        → Theme.AppCompat.Light         Android/AppCompat parent chain
```

Then the global/default option overlaps described below apply, followed by force=false `TopPoweruiStyles` (`values/styles.xml:6659`) and `BasePoweruiStyles`. The Light lineage starts with `ActivityTheme_White` in base values, then the same qualified Default/Core lineage. A different orientation, API level or large-screen configuration can select a different definition of a style before its parent is resolved. In particular `values-sw2dp-land-v29/ActivityTheme_Black` is more specific to landscape than the unqualified API33 portrait branch. Do not merge all identically named resource declarations indiscriminately.

## Built-in options and confirmed defaults

The following defaults are **declared and read by code when no saved override exists**. They are not evidence of the owner's settings. `SkinInfo` parses selectable `defaultValue` into `.О` (`SkinInfo.java:674–675`) and boolean `checkedByDefault` into `.X` (`940–941`); `wv1.x` consumes those fields. Unspecified selectable defaults remain zero, meaning no extra overlap style. These are stable resource IDs/attributes, not necessarily ordinal UI indices.

| Setting/key | No-override behavior | Effect relevant to this reference | Evidence |
|---|---|---|---|
| built-in `alt_layout` | no extra overlap (Default) | labels/buttons on cover | builtin XML7–11,74–78; `SkinSelectableSkinOptions` zero field default; `wv1.x` |
| `font_variant` | `ActivityTheme_BoldFont` | selects Bold text substyles; `BoldFont_font=@font/ttnormspro_bold` | builtin XML33/100; styles12124,12150–12151,12207,12331–12338 |
| `more_buttons` | true in both skins | extra previous/next category and track controls, different pause styling and time-label anchors | builtin XML47/114; styles3092–3101 and3289–3298 |
| `seekbar` | no extra overlap | `TopWaveseek → TopWaveseekBase`, scrolling100-bar declaration | builtin XML42/109; styles7473,16628; drawing/input code in reports05–06 |
| `seekbar` Static option | selected style differs by skin | `TopWaveseekStatic`, fixed60 bars, .5dp spacing | styles3087–3091,3284–3288,7475–7481 |
| `seekbar` Plain option | `overlap_plain_seekbar` | replaces waveform/control layout family with `PlainSeekbar_*` | styles9007–9032 |
| `rounding` | no extra overlap (“More rounded”) | art corner18.75dp; more-rounded navbar dimensions | builtin XML38/105; corev25:145,180 |
| `track_labels_align` | no extra overlap | Default alignment; centered variant only meaningfully applies to alternate/full-cover layouts | builtin XML13/80, styles291 and13381 |
| `labels_bg` | no extra overlap (“Enabled”) | line background remains present; alternative-layout selector can hide it | builtin XML18/85 |
| `player_buttons_bg` | no extra overlap (“Enabled”) | native transport backgrounds remain | builtin XML23/90 |
| `mu_colors` | no extra overlap, API31+ option | optional Material You color overrides, not universally enabled | builtin XML28/95 |
| `light_buttons` | false, Light skin only | optional light control graphics/tints | builtin XML48 |
| `navbar_bg`, `android_navbar_bg` | no extra overlap | themed app navbar and Android bar handling | builtin XML60/66,129/136 |
| `navbar_offset` | false | no extra offset overlap | builtin XML65/135 |
| `rating_type` | 1 | `OptionRatingLikeUnlike`: thumb layout and wider title/line2 anchors | `c40.java:129`, `wv1.java:111–135`, styles8610 |
| `aa_aspect` | 1 | `OptionAAKeepAspect → AAImage_scaleType=fitCenter`; custom renderer semantics still apply | `c40.java:147`, `wv1.java:142–149`, styles11355 |
| `hide_menu` | false | art menu can remain | `c40.java:158`, `wv1.X` |
| `main_lyrics_button` | 1 | no global hide-lyrics overlap | `c40.java:176`, `wv1.java:139–141` |
| `show_counter` | false | middle sub-art slot is a gap rather than counter | `c40.java:130,220,255–260` |
| sub-art button arrays | vis, sleep, gap/counter, shuffle, repeat | editable independently for portrait/landscape, size and row preferences | `c40.java:220–243`, `SubAAButtonsLayout` constructor |
| `navbar_seekbar` | true | optional mini-player seek line when navbar state permits | `c40.java:179`; private navbar transitions in report04 |
| `aa_blur_enabled` / blur parameters | true; level5; intensity100; scale5; saturation150 | background appearance varies with art and renderer processing | `c40.java:142–146`; report06 |
| `hide_status_bar` | false | top inset normally reserved | `c40.java:121`; inset supplement below |
| `orientation` | 0 | no explicit portrait/landscape request in `setOrientationFromPrefs` | `c40.java:120`; inset supplement |
| `anim_long_labels` / `anim_long_labels_in_lists` | true / false | marquee eligibility differs by surface | `c40.java:159,242`; no fixed marquee phase assumed |

A frequent false chain is **more_buttons=true ⇒ fixed60 waveform**. These are separate settings. More-buttons changes the extra layout/time/pause mappings; only the Static seekbar overlap chooses `TopWaveseekStatic` in the inspected built-in styles. Both layout and rendering reports retain this distinction.

## Effective component mappings for Default + default options

| Component | Mapping after options | Base/scene and runtime notes |
|---|---|---|
| art geometry proxy | `TopAABounds2 → ListSubstyle2 → ListSubstyleBase2` | `matchAASubstyle=true`, `offsetWindowInsets=statusBar|navigationBar`; actual list uses same substyle family |
| list root | `TopListWidget`, listSubstyle=`ListSubstyle2` | offset insets, reserved toolbar refs, art-rendering callbacks |
| art view | `ItemTrackAAImage` + `ItemTrackAAImage_scene_aa` / `scene_aa_playing` | image scale .975/1; corner attrs; custom scale-type path |
| title | `ItemTrackTitle`; art scene replaced by `_scene_aa_w_rating` | rating overlap wins over catalog fallback because fallback applies force=false |
| secondary label | `ItemTrackLine2`; art scene replaced by `_scene_aa_w_rating` | empty-label rule and actual font determine measured height |
| rating include | `merge_item_aa_rating_thumbs` | stars and disabled/menu modes select different outcomes |
| sub-art row | `TopSubAAButtons → TopSubAAButtonsBase` | current per-orientation preferences populate slots |
| waveform region | `TopWaveseekLayout → TopWaveseekLayoutBase` | independent root region bounded by art and navbar proxies |
| waveform | `TopWaveseek → TopWaveseekBase` | more-buttons does not replace it |
| pause | `TopPauseMoreButtons → TopPause` | default more-buttons override, with `main_pro_pause` drawable |
| pause playing scene | `TopPauseMoreButtons_scene_playing` | max size differs from initial play max |
| play | `TopPlay` | playing scene alias `TopPlayMoreButtons_scene_playing → TopPlay_scene_playing` |
| elapsed/duration | `TopTrackElapsedMoreButtons` / `TopTrackDurationMoreButtons` plus corresponding playing scenes | bottom-to-bottom waveform anchor and qualifier margins |
| bottom meta | `TopMetaInfoLayout`, `TopMetaInfo`, `TopMetaInfoLabel` | separate from hidden track-item `#meta` |
| navbar | `Navbar → Base_Navbar`, separate private scene container | mini-list/seek visibility controlled by navbar scenes |
| system bar paint | `TopFitsStatusBarView` / `TopFitsNavigationBarView` | backgrounds from theme, bounds from actual WindowInsets |

This table establishes the effective style identities, not a declaration that every view is visible in every state. Scene visibility and runtime state overlays still apply.

## Layout families and what changes

| Built-in layout choice | Key path | Established behavior |
|---|---|---|
| Default | catalog mapping described above | title/secondary/rating remain over cover; `aaMarginBottom` reserves control area |
| Alternative layout | `ActivityTheme_Whitepro_AltLayout` (Black inherits a related wrapper) | replaces art, label, rating/menu, root list/AABounds/control styles; art consumes vertical space, uses an extra bottom reference, then labels occupy space below the image |
| Full cover | `Base_ActivityTheme_AltLayout2 → ActivityTheme_Whitepro_AltLayout` | further replaces art/labels/rating/menu/proxy/list styles; has its own art bottom-padding dimension and child anchors, intended to move all labels/buttons below cover |

The location claims are supported by style operations, not just the user-facing names: `Alt_ItemTrackAAImage_scene_aa` has `layout_consumeSpace=vertical|size|skip_last_margin`, `layout_minHeight=56dp` and `layout_marginBottomRef=Alt_TopAABounds_marginBottom_plus_8dp` (`styles3178`); base alternate labels attach to the remaining parent space (`970–1003`). Full-cover art/labels/rating have additional overrides (`styles124–190`, `11893–11915`). `Alt_ListSubstyle_Base` adds `aaPaddingBottom`, an alternate margin and `aaMinSize=50dp` (`8807–8822`). Applying Default geometry to these modes is not faithful.

The APK's own English descriptions agree: `skin_summary_default` says labels/buttons on cover; Alternative moves labels below; Full cover moves labels and buttons below (`values/strings.xml:2078–2080`). These strings corroborate the resource chain; they do not supply measured bounds.

Landscape is also a structural change. `values-land/styles.xml:656–675` left-aligns art (`aaGravity=left`), makes the AABounds proxy use inset/parent anchors and a navbar-size bottom reference, and assigns `ListSubstyle2.aaMarginBottom=@id/navbar_bounds_size`. The waveform region attaches to the right of `aa_bounds`, to the right inset, with 160dp declared height and vertical gravity target `aa_bounds` (`479–489`); sub-art buttons move into the right-hand column above navbar (`491–502`). Large-landscape overrides replace some of those dimensions. Do not rotate a portrait mockup and call it landscape support.

## Qualifier selection and example resolved dimensions

`UI-DIMENSION-VARIANTS.json` is a generated index of **167 relevant dimension declarations** including source path and line. It deliberately labels declarations as declarations. Values are not all active together.

The APK has UI-relevant style/dimension configurations for base, API22/23/24/25/26/27/28/29/31/33/35, portrait/landscape, `sw2dp`, `sw3dp`, minimum widths and heights, screen-size classes, long/notlong, density (including device-specific xxxhdpi combinations), LTR/night/watch and language-specific typography. Main-player dimensions include dense threshold families such as `sw360dp-h530dp-port`, `h567dp`, `h610dp`, `h640dp`, `h660dp`, `h708dp`, `h730dp`, plus sw380/sw390/sw400 and tablet branches. Each resource is selected independently; a directory containing a newer EQ dimension does not override a different waveform dimension it does not define.

For the specifically declared `MODEL-P360` condition in report02, with the Default more-rounded style chain and no further runtime override, these resource substitutions are applicable:

| Name / use | Selected value | Selected source |
|---|---:|---|
| `ListSubstyleBase2_aaMarginBottom` | 200dp | `values/dimens.xml:279` |
| `track_children_scene_aa_margin` | 18dp | `values/dimens.xml:228` |
| `TopSubAAButtons_marginTop` | 0dp | `values-sw360dp-h567dp-port/dimens.xml:10` |
| `TopWaveseekLayout_paddingTop` | 16dp | same:11 |
| `TopWaveseek_maxHeight` | **112dp** | `values-sw320dp-h630dp-port/dimens.xml:6` |
| `TopPlay_maxSize` | 82dp | `values-sw360dp-h610dp-port/dimens.xml:9` |
| `TopPauseMoreButtons_maxSize_scene_playing` | 80dp | same:14 |
| `TopSmallButton_size` | 42dp | same:10 |
| `TopMediumButton_size` | 58dp | same:11 |
| `TopBaseButtonLayout_width/height` | 58dp /30dp | `values/dimens.xml:153–154` |
| `TopTrackElapsedMoreButtons_marginBottom` | 0dp | `values-sw360dp-h567dp-port/dimens.xml:15` |
| `TopTrackElapsedDuration_height` | 25dp | `values/dimens.xml:281` |
| `TopMetaInfoLayout_marginBottom` | 4dp | `values/dimens.xml:167` |
| `Navbar_height` | 48dp | `values-sw360dp-h610dp-port/dimens.xml:12` |
| `NavbarBounds_height_more_rounded` declaration only | 58dp | same:3; **not the value consumed by stock TopNavbarBounds heightRef** |
| `Navbar_marginB_more_rounded` | 8dp | same:5 |
| `NavBarButton_drawableSize` | 32dp | same:13 |
| `ItemMiniplayerAAImage_size` | 36dp | same:6 |
| `corners_miniplayer_aa` | 12dp | same:16 |
| `corners_navbar` | 28dp | same:17 |

The waveform example illustrates why a base `128dp` value would be wrong for this condition even though the h640 folder does not contain a waveform entry. Available measured space may still be less than a declared maximum, so these **maxima are not final control sizes**.

No numerical Android-pixel dimensions are asserted: no real density/DPI was measured. `dp`, `sp`, dimensionless scale, alpha, integer scene IDs and integer milliseconds must remain distinct. Some geometric minima are in sp (`aaMinSize=130sp`), whereas many text dimensions in this APK are in dip. Do not automatically convert every text number to sp. The exact platform's SP conversion, actual `fontScale`, and text rendering must be evaluated on the native runtime before pixel matching.

## Resolved navbar reference formulas

The stock `TopNavbarBounds.layout_heightRef` is `@id/navbar_bounds_size` (`styles.xml:7950–7955`). Its resolver is **not** the similarly named `bottom_navbar_bounds_size` theme attribute. `TopNavSceneFastLayout` implements marker `mv`; `FastLayout.o1` and its measure paths find that owner and use `dc0.B`. `BaseApplication.c` registers the active theme/resources into `dc0.X/A`. `dc0.В(int)` then computes the ID references (`jadx/sources/ׅ/dc0.java:267–333`). [PA1031-UI-033]

Let `D(attr)` mean `AUtils.w`'s resolved `TypedValue.complexToDimensionPixelOffset` for **each** dimension separately (`AUtils.java:629–641`). These are integer Android pixels after truncation/conversion, not one sum rounded at the end:

```text
normal = D(navbar_marginB) + D(Navbar_height)
twoLineWithoutSeek = D(navbar_marginB) + D(navbar_marginT)
                   + 2*D(Navbar_height) + D(NavbarList_marginBottom)
threeLine = twoLineWithoutSeek + D(NavbarSeekbar_marginTop)
          + D(NavbarSeekbar_marginBottom) + D(NavbarSeekbar_height)
navbar_bounds_size = normal
navbar_bounds_3lines_size = threeLine
navbar_bounds_2lines_size = navbar_seekbar ? threeLine : twoLineWithoutSeek
```

The last conditional matters: the nominal two-line reference reserves the three-line amount when the global `navbar_seekbar` is true, which is its no-override default (`c40.java:180`). The shared helper is `dc0.у`, lines194–235. Its Java formula and the conditional were cross-checked against smali methods `у()I` at file1217 and `В(I)I` at1577.

For `MODEL-P360`, the inputs are navbar marginB8dp, height48dp, marginT4dp, list marginBottom−4dp, seek marginTop0dp, marginBottom−6dp and height32dp. Thus **before per-attribute pixel conversion** the normal/two-without-seek/three expressions sum to56dp/104dp/130dp; both two/three reference IDs use the130dp expression with default seek enabled. No actual device pixel size is claimed. Sources: `values-v25/styles.xml:275–276,313,322,454,507,587`; `values-sw360dp-h610dp-port/dimens.xml:5,12`; `values/dimens.xml:7,30–31,37`. The table's58dp `NavbarBounds_height_more_rounded` is still a real resource declaration, but using it as the stock proxy's effective height would skip the executable resolver and be wrong.

## Remaining effective-value gaps

1. Owner's selected Light/Black mode, Default/Alternative/Full cover, seekbar style, more-buttons, font choice, rounding, label backgrounds, sub-art order/rows, artwork aspect, rating mode and navbar seek toggle.
2. Real API level, `Configuration` qualifiers, density, fontScale, root dimensions and effective post-adaptation insets.
3. Live measurements after wrap-content text, font-pad adjustment, scale compensation, gravity groups and `layout_consumeSpace` in the custom FastLayout solver. Its large reconstructed layout method includes decompiler warnings; individual visible anchors are established, full pixel reproduction is not.
4. Native measured effects of the now-resolved navbar reference formulas above and the active private scene. The formulas are static facts; actual post-conversion pixels, animated reserved space and orientation-specific appearance still require a hierarchy capture.
5. Actual theme attributes after Material You, rounded-screen and owner preference overlays. A base theme palette must not be labeled the owner's palette.

These are evidence gaps with concrete next retrieval steps, not permission to choose attractive substitutes.

## System insets and orientation (independently traced supplement)

`TopNavSceneFastLayout.onApplyWindowInsets` delegates to inherited `j22.X`, caches the returned object and requests layout. `FastLayout.S/e1` propagates/caches effective edges: API>=30 reads `systemBars|displayCutout` **ignoring visibility**; API29 uses `getSystemWindowInsets`; older versions use individual system-window edges. These effective edges, not screenshot chrome guessed from proportions, belong in the atlas equations. [PA1031-INSET-001–003]

For API>=29, `j22` defines lower/upper bottom thresholds `round(2*density)` and `round(25*density)`. If the relevant bottom is greater than the lower and at most the upper threshold, subtract `reduceBottomInset` and clamp to zero. Stock `TopContainer` resolves this attr through `Navbar_normal_marginB=4dp`. API29 tests system-window bottom; API>=30 tests navigation-bars bottom ignoring visibility and updates both visible/ignoring variants. It is therefore incorrect to subtract 4dp from every Android bottom inset. Devices outside this interval keep their bottom inset.

`hide_status_bar` is declared false in `c40`. On API>=30, if true, the adapter clears status-bar insets and the top display-cutout edge while preserving left/right/bottom cutout edges. Exact actual edges remain device evidence gaps. No dp-to-CSS-pixel equivalence is implied.

The `orientation` preference defaults0 (the sensor entry). `BaseActivity.setOrientationFromPrefs` leaves orientation unchanged for0, forces portrait for1, landscape for2. The `o2` activity helper also supports temporary ref-counted orientation locking; rotation during a captured gesture needs runtime verification. Android font scale is an independent input, particularly where the layout uses sp in geometry such as minimum artwork size; no owner font scale is known. [PA1031-INSET-004]

Precise source locations and cross-checks are in the ledger. These claims describe conditional code behavior, not measured phone geometry.
