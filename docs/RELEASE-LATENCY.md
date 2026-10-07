# Read-only Jarvis release latency evidence

This isolated deliverable adds no dependencies, credentials, permissions, workflow changes, remote refs, or production actions. The two code integration files are `scripts/jarvis-release-latency.mjs` and `tests/jarvis-release-latency.test.mjs`. Tests construct fully synthetic metadata in memory using repetitive fake SHAs; no captured real API fixture is required or published. Existing repository privacy guards remain unchanged.

## Run

Requires Node 20 or newer, including built-in `fetch`, `Response`, and `AbortSignal.timeout`.

```sh
node --test tests/jarvis-release-latency.test.mjs
node scripts/jarvis-release-latency.mjs --help

# Existing successful, same-application production baseline. Read-only GETs.
node scripts/jarvis-release-latency.mjs \
  --run-id 37570584777 --attempt 1 \
  --sha 970133a99b5c5f48152b0263ae35ae55df3d4707 --event push
```

For a candidate, supply its exact orchestration SHA, run ID, attempt, and observed event. Add `--baseline-run-id`, `--baseline-attempt`, `--baseline-sha`, and `--baseline-event` to compare only like-named endpoints from the exact baseline run. Every qualifying run must be completed with conclusion `success`, and must have successful exact homepage promotion, final root/static verification, and final live mobile verification steps. Failed, cancelled, in-progress, unverified, stale, malformed, or truncated evidence cannot produce a successful reduction claim.

For publication-to-live timing, additionally supply all three flags:

```text
--publication-before 2026-10-07T06:00:00.000Z
--publication-after 2026-10-07T06:00:02.000Z
--publication-operation actual-connector-operation-reference
```

These are UTC timestamps observed immediately before and after the actual connector operation publishing this candidate, with a verifiable operation reference. They are not Git commit author/committer timestamps, guessed push times, approval times, qualification start times, or fictional example values. The real publication is bounded by the two observations. The lower duration uses the later publication bound; the upper duration uses the earlier bound. Candidate-to-final-mobile includes elapsed review, queue, scheduling and all qualification/deployment work between publication and live verification, including earlier failed attempts if the actual publication predates a rerun. Equivalent baseline publication bounds use the same three flags prefixed with `--baseline-`. Missing bounds remain clearly unavailable. Bounds and their operation linkage are caller-supplied evidence; this read-only collector does not independently authenticate publication. Review the operation and source-candidate versus orchestration-candidate scope externally before treating that interval as a whole change-to-live observation.

## Timing interpretation

- `run_created_*` starts at GitHub's original `created_at`; `attempt_start_*` starts at this exact attempt's `run_started_at`. Reruns explicitly distinguish these origins
- Qualification includes each exact-attempt job's created/start/end timestamps, steps and runner duration, plus wall time. Parallel runner durations are not substituted for elapsed wall time
- Production includes all steps, its created-to-start interval when exposed, and qualification-completion-to-deploy-start elapsed time. That gap includes dependency scheduling/queue time. GitHub does not expose separate exact concurrency, review, or runner waiting intervals here
- Milestone completion uses the exact matching successful step's `completed_at`, not the start or a similarly named stale step
- GitHub's public workflow-run response has no exact `completed_at`. Terminal completion is reported conservatively between the final completed job and completed-run `updated_at`; the update timestamp is not mislabeled as exact completion. Stale update timestamps are rejected
- Reduction passes the 75% target only when the candidate upper duration is at most one quarter of the baseline lower duration for the same endpoint. Terminal uncertainty is retained. Numbers are not rounded up to turn 74.9999% into a success
- Separate ten-minute assessments cover candidate-to-mobile and candidate-to-terminal completion. Each passes only when its successfully verified upper bound is at most 600 seconds, fails when its lower bound exceeds 600, and is inconclusive when the interval crosses 600. Mobile success does not imply terminal completion met the target
- Timing comparison does not itself prove equivalent application source, configuration, runtimes, required tests, or cold-versus-reuse lanes. Review those release identities separately before making a same-application optimization claim

## Fetch and failure boundaries

Only the allowlisted public repository `braydenparker000/Missionarytube-`, deploy workflow, explicit `push` or `workflow_dispatch` event, and `main` branch are accepted. Both run and job identities are checked. The collector uses the exact `/runs/{run}/attempts/{attempt}` and `/attempts/{attempt}/jobs` endpoints, never the latest-attempt wrapper. Conflicting per-job attempt metadata is rejected. If the API omits that job field, the exact endpoint plus an attempt-start temporal window bind the job; older job timestamps are rejected.

Each run costs at most five GETs: initial exact-attempt metadata, up to three 100-job pages, and a metadata recheck. Each response is bounded to 2 MiB with a 10-second request timeout. Comparisons cost at most ten GETs. Redirects and credentials are disabled; no environment tokens or saved GitHub login are read. Rate limits, non-public resources, network errors and missing/malformed data produce `unavailable`, without authentication fallback. There is no watch loop, workflow dispatch, rerun, merge, permission change, or promotion capability.

Exit status: 0 for valid verified successful timing evidence, 1 for a failed exact run, and 2 for pending/unavailable evidence. Exit 0 is not a performance target claim; inspect `comparison.metrics.<endpoint>.meets75PercentReduction` and both `routineCandidateToLive.state` and `routineCandidateToTerminal.state` independently.

## Verified baseline and test scope

The synthetic regression constructs exact-attempt metadata in memory with a repetitive fake SHA and fake run/job identifiers. It preserves the 502-second homepage promotion, 518-second final live mobile verification, and 524–525-second terminal boundary assertions. These are test inputs, not captured external metadata. Real read-only API evidence was checked separately and remains local only; do not publish captured snapshots or reports from the local `evidence/` directory. Actual baseline publication operation bounds remain unknown and unavailable.

Focused tests cover exact identities, stale/wrong attempts and job metadata, duplicate/truncated pagination, failed/in-progress runs, skipped/missing/misordered live milestones, impossible timestamps, metadata recheck races, synthetic baseline boundaries, conservative target evaluation, and bounded unauthenticated fetch behavior. Repository-wide `npm test` and frontend build are not substitutes for these tests, and have not been rerun in the original source or deployment checkout by this collector task.

GitHub REST endpoint families: workflow run attempts and jobs for an exact workflow run attempt.
