# Jarvis on Azure Storage

Primary destination: https://missionarytube.z13.web.core.windows.net/

This repository now controls Jarvis's frontend deployment using the **existing** MissionaryTube Storage account, `$web` container, Entra app and GitHub OIDC federation. The repository name and `main` branch remain unchanged deliberately. No Azure service, identity, credential or permission is created.

Missionarytube- (repository ID `1350047370`) is the surviving source and deployment repository. The imported Jarvis history is maintained under `jarvis/`; the original `braydenparker999/jarvis` repository remains intact as historical provenance and for the Daily Board publication dependency described below. The original Static Web App frontend at https://gray-meadow-09216fd10.1.azurestaticapps.net/ is retired; the existing Azure Storage route remains the frontend deployment path.

## Release

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

## Source consolidation in progress

The authoritative Jarvis source snapshot is now imported at `jarvis/`, preserving
its original Git ancestry. Missionarytube- is the surviving repository. The
active frontend build starts from destination commit
`de5d7177a778f4bfa2aa071ab064a8a4fb9b2246`, path
`jarvis-active-public-c28/public`, tree
`67a47e36414a8ceb4040c9454f64ed1982a9146c`, byte- and mode-identical to the
former c28 public tree, and overlays only component paths with exact
destination identities. The full imported
variant at `jarvis/public` is preserved but not wholesale activated. Divergent
shared UI, security, storage, playback and device variants remain held; see
[the import and release record](docs/jarvis-source-import.md) for the exact
component map. Root `npm test` explicitly selects the orchestration tests. See
also the [canonical delivery SOP](jarvis/.agents/skills/deliver-software-efficiently/SKILL.md).

The additive Daily Board destination-reader code was published to the existing
Worker in [run 39040982427](https://github.com/braydenparker000/Missionarytube-/actions/runs/39040982427)
(code SHA-256 `74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d`),
but the destination-feed path remains disabled: no destination issue or
enabling configuration is present. The current reader and scheduled automation still use the open
[`braydenparker999/jarvis#2`](https://github.com/braydenparker999/jarvis/issues/2),
“Jarvis publications — replies and Daily Board.” Destination issue #2 is
already an imported PR and must not be reused. Keep the old feed intact until a
separately approved migration has a unique destination issue, dual-read
reconciliation, writer switch and rollback. This consolidation has not changed
the publication schedule or writer.

## Media regression checks

The duplicate root media app and its legacy build/browser commands have been
retired. Media source checks read `jarvis/public/media` from the imported source
snapshot, and the built route uses its exact destination component identity.
Other paths stay on their active source identities until their own cutover is
reviewed. The three retained `src/` modules support 29 legacy source-only
contracts and are not built or shipped. Fixtures and licenses remain. The media
qualification command retains its documented shipped UI TODOs and can report
not ready; see [migration evidence](test-evidence/media-migration/README.md).
