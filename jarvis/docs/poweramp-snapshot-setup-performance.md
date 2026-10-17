# Shared-player setup: compact authored-style snapshots

October 5, 2026. Candidate repair based on the V5 downloaded preview's actual
Chrome operation report. Publication, screenshot review and phone acceptance
remain with the release owner.

## Observed bottleneck

The V5 5,000-track report measured synchronous, inclusive shared creation at
514.1 ms on the first mini tap and 442.3 ms on the repeated tap. Thirteen clone
calls accounted for 459.2 ms and 400.9 ms respectively. Held-drag setup took
323.9 ms (293.3 ms cloning), and regrab setup took 212.5 ms (190.9 ms cloning).
Normal paints were usually 0.2–1 ms. The lazy history fix already reduced
release history saves to 0–0.1 ms. These are CI Chrome measurements, not A15
FPS or phone touch latency. Nested operation durations overlap.

The clone path enumerated every computed property for every eligible source
node and generated pseudo, built a long CSS string, then parsed it back into
inline declarations. Native raster icons additionally exposed their large
inline custom `--icon` URL and the resolved mask-image URL in the computed
snapshot. Browser-default properties and inherited custom-variable strings
were repeated across otherwise small controls. The earlier 16-property fake
DOM could count calls but could not represent this serialization/parse cost.

## Candidate change

A scene-local usage plan reads the actual document stylesheets, including
nested/imported and adopted rules. Each source receives the properties authored
by its matching rules plus source inline declarations. Ancestor property names
are carried conservatively to descendants to preserve inherited font/color
and other appearance. The values are always the source's current computed
values, not raw authored expressions. There is no handwritten paint whitelist.

Authored shorthand, partial-axis and vendor aliases are expanded by the browser's
CSSOM against its complete computed-property inventory. Each inventory entry's
`initial` declaration is indexed by its canonical longhand slots. An authored
name inherits every aggregate/alias that shares one of those slots, including
aggregates whose specified serialization becomes empty when one axis changes.
Standard properties retain computed inventory order so overlapping aliases
preserve the exhaustive path's serialization. Before/after declarations belong
to their originating source's property vocabulary. Other pseudo types are
conservative global entries. Properties immediately overridden by the existing
clone's disabled animation/transition/pointer policy are omitted.

Resolved longhands already freeze custom variables' used values. Unused
custom variables are omitted, avoiding duplicate normal native-icon payloads.
Class rules and real pseudos survive clone ID removal: only variables referenced
by matching pseudo or !important declarations are retained at their computed
values. This preserves local pseudo/important paint and missing-variable
fallbacks without serializing the whole inherited schema. Source classes, tags, attributes, generated spans, geometry,
canvas copies and dynamic artwork/seek/play refreshes keep their existing
owners and behavior. IDs are still removed and clones remain inert and hidden
from accessibility.

The plan and appearance cache live only for one clone group/scene. Every new
scene rereads CSSOM declarations and source inline values; no persistent cache
needs speculative theme, class, artwork, inline, resize or stylesheet-edit
invalidation. An unreadable stylesheet or absent stylesheet API retains the previous
exhaustive snapshot path. A readable selector rejected by Element.matches
contributes its authored properties/references globally for that scene, rather
than disabling compact capture for every source.

## Checks and remaining evidence

- All 390 non-browser Poweramp checks passed locally, including compact
  vocabulary, shorthand expansion, inline/CSSOM changes, live pseudo/important
  local variables, missing-variable fallbacks and exhaustive fallback
- The existing actual-runtime checks still cover accepted geometry, suppression,
  native pseudo reconstruction, inertness, pointer ownership, transparent
  canvases, artwork/seek updates, cleanup and unchanged settle durations
- A new mandatory Chrome suite compares every standard computed property of
  actual compact clones with the exhaustive baseline across the real full/mini
  surfaces, art, labels, buttons, seeks and backdrop in dark/light themes
- That renderer suite also checks actual native masks, generated spans and live clone pseudos,
  checks local class-pseudo/important mask and color variables, discovers new
  CSSOM/inline properties, and records property-read and CSS-text
  reductions in snapshot-parity-dark/light JSON artifacts
- Existing downloaded-preview trusted first/repeated tap, held drag and regrab
  profiling measures the end-to-end setup result at 60 and 5,000 tracks

Local Chromium was not relaunched after the verified environment EPERM blocker.
The new renderer checks and after timings must run in the release owner's
browser CI before any speedup or visual-parity claim. Screenshot review and
phone acceptance are still required. No merge or production deploy is implied.


## V6 activation failure follow-up

The first real candidate renderer run found identical compact/exhaustive read
counts (57,147) and CSS bytes (1,268,103 dark; 1,275,009 light). The local
unused-variable gate also failed. Those numbers establish that the compact
path silently fell back; equal pixels from that run are not compact visual
acceptance and its 342–700 ms 60-track setup timings are not a speedup.

The traversal used JavaScript iterators for stylesheet and CSSRule lists, while
the API contract only requires indexed array-like CSSOM access. A realistic
non-iterable nested-list regression fails against that candidate and passes
with indexed traversal. A single readable selector rejected by matches also
previously propagated a null key plan through every descendant. Such a selector
now contributes only its authored property/reference names conservatively.
Unreadable sheet access continues to select the exhaustive fallback.

The mandatory real renderer report records optional fixture-provided failure
reasons, CSSOM collection kinds/iterator availability and rejected selectors.
It additionally requires an active compact plan and no source-node fallback;
the original property-read/CSS-byte reduction gates remain unchanged. The next
Chrome run must confirm the exact native failure trigger, property/pseudo
parity, screenshots and actual setup improvement. There is no production
logging, telemetry or new debug export.


## Active compact computed-property repair

The first active compact renderer run exposed 1,419 differences per theme. Most
were the exhaustive snapshot's browser-context freeze contract: `visibility`
changed under the fixture's hidden host, `interactivity` changed under HTML
inertness, app-region serialization differed, and default origins recomputed
against rounded frozen sizes. The remaining groups included resolved color
consumers, partially authored background axes, and pending-substitution
mask/background shorthand variables.

Compact capture now retains scene-context values and the computed inventory's
resolved origin/color families, alongside the entire authored property vocabulary.
It discovers live pseudo/important variable references from CSSOM cssText: pending
substitution shorthand longhands enumerate with empty specified values, even though
the authored shorthand still contains the variable. Unrelated custom-variable
schemas remain omitted. Duplicate exactly equal normalized selector strings are
merged scene-locally, and only matching rules have their authored keys expanded.
There is no persistent cache, hand-maintained authored paint whitelist, or change
to animation timing, pointer ownership, geometry, or canvas/art refresh.

Focused regressions model empty partial-axis serialization, pending-substitution
shorthands, scene-context/origin/color preservation, computed inventory order, exact
selector grouping, and lazy unmatched expansion. The mandatory renderer additionally
checks fresh CSSOM background/mask axis changes. Its exact parity report is stored
as snapshot-parity-report-{theme}.json so generic failure diagnostics cannot replace
it. All original computed, reduction, geometry and pixel gates remain unchanged.

On this repair, local Chromium launch was rechecked both normally and with permitted
escalated execution. Both aborted before renderer startup with socket() EPERM in
process_singleton_posix.cc. The local focused and aggregate non-browser results
are reported separately; the release owner's browser CI must establish real
computed/pseudo parity, screenshot acceptance and paired end-to-end speedup.


## Canonical CSSOM dependency indexing

The seeded `initial`/`inherit` probe established aggregate/alias correctness but
read the entire declared inventory for every distinct used authored name. A
75-property mechanical fixture measured 34,943 specified-value reads. The
scene-local canonical-slot index instead enumerates each computed inventory
entry's declaration once, recording every aggregate that uses each canonical
longhand slot. Expanding an authored name unions those indexed dependents.
This includes text-decoration-color -> text-decoration and partial background
axes -> background-position; a singleton specified-declaration shortcut would
miss the former and was rejected. Shorthand reset-only slots are discovered
through CSSOM, and an explicitly authored all conservatively includes the
standard inventory. No persistent metadata is retained.

The same mechanical fixture now makes zero specified-value getter reads and
503 probe writes, with the same key set. This is an algorithm/count result,
not a native timing claim. The real renderer suite requires the canonical
index's key set to contain every key discovered by seeded probing for every
page stylesheet/selected inline name and explicit aggregate, vendor, border-image,
font and all edge cases. Exact computed/pseudo, reduction and pixel/geometry
gates remain unchanged. Native equivalence and actual paired setup timing
remain pending browser CI.
