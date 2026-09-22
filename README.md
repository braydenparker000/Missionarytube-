# Jarvis on Azure Storage

Primary destination: https://missionarytube.z13.web.core.windows.net/

This repository now controls Jarvis's frontend deployment using the **existing** MissionaryTube Storage account, `$web` container, Entra app and GitHub OIDC federation. The repository name and `main` branch remain unchanged deliberately. No Azure service, identity, credential or permission is created.

`jarvis-release.json` pins the exact frontend source in `braydenparker999/jarvis`. The workflow checks out that revision into `.jarvis-source`, runs its tests, and packages `public/`. Keeping that repository retains its Cloudflare deployment relationship and publication issue #2. The original Static Web App frontend at https://gray-meadow-09216fd10.1.azurestaticapps.net/ is retired; the Storage site is the only frontend. Existing MissionaryTube source is retained in this repository for rollback and is **not** included in the Jarvis deployment.

## Release

Update the commit in `jarvis-release.json` after reviewing a Jarvis release. Push to `main` or run **Deploy to Azure Storage** on `main`. Keep the existing `AZURE_DEPLOY_ENABLED=true`, `AZURE_STORAGE_ACCOUNT=missionarytube`, and three `AZURE_*` identity secrets unchanged.

The workflow:
1. Runs existing repository checks, all Jarvis tests, and the static build.
2. Logs in with the unchanged Entra OIDC identity.
3. Saves every existing `$web` blob and its properties to the `storage-before-<run-id>-<attempt>` GitHub artifact (90-day retention) before overwriting anything.
4. Uploads Jarvis files, excluding the root `index.html`; the new launcher is available temporarily at `/jarvis-preview.html`.
5. Verifies every deployed file by SHA-256 and MIME type and checks all 14 folder routes.
6. Requires successful API preflight, health and shared-inbox responses for **both** frontend origins.
7. Overwrites the homepage only after those gates pass, then verifies root and all files again.

If the Cloudflare gate fails, the current homepage remains intact. Deploy the committed backend CORS change in the existing `jarvis-hub-api` Worker, then rerun this workflow. The Worker must run v7 or later. The migration adds only the exact new frontend origin and retains the old origin; it does not make API CORS unrestricted.

## Rollback

Permanent source checkpoints:
- This repository: branch `backup/missionarytube-before-jarvis-20260920`, commit `dc5423d1a1c8923983db54b94693cedda772d68b`.
- Original Jarvis: branch `backup/before-storage-migration-20260920`, commit `bb025c749932dd08847e1dc6cf97e8d0e638dab4`.

For an exact website rollback, download `storage-before-<first-migration-run-id>`, then upload its `files/` directory to the same `$web` container using `--auth-mode login --overwrite true`. Its `manifest.json` records original content headers and properties. The migration does not delete old assets, so restoring the original `index.html` also immediately restores the original Astra entry point. The saved repository revision can rebuild the old artifact with `npm ci && npm run build` if an artifact has expired. Never change the federation or rotate credentials to roll back frontend files.

## Static compatibility and browser data

The artifact contains only frontend files and existing player code/decoders (about 17 MiB); no music or movie files, backend source, Azure credentials or tests are uploaded. Media remains on external providers or the A15 DrawerCast server. All modules, folders, CSS and assets retain their existing paths. Lazy player decoders are loaded when needed, not by the launcher.

Storage does not process `staticwebapp.config.json`. The build converts the applicable CSP and referrer policy to HTML meta tags and the upload sets revalidation caching. Header-only policies such as `frame-ancestors` and `X-Content-Type-Options` cannot be replicated by that conversion. No CDN or extra Azure service is introduced to supply headers.

Shared messages and briefings remain in the same Cloudflare store and publication issue. A hostname change creates separate browser storage: unsent drafts, hub preferences, notes, DrawerCast settings/pairing and Ianua files do not automatically transfer from the SWA hostname. Export/import supported data on the device before abandoning the old site. Astra settings already saved on this Storage hostname remain on the same origin when Astra moves to `/media/`. Real A15 playback and restricted-device behavior require a device check.

Quick AI at `/quick-ai/` uses Groq directly, with streaming replies and browser-local chats. Set the `GROQ_API_KEY` Actions secret once in this repository. Deployment injects it into `assets/quick-ai-config.json` after building, keeping the key out of git and logs. The owner explicitly approved making this shared provider key available in the deployed frontend. No Azure identity, backend, or hourly schedule changes are required.
