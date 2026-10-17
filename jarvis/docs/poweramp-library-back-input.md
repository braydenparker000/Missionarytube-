# Library Back after horizontal page history

October 5, 2026. This repair preserves the accepted page appearance, motion
thresholds, settling duration and real nested ancestry.

## Diagnosis

Run `37252137215`, job `111581772568`, timed out in `trusted nested Back/Forward
and new category branches keep exact ancestry`. Its trusted-input evidence
shows both horizontal history visits finishing, followed by a stationary
Back-label contact. Chromium delivered `pointerdown`, `pointerup`, touch events
and implicit capture on the label span, but no compatibility `click`. The
rendered Back button used only `onclick`, so no ancestor navigation occurred.
The trace does not establish why Chromium omitted that click.

## Repair

The reference header binds Back through the existing production
`bindTapButton` owner. Touch and pen activate on an eligible pointer release;
mouse and keyboard keep their click path. Travel, long hold, resize, background,
capture loss, inactive-screen and duplicate-click guards remain in force. The
action still calls `Views.back`, with no history algorithm or visual changes.

A deterministic multi-contact regression also found that the second contact's
capture-phase click guard cleared the first contact's cancellation block after
the document lifecycle reset. The tap owner now retains that canceled pointer
identity and rearms its block when rejecting the second contact. A fresh later
contact clears it normally. This prevents a stale primary click from navigating
after rejected multi-touch, even if a browser supplies that click.

The owner uses the existing shared lifecycle multi-touch reset, rather than
installing a document listener for every rendered Back header. Disconnected
header resets are pruned on lifecycle cancellation; document work stays
constant through repeated navigation.

## Validation and limits

- 1,071 non-browser repository checks passed, with no skipped checks in that
  invocation
- Four new source-handler integration checks execute the production tap owner,
  rendered Back binding and library ancestry/history implementation. They cover
  click-less touch/pen Back after horizontal Back/Forward, exactly one parent,
  Forward branch replacement, canceled and repeated contacts, mouse/keyboard,
  selection dismissal and inactive-screen protection. A 120-header replacement
  regression checks constant document-listener count, bounded lifecycle resets,
  disconnected cleanup and cross-target multi-touch cancellation
- The click-less release regression fails against `daa7107`; the multi-contact
  stale-click regression also fails when only the old tap owner is substituted
  into the new Back binding
- The mandatory trusted Chromium ancestry contract now targets the same inner
  Back label as the failing trace, asserts exactly one parent visit and waits
  for fully settled page endpoints. An additional trusted contract covers moved,
  resized and multi-touch Back contacts, fresh recovery and keyboard Back
- Production and browser-test JavaScript syntax and `git diff --check` passed

Local Chromium was attempted again with the repository's unchanged launch
options. It exited before creating a renderer because `socket()` was denied
with `Operation not permitted` in its process singleton. The trusted browser
suite remains mandatory and was not skipped or weakened. Its new cases and
physical-device behavior therefore still need verification in an environment
that can launch Chromium.
