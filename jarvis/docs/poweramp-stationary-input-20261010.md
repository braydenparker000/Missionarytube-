# Poweramp fixture: release setup drags at rest

The persistent-owner gate occasionally delivered a complete, uncancelled Library
touch with no compatibility click. The failed and nearest passing hosted
artifacts used the same preview source
`715fe2e947e43810c0b224156daa069d741382b6a41fab921e6ea16ae4724fe3`.
Their artifact archive SHA-256 values were verified:

- Failure 11679981572: `6941b66c87424834f00e3614ef5a1990bfb004028b395fdeae477a3714d4fa88`.
- Pass 11680051063: `5220bdbc4e275f25b059dc4f5fc8919d7b45622c437f6e1aa537b5fd01cdc7b1`.

The failing contact had no prevented/cancelled events, no active scene, no input
plane and a visible enabled navigation target. The passing artifact retained
only later contacts. Those DOM traces alone could not identify why Chrome did
not produce the click.

## Causal reproduction

An instrumented repetition of the same production preview and setup sequence,
under official Chrome 154.0.8037.97 / 4x CPU, reproduced that signature on the
sixth sequence. The retained Chrome input trace records:

1. The one-move 169px collapse contact produces `GestureFlingStart` at roughly
   16,101 px/s.
2. `TouchActionFilter` discards fling scroll updates because the scene has
   `touch-action: none`, but the browser fling controller remains active.
3. Library's next touch sends `GestureFlingCancel`, stopping that hidden fling.
4. Chrome records `FilterTapSuppression` / `FilteredForFling` for TapDown,
   ShowPress and Tap. No click reaches the page, although native touch events do.

The original instrumented full gate also passed once with zero flings or tap
suppression. The before repetition produced five passes then one failure, one
fling and three suppressed gesture events. This demonstrates a timing-dependent
emulated-input mechanism; the original hosted artifact did not record Chrome
internals, so attribution of that occurrence remains an inference from the
matching reproduction. It is not evidence of an Android hardware defect.

Chrome's [fling controller](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.97/components/input/fling_controller.cc)
filters taps that stop an active fling. Its
[velocity tracker](https://raw.githubusercontent.com/chromium/chromium/154.0.8037.97/ui/events/velocity_tracker/velocity_tracker.cc)
clears stale motion when UP follows at least 80ms without movement.

## Minimal fixture change and retained gates

The setup collapse is now a drag released at rest: hold the same contact at its
169px endpoint for 100ms before UP. Native pointer timestamps must prove at least
80ms since its last movement. There is no extra tap, retry, forced navigation,
post-release settle delay, or application gesture-handler change.

This modifies only setup-drag release velocity. Contact distance, real pointer
input, first/repeat/playing startup measurements, 33ms create budget, live
visibility, exact canonical geometry/pixels, held ownership and rapid regrab
cases remain gated. The hold occurs after the measured scene creation, and the
rapid release/regrab sequence is unchanged. Production source and UI are intact.

Twenty consecutive diagnostic sequences with this one change passed: zero
flings and zero tap suppressions across 160 browser GestureTap events. The full
persistent-owner gate passed both themes, with maximum measured candidate setup
13.9ms against the unchanged 33ms limit. List endpoints matched; both reference
versus live player endpoints retained their existing 1,080 bottom-row pixel
difference within the unchanged 0.0005 fraction limit. The other serial
performance gates also passed: render trace (all eight planned cases) and
cold/repeat/playing setup (four tests). No thresholds or baseline pins changed.

## Reproduction and evidence

Use pinned Node 22.23.3 and `JARVIS_CHROME` pointing to official Chrome
154.0.8037.97. The diagnostic is offline and does not run automatically in CI:

```sh
node scripts/diagnose-poweramp-fixture-input.mjs
node scripts/diagnose-poweramp-fixture-input.mjs --stationary
POWERAMP_BASELINE_REF=8aa7fce4dd83d5417614ae112134631dd98df7b6 \
  node --test tests/poweramp-persistent-prototype-browser.mjs
```

The diagnostic stops on its first failure or after 20 sequences. Set
`POWERAMP_INPUT_ITERATIONS` (1–50) and `POWERAMP_EVIDENCE_DIR` if needed. It records
raw Chrome input traces and complete native contact histories; it does not
retry a failed navigation. The fast case is timing dependent, so a successful
run does not disprove the retained failure.

Compressed raw before/after traces, native histories, trace excerpts, counts and
full gate TAP are in `docs/evidence/poweramp-stationary-input-20261010/`. The
published diagnostic command was also exercised once in stationary mode and
produced the expected source hash, one pass, zero flings and zero suppressions.

This is a fixture-only candidate for independent review. It neither changes
production gestures nor establishes physical-device acceptance.
