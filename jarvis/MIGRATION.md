# Jarvis hosting migration — 2026-09-20

> **Superseded (2026-09-22):** the Static Web App below no longer works. The live frontend is the Azure Storage static website https://missionarytube.z13.web.core.windows.net/, which is also the only origin the Worker accepts. This document is kept as a historical record.

## Destination

https://gray-meadow-09216fd10.1.azurestaticapps.net/

Azure resource `jarvis` in `jarvis_group`; SKU **Free**, verified in Azure portal on 2026-09-20. No hosting-plan change, Functions deployment, Front Door, new storage account, or paid resource is part of this migration.

Free Static Web Apps includes 250 MB per environment and 100 GB monthly bandwidth; paid bandwidth overage is not available on Free. Exceeding a limit can interrupt service. This is not a guarantee about other resources or the entire subscription bill.

Sources: https://learn.microsoft.com/en-us/azure/static-web-apps/quotas and https://learn.microsoft.com/en-us/azure/static-web-apps/plans

## Routes

- `/`: approved charcoal/amber launcher, search and favorites.
- `/jarvis/`: existing shared messages, composer, outbox and replies.
- `/daily-board/`: existing assistant-published briefings.
- `/drawercast/`: existing Poweramp-style DrawerCast, from `missionify.z13.web.core.windows.net`; executable script extracted into player.js, with a Jarvis Home action added to settings. Music stays on the A15/server.
- `/media/`: existing Astra 0.33.1 from `missionarytube.z13.web.core.windows.net`; playback libraries and optional local decoders migrated, with Home links added. Catalogs and streams remain external.
- `/portal/`: existing Ianua HTML library from `ianuaportal7.z13.web.core.windows.net`, with a Home link and sandbox isolation for opened documents. Imported documents cannot read the hub's browser storage. Documents requiring same-origin persistent storage may need their own dedicated host.
- `/notes/`: browser-local note with export; not cloud synchronized.
- `/tools/`: isolated HTML preview and link to Ianua.
- `/server/`: messaging diagnostics, manual refresh and player link.
- `/favorites/`, `/settings/`: working hub preferences, stored in this browser.

Quick AI is available at `/quick-ai/`, using direct browser requests to Groq with GPT-OSS 120B and streaming replies. The `GROQ_API_KEY` Actions secret is injected into the deployed frontend by `scripts/configure-quick-ai.mjs`. The key is kept out of repository history and logs. Its public frontend availability is intentional and owner-authorized; no per-device key entry or new backend is needed. Conversations and drafts stay in each browser's local storage. Groq usage limits apply; the UI supports Stop and Retry without automatic retries. Authenticated Drive browsing and hourly assistant checks remain deferred to a separate chat.

## Existing storage resources

All three accounts are in `Ianuarg` under subscription `61f23d55-c891-4a55-a545-c87d58747851`:

| Account | Existing website | Observed size |
|---|---|---|
| missionify | DrawerCast | 1.12 MiB; one index.html |
| missionarytube | Astra | 16.32 MiB; 120 blobs reported |
| ianuaportal7 | Ianua | 51.04 KiB; one index.html |

Each account also lists a `$logs` container and five empty tables in the portal metrics. Metrics may lag. Production app dependencies were copied; this is not a complete archival backup of every legacy test fixture, image, log or table. No account or data was deleted.

## Moving browser data

A different hostname has separate browser storage. Existing Jarvis messages stay in Cloudflare and are unaffected. DrawerCast settings, Astra add-ons/history and Ianua files saved on the old domains do not automatically move.

Before retiring old accounts:
1. On the phone, export DrawerCast settings and Astra's Private backup; export any Ianua library files you want to keep.
2. Import those on the new routes. DrawerCast may require pairing again with the A15 server and the browser's local-network permission for this hostname.
3. Verify actual music/video playback on the restricted phone. Cloud-browser UI checks cannot verify its local server connection.
4. Back up remaining storage contents if needed, then explicitly confirm deletion of the three named storage accounts. Permanent deletion removes the old URLs and their contents; browser-use policy requires confirmation at that action.

Disabling static website hosting alone does not eliminate charges for retained blobs. Existing storage resources can still incur charges until retired. No blanket promise of a zero Azure bill is made while they remain.

## Preservation and rollback

The pre-redesign GitHub main revision is `7dc124b94dd1b81a0e9bee9802e9020be28a46fd`. The backend, publication issue and Cloudflare deployment are unchanged. All 25 existing regression tests passed before frontend deployment. New module scripts load only on their own pages; no Azure media proxy is introduced.

## Live verification

Release `8aded44f5eda600c7f97aa345ce9ab2c2ca48024` deployed successfully in GitHub Actions run `35493448832`. Verified the live dark launcher, search, favorites save, message/reply history, composer draft persistence, Daily Board, DrawerCast startup/settings/Home action, Astra catalog loading, HTML preview and sandboxed Ianua document rendering. No app console errors observed during these checks. Actual A15 playback and restricted-phone behavior still require device verification.
