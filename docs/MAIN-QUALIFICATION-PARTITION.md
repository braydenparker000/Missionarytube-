# Verified main qualification delegation

Local review base: `1c339398d04435c14ca31089d6e32545268125ec`

Pinned Jarvis source: `89d3e356041183877a1d4974158ba49f96560d35`

The warm #109 regressions, source pin and reviewed source-helper allowlist are
preserved. This follow-up changes only local candidate files. Publication,
merge, dispatch and production changes remain with the owner.

## Qualification boundary

Validate keeps its existing unfiltered PR and main-push triggers. It skips its
duplicate reusable qualification only after BOTH local immutable routing
checks and independent completed-success qualification proof pass.

A scheduled, queued or running producer alone cannot make Validate green.
When proof is absent, ambiguous, incomplete, failed, stale or inconclusive,
Validate runs its original complete qualification. No test, performance
threshold, provider permission or Deploy trigger is removed or broadened.

Deploy and reusable qualification workflow bytes remain unchanged. Production
still depends only on its own qualification and never on Validate or this
proof helper. The checker waits for an existing producer; it creates no run
and downloads no artifact.

## Local prerequisite and exact path rule

The local prerequisite remains conservative: an ordinary non-created,
non-deleted, non-forced push to this repository's main branch; exact checkout
and event SHAs; ancestor history; a nonempty exact NUL-delimited two-dot diff
with at most 300 changed paths and 1,000 commits; unchanged reviewed complete
Deploy/reusable workflow fingerprints; and no execution-recipe changes.

The unchanged Deploy filter is exactly:

- `jarvis-release.json`
- `scripts/*jarvis*.mjs`
- `scripts/r2-player-config.mjs`
- `tests/**`
- `*.html`
- `assets/**`
- `src/**`
- `scripts/build.mjs`
- `package.json`
- `package-lock.json`
- `.github/workflows/deploy-azure-storage.yml`

Eligible path shapes are release pins, root HTML, assets/src, ordinary top-level
`tests/*.test.mjs` regressions and the one reviewed non-gating read-only
`scripts/jarvis-release-latency.mjs` collector. Deploy runs the identical full
`npm test`, including those regressions. Workflows, other scripts, dependency
changes, test harness/browser/nested/unknown shapes and mixed documentation
retain full Validate. Deletions and both rename endpoints are checked; invalid
UTF-8, control characters, unsupported YAML/filter syntax, empty/net-zero diffs,
missing history and large/inconclusive pushes also retain full Validate.

## Bounded independent completed proof

Only after the local prerequisite passes does the checker read public GitHub
metadata, without authentication or added permissions:

1. The expected Deploy workflow must be active, with exact reviewed path/name
   and current numeric workflow ID
2. Exactly one producer must match that workflow ID, allowlisted public
   non-fork repository and head repository, push event, main branch, exact
   orchestration SHA, canonical run URLs and a positive attempt number
3. One complete attempt-specific job page must prove unique successful
   completion of plan, build, final qualification and all eight components:
   relay, frontend, poweramp, blankLibrary, podcasts, migration, performance
   and owner24
4. A final run read must preserve run ID, attempt, head, workflow, repository,
   creation/start identity and sane current state. Its update time must cover
   the completed qualification timestamp

Every job has the exact run/attempt/head/main/workflow identity. Duplicate
IDs, names or components, wrong/unknown matrix names, skipped/failed/cancelled
qualification jobs, missing or partial pages, pagination and rerun races fail
closed. The reviewed public matrix format is matched by its strict namespace,
component, full 64-hex digest and pinned runtime suffix, including GitHub's
116-character truncation. Arbitrary substring matching is not used.

All successful job timestamps must be finite and ordered within the selected
attempt. Plan precedes build/components, and final qualification cannot start
before all those jobs complete. Inherited timestamps from a targeted rerun
cannot masquerade as fresh same-attempt proof. Producer creation must be within
five minutes; future, malformed and stale metadata is rejected.

The fixed total proof budget is 90 seconds, with at most 12 GETs, 3 seconds per
request, 8-second polling intervals, 128 KiB per response and 1 MiB total.
Redirects, HTTP/network errors, disabled/missing workflows, exhausted rate
limits, malformed/oversized bodies and budget exhaustion choose full Validate.
There is no credential fallback or permission expansion. PR/nonpush events
and local-ineligible cases perform no HTTP.

The gate-owner job has a three-minute timeout. Both `deploy_only=true` and
`qualification_verified=true` are required before skipping the duplicate call;
a missing field, failed job or unexpected helper error retains the full-call
condition. Unexpected job failures remain visible. Worst case is checkout/setup
plus up to 90 seconds followed by original full Validate qualification. Deploy
execution does not wait for this job.

## Why native paths-ignore was rejected

GitHub's official documentation source describes
[path exclusion](https://raw.githubusercontent.com/github/docs/main/data/reusables/actions/workflows/triggering-a-workflow-paths3.md)
and [changed-file comparisons and limits](https://raw.githubusercontent.com/github/docs/main/data/reusables/actions/workflows/triggering-a-workflow-paths5.md).
`paths` triggers on any matching changed path; `paths-ignore` suppresses when
all changed paths match. Branch and path filters both apply. Existing-branch
pushes use two-dot diffs, PRs use three-dot diffs, and an empty changed-file set
runs neither path-filtered workflow. More than 1,000 commits or diff timeout
runs the filtered workflow. Current public documentation uses a 3,000-file
limit, with an older 300-file version in its source.

Mirrored native CI ignore filters would lose existing empty/net-zero push
qualification. The always-triggered local prerequisite avoids that gap; the
completed independent proof is an additional requirement before delegation.
Every previously qualifying main push therefore retains its complete
qualification owner, with overlap/fallback allowed and Deploy paths unchanged.

## Status and owner review

A successful Validate run now requires either its own full qualification or
verified completed qualification in the exact independent producer attempt.
It never succeeds merely because a producer is scheduled. The CLI summary
names the verified run and attempt and explicitly limits the claim to
qualification. Overall Deploy may remain in progress afterward; homepage,
mobile live checks, production receipt and terminal deployment success remain
independent and are not claimed by this proof.

Existing caller `static-checks` and reusable aggregate `qualification` IDs are
preserved. Full PR qualification retains its existing nested contexts. A
verified-delegation main run may expose `gate-owner` plus a skipped caller
`static-checks`, without all nested Validate contexts. The independent Deploy
aggregate remains `qualification / qualification`; actual configured required
check names must be checked by the owner. The
[official protected-branch documentation source](https://github.com/github/docs/blob/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md)
notes that skipped checks may satisfy requirements. Detailed repository policy
was unavailable to the owner's read-only review (403), so this patch does not
claim to certify branch protection, change settings or bypass access limits.
PR qualification stays unconditional; manual Deploy remains unconditional.
Existing merge-group trigger support is unchanged.

## Verification and delivery

The completed-proof review bundle contains full changed files, the exact patch
against current main, immutable base checks, focused/full test and build/lint
logs. Tests use deterministic synthetic public-metadata fixtures and never live
HTTP. Existing privacy-host allowlists and performance assertions are unchanged.
The baseline harness injects an `UNDICI-EHPA` warning into an existing CLI
stderr assertion, so full runs use `NODE_NO_WARNINGS=1` without changing that
assertion. No hosted execution or measured latency improvement is claimed by
these local checks.
