# Jarvis Storage migration status — 2026-09-20

Status: staged and tested; homepage cutover pending Cloudflare deployment.

## Preserved infrastructure

- GitHub: braydenparker000/Missionarytube-, branch main, repository ID 1350047370.
- Storage: missionarytube, Ianuarg, East US, Standard LRS; existing $web endpoint https://missionarytube.z13.web.core.windows.net/.
- Entra application: MissionaryTube. Existing federated credential missionarytube-main, issuer https://token.actions.githubusercontent.com, audience api://AzureADTokenExchange, subject repo:braydenparker000@322498428/Missionarytube-@1350047370:ref:refs/heads/main.
- Existing Storage Blob Data Contributor role remains scoped to this Storage account. No credentials, federation, permissions, hosting settings or Azure services were changed.

## Implemented

- Jarvis backend CORS commit: 4e0804b1d4923d2ad8a13ed6bc26f241c1ccb55c in braydenparker999/jarvis/main. Supports exact Storage and SWA origins, including OAuth responses. Cloudflare has NOT deployed it yet; live health still reports v6.
- Storage deployment commit: 269731633809069e357fabed0aef71b96e03e192. Uses a pinned checkout of Jarvis, preserving the source repository's publication issue and existing backend relationship.
- Production source rollback branches exist in both repositories; see README.
- Deployment run: https://github.com/braydenparker000/Missionarytube-/actions/runs/35497625182
- Full pre-migration $web bytes and properties saved before overwrites: artifact storage-before-35497625182, ID 10601775900, 6,172,417 compressed bytes, 90-day retention.
- Jarvis files deployed except root index.html. Preview: https://missionarytube.z13.web.core.windows.net/jarvis-preview.html . Root still serves Astra deliberately.
- Azure Static Web Apps backup and shared inbox were refreshed successfully and remain live.

## Verification

- 517 existing repository tests passed locally and in CI; 28 Jarvis tests passed.
- Build: 114 original frontend files, 16.57 MiB, no music/video payloads. Added preview and release metadata; excluded SWA configuration from deployment.
- All 115 staged files passed SHA-256 and MIME validation, including WASM; all 13 folder routes returned correct index files.
- Browser verified launcher and navigation, local notes and unsent draft persistence across reload, Astra external catalog loading, DrawerCast startup/settings, Ianua initialization and IndexedDB-backed storage count, sandboxed HTML rendering.
- Full IndexedDB write/import round trip and actual A15/local-network playback were not performed.
- No test message was sent. Local notes/composer test text was cleared.
- Quick AI remains an unconfigured pre-existing placeholder, not a working provider integration.

## Remaining work

Cloudflare dashboard presented a persistent human-verification challenge in the connected browser. The live API rejects the new Storage origin with HTTP 403. Deployment therefore stopped at the backend readiness gate BEFORE replacing root index.html. Live inbox, Daily Board, responder/OAuth end-to-end requests on Storage cannot be verified until that changes.

After Cloudflare access is restored:
1. Deploy existing jarvis-hub-api from braydenparker999/jarvis/main at commit 4e0804b or later: root /backend, no build command, npx wrangler deploy. Preserve the existing HUBS binding/migration.
2. Verify /health reports v7 and preflight/read responses allow both exact origins.
3. Rerun Deploy to Azure Storage on main. It backs up again, verifies staged files and APIs, promotes the root homepage, then verifies the final site.
4. Test live shared inbox, Daily Board, responder UI and final root navigation. Have the owner verify restricted Android access and A15 playback.

Do not retire the SWA backup or alter federation. Browser data on the SWA origin does not transfer automatically; use the existing app export/import tools where available.
