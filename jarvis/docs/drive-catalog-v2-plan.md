# Poweramp Drive catalog v2

Implementation: `public/drawercast/drive-catalog.js`, `scripts/publish-drive-catalog.mjs`, and the Poweramp Drive adapter. Deployment lives in Missionarytube's `publish-drive-catalog.yml` and `deploy-azure-storage.yml`.

## Ownership

- Drive stores the audio. The existing public read API key resolves selected media by ID.
- An hourly GitHub Actions publisher lists the configured root and all nested folders. Complete reconciliation handles additions, folder moves, replacement revisions, and deletions without depending on the v1 manifest being current.
- Azure's existing static website stores the published catalog and small prepared covers. The existing Entra OIDC identity writes them; no additional OAuth credential or long-lived Azure key is needed.
- Poweramp reads the published catalog. Cold start, visibility checks, manual Refresh, and background polling make zero Drive folder-list requests. Cached songs load before the catalog check. Audio playback does not await catalog publication.

This implements the catalog contract using the available Azure identity. The earlier proposed Drive OAuth changes-feed/appDataFolder design is **not implemented**. Reconciliation runs hourly in Actions, away from the listening phone. Scheduled Actions timing is best effort; the UI displays actual publication time. Authenticated uploader-triggered publication can be added later.

## Format and publication

The stable pointer is `/assets/drive-catalog-v2.json`. It identifies a complete version 2 snapshot with root ID, content-derived generation, publication time, song count, and shard byte lengths/counts/SHA-256 hashes. Shards are at `/assets/drive-catalog-v2/g/<generation>/<index>.json`, each at most 512 KiB. An immutable pointer copy is kept in each generation directory. Previous generations are retained for rollback.

Each record contains the Drive ID, filename, folder path, MIME type, size, MD5, modification time, availability, revision-matched tags and optional content-addressed cover hash. User ratings, play counts, custom art, API keys, and audio payloads are not published. The catalog has the same public visibility as the shared library and static site.

The publisher:

1. Validates the last published snapshot when present.
2. Reads every folder/page; incompleteSearch, a failed page, or repeated pagination fails the whole run. Known non-downloadable audio remains visible as blocked.
3. Preserves prepared metadata only for the same size and MD5. The v1 prepared manifest is optional metadata input.
4. Prepares up to 250 outstanding tag/cover records per run, using the existing tested parser with bounded ranges (2 MiB/8 requests per track) and four workers. Produces 320-pixel JPEG covers with FFmpeg, addressed by SHA-256. Failed optional metadata retries after a day; never-attempted tracks come first. Filename labels remain usable immediately. V2 browser records never probe audio for tags or covers.
5. Rejects duplicate IDs, malformed paths/metadata, invalid hashes, excessive counts and oversized shards. More than 20% removal requires the explicit manual workflow input after checking sharing. This also guards against accidental empty publication.
6. Uploads immutable covers and shards, reads and verifies all shards through the public URL, then uploads the stable pointer last. A failed scan or staged upload leaves the current pointer intact. Uploading the pointer itself is one blob replacement; previous immutable generations remain available.
7. Reads the committed public pointer and shards back. Logs counts and generation only, never keys or track data.

The deployment workflow publishes and verifies a real snapshot before installing the reader. Publisher and deployment share a non-cancelling concurrency group. Catalog blobs are outside frontend `dist`; normal deployment does not delete them. Rollback backups include them.

## Browser transaction and failures

Poweramp polls the small pointer every five minutes when visible/online and on visibility changes. Checks defer during Drive playback and resume after pause. A matching generation causes no track writes or redraw. At most four shard requests run concurrently; each response is byte-bounded and validated against its hash, count, schema, root and unique IDs.

After every shard validates, one IndexedDB transaction updates Drive tracks, removes absent Drive entries, and writes the committed pointer. It resolves only on transaction completion. Memory/UI indexes change afterward. A network failure, corrupt generation, timeout, or aborted/quota-failed transaction retains the previous library. With unavailable browser storage, the existing session library stays usable, but installation of a new snapshot fails visibly rather than claiming it was saved.

Stable Drive IDs preserve ratings/play counts and playlist references across moves. Same-revision cached artwork survives. An already selected track is not forcibly stopped when removed. Local and A15 tracks are untouched. A newly created Drive ID represents a new song. The managed root is configured in `drive-config.json`; another root requires publisher enrollment.

Known limitations: public listing cannot discover private files invisible to the public reader; the publisher cannot promise to classify those files. Drive does not provide an atomic recursive listing, so a move occurring during reconciliation may settle on the next hourly run. Changes-feed replay, authenticated upload triggers, offline audio caching and notification delivery on publisher failure remain future work. Actions failures are visible in its run history.

## Verification and rollback

Automated tests cover 10,000 records, byte/hash/schema/count failures, incomplete pointers, missing shards, duplicate IDs, unchanged generations, fixed-generation reads during pointer changes, path bounds, moves/revisions, transaction completion/abort, failed browser writes, preservation of other sources, and zero browser listing calls. Existing playback recovery tests remain in place.

Operational acceptance requires a successful publication, live deployment, and playback smoke test. Real Galaxy A15 screen-lock/background behavior requires that device; a cloud browser cannot verify it.

To roll back a catalog, restore the stable pointer from a retained generation's `pointer.json` using the existing Azure identity. To roll back code, restore the deployment source pin. Do not delete the last working browser catalog during recovery.

A manifest guarantees a coherent song inventory, not uninterrupted third-party service. Playback still depends on Drive availability and the connection. Actual offline playback requires cached audio bytes; cached catalog metadata alone cannot provide it.
