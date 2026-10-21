# Poweramp 1031 — Session 2 interaction and motion contracts

This is original-APK static research, not a recreation specification inferred from a prototype. The private source root is `/workspace/work/poweramp`. `interaction-contracts.json` contains machine-readable claims, cancellation matrix and open method targets; `evidence-ledger.jsonl` carries `PA1031-S2-INPUT-001`–`032` with source path, symbol and locator. “Confirmed” means confirmed in source, not observed on a device. Smali resolves the named decompiler failures below.

Session 1 remains authoritative for the common `PowerList→j0` dispatcher, framework slop/velocity, pointer release, full artwork, waveform, mini-player, transport and library fling ownership. Reuse `PA1031-GESTURE-001`–`003`, `013`, `033`–`034`; do not replace their conditional thresholds with the different dialog, knob or reorder rules here. Screen/history routes and actual scene geometry are covered by the Session 2 screen graph and renderer/atlas artifacts. Settings persistence/control coverage belongs to the Settings artifacts.

## Coverage and implementation boundaries

| Surface | Input owner | Depth established here | Evidence |
|---|---|---|---|
| Library browse, ordinary scroll, horizontal history | `PowerList/j0/m22/hc`, history `y71/p31` | Shared touch classifier retained from S1; history recipients owned by screen graph | S1 `001–003,013,033–034` |
| Library and EQ multiselection | `jp1`, originating list, `SelectionMenuBehavior` | Entry, toggle, range, stable ID conversion, modal registration/close | S2 `001–004,027` |
| Queue/playlist item reorder | `DragHandler→om0→kw0/iw0→yf0→g32→x8` | Capture guards, preview ownership, release/cancel, submit and delayed cleanup | S2 `005–009` |
| Search and preset local search | `ListSearchEditText/LocalListSearchEditText→jm0` | Focus, IME request, text synchronization, main-search mutation, Back fallthrough | S2 `010–012` |
| Context/button popups | `base.В→t61` | Scrim/Back/child-click close, veto, state lifecycle | S2 `013–014` |
| Dialog activities | `DialogBehavior→wm/j0→vm→do1` | Direct drag, release threshold, resistance, completion, veto, IME close | S2 `015–017` |
| Navbar More | `gx0→NavbarExtension→wm/vm` | Toggle, modal timing, Back, scrim and collapse targets | S2 `031` |
| Nested dialog scrolling | `DialogOuterFastLayout→wm/vm` | Boundary handoff, direct-intercept suppression, synthetic events and velocity suppression | S2 `032` |
| Android Back | `ac`, legacy Activity, `p6`, API34 `zb` | Registration priority and progressive callback protocol | S2 `018` |
| Tone/volume/reverb round knobs | `RoundKnob`, DSP subclass `bs` | Annular capture, angular mapping, snapping, live bus change, release, animation | S2 `019–022` |
| EQ gains and linear DSP controls | `LinearKnob`, `f10`, `DSPLinearKnob` | Thumb/track/label state, relative mapping, steps, cancellation, target/display animation | S2 `023–026` |
| Parametric EQ | `c10`, `EqKnobsList`, common `kw0` | Frequency/Q command routes, lock, selection, reorder bus adaptation | S2 `027` |
| EQ frequency-response overview | `FrequencyResponseScroller` | Viewport drag/tap, interruption, release; not a frequency/gain editor | S2 `028` |
| Numeric knob entry | `KnobLabelAndValue→PseudoAlertDialog→yi0` | Long press, apply/cancel, parsing and normal value path | S2 `029` |

This is enough to choose separate interaction owners for future implementation and to define targeted native validation. It is not sufficient to claim app-wide faithful motion. Full grouped-reorder geometry and several asynchronous result races remain static gaps; authentic touch/keyboard/multitouch recordings remain absent.

## Library selection is a state machine with a range toggle

The library long-press path reaches `om0.z→H.A`, whereas an ordinary click in selection mode is intercepted by `p31.K` and toggles selection instead of navigating. The mode is owned by `PowerList.H` (`jp1`), not by each checkbox. Entry requires `list.d()`, no current selection transition (`jp1.Х==0`), ordinary mode and a compatible `pj0` model. It allocates a position-indexed selection array, changes list mode, reveals item affordances, and requests the correct selection menu. Affordance reveal requests 250 ms when animated; actual checkbox/handle drawables implement their own interpolation. `[001]`

Single-item toggling changes the array/count, updates the anchor and calls the item's `al.P0` plus list `M(total,selected,all)`. Range selection is unusual and must be preserved: it applies to indices strictly between the old and new endpoint. If every interior item was already selected, it clears the interior; otherwise it selects the missing interior items. It preserves endpoints. Smali `jp1.К` sorts endpoints correctly; JADX's reconstructed swap is misleading. The explicit range command uses first/last selected indices as endpoints. `[002]`

For an operation, `jp1.x()` returns positions; `jp1.X()` converts selected positions through the provider's `b71.B` into operation IDs. A future implementation must not interchange these. Exit clears array, counts and anchor and hides selection affordances. During an active list transition it first routes through `list.b()` rather than directly replacing state. `[003]`

```text
item input → om0/p31 → jp1 selection flags + count + anchor
                              ├─ al.P0 / al.H → checkbox + drag affordance
                              ├─ list.M → state_list_selection_count / all_selected
                              └─ list.N → cmd_selection_menu_open(layoutID,listBusID)
                                                → SelectionMenuBehavior
```

`SelectionMenuBehavior` states are 0 absent, 3 opening/requested, 1 open, 2 closing. It dynamically inflates the originating menu and retargets action/state subscriptions to the originating list bus, including EQ lists. Reopening the same active layout does not replay entry; replacing a different active layout closes the old one without animation before replacement. Back in state1/3 initiates close, sends `cmd_end_selection_mode` to that list, closes selection help, and animates scene0. It unregisters Back and clears GUI modal state only on scene0 completion. The `SelectionMenuSubcontainer` XML style supplies 500 ms enter and 200 ms exit, both passed through `AnimTimeHelper`; these are base durations, not measured frame timing. Smali resolves all open/replacement branches. `[004]`

## Reorder has a preview mapping and a delayed persistence boundary

`DragHandler` initiates from DOWN. It finds its `PowerList`, finds the parent item, invokes the list's reorder acquisition, and never performs a normal click. This is a dedicated-handle contract; it does not establish a global “long press starts drag” rule. `om0.К` bytecode accepts only nonnegative item index, `(list.О & ~32)==0`, list mode0/1, `ax` model, `m22` controller and positive `yu0.Н` model eligibility. Successful `kw0.А` installs the drag owner, sets update flag41/Q and produces haptic0. `[005]`

`iw0` holds source index, active candidate, geometry, original layout state, selected-index information and an integer preview mapping. Its displayed ordering is separate from persisted provider ordering. `m22.c==2` selects `ip1` as drag handler. `ip1.C→kw0.y` advances the lifted item, constrains cross-axis movement for single-column lists, and changes candidate/mapping before starting an `x32` rearrangement. Grouped-selection geometry and reverse candidate crossover remain incompletely verified because these very large decompiled methods have damaged branches. No speculative exact hit rectangle is promoted to a confirmed contract. `[006]`

| Phase/event | Owner and result | Completion/cancel boundary |
|---|---|---|
| Handle DOWN | `DragHandler→om0.К→kw0.А` after eligibility | Failure leaves ordinary View handling |
| Captured MOVE | `ip1.C→kw0.y`; drag view and preview map change | Provider has not yet been reordered |
| Pointer UP | `ip1.Р→kw0.x(true)`; `m22.К` also releases owner | Stop autoscroll; finish active rearrangement/settle |
| ACTION_CANCEL | Common `j0` supplies zero velocity to the same release method | Does not restore original map |
| Explicit handler interruption | `ip1.c→kw0.x(false)` | Immediate finalization route; not an undo operation |
| Position settle | State3 finishes `x32`; other states use `gw0` 250 ms position interpolation | Then `kw0.K(false)` restores scale over150 ms |
| Finalize | `hw0`/transition completion→`kw0.X→kw0.Х→cx.K` | Provider-specific commit callback |

Lift scale requests 350 ms; release position uses default `DecelerateInterpolator`; scale uses `AnticipateInterpolator` with different entry/return tensions. Group completion can add transitions, so “release takes400 ms” is not an app-wide promise. The lazy factory `fw0` constructors were smali-checked: one actually selects `hw0`, the other `gw0`; JADX incorrectly prints a fixed synthetic selector field. `[007]`

The commit chain for list items is:

```text
kw0.Х(iw0) → yf0.K(mapping)
  → current p31.о implements y21 AND p31.O pending provider == null
  → changed mapping? g32.х(poses)
  → bus_data_cmd cmd_data_reorder(UriAndIds{URI, poses})
  → x8 handler → bi1.р(provider,URI,poses)
  → msg_app_data_changed
  → if queue(ui1): cmd_player_on_queue_updated(false)
```

The success path sets `ListWidget.R=true` and **does not immediately tear down the drag helper**. `om0.m0` later clears that flag and calls helper `у()`. `yf0.K` smali1100–1248 proves this; JADX falsely shows unconditional teardown after the loop. Unchanged/unsupported mapping takes immediate cleanup. A future web implementation needs this distinction between visual preview and data replacement, while exact failure/concurrent-mutation handling is still untraced. `[008]`

Edge autoscroll is a separate `kw0.х→sa0.о` mode, conditional on edge overlap, density, orientation, edge span and directional model flags4/64. It stops at release. Its constants are not documented as a fake universal fling speed: the edge-span source and frame integration need more source work. `[009]`

## Search updates on text change; IME and app Back have separate owners

Search entry activates a list-state subscription, copies current text and optionally requests focus/keyboard. `nav_search` uses arg1==1 to request keyboard; explicit `cmd_nav_to_search` also focuses/selects all. `jm0.B` waits for window focus if needed, then selects all, requests focus and calls `InputMethodManager.showSoftInput(...,1)`. Local preset search activates without forcing this keyboard request. `[010]`

The user-text path is synchronous at its UI boundary:

```text
jm0.onTextChanged (deduplicate)
  → list bus cmd_list_search_text
  → om0.onBusMsg
  → vo1.X0 (deduplicate)
  → vo1.S0 → new search URI / data-load request
```

`jm0.A` disables its text listener around `setTextKeepState`, preventing a state echo from issuing another query. No delay/debounce is present in this chain. This does not prove the downstream data loader has no coalescing or cancellation. Search history/return routing is in the screen graph. `[011]`

Main/library/EQ/lyrics navigation, selection entry and detach clear focus and hide the keyboard. Focus registers the editor in app Back arbitration, but `jm0.r0()` returns false, so it does not consume app Back. The keyboard can consume Back before the Activity sees it; that native priority and keyboard animation have not been observed. The app custom `EditText` and `jm0` do not implement a custom search submit on IME action. `[012]`

## Popups and dialogs have different dismissal contracts

The `t61` popup controller adds a clickable scrim to `MenuPlaceholderLayout` and brings/reparents the popup into that host. States are1 opening,2 open,3 closing. Entry completion restores focus. Scrim DOWN asks to close, except near system-gesture excluded edges determined by `r90` and raw display coordinates. Back accepts states1/2. Clickable child click/long-click posts a close request after50 ms. The originating popup's `base.В.t1` can veto animated close; repeated animated close while closing returns. Per-popup caller arguments select the duration/geometry, so no single global menu duration is asserted. `[013–014]`

Dialog activities use `DialogBehavior`. Back calls `d(false,true)`; scrim collapse calls `d(true,true)`. Progress state2 blocks the latter but can allow Back, subject to activity `cv.canCollapseDialog`. Outgoing idle scene rejects redundant collapse. Closing hides IME and changes to the proper outgoing scene. Completion checks the activity veto again before `onDialogCollapsed` and `Activity.finish`; a veto can reopen the scene. `[015]`

With nonzero `collapseDragDirection`, the dialog installs `wm` and `vm`. The direct gesture classifier still uses the common `j0` slop, but its progress and settle rules are distinct from library/art transitions. Acquisition requires the contact within dialog bounds, outgoing scene availability, and an active/accepted scene transition. Displacement is vertical, reversed for upward collapse, normalized by the dialog height/bottom and added to existing progress. Overrun uses logarithmic resistance `0.05*ln(1+abs(overrun)/0.05)`; when collapse is disallowed, resistance applies to the entire movement. `[016]`

Smali `vm.В` resolves the damaged Java release expression:

| Direct drag | Commit | Cancel |
|---|---|---|
| Down | `vy > threshold`, or `−threshold <= vy <= threshold` and `progress > ratio` | Strong reverse fling, or slow progress at/below ratio |
| Up | `vy < −threshold`, or same bounded-speed progress test | Strong downward fling, or slow progress at/below ratio |

Equality at either velocity threshold falls into the progress test. Completion passes `abs(vy)/extent`; cancellation passes zero velocity. Duration uses `dragAnimTime × max(.25,remainingDistance)` for the normal0..1 range, with explicit out-of-range handling in smali. Explicit interruption sets duration0. **ACTION_CANCEL from the shared classifier is a zero-velocity release and can still complete when progress exceeds the ratio**; it is not a guaranteed revert. `[017]`

The effective inherited `BaseDialog` resource supplies ratio0.5, velocity1800dp converted to pixel magnitude, drag time1000 ms and automatic time350 ms. Bottom sheets use down; top/centered use up; centered overrides automatic time450 ms. Constructor fallback values0.8/1000px/500ms are not the BaseDialog effective values. Per-activity style changes must still be applied. Nested-scroll acquisition and velocity suppression are resolved in `[032]` below. `[017]`

App Back registration is reverse ordered: newest eligible `r0()` wins. API33 `p6` and legacy `BasePowerWidgetActivity` use this ordering. API34 `zb` adds `V` acquisition, `g0` progress and `T` completion/cancellation; cancelled predictive Back calls `T(0,0,false)` on its owner. The parent screen graph covers navigation owners. Native predictive gesture coordinates and keyboard priority still require validation. `[018]`

## Navbar More and nested sheet scrolling

The Navbar More sheet is a different owner from mini-player expansion. `gx0.v1` toggles `v`, activates the More button, requests the appropriate one/two/three-line sheet scene, registers Back and sets modal `navbar`. Back/reset-modal `gx0.t1` clears the button and state, unregisters Back, posts modal removal immediately and requests extension collapse. This timing differs from selection menu modal removal at animation completion. A non-BusAction navigation button pressed while More is open toggles the sheet; extension child click and long-click also request collapse. `[031]`

`NavbarExtension` shares `wm/j0/vm` direct drag and scrim dispatch, but its collapse targets are specific: one-line sheet→scene0, two-line sheet→two-line navbar, three-line sheet→three-line navbar. On collapsed scene completion it removes the shim listener and calls `gx0.t1` to reconcile state. Entry uses the NavbarExtension500 ms base through `AnimTimeHelper.calcAnimTime(f,false)`; normal requested collapse uses200 ms directly. A resolver rerun confirms both component and main theme omit the four drag attributes in all six API36 portrait360×640dp Black/Light × Default/Alternative/FullCover fixtures with registry defaults. Thus Navbar More uses `um` fallbacks: ratio0.8, velocity1000 rawpx/s (no density multiplication), drag time500ms, down direction1. These differ from BaseDialog0.5/1800dp. The proof is `session2/logs/input-navbar-default-proof.json`; it does not assert other themes/configurations. `[031]`

`DialogOuterFastLayout` bridges nested child scrolling to the dialog drag handler. Vertical-axis registration sets `DialogBehavior.c=true`, causing the direct frame interceptor to abstain. If nested dragging is enabled it initializes a synthetic DOWN; unconsumed vertical scroll subtracts from a storedY and sends synthetic MOVE. Once scene progress is above0.025 and child `scrollY>=0`, or below−0.025, pre-scroll consumes all incomingdy into the sheet. Otherwise child scrolling retains ownership. `[032]`

At nested stop it synthesizes UP and temporarily suppresses release velocity when `dragUseNestedScrollVelocity=false` **unless** the target is specifically an `android.widget.ScrollView` with a child whose measured height fits. This is an exact class/measurement distinction, not a generic scrollability test. `BaseDialog` enables nested dragging and disables nested velocity, with per-dialog overrides. Smali also proves the initial synthesized DOWN coordinates are(0,0), while the stored accumulator starts at(2,childHeight/2); a recreation must validate resulting event behavior rather than silently treating this as an ordinary centered drag. `[032]`

## Round knobs use angular relative drag

The DSP round knob is `bs`, a `RoundKnob` subclass. Generic parametric frequency/Q controls are direct `RoundKnob` instances inside `c10`; do not automatically inherit the DSP subclass's navigation-animation guard. `x82.A` is the locked/special state: locked controls route through ordinary View handling instead of changing the value. `[019,022,027]`

| Input | RoundKnob normal unlocked path |
|---|---|
| DOWN | Requires enabled view, both required drawables, `f()` permits, radius inside inclusive inner/outer ring. Captures, presses and disallows parent interception. |
| MOVE | Uses unindexed coordinates and previous relative vector. Remains active outside outer radius, but movement inside inner radius does not update. Angular delta is `atan2(cross(previous,current),dot(previous,current))` in degrees, clamped±30 **per event**. Adds delta divided by configured arc range. |
| Value | Clamps normalized rawO and paintedC. With center snapping enabled within default±.01, C takes exact default while O retains raw candidate. Endpoint/detent haptics use a sentinel to avoid repeating continuously. |
| UP/CANCEL | Clear capture/pressed, release parent interception, notify `onChangesEnded`. Keep values already sent during MOVE. |

The distinction O/C is functional: `bs.o` and `c10.onValueChanged` transform C when center snap is enabled, otherwise O. DSP round publishes `cmd_dsp_set_param(paramID,floatbits(value))` continuously for user changes. Matching external updates are ignored while pressed. Parametric frequency/Q issue `cmd_dsp_set_eq_freq` or `_q` against the band index; their end callback is empty, so UP is not a deferred commit. `[019–022,027]`

Programmatic animation uses mode/visibility guards. For animated changes: direct if normalized delta≤.001;120 ms if delta≤.05;400 ms otherwise; `DecelerateInterpolator(2)`. Notification can publish target before the painted interpolation. Pressed label styling uses the `anim_knob_pressed` scene and has its own resolved visual styles. No extra numeric press-duration is invented here. `[021]`

## Linear knobs have three distinct contact regions

Linear controls keep painted valueJ and targetL. Any input event stops the value animator and rebases target to current paintedJ. State1 is thumb drag, state2 pending track step, state3 label/default click. The thumb can capture through its actual bounds or an expanded minimum touch span; fallback is24dp, with a style override possible. `[023]`

For state1, normalized value is `startValue−dy/(usableLength−thumbHeight)` vertically, `startValue+dx/(usableLength−thumbWidth)` horizontally. MOVE updates directly, clamps and publishes. Horizontal DOWN immediately disallows parent interception; vertical DOWN does not, although `EqKnobsList` disallows its own parent on DOWN. Endpoint haptics are not a commit signal. `i41.А/В`, called around these gestures, is a reference-counted performance boost, not a DSP transaction. `[023,026,027]`

| Terminal input | Drag state1 | Track state2 | Label state3 |
|---|---|---|---|
| UP | Clear press/gesture; retain live value | Step toward release coordinate by±.05, rounded to twentieth | Default View UP click behavior |
| CANCEL | Same value retention | Skip step | Default View CANCEL handling |

The track-step bytecode skips a literal resulting zero target. Preserve that finding for native tests rather than silently normalizing it away. UP explicitly releases parent interception; CANCEL has no equivalent explicit call in this method. Values are continuous during thumb drag, so treating every cancel as rollback would diverge. `[024]`

Animated `LinearKnob.k` updates target and can notify immediately, while a separate `К` controller changes paintedJ. It uses a **linear** interpolation,500 ms full-span duration scaled by travel, with100 ms minimum. The100 is not a delay. Updates while hidden/unattached and sufficiently small changes can bypass animation. A new touch rebases from the partially painted value. `[025]`

`DSPLinearKnob` optionally maps normalized0..1 to−1..1, publishes its configured DSP parameter and ignores matching echoes while pressed. Gain `f10` publishes normalized `cmd_dsp_set_eq_gain` only on user change. `f10` is not a `DSPLinearKnob`; its inherited `u()` does not implement the navigation guard. Controls being visually in the same EQ page does not make their guards identical. `[026]`

Parametric rows combine gain/frequency/Q/type/channel/color/lock/selection/drag. Lock sets knob locked states and disables type/channel controls. EQ selection uses `jp1`; reorder uses `kw0` with a different commit callback. `c5.K` removes first/last utility slots and subtracts1 from mapped positions before `cmd_dsp_reorder_eq_bands`. Multi-band deletion/locking uses selected IDs. Full endpoint eligibility and grouping geometry remain open. `[027]`

## The response graph is a viewport control

`FrequencyResponseScroller` becomes touch active only with `!l` and a visible viewport rectanglez. Its touch behavior is horizontal scrolling of the EQ list/holder, not changing gain or dragging a filter point. Within the viewport rectangle it records start position and drags by `q+int(dx/k)`, clamped to `[0,content−viewport]`. Outside it mapsx/width, snaps ratios below0.1 to start and above0.9 to end, then animates to `round(ratio*(content−viewport))` for350 ms using `DecelerateInterpolator(2)`. `[028]`

If MOVE reaches4dp while that outside-tap animation is running, the animation is forced to completion and the drag origin rebased. UP and CANCEL share cleanup but do not cancel the running tap-scroll animation. Smali3888–4652 establishes these missing Java branches. `MilkFRS` is a separate rendering surface; no graph-edit contract is inferred from its name. `[028]`

Long-press label/value editing opens `PseudoAlertDialog` through `KnobLabelAndValue.e` when a provider/title exists; OK reads text and calls `yi0.setValueFromDialog`, Cancel has no value callback. Numeric input replaces comma decimal separators, maps/clamps through the knob's range, and checks the resulting value before using the normal animated update route. Invalid parse is ignored. Locked/hidden label guards and the activity's dialog support apply. `[029]`

## Cancellation comparison and remaining work

| Owner | ACTION_CANCEL result after capture |
|---|---|
| Round knob | Keep live parameter; release pressed/capture |
| Linear thumb | Keep live parameter; clear state |
| Linear track pending | Do not issue the pending step |
| Frequency overview | Keep scroll; existing outside-tap animation can continue |
| Queue/playlist reorder | Same finalization path as release, zero velocity; no map rollback |
| Direct dialog drag | Zero-velocity progress decision can finish collapse |
| API34 predictive Back | Different protocol: owner receives `T(...,false)` |

Smallest remaining static targets are explicit, not a blanket runtime excuse:

1. `kw0.А/y/X`, `iw0.В`: finish smali tracing grouped-selection packing, candidate geometry, reverse crossover and group finalization.
2. `bi1.р` implementations and `x8` reload flow: persistence failure, concurrent provider mutation and stable ID safety during reorder.
3. `vo1.S0→sd.q0/I` plus data workers: query coalescing and old-result replacement/cancellation.
4. `t61.А` and cleanup callbacks: every temporary reparent/detach/rapid-open branch, beyond established dismissal entry points.
5. App-wide runtime validation: same event sequences on the original build, especially multitouch, direction reversals, pointer cancellation, IME Back, predictive Back, reorder release during data change and exact native animation feel.

No V1/V2 source, owner settings or app code was accessed or changed for these contracts. Nothing was deployed. `[030]`
