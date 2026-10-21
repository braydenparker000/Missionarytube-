# Poweramp 1031 native reference — Session 1

Start with [status and significant findings](00-SESSION1-STATUS.md), then [implementation readiness](10-IMPLEMENTATION-READINESS.md). This is evidence-building research of the exact user-supplied original APK. It contains no player implementation and no authentic runtime captures.

| Artifact | Contents |
|---|---|
| [00 — Status](00-SESSION1-STATUS.md) | Findings, evidence counts, acceptance assessment and limits |
| [01 — APK and tooling](01-APK-AND-TOOLING.md) | Identity/signature, tool provenance, failures and extraction commands |
| [02 — Resolved UI atlas](02-RESOLVED-PLAYER-UI.md) | Actual component tree, artwork equations, control/label anchors, insets and metadata binding |
| [03 — Styles and qualifiers](03-STYLE-THEME-AND-QUALIFIERS.md) | Theme/option precedence, active defaults, worked qualifier selection and variants |
| [04 — Scene engine](04-SCENE-ANIMATION-ENGINE.md) | State graph, canonical tap/drag routes, shared-item matching, clocks, easing and interruption |
| [05 — Gestures](05-GESTURE-STATE-MACHINES.md) | Event/state tables, target ownership, seek modes, cancellation and long press |
| [06 — Rendering](06-DRAWING-AND-WAVEFORM.md) | Canvas, artwork crop, native backdrop, waveform, fonts and icon ownership |
| [07 — Runtime](07-RUNTIME-OBSERVATIONS.md) | Concrete unavailable-runtime evidence; no substituted screenshots |
| [08 — Evidence ledger](08-EVIDENCE-LEDGER.jsonl) | 151 sourced and condition-labeled records |
| [09 — Gaps and captures](09-GAPS-AND-CAPTURE-REQUEST.md) | Owner inputs, bounded source questions and minimal original-app capture request |
| [10 — Readiness](10-IMPLEMENTATION-READINESS.md) | What can guide implementation and what still blocks a fidelity claim |
| [11 — Continuation](11-CONTINUATION-CHECKPOINT.md) | Repository boundary, scratch/tool locations and exact next trace targets |
| [12 — APK inventory](12-APK-RESOURCE-INVENTORY.json) | Package/configuration inventory, hashes and identifiers, without payloads |
| [13 — Citation index](13-SOURCE-CITATION-INDEX.json) | Hashes and locators binding evidence to this extraction |
| [Dimension variants](UI-DIMENSION-VARIANTS.json) | 167 source-checked dimension declarations; not all simultaneously active |
| [Validation results](verification/validation-result.json) | Schema, citation/hash, link and artifact-content checks |

Paths beginning `decoded/` and `jadx/` refer to a private reconstruction made with the tool versions/options in report01. They are deliberately not links to published proprietary source. Exact Unicode class and method identifiers distinguish otherwise similar-looking symbols. Read each ledger record's conditions and uncertainties before applying its value.

`CONFIRMED_STATIC` describes source-established conditional behavior. It does not certify current owner settings, observed screen measurements, native frame timing or browser feasibility. There are no `CONFIRMED_RUNTIME` records. The explicit `MODEL-P360` configuration is an analytical worked example.

The public research branch contains documentation and small structured metadata only. Investigation scripts and proprietary inputs stay outside Git. A local reference ZIP additionally preserves original read-only reproducer/validation scripts. No APK, fonts, artwork, screenshots, decoded source tree or raw native disassembly is included in either reference package.
