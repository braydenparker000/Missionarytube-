# Poweramp 1031 — resolved player UI atlas

This is a static reference for the supplied APK, not an observed screenshot. Evidence IDs `PA1031-UI-*` are in the combined ledger. `decoded/` paths refer to Apktool 2.11.1 output; `jadx/` paths refer to the no-renaming JADX output. Original resource names are retained deliberately.

## Scope and reference condition

The worked condition below is the built-in Black skin, **Default** layout, default global appearance settings, ordinary portrait phone configuration, no third-party skin, no rounded-screen override, no visualization, no popup, settled center track, and no gesture in progress. Black is a specified research condition, not a claim about the owner's current selection. The Light skin shares the main geometry but changes theme attributes. User preferences are not bundled in the APK.

For the explicit resource-selection example, use `MODEL-P360`: Android API 36, `smallestScreenWidthDp=360`, width 360dp, height 640dp, normal/long/portrait, LTR, font scale 1, with effective window insets left/right/top/bottom retained as parameters. This is an **analytical configuration**, not a captured device or a pixel-parity reference. Never substitute its dimensions for owner measurements.

## View ownership and actual source tree

`MainActivity.onCreate` inflates `R.layout.activity_main` (`jadx/sources/com/maxmpz/audioplayer/MainActivity.java:86`). The only APK layout definition of that name is `decoded/res/layout-sw2dp/activity_main.xml`. A normal phone satisfies `sw2dp`; orientation changes are primarily style/dimension substitutions, not a second `activity_main_land` tree.

The full-player artwork and labels are **not separate children of the activity root**. They belong to a reusable list item. `TopListWidget` selects `ListSubstyle2`; `om0` reads that resource at construction (`jadx/sources/ׅ/om0.java:100–125`), creates `hl0`, and the full-art page creates `C`, a subclass of `P` (`jadx/sources/ׅ/С.java:122`, `ׅ/C.java:13`). The track adapter can inflate `item_track` (`ׅ/e4.java:152`). Its `AAItemView` is the source of the visible art/title/subtitle composition.

The relevant source tree is:

```text
activity_main <merge>
├─ PlayerConnectionBehavior                       (behavior, not visible decoration)
└─ TopNavSceneFastLayout #top_container
   ├─ MilkWidget #milk                            backdrop / visualization rendering
   ├─ ListWidget #list                            full-art / library / lyrics page owner
   │  └─ dynamic AAItemView from item_track
   │     ├─ PlayingMark #playing_mark              hidden in art scenes
   │     ├─ FastTextView #num                      track numbering, scene-specific
   │     ├─ AAImageView #aa_image                  actual foreground artwork
   │     ├─ CatImage #cat_image                    category/list decoration
   │     ├─ MarqueeFastTextView #title             one title label
   │     ├─ MarqueeFastTextView #line2             one combined secondary label
   │     ├─ FastTextView #meta                     list item metadata; invisible in art scene
   │     ├─ DragHandler #drag_handler / #select_box library selection/reordering
   │     └─ LoadableBehavior #behavior_aa_and_header
   │        └─ merge_item_aa_and_header
   │           ├─ FastButton #menu
   │           ├─ LyricsButton #lyrics
   │           ├─ NonOverlappingView #aa_panel     stock art mapping hides it
   │           └─ optional rating include
   │              └─ LikeUnlikeLayout #rating → #like, #unlike (default rating_type=1)
   ├─ AABounds #aa_bounds                          invisible geometry proxy, not image renderer
   ├─ MediaRouteButton #cc_button
   ├─ FastLayout #waveseek_layout
   │  ├─ Waveseek #waveseek → #waveseek_cursor
   │  ├─ BusActionButton #play_pause_behind
   │  ├─ BusActionButton #pause / #play             overlapping state alternatives
   │  ├─ optional more-buttons include             default enabled in both built-in skins
   │  │  └─ #prev_cat, #rw, #ff, #next_cat, #top_probuttons_separator
   │  ├─ Elapsed #track_elapsed
   │  └─ Duration #track_duration
   ├─ optional TopContainer extra include
   ├─ merge_meta_info_layout → #meta_info_layout → #meta_info → #_label
   ├─ ListScrollerView #list_scroller
   ├─ SubAAButtonsLayout #sub_aa_buttons            dynamic editable button slots
   ├─ LoadableDraggableButtonsBehavior
   ├─ loadable EQ and search behaviors             scene-conditional inflation
   ├─ InvisibleView #navbar_bounds                 geometry proxy
   ├─ SceneFastLayout #navbar_container             private navbar scene
   │  ├─ Shim #navbar_shim
   │  └─ Navbar #navbar
   │     ├─ NavbarExtension #navbar_extension       settings/help sheet
   │     ├─ PowerList #navbar_list                  distinct mini-player page list
   │     │  └─ AAItemView from item_miniplayer
   │     │     └─ AAImageView #aa_image, #title, #line2, PlayPauseButton #button
   │     ├─ Seek #navbar_seekbar                    optional third line
   │     └─ FastLayout #navbar_nav_buttons
   │        └─ #cmd_nav_to_lib, #cmd_nav_to_eq, #cmd_nav_to_search, #cmd_nav_more
   ├─ loadable visualization panel
   ├─ ListIndexerPopupView #list_indexer
   ├─ #menu_placeholder / #menu_placeholder2
   ├─ selection menu / upper toast / toast includes
   └─ FitsStatusBarView #status_bar_bg / FitsNavigationBarView #navigation_bar_bg
```

`SceneParams` and `StateAnimParams` entries in these files are layout/animation metadata attached by the custom inflater, not additional painted boxes. The tree above is a source-level ownership map; dynamically loaded content and current children require runtime enumeration to verify. Relevant layouts: `layout-sw2dp/item_track.xml`, `merge_item_aa_and_header.xml`, `merge_item_aa_rating_thumbs.xml`, `merge_meta_info_layout.xml`, `merge_navbar.xml`, `item_miniplayer.xml`; transport extras are `layout-sw3dp/merge_topwaveseeklayout_extralayout.xml`.

## Effective artwork chain, including a verified decompiler correction

The active stock mapping is:

```text
MainActivity → activity_main → style ?TopAABounds
built-in theme → ?TopPoweruiStyles = @style/TopPoweruiStyles
TopPoweruiStyles.TopAABounds = @style/TopAABounds2
TopAABounds2 → ListSubstyle2 → ListSubstyleBase2
AABounds constructor → P(...); onMeasure → P.s → P.v → P.w
actual ListWidget → TopListWidget.listSubstyle = ListSubstyle2
om0 → hl0 → С → C extends P (same geometry parameter family)
```

This matters because legacy `TopAABounds` and `ListSubstyleBase` declarations also exist. They are not the mapping used by stock `TopPoweruiStyles`. See `decoded/res/values/styles.xml:6836,7441,11251–11292` and `jadx/sources/com/maxmpz/widget/player/AABounds.java:30–43,98–114`.

For the default portrait chain, inherited resource/code values are:

| Input to `P` | Effective source | Value in this condition |
|---|---|---|
| `aaItemRatio` | absent in `ListSubstyleBase2`; constructor fallback in `AABounds` and `hl0` | 1.0 |
| `aaGravity` | absent in portrait substyle; constructor fallback | 0, automatic center unless alternate-wide predicate fires |
| `aaMaxSize` | absent; constructor fallback | 0, meaning no additional maximum |
| `aaMinSize` | `ListSubstyleBase2` | 130sp |
| `aaPaddingLeft/Top/Right/Bottom` | absent; constructor fallback | 0 |
| `aaMarginLeft/Top/Right` | absent; `dc0.y` conversion | 0 |
| `aaMarginBottom` | `ListSubstyleBase2` → dimension | 200dp for ordinary phone portrait; qualifier variants exist |
| `aaItemBoundsMatchList` | absent; constructor fallback | 0; both match-width/match-height flags false |
| `altAaLayoutRatio` | `ListSubstyleBase2` | 1.85 |
| `maxAvailSizeForAltAaLayout` | `ListSubstyleBase2` | 290dp |
| system inset offset | `TopAABounds2` | status bar and navigation bar flags |

Attribute indices are independently mapped by `jadx/sources/ׅ/wa1.java:7,66`; actual list style reads are in `ׅ/hl0.java:96–121`. `P`'s Unicode/Cyrillic field names must not be silently normalized: e.g. `C` and `С`, `a` and `A`, `о` and `o` are different fields.

The decompiled `P.v()` contains undeclared `r4/r5` temporaries, and `P.w()` reverses a height-match branch. The reference equations below are checked against `decoded/smali/ׅ/P.smali`, method `v()Z` at line 2121 and `w(IILׅ/sj0;)F` at line 2488. In `w`, DEX `.line 87–106`, **Z=true** takes bottom from available list bounds; **Z=false** takes `top + roundedSide + aaPaddingTop + aaPaddingBottom`. Thus the stock flag value 0 produces a square item, not a stretched full-height item. This is a concrete reason not to implement straight from the reconstructed Java.

### Parameterized geometry

Use actual Android resource conversions before these equations. Internally the code works in integer pixels; here uppercase quantities are converted measurements, not CSS values.

Let root/page bounds be `W,H`, effective padding/insets be `I_L,I_T,I_R,I_B`, explicit art paddings be `P_L,P_T,P_R,P_B`, art margins be `M_L,M_T,M_R,M_B`, minimum be `N`, ratio be `r`, and optional maximum be `Q`.

```text
U = max(N, W − I_L − I_R − P_L − P_R − M_L − M_R)
V = max(N, H − I_T − I_B − P_T − P_B − M_T − M_B)
s = min(U,V) × r
if Q>0:
    if U>V: s = min(s, Q−P_T−P_B)
    else:   s = min(s, Q−P_L−P_R)
s = max(N, min(s,U,V))
S = int(s+0.5)
alternateWide = (V ≤ 290dp) and (U/V ≥ 1.85)
```

Under the specified ordinary portrait condition (`alternateWide=false`, no swiping, no additional scale), `P.s` centers the item horizontally; `P.w` gives:

```text
itemLeft = Math.round(floor(W/2) − s/2) − P_L
itemTop  = I_T + M_T
itemRight = itemLeft + S + P_L + P_R
itemBottom = itemTop + S + P_T + P_B
```

For the default zero paddings/margins other than `M_B`, this reduces to a square of side `S=max(N,min(W−I_L−I_R,H−I_T−I_B−M_B))`, positioned at `x≈(W−S)/2`, `y=I_T`. The automatic centered case uses the integer page center (`Rect.centerX()`), not a separately assumed CSS safe-area center; `MathKt.А` delegates to `Math.round`. `AABounds.onMeasure` strips explicit art horizontal/bottom padding from its proxy result and adds its own top padding; for the zero-extra-padding stock case its measured size is `S × (I_T+S)`. It is an anchor proxy for controls below the art. `AABounds` is not itself the image.

An **analytical dp example**, not an observed device: with `W=360dp,H=640dp`, effective `I_T=24dp,I_B=24dp,I_L=I_R=0`, font scale 1, and `M_B=200dp`, the model produces `S=360dp`, item at `(0,24dp)`, proxy height `384dp`. Do not turn this into purported native screenshot measurements.

### Foreground image inside the item

`ItemTrackAAImage_scene_aa` sets 8dp margin on each side, fills available width/height, matches height to width, requests high-resolution art, `aa_elevation`, and corner attribute `corners_aa_scene_aa`. For the square item the untransformed image view is therefore `(itemLeft+8dp,itemTop+8dp)` with side `S−16dp`, subject to Android rounding and the custom FastLayout solver. The local art view scene scale is **0.975 in `scene_aa`** and **1.0 in `scene_aa_playing`**. The latter inherits the rest of the former through `baseScene` (`styles.xml:4410–4437`). Default more-rounded core theme gives `corners_aa_scene_aa=18.75dp` and `aa_elevation=4dp` (`values-v25/styles.xml`, same named items; also base `values/styles.xml:10243,10265`). Runtime corner rendering and source-bitmap geometry are documented in report 06.

`P.w` chooses item scene by `v & 15`: 0 → `scene_aa`; 1 → `scene_aa_playing`; 2 → `scene_aa_vis`; negative decor positions keep `scene_aa`. This branch was checked in smali DEX `.line 178–204` against `public.xml` IDs `0x7f0d028d/0295/0294`, correcting contradictory JADX output. Do not infer that any variable named “playing” equals an entire screen route; the outer and inner scene systems are separate.

Crop behavior also requires a complete chain. `c40.t` defaults `aa_aspect` to 1 (`ׅ/c40.java:147`); `wv1.X` maps 1 to `OptionAAKeepAspect` (`ׅ/wv1.java:142–149`), which maps `AAImage_scaleType=fitCenter` (`styles.xml:11355`). **That is a selector name, not proof of generic Android ImageView or CSS contain semantics.** `AAImageView` has a custom matrix and bitmap shader; see report 06 for its portrait/other-source branches. Option 2 selects `OptionAACrop`; the owner's current option remains unknown.

## Over-art labels and the lower control region

The reference Default layout places its title, second line, rating and menu in the art item's lower region, **over the artwork**, rather than in an independent title stack below a hero image. A separate `meta_info_layout` sits near the bottom controls; do not confuse it with the invisible `#meta` inside `item_track`.

| Element | Resolved stock relationship | Runtime-dependent parts / exact source |
|---|---|---|
| `#title` | `ItemTrackTitle_scene_aa_w_rating` → `ItemTrackTitle_scene_aa`; left and right parent anchors, 18dp side margins in phone resources, 1dp gap before `#line2`; inverse text and rounded translucent line background | `OptionRatingLikeUnlike` selected by default rating 1; title width/height depend on actual text/font; styles 1006,4731,8610 |
| `#line2` | `ItemTrackLine2_scene_aa_w_rating` → base art line2; below title, anchored above `#rating`, 1dp bottom margin, parent side anchors | one `str2` passed to `AAItemView.m`, not separate artist/album nodes; empty label can be gone; styles 4910,9644; `AAItemView.java:324–346` |
| `#rating` | `LikeUnlikeLayout`, bottom/left in item, left and bottom 18dp margin, two thumb buttons | default layout include from `OptionRatingLikeUnlike`; stars/disabled/menu options alter the block; styles 5177,13549 and rating include |
| `#menu`, `#lyrics` | dynamically loaded from `merge_item_aa_and_header`, art-scene styles; placement changes for rating and alt-layout modes | lyrics can hide when empty; title right edge is not always `#lyrics` because default rating overlap replaces that anchor |
| `#meta` inside track item | invisible in art scenes | full-player metadata uses the separate root meta include; styles5073 |
| `#sub_aa_buttons` | root sibling, after `#aa_bounds`; phone side margins 8dp; height wraps dynamic slots | preferences determine buttons/rows; styles7823,16479 |
| `#waveseek_layout` | full width between `#sub_aa_buttons` and `#navbar_bounds`, 24dp bottom margin, qualifier-selected top padding | holds waveform and overlaid transport; styles7451 |
| `#waveseek` | centered vertically, fill available size, horizontal padding8dp, capped height from qualifier | wave rendering separate from layout; styles16628 |
| `#play` / `#pause` | centered within waveform region; alternate visibility and size in playback scene | default `more_buttons` changes pause to `TopPauseMoreButtons` and `?main_pro_pause`, not legacy narrow pause rectangle; styles3092,7759 |
| `#rw`,`#ff` | adjacent to center play or pause, 2dp gap; `#prev_cat/#next_cat` outside them | capped sizes are qualifier dependent; extras included by skin option; styles7647–7773 |
| time labels | default `more_buttons` selects `TopTrackElapsedMoreButtons` and `TopTrackDurationMoreButtons`; left/right parent anchors with 12dp respective outside margins, bottom-to-bottom waveform attachment | each inherits gravity from its base (elapsed center, duration center_vertical); actual solver/gravity result needs native bounds; do not assert a fixed time-label y from the resource alone |
| `#meta_info_layout` | root sibling anchored above `#navbar_bounds`, wrap height, minimum20dp, dimension bottom margin | alpha .75/scale .95 baseline, alpha1/scale1 playing scene, seeking alpha .45/scale .85; styles8203 |
| `#navbar_bounds` | invisible full-width bottom-inset anchor; height reference `navbar_bounds_size = D(navbar_marginB) + D(Navbar_height)` | model resolves to the sum of8dp and48dp conversions; this is not the unused58dp bounds dimension; styles7950, `dc0.java:270–282` |
| `#navbar` | bottom inset, side margin `?navbar_marginLR` (base8dp), bottom margin `?navbar_marginB`, four equal-flex buttons | navbar private scenes produce mini-player and optional seek lines; styles10905,6331 |

The title/line2 base styles have `translationZ=?over_aa_elevation` and no outline provider (`styles.xml:4594,4777`); core maps that to 4dp. Text backgrounds are generated/drawn at line level, not proof that the whole row is a full-width opaque rectangle. Exact line widths, baseline positions, glyph metrics, clipping and marquee phase require actual strings and native font measurement.

The default sub-art slots are `vis, sleep timer, [counter or gap], shuffle, repeat`. This is executable preference initialization, not an inference from icon order: `ׅ/c40.java:220` initializes the array; `e()` at255 substitutes `subaabutton_counter` only when `show_counter` is true, which defaults false. `SubAAButtonsLayout` reads portrait/landscape saved arrays and layout-size/line preferences (`SubAAButtonsLayout.java:128–210`). The owner can alter this row within the built-in skin.

## Label content for the All Songs reference condition

The title and artist/album content chain is also recoverable, conditionally. The full-art page `С.P` creates provider `Р → ze → xc`; `С.Н` builds the query projection with `u12.В`. Projection column1 is `uf1.e()` and column2 is `uf1.C0() → e1()`. The All Songs provider `sf1 → tf1 → uf1` does not override those selectors. `ze.r/l` takes pending `mh0` overrides when present, otherwise cursor columns1/2, and `xc.e → AAItemView.m` binds the two text Views. [PA1031-TEXT-001]

Registered defaults are `title_filename=false`, `use_albumartist=false`, `hide_unknown_album=true`, `hide_unknown_artist=false`. In that condition the title comes from `title_tag`; the secondary string is **artist - album**, with exactly a space/hyphen/space separator. Album sentinel ID1000 yields artist alone. This branch was verified against `uf1.e1` smali (`:cond_0`). An unknown-artist sentinel is not silently discarded by this default query branch. Saved options, alternate providers and input database normalization can change the text.

`jx0.Н → u12.В` builds the mini-player projection too; `hx0.О` uses the same columns1/2 and pending overrides. A tag-edit override in `p31.у` constructs artist - album when both new components are available, or the available component alone. These facts close the ordinary All Songs formatting path, not all stream/category metadata cases. No owner media was read. Native font measurement and actual strings still determine final line width, clipping and marquee. [PA1031-TEXT-002]

## Full player, library and mini-player are related but distinct surfaces

`#waveseek_layout` is gone at outer `scene_lib`, scale .75 for transition (`styles.xml:7458`). `#sub_aa_buttons` becomes invisible/scale .75 at library (`7835`). `#meta_info_layout` is gone in library/search/EQ (`8220`). This does **not** mean the large player's waveform merely shrinks to become the mini-player.

`#navbar_list` contains a separate `item_miniplayer` (`ׅ/hx0.java:72–73`); its AAItemView has its own image, two labels and `PlayPauseButton`. `NavbarExtension` controls the private navbar scene even though the extension view itself is the settings/help sheet; mini-list and optional seekbar are its siblings inside Navbar. `merge_navbar.xml` explicitly makes the list visible in 2-line and 3-line scenes, and the `Seek` visible only in 3-line scenes. The default global `navbar_seekbar=true` is established in `c40.java`, but actual visible scene also depends on navigation state.

Mini geometry declarations for Default more-rounded condition:

- `ItemMiniplayerAAImage`: qualifier-selected square (36dp in `sw360dp-h610dp-port`, 28dp base), left margin10dp/right2dp, no elevation, `corners_miniplayer_aa` (12dp in that tall-phone qualifier), `hiRes=false`.
- Root `ItemMiniplayer`: base left padding6dp; title/line2 have 10dp left and64dp right margins; title's vertical gravity target is mini-art. Exact combined label grouping is custom FastLayout behavior.
- `ItemMiniplayerPlayButton`: 60dp ×48dp, centered right, right margin3dp, custom play/pause drawable.
- Navigation row uses four `layout_flexWeight=1` horizontal targets. The icon sizes and row height are selected independently from art geometry.

Sources: `styles.xml:5990–6046,6317–6352,10360`; `layout-sw2dp/item_miniplayer.xml`, `merge_navbar.xml`; `values-sw360dp-h610dp-port/dimens.xml:6,12–16`. These dimensions are declarations in a resolved style chain; hit bounds during animated transitions remain a runtime verification item.

## What is and is not ready

**Ready as static specification:** ownership tree, stock versus alternate mappings, portrait art square-size algorithm, confirmed decompiler branch corrections, label-over-art/default-rating chain, independent metadata/transport/navbar anchors, mini-player's separate view ownership, and the exact source/resource selectors.

**Still open:** native measured bounds of wrap-content/scale-compensated text and controls; secondary-label formatting for alternate providers/streams/localized fallbacks beyond the traced All Songs path; owner preferences; system insets and font configuration; final rounded-screen overrides; precise pixels of custom crop/clipping/shadows; scene-intermediate x/y/z. The native runtime report lists why no live measurements were obtained. The most useful next observation is a full-player screenshot plus hierarchy at known density and settings, then the same for library/mini-player.
