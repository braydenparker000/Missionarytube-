# Independent Jarvis music sources — 2026-10-01

The one-time Drive-to-R2 clone and canonical Poweramp playback cutover are complete.
All 1,287 tracks / 4,989,786,207 bytes are verified in R2. Drive and R2 retain
separate switches and track identities, with no cross-source audio fallback.
Drive originals remain intact. Recurring R2 mirroring is cancelled and removed.
Direct Muse-to-R2 upload/indexing remains unfinished.

## Exact deployed revisions and rollback

- Frontend source remains `7a5c267831f42eda30c1ced45c1a237a986326b3`.
  The existing player was retained. Source PRs 12 and 13 remain merged.
- Deployment [PR 76](https://github.com/braydenparker000/Missionarytube-/pull/76)
  changed only `jarvis-release.json`'s `r2ManifestURL` to the existing Worker's
  `/music/manifest.json`; `preserveDriveCatalog=true` and Drive config are retained.
  Tested head: `2194bd1840da6f31c97e8f96d95fff288c00ca03`; CI
  [36913676379](https://github.com/braydenparker000/Missionarytube-/actions/runs/36913676379)
  passed. All 528 deployment tests and the pinned frontend build passed locally.
  The diff contained one URL change, no credentials or unrelated edits.
- Azure [run 36913889466](https://github.com/braydenparker000/Missionarytube-/actions/runs/36913889466)
  succeeded from deployment revision `9190ec0b58a514ba35fc16c8e0f4f8080ed595ac`.
  Rollback artifact: `11189875461`, `storage-before-36913889466-1`, ZIP SHA-256
  `6cee1776ba386babccaa66534d73a08e70da35c138d28c985fbd6c7d39805db8`.
  Live `/assets/r2-config.json` confirms the canonical URL; `/release.json`
  confirms the unchanged frontend pin. The former Azure run 36901040262,
  revision `3ee9f3c105b22d03d03b67b39666f7dd81b9ee77` and rollback artifact
  `11182080345` remain the prior partial-playback checkpoint.
- Worker remains version `3a918cd8-74be-4197-8730-888a98657cbc` from saved source
  `8647b99fdb17927b0f22ea4cdd0cbc1b7f515951`, deployed by successful
  [36870873575](https://github.com/braydenparker000/Missionarytube-/actions/runs/36870873575).
  HUBS and MUSIC_R2=jarvis-music are preserved. No Worker redeployment was needed.
  Prior Worker version: `da7b8ffc-2b1a-40c9-983d-8463ee82be1a`; checkpoint artifact
  `11167460451`.

## Completed full migration

[Run 36897596735](https://github.com/braydenparker000/Missionarytube-/actions/runs/36897596735)
succeeded using exact source `e205cc2a899b01872dec8f587dce743d343f2edc` and
orchestration `9cf3ae50fc1e8f9926baedea47c2627f7b4e098f`, `mode=copy`,
`auth_mode=oauth`, `limit=0`, concurrency 1 and five-second minimum download
spacing. Full processing started at 17:12:48 UTC; the last copy was verified
at 19:16:48 UTC. Final Drive inventory recheck and canonical publication
finished at 19:17:14 UTC. The serial pacing, transfers and full R2 read-back
verification explain the approximately 2-hour-4-minute processing time.

The report has `mode=full`, `complete=true`, `verifiedCount=1287`,
`inventoryCount=1287`, `inventoryBytes=4989786207`, `copiedCount=973`,
`skippedCount=314`, `failedCount=0`, no failures and `reusedCount=0`.
All objects, including pre-existing copies, were fully read and hashed.
The final Drive inventory stayed stable at sourceRevision
`c6285c5fe33f8cf874f775c5c561e6dd3833aa32b15730edb34a3b8729ff19ec`.
No audio was transcoded; copies preserve the original bytes.

Artifact: `11187343402`, `r2-migration-report-36897596735-1`, ZIP SHA-256
`2dd963b54f917e4c6b4dc878012f8ce100e7ed520c127afe78b2e31ead9e18fe`.
Original `r2-migration-report.json` SHA-256:
`5fad5311ac29dd9817ceb832d66ab7640ab99fb49d4127c706f6f1c63a110923`.
The exact full report also remains stored as `catalog/drive-r2-map-v1.json`
in jarvis-music. At 19:19 UTC the public canonical
[manifest](https://jarvis-hub-api.braydenparker999.workers.dev/music/manifest.json)
returned 200 and matched the report's delivery representation for every object,
including hashes, byte counts and R2 identities.
[Migration and endpoint evidence](r2-full-migration-20261001.json).

The historical 314-track partial map remains separate with `complete=false`
and 1,256,156,900 verified bytes. It is no longer selected by the live player.
The earlier public-file run 36864240781 stopped on Google's automated-query 403.
No networks were rotated or repeated requests made to evade that refusal.
The owner read-only OAuth probe 36895894543 succeeded before the completed clone.

## Actual full-library playback proof

Follow-up [run 36914057032](https://github.com/braydenparker000/Missionarytube-/actions/runs/36914057032)
passed from deployment revision `9190ec0b58a514ba35fc16c8e0f4f8080ed595ac`.
Artifact: `11189315988`, `music-sources-36914057032`, ZIP SHA-256
`7cdeb60b7d8616c82878a53196f4b350ce5957ac947aa0019c3417afaf88b160`.

- Three actual R2 audio samples matched SHA-256 and fully decoded with ffmpeg,
  including two newly copied tracks. GET/HEAD 200, byte/suffix Range 206,
  invalid Range 416, ETag 304, OPTIONS 204, CORS and denied-origin 403 passed.
  The full manifest matches the static catalog, all 1,287 tracks are mapped,
  and the canonical endpoint returns 200.
- Mobile Chrome saw separate 1,287-track R2 and 1,287-track Drive libraries.
  Turning either source off left the other source's 1,287 tracks. Both sources
  advanced actual audio with readyState 4/no media error, sought and continued
  playing, and decoded 320×320 artwork. R2 used canonical Worker audio with no
  partial route or Google fallback. R2 seek: 2.067→24.572 seconds; separate
  Drive seek: 2.064→24.567 seconds.
- Direct cloud Chrome at 19:26–19:29 UTC additionally played newly copied
  “Lost Call” by No Mana with Drive/local/server disabled. It used the full R2
  audio route, advanced to 102.124 seconds, duration 277.76, readyState 4 and no
  media error. A real gesture changed the position from 45.235 seconds to visible
  1:08; playback continued and artwork rendered. Playback was paused afterward
  and all four original source choices were restored.

Evidence: [protocol report](music-full-protocol-20261001.json),
[browser report](music-full-browser-20261001.json),
[direct cloud observation](music-full-cloud-browser-20261001.json).
Physical Android screen-lock/background and restricted-network playback remain
unverified. Comparative Drive/R2 startup latency has not been measured; the
current Worker sends `Cache-Control: private, no-store`.

## No recurring R2 mirror

The owner cancelled recurring mirroring in favor of direct Muse uploads to R2.
[PR 75](https://github.com/braydenparker000/Missionarytube-/pull/75) removed the
never-enabled mirror job at `e155536d51900a9069046ccb4d55e9b55a971954`.
No incremental transfer or recurring R2 job was enabled. The completion check
was paused after the full report, deployment and actual playback verification
passed. The existing hourly Drive-only catalog publisher remains separate.

That publisher pins source `9f65e014f578d7947b97a88fd8a32b0b2e8e693d`.
Real OAuth catalog run 36900272903 passed at 17:35 UTC with the same 1,287 songs,
no metadata candidates and unchanged catalog generation
`f96cadf5907836cfb2312214001468edbd68563f124704a4082120eb20612788`.
Its then-present mirror job was skipped. Future manual migration code pins
`dd0797bd48431ea04354f83663c3df765cc8f5b0`; source CI 36900565547 passed
229 JavaScript / 93 Python tests, including stripping OAuth headers on redirects.
The completed copy stayed on its original exact revision.

## Native R2 uploads and Muse — unfinished integration

Current R2 playback is independent, but its titles/artwork still come from the
published Drive-derived static catalog. The current read-only Worker and
migration manifest do not automatically discover arbitrary uploads.

Remaining native upload work:

1. Add authorized, limited music upload access using the existing R2 binding.
2. Verify uploaded audio/artwork, accept prepared tags/duration and register stable
   song identities in an automatically maintained independent R2 song list.
3. Change only the R2 discovery adapter to read that list, retaining the player,
   source isolation and existing ratings/playlists; initialize it from the verified
   migration and existing metadata without more Google downloads.
4. Verify an actual Muse upload appearing in the player with Drive disabled,
   including artwork, playback, seeking, duplicate and interrupted-upload handling.

The prior Muse inbox handoff `c454e4ed-50d1-47cb-8da4-1b12757c236f` was acknowledged
by reply `487c315c-7386-418a-aece-758079cc353e` at 13:03:33 UTC. Muse's last verified
configuration uploads tagged Opus with embedded covers to
`music-new/goated/<Artist>/`, root `1VlEUztloW5saoM7iF11fodDKSmCGP2ZZ`; unknown
artists use Misc. No direct R2 credential is configured and no fresh Muse upload
has been proved.

At the owner's explicit request, the fresh Muse capability update
`ed79e264-83e3-4502-a033-1e25c818eeba` was delivered at 19:47:03 UTC and read back
with matching body through the existing Jarvis Muse inbox. It reports the completed
clone/playback and cancelled mirroring, and asks Muse to check binary HTTP uploads,
prepared metadata/artwork, private signing-key persistence, an existing authorized
test file and any required private-app authorization. It states that native R2
upload/indexing is not ready and never sends credentials. The new update has no
acknowledgment or actual upload evidence yet.
[Delivery evidence](muse-r2-handoff-20261001.json).
