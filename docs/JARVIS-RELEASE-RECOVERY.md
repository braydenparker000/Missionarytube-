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
inventory, exact configured artifact, planned backend contract and immutable
publication recipe. The actual activated Worker is separately attested before
frontend writes; a planned target is never described as the live Worker. Every transferred byte, MIME type, publication manifest and directory
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

## Executed prewrite qualification and preserved evidence

The main deployment has three bounded stages after full source qualification:

1. `prewrite` verifies the original same-run artifact, reads the actual previous
   Worker/version/settings, seals existing authorized public configuration,
   checks API/origin and podcast readiness, and verifies a complete static
   backup. It prepares both publications and checks canonical/offline/policy
   compatibility. It performs no provider writes. Preserve
   `storage-before-<run>-<attempt>` and
   `publication-before-<sha>-<run>-<attempt>` before continuing.
2. The independently completed `rollback-pair` job uses the exact qualified
   Node24, Python and checksum-verified Chrome versions. It extracts literal DDL
   from both immutable source commits, executes every candidate DDL interruption
   with synthetic pending work, executes the candidate's real Worker/SQLite
   routing with both exact frontend artifacts, and runs the existing pending-work
   adversarial tests. The browser checks canonical Jarvis, Poweramp and Astra,
   private/public isolation, accepted replies, history, query/hash, CSP, storage,
   lazy scripts and a real PCM WASM module while the pointer selects another
   release. All fixture egress and message/job mutations are blocked. Fresh public
   readiness, actual previous Worker identity and saved static bytes/ETags/MIME
   are checked again. A failure cannot emit a new usable result. Preserve
   `rollback-pair-<sha>-<run>-<attempt>`; its bounded record is separately verified
   by `verified-recovery-pair-<digest>` and archived before the job succeeds.
3. `deploy` downloads those original artifacts and checks the completed producer
   against immutable GitHub run/job/tree metadata. Immediately before any
   provider change, `authorize-change` rechecks the complete authenticated static
   inventory, every backed-up byte/ETag/MIME, configured seal and actual previous
   Worker/version/settings. Only then can the existing qualified Worker action
   run. The same check runs again inside the existing Worker action before its
   provider command. The [action's shell runner](https://github.com/cloudflare/wrangler-action/blob/v4/src/exec.ts)
   throws on a failed guard; a fixture executes the shipped folded shell command
   from the isolated installer directory and proves failure stops the next command.
   Its exact activated version/code/settings checkpoint is verified under
   `verified-release-backend-<digest>` and archived before frontend staging.
   Stage, bootstrap, promote and recovery each enforce this proof again.

The schema-2 pair record binds both source commits and publication plans, original
run/attempt/head, configured artifact/full backup, planned target backend digest,
previous Worker UUID/settings digest, literal schema inputs, complete tracked runtime/test source closure (including transitive helpers,
publication JSON and dependency locks), and the fixture recipe. It contains actual bounded fixture results, not
operator compatibility booleans. Unknown/dynamic/destructive SQL stops for
migration review. Current compatible releases require `deployPodcastWorker` and
`preserveDriveCatalog` to remain true; another backend/catalog mode is a separate
reviewed migration and fails before provider writes.

A later failed or cancelled `deploy` does not erase the successful independent
producer. Static recovery accepts a terminal original workflow whose producer,
digest verification, archive and exact backend-activation checkpoint succeeded.
It does not require the later deployment job or entire workflow to have succeeded.
Manual recovery cannot use an in-progress run: retain the production locks and
resolve the interrupted owner first. Normal forward commands can consume their
own in-progress run once the prerequisite producer completed successfully.

Preserve `publication-after-<sha>-<run>-<attempt>` on interruption or success,
including the before/after Worker version inventories and available checkpoints.
Static/publication/pair/Worker recovery artifacts retain 90 days. A missing required
prewrite or activation archive stops subsequent writes. `state.json` is a hint;
it cannot prove an upload did not reach Azure. Inspect provider bytes and ETags.

The final receipt binds original artifact/configuration, planned backend contract,
actual activated backend identity, selected frontend publication/pointer and the
existing immutable GitHub production-success stamp. A failed/cancelled original
run cannot be relabeled a successful-production receipt after manual recovery.
Worker reuse still requires its existing completed successful production proof;
these recipe changes require fresh qualification under those rules.

Use the active pointer and digest-bound receipt to identify the selected release.
Older root assets and root `release.json` remain as legacy compatibility material;
`check-jarvis-static.mjs` verifies the older flat layout. The new workflow uses
`publish-jarvis-versioned.mjs verify` for the selected versioned publication.

## Interrupted frontend procedure

1. Keep both production locks. Preserve the original source/orchestration
   checkout, qualified/configured artifacts, full static backup, Worker
   checkpoints and publication plans. Do not rebuild and label it the original
   artifact. A rerun with a new artifact is a new release and needs its own
   qualification. Never fabricate an original successful run/attempt.
2. Run the read-only `inspect` command in the preserved checkout using the
   existing authorized Azure session and fixed `STORAGE_ACCOUNT=missionarytube`.
   This accepts only exact previous/candidate pointer bytes with the expected
   MIME and records their ETag/SHA256. Missing pointers are accepted only for
   an initial cutover. Malformed, foreign and later release pointers stop before
   creating a new observation; an older saved observation cannot authorize
   overwriting a newer release.
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
     "backendIdentityDigest": "<preserved planned backend contract digest>",
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
   file for the new inspected previous-pointer ETag; manual actions read
   `observed-pointer.json`, while the normal workflow uses its saved CAS baseline.
   A successful pointer write
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

The CLI rejects local assertions without the independently executed, digest-bound
hosted proof and activation checkpoint described above. It recomputes the schema,
pending-work and fixture input digests from immutable source and checks actual
current Worker/version/settings, original artifact and saved full backup. A fresh
foreign-pointer inspection cannot bless another release for rollback. Bootstrap
rechecks the exact previous pointer at the end and again before saving its CAS
baseline. A later pointer is never adopted as authorization to overwrite it.

After rollback use:

```sh
node scripts/publish-jarvis-versioned.mjs verify --target previous
```

The checkpoint records the actual selected previous release. The default `verify`
also follows a selected/verified previous target; `--target candidate` rejects a
previous pointer. A lost pointer response can be retried with the same approved
action: exact target bytes are reconciled without another mutation, and the target
checkpoint is still saved. Recheck public origin readiness and real mobile
behavior. A candidate receipt does not describe a selected previous frontend.

Ordinary messages/job progress under the unchanged Worker/schema contract do not
invalidate static rollback proof: it does not restore data or replay work. A new
Worker version, backend/settings/binding/namespace change, changed schema or
pending-work implementation, provider database restore, known manual schema
change or unexplained schema drift invalidates this proof and is a hold. Worker
identity and contract digests are enforced by the CLI. A source fixture cannot
prove the absence of an out-of-band provider schema change; the incident owner
must establish that fact without collecting private bodies or enabling logging.
A current live rollback pair is not claimed by this branch. Its hosted read-only
producer must execute successfully on the exact integrated main head and baseline
before any release provider changes are allowed.

## Worker, schema and pending work

Worker rollback needs a separate approval for an exact previous provider version
and the current preserved bindings/settings. Use the archived before/after
version inventories and exact live provider identity; version-list order alone
does not prove the active version. Recheck one 100-percent active version after
the approved action. A frontend backup is not a Worker version checkpoint.
This branch performs no provider Worker rollback and changes no binding,
SQLite class, migration tag, namespace, secret, setting or credential.

The producer reads literal schema definitions from the exact previous and candidate
git objects; the committed 33/46-statement c4/PR73 fixtures provide independent
regression coverage. Native SQLite tests run every candidate DDL interruption,
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
runs the implemented independent hosted rollback-pair producer successfully
against that exact live baseline and obtains the applicable publication/promotion
approval. Unexpected legacy HTML,
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
stay the same; the seven explicit static/recovery helper paths join its reviewed filter.
The existing helper wildcard covers the producer, and existing test filters cover
its fixtures. No trigger event, production gate, lock or deployment identity changes.
No merge, production dispatch or promotion is performed by this task.

Local verification commands:

```sh
npm test
npm run build
node --test tests/static-publication.test.mjs \
  tests/static-publication-browser.test.mjs tests/azure-static-store.test.mjs \
  tests/versioned-publication-command.test.mjs tests/rollback-pair-producer.test.mjs \
  tests/rollback-pair-runtime.test.mjs tests/release-recovery-schema.test.mjs
python3 tests/fixtures/release-recovery/schema-recovery.py
```

All provider transports in command/recovery fixtures are in-memory or mocked.
Browser tests use loopback or an offline context with explicitly fulfilled requests
and synthetic data. The full artifact test builds the actual pinned source with
the committed Storage build; the offline test loads the exact podcast SW code. SQL fixtures use local temporary
SQLite databases. No test reads private messages or mutates production.

## Review evidence and publication alternatives

The actual c4 frontend and PR73/ea9 frontend were built independently in local
fixtures and tested together against the real ea9 Worker/SQLite runtime under
Node24.21.0 and Chrome154.0.8037.97. All browser requests were explicitly fulfilled
locally. Literal 33-to-46 schema recovery passed 47 interruption points, and the
three candidate pending-work adversarial files passed 46 tests without skips.
The repository regression builds and exercises the full currently pinned artifact,
so future qualification also checks shipped markup, CSS and lazy resources.
This covers runtime loading and PCM WASM compilation; it does not claim every
codec or provider stream was played or production migration headroom measured.

A local comparison served the same transformed HTML directly at canonical paths,
with immutable resources and no pointer loader. Both variants passed the corrected
same-artifact runtime journey: 295 browser requests for the pointer and 259 for
direct documents, all fulfilled locally. These counts are fixture evidence, not
production performance measurements. An earlier prototype failure incorrectly
expected browser Forward to leave Poweramp; its existing popstate handler consumes
that entry. The accepted history check uses canonical Home/Relay routes and leaves
Poweramp's existing behavior intact.

Direct HTML is a viable smaller client design. A production implementation still
needs conditional commits per canonical document, recognition of each partially
selected previous/candidate document, exact per-action approval inventories, and
interruption/lost-response/rollback tests. This branch retains the implemented and
tested single-pointer selection commit after the initial reviewed cutover. It does
not claim that direct HTML is unsafe or that the whole browser session switches at
one instant. Existing pin-only PR126 remains separate. A Worker-only repair could
leave the current frontend in place after independent old-frontend/candidate-Worker
qualification and migration/headroom checks, but core must explicitly define that
narrower release and its receipt/approval; it must not forge a completed frontend
receipt or reuse the unsafe shared-asset overwrite as an atomic promotion.
