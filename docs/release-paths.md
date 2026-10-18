# Component release paths

This extends the [historical component inventory](release-inventory.md) with the current source-to-build-to-publisher map and its live-evidence limits. Reviewed against main `35ea3d8766ea6412a712f46bd180e6ac9e69d61b` on 2026-10-17. It is documentation only, is not consumed by a publisher, and authorizes no deployment or retirement. It separates maintained source identity, produced artifact identity and provider readback; successful CI is not live evidence.

## Current component map

The source repository is `braydenparker000/Missionarytube-` (ID `1350047370`).
Root `npm run build` packages a 194-file static candidate from the destination-
owned c28 snapshot plus exact component overlays. The source maps below define
the build inputs; they do not imply that a main push uploaded those bytes.
`.github/workflows/deploy-azure-storage.yml` accepts manual dispatch for
production publication. The general upload path saves a `$web` rollback
snapshot before overwrite; its specialized modes and publishers have separate
gates.

| Shipped surface | Maintained source and dependency closure | Build, publisher and rollback | Latest live evidence |
|---|---|---|---|
| Shared shell and baseline routes: `/`, `/drawercast/`, `/favorites/`, `/guitar/`, `/jarvis/`, `/mast/`, `/muse/`, `/notes/`, `/server/`, `/settings/`, `/tools/`, plus shared `/assets/*` | `jarvis-active-public-c28/public` at destination commit `de5d7177a778f4bfa2aa071ab064a8a4fb9b2246`, tree `67a47e36414a8ceb4040c9454f64ed1982a9146c`, byte/mode identical to the former c28 public tree. It owns current shared assets and the retained Relay/Mast/Muse behavior. The changed `assets`, Drawercast, Guitar, Mast/Muse and config variants under `jarvis/public` remain dormant. See the [active-source identity](../jarvis-activePublic-source.json) and [source import record](jarvis-source-import.md). | `scripts/build.mjs` resolves the exact snapshot, overlays only manifest-pinned routes below, and emits `dist/release.json`. The normal Azure path retains the full prewrite `$web` artifact; use the exact selected workflow mode for rollback. | Run [39034316137](https://github.com/braydenparker000/Missionarytube-/actions/runs/39034316137) compared all 193 app files against the current candidate: 171 matched candidate hashes and 22 were deliberately retained at existing hashes. It published only `release.json` and `release-component-provenance.json`, not app files. The 22 include separately owned private/shared, Drawercast, Guitar and configured-key files. Four routes (`/`, `/mymedia/`, `/podcasts/`, `/reader/`) returned HTTP 200. No all-route browser smoke is established by this readback. |
| Exact destination route overlays: `/media/`, `/daily-board/`, `/connect/`, `/content/`, `/portal/`, `/quick-ai/`, `/reader/`, `/respond/` | Exact identities are in [media](../jarvis-media-source.json), [Daily Board](../jarvis-dailyBoard-source.json), [Connect](../jarvis-connect-source.json) and [route/data](../jarvis-routeData-source.json) manifests. Shared `/assets/*` dependencies remain on the active c28 snapshot except separately pinned files. The resolver checks route trees and their transitive local runtime dependencies. | Same static build and Azure `$web` publisher as the shell. The route/data overlay covers `content`, `portal`, `quick-ai`, `reader`, `respond`; dependencies and equivalence evidence are in [the import record](jarvis-source-import.md). The Azure prewrite artifact is the rollback for a full upload. The in-review media-only mode targets the two files documented in the source import record and preserves all other blobs. | The run 390343 candidate/live hash comparison above includes these paths. It proves bytes, not route behavior beyond the four HTTP checks. PR226/227/225 source cutovers and current exact identities are recorded in their manifests; their merges alone are not deployment evidence. PR247's media source merge is also not evidence of a live change; the scoped publisher has not run. |
| Bundled apps: `/mymedia/`, `/podcasts/`, `/youtube-archive/` | Exact destination trees are grouped in [the app-bundle manifest](../jarvis-appBundles-source.json). Local runtime dependencies (My Media UI/Drive/pip/shell assets, Podcasts config/styles, YouTube Archive pages/styles) are included in the checked closure. | Same static build and Azure `$web` publisher; full prewrite artifact is rollback. | Run 390343 hash-compared these artifacts to live and checked `/mymedia/` and `/podcasts/` over HTTP. The inherited R2/Drive data sources are separate rows below. |
| Private workspace and board UI: `/private/`, private `/muse/`, and its 63-path dependency closure | [`private-board-pins.json`](../scripts/private-board-pins.json) identifies the static source and prior Worker receipt; `release-inventory.json` records 18 published assets plus 45 dependencies as a 2026-10-16 observation. The tree is separate from the c28 public snapshot. | `publish-private-board.yml` publishes the frontend only after exact source proof and Worker read checks. Its Worker pin is version `484ad36b-1d9f-4679-ad1c-40fb47c99dd9` / code SHA `642af598…` and is stale after the later publications-import Worker update; the identity gate needs a reviewed fresh receipt before another publish. `publish-private-workspace.yml` is a distinct combined Worker/static publisher; its existence is not proof it owns the current receipt. See [private-workspace release notes](PRIVATE-WORKSPACE-RELEASE.md). | Run 390343 verified the private receipt and 63-path closure before the Worker update; the importer run did not change those UI files. This is byte/readback evidence, not a fresh private-browser acceptance. |
| Daily Board public cache helper: `/assets/public-reader-cache.js` | Candidate comes from the pinned publications-import inputs; the importer workflow reproduces both the exact Worker and cache bytes before provider access. The active helper is separately pinned from the broader c28 snapshot. | `publish-publications-import.yml` publishes only this asset and the existing Worker, after capturing and validating both rollback files. [Successful run 39040982427](https://github.com/braydenparker000/Missionarytube-/actions/runs/39040982427) owns the rollback artifact. | Direct readback after run 39040982427: 10,193 bytes, SHA-256 `a61ad5a113bf1fb1e048d2dd1d8a3b99a7acc132ac3723161fefa6f419672b95`, ETag `0x8DF2C5B31306AD8`. This supersedes the earlier baseline hash in the historical inventory. |
| Jarvis API, Relay, publication reader and private-collaboration runtime: Cloudflare Worker `jarvis-hub-api` | Published candidate uses source commit `62ac633f367250ed21b3ecf7a4627263e9e07d9f` plus the reviewed destination `jarvis/backend/publications.js` importer overlay. Locked direct esbuild 0.25.10 reproduces the exact bundle; do not substitute Wrangler dry-run bytes. Other endpoint behavior, bindings and live settings are independently owned. | The importer workflow is the latest exact Worker publisher/readback; general, music and private-workspace workflows have separate policies and rollback gates. Run 39040982427 saved prewrite Worker bytes and verified postwrite identity. Its rollback path is the run's `publications-import-rollback-39040982427` artifact and the guarded rollback job. | Active version `538dbdc1-59fa-49a1-a746-cdebff8b4fb5`, deployed 100%, bundle 661,389 bytes, SHA-256 `74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d`. The same readback confirmed unchanged settings, bindings and schedules (22 bindings; schedule digest `6daa9ec137a94fc5962f6d05ab16df8dba70096ae34571ccd552ac130cd733c5`). Destination issue #250 has been created; this inventory predates enabling its reader variables. The reader activation workflow verifies the exact source configuration separately. This run did not execute the music live-playback verifier. |
| Poweramp catalog and music delivery: `/drawercast/`, `/podcasts/`, catalog shards, Cloudflare R2 partial map and audio Worker endpoints | UI/source is in the active static tree. `publish-drive-catalog.yml` checks out exact publisher source `9f65e014f578d7947b97a88fd8a32b0b2e8e693d`; it publishes immutable shards and advances the pointer only after public-read verification. `deploy-music-worker.yml` requires an exact source SHA and explicit `confirm_public_music`; `migrate-music-r2.yml` separately controls Drive reads/copies. | Catalog writes are hourly at minute 17 with before/after reconciliation; existing pointer/generation records provide data rollback. Music Worker uses the existing Cloudflare version checkpoint. R2 transfer is separate, manually dispatched, bounded and not an automatic mirror. See [music source status](JARVIS-MUSIC-SOURCES-STATUS.md) and [R2 migration status](JARVIS-MUSIC-R2-STATUS.md). | Post-importer live verifier [39041729420](https://github.com/braydenparker000/Missionarytube-/actions/runs/39041729420) passed R2 bytes, Range/CORS and independent playback/seeking/artwork. The recorded R2 clone was partial (314 of 1,287 tracks in the 2026-10-01 report); the full map was unpublished and the current song count/generation has no fresh readback in this map. |
| Daily Board comment feed and scheduled external writer | Legacy source remains open at [`braydenparker999/jarvis#2`](https://github.com/braydenparker999/jarvis/issues/2). Dedicated destination [`Missionarytube-#250`](https://github.com/braydenparker000/Missionarytube-/issues/250) was created for the additive per-source reader. External automation “Publish Jarvis Daily Board” (`6ac854579d1481918af16682c5b5936c`) still targets the legacy issue; `jarvis_publish_briefing` remains a separate writer to the Worker board API. | The manual [reader cutover workflow](../.github/workflows/daily-board-reader-cutover.yml) offers read-only identity inspection and public-reader verification plus exact issue #250 enablement. Enable mode captures Worker rollback bytes, changes only the two destination variables, retains the existing bundle and schedules, then reads the live public state. Rollback removes both variables and restores the legacy-only reader. | Issue creation and reader enablement are separate from the publisher switch. Preserve the automation's timing and briefing instructions; after reader verification, change only its issue destination to Missionarytube-#250. Keep the legacy issue and comments open for rollback. |

The remaining specialized publishers are also owned in this repository but are
not wholesale part of the base static build: `publish-drive-catalog.yml`,
`publish-makima-cookie.yml`, `publish-muse-key.yml`, the `publish_mobile_file_save`,
`publish_simple_chat_tasks`, `publish_owner_progress`,
`publish_muse_relay_design`, `publish_poweramp_playlists`,
`publish_muse_launcher`, `publish_poweramp_background`, `deploy_mast_chat_only`,
`deploy_private_wake` and Lucy/Muse activation/recovery modes in the Azure
workflow. Their exact source/receipt/rollback details remain in the linked
per-release dossiers, not in `release-inventory.json`. These separate modes
must be checked against their own exact receipt before any claim that a route,
feature flag or Worker is current.

## Coverage gaps in the current map

1. **Functional route smoke:** run 390343 gives file-hash comparison for the
   current 194-file candidate and HTTP 200 for four routes, but no current
   browser smoke for all 21 folder routes or `/private/`.
2. **Specialized overlay live matrix:** exact live receipts are not gathered
   into one current index for the scoped Azure modes, Makima repair, Muse key,
   private wake, owner/Mast and Poweramp overlays listed above. The private
   frontend publisher's Worker pin also needs reconciliation after the
   publications-import update. Their own source dossiers and workflow
   artifacts remain authoritative.
3. **Music/catalog freshness:** the latest live playback check passed after
   the publications overlay, but the current Drive catalog/R2 object count and
   generation were not read again here. The R2 migration remains recorded as
   partial; no recurring mirror is active.
4. **External publication and egress:** the Daily Board writer still depends on
   the original repository issue pending owner approval. The Vercel/Azure
   webhook egress code shows an intended transport path, not current
   end-to-end delivery.
5. **Physical-device acceptance:** current physical Android, Files/share-sheet,
   USB DAC, Bluetooth and background playback checks are absent from these
   provider receipts; the feature-specific dossiers state their individual
   limits.

The historical [`release-inventory.json`](../release-inventory.json) remains a
limited 2026-10-16 private-frontend/Worker snapshot; do not reinterpret it as
the full live-site manifest. The latest general source qualification on main
is run [39041649207](https://github.com/braydenparker000/Missionarytube-/actions/runs/39041649207),
but that is CI only. No production deployment was dispatched for this map.

## Binding provenance

The [general Azure workflow](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L129-L169) runs `prepare-music-worker.mjs` when the pinned release enables the podcast Worker path. It prepares a generated music configuration. The actual Worker upload additionally requires non-receipt-only mode and the identity gate's `deploy == true` result; only that upload uses `backend/wrangler.music.generated.json`. Preparation alone does not imply an upload.

The [private-workspace workflow](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/publish-private-workspace.yml#L61-L72) invokes the collaboration publisher separately from its static publication. The [collaboration publisher](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/publish-private-collaboration.mjs#L21-L28) preserves existing bindings using `keep_bindings` derived from validated live binding types, restricted to plain text, secret text, Durable Object namespaces and R2 buckets. It sends no replacement binding values, migrations, triggers or activation settings.

Its [line-11 import](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/publish-private-collaboration.mjs#L9-L13) includes `readWorkerSettings` and `checkedBindings` from the binding-check helper. This is a read/check dependency, not a generated-config path: the collaboration script contains neither `prepare-music-worker.mjs` nor `wrangler.music.generated.json`.

[Before and after guards](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/publish-private-collaboration.mjs#L53-L72) compare the complete observed identity, check the pinned settings digest, verify uploaded code, and assert unchanged settings and schedules. A matching bundle is reused rather than uploaded again. This path can preserve `MUSIC_R2` if already live; it does not create that binding. These historical pinned publishers are not interchangeable with the newer private-board frontend-only publisher.

## Trigger and deployment gates

- A matching main-branch push to [the general workflow](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L62-L94) starts qualification. Production upload jobs require manual `workflow_dispatch`; a workflow name containing “Deploy” is not evidence of deployment.
- Manual dispatch is necessary but not sufficient. The general deploy job requires main, `AZURE_DEPLOY_ENABLED == 'true'`, qualification success and the complete input exclusions in its [job condition](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L88-L96). Individual specialized jobs have their own input conditions. Selecting a specialized operation can skip general qualification/deployment in favor of that operation's guarded path; do not summarize all manual dispatches as “qualification plus deploy.”
- Within the general job, receipt-only reconciliation, enabled components and identity checks further determine whether a Worker is uploaded. Use the exact selected job and step conditions, not merely the event type.
- The verified music Worker workflow is manual-dispatch-only. No dispatch is part of documenting these paths.

## Egress route and preservation boundary

The pinned source [configuration](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/backend/wrangler.jsonc#L7-L10) names a Vercel egress URL. [webhookTransport](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/backend/relay-events.js#L238-L256) returns null without both URL and token, otherwise POSTs through that endpoint; the [alarm caller](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/backend/worker.js#L142-L148) passes the transport to the outbox drain. This supports an intended route, not an end-to-end delivery claim. An HTTP 405 from a GET would only show an answering endpoint, not successful webhook delivery; no new live probe was needed for this document.

The Azure egress path is a retirement candidate requiring caller and rollback review, not proven unused or approved for removal. Shared dependencies must stay: [the egress tests](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/tests/relay-egress.test.js#L7-L15) import the shared pinned-HTTPS module, re-export and server, and also directly require the Azure adapter. Even deleting the Azure adapter alone would require an explicit test/coverage disposition.

The [packager](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/scripts/package-relay-egress.mjs#L5-L18) supports Azure, Vercel and Netlify; its non-Azure branch still copies the shared module from `relay-egress/api/shared/`. A future narrowly scoped retirement could assess the Azure workflow, provider-specific artifacts and Azure packaging branch, but cannot wholesale remove `relay-egress/` or the shared packaging script. Preserve the Vercel package and shared modules until callers and equivalent coverage are accounted for.

## Dependency counts

The private frontend inventory contains **18 published files plus 45 preserved dependencies, 63 paths total**, with no overlap. Of the preserved dependencies, 42 are under `assets/`; the other three are `mast/index.html`, `private/lucy.html` and `private/mast.html`. This is a component closure, not the whole site's file count. Existing inventory validation remains read-only and does not establish fresh live-state proof.
