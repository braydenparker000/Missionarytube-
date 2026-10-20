# Jarvis on Azure Storage

Primary destination: https://missionarytube.z13.web.core.windows.net/

This repository now controls Jarvis's frontend deployment using the **existing** MissionaryTube Storage account, `$web` container, Entra app and GitHub OIDC federation. The repository name and `main` branch remain unchanged deliberately. No Azure service, identity, credential or permission is created.

Missionarytube- (repository ID `1350047370`) is the surviving source and deployment repository. Edit frontend code in `frontend/`. Imported application versions remain in Git history; the original `braydenparker999/jarvis` repository remains intact as historical provenance and for the Daily Board publication dependency described below. The original Static Web App frontend at https://gray-meadow-09216fd10.1.azurestaticapps.net/ is retired; the existing Azure Storage route remains the frontend deployment path.

## Develop

Edit static application code in `frontend/`, with routes in `frontend/<route>/`
and shared modules in `frontend/assets/`. Edit the Worker in `backend/`; it
imports shared browser modules directly from `frontend/`. There are no manual
component commit or tree pins in the normal build.

```sh
npm ci
npm run build
npm run test:daily-board
# When Worker behavior changes:
npm run test:backend
```

One install covers both workspaces. The build writes `dist/` and
`.backend-release/`, including generated source/input provenance. Music player
and font URLs are fingerprinted automatically from their bytes. Local edits can
build immediately; publication requires a committed checkout and matching
provenance. Generated files are ignored and do not belong in feature commits.

Browser checks require Chrome (`JARVIS_CHROME` selects it). Required CI installs
the exact qualified Node/Chrome versions and runs existing application tests with
isolated fixtures. `npm test` is the root deployment/security suite; its retained
historical qualification tests still use `.jarvis-source`. Ordinary build,
focused Board tests and current Worker tests do not need that checkout.

## Release

The normal frontend path is one PR and one authorized **Deploy to Azure Storage**
run. Changes to Daily Board, private pages, music UI and shared assets use this
same publisher.

1. Review the PR and required validation. With explicit owner approval, merge
   using a merge commit.
2. Wait for successful **Validate** on that exact `main` commit.
3. With explicit release approval, run **Deploy to Azure Storage** on `main`:
   `action=publish`, `expected_commit=<full reviewed main SHA>`, and leave
   `rollback_run_id` blank. If main moved, review the new revision first.
4. Inspect the production job and its `frontend-evidence-<run-id>` artifact.
   Music playback verification follows successful publication and uses that run's
   receipt, including restored bytes after rollback.
   Qualification, merge, publication and live behavior verification are separate
   results; a green PR does not mean the change is live.

The publisher reuses the exact successful main CI artifact; it does not repeat
full qualification or select another source snapshot. Before credentials it
checks the artifact identity, built Board behavior and existing Storage-origin
API health/CORS/public inbox. It discovers trusted
publication history, checks current live bytes, captures application bytes and
properties, and saves `frontend-rollback-<run-id>` for 90 days **before writing**.
Writes are conditional on unchanged ETags. Only changed application files are
uploaded; every managed file is read back publicly. Actual-origin Chrome checks
exercise Daily Board and private image previews, using synthetic owner API
responses for the private journey. Unrelated storage inventory must remain
unchanged.

The first consolidated release accepts only already-existing application paths
with matching candidate bytes or immutable accepted-publication evidence. It
cannot activate a missing imported route. Subsequent releases use the generated
normal receipt as their baseline. Historical pin files are read-only evidence,
not fields to update for a feature or release.

Configured values, publication feeds and Drive catalog data are excluded from
application writes. Keep `AZURE_DEPLOY_ENABLED=true`,
`AZURE_STORAGE_ACCOUNT=missionarytube` and the existing three Azure identity
secrets unchanged. No credential rotation, new identity or settings change is
part of an application release.

Worker changes use the existing **Deploy verified music Worker** workflow with
`expected_commit=<full reviewed main SHA>` and its explicit music confirmation.
It consumes that commit's successful CI artifacts, verifies the `backend/`
input closure, preserves existing bindings/variables and uses the existing
Wrangler version and scoped credentials. Existing optional data/setup controls
remain explicit; ordinary code changes leave them off. This is a separate
provider deployment and requires explicit authorization. Frontend publication
never deploys a Worker.

## Rollback

With explicit approval, run **Deploy to Azure Storage** on reviewed current
`main` with `action=rollback`, `expected_commit=<full reviewed main SHA>` and
`rollback_run_id=<the original publication run>`. The publisher validates the
original run and backup before restoring captured application bytes, headers and
metadata. It refuses to overwrite a later writer, preserves additive assets
needed by cached pages, and never restores configuration or content over live
data. An interrupted publication can use its saved backup too.

**Restore historical Daily Board** remains only for backups produced by the old
Board publisher, including the two verified recovery releases. Retained Worker
version checkpoints and historical specialist receipts remain available; they
are not alternative editable sources or routine forward release paths.

Permanent source checkpoints remain:

- Destination: `backup/missionarytube-before-jarvis-20260920`, commit
  `dc5423d1a1c8923983db54b94693cedda772d68b`.
- Original Jarvis: `backup/before-storage-migration-20260920`, commit
  `bb025c749932dd08847e1dc6cf97e8d0e638dab4`.

Keep original repositories, refs and saved rollback artifacts. Historical
whole-site migration backups need review before use against today's storage;
normal application rollback uses the guarded workflow above.

## Static compatibility and browser data

The frontend is about 20 MiB of static application code, assets and existing
player decoders. It contains no media library payload, backend source, credentials
or tests. Media remains on existing providers. Azure Storage does not interpret
SWA configuration: deployed CSP/referrer policies are explicit in document
source. New or edited HTML must declare its CSP; the accepted unchanged legacy
Muse document retains its existing policy behavior. Header-only policies such
as `frame-ancestors` cannot be supplied through HTML meta tags.

Shared messages, notes and briefings retain their existing stores and origin.
Browser data from the retired SWA hostname still needs the product's supported
export/import paths; no storage migration is performed here. Real A15 playback
and restricted-device behavior require device verification.

Quick AI keeps its existing browser calls to Gemini, Groq and Tavily. Its live
configuration and Drive's live configuration are preserved, not regenerated by
an application release. Main chat and Muse retain their existing Worker APIs.

## Source and provenance

`frontend/` and `backend/` are the editable application sources.
`dist/release.json` records the actual checkout SHA and frontend/component trees;
`.backend-release/provenance.json` records the discovered Worker input graph,
compiler, dependency files and bundle digest. CI binds the qualified frontend
artifact to the reviewed checkout and its run/attempt. The Worker qualification
bundle verifies inputs; the existing Wrangler publisher still produces the
provider deployment.

The duplicate imported `jarvis/` tree and unshipped root application prototypes
have been removed. Normal tools read `frontend/`, `backend/` and `scripts/`.
R2 migration, initialization, upload and analysis use reviewed current main code;
none checks out a different application variant. The hourly Drive publisher
keeps its existing OAuth guard, tag parser, schedule, identity and pointer-last
publication.

| Directory | Purpose |
| --- | --- |
| `frontend/` | Authoritative editable static application, including shared browser/Worker helpers |
| `backend/` | Authoritative Worker and its application tests |
| `scripts/` | Build, current publishing, data and verification tools; historical receipt/restore contracts |
| `tests/` | Deployment regressions, synthetic fixtures and current Python tool tests |
| `docs/` | Current guides, licenses and dated release evidence |
| `.agents/` | The existing delivery skill |

Historical application versions remain in Git. The small test-only history
reader materializes exact frozen compatibility inputs in temporary directories;
it is never used by a build or publisher. Existing `.jarvis-source` CI fixtures
are ignored historical qualification inputs, not source selectors. Use a full
clone (or `git fetch --unshallow`) for those legacy checks. No history rewrite or
rollback-artifact deletion is part of this cleanup.

Run `npm run test:backend` for current Worker behavior and `npm run test:tools`
for the preserved R2 integrity, OAuth, retry, conditional-write and upload-receipt
guards. `npm test` remains the required deployment suite. Daily Board report
preparation uses `node scripts/daily-board-report.mjs`; its optional local SQLite
integration check is `node scripts/check-daily-board-integration.mjs`.

New Daily Board reports using existing report types use the existing content
writer; they do not require an application PR, source pins or code deployment.
This cleanup does not change its schedule, issue destination or authorization.
See [the source import record](docs/jarvis-source-import.md) for history and
[the delivery SOP](.agents/skills/deliver-software-efficiently/SKILL.md)
for validation and authorization requirements.

The recorded Daily Board reader activation enabled both the legacy
[`braydenparker999/jarvis#2`](https://github.com/braydenparker999/jarvis/issues/2)
and destination
[`braydenparker000/Missionarytube-#250`](https://github.com/braydenparker000/Missionarytube-/issues/250).
The [release-path record](docs/release-paths.md) documents activation attempt
39084315952 (failed overall) and successful dual-source readback run 39084979917; the
[publishing contract](docs/daily-board-publishing.md) records a later read-only
verification in run 39097771082. These recorded activations supersede the
earlier disabled-reader checkpoint.

Reader activation does not establish cutover of the separate scheduled writer.
Verify that writer's destination from its own configuration and publication
readback before claiming a cutover; no fresh writer status is established here.
Preserve both issues and their history for reconciliation and rollback.
Destination issue #2 is an imported PR and must not be reused.

## Media regression checks

The duplicate root media app and its legacy build/browser commands have been
retired. Media source checks and the build read `frontend/media`.
Generated provenance records its actual tree and checkout commit. Legacy
source-only contracts read immutable Git fixtures, with no editable `src/` copy.
Fixtures and licenses remain. The media
qualification command retains its documented shipped UI TODOs and can report
not ready; see [migration evidence](test-evidence/media-migration/README.md).
