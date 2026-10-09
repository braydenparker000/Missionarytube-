# Versioned static release and recovery

This branch is a reviewable implementation. It has performed no production
writes, deployments, rollbacks, merges, credential/settings changes, schedule
changes, infrastructure provisioning or paid-service activation. Integration
and promotion belong to `cloudthread01a11c85-d6ab-7105-a1f6-d0a1c0f150ec`.

The recorded baseline is orchestration `bf12a379754225db770429d01bf730758fab9a4b`
with source `c4d62409a3b67e4e5dac88809c6a4a0290b6e39e`. Read-only provider
responses confirmed both in `release-qualified.json`, and confirmed an Azure
ETag on the existing homepage. PR126 was an open draft at
`35eb1aad6fa728424214fff26c53886770834536`, changing only the source pin to merged
source PR73, `ea9c09c1ddb172c1f0d668b58a5e7066f1c8318f`. These are observations,
not authority to publish and not assertions about a future live state.

## Publication contract

The old workflow overwrote shared resources and subpage indexes before the
homepage. A runner interruption could pair an old document with new code.
The new workflow keeps the same Azure static website, Entra/OIDC identity,
Worker, bindings and production locks. It stages each release under
`/_jarvis/releases/<64-character-release-id>/`. The ID binds the complete input
inventory, exact configured artifact/Worker checkpoint and immutable publication
recipe. Every transferred byte, MIME type, publication manifest and directory
index is checked. Existing immutable objects are never overwritten.

Canonical HTML routes use a fixed loader and `jarvis-active-release.json`.
The loader reads the pointer once, fetches a bounded same-origin document,
checks its length and SHA256, and opens it at the original canonical URL.
Resource URLs are converted to immutable absolute URLs. Existing document CSPs
remain in force; no base element, inline/eval permission or weaker CSP is added.
Canonical navigation, query strings, fragments, browser storage keys, OAuth
paths and the Poweramp/Astra interface stay intact. Decoder MIME types, relative
module imports, `import.meta.url` and `document.currentScript` resource paths
remain supported.

**Offline contract:** the existing podcast frontend, service worker and its
shared dependencies remain byte-identical at canonical paths. The worker's
existing scope and cache names stay intact. A fresh install therefore still
caches an application shell, with offline audio range handling. A change to any
file under `podcasts/`, or `assets/config.js`, `assets/shell.css` or
`assets/premium.css`, stops for a separately reviewed migration. This is an
explicit compatibility limit. Other routes use versioned resources and the
pointer. The podcast code is identical in both sides of an accepted promotion.

The first cutover stages a frozen copy of the verified full static backup and
the candidate. Before replacing any canonical HTML, it creates a pointer to the
frozen previous release. Each installed loader still serves that previous
release. After verifying all loaders and immutable files, promotion changes one
pointer using the inspected Azure ETag. Later promotions leave loaders alone.
Azure's conditional upload arguments are documented in the
[official CLI parameter definitions](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/storage/_params.py).

Each navigation is consistent with its selected document. Already-open pages
continue using their selected release. Concurrent pointer reads may select the
previous or next release; there is no claim that all browser tabs switch at
one instant. API/business data are outside the static publication boundary.

The complete original same-run `dist`, `qualified-artifact.json` and configured
seal remain the qualification inputs. Publication is a deterministic additional
transformation, bound to committed orchestration recipe bytes. A mismatch with
HEAD, source, dependencies, run/attempt, base seal, configured bytes or Worker
checkpoint stops before writes. Public configuration values are not placed in
diagnostic records. The existing authorized configuration injection is retained.
Every resumed command also revalidates the complete backup and binds the previous
publication back to that backup; a self-consistent edited plan is insufficient.

## Evidence to preserve

Before release writes, preserve the successful full static rollback artifact
and the same-run `publication-before-<sha>-<run>-<attempt>` artifact. Preserve
`publication-after-<sha>-<run>-<attempt>` after failure or success. The artifacts
contain sealed publication payloads, plans, original proof and bounded
checkpoints. Retention remains 90 days for static recovery material. The
existing Worker rollback/identity artifact and final mobile artifact remain.
The workflow saves the publication artifact before namespace uploads, and
retains its checkpoint upload on failure. Failure to archive before writes
stops the workflow.

`state.json` is a progress hint. It is not proof that a request failed to reach
Azure. Inspect actual ETags, hashes and MIME before acting. The final production
receipt additionally binds the immutable frontend release ID, publication
digest and active pointer digest, while retaining the original frontend artifact,
configuration, Worker version/settings and immutable GitHub success stamp.
Recipe changes invalidate previous Worker reuse evidence and require a fresh
qualified bootstrap under the existing rules.

Use the active pointer and digest-bound receipt to identify the selected
release. Existing root asset files and the older root `release.json` are
retained as legacy compatibility/rollback material. They are not authoritative
for the new selected frontend. `check-jarvis-static.mjs` describes the old flat
layout; the workflow now uses `publish-jarvis-versioned.mjs verify`.

## Interrupted frontend procedure

1. Keep both production locks. Preserve the original source/orchestration
   checkout, qualified/configured artifacts, full static backup, Worker
   checkpoints and publication plans. Do not rebuild and label it the original
   artifact. A rerun with a new artifact is a new release and needs its own
   qualification. Never fabricate an original successful run/attempt.
2. Run the read-only `inspect` command in the preserved checkout using the
   existing authorized Azure session and fixed `STORAGE_ACCOUNT=missionarytube`.
   This records only the observed pointer ETag and SHA256. If the pointer is
   malformed, unknown or belongs to another release, stop before mutation.
3. Review the original `.publication/context.json`, plan inventories and
   original expected pointer. Determine whether the pointer still selects the
   previous release, selects the candidate, or has an unknown outcome. Fetch
   exact provider Worker version/settings identity, recheck the source seal,
   existing origin/API contract and real podcast readiness. Do not enable logs,
   change credentials/settings or fetch private message bodies for diagnosis.
4. Obtain approval for the exact recovery action, source/artifact/backup and
   Worker checkpoint digests, target account/container, candidate/previous IDs
   and inspected expected pointer. The CLI accepts an approval JSON file using
   `--approval-file`. The file must match this shape and contain actual reviewed
   values, not these placeholders:

   ```json
   {
     "schema": 1,
     "action": "resume",
     "account": "missionarytube",
     "container": "$web",
     "releaseId": "<candidate ID from preserved context>",
     "previousReleaseId": "<previous ID from preserved context>",
     "artifactDigest": "<original configured artifact digest>",
     "backupDigest": "<verified complete static backup digest>",
     "backendIdentityDigest": "<preserved exact Worker checkpoint digest>",
     "expectedPointer": {"etag": "<reviewed ETag or null>", "sha256": "<reviewed pointer digest or null>"}
   }
   ```

5. For an interrupted namespace upload, use
   `node scripts/publish-jarvis-versioned.mjs resume --approval-file <file>`.
   Correct existing blobs are reused without overwriting them. Missing blobs
   use create-only writes. Conflicting bytes/MIME fail closed. An interrupted
   first loader installation is also reconciled against the original backup;
   it finishes while the previous release remains selected. Fresh readiness
   runs in the same filtered environment and isolated empty configuration
   directories used by the prewrite supervisor. Provider credentials are not
   passed to that readiness lane.
6. Promotion is a separate reviewed action. The normal main workflow rechecks
   configured bytes and actual backend identity immediately before promotion.
   A manual recovery promotion requires a separate `action: "promote"` approval
   file for the new inspected previous-pointer ETag. A successful pointer write
   with a lost response is reconciled from actual bytes without another write.
7. Run full `verify`, real deployed mobile discovery/playback and final
   digest-bound receipt validation before declaring release completion. The
   publication CLI's static `verified` phase alone does not prove mobile playback
   or authorize a successful-production receipt for a failed/cancelled run.

If automatic approval review denies an action, report the exact action and
target and preserve all artifacts. Parent authorization permits at most one
identical retry; it does not permit another transport or target. The adapter
itself never retries a denied write or switches authentication.

## Frontend rollback

Rollback changes the pointer to a verified previous immutable release. It does
not delete partial namespaces, restore the database, or roll back the Worker.
First run `inspect`, then obtain an exact `action: "rollback"` approval bound to
that observation. Use
`node scripts/publish-jarvis-versioned.mjs rollback --approval-file <file>` only
after proving the previous frontend/current Worker/schema/pending-work pair.
All previous bytes, MIME, routes, frozen contracts, actual Worker identity and
readiness are rechecked. A raced pointer fails its provider precondition.

The CLI deliberately rejects a local file that merely asserts compatibility.
`.publication/rollback-compatibility.json` must name an exact completed successful
main deployment run/attempt at the original orchestration head and contain a
digest-bound pair record with the unchanged reviewed recipe. Immutable tree and
job metadata must include exactly one successful
`verified-recovery-pair-<pair-digest>` stamp for that pair. The record binds
`previousReleaseId`, `backendIdentityDigest`, `schemaBackwardCompatible`,
`pendingWorkCompatible` and `exactPairQualified`. All three checks must pass.
The integration owner must produce and review this proof after testing the
exact old frontend/current Worker pair. **This branch does not claim a live
rollback pair has been qualified and does not manufacture that stamp. Until
such proof exists, production frontend rollback is a no-go.** Local pointer
rollback fixtures establish the storage operation and failure behavior only.
The hosted proof producer is an integration prerequisite: this branch does not
add one. Core must add its reviewed producer/stamp to the integrated workflow
before that immutable orchestration head is qualified. It cannot be retrofitted
onto an already completed run or replaced with an operator assertion.

After rollback, verify canonical routes, the actual selected pointer, origin
readiness and mobile behavior. Do not claim that an earlier candidate receipt
describes the selected frontend. Keep the pending-work and incident evidence.

## Worker, schema and pending work

Worker rollback needs a separate approval for an exact previous provider version
and the current preserved bindings/settings. Use the archived before/after
version inventories and exact live provider identity; version-list order alone
does not prove the active version. Recheck one 100-percent active version after
the approved action. A frontend backup is not a Worker version checkpoint.
This branch performs no provider Worker rollback and changes no binding,
SQLite class, migration tag, namespace, secret, setting or credential.

The source contract fixtures copy literal schema definitions from the exact
live and PR73 commits. Native SQLite tests run every candidate DDL interruption,
reopen, complete the schema, rerun it and exercise old read shapes. They preserve
queued/running/waiting/completed rows, running lease fields, immutable replies,
failed/pending outbox rows and accepted delivery receipts. They do not establish
production table sizes, index-build CPU/memory headroom, Cloudflare migration
behavior or compatibility of every older Worker. New additive data may be
unrecognized by old code even if old SQL still executes. No destructive
down-migration is authorized.

Before either a Worker downgrade or database restoration, prove current pending
work semantics using bounded counts/stages and the exact runtime fixtures.
Preserve accepted replies and delivery receipts. An expired/stale run or grant
is not reusable authority. A callback acceptance is not proof of finished work.
Do not clear outbox rows, reset import cursors, force attempts to zero, reclaim
private jobs, replay delivered events, send messages or re-create consequential
work as a generic recovery step. Any necessary job retry, claim, private action,
schedule/subscription change or replay needs its own applicable authorization.

**Database backup/restore is distinct from static blob backup.** The application
uses the existing SQLite-backed Durable Object. No database export or provider
restore procedure is proven by `$web` inventory/downloads or Worker version
lists. The local SQLite backup/restore fixture demonstrates restoration and its
loss window with synthetic data; `providerRestoreVerified` remains false.
Provider restoration remains a no-go until an authorized provider procedure,
exact snapshot/point, integrity, loss window and pending-work reconciliation
have separate evidence and separate per-action approval. Preserve forward
compatible data and prefer a qualified repair when a downgrade is unproven.

## Bounded readiness and diagnostics

`release-recovery-plan.mjs` projects a fixed set of phases/check names and
pass/fail/unknown/not-applicable statuses. It accepts only bounded counters,
release/artifact/backup/backend/settings/pointer digests and provider version
UUIDs. It discards arbitrary exception text, URLs, settings objects, credentials,
payloads, titles and bodies. Provider errors become fixed local messages.
This is artifact evidence design; it adds no provider logging, telemetry service,
observability setting, private inbox read, credential or data collection.

Unknown readiness is a hold, not a healthy result. Existing provider and
qualified-artifact proofs remain mandatory. Successful local fixtures establish
failure behavior; they are not live database/cost/latency measurements.

## Go/no-go and integration

Go for local review once repository `npm test`, `npm run build`, fixture/browser
checks and the privacy/diff inspection pass. Go for hosted qualification only
on the exact integrated head. PR126's prior qualification does not transfer to
this workflow/recipe change. The rollout keeps full Validate; later dedup still
requires an exact completed producer, unchanged reviewed recipe and full coverage.

Production is a no-go until the integration owner reviews this branch, rebases
or cherry-picks it onto the intended source pin, obtains exact-head hosted
qualification, verifies live migration/headroom and pending-work prerequisites,
reviews the full existing blob inventory and first-cutover policy/route/offline
compatibility, preserves complete rollback/Worker/publication artifacts, and
integrates the reviewed hosted rollback-pair proof producer and obtains the
applicable publication/promotion approval. Unexpected legacy HTML,
unsupported payloads, a changed loader/CSP/route/offline contract, a stale
backend/pointer, corrupt artifact/MIME, incomplete backup or failed readiness
must stop. Namespace retention consumes storage; no garbage collection is
performed. Cleanup/deletion and any capacity/paid-plan changes require their
own review and approval.

PR126 changes only `jarvis-release.json`; this branch leaves that file unchanged.
Shared integration files are the deployment workflow, Worker receipt helper,
qualification partition fingerprints, `.gitignore`, and their existing tests.
The new publication/loader/recovery modules and fixture files are owned here.
Coordinate those shared files with the integration owner before combining
branches. The workflow's existing main/manual events, gates, locks and identity
stay the same; only the four exact new helper paths join its reviewed filter.
No merge, production dispatch or promotion is performed by this task.

Local verification commands:

```sh
npm test
npm run build
node --test tests/static-publication.test.mjs \
  tests/static-publication-browser.test.mjs tests/azure-static-store.test.mjs \
  tests/versioned-publication-command.test.mjs tests/release-recovery-schema.test.mjs
python3 tests/fixtures/release-recovery/schema-recovery.py
```

All provider transports in command/recovery fixtures are in-memory or mocked.
Browser tests use a loopback server and synthetic data; the offline test loads
the exact pinned podcast service-worker code. SQL fixtures use local temporary
SQLite databases. No test reads private messages or mutates production.
