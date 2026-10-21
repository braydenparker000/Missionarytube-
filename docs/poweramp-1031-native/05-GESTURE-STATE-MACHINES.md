# Poweramp 1031 — gesture and input reference

This is a static reference for the supplied original APK, SHA-256 `27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e`. No behavior below is labeled runtime-observed. Source paths are relative to the research extraction root: `decoded/` is Apktool output and `jadx/` is the unrenamed JADX tree. Exact class names matter: `ׅ.С`, Latin `A`, Cyrillic `А`, and Cyrillic `В` are different classes. Citation keys below resolve to concrete methods/resources in the final source index. The machine-readable records use IDs `PA1031-GESTURE-*`.

The high-value results are that the stock scrolling waveform and optional fixed waveform have different input semantics; seek cancellation commits the pending position; artwork is a paged `PowerList` with independent horizontal and vertical owners; mini-player play/pause suppresses parent-item navigation; and animation/input inhibition occurs at several layers. There is no evidence for one universal swipe threshold or one duration shared by these controls.

## 1. Input ownership and verified call graph

```text
Android ViewGroup dispatch
  ├─ main ListWidget (extends om0, extends PowerList)
  │    dispatchTouchEvent -> onInterceptTouchEvent -> c81/j0.х(MotionEvent)
  │    ├─ full page С.р -> a0 -> w
  │    │    ├─ horizontal page drag -> P/v offsets -> w.у settlement
  │    │    │    -> a0.К -> ListWidget.X0 -> cmd_player_play_pos/category
  │    │    └─ vertical drag -> ListWidget.d0(x71) -> list. А / B
  │    │         -> x32 -> shared-item transition -> om0 transition bus
  │    │         -> i22 -> top scene properties (see scene report)
  │    └─ ordinary library pd/bk0 page -> m22 -> sa0/hc
  │         ├─ vertical scroll/fling -> frame callback fc -> list offset
  │         └─ horizontal fallback -> l22 -> d0(y71) -> history transition
  ├─ item short/long click: AAItemView/FastButton -> cy0 -> gm/PowerList
  │    -> current item lookup -> om0/p31 or Navbar callback
  ├─ full waveform Waveseek -> m92.onTouchEvent
  │    ├─ waveType=0: m22 -> hc -> m92.e/H -> progress
  │    └─ waveType=1: m92.d(x) -> absolute progress
  │         -> i51.Х -> intermediate seek; release -> i51.X -> player seek
  └─ Navbar
       ├─ navbar_list: PowerList -> jx0 -> a0(pv0 extends w)
       │    ├─ item tap -> Navbar.onItemClick -> cmd_nav_to_main
       │    └─ horizontal page commit -> Navbar.t0 -> cmd_player_play_pos
       ├─ PlayPauseButton.performClick -> cmd_player_toggle_playing
       └─ optional navbar_seekbar: Seek.onTouchEvent -> i51
```

**CONFIRMED_STATIC** for the component/callback graph under those page types [G01–G04, G08–G13, G18–G21]. This graph describes app handlers. Android's delivery of `CANCEL` to a child when a parent intercepts remains framework behavior; the original build has not been executed here to measure its delivery in every interruption sequence.

The full player is not a single clickable artwork image. `AAItemView` stores contact coordinates and delegates ordinary click/long-click generation to its inherited view behavior, while the surrounding `PowerList` owns swipe interception. Child controls can consume the click before it reaches item navigation. `PowerList.I0` looks up the actual current item from the current `vj0` cache, rather than navigating from a stale screen coordinate. Its JADX reconstruction contained a misleading unconditional `view2=null`; smali confirms the ancestor lookup and child callback branch [G02].

## 2. Shared list/controller state machine

`j0` is a custom touch controller; this path does not use Android `GestureDetector`. It gets touch slop and maximum fling velocity from `ViewConfiguration`, and tracks velocity with `VelocityTracker`. `hc` separately gets the minimum fling velocity. These are device/framework values in pixels or pixels/second, not constants recovered as a fixed number of dp [G01, G05].

| Controller state | Event/condition | Mutation and downstream outcome |
|---|---|---|
| Idle `р=0` | DOWN, owner exists and `M0()` permits input | Sanitize initial coordinates, check owner/scroller excluded region, assign primary pointer ID, store position, allocate/add `VelocityTracker`, enter armed `1`, call scroller `f()` and subclass `у(DOWN)`. A normal artwork DOWN returns false from the subclass and permits the item to receive the contact. A running list fling can instead be intercepted on DOWN. |
| Armed `1` | MOVE below both slop thresholds | Remain armed; interceptor returns `0`, so this alone does not steal the child's click. This return branch was checked in smali. |
| Armed `1` | `abs(dx)>=slop` or `abs(dy)>=slop`, and owner `u()` permits movement | Apply touch-region restrictions, subtract one slop from the anchor along crossed axes, ask subclass `y(...)` for a handler. If obtained, store handler and enter owned-drag `2`; otherwise reset anchor and remain armed. |
| Owned drag `2` | MOVE, primary pointer ID is still found | Call selected handler `C(...)` with current coordinates and previous point, update previous point. Axis ownership stays with that handler. |
| Armed/drag | POINTER_DOWN, eligible owner implements `a81` | Track a second pointer and initial spread (minimum 1 px). A spread change crossing touch slop may acquire a `b81` pinch handler and enter pinch `3`. `m22`'s gain is `1.25`; this does not mean the waveform itself has a pinch behavior. |
| Pinch `3` | POINTER_UP | Derive spread-release velocity from two pointer velocities with a 0.01-second projection, settle pinch, enter post-pinch `4`. If the primary pointer lifted, promote the secondary pointer and reset the anchor. |
| Any armed/owned state | UP | Compute velocity at 1000 units/second, clamp to the configured maximum, call selected handler `Р(vx,vy)`, run subclass cleanup, recycle velocity tracker and clear pointer IDs/state. Armed-only terminal returns `0`; an owned terminal returns `1`. |
| Any armed/owned state | CANCEL | Clear velocity history; settle selected handler with `(0,0)`, then the same cleanup. It is not a universal rollback instruction. |
| Any | Explicit controller `B()` teardown | Cancel handler `c()`, cancel pinch adapter, recycle tracker, disconnect scroller and reset pointers/state. Distinct from an ordinary event CANCEL. |

**CONFIRMED_STATIC**, with the following boundaries [G01]: `j0` maintains primary and secondary IDs, not a general arbitrary-pointer gesture model. Invalid/missing pointer indices or nonfinite coordinates can suppress movement while consuming the event; a runtime exercise is still needed for three-finger orderings. Excluded-region checks can consume without arming; do not interpret them simply as “return false outside bounds.” Pinch behavior depends on the page's available `b81` transition and is not asserted for every `PowerList` surface.

`PowerList.dispatchTouchEvent` resets the controller inhibition flag on DOWN/UP/CANCEL. `onInterceptTouchEvent` interprets controller result `0` as false and `1` as true. `onTouchEvent` delegates to `j0.А`, which avoids processing the same DOWN again and stops nested scrolling on UP/CANCEL. `shouldDelayChildPressedState()` is true [G02].

## 3. Full-player artwork

### Tap and long press

| Event | Conditions | Result and status |
|---|---|---|
| DOWN → small/no MOVE → UP | Normal active full page; valid current item/data; no selection mode or interception | `AAItemView.performClick → cy0.С → PowerList.I0 → om0.w → p31.K → С.f/z0 → p31.a`. The destination is the current track's category URI (`z22.h`) with track-ID fragment and `pos`, not an unconditional All Songs URI. **CONFIRMED_STATIC**; failed JADX cursor branch in `С.f` checked in smali [G03]. |
| Long press | Full page is active, pressed item index equals current `P.q`, normalized horizontal artwork offset is strictly inside `(-0.01,+0.01)` | `om0.z` supplies haptic feedback then `l0(item)` context menu. Off-center page does not enter this menu branch. **CONFIRMED_STATIC** [G04]. |
| Line2 child click | Configured line2 action | `С.y/A0` maps 1 artist, 2 album, 3 folder, 4 genre. Declared defaults: `line2_click=0`, `line2_long_press=1`. A child target can therefore differ from the enclosing artwork target. **CONFIRMED_STATIC** for mapping/default declaration; actual owner preference unknown [G24]. |
| Overflow/menu button long press | Built-in `menu_button_long_press` preference and feature gates | `С.B0`: 0 consumes without assigned action; 1 delete, 2 playlist, 3 info, 4 album art, 5 artist, 6 album, 7 folder, 8 genre, 9 share, 10 five-star, 11 one-star. Declared default is 0. This is separate from artwork long press. **CONFIRMED_STATIC** for command mapping/default [G24]. |

The short/long distinction originates in inherited Android `View` event processing for these item/button classes. No app-wide numeric long-press timeout has been established; do not substitute an assumed 500 ms. Accessibility/device settings can affect framework behavior. This is a runtime-configuration value, not missing proof of a hardcoded app constant.

### Horizontal page drag / track change

| Event | Classification/parameters | Result |
|---|---|---|
| DOWN | `a0.у` records starting selected item; `w.f()` stops current horizontal settlement | Arms the page controller. Exact painted continuity of a re-grab is governed by model offsets and the scene engine; see runtime checks below. |
| First qualifying MOVE | `w.О`: vertical iff `abs(dy)>abs(dx)`; equality selects horizontal. Horizontal path requires owner `M0()` | Horizontal owner moves page with signed incremental x. Once acquired, motion is not reclassified as vertical merely because later direction changes. |
| Continued MOVE | `w.C → u61.у(dx,0,1)` | Changes page offset. Direction reversal changes the signed movement through the same handler. |
| UP | `w.Р → w.у(vx,q71.B,true)` | Let `p` be current normalized page offset and `r=p % 1`; base selected index is `H−trunc(p)`. If `abs(r + 0.0001*vx) >= 0.2`, advance the candidate one page according to the sign of `r`, respecting boundary flags and index clamping. This is a velocity-biased page decision, not a 20% drag-only threshold. |
| Release at category edge | `w.Н`: model reports an edge and `abs(p)>0.6`; observer accepts category movement | Calls `X0(direction,true)` for category advance; built-in setting `p31.u` gates actual previous/next-category commands. |
| UP/CANCEL cleanup | Selected index differs from recorded DOWN index | `a0.К → X0(0,true)`. Full `ListWidget.X0` emits `cmd_player_play_pos(selectedIndex,0,null)`. |
| CANCEL | Same handler release, but zero velocity | Settles from current offset; because the page selection formula still uses `r`, cancellation must not be implemented as automatic return to the original track. |

**CONFIRMED_STATIC** for handler selection, thresholds and bus commands [G06–G08]. The `0.0001` multiplies the pixel/second velocity supplied by `j0`; there is no density conversion at that multiplication. `w` also has category resistance and dynamic time/distance settling with its own interpolator; the scene report covers timing. These values must not be reused for vertical transition settlement.

### Vertical artwork drag / player boundary

| Event | Condition | Result |
|---|---|---|
| First qualifying MOVE | Vertically dominant; current horizontal page offset strictly inside `(-0.05,+0.05)`; owner supports `a81`; full-page `w` constructed with its vertical-block flag false | Requests `ListWidget.d0(x71.class,dy>0)`. Failure to acquire yields no vertical drag owner. Off-center horizontal artwork inhibits this path. |
| Downward acquisition | Shared transition adapter available; current track category resolves | Cyrillic `list.А` starts `PowerListSharedMoveDownItemTransition`; `ListWidget.b1` derives destination using `С.f(Integer.MIN_VALUE)` and `p31.a`. It is a shared transition toward the track's library/category view. |
| Upward acquisition | Full page, `main_lyrics_swipe` value nonzero, valid lyrics destination | `PowerListSharedMoveUpItemTransition` resolves the lyrics page through `p31.c`. Declared default `main_lyrics_swipe=2`; exact effect of both nonzero option values belongs to lyrics-data selection, beyond the player boundary. |
| MOVE | Active vertical adapter | `w.C` divides signed y displacement by model `bv1.О()` height and passes normalized progress to `km0`; shared item/list transition emits progress to top navigation scene machinery. This is gesture-controlled movement, not merely a gesture that launches a fixed animation. |
| Reverse through origin | Adapter's overdrag/reversal branch | `km0.p(delta,total)` can reattempt direction or enter overdrag; ordinary continuation uses `km0.О(delta)`. Exact painted frame continuity requires native verification. |
| UP | Adapter not in overdrag | Pass raw y velocity and velocity normalized by height to `km0.у`. Shared transition release uses the rule below. |
| CANCEL | Zero-velocity release; overdrag may call `km0.Х` | Uses current transition progress and the transition's settle/cancel rules; no universal reset-to-zero operation in the touch dispatcher. |

**CONFIRMED_STATIC** under the listed acquisition conditions [G06, G09]. Generic shared-transition release, verified independently in `PowerListTransitionBase.A` smali: if `abs(velocityPx/density)>=500`, completion is decided by velocity direction; otherwise it completes only when progress `>0.3`. Normalized velocity is **zeroed** when completing with progress `>0.8`, or cancelling with progress `<0.2`, and retained elsewhere. JADX reversed this last branch; consult the scene report for the corrected full settle equation and `x32` owner. These rules are for shared list transitions, not waveform flings or horizontal track pages [G10].

## 4. Waveform: effective variant, input and commit

The built-in skin's seekbar multi-switch declares `defaultValue=""`. The empty option leaves `TopWaveseek`/`TopWaveseekBase` active: `waveType=0` scrolling, 100 bars. The static option overlays `ActivityTheme_Whitepro_StaticSeekbar` or `ActivityTheme_Blackpro_StaticSeekbar`, mapping to `TopWaveseekStatic`: fixed `waveType=1`, 60 bars and 0.5 dp spacing. `more_buttons=true` changes transport/time layout; it does **not** select fixed waveform. Owner settings are unobserved. Full geometry/rendering evidence is in the rendering report [G11].

The high-priority damaged decompilation was resolved by reading all branches of `decoded/smali/ׅ/m92.smali`, method `onTouchEvent`, rather than using the misleading Java body. The decisive split is presence of scrolling controller `x`: constructor creates `m22(hc(...,30000,0,true))` only for `waveType=0` [G12].

| Event | Common wrapper | Scrolling waveform (`waveType=0`) | Fixed waveform (`waveType=1`) |
|---|---|---|---|
| DOWN | Rounded point must be inside padded rectangle; if enabled mark contact active and pressed | Feed `j0`; arm relative horizontal dragging. No call to absolute `d(x)` occurs. A tap at an arbitrary x does **not** jump to that x. | Call `d(x)` immediately: clamp x to horizontal padded bounds and update fraction. |
| MOVE | Reject if no active contact | Once custom touch slop and horizontal dominance acquire `hc`, `m92.e` offsets waveform position by `−dx`; leftward drag increases selected position. | Call `d(x)` each MOVE, using absolute x, without this controller's slop requirement. |
| UP | Clear contact-active flag | Feed velocity to controller; if fling/settle remains active, retain pressed state. Otherwise clear pressed. | Clear pressed/commit, then `o()` refreshes progress. No new UP-coordinate `d(x)` call in this branch. |
| CANCEL | Clear active flag | Feed controller zero-velocity cancellation; clear pressed immediately only if no settlement remains, otherwise when physics ends. | Clear pressed and commit pending position, then refresh. No rollback to the DOWN position. |
| POINTER actions | Wrapper uses raw `getAction`; only standard DOWN/MOVE/UP/CANCEL change active flag | Events still reach pointer-aware `j0`; it tracks IDs and pointer promotion. | No dedicated pointer ownership; MOVE reads unindexed `getX()`. First-pointer removal can therefore change which coordinate supplies the absolute seek. |
| Outside padded DOWN / MOVE without active contact | Return false | Same | Same |

**CONFIRMED_STATIC**, enabled view and valid track data [G12–G14]. The raw action wrapper and pointer-aware inner controller are separate layers. A fixed waveform's lack of pointer-ID tracking is recoverable statically; exact visible discontinuity from a multitouch sequence remains unobserved.

Fixed fraction is `clamp(x,paddingLeft,width−paddingRight)` mapped over padded width. Scrolling progress is derived from waveform pixel offset `y.x` over waveform span `v`, clamped at bounds; `v=ceil((barWidth+barSpacing)*numBars−barSpacing)`. Do not equate the scrolling bar span with the view width or translate the absolute fixed formula to scrolling mode [G12].

### Shared seek session and cancellation

| Stage | `m92` / `i51` state and message |
|---|---|
| Actual pressed transition false→true | Apply `anim_waveseek_pressed` through scene engine with parameter `0.25f`; inhibit normal playback-follow update via mask 64; pending time `x=-1`; emit `msg_gui_intermediate_seek_start`. The parameter is not proof of a measured 250 ms cursor animation. |
| User progress while active | `i51.Х` calculates pending time `round(trackDuration*fraction)` and emits `msg_gui_intermediate_seek`. Ordinary touch uses deferred seek (`i51.с=true` in constructor). Focused keyboard/accessibility path can send immediately; do not extrapolate touch timing to that path. |
| Actual pressed transition true→false | `i51.X`: if pending time exists, emit `cmd_player_seek(pending,1,null)`; clear update timing, release inhibit mask64, emit `msg_gui_intermediate_seek_end`. |
| Physics finishes after finger release | `m92.J` updates progress/clamps and clears pressed only when contact no longer active; this invokes the same commit. |

**CONFIRMED_STATIC**, including smali cross-check of `i51.X` and `i51.Х` [G13–G14]. Both UP and CANCEL reach the commit path. “Cancel” means stop touch/velocity ownership, not necessarily discard the preview. It is incorrect to add restoration of the original seek position to a faithful reference.

### Fling and overscroll

`hc` receives a minimum fling threshold from `ViewConfiguration`. It flings only when release magnitude meets that threshold, relevant boundary/overscroll flags permit it and the requested direction is available. Waveform construction uses acceleration-like parameter `30000` and minimum-duration parameter `0`; ordinary `hc(xp,false)` uses `9000` and `0.75` instead [G05, G15]. These are constructor inputs to custom physics, not Android `OverScroller` constants.

`eh0.B` initializes duration in seconds from `max(minDuration,abs(initialVelocity/signedAcceleration))`. The waveform `hc.O` uses cubic control points `(0.103,0.389,0.307,0.966)`, evolves velocity as initial velocity times one minus interpolation progress, and integrates frame displacement. `fc.run` is scheduled with `postOnAnimation`; edge handling has separate overshoot/rebound machinery. This establishes inertia and frame ownership, not a runtime frame-rate or total duration for a particular gesture [G15]. `m92` has a 20 dp overscroll normalization span. Its `Q` values of 1.25 dp for scrolling and 50 dp for fixed are smoothing thresholds; they are not finger touch slop [G12].

## 5. Mini-player ownership and optional seek area

The mini-player is `navbar_list`, a separate `PowerList` in `merge_navbar`, with model `jx0`, item provider `hx0`, and `a0(pv0)` horizontal controller. Its item includes `AAImageView`, title/line2 and a distinct `PlayPauseButton`. Optional `navbar_seekbar` is a sibling `Seek` control, not part of the art/title tap area [G18–G20].

| Surface/event | Static outcome | Conditions/limits |
|---|---|---|
| Mini art/title item tap | `Navbar.onItemClick` → `cmd_nav_to_main` | Current mini page valid, GUI navigation allowed. If an expanded navbar extension is open, it may close first and retry. Smali confirms the final command. |
| Mini item long press | `Navbar.N0` → `cmd_data_nav_to_lib_pos(itemIndex,0,currentTrackUri)` plus haptic | This differs from mini tap expansion and full-art context menu. |
| Mini play/pause short tap | `PlayPauseButton.performClick` → `cmd_player_toggle_playing` | Constructor sets `FastButton.x0=true`, which short-circuits parent `cy0.С` click forwarding. Does not trigger item expansion through that route. |
| Mini play/pause long press | No full-player stop command is declared by this class | It is not a `BusActionButton` with the full-player long-press mapping. Exact accessibility/framework behavior unobserved. |
| Mini horizontal swipe | `a0(pv0)` page settle → `Navbar.t0` → `cmd_player_play_pos` | Page-index commit and category edge callbacks; `pv0` overrides edge resistance, otherwise inherits `w`. |
| Mini vertical drag | No drag-controlled mini-to-full expansion route in the normal closed-navbar input stack. **CONFIRMED_STATIC**, scoped to that stack | `w` asks for `x71`; plain `PowerList.P` only constructs distinct `b81` pinch or `y71` history adapters. Ancestor dispatch is resolved below. A native test should validate the negative result. |
| Optional mini Seek DOWN | Start seek session and seek at x immediately | Enabled and valid track. Declared mini seek preference `navbar_seekbar=true`; visible in three-line navbar scene, hidden in one/two-line scenes. |
| Mini Seek MOVE | Update absolute progress while contact active | No inherited `AbsSeekBar` gesture semantics; method is overridden. |
| Mini Seek UP | Sample UP x, clear active, `i51.X`, clear pressed | Unlike fixed `m92`, this control samples the final UP coordinate. |
| Mini Seek CANCEL | If active, clear active, `i51.X`, clear pressed | Commits last pending position, not rollback. Raw `getAction` and unindexed x mean no pointer-ID state machine. |

**CONFIRMED_STATIC** for the stated paths [G18–G21, G26]. `Seek.B` rounds x, clamps to padded width, performs **floating-point** division, and scales by maximum 10000 before sending normalized fraction to `i51`. JADX displayed an ambiguous apparent integer division; smali has `int-to-float` before `div-float`. This is a discrete progress range of 10000, not a 10,000-second timeline [G21].

### Why a mini upward drag is not the full-art vertical drag

The ancestor chain in the supplied layout is `navbar_list → Navbar/gx0 → navbar_container SceneFastLayout → TopNavSceneFastLayout`. `Navbar` and `gx0` do not override touch dispatch/interception and do not install a touch listener/delegate. `FastLayout.onInterceptTouchEvent` only delegates to optional `a01` field `О`; otherwise it returns false. All DEX assignments to this field were searched: the normal Navbar/navbar_container path has no scrolling-behavior installer, while the top container can install `i22` [G26].

`i22.y(MotionEvent)` was checked in smali because JADX damaged its bounds branch. It only handles DOWN, UP and CANCEL in visualization states `p=2,3,4` while playing; it does not classify MOVE or produce a mini expansion ratio. Ordinary library is outside that state guard. `TopNavSceneFastLayout.requestDisallowInterceptTouchEvent(false)` calls `i22.K`, which concerns the visualization timer and does not supply a hidden mini vertical controller. `BaseActivity.dispatchTouchEvent` forwards to framework dispatch with exception handling, and `BasePowerWidgetActivity.х` installs the layout through `Activity.setContentView`, with no additional app gesture wrapper [G26].

The visually adjacent `NavbarExtension` has an independent `wm/vm` sheet drag. It receives its own subtree's contacts or the `navbar_shim` while a sheet is active, and moves between `scene_navbar_*_sheet` and ordinary navbar scenes. It is a sibling of `navbar_list`, not a vertical mini-player expansion ancestor. Its presence must not be mistaken for a hidden full-player expansion drag. Thus the static installed stack supports mini **tap** expansion and horizontal track paging; it does not support finger-controlled vertical mini-to-full progress in the normal closed-sheet configuration. This negative conclusion is scoped and source-backed; native validation remains desirable [G26].

## 6. Transport, repeat/shuffle and menus

### Transport event table

| Control | Short click | Long press | UP/CANCEL after long action |
|---|---|---|---|
| Full `play_pause_behind`, play, pause | `cmd_player_toggle_playing` | `cmd_player_stop_playing` | Normal button release; no separate long-seek end command on these controls |
| Previous track (`TopRw`) | `cmd_player_play_prev_track`, argument1=0 | `cmd_player_begin_seek_jumps`, direction argument1=0 | `cmd_player_end_seek_jumps` |
| Next track (`TopFf`) | `cmd_player_play_next_track`, argument1=1 | `cmd_player_begin_seek_jumps`, direction argument1=1 | `cmd_player_end_seek_jumps` |
| Previous category (`TopPrevCat`) | `cmd_player_play_prev_category` | `cmd_player_play_first_category` | Normal release |
| Next category (`TopNextCat`) | `cmd_player_play_next_category` | `cmd_player_play_last_category` | Normal release |
| Category buttons while `state_player_long_seek` morph is active | `cmd_player_seek_jump`, direction-specific argument1, argument2=2 | Begin seek jumps | End seek jumps |

**CONFIRMED_STATIC** for XML/style command wiring and handler dispatch [G16–G17]. The long-press recognition deadline comes from inherited Android View processing. An optional `jd1` repeated-long-press helper exists but is not the demonstrated cadence owner for these commands: the player service has its own message loop, traced below [G27].

`BusActionButton.performClick` checks edit mode, performs normal view feedback and calls `BusActionBehavior.B(false)`. Long click calls the behavior's long path. `onTouchEvent` explicitly sends a configured long-end message for masked UP **or CANCEL**. The hard-failed JADX method `BusActionBehavior.В(ZZIZIZLjava/lang/Object;III)Z` was traced in smali: it first tests `state_gui_nav_animating` and returns false when true, then selects ordinary or long command/bus, validates them, and uses `А(...)` to dispatch when no confirmation dialog is configured. This is an actual command gate during navigation, not merely a visual disabled tint [G17]. Do not claim it gates every control: the mini `PlayPauseButton` uses a direct message path.

### Held transport seek: verified service timer boundary

`y01.B` routes begin-seek-jumps to `PlayerServiceCore.A(arg1,arg2)`. If no existing jump session and the current track is seekable, `A` stores `SystemClock.elapsedRealtime()`, removes stale message3 and queues message3 immediately. On each message3, the handler chooses forward iff arg1 is 1 and requests a step of `5000 * max(1,arg2)` milliseconds while elapsed time since **begin-seek-jumps** is less than 3000 ms; at or after 3000 ms it requests 20000 ms. It then schedules the next message3 after 250 ms, or 750 ms when the current pipeline's `О().В & 8` flag is nonzero. The semantic meaning of that pipeline capability flag is not established here; preserve the condition instead of inventing its device category. End-seek-jumps removes pending message3 and resets the start timestamp [G27].

`PlayerServiceCore.О(step,forward,true)` accepts playback states1/2, converts direct small step values ≤50 into `step*5000` ms, applies relative current position and seeks within the track. With the `true` boundary flag supplied here, crossing an endpoint invokes previous/next-track navigation. Consequently the category-button morph's short `arg2=2` really requests a 10000 ms jump; ordinary previous/next held seeking starts with 5000 ms steps because their argument2 defaults to0, then accelerates after the service's three-second window. These are **CONFIRMED_STATIC scheduled parameters**, smali-checked; dispatch latency, actual pipeline seek completion and displayed time movement are not measured runtime cadence. The three seconds start after Android recognizes long press and the begin command reaches the service, not at finger DOWN [G16–G17, G27].

### Repeat and shuffle

The default sub-art row preference contains visualization, sleep timer, spacer, shuffle, repeat (`c40.C0`). The buttons are constructed at runtime as `BusSelectablePopupButtonLayout` with `TopEditableDynamicButtonLayout → TopBaseButtonLayout`; those styles do not override `openOnClick`. The `fp1` constructor defaults it false. Thus short click cycles the current selection; long press opens the list under ordinary closed/nonmodal state [G22].

| Event/state | Result |
|---|---|
| Closed button, short click, `openOnClick=false` | `fp1.performClick → R1`: find currently selected visible option, increment index, wrap to zero; subclass `R1` dispatches selected child bus action. |
| Closed, normal state, long press | `base.В.performLongClick`, `y1()==!openOnClick`: haptic + `v1()` popup. |
| Popup option click | Select corresponding enum via `cmd_player_set_shuffle_mode` or `cmd_player_set_repeat_mode`; selection/popup presentation uses separate state messages. |
| Shuffle quick cycle | Wiring also has toast command and delayed shuffle command; delay input `max(0,popupExitAnimTime−64)` belongs to its configured action path, not a universal click delay. |
| Repeat quick cycle | Set-repeat mapping with argument2=1; shuffle uses argument2=0. |

**CONFIRMED_STATIC** for default style path, cycle/open routing and enum wiring [G22]. Repeat order: single song; play one category; play all categories; repeat song; repeat category; repeat-and-advance. Shuffle order: off; all; songs; categories; songs-and-categories. These lists are resource-array order, not a claim about translated text or user's enabled options. The owner may reorder/change sub-art buttons and built-in preferences [G22–G23].

Long press on the **sub-art layout itself** can start customization, separately from long press on a shuffle/repeat child. `SubAAButtonsLayout.performLongClick` is now **smali-verified**: if optional scroller `N` exists, reject owned drag state2 or active physics; if `N` is absent, continue normally (JADX incorrectly obscured that path). Then require both displacement axes ≤`ViewConfiguration` slop. If not already editing, `sub_aa_buttons_no_lp_edit` is false and feature entitlement passes, call `F1` and consume the long press; haptic code3 occurs only if `F1` succeeds. Otherwise fall back to the inherited long-click handler. `F1` rejects animation/modal/non-main states. The row is long-clickable; it does not forward a consumed child long press into row editing [G23].

Target separation is also source-visible: closed dynamic button leaves inherit `PopupButton` with clickable false, while their `TopBaseButtonLayout` container is clickable/long-clickable. `fp1.T1(true)` enables option children when the popup is opened; `T1(false)` disables them when closed. `SubAAButtonsLayout.onInterceptTouchEvent` delegates only to optional scroll controller and otherwise to normal parent dispatch. Thus a stationary contact delivered to the repeat/shuffle container opens that popup, whereas a stationary contact delivered to blank row space can enter editing. Native dispatch validation is still needed for simultaneous movement, popup close, and edit-state changes, but no unresolved smali branch is being used for this distinction [G22–G23].

## 7. Library momentum and protection from moved targets

Ordinary library pages from `pd.C0`/`bk0.C0` install `m22(sa0(xp,false))`. The inherited `hc` is vertically dominant; `m22.y` tries that first. If it declines and horizontal navigation is enabled, `l22` requests `d0(y71.class,dx<0)` and normalizes x movement by view width for the history adapter. This is enough to establish distinct scroll versus history owners at the player boundary; it does not catalog every library page [G25]. Lyrics `fp0` supplies its own `kp0` subclass and must not be generalized to ordinary library physics.

| Boundary event | Proven mechanism | Limit |
|---|---|---|
| Finger DOWN during library fling | `m22.у` checks `hc.h(true)` and `owner.Н(event)`, cancels long press and returns true to intercept when applicable; then stops active fling. | `hc.h(true)` treats state1 fling with absolute current velocity ≤`13.75*density` as effectively non-intercepting. `om0.Н` has a special visible `w62` header-region exception. This is not “all momentum always blocks all taps.” |
| Scroll versus horizontal history | Dominant-axis `hc.О` versus fallback `l22`; one handler stored in `j0.O` | No retargeting to another page merely because a later MOVE points another way. Transition adapters can explicitly reverse/cancel. |
| Drag steals a child sequence | Interception changes to true after a handler is acquired; framework dispatch handles child cancellation | Native run needed to validate reordered frame/input delivery under rapid transitions. |
| Click while list inhibition bit1 set | `PowerList.I0` returns blocked code3; `M0/u/d0` have related masks | Not proof that every moment of every animation always sets every mask. Scene report traces state changes. |
| Main list special state `A==2` | `om0.I0` returns consumed code2 without item action | Distinct from low-level inhibition bit1. |
| Click bubbling from moved/recycled item | Resolve current ancestor and `vj0` item before invoking `s`/`w` | No source-backed global coordinate-based “click through to item underneath” mechanism in this path. |
| Navigation animation and full transport | `BusActionBehavior.В` rejects command while `state_gui_nav_animating` | Direct-message controls require their own ownership analysis. |
| Mini play button versus title/art | `FastButton.x0=true` stops parent click forwarding | Proven child-target separation for this button, not a promise about every editable child. |

**CONFIRMED_STATIC** for mechanisms and conditions [G01–G02, G17, G20, G25]. This supports a native design with contact ownership and explicit inhibition. It does **not** establish a universal “no accidental activation ever” result. The scene report's `TopNavSceneFastLayout.requestDisallowInterceptTouchEvent(false) → i22.K` path is another relevant interruption layer and should be considered alongside these list mechanisms.

## 8. What is ready, and the precise remaining work

The input contract is ready as a source-derived implementation reference for normal single-pointer artwork paging, vertical artwork transition acquisition, fixed/scrolled waveform distinction, deferred seeking/cancellation, mini-player tap/button separation and transport command mapping. It is not ready for a claim of runtime parity. No authentic input trace, video, frame timing, ViewConfiguration values or active owner settings were captured.

| Gap | Type | Smallest next static target / native experiment |
|---|---|---|
| Mini vertical input | Runtime validation of resolved negative static result | Normal closed navbar has no vertical mini-to-full progress owner; test slow upward drag starting on title/art, seek bar and play button, including sheet-open configuration. Static ancestor chain is closed in §5. |
| Rapid re-grab/reversal during shared transition | Runtime validation of substantially traced static machinery | Exercise `w.C/Р → list.А.p/О/у → x32 → om0/i22` at 10%, 30%, 70%, 90% completion, reverse twice before release, capture frames and final page. Check whether model/page identity changes before painted geometry and whether the new DOWN starts at current painted offset. |
| Active horizontal page settle then artwork tap | Runtime plus narrow ownership trace | `w.f/x`, `a0.у/К`, model `P` offsets and `PowerList.I0`; tap current and incoming art near settle start/end. Record whether first contact only stops motion, then verify category URI target. |
| Parent/child moved-target sequence | Runtime validation | Start on artwork near line2/control boundary, acquire vertical drag, release over mini play; separately start on mini play, move through expansion. Assert command stream/final state rather than infer from visual state. |
| Third pointer, primary lift, fixed/scrolling differences | Runtime validation; abnormal pointer branch trace if discrepancy | `j0.х` primary/secondary transitions and raw-action wrappers `m92/Seek`; add/remove fingers in both orders during seek, page drag and shared transition. No arbitrary-pointer behavior is promised. |
| Sub-art child long press versus layout editor | Runtime validation of resolved static branch | `SubAAButtonsLayout.performLongClick` smali, `b82` interception and `fp1.T1` clickable-child routing are resolved; compare stationary repeat/shuffle, blank spacer and moved contact with editing preference on/off. |
| Seek-jump perceived cadence / pipeline capability | Runtime validation plus narrow flag meaning | Scheduled step/delay is resolved in `y01.B/PlayerServiceCore.A/О`; identify `Pipeline2.О().В` flag8 producer only if that750ms branch matters. Record holds for1/2/4 seconds, including endpoint crossing; observe pipeline latency separately from timer delay. |
| Device thresholds and long press timing | BLOCKED runtime configuration | Record Android version, density and `ViewConfiguration` slop/min/max fling/long-press values or measure controlled gestures; do not choose numeric Android defaults. |
| User's actual variant | OPEN owner settings | Built-in settings export or screenshots of seekbar mode, more buttons, lyrics swipe, line2/menu long press and mini seek setting. Declared defaults remain distinct from owner-selected values. |
| Source wave friction/rebound versus visible time | Runtime validation | Compare very slow drag, release at min-fling boundary, high-speed fling, endpoint overscroll and CANCEL; correlate with `hc/eh0/fc/m92.J` and audio seek completion. |

The minimum useful recording is 15–30 seconds containing artwork-to-library drag and reversal, mini tap expansion, horizontal artwork swipe, and a waveform drag/release. A second short clip demonstrating fixed waveform, if enabled by the owner, prevents confusing its immediate absolute seeking with the scrolling waveform.

## 9. Exact evidence source index

Line numbers refer to generated files in this extraction; symbols and smali labels remain the stable locators if regenerated.

| Key | Source locations and verification |
|---|---|
| G01 | `jadx/sources/ׅ/j0.java` constructor, `K`, `А`, `y`, `х`; **smali cross-check** `decoded/smali/ׅ/j0.smali:1242` method `х(MotionEvent)I`, especially armed MOVE return at 2952–2983 and terminal branches following 3068. `m22.java:61` cleanup and `у`. |
| G02 | `jadx/sources/com/maxmpz/widget/list/PowerList.java:215` `I0`, :617 `d0`, :646 dispatch, :1098 intercept, :1167 touch, :1294 delayed child pressed; **smali** `decoded/smali/com/maxmpz/widget/list/PowerList.smali:810` `I0`, `:goto_0/:goto_1/:cond_5`. `ׅ/om0.java:223` and smali :1119 `I0`. |
| G03 | `jadx/sources/com/maxmpz/widget/player/list/AAItemView.java` `performClick`, `ׅ/cy0.java:1693` `С`; `ׅ/om0.java` `w`; `ׅ/p31.java:472` `K`; `ׅ/С.java:168` `f`, :335 `z0`; **smali** `decoded/smali/ׅ/С.smali:1298` `f`, labels `:cond_0–:cond_8`; :2346 `z0`. |
| G04 | `jadx/sources/ׅ/om0.java:1140` `z(x61)`, `l0` :506; `AAItemView.performLongClick`, `cy0.c`, `PowerList.l` callback chain. |
| G05 | `jadx/sources/ׅ/hc.java:40` constructor, :241 `h`, :307 `О`, :316 `Р`, :432 default constructor; `ׅ/xp.java` ViewConfiguration ownership. |
| G06 | `jadx/sources/ׅ/С.java:383` `р`, `ׅ/w.java:72` `C`, :329 `О`, :362 `Р`; **smali** `decoded/smali/ׅ/w.smali:1883` `О`, labels through :2129, for axis and ±.05 gate. |
| G07 | `jadx/sources/ׅ/w.java:405` `у`, :309 `Н`; **smali** `decoded/smali/ׅ/w.smali:2317` `у(FLׅ/q71;Z)V`, `:goto_0`, `:cond_1/:cond_2`; constructor :80 constant .2. |
| G08 | `jadx/sources/ׅ/a0.java` `К`, `у`; `com/maxmpz/audioplayer/list/ListWidget.java:158` `X0`. |
| G09 | `jadx/sources/com/maxmpz/widget/list/А.java` `Р`, `О`, `p`, `р`, `у`; `com/maxmpz/audioplayer/list/ListWidget.java:115` `P`, :206 `b1`; `ׅ/c40.java:176` `main_lyrics_swipe`. |
| G10 | `decoded/smali/com/maxmpz/widget/list/PowerListTransitionBase.smali` `A(PowerList,FF)`, lines155–205 `:goto_3` zero versus `:cond_5` retain; full trace in scene report. |
| G11 | `decoded/res/xml/poweramp_builtin_skins.xml:42` and :109 seekbar switch; `decoded/res/values/styles.xml:7473` TopWaveseek, :7474 TopWaveseekStatic, :16628 TopWaveseekBase; `m92` constructor. |
| G12 | `decoded/smali/ׅ/m92.smali:5093` `onTouchEvent`, :5617 `setPressed`, :1463 `H`, :2567 `d`, :5948 `Р`, :6069 `Х`; paired `jadx/sources/ׅ/m92.java` constructor, `d/e/H/J/P/o`. Entire damaged input method inspected in smali. |
| G13 | `jadx/sources/ׅ/i51.java:119` `X`, :343 `Х`; **smali** `decoded/smali/ׅ/i51.smali:699` `X`, :2074 `Х(FZ)`. Command constants resolve via `decoded/res/values/public.xml`. |
| G14 | `decoded/smali/ׅ/m92.smali:5617` `setPressed`; Java `m92.J`; `i51` constructor deferred flag. |
| G15 | `jadx/sources/ׅ/hc.java` `H/Р`, `ׅ/eh0.java` `B/В`, `ׅ/fc.java` `run`, `ׅ/m92.java:139` waveform physics construction. |
| G16 | `decoded/res/layout-sw2dp/activity_main.xml:25` play/pause commands (also :26/:30); `decoded/res/values/styles.xml:7680` TopPrevCat, :7704 TopRw, :7720 TopFf, :7737 TopNextCat, subsequent long-seek morph styles. |
| G17 | `jadx/sources/com/maxmpz/widget/base/BusActionButton.java` `performClick/performLongClick/onTouchEvent`; `BusActionBehavior.java` `B/onLongClick`; **smali** `decoded/smali/com/maxmpz/widget/base/BusActionBehavior.smali:1410` `В`, early `:cond_2` gate and :1980 `:cond_12` direct-dispatch branch. |
| G18 | `decoded/res/layout-sw2dp/merge_navbar.xml:20` navbar_list, :23 Seek; `decoded/res/layout-sw2dp/item_miniplayer.xml`; `jadx/sources/ׅ/hx0.java:73` `o`, `ׅ/jx0.java:209` `р`, `ׅ/gx0.java` `u1`, `ׅ/pv0.java` constructor/`A`. |
| G19 | `jadx/sources/com/maxmpz/audioplayer/widget/Navbar.java:108` `N0`, :280 `onItemClick`, :308 `t0`; **smali** `decoded/smali/com/maxmpz/audioplayer/widget/Navbar.smali` `onItemClick` validates `cmd_nav_to_main` dispatch. |
| G20 | `jadx/sources/com/maxmpz/widget/player/PlayPauseButton.java:20` constructor and :70 `performClick`; `com/maxmpz/widget/base/FastButton.java:36` `performClick`, :52 `performLongClick`. |
| G21 | `jadx/sources/com/maxmpz/widget/player/Seek.java:40` `B`, :82 `onTouchEvent`; **smali** `decoded/smali/com/maxmpz/widget/player/Seek.smali` `B(MotionEvent)V`, `:cond_1` `int-to-float`/`div-float`; `ׅ/c40.java:180` navbar_seekbar. |
| G22 | `jadx/sources/ׅ/cm2.java:1610` shuffle and :1659 repeat constructors; `ׅ/fp1.java:43` openOnClick default, :393 `R1`, :490 `performClick`, :516 `x1`, :521 `y1`; `ׅ/wa1.java:75` d0 attribute map; `com/maxmpz/widget/base/В.java:438` long press; `BusSelectablePopupButtonLayout.java:286` `R1`; `decoded/res/values/styles.xml:8150` TopBaseButtonLayout, :16554 TopEditableDynamicButtonLayout; `decoded/res/values/arrays.xml:1037` repeat and :1086 shuffle lists. |
| G23 | `jadx/sources/ׅ/c40.java:220` row defaults and `G0`; `com/maxmpz/widget/player/SubAAButtonsLayout.java:932` `performLongClick`, :358 `F1`, :670 intercept, :889 touch; **smali** `decoded/smali/com/maxmpz/widget/player/SubAAButtonsLayout.smali:5771` `performLongClick`, `:cond_0` permits absent scroller, `:cond_4` super fallback, `:cond_5` rejection. `ׅ/fp1.java:445` `T1`; `decoded/res/values/styles.xml:6374` PopupButton clickable false. |
| G24 | `jadx/sources/ׅ/С.java:33` `B0`, :300 `y`, `A0`; `ׅ/b40.java:373` line2 click and :378 long preference; `ׅ/c40.java:214` menu long preference. |
| G25 | `jadx/sources/ׅ/pd.java:61` `C0`, `ׅ/bk0.java:16`/`:160` page controller; `ׅ/m22.java:25` `y`, :75 `у`; `ׅ/l22.java:45` `C`, :143 `О`, :164 `Р`; `ׅ/om0.java:1211` `Н`; `hc.h/constructor` low-velocity exception. |
| G26 | `decoded/res/layout-sw2dp/merge_navbar.xml` complete ancestor/subtree layout; `jadx/sources/ׅ/gx0.java` and `com/maxmpz/audioplayer/widget/Navbar.java` complete methods (no touch override/installer); `com/maxmpz/widget/base/FastLayout.java:809` optional a01 intercept; `SceneFastLayout`/`FastLayoutWithViewCacheOpt` inherited dispatch; **smali** `decoded/smali/ׅ/i22.smali:9028` complete `y(MotionEvent)Z`, state guard/event switch through `:cond_8`; `TopNavSceneFastLayout.java:119` requestDisallow; `com/maxmpz/widget/player/NavbarExtension.java:194` intercept, :206 touch, :244 `u`, :255 `y`; `BaseActivity.java:357` dispatch; `BasePowerWidgetActivity.java:491` layout install. DEX `iput-object ... FastLayout;->О:Lׅ/a01;` search covered all optional-interceptor installers. |
| G27 | `jadx/sources/ׅ/y01.java:193` direct/begin/end messages, :378 internal message3; **smali** `decoded/smali/ׅ/y01.smali:1051` command routes, :2430–2580 `:cond_50–:cond_54` step acceleration/delay; `decoded/smali/com/maxmpz/audioplayer/player/PlayerServiceCore.smali:1031` `A(II)` start gate and immediate queue, :11441 `О(IZZ)` step scale/boundaries. `BusActionBehavior.java` constructor argument2 default0 and `TopRw/TopFf` absence of arg2 override. |
