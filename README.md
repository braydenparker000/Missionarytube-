# Jarvis on Azure Storage

Primary destination: https://missionarytube.z13.web.core.windows.net/

This repository now controls Jarvis's frontend deployment using the **existing** MissionaryTube Storage account, `$web` container, Entra app and GitHub OIDC federation. The repository name and `main` branch remain unchanged deliberately. No Azure service, identity, credential or permission is created.

Missionarytube- (repository ID `1350047370`) is the surviving source and deployment repository. Edit frontend code in `frontend/`. The frozen imported Jarvis history is retained under `jarvis/`; the original `braydenparker999/jarvis` repository remains intact as historical provenance and for the Daily Board publication dependency described below. The original Static Web App frontend at https://gray-meadow-09216fd10.1.azurestaticapps.net/ is retired; the existing Azure Storage route remains the frontend deployment path.

## Develop

`frontend/` is the authoritative editable static frontend. Routes live in
`frontend/<route>/`; shared code lives in `frontend/assets/`. The build reads
this directory directly, with no source overlays or component pin files.

```sh
npm ci
npm run build
npm run test:daily-board
```

The focused Daily Board command needs Chrome (`JARVIS_CHROME` may select it).
Run affected tests for other components and the full required CI before merge.
`npm test` also covers historical backend/release contracts and still requires
its existing `.jarvis-source` checkout. `npm run build` and the focused Board
command do not require that checkout. Local edits produce accurately marked
provenance; publication requires committed source and a matching rebuild.

## Release

For a Daily Board update, review one PR and merge it, wait for required checks,
then authorize one **Publish composable Daily Board** workflow on `main` with
`action=publish` and `expected_commit=<reviewed full main SHA>`. Leave the parent
and rollback fields blank for a normal publish. The workflow finds the latest
successful publication, validates its receipt and current live bytes, backs up
before writing, publishes only changed Board files and runs actual-origin
Chrome checks. Rollback uses the same workflow with `action=rollback`, that
publication's run ID in `rollback_run_id`, and the reviewed orchestration SHA.
No source-pin edits or follow-up publication PR are needed.

Other component publishers retain their existing live-configuration and rollback
boundaries. The general Azure workflow is not a shortcut for publishing a
component; it cannot overwrite independently published assets safely without
its existing guards. Its retained historical full-site path is described below.

Use reviewed source and component identities recorded by the build and release manifests. The general historical source pin in `jarvis-release.json` is still used by remaining qualification and release consumers; it does not establish that every live component comes from one checkout. The existing Azure Storage route and its identity remain in place. Push checks can qualify a commit while production upload jobs are skipped; inspect the actual job results before describing a release as deployed. Keep the existing `AZURE_DEPLOY_ENABLED=true`, `AZURE_STORAGE_ACCOUNT=missionarytube`, and three `AZURE_*` identity secrets unchanged.

The workflow:
1. Runs existing repository checks, all Jarvis tests, and the static build.
2. Logs in with the unchanged Entra OIDC identity.
3. Saves every existing `$web` blob and its properties to the `storage-before-<run-id>-<attempt>` GitHub artifact (90-day retention) before overwriting anything.
4. Uploads Jarvis files, excluding the root `index.html`; the new launcher is available temporarily at `/jarvis-preview.html`.
5. Verifies every deployed file by SHA-256 and MIME type and checks all 14 folder routes.
6. Requires successful API preflight, health and shared-inbox responses for the Storage origin.
7. Overwrites the homepage only after those gates pass, then verifies root and all files again.

If the Cloudflare gate fails, the current homepage remains intact. Deploy the committed backend CORS change in the existing `jarvis-hub-api` Worker, then rerun this workflow. The Worker must run v7 or later. Since Jarvis `ebf433d` the Worker accepts only the exact Storage origin; the retired Static Web App origin is rejected. API CORS is not unrestricted.

## Rollback

Permanent source checkpoints:
- This repository: branch `backup/missionarytube-before-jarvis-20260920`, commit `dc5423d1a1c8923983db54b94693cedda772d68b`.
- Original Jarvis: branch `backup/before-storage-migration-20260920`, commit `bb025c749932dd08847e1dc6cf97e8d0e638dab4`.

For an exact website rollback, download `storage-before-<first-migration-run-id>`, then upload its `files/` directory to the same `$web` container using `--auth-mode login --overwrite true`. Its `manifest.json` records original content headers and properties. The migration does not delete old assets, so restoring the original `index.html` also immediately restores the original Astra entry point. The saved repository revision can rebuild the old artifact with `npm ci && npm run build` if an artifact has expired. Never change the federation or rotate credentials to roll back frontend files.

## Static compatibility and browser data

The artifact contains only frontend files and existing player code/decoders (about 17 MiB); no music or movie files, backend source, Azure credentials or tests are uploaded. Media remains on external providers or the A15 DrawerCast server. All modules, folders, CSS and assets retain their existing paths. Lazy player decoders are loaded when needed, not by the launcher.

Storage does not process `staticwebapp.config.json`. The build converts the applicable CSP and referrer policy to HTML meta tags and the upload sets revalidation caching. Header-only policies such as `frame-ancestors` and `X-Content-Type-Options` cannot be replicated by that conversion. No CDN or extra Azure service is introduced to supply headers.

Shared messages and briefings remain in the same Cloudflare store and publication issue. A hostname change creates separate browser storage: unsent drafts, hub preferences, notes, DrawerCast settings/pairing and Ianua files do not automatically transfer from the SWA hostname. Export/import supported data on the device before abandoning the old site. Astra settings already saved on this Storage hostname remain on the same origin when Astra moves to `/media/`. Real A15 playback and restricted-device behavior require a device check.

Quick AI at `/quick-ai/` calls Gemini, Groq, and Tavily directly from the browser. The deployment workflow uses `QUICK_AI_GEMINI_KEY`, the existing `GROQ_API_KEY`, and `QUICK_AI_TAVILY_KEY` Actions secrets to generate the owner's intentionally public free-plan configuration in the built artifact. It requires all three values before logging into Azure or touching blobs. The legacy public config blob is replaced during staging. Main Jarvis chat and Muse keep their existing Worker and check-based delivery paths.

## Source and provenance

`scripts/build-jarvis.mjs` packages only `frontend/`, generates public configuration
from the unchanged release configuration, and translates the existing document
CSP for Azure Storage. `dist/release.json` records the checkout SHA and actual
frontend/component trees automatically. Its legacy top-level `source`/`commit`
fields retain the historical backend baseline; `frontend` and `components`
identify the real frontend build inputs. The frozen `jarvis/` archive, external
qualification checkout and historical publication receipts are not editable
frontend alternatives. Dormant variants remain unselected.
See [the source import record](docs/jarvis-source-import.md) for history and
[the delivery SOP](jarvis/.agents/skills/deliver-software-efficiently/SKILL.md)
for validation and authorization requirements.

The recorded Daily Board reader activation enabled both the legacy
[`braydenparker999/jarvis#2`](https://github.com/braydenparker999/jarvis/issues/2)
and destination
[`braydenparker000/Missionarytube-#250`](https://github.com/braydenparker000/Missionarytube-/issues/250).
The [release-path record](docs/release-paths.md) documents activation attempt
39084315952 (failed overall) and successful dual-source readback run 39084979917; the
[publishing contract](daily-board-next/PUBLISHING.md) records a later read-only
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
Generated provenance records its actual tree and checkout commit. The three retained `src/` modules support 29 legacy source-only
contracts and are not built or shipped. Fixtures and licenses remain. The media
qualification command retains its documented shipped UI TODOs and can report
not ready; see [migration evidence](test-evidence/media-migration/README.md).
