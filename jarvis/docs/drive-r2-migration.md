# Drive to R2 music migration

## Status and ownership

This is a **clone**, followed by a separately verified playback cutover. Do not
delete or change sharing on the Drive originals. The frontend must remain at
`https://missionarytube.z13.web.core.windows.net/drawercast/` for Android access.

- Source: the configured `goated` Drive root, under `music-new`
- Source code: `braydenparker999/jarvis`
- Orchestration and Azure deployment: `braydenparker000/Missionarytube-`
- Manual workflow: `.github/workflows/migrate-music-r2.yml`
- Migration script: `scripts/migrate-drive-to-r2.py`
- Optional playback adapter: `public/drawercast/r2-api.js`

Checkpoint, 2026-10-01: the live catalog has 1,287 tracks / 4,989,786,207
bytes, all with source MD5s. The catalog's generation and shard hashes were
verified; metadata was ready for 1,281 tracks, with 1,274 prepared covers.
Re-inventory at transfer time; these counts are a checkpoint, not hard-coded
acceptance values. The earlier 1,286-track estimate is stale.

At this checkpoint no R2 transfer has been run or playback cutover deployed.
The successful migration-named Actions run at 02:49 UTC only syntax-checked the
script; its transfer job was skipped. R2 credentials and bucket variables were
absent in the orchestration repository. Cloudflare account/bucket/subscription
state could not be inspected because its dashboard security check blocked the
cloud browser. Existing Drive playback was smoke-tested successfully.

## Setup boundary

1. Select or create a **private, Standard-storage** R2 bucket. Leave its public
   access disabled for the clone. Do not enable a new subscription or change
   billing without the owner's approval. R2 has monthly usage charges; its
   Standard free allowance is not a spending cap.
2. The owner creates a bucket-scoped **Object Read & Write** R2 S3 credential
   (prefer an appropriate expiry) and enters it directly into GitHub Actions
   secrets. Never paste credentials into chat, code, commits, or logs.
3. Required repository secrets: `GOOGLE_DRIVE_API_KEY` (already configured),
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
4. Required repository variable: `R2_BUCKET`. Optional `R2_PUBLIC_BASE_URL`
   stays unset for a private clone. No public-domain setting is needed to copy.
5. The script currently uses the default R2 jurisdiction endpoint. A bucket in
   a special jurisdiction requires explicit endpoint support before running.

Verified setup pages:

- https://github.com/braydenparker000/Missionarytube-/settings/secrets/actions
- https://github.com/braydenparker000/Missionarytube-/settings/variables/actions
- https://developers.cloudflare.com/r2/get-started/s3/
- https://developers.cloudflare.com/r2/pricing/

## Transfer gates

1. Run the source JavaScript regression suite and Python migration tests. The
   orchestration workflow must use the exact source commit validated by its
   validation job, not a second mutable `main` checkout.
2. Dispatch `Clone Drive music to Cloudflare R2` with `limit=5` and
   `concurrency=4`. Confirm all five files pass source size/hash checks and a
   complete R2 GET size/hash readback. Inspect the report; HEAD metadata alone
   is not byte-integrity proof. Smoke output cannot enable playback.
3. Dispatch the same tested revision with `limit=0`. Allow it to finish; safe
   reruns check existing content bytes rather than trusting object metadata.
4. Require `mode=full`, `complete=true`, zero failures, matching selected,
   inventory and verified counts, and exact inventory byte totals. The source
   is re-listed before canonical publication; a changed inventory fails closed.
5. Save the report and review the canonical map. A private clone has blank
   playback URLs and remains unusable by the browser until delivery is approved.

Audio keys preserve the Drive ID and content version:
`audio/<drive-id>/<md5>.<extension>`. When no Drive MD5 exists, the version uses
the downloaded content's SHA-256, not file name or modification time.
Each verified file reports MD5, SHA-256, verified byte count and
`verification: r2-get-hash-v1`. The full report carries the same marker.

## Optional incremental mirroring (prepared, not activated)

The migrator accepts `--incremental --limit 0`. This is opt-in code only:
no cron, workflow dispatch, deployment, public access, or playback setting is
changed by adding it. It does not resolve a Drive refusal or authorize another
transfer attempt. Finish the initial clone and resolve source-access blockers
before wiring recurring work.

Default runs and all smoke runs retain full R2 GET hashing. An incremental run
still recursively inventories all Drive tracks and rechecks that inventory
before publication. Its complete canonical map may reuse a prior file's original
GET-byte proof only when all of the following hold:

- The previous canonical map is complete, valid, and bound to the same Drive
  root and R2 bucket; partial reports and smoke maps cannot provide a baseline
- The Drive file still has an MD5, and its full source-metadata fingerprint is
  unchanged, including ID, checksum, size, name, folder, modification time,
  MIME type, and download availability
- The original fully hashed R2 GET recorded an ETag, last-modified timestamp,
  size, and matching Drive ID / MD5 / SHA-256 / size metadata
- A fresh HEAD matches that entire stored identity, including a version ID
  when supplied by storage; ETag and metadata are identity guards, never
  initial byte-integrity proof

The original MD5, SHA-256, byte count, `byteVerifiedAt`, and `r2Identity` remain
attached to reused records. `verification: r2-get-hash-v1` continues to describe
that underlying byte proof for compatibility with the playback adapter. The
additional `verificationCheck: prior-get-head-v1` explicitly means that this
run retained prior proof rather than rereading the audio; normal full reads use
`get-hash-v1`. Reports include `transferMode`, `baselineSha256`, and `reusedCount`.
This is an object-identity optimization, not a fresh bit-rot scan; run without
`--incremental` whenever a new full byte audit is required.

Absent/invalid canonical baselines, older records without identity evidence,
missing checksum metadata, and changed source/object identities all fall back
to the original full verification/copy path. That path first hashes an existing
R2 object, downloading Drive audio only if necessary. Missing Drive MD5s still
require a source download to establish the immutable key. R2 access errors and
unreadable/oversized canonical responses stop the run rather than masquerading
as a missing file. No object or Drive original is deleted, including older
content generations and files removed from the current Drive catalog.

Immediately before publication, the run rechecks the source inventory, the
exact original canonical bytes, and every resulting R2 identity. Results
without usable identity evidence receive another full byte verification.
A change fails closed without replacing the canonical map. Incremental
publication also uses a conditional canonical PUT tied to the baseline GET's
ETag (`IfMatch`), or `IfNoneMatch: *` if no canonical map existed. A concurrent
publisher cannot silently be overwritten after the last check. Unsupported
client/server conditional-write behavior fails closed; it never retries with
an unconditional write. Live conditional-write compatibility still needs to
be verified before activation.

Retain single-writer coordination too: every migration and mirror publisher
must share the existing `r2-music-migration` Actions concurrency group
(`cancel-in-progress: false`). This also avoids racing object repairs; the
ordinary non-incremental publisher does not use the new conditional-write gate.
Do not run a separate uncoordinated publisher against the same bucket.

### Wiring later, after separate authorization

1. Publish/review this source revision and pin the orchestration repository's
   `.github/workflows/migrate-music-r2.yml` validation checkout to that exact SHA.
   Keep the transfer checkout bound to `needs.validate.outputs.source_sha`.
2. Expand that workflow's Python test pattern from `test_r2_migration.py` to
   `test_r2*.py` so the retry and incremental guards run too.
3. After the initial clone completes and Drive access is healthy, add an
   explicit, default-off incremental dispatch option. The opted-in invocation
   is `python .jarvis-source/scripts/migrate-drive-to-r2.py --limit 0
   --concurrency 1 --incremental` with the existing credentials, bucket, and
   pacing configuration. Run it manually first and review its complete report.
   An old complete baseline is safe: the first run reads all existing R2 bytes
   once to capture identity evidence, without unnecessarily downloading Drive.
4. Only after recurring mirroring is authorized, sequence the same pinned,
   tested invocation after successful Drive catalog publication in
   `.github/workflows/publish-drive-catalog.yml`. That existing publisher runs
   hourly at minute 17; do not add a second schedule or modify Muse's uploader.
   Give the mirror job the same `r2-music-migration` concurrency group as manual
   clones, preserve the source-refusal stop behavior, and save its report.
5. Muse continues uploading into the existing Drive library. A subsequent
   successful catalog/mirror pass picks up new or changed files. Authenticated
   R2 delivery, playback cutover, the Muse runner's current health, and physical
   Android playback remain separate verification gates.

Offline checks require no SDK, credentials, or network:

```sh
python -m py_compile scripts/migrate-drive-to-r2.py
python -m unittest discover -s tests -p 'test_r2*.py' -v
npm test
```

## Independent playback sources

Google Drive and Cloudflare R2 are separate Music Sources, with separate IDs,
source switches, catalog state, ratings and playlists. Drive uses its own
`drive-config.json` and Google media URLs. R2 uses `r2-config.json`, the published
static metadata/artwork catalog and the Worker partial manifest. R2 never
requests a Drive media fallback. Only verified matching objects enter its library;
a partial map remains `complete=false` and stays separate from the full canonical
map. Uncopied tracks are available when the user enables the Drive source.

Verify each source with the other disabled: actual advancing audio, seeking,
artwork, source counts and media origin. Check GET/HEAD/Range/CORS separately.
Cloud-browser verification does not establish physical Android screen-lock or
background playback.

## Authenticated transfer preparation

The migrator supports `GOOGLE_DRIVE_AUTH_MODE=oauth`. Supply the owner-authorized
`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` and
`GOOGLE_DRIVE_REFRESH_TOKEN` only as Actions secrets. Obtain the grant using the
supported Google OAuth flow, with `https://www.googleapis.com/auth/drive.readonly`
for this reader. Refresh tokens remain server-side; bearer tokens use request
headers, never query strings or reports. Refresh is serialized and access tokens
are renewed before expiry. Missing/invalid OAuth credentials stop the run;
there is no automatic fallback to anonymous/public API-key requests.

The explicit `public_api_key` mode retains the existing public-file path for
supported diagnostics. Neither mode bypasses download restrictions or quotas.
An unclassified/refusal 403 stops downloads, and metadata 403 also stops without
repeated attempts. OAuth is a supported authenticated path, not proof that the
observed automated-query refusal has cleared. Do not resume bulk transfer until
the owner grant exists and one controlled authenticated test succeeds.

After that, use one transfer at a time, concurrency 1 and pacing. Existing R2
objects are read and hashed before skipping; Drive originals are never changed.
A full canonical baseline is published only after every file and the final Drive
inventory agree. Then run one manual incremental reconciliation and review its
report before activating recurrence. No recurring R2 mirror is enabled by this
code. Muse continues uploading to its existing Drive folders unless the owner
separately changes that intake pipeline.

References: [Google downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
and [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Rollback and continuing work

Disable Cloudflare R2 in Music Sources or clear its manifest setting and
redeploy the previous known-good release pin. Google Drive remains independent. Azure's deployment workflow preserves existing
website bytes/properties before overwrites. Keep the prior Drive catalog,
source files and R2 generations until the owner explicitly approves cleanup.

For the next maintainer, including Muse: distinguish prepared code, successful
unit tests, actual copy completion, browser playback verification and device
verification. None implies the next stage. Check current Actions runs before
starting a duplicate transfer. Never infer credentials, approval, billing or
public-sharing permission from this document.
