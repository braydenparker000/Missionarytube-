# Risk decisions

Choose checks by consequence and consumers, not diff size. Repository-required gates remain required.

- Documentation only: validate relative links, supported claims, exact diff and executable examples when present. Documentation that controls a release needs release-target verification too.
- Isolated UI: parse/build, changed-screen interaction and responsive checks. Broaden for shared styles, keyboard/focus behavior or shell changes.
- Component behavior: reproduce the defect, add a causal regression, run component tests and affected integrations. Include cancellation, repetition and error states where relevant.
- Shared backend or module: map callers; exercise real boundaries, compatibility and isolation. Authentication changes need negative identity, replay, stale-session and cross-owner cases.
- Storage/migration: establish invariants, backup/recovery, interruption safety and idempotency before broad conversion.
- Release machinery: validate manifests, exact pins, target, partial-write handling and rollback through the existing publisher. A build hash proves identity, not runtime behavior.

## Fast feedback

Start with the cheapest check that can disprove the change. Run focused checks while editing, affected suites at a coherent patch, required CI on the exact candidate and real-target verification after an authorized release. Reuse evidence only when its source, dependencies, configuration and environment assumptions still apply.

## Failure decisions

Capture command, revision, environment, exit code and useful error. Classify a failure as introduced regression, existing defect, harness defect, environment failure, flake or invalid comparison. Compare a focused baseline when needed. Change one causal factor and rerun the failing case before broadening. A green retry alone does not explain a failure. Do not weaken assertions or hide skipped work to claim success.

## Duplicate-code retirement

Inventory every consumer, build path and protected behavior before deletion. Port representative tests first. Keep source-only unit contracts with the authoritative source and artifact/integration contracts against the shipped output. Map every retired assertion to replacement coverage, an explicitly changed requirement or a documented non-comparable internal detail. Verify unchanged build outputs when behavior preservation is the goal. Retire copies incrementally with a reversible commit and no silent fallback to obsolete sources.

## Review and completion

Review the complete bounded diff once, then verify corrections and their affected dependencies. New material risk can reopen review; unrelated enhancements go into separate work. Keep implemented, reviewed, merged, deployed and live-verified states separate. Never call TODOs, unrun checks, byte identity or an accepted callback proof of successful runtime execution.
