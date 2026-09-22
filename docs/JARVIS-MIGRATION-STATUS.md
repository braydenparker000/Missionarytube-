# Jarvis Storage migration status — 2026-09-20

Status: live. Jarvis is the homepage at https://missionarytube.z13.web.core.windows.net/.

## Preserved infrastructure

- GitHub: braydenparker000/Missionarytube-, branch main, repository ID 1350047370.
- Storage: missionarytube, Ianuarg, East US, Standard LRS; existing $web endpoint https://missionarytube.z13.web.core.windows.net/.
- Entra application: MissionaryTube. Existing federated credential missionarytube-main, issuer https://token.actions.githubusercontent.com, audience api://AzureADTokenExchange, subject repo:braydenparker000@322498428/Missionarytube-@1350047370:ref:refs/heads/main.
- Existing Storage Blob Data Contributor role remains scoped to this Storage account. No credentials, federation, permissions, hosting settings or Azure services were changed.

## Implemented

- Jarvis backend CORS commit: 4e0804b1d4923d2ad8a13ed6bc26f241c1ccb55c in braydenparker999/jarvis/main. Supports exact Storage and SWA origins, including OAuth responses. The owner manually deployed the existing Worker; live health reports v7 and both frontend origins pass API checks.
- Storage deployment commit: 269731633809069e357fabed0aef71b96e03e192. Uses a pinned checkout of Jarvis, preserving the source repository's publication issue and existing backend relationship.
- Production source rollback branches exist in both repositories; see README.
- Deployment run: https://github.com/braydenparker000/Missionarytube-/actions/runs/35497625182
- Full pre-migration $web bytes and properties saved before overwrites: artifact storage-before-35497625182, ID 10601775900, 6,172,417 compressed bytes, 90-day retention.
- Successful production cutover: https://github.com/braydenparker000/Missionarytube-/actions/runs/35498216036 at commit ab476ac4341d57035f4d4b97406e97906cafcf39. Root now serves Jarvis.
- A second pre-cutover snapshot is storage-before-35498216036-1, artifact ID 10600598246. Original pre-migration artifact above remains preserved.
- Azure Static Web Apps backup and shared inbox were refreshed successfully and remain live.

## Verification

- 517 existing repository tests passed locally and in CI; 28 Jarvis tests passed.
- Build: 114 original frontend files, 16.57 MiB, no music/video payloads. Added preview and release metadata; excluded SWA configuration from deployment.
- All 116 final files passed SHA-256 and MIME validation, including WASM; all 13 folder routes and the final root returned correct index files.
- Live API preflight, health v7 and shared-inbox reads passed for both Storage and SWA origins. Browser verified Connected on the Storage inbox and Daily Board, existing messages/replies/briefings, reader publications connection, responder landing and its Open Jarvis navigation.
- Final root was refreshed in the browser and confirmed Home · Jarvis. A tab with cached Astra initially needed an ordinary refresh; the new homepage uses Cache-Control: no-cache.
- Browser verified launcher and navigation, local notes and unsent draft persistence across reload, Astra external catalog loading, DrawerCast startup/settings, Ianua initialization and IndexedDB-backed storage count, sandboxed HTML rendering.
- Full IndexedDB write/import round trip and actual A15/local-network playback were not performed.
- No test message was sent. Local notes/composer test text was cleared.
- Quick AI remains an unconfigured pre-existing placeholder, not a working provider integration.

## Device checks and limits

The owner should open https://missionarytube.z13.web.core.windows.net/ on the restricted Android device and refresh if the old Astra page is cached. Restricted-device access and real A15/local-network playback cannot be verified from the cloud browser. No new message, briefing or OAuth authorization was created during migration testing. Full OAuth completion remains unverified.

Do not alter federation. (The SWA backup was retired on 2026-09-22; see below.) Browser data on the SWA origin does not transfer automatically; use the existing app export/import tools where available. Quick AI provider configuration and hourly schedules were not changed.

For future frontend releases, update jarvis-release.json to the reviewed source commit. Deployment artifacts now include the run attempt in their names so retrying preserves earlier backups.

## Update 2026-09-22: Static Web App retired, live Drive reads

- Release commit 602349c87ae33299537fbbbb31d1d612b8609daf pins Jarvis `ebf433dcc857894cd07607fef9a1e5d11a6f8dd3` (merge of braydenparker999/jarvis#3).
- Jarvis changes shipped: DrawerCast always lists the real Drive folder (`drive-prepared.json` only supplies tags/duration for files whose size and MD5 still match); the 50 stale bundled waveforms and checked-in manifest were removed; the Worker (`backend/origins.js`) accepts only the Storage origin; the SWA deploy workflow was removed from Jarvis.
- The SWA at gray-meadow-09216fd10.1.azurestaticapps.net is retired and no longer serves Jarvis. `jarvis-release.json` no longer has `backupOrigin`, and `scripts/check-jarvis-api.mjs` checks only the Storage origin, because the Worker now rejects the old one. The gray-meadow entry stays in the privacy-test allowlist because historical docs still name it. `GROQ_API_KEY` is needed only in this repository's Actions secrets.
- Verification: 517 repository tests, 92 Jarvis tests, build of 140 frontend files / 18.92 MiB. Deployment run https://github.com/braydenparker000/Missionarytube-/actions/runs/35774831516 passed every gate, including the live Worker check for the Storage origin.
- Still to check on a device: open `/drawercast/`, refresh Drive and confirm the song count matches the folder. Old waveform blobs may remain in `$web`; they are unreferenced and harmless.
- Rollback: set `jarvis-release.json` back to `bab237025787d0c4f9cd14ebc23184fb5a0383cc`, or restore the run's `storage-before-35774831516-1` artifact. The previous frontend expects the old Worker, which still accepts the Storage origin, so a frontend-only rollback is safe.

## Update 2026-09-22: My Media (/mymedia/)

- Pins Jarvis `8c0250e31a92f1d61269f17f1623517004d0ce15` (merge of braydenparker999/jarvis#4). It adds `/mymedia/`, a library for the owner's Google Drive video folder, with playback in the browser. Details are in the Jarvis repo's `docs/drive-video.md`.
- The page uses the existing `GOOGLE_DRIVE_API_KEY` secret. It needs no new secret, service or Azure change. The folder ID is committed in Jarvis `public/assets/drive-config.json` as `videoFolderId`.
- `scripts/check-jarvis-static.mjs` now also checks the `/mymedia/` route (16 directory routes).
- Rollback: set the pin back to `ebf433dcc857894cd07607fef9a1e5d11a6f8dd3`.
