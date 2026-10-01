# Independent Jarvis music sources — 2026-10-01

Drive and R2 are separate Poweramp Music Sources. There is no R2-to-Drive audio
fallback or combined track identity. Each source has its own switch and library
records; turning Drive off leaves only verified R2 tracks. Drive originals are
intact. The initial combined layout in JARVIS-MUSIC-R2-STATUS.md is superseded.

## Deployed and verified playback

- Frontend exact tested source: `7a5c267831f42eda30c1ced45c1a237a986326b3`.
  Source PRs [12](https://github.com/braydenparker999/jarvis/pull/12) and
  [13](https://github.com/braydenparker999/jarvis/pull/13) are merged.
- Latest Azure [run 36901040262](https://github.com/braydenparker000/Missionarytube-/actions/runs/36901040262)
  succeeded from deployment revision `3ee9f3c105b22d03d03b67b39666f7dd81b9ee77`.
  Rollback artifact: `11182080345`, `storage-before-36901040262-1`.
  Earlier independent-source deployment 36885397506 and its rollback artifact
  `11174981167` remain historical checkpoints.
- Worker remains version `3a918cd8-74be-4197-8730-888a98657cbc` from saved source
  `8647b99fdb17927b0f22ea4cdd0cbc1b7f515951`, deployed by successful
  [run 36870873575](https://github.com/braydenparker000/Missionarytube-/actions/runs/36870873575).
  Existing HUBS functionality/binding is preserved; MUSIC_R2 binds jarvis-music.
  Prior Worker version: `da7b8ffc-2b1a-40c9-983d-8463ee82be1a`; checkpoint artifact
  `11167460451`. No backend change was required for source separation.
- R2 config points to `/music/partial/manifest.json` on the existing Worker.
  Drive config contains no R2 setting. Metadata/artwork generation stays
  `f96cadf5907836cfb2312214001468edbd68563f124704a4082120eb20612788`.
- Actual Chrome [run 36888794326](https://github.com/braydenparker000/Missionarytube-/actions/runs/36888794326)
  passed from orchestration revision `b6575c117956043602c52f426d0712f7f8a99925`.
  It checked the live source pin, separate source rows, 314 R2 tracks with Drive
  disabled and 1,287 Drive tracks with R2 disabled. Both sources played actual
  advancing audio, sought and continued playing, and decoded the applied Azure
  artwork. Report and screenshots are linked below; artifact `11175322826`.
- Existing Worker GET/HEAD/206 Range/suffix/416/304/CORS and full audio hash/decode
  evidence is retained in [the initial checkpoint](JARVIS-MUSIC-R2-STATUS.md).
  Those checks predate source separation; the Worker revision is unchanged.
- Physical Android screen-lock/background and restricted-network behavior have
  not been verified by this Chrome run.

Evidence: [browser report](music-sources-browser-20261001.json),
[R2 playing](poweramp-independent-r2-20261001.png),
[Drive playing](poweramp-independent-drive-20261001.png),
[source switches](poweramp-separate-sources-20261001.png),
[initial isolation check](music-source-isolation-20261001.json).

## Authenticated transfer — active checkpoint at 17:50 UTC

The owner configured the supported read-only OAuth grant in Actions. Probe
[run 36895894543](https://github.com/braydenparker000/Missionarytube-/actions/runs/36895894543)
succeeded: one 4,046,954-byte Drive audio file was downloaded and hashed, with no
R2 writes. Its [sanitized report](drive-oauth-probe-20261001.json) has
`authMode=oauth`, `mode=drive-only-probe`, `complete=false`, `r2Written=false`.
The complete inventory remains 1,287 tracks / 4,989,786,207 bytes.

Full copy [run 36897596735](https://github.com/braydenparker000/Missionarytube-/actions/runs/36897596735)
was dispatched at 17:11 UTC and is **in progress**, not complete. It runs exact
source `e205cc2a899b01872dec8f587dce743d343f2edc` from orchestration
`9cf3ae50fc1e8f9926baedea47c2627f7b4e098f`, with `auth_mode=oauth`, `mode=copy`,
`limit=0`, concurrency 1 and at least five seconds between new Drive downloads.
At 17:50 UTC its visible log showed `Progress 600/1287 · copied=286 skipped=314
failed=0`. Existing objects were re-read and hashed before skipping. This is a
progress count, not a completed report or a published 600-track player catalog.
687 tracks remain after that checkpoint. Do not start another transfer while this
run is active. Its final report, exact byte totals and stable final inventory
must be inspected before claiming completion.

The live player still uses the earlier, separately published 314-track partial
map (`complete=false`, 1,256,156,900 verified bytes). The full canonical map stays
separate and is not selected in `jarvis-release.json`. The former public-file
run 36864240781 stopped after 44 new copies on Google's automated-query 403;
no networks were rotated or repeated requests made to evade that refusal.
The supported owner grant passed its real probe before this full copy began.

## Publisher, verification and gated mirroring

- Source [PR 15](https://github.com/braydenparker999/jarvis/pull/15) is merged.
  Exact tested OAuth publisher: `9f65e014f578d7947b97a88fd8a32b0b2e8e693d`.
  Source CI [36899589088](https://github.com/braydenparker999/jarvis/actions/runs/36899589088)
  passed 229 JavaScript / 92 migration tests. Tokens refresh server-side, stay
  scoped to Drive, cannot follow redirects, and never enter player configuration.
  Grant failure or Drive refusal stops publication without public-key fallback.
- Deployment [PR 72](https://github.com/braydenparker000/Missionarytube-/pull/72)
  merged at `484b20b11c511d3535cf2827d07633d2e51bf501`.
  Real OAuth catalog [run 36900272903](https://github.com/braydenparker000/Missionarytube-/actions/runs/36900272903)
  passed at 17:35 UTC: all 1,287 songs listed, no changed metadata candidates,
  existing catalog generation unchanged. Its mirror job was **skipped**.
  This verifies OAuth inventory access, not a fresh Muse upload or new artwork preparation.
- Source [PR 16](https://github.com/braydenparker999/jarvis/pull/16) is merged.
  Future transfer/mirror code pins `dd0797bd48431ea04354f83663c3df765cc8f5b0`;
  source CI [36900565547](https://github.com/braydenparker999/jarvis/actions/runs/36900565547)
  passed 229 JavaScript / 93 migration tests. urllib's real redirect handler
  confirms owner authorization is omitted on same-host and cross-host redirects.
  No credential exposure was observed. The active clone remains on its original revision.
- Deployment [PR 73](https://github.com/braydenparker000/Missionarytube-/pull/73)
  merged at `3ee9f3c105b22d03d03b67b39666f7dd81b9ee77`. All 528 deployment tests
  and the unchanged pinned frontend build passed. Azure
  [run 36901040262](https://github.com/braydenparker000/Missionarytube-/actions/runs/36901040262)
  passed, preserving source `7a5c267831f42eda30c1ced45c1a237a986326b3` and partial
  R2 configuration. Rollback artifact: `11182080345`, `storage-before-36901040262-1`.
  The Worker's deployed revision and HUBS binding remain unchanged.
- Direct cloud Chrome at 17:41–17:47 UTC confirmed separate 1,287-song Drive and
  314-song R2 rows. With only R2 enabled, actual Worker audio advanced to 49.67 s
  (duration 224.08 s, readyState 4, no media error), then a real seek continued at
  114.31 s. With only Drive enabled, Google audio advanced to 52.13 s (duration
  284.32 s, readyState 4, no media error), then a seek continued at 97.05 s.
  Artwork rendered for both. Playback was paused afterward and all four original
  source choices were restored. [R2 source isolation](poweramp-cloud-r2-isolation-20261001.png),
  [R2 playing](poweramp-cloud-r2-playing-20261001.png),
  [Drive playing](poweramp-cloud-drive-playing-20261001.png),
  [restored source rows](poweramp-cloud-sources-20261001.png).
- Fresh automated protocol/browser [run 36901040002](https://github.com/braydenparker000/Missionarytube-/actions/runs/36901040002)
  **passed** at 17:49 UTC from orchestration `3ee9f3c105b22d03d03b67b39666f7dd81b9ee77`.
  Artifact `11181882979` contains [protocol evidence](music-protocol-after-oauth-20261001.json)
  and [browser evidence](music-browser-after-oauth-20261001.json). All three audio
  samples matched SHA-256 and decoded; GET/HEAD 200, byte/suffix Range 206,
  invalid Range 416, ETag 304, OPTIONS 204 and CORS passed. Both independent
  sources advanced audio, sought and decoded 320×320 artwork. The canonical
  endpoint still returned 503, accurately reflecting the incomplete clone.
  Package installation consumed most of this run; the timeout is extended
  to 25 minutes for subsequent checks, and per-sample verification now reports
  progress without request details.
- A single incremental mirror is prepared after the existing hourly catalog
  publication. Its `MUSIC_R2_MIRROR_ENABLED` gate is **not enabled**. It requires
  a valid complete canonical baseline and shares `r2-music-migration` serialization
  with manual transfers. Azure publication keeps its separate deployment lock.
  No recurring R2 transfer is active; no direct Muse R2 credential is configured.
- A finite hourly completion check was created to continue the already authorized
  work after this long-running clone ends. It must inspect the final report,
  perform the canonical cutover and live checks, prove a manual incremental run,
  and only then enable the existing mirror. It must stop/report a Google refusal
  without another automatic transfer. Creation of the check does not prove those
  remaining actions have occurred.

Remaining acceptance steps:

1. Inspect the full copy's actual final artifact, require `complete=true`, no
   failures and all matching bytes/identities plus a stable final Drive inventory.
2. Verify `/music/manifest.json`, then update only `r2ManifestURL` to that canonical
   endpoint, deploy Azure with a rollback artifact, and pass actual protocol and
   browser playback checks. Retain separate Drive/R2 sources and the historical partial map.
3. Run `mode=incremental`, `auth_mode=oauth`, `limit=0`, concurrency 1 manually.
   Inspect its baseline binding, reused byte proof, current identities, complete
   report and successful conditional canonical PUT. Do not enable recurrence merely
   because the full clone passed.
4. Set the nonsecret `MUSIC_R2_MIRROR_ENABLED=true` only after those checks; run the
   existing catalog workflow once and inspect both publication and mirror evidence.
5. Verify one actual requested Muse upload by its new Drive ID, published metadata/
   artwork, Drive playback, then its verified mirror and separate R2 playback.
   Physical Android screen-lock/background playback also remains unverified.

## Muse intake

A fresh complete inbox read at 15:48 UTC confirmed the handoff message
`c454e4ed-50d1-47cb-8da4-1b12757c236f` was acknowledged by reply
`487c315c-7386-418a-aece-758079cc353e` at 13:03:33 UTC. Muse stated that natural
music requests still produce tagged Opus files with embedded cover art in
`music-new/goated/<Artist>/`, with unknown artists in Misc. It has no direct R2
upload configured and does not perform in-place metadata updates. No new message
was sent to Muse during this work.

The existing catalog publication is scheduled at minute 17 hourly. Scheduled
[run 36892100230](https://github.com/braydenparker000/Missionarytube-/actions/runs/36892100230)
succeeded at 16:27 UTC; the newer manual OAuth run is recorded above. Observed run times are delayed, so the configured cadence
is not a guaranteed hourly delivery time. Acknowledgment and an earlier catalog
run do not prove a fresh Muse upload, its current runner health or a new track's
visibility. Verify one requested upload by its actual Drive file ID, then its
published catalog entry, then playback in Drive. After mirroring is enabled,
verify that new track separately in the R2 source. The existing Muse account must
show the actual scheduled task/run; this repository cannot verify it alone.
