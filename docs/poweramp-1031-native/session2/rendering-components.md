# Session2 secondary rendering components — Poweramp build1031

This is an original technical description of the verified APK, not an asset or source-code redistribution. All findings are static. No Android renderer was executed and no authentic screenshot/video was captured in this session. `decoded/` and `jadx/sources/` refer to the retained private Apktool/JADX evidence workspace. The code is obfuscated and selected JADX methods are malformed; repaired critical expressions and limits are identified below.

Session1 artwork/text/native-backdrop facts are explicitly reused where applicable. New Session2 work follows actual XML or programmatic construction into draw methods and update inputs. Registered preference defaults are not proof of active settings or a clean-install outcome; migrations and owner choices remain separate. Effective theme/API/density/font-scale resolution is supplied by the companion style resolver, and gesture transactions by the gesture report.

## Composition map

| Surface | Construction and renderer | Important distinction |
|---|---|---|
| EQ band controls | EqKnobsList adapter → f10/as/c10 → LinearKnob/RoundKnob | Dynamic controls consume Band snapshots and parameter converters. |
| EQ response | FrequencyResponseScroller → Canvas Paths; parametric evaluator JNI | Distinct from spectrum; graphic and parametric modes use different math. |
| EQ audio-reactive layer | MilkFRS → TextureView → MilkRenderer | Preset-driven native texture under the response layer. |
| Main visualizer | MilkWidget → SurfaceView → native renderer | Preset chooser rows are ordinary custom list/text/icon Views. |
| Library rows/grid/header | e4 factory → shared item templates → AAImageView/FastTextView | Scene geometry changes on reused child Views. |
| Lyrics | xo0 → LyricsItemView/LyricsFastTextView | Paired active-line scene changes preserve text layout width. |
| Settings controls | RoundKnobPreference, TickSeekBar, AmbilwarnaLayout | Custom dial, native SeekBar plus ticks, software HSV plane. |
| Search/dialogs | Custom layouts + FastTextView/EditText/Drawables | Search binders, activity themes and inserted content differ. |

## Detailed component contracts

### EQ construction and shared data input

**Construction:** merge_eq_equalizer_tab_common.xml constructs three distinct surfaces: EqKnobsList, MilkFRS and FrequencyResponseScroller. EqKnobsList creates its own adapter В; adapter о constructs preamp, graphic-band or parametric-card Views from live Band[] data.

EQ is a composition of dynamically constructed band controls, a native audio-reactive MilkFRS texture, and a separate Canvas response/scroll-overview widget. The native texture does not own the response curve.

EqKnobsList.m0 reads dsp_eq_live_bands_snapshot, dsp_enabled and dsp_eq_enabled. On attachment it subscribes to bus_dsp and loads that state; msg_dsp_started and structural msg_dsp_eq_changed reload it. The adapter sets its parametric-presentation flag when Band[] is nonnull and either empty or its first Band.х is true; it creates f10 for graphic gain, c10 for a parametric card, as for preamp, and add/select controls for parametric lists. Its dispatchDraw clips children to [0,0,width,height].

Bass/treble, stereo/balance/tempo/volume and reverb XML create DSPRoundKnobLayout variants with explicit DSP parameter and enabling-parameter IDs. DSPRoundKnobLayout constructs bs (RoundKnob subclass), labels and optional lock controls from style references. These are actual construction routes, not class-name inventories.

Evidence: PA1031-S2-RENDER-001. New Session2 trace.

Limits: No runtime rendering was observed; effective results require explicit configuration and device metric inputs.

### Round knob drawing and angle model

**Construction:** DSPRoundKnobLayout constructs bs; c10 constructs plain RoundKnob for frequency and Q; preference_roundknob and the sleep timer instantiate the same RoundKnob class.

RoundKnob draws a stateful knob Drawable, an optional stroked arc and a separately rotated indicator Drawable; it is not a single rotated bitmap.

For painted normalized value C, indicator angle is minDegree+C*(maxDegree-minDegree). Constructor fallbacks are30° and330°, subject to style. rotateKnob=true rotates the knob body by angle−minDegree; the indicator rotates by the full angle. Canvas is translated by padding, arc inset G and gravity offsets; drawable bounds and pivot are set on size changes.

The arc requires arcStartColor and positive arcWidth. Its signed sweep is (maxDegree−minDegree)*(C−arcStartPoint). It is a ROUND-cap stroked Path outside the knob bounds, with arcOffset, cap-end angular correction and support for additional revolutions. Glow is conditional on API>=29 and s41.B(), plus positive glow width/color. Shape, indicator scale, offsets and state lists remain theme inputs.

Critical angle calculation was read in smali because JADX shows an undefined temporary in onDraw. Source coordinates are resolved Android pixels; constructor angle values are degrees.

Evidence: PA1031-S2-RENDER-002. New Session2 trace.

Limits: No runtime rendering was observed; effective results require explicit configuration and device metric inputs.

### Knob values and colors have separate animation paths

**Construction:** RoundKnob and LinearKnob instantiate color animator in for start/mid/end color-state lists; their own value animators update painted values independently.

Knob highlight colors interpolate HSV channels and alpha, while painted value animation and state-color animation are separate mechanisms.

in.p resolves disabled/pressed/default ColorStateLists. AUtils.Х converts color to HSV+alpha; AUtils.l linearly interpolates all four components, with an optional midpoint at normalized.5, and AUtils.j converts back. Hue follows literal numeric interpolation; no shortest-hue wrapping is present in that method. in requests300ms for animated state-color changes; direct value changes can update color immediately.

RoundKnob.d clamps target to0..1 and requests120ms when absolute delta<=.05, otherwise400ms, using DecelerateInterpolator(2). Changes<=.001 or ineligible attachment/show modes apply immediately. LinearKnob.k requests a linear animator with base500ms, distance scaling and minimum100ms; h5 computes the final duration. These code paths do not establish measured frame cadence.

The registered built-in knob_hilite option selects colorful start/end lists. Their disabled alpha can be zero; pressed colors differ. A constructor consumed attribute may come directly from the final theme even when the component style bag omits it. Therefore an absent arcStartColor/holeStartColor in a component bag does not establish that highlighting is disabled.

Evidence: PA1031-S2-RENDER-003. New Session2 trace.

Limits: Effective animation eligibility depends on widget state and update call. No color rasterization comparison; state ColorStateList resources and custom animator timing must be distinguished.

### Linear knob: track, fill, label and thumb

**Construction:** EqKnobsList adapter constructs f10(context,EqLinearKnob) and as(context,EqPreampLinearKnob); parametric c10 constructs f10 with EqParamGainLinearKnob.

LinearKnob draws the hole Drawable, optional rounded highlight rectangle, KnobLabelAndValue contents and thumb Drawable in that order. Dashed reference lines are a separate b10 background Drawable.

Thumb bounds depend on orientation, available length f(), drawable padding and intrinsic/overridden thumb width/height. Vertical painted value J moves upward as J increases; horizontal J moves rightward. Highlight start fraction h0 is independent of J. The smali-confirmed vertical rectangle uses y endpoints g0 and hole.bottom−h0*(hole.bottom−hole.top); horizontal endpoints are hole.left+h0*hole.width and g0. The code does not explicitly sort those endpoints; do not silently substitute a different negative-gain fill rule.

b10 draws three translated reference strokes, with distinct center and outer colors and a density-scaled dash pattern. EqLinearKnob declares dashes0,8,3,18,3,8; stroke1dp; a thumb/hole selector; explicit thumb dimension resources; minimum touch size48dp. The class fallback touch size24dp is therefore not the EQ effective declaration.

KnobLabelAndValue owns two Paints, label/value text, label background and state/pressed handling. Its draw and measure paths reserve text extents before knob geometry; treating labels as a fixed separate caption can alter usable travel.

Evidence: PA1031-S2-RENDER-004. New Session2 trace.

Limits: Inverted highlight endpoint rasterization requires native pixel observation; report preserves literal source order. Actual thumb/hole bitmap shapes remain proprietary resources; effective sizes require configuration resolver.

### EQ labels, tone labels and unit conversion

**Construction:** f10 constructor and preamp adapter call LinearKnob.q with label preference; DSPToneRoundKnobLayout configures its child RoundKnob after construction.

Graphic-band and preamp control progress is normalized; numeric text is a separate formatter selected by eq_labels or tone_labels.

f10 uses q(-15,+15,c40.R); preamp uses q(-24,+24,c40.R). LinearKnob.q option1 uses %.1f with midpoint0 at normalized.5; option2 uses localized percentage−100..100; other options suppress numeric formatting. Registered eq_labels default is1. Band.X is normalized from−1..1 to0..1 on binding.

DSPToneRoundKnobLayout reads tone_labels:0 suppresses numerical format;1 displays0..15 with one decimal; other values use0..100 percent with zero decimals. Registered tone_labels default is2. Frequency and Q use Band-provided cs format/conversion objects; their units and nonlinear mappings must not be inferred from the common normalized knob angle.

Registered defaults are evidence about initial preference declarations. Migration or existing preferences can produce a different active value even on a newly installed update.

Evidence: PA1031-S2-RENDER-005. New Session2 trace.

Limits: Active configuration must be supplied; relevant fresh initialization is documented by the settings-system reference. Full frequency/Q DSP-value conversion model belongs to DSP parameter definitions; not assumed linear.

### Parametric band composition and color background

**Construction:** EqKnobsList adapter chooses _param→new c10(context) when Band.х marks parametric bands.

A parametric band card contains gain slider, frequency/Q round knobs, type and channel popup buttons, color popup, edit/lock controls, selection box and drag handle.

c10 builds these children programmatically with individual EqParam* style attributes. h10 draws either an inset rounded filled card using the band color, or a vertical dashed separator when fill color is zero and the card is not last. The color popup uses ColorCircleSelector.

c10.z animates old/new band background color for250ms via AUtils.X, К case3 and AUtils.m. That conversion is CIELAB plus alpha (sRGB transfer function, XYZ D65 reference95.047/100/108.883, Lab interpolation, inverse conversion). This is distinct from the HSV interpolation used for knob arcs.

Binding sets gain, frequency, Q, band type, channel selection, lock state and fill color from Band. It supplies frequency/Q-specific conversion/format objects to their RoundKnobs. Lock state changes enabled/locked visual state; it is not represented by one global opacity.

Evidence: PA1031-S2-RENDER-006. New Session2 trace.

Limits: No observed runtime card color frames. Theme controls card insets, radius, separator width and dash spacing.

### Graphic EQ response curve and tone lobes

**Construction:** merge_eq_equalizer_tab_common creates FrequencyResponseScroller with useDSPBus=true; it subscribes to DSP state and receives live bands. Preset rows create the same class in miniMode.

Graphic EQ display is a smoothed illustrative curve through normalized band gain points; its Canvas path does not call the native filter evaluator.

р maps each graphic Band.X from−1..1 to vertical fraction1−((X+1)/2). А spaces points uniformly across content width and joins consecutive points by cubic Beziers whose two control points share the segment midpoint X and use the old/new Y values. Vertical orientation uses the corresponding axis-swapped path.

The background centerline is separate. Bass/treble tone paths are separate cubic lobes near left/right edges, using width fractions.3 normally or.4 in miniMode, plus fill, line and optional glow Paints. The response curve uses lineWidth2dp in the ordinary base style; tone line1.5dp. An optional vertical five-stop gradient uses stops0,.25,.5,.75,1 and graphicColorMax/75/lineColor/25/Min.

The built-in graphic_frs_color selector declares the colorful overlap by default. The precise theme result and constructor theme fallbacks must be included; do not treat the lineColor bag item as the only source of curve color.

Evidence: PA1031-S2-RENDER-007. New Session2 trace.

Limits: This path is not proof of the exact combined acoustic transfer function. Theme/configuration options and native antialiasing output remain unmeasured.

### Parametric response curves and the native boundary

**Construction:** FrequencyResponseScroller.р selects parametric mode from Band.х and builds one c90 path cache per band ID/version; А invokes Р when a curve is stale.

Parametric curves call a native filter evaluator, then build Canvas paths from the returned values; the native call is the unresolved numerical-response boundary.

The call supplies48000 sample rate, Band frequency/type/Q, evaluation endpoints20Hz and24000Hz, count=floor(contentWidth/step), and gain=Band.X*15. Step is2 resolved pixels for ordinary mode and4 for miniMode. Y maps returned response r to midY−r*(usableHeight/30), where usableHeight subtracts parametric stroke width.

The path treats |r|<=.08 as a baseline segment/gap optimization after the first point. Each parametric band has its own stroke/fill color and path. A different per-band stroke width (base1dp) is used; no generic graphic gradient is applied in this mode.

Coefs.java declares native_filter_evaluate_freqs. No attempt was made to reverse the audio DSP, coefficient algorithms or licensing. A faithful rendering experiment can first supply known response arrays; claiming numeric parity requires this boundary or captured reference curves.

Evidence: PA1031-S2-RENDER-008. New Session2 trace.

Limits: Native numerical evaluation algorithm and frequency sample spacing are not established solely by this JNI signature. Returned response units are used with gain/dB-style scaling, but no audio transfer-function verification occurred.

### Response curves: Canvas layers, clipping and preset miniatures

**Construction:** EqPresetPopupListLayout provider factory returns m10; m10.o selects item_eq_preset/2line/3line, each containing FrequencyResponseScroller under id frs.

Ordinary response drawing uses a software-layer child b90 while miniMode draws directly in a hardware-layer FrequencyResponseScroller. Their rendering paths and data reduction are not identical.

Constructor ordinary mode adds selection Drawable via e90 and adds b90(layerType1), setting parent willNotDraw=true. miniMode sets layerType2 and draws directly. b90.onDraw delegates to owner.А. Optional cornerRadius1 builds a clipping Path on size changes; draw clips before translating by padding. The selected scroll viewport is a separate Drawable rectangle and can animate its bounds for250ms.

Preset miniatures are80dp×36dp in ItemPopupListFrs, graphic stroke1.5dp, tone.5dp, parametric1dp. m10 binds either a decoded band blob or legacy textual preset data and caches the input in the View tag. Miniatures have bounded-band reduction branches (including32-band intermediate handling and a separate >10-band curve-update branch); they must not be assumed to be a lossless scaled full EQ plot.

Exact mini-mode reduction semantics beyond the traced branches and all filter serialization variants remain limited. The verified statement is that miniature curves are computed/drawn from preset data rather than stored screenshot thumbnails.

Evidence: PA1031-S2-RENDER-009. New Session2 trace.

Limits: Miniature reduction control flow not fully certified across all data encodings. Software/hardware antialiasing difference requires runtime pixel comparison.

### MilkFRS: native audio visualization texture

**Construction:** merge_eq_equalizer_tab_common places MilkFRS before the Canvas response widget, with its bounds attached to that widget; poweramp_logo_pref_milk reuses the class for settings decoration.

MilkFRS is a TextureView-backed native visualization component, distinct from main-player SurfaceView MilkWidget and from the Canvas EQ response graph.

It constructs MilkRenderer with mode arguments1,2, reads presetUri and rounded outline radius, sets opaque=false when either initial background integer is exactly0 (transparent black), subscribes to player audio-source FD/serial state and controls renderer resume/pause with activity lifecycle. mv0 owns SurfaceTexture→Surface attachment and size-change messages; dimensions<=0 or>4000 are rejected by its size-change callback.

Class fallback preset is internal://#fft2inv, but effective themed EQ values differ. Registered vis_frs_type=2 applies rounded FRS options; the static API36 fixture resolves Black to internal://#fft2rounded and Light to internal://#fft2invrounded. API28+ EqMilkFrsBase reads outline radius from corners_equ_frs; older base declares0px. A default API36 fixture resolves16dp, Less Rounding8dp. These are conditional resolver results, not observed runtime states.

Native preset frame math, FFT feed shape and exact raster output remain inside MilkLoader/MilkRenderer native functions. Session1 backdrop blur evidence is reused only for shared renderer ownership/lifecycle, not as a claim that this spectrum is that blur algorithm.

Evidence: PA1031-S2-RENDER-010. Reuses PA1031-RENDER-001, PA1031-RENDER-010.

Limits: No native spectrum frames or audio feed captured. Exact frame math/FFT implementation not reversed. Configuration fixture is a static model, not Android runtime execution.

### Main visualizer preset loading and panel rendering

**Construction:** Main activity constructs MilkWidget. MilkWidget consumes state_player_milk_preset; VisPanelFrame attaches a92 providers to its PowerList and a92 selects item_vis.

Visualizer output and preset chooser rows have separate rendering pipelines: native loaded presets produce frames, while the chooser is a PowerList of icon/text/like Views.

MilkWidget routes changed cv0 preset URI/fragment through MilkRenderer.C. Loader message1 calls MilkLoader.х→native_load_preset_by_uri, returns MilkPresetRef, then renderer message8/native_set_preset or stores a pending reference until native context exists. A failed preset has a one-attempt fallback builtin: / Poweramp - spectrum-centered in jv0. Frame rendering ends at native_render_frame; no independent browser shader equivalent is proven.

The API22+ vis panel layout contains close/settings/sort/filter controls, a PowerList and advance/lock popup. item_vis contains IconView, tristate FastCheckBoxOnly, title/subtitle FastTextViews and activated check decoration. Its expanded row scene changes visibility; top panel scenes declare alpha1 for temporary UI and.5 for vis-with-UI. The scene report covers timing/gesture transitions.

Preset identifiers, selection/like state and labels are inputs. No proprietary preset/shader/image payload is reproduced in the deliverables.

Evidence: PA1031-S2-RENDER-011. Reuses PA1031-RENDER-001, PA1031-RENDER-010.

Limits: Native visualizer preset interpreter and frame output unverified. Actual preset selection is unknown.

### Library list/grid/header item rendering

**Construction:** e4.K obtains/recycles a View by item type; e4.о maps track→item_track, text→item_text and separator→item_separator_button. The shared item_track XML declares list, grid, header and player scenes on the same child Views.

Library rows, grids and artwork headers reuse the custom artwork/text renderers proven in Session1; switching geometry does not imply a new stock GridView/ImageView renderer.

The factory reuses Views by type, then binds data through provider О. item_track contains PlayingMark, number, AAImageView, category image, title/subtitle/meta/rating/menu/selection children and lazy behaviors. Different SceneParams select list, grid, header and full-art states on these children. item_text similarly has lazy header/subheader/menu children.

AAItemView.m binds text, count/metadata, artwork provider, category icon and activation. It clears background level to0 during rebinding and calls jumpDrawablesToCurrentState unless its update flag allows transition. This reset matters to recycled rows. Actual list zoom/column choices and header factories are in the scene and per-category configuration reports.

Session1 AAImageView matrix, shader, clipping and replacement fade, and FastTextView typography remain applicable. Effective artwork radius/text color/bounds must be re-resolved for each library scene; main-player dimensions are not transferred wholesale.

Evidence: PA1031-S2-RENDER-012. Reuses PA1031-RENDER-002, PA1031-RENDER-003, PA1031-RENDER-004, PA1031-RENDER-022.

Limits: Per-category sort/zoom/current configuration not known; root configuration report owns those branches. Recycling/scene composition has not been observed on Android.

### Library selection and checkbox graphics

**Construction:** item_track and item_text expose select_box; AAItemView discovers it on inflate. EQ parametric cards and visualizer rows reuse FastCheckBoxOnly directly.

Selection mode, checked state and playing/activated state are distinct inputs; they must not be collapsed into one row highlight flag.

AAItemView.H shows/hides the checkbox and eligible drag handle for selection mode; leaving selection mode clears checked state. P0 changes the checkbox checked state and can skip state animation through jumpDrawablesToCurrentState. AAItemView.m separately calls setActivated for its bound item.

FastCheckBoxOnly draws its own supplied Drawable within padding bounds, applies optional ColorStateList tint, and supplies checked or intermediate drawable states. Its internal y=1 emits Android state_checked16842912; y=2 emits16842918. The component can animate its visibility via gc, separate from the check Drawable state animation. A visualizer like control requests tristate=true; a normal library selection checkbox need not.

AAItemView.draw optionally adds b82/so1 overscroll decoration after normal child drawing; this is not its selection fill. API-dependent layer handling exists for item alpha transitions. Full gesture ownership stays in the gesture report.

Evidence: PA1031-S2-RENDER-013. Reuses PA1031-RENDER-002.

Limits: Drawable payload state transitions and actual timing require active theme/runtime capture. Android state16842918 should be preserved as literal state mapping, not renamed to an unsupported semantic.

### Alphabet scroller and index popup

**Construction:** ListScrollerView is attached by the library layout; ListIndexerPopupView extends FastTextView and is connected as its index-label display through the list scroller plumbing.

The alphabet scroller is a custom Canvas renderer with separate thumb/track Drawables, per-character text, row dividers and selected-character decoration; the floating index popup reuses FastTextView.

ListScrollerView.onDraw translates the scrollbar thumb independently of the alphabet column, draws optional alphabet background and selected-cell Drawable, then draws one character at a time with a Paint and optional horizontal separators. Paint alpha controls whether the alphabet is drawn. Some index/draw branches are malformed in JADX, so exact per-letter state restoration is not certified here.

ListIndexerPopupView.V sends anim_scrollbar_pressed to its containing do1 with requested.25seconds and can preserve current translation before hiding. Content is a one-character CharArrayBuffer. Exact effective font/column dimensions and gesture mapping belong to the style/input traces.

Evidence: PA1031-S2-RENDER-014. Reuses PA1031-RENDER-022.

Limits: Malformed ListScrollerView.onDraw branch was not exhaustively reconstructed in smali. Alphabet content/localization, active typography and column bounds unknown.

### Lyrics line states and stable text wrapping

**Construction:** xo0.o chooses item_lyrics for line rows and item_lyrics_last_item for the trailing row. item_lyrics constructs LyricsItemView with LyricsFastTextView and active/small/zoomed/unsynced SceneParams.

Lyrics render as custom multiline text rows with line-level scene changes; the traced renderer does not establish a word-by-word karaoke fill.

xo0 binds lyric line text into the title child; ap0.h0 maps base/small/zoomed to their active scenes. LyricsFastTextView.H0 recognizes transitions between each inactive/active pair. During those transitions it preserves the earlier o(int) text-layout width input; text replacement, nonpaired scene completion and detach clear the cached value. This avoids reflow during active-line scale transitions.

Base lyric text appearance is22sp before variant and scale. Ordinary active style declares scale1.1, small active.85, zoomed active1.3, with layout_compensateScale matching, recalcChildren50% and primary text color. Inactive styles use colorIconDisabled and differing margins/scales. These declarations require final theme and scene resolution; they are not measured physical text sizes.

LyricsItemView resets background level on scene changes, records touch hotspot, and uses level8 plus a temporary pressed state for its explicit feedback path. Unsynced modes are separate scene declarations.

Evidence: PA1031-S2-RENDER-015. Reuses PA1031-RENDER-022.

Limits: No synchronized runtime lyric recording or per-word highlight evidence. Exact text layout remains dependent on font metrics, viewport and the main FastTextView measurement model.

### Settings round knob uses the player renderer

**Construction:** RoundKnobPreference constructor selects preference_roundknob unless overridden; that layout explicitly contains RoundKnob id seekbar and KnobLabelAndValue id _value.

Settings round controls reuse RoundKnob geometry and state drawing, with preference-specific mapping and labels rather than a separate platform dial.

The default layout declares a70dp square knob with settings_round_knob/settings_round_knob_indicator Drawables. onBindView loads the stored value, uses range/midpoint/scale or supplied cs converter to obtain normalized progress, assigns rounding/snap behavior and formatting, updates enabled state, then routes the value label through KnobLabelAndValue. Preference ranges and units are data, not determined by70dp geometry.

RoundKnobPreference persistence distinguishes integer and float modes. The settings-effects report owns which preference updates which subsystem; this rendering reference records that dynamic summary, enabled state and numeric value label are separate surfaces.

Evidence: PA1031-S2-RENDER-016. New Session2 trace.

Limits: Each preference may override layout, range, scale, midpoint, rounding and converter. No live settings capture.

### Settings SeekBar and custom tick pass

**Construction:** SeekbarPreference default preference_seekbar layout contains TickSeekBar. onBindView sets max/progress/enabled and a configured tick Drawable.

Settings sliders use a platform SeekBar with an additional custom tick-render pass, not the player LinearKnob class.

SeekbarPreference maps range and increment to max=(maximum−minimum)/step, supplies progress and optional tick Drawable, and updates side/summary labels. TickSeekBar draws ticks before super.onDraw. If max>1, it spaces tick positions over width minus left/right padding and iterates0..max inclusive.

The current-progress tick is deliberately skipped. Before that point a stateful tick Drawable uses ENABLED_SELECTED_STATE_SET; at the progress index it restores the original state and sets theme disabledAlpha, so subsequent ticks use that state/alpha. The method restores original state/alpha at end for stateful Drawables. This is a literal code rendering contract, not a claim that all settings have ticks.

Thumb/track drawing and system widget state remain Android-owned; theme styles and API can change them.

Evidence: PA1031-S2-RENDER-017. New Session2 trace.

Limits: Actual preference tick resource and Android native SeekBar rasterization unknown. Nonstateful custom tick drawables do not enter the final state/alpha-restoration branch.

### Color dialog HSV plane and preview markers

**Construction:** ColorPreference.onCreateDialogView loads ambilwarna_layout and locates AmbilwarnaLayout; its XML constructs hue ImageView, AmbilWarnaKotak, cursor/target ImageViews, color preview and six-digit EditText.

The color picker renders a software-layer saturation/value plane by multiplying a vertical white-to-black gradient with a horizontal white-to-full-hue gradient.

AmbilWarnaKotak sets layerType1 and draws the ComposeShader(MULTIPLY) rectangle. The vertical gradient is cached on initial Paint creation; the horizontal gradient uses the current hue each draw. Hue is supplied by AmbilwarnaLayout, not inferred from RGB cursor position.

Marker positions are explicit: hue marker Y=height−hue*height/360, wrapping hue0 to top, minus half marker height; plane target X=saturation*width−half target width and Y=(1−value)*height−half target height. The base layout declares280dp plane/hue height,14dp hue cursor,15dp target,60×30dp preview; resource qualifiers may override.

ColorPreference binds its swatch to the resolved color and clips it via an outline. Positive close serializes HSVToColor as eight-digit hex plus a |@resource-id suffix. Manual input accepts six hexadecimal digits and forces opaque RGB. This traced UI exposes no alpha slider; do not invent one because the stored string has eight hex digits.

Evidence: PA1031-S2-RENDER-018. New Session2 trace.

Limits: Color plane behavior after resize requires runtime confirmation because vertical shader is cached. Material You resource-linked colors depend on API/theme; active resource selection unknown.

### Shared color-circle palette

**Construction:** merge_eq_param_colors constructs ColorCircleSelector for band-color popup; API31 merge_widget_mu_colors adds it inside AmbilwarnaLayout for resource-linked palette choices.

ColorCircleSelector draws palette circles plus a selected/unselected outline, and distinguishes resource-linked selection from raw color equality.

The integer array is a layout grammar:0 breaks a row,1 draws an outline-only sentinel, other entries draw a filled circle; an entry with zero alpha is forced opaque for display. Selection compares resource ID when one is active, otherwise raw color. onMeasure shrinks circle diameter if needed and distributes spacing across the maximum row length.

Diameter, padding, normal/selected stroke widths and colors are constructor-consumed dimensions/state values. The same class therefore serves parametric EQ colors and Android theme palette choices with different styles and callback owners.

Evidence: PA1031-S2-RENDER-019. New Session2 trace.

Limits: Palette arrays and callbacks vary by consumer; no one universal color set. Actual runtime theme-linked colors unknown.

### Settings logo native decoration and preview limits

**Construction:** PowerampLogoPreference selects poweramp_logo_pref, binds image and wrapper; PreferenceMilkViewWrapper.onAttachedToWindow inflates poweramp_logo_pref_milk.

The settings logo preference contains an actual native MilkFRS visualization decoration; this trace does not establish a whole-player skin-preview renderer.

The wrapper creates the MilkFRS layout on attachment. That layout declares transparent background and presetUri=?settings_milk_preset_uri. Theme resources choose poweramp1inv/poweramp1 or PEQ variants, with night/theme branches. The class shares native renderer/audio-source lifecycle with the EQ texture.

No dedicated full-player preview graphics path was established in this rendering investigation. If another report identifies a live preview route, it should be linked explicitly rather than relabeling the logo surface as that preview.

Evidence: PA1031-S2-RENDER-020. New Session2 trace.

Limits: Whole-player skin preview route remains unestablished here. No logo visualization frames captured; native preset behavior remains open.

### Search fields and results reuse distinct widget families

**Construction:** merge_search_layout creates the player/library ListSearchEditText and search category/target children; item_settings_search creates SearchItemView with nested image/text children.

Player/library search and settings search have separate shells; result rows reuse FastTextView while editable fields use EditText-derived widgets.

SearchItemView.onFinishInflate binds image, title, line2 and line3 from its actual nested FastLayout hierarchy; it has no custom Canvas onDraw. Its graphics therefore come from FastTextView text/drawable behavior and the selected item styles.

The player search merge has close, input, category layout and target button. Scene_search shows its search layout while several player/library/EQ/visualizer/lyrics scenes hide it. These visibility declarations are separate from query/filter behavior.

No search-match highlight-span algorithm was established in this renderer scope. A future implementation must take text decoration from the actual search binder, not assume browser mark tags or a universal accent.

Evidence: PA1031-S2-RENDER-021. Reuses PA1031-RENDER-022.

Limits: Query matching/highlight binding remains outside this rendering trace. IME/font/platform EditText pixels have not been observed.

### Dialog shell, scrim and inserted content

**Construction:** BaseDialogActivity chooses theme dialogLayout; AlertDialogActivity explicitly loads R.layout.dialog. The shared dialog merge creates a Shim, DialogOuterFastLayout, frame/title/progress/toast, theme-selected content and button includes.

Poweramp dialog graphics are built from a custom scene/layout shell with theme-selected content, rather than one universal platform AlertDialog appearance.

The shared dialog layout places a separate scrim View outside the frame, uses FastTextView/FastButton title/actions, inserts ?dialogContentLayout and ?dialogButtonsLayout, and declares loading/progress/toast/in/out scene variants. Different activities and preference dialogs can therefore share a shell while using different content widgets.

Shim extends NonOverlappingView, uses a hardware layer, and relies on its background/alpha for drawing. Its setAlpha toggles clickability only at alpha1; it does not implement a custom blur painter. AlertDialogActivity can clear the scrim background when EXTRA_BG=false. DialogOuterFastLayout and AdjustToSoftKeyboardBehavior own layout/inset adaptation, covered by the layout/scene report.

Android progress widgets, editable fields and selector/ripple Drawables remain native rendering dependencies. No universal corner radius, shadow, dim percentage or timing is asserted without the resolved DialogFrame/DialogShim styles and actual scene.

Evidence: PA1031-S2-RENDER-022. Reuses PA1031-RENDER-022.

Limits: Exact activity/theme/dialog variant and runtime insets unknown. No measured dialog blur, elevation shadow or transition frames.

### Known rendering contracts and remaining parity boundaries

**Construction:** This record summarizes the explicit boundaries of the constructed widgets above.

Secondary-screen rendering owners, construction paths, data inputs and several pixel/angle algorithms are now established statically; faithful final rendering remains unverified.

Reusable facts: artwork/text primitives from Session1; new round/linear knob geometry and color spaces; dynamic EQ construction; graphic curve paths; parametric JNI input/output boundary; native texture separation; preset-miniature construction; selection state separation; lyrics layout caching; HSV picker; shared dialog shell.

Remaining work: owner effective configuration and migration state; authentic Android screenshots/video at known density/font/insets; native visualization frame output; native parametric evaluator numerical parity; complete mini-preset reduction semantics; exact malformed alphabet-scroller draw branches; search highlighting binder; any separate live skin-preview renderer. No reference bitmap, font, shader, native code payload or app implementation is shipped.

Evidence: PA1031-S2-RENDER-023. New Session2 trace.

Limits: These gaps prevent a claim of implementation-ready pixel parity across all secondary screens.

## Reproduction and implementation boundary

`session2/scripts/build_rendering_components.py` emits this report, `rendering-components.json` and `evidence-ledger.jsonl`, checking every referenced source path. Constructor-consumed attributes must resolve explicit XML, component/default style, final theme and getter fallback in that order; a missing component-bag item is not a disabled feature. Companion `style_resolver.py` provides `consumed(...)` for this distinction.

The result is suitable for architecture and targeted native verification planning. It is not a certification that all secondary screens can already be recreated with pixel and behavioral parity. No player files were written or modified and nothing was deployed.
