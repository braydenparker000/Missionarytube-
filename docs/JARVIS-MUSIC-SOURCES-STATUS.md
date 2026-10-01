# Independent Jarvis music sources — 2026-10-01

Drive and R2 are separate Poweramp Music Sources. There is no R2-to-Drive audio
fallback or combined track identity. Each source has its own switch and library
records; turning Drive off leaves only verified R2 tracks. Drive originals are
intact. The initial combined layout in JARVIS-MUSIC-R2-STATUS.md is superseded.

## Deployed and verified

- Frontend exact tested source: `7a5c267831f42eda30c1ced45c1a237a986326b3`.
  Source PRs [12](https://github.com/braydenparker999/jarvis/pull/12) and
  [13](https://github.com/braydenparker999/jarvis/pull/13) are merged.
- Azure [run 36885397506](https://github.com/braydenparker000/Missionarytube-/actions/runs/36885397506)
  succeeded from deployment revision `4ee713effbec1d6d1ac09c00b3cec28130a66426`.
  Rollback artifact: `11174981167`, `storage-before-36885397506-1`.
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

## Remaining transfer and authenticated preparation

314 of 1,287 tracks are byte-verified in R2: 1,256,156,900 of 4,989,786,207 bytes.
973 tracks / 3,733,629,307 bytes remain. Latest actual transfer is still
[run 36864240781](https://github.com/braydenparker000/Missionarytube-/actions/runs/36864240781),
which stopped after 44 new copies when Google returned its automated-query 403.
Its report and the published partial map remain `complete=false`; the full
canonical map stays separate. No further bulk run was dispatched and no recurring
R2 mirror is active. Networks were not rotated and the refusal was not retried.

[Source PR 14](https://github.com/braydenparker999/jarvis/pull/14) merged authenticated
Drive reading. Exact tested transfer source is
`e205cc2a899b01872dec8f587dce743d343f2edc`; source CI
[36888528695](https://github.com/braydenparker999/jarvis/actions/runs/36888528695)
passed 223 JavaScript and 92 Python tests. Deployment
[PR 70](https://github.com/braydenparker000/Missionarytube-/pull/70) pins that source.
Orchestration [run 36888794159](https://github.com/braydenparker000/Missionarytube-/actions/runs/36888794159)
passed integrity validation; its transfer job was **skipped**. This is preparation,
not a successful authenticated download or additional migration progress.

The manual workflow defaults to `auth_mode=oauth`, `mode=probe`, concurrency 1.
The probe reads/hashes one Drive audio file and writes no R2 object. Actual copy
and incremental modes require an explicit manual selection. Copy runs pace new
media requests by at least five seconds, re-read/hash existing R2 bytes before
skipping, and preserve Drive originals. OAuth tokens refresh server-side and use
bearer headers; missing/failed grants stop without public-key fallback. Refusal
403s pause, including metadata failures. No credentials were retrieved or printed.

Next steps:

1. Complete the owner's supported Google OAuth consent flow using the existing
   Google Cloud project with Drive API enabled. Request read-only file-content
   access (`https://www.googleapis.com/auth/drive.readonly`) and offline access.
   Store `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and
   `GOOGLE_DRIVE_REFRESH_TOKEN` only in the deployment repository's
   [Actions secrets](https://github.com/braydenparker000/Missionarytube-/settings/secrets/actions).
   Do not paste values into chat or commits. This grant is not configured or
   verified in this checkpoint, and authentication does not establish that
   Google's refusal or quotas have cleared.
2. Run one authenticated `mode=probe` and inspect its real report. Stop if Google
   refuses. A successful phone/browser download does not verify the Actions path.
3. After access is verified, resume `mode=copy`, `limit=0`, concurrency 1. Require
   every byte/identity check and a stable final inventory before publishing a
   complete canonical baseline. Refresh the verified R2 source map afterward.
4. Run one manual incremental reconciliation, review its complete report and
   conditional publication compatibility, then activate a single recurring mirror
   after the existing catalog publisher. Preserve the shared single-writer group.
   No second schedule or direct Muse R2 credential is needed for this path.

Official references: [Drive downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[offline OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#offline).

## Muse intake

A fresh complete inbox read at 15:48 UTC confirmed the handoff message
`c454e4ed-50d1-47cb-8da4-1b12757c236f` was acknowledged by reply
`487c315c-7386-418a-aece-758079cc353e` at 13:03:33 UTC. Muse stated that natural
music requests still produce tagged Opus files with embedded cover art in
`music-new/goated/<Artist>/`, with unknown artists in Misc. It has no direct R2
upload configured and does not perform in-place metadata updates. No new message
was sent to Muse during this work.

The existing catalog publication is scheduled at minute 17 hourly; its latest
observed scheduled [run 36839540646](https://github.com/braydenparker000/Missionarytube-/actions/runs/36839540646)
succeeded at 08:56 UTC. Observed run times are delayed, so the configured cadence
is not a guaranteed hourly delivery time. Acknowledgment and an earlier catalog
run do not prove a fresh Muse upload, its current runner health or a new track's
visibility. Verify one requested upload by its actual Drive file ID, then its
published catalog entry, then playback in Drive. After mirroring is enabled,
verify that new track separately in the R2 source. The existing Muse account must
show the actual scheduled task/run; this repository cannot verify it alone.
