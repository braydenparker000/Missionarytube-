# Independent Jarvis music sources — 2026-10-02

The one-time Drive-to-R2 clone and canonical Poweramp playback cutover are complete.
All 1,287 tracks / 4,989,786,207 bytes are verified in R2. Drive and R2 retain
separate switches and track identities, with no cross-source audio fallback.
Drive originals remain intact. Recurring R2 mirroring is cancelled and removed.
Direct R2 upload/indexing is now deployed and verified end to end with a generated
test song. Muse reports its private signing-key setup complete, and its public key has
been received, validated and enabled after the owner confirmed “Yes enable.”
Deployment 36952719062 passed the live native checks and removed its temporary
test key. Muse was asked to upload Genesis; actual Muse upload remains pending.

## Current native R2 deployment and rollback

- Existing player retained; only its R2 discovery adapter changed. Exact frontend
  and Worker source: `79452a07cdc456700e0ebf8b2b5b8ca4bd589d8c`, source
  [PR 17](https://github.com/braydenparker999/jarvis/pull/17) and
  [PR 18](https://github.com/braydenparker999/jarvis/pull/18) merged. The large
  player file was retained. Source CI
  [36950379027](https://github.com/braydenparker999/jarvis/actions/runs/36950379027)
  passed 236 JavaScript / 93 Python tests.
- Deployment PRs
  [78](https://github.com/braydenparker000/Missionarytube-/pull/78) and
  [79](https://github.com/braydenparker000/Missionarytube-/pull/79) merged;
  exact deployed revision `4ce64542afcbf6c20da301c6c0fe45ab42a243f4`.
  CI [36950491009](https://github.com/braydenparker000/Missionarytube-/actions/runs/36950491009)
  passed, as did 530 deployment tests and the exact pinned build locally.
  Azure [36950583926](https://github.com/braydenparker000/Missionarytube-/actions/runs/36950583926)
  succeeded. Rollback artifact `11203458889`, `storage-before-36950583926-1`,
  ZIP SHA-256 `ae056c95771a3fb785ff0a293b8cd8df742c3dfb5692f619bcadff2deecb3e70`.
  Live `/release.json` and `/assets/r2-config.json` confirm the source pin and
  `/music/library.json`. `preserveDriveCatalog=true` remains; R2 no longer
  needs the Drive root or catalog to discover songs.
- Initial native Worker [36950677494](https://github.com/braydenparker000/Missionarytube-/actions/runs/36950677494)
  succeeded from that exact source. Final version
  `5b86f37c-a4ac-4421-9957-6b2b717d7ac3`, temporary-test version
  `dd0ef450-d1b9-442a-be96-62f3bcb9c74d`, prior version
  `8ec9ed37-4b71-48b9-82f0-c6117d1666bc`; pre-native rollback version
  `3a918cd8-74be-4197-8730-888a98657cbc` remains available. HUBS and
  MUSIC_R2=jarvis-music were checked and retained. Checkpoint artifact
  `11203851309`, ZIP SHA-256
  `aa1617303344a7631f32dd6c6f614f58b3e8cd7a266dee5e52d5e2a4092d7a3c`.
  Its initial final `MUSIC_UPLOAD_PUBLIC_KEYS=[]`; the temporary key was revoked, live
  correctly signed requests rejected with 401, and its private file deleted.
- Independent library `catalog/r2-library-v1.json` is complete, contains all
  1,287 original tracks / 4,989,786,207 bytes, and retains their existing
  `r2_<original ID>` identities and verified object proofs. Seeding used the
  complete migration report and already published metadata; no Google transfer.
  Canonical migration map `catalog/drive-r2-map-v1.json` stays separate.
  Legacy covers remain immutable Azure images; new uploads store covers in R2.
- A real signed upload of an original generated 20-second Opus song registered
  as `r2_native_76242b2175c1165a3038946d9c69ba3da862fb1a848d8b893c310e7c999df831`,
  increasing the library to 1,288. Audio SHA-256, all 518,983 bytes, full ffmpeg
  decode, Range/CORS and embedded 320×320 artwork passed. Mobile Chrome found
  the track with Drive/local/server disabled, played actual R2 audio at readyState
  4, and sought from 1.349 to 6.363 seconds while playback continued. Its cover
  rendered from the Worker. Cleanup removed only the canary and its blobs,
  retaining the baseline and returning to 1,287 tracks. No audio was transcoded
  by the upload client. This proves the native pipeline, not a Muse upload.
- Post-Azure [36950813135](https://github.com/braydenparker000/Missionarytube-/actions/runs/36950813135)
  passed actual separate-source playback, seeking and artwork, with 1,287 R2
  and 1,287 Drive tracks. R2 seeking: 2.045→24.569 seconds; separate Drive:
  2.045→24.565 seconds. Artifact `11204371427`, ZIP SHA-256
  `1cd500f50a7c434b01d116a5b11faac81651aa8e50e0682c939d090de0b0b213`.
  Three current library audio samples also passed hash/decode, GET/HEAD,
  byte/suffix Range, invalid Range, ETag, preflight and denied-origin checks.
- Earlier native attempt 36949581084 failed before Worker upload on Cloudflare
  rejection of Python urllib's default client identifier, and an immediate
  revocation probe still saw the prior edge policy. The client now uses its
  truthful `JarvisMusicUploader/1.0` name; deployment checks allow at most 60
  seconds for normal policy propagation using invalid registration that cannot
  write tracks. Later live upload and revocation checks passed. Push-triggered
  check 36950583929 rejected the old frontend pin before Azure completed;
  the authoritative post-Azure check above passed. No Google retry was made.

[Deployment and rollback evidence](r2-native-deployment-20261002.json),
[native upload proof](r2-native-proof-20261002.json),
[canary mobile proof](r2-native-browser-20261002.json),
[current protocol proof](r2-native-protocol-20261002.json),
[source isolation proof](r2-native-isolation-browser-20261002.json),
[cleanup](r2-native-cleanup-20261002.json).
Physical Android background playback and comparative startup latency remain
unverified. No recurring R2 mirror or new schedule was added.

## Previous canonical deployment and rollback

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

## Native R2 uploads and Muse — key enabled, first upload pending

Current R2 playback reads its own independent library, containing prepared tags,
duration and artwork links. The Worker verifies signed uploads and registers
finished songs into that list. New registered songs appear on refresh or the
player's five-minute check, deferred while R2 is playing. Raw files uploaded by
another tool without registration do not automatically become songs.

Muse integration status:

1. Muse reports its dedicated Ed25519 key generated and retained privately.
   Its public verification key has been received and validated; see the receipt
   below. Private persistence is Muse's report, not independently inspected here.
2. Public-key registration succeeded in Worker run 36952719062. Only Muse's
   validated public key remains allowed; no R2 account credentials were shared.
3. Muse uses the pinned `scripts/upload-music-r2.py` client on its existing
   authorized tagged Opus test file with embedded cover. Verify its actual
   registration response and live player playback/seeking with Drive disabled.
   Identical existing audio returns the existing song ID without duplication.

The endpoint/client/index/adapter and real generated-file verification are done.
Duplicate, interruption and concurrent registration handling have regression
coverage. An actual Muse upload and its persistent private-key setup are not
verified. [Client contract and private setup](https://github.com/braydenparker999/jarvis/blob/79452a07cdc456700e0ebf8b2b5b8ca4bd589d8c/docs/native-r2-uploads.md).

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
upload/indexing is not ready and never sends credentials.

Muse acknowledged it at 19:48:55 UTC in reply
`86a9b043-7a63-4ee7-a007-15e0c04a407c`, published by the verified owner (GitHub
author ID 183016859) in [issue comment 5939288453](https://github.com/braydenparker999/jarvis/issues/2#issuecomment-5939288453)
and imported/read back through the Worker inbox. Muse reports a byte-identical
local 1 MiB HTTP PUT round-trip with custom headers, working mutagen/ffprobe
metadata and embedded-cover extraction without re-encoding, and persistent private
key storage capability. It identifies the existing authorized file
“01 - Polyphia - Genesis.opus” for testing. These are Muse capability findings,
not evidence of an upload to R2.

Muse requires the owner to say inside its private app: “Generate the dedicated
signing keypair now, keep the private key stored privately in your scheduled
environment.” No Muse key has been created or provided by this check. The
limited verified upload endpoint, independent index and player integration are
now deployed and tested as described above. No fresh Muse upload
to Drive or R2 occurred during this check; no mirror or recurring task was created.
[Delivery and acknowledgment evidence](muse-r2-handoff-20261001.json).

The verified native deployment handoff `8d1ad670-e210-4dde-a415-0f7e84372e73`
was delivered and read back at 2026-10-02 01:29:01 UTC. It supplies the exact
client pin/hash and tested contract, states that Muse uploads remain disabled,
and asks Muse to prepare the client while waiting for the owner's private key
authorization. It does not authorize private key generation from the public
inbox and contains no credentials. Delivery is verified; acknowledgment was
subsequently received at 01:33:45 UTC as recorded below.
[Native Muse handoff](muse-native-r2-handoff-20261002.json).

## Muse public key enabled — deployment and rollback record

Muse acknowledged readiness in owner-authored issue comment `5943931423` at
2026-10-02 01:33:45 UTC (reply `19432169-87f7-421d-87cd-e6aa4ba1c756`).
It subsequently published only its Ed25519 SPKI PEM public key in owner-authored
[comment 5943978656](https://github.com/braydenparker999/jarvis/issues/2#issuecomment-5943978656)
at 01:38:47 UTC (publication `7644c513-70c5-4d5d-b061-cf5561c2e7c8`). The
44-byte DER SPKI prefix and 32-byte raw Ed25519 public key were validated.
No private key was requested, retrieved or stored here. Muse reports that its
private key remains in its persistent private environment.

The owner confirmed “Yes enable.” before dispatch. Manual Worker
[run 36952719062](https://github.com/braydenparker000/Missionarytube-/actions/runs/36952719062)
succeeded from exact source `79452a07cdc456700e0ebf8b2b5b8ca4bd589d8c`
and orchestration `aeafd737dd2f438f46171ab8d487cd0803616619`.
Final Worker `bb715754-9c46-400b-a76a-ac68c1bda2c1` preserves HUBS and
MUSIC_R2=jarvis-music. Its final allowlist contains only Muse's validated public
key. Temporary canary Worker `988a4700-a55f-464c-866d-8a8d79387204` was
replaced, its test key revoked, and a live correctly signed request rejected
with 401 at 01:51:19 UTC. No private credential was retrieved or printed.
Prior Worker `5b86f37c-a4ac-4421-9957-6b2b717d7ac3` is the rollback
version. Checkpoint artifact `11203749222`, `worker-checkpoint-36952719062`,
ZIP SHA-256 `813bd446387107e9aa6f8f49a88356ca77a80d7960c7d6d6c88f3af9f3cfca3f`
records the configuration and rollback; Azure source/deployment are unchanged.

The generated signed canary registered and became visible in the player with
Drive/local/server disabled. Hash/ffmpeg, Range/CORS, 320×320 artwork and actual
mobile playback/seek passed (1.442667→6.456 seconds, readyState 4, no error).
Cleanup preserved the complete 1,287-track / 4,989,786,207-byte baseline.
Three original audio samples passed current hash/decode/HTTP checks again.
This proves the deployed pipeline, not an actual Muse signature/upload.

The enabled handoff `da349bec-e40d-4529-93d9-81c0820337f8` was delivered
and read back at 2026-10-02 01:53:42 UTC. It supplies the exact client/hash,
explains that no separate key ID or R2 account binding is needed, and requests
one direct upload of Muse's existing tagged Genesis file. No Drive upload,
re-encoding, mirror or new schedule was requested. Identical Genesis bytes
should reuse stable ID `r2_1594bzGkaPidWVBMpAM5_QwpEX7AVG-t7` and keep
count 1,287. The original Genesis audio (3,445,432 bytes) was also checked
in the live player with Drive disabled: playing at readyState 4, no error,
seeking 40.032→68.143993 seconds, album art rendered. Browser source choices
were restored after QA. The full audio SHA-256/ffmpeg decode, byte Range, HEAD,
ETag and artwork hash/dimensions also passed. This is the already migrated file; Muse's upload report
and acknowledgment remain pending.

[Enabled key and rollback record](muse-r2-key-registration-20261002.json),
[signed canary upload](muse-enabled-upload-proof-20261002.json),
[mobile player proof](muse-enabled-browser-20261002.json),
[current protocol proof](muse-enabled-protocol-20261002.json),
[cleanup](muse-enabled-cleanup-20261002.json),
[enabled handoff](muse-enabled-handoff-20261002.json),
[Genesis browser proof](muse-genesis-browser-20261002.json),
[Genesis protocol proof](muse-genesis-protocol-20261002.json).

The second publication reused the first acknowledgment's replyTo; the inbox's
unique reply constraint retained the first acknowledgment. The public key was
read directly from the verified owner's GitHub publication. Subsequent Muse
responses should reply to a new handoff ID so they can be imported separately.
