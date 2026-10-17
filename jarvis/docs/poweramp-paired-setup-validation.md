# Same-candidate compact snapshot acceptance

October 5, 2026. QA-only continuation of the active compact candidate. These
checks retain the existing source-property, geometry, raster, trusted-input,
cleanup and downloaded-preview edge gates. They do not establish Galaxy A15
performance, and they do not authorize publication or deployment.

## Active-candidate evidence actually rechecked

CI run 37252137215 produced ten 519 × 988/DPR 2.0818214416503906
exhaustive/compact held/regrab/late-art screenshot pairs. Both dark regrab PNGs
were directly inspected, and all ten native PNG pairs were independently decoded
and compared using the existing region definitions and threshold 2/255.

- Actual scene CSS shrank from approximately 1.029–1.035 million characters to
  157 thousand, about 85% less. This is active compact evidence
- All ten pairs satisfy the unchanged viewport and regional pixel gates. The
  largest changed-pixel fraction was 0.0000621186, largest regional fraction
  0.0000809359, and largest mean channel delta 0.00190464
- The only recorded held-scene appearance mismatch was dark regrab shell radius
  `3.48901px` versus `3.48902px`. The baseline inferred progress was
  0.5000000686583822 versus compact 0.5, caused by reconstructing displacement
  from float-rounded transformed bounds
- The regrab fixture now derives its displacement from production-written full
  clone opacity and independently checks that this agrees with held geometry.
  It still uses real CDP contacts; exact appearance equality and every existing
  geometry/pixel limit are unchanged. This input correction is authored but
  still requires Chrome verification
- The separate exhaustive computed-property gate failed in that CI run.
  Passing regional pixels does not replace that gate, and this QA change does
  not exclude any computed property or weaken it

The concurrent aggregate browser run recorded 5,000-track setup create times
of 332, 532.4, 569.5 and 255.3 ms for first/repeated/held/regrab. The earlier V5
run recorded 514.1, 442.3, 323.9 and 212.5 ms. These are different runs with
competing browser processes, not a trustworthy before/after performance result.
Clone cost still dominates the inclusive creation report; exact subphase cost
and isolated improvement must be measured below.

## Isolated same-run setup measurement

Run this mandatory test in its own CI step, after the aggregate test process
exits and before uploading the existing browser evidence directory:

```sh
POWERAMP_EVIDENCE_DIR=/path/to/evidence \
  node --test tests/poweramp-preview-setup-browser.mjs
```

The `.mjs` filename deliberately stays outside `tests/*.test.js`. Missing or
broken Chromium is a failure, never a skip. The complete test has a 180-second
budget. The existing downloaded-preview motion suite stays in the aggregate.

The test builds exactly one self-contained silent preview and uses serial
fresh-context exhaustive/compact groups for 60 and 5,000 tracks. The second
library size reverses group order. Each group measures the first mini expansion,
two warm repeats, held expansion and a genuine transient-plane regrab held past
the original settling duration. "First" means first measured mini expansion in
that fresh context: real navigation to the library has already exercised a
collapse scene. It is not a claim of unexecuted code or cold raster caches.

Baseline changes only introspection of an enabled real sheet's cssRules getter,
selecting the existing exhaustive path while preserving its rendered CSS. Both
modes must prove the actual snapshot-plan result. The real held/regrab scene
must have the same clone topology and retain the existing <70% compact CSS
payload gate. Playback stays paused, all motion/readback input is trusted,
track identity stays unchanged, external network is denied, and original normal
settling timings remain active.

Evidence is `preview-setup-paired-60.json` and
`preview-setup-paired-5000.json`; failed fixture diagnostics have separate
`preview-setup-failure-*` names. Completed action reports are saved before their
assertions, so failed assertions do not clobber earlier timing evidence or source
parity artifacts. Source and generated-preview hashes identify the exact code.

## Timings and overhead

Optional preview-only method wrappers now report inclusive time and self time
for snapshotPlan, snapshotKeys, snapshotCSS, copyCanvas, clone and create.
Self time excludes instrumented child calls, including recursion. It is not CPU,
GPU, display or input latency. Inclusive child totals overlap and must not be
added together. Unit tests prove nested/recursive subtraction and restoration
of every wrapper.

There is no per-property getPropertyValue wrapper, Proxy or counter in the timing
comparison. Each method wrapper uses two clocks and bounded frame/Map updates.
The single post-creation CSS/node walk is outside the synchronous creation
measurement. Both modes use identical method instrumentation; compact's
additional recursive key-discovery calls incur additional wrapper overhead,
which conservatively penalizes compact. Exact renderer overhead remains
unmeasured until the required Chrome run.

The new improvement gate compares only inclusive create durations. Its
three-tap median and two-warm-tap median must each be at most 80% of the same-run
exhaustive baseline. First and held/regrab timings, all subphase totals/self
counts, and RAF callback gaps remain available even if that gate fails. A smaller
CSS payload by itself cannot satisfy the timing gate. This is a new explicit
material-improvement target, not a revision of an old acceptance threshold.

## Local checks and remaining acceptance

- All 1,075 non-browser tests passed after rebasing the QA worktree onto
  integration d95128e, including the nested navigation repairs; the separate
  production snapshot-property repair is still pending
- 27 focused preview instrumentation, summary and builder checks passed
- New and changed JavaScript syntax checks and git diff --check passed
- An actual normal Playwright launch of `/usr/bin/chromium` was retried and failed
  at process_singleton socket() with EPERM. No alternate flags or route was used
  to bypass it. New renderer checks are authored, not locally passed

Release acceptance still requires the exact final source's complete browser
suite, exhaustive standard-property/live-pseudo parity, all ten unchanged
owner-viewport raster pairs, the isolated same-run timing gate, direct screenshot
review and physical phone acceptance. The owner's V4 callback-gap reports
contained isolated stalls above 500 ms; their aggregate percentiles alone do not
locate the stall or establish phone display FPS. A phone follow-up should compare
first/warm setup, held drag and settling with the same artwork/settings and
preserve visible appearance, geometry, audio/queue behavior and settling timing.
