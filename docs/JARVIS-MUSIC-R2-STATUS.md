# Initial Jarvis music delivery checkpoint — 2026-10-01

The combined source layout described here was superseded by the independent
Google Drive and Cloudflare R2 sources. See
[JARVIS-MUSIC-SOURCES-STATUS.md](JARVIS-MUSIC-SOURCES-STATUS.md) for the current
frontend deployment and source-isolation verification. Worker byte verification
and the original migration evidence below remain relevant.

Poweramp partial R2 playback is deployed and verified. The bulk clone remains
incomplete and paused after Google's automated-query refusal. Drive originals
were not changed. No recurring R2 mirror is active.

## Deployed source and runs

- Tested source: `8647b99fdb17927b0f22ea4cdd0cbc1b7f515951`.
  Source PR #11 was advanced to that saved commit, tested and merged at
  `634b37e37a079261bcd6be52fd6ebece9f5cdbd2`.
- Worker run: https://github.com/braydenparker000/Missionarytube-/actions/runs/36870873575
  completed successfully from orchestration revision
  `51c43c48b8ed9689d0d6806cb5767e76408be4c1`.
- Worker: `jarvis-hub-api`, deployed version
  `3a918cd8-74be-4197-8730-888a98657cbc` from the exact tested source above.
  Existing `HUBS` Durable Object binding was checked before deployment and
  retained; `MUSIC_R2` binds `jarvis-music`.
- Azure run: https://github.com/braydenparker000/Missionarytube-/actions/runs/36873730338
  completed successfully from orchestration revision
  `60e98c2f442e62cd6dac98382665cc97544213d3`.
  The live `release.json` confirms source
  `8647b99fdb17927b0f22ea4cdd0cbc1b7f515951`.
- Live player: https://missionarytube.z13.web.core.windows.net/drawercast/
- Playback map:
  https://jarvis-hub-api.braydenparker999.workers.dev/music/partial/manifest.json

Source PR #11 and deployment PRs #63, #64 and #65 are merged. The earlier Azure
run `36872604073` was canceled during an unnecessary Ubuntu package installation.
Its website staging and overwrite steps were all skipped. PR #65 skips media
preparation when the existing catalog is deliberately preserved.

## Map integrity and catalog

The saved migration report came from run `36864240781`, artifact
`11162139378`. The R2-only publisher re-read and hashed all 314 existing audio
objects and rechecked their identities before publishing:

- Total inventory: 1,287 tracks, 4,989,786,207 bytes.
- Published verified subset: 314 tracks, 1,256,156,900 bytes.
- Remaining clone: 973 tracks, 3,733,629,307 bytes.
- Partial object: `catalog/drive-r2-partial-v1.json`.
- Partial status: `mode=partial`, `complete=false`.
- Full canonical map: `catalog/drive-r2-map-v1.json` remains separate and
  unpublished. Its delivery endpoint returned 503 during verification.
- No Google download was made by partial-map publication; no audio object was
  written by that operation.

The existing Drive catalog generation remains
`f96cadf5907836cfb2312214001468edbd68563f124704a4082120eb20612788`.
Its two shards, hashes and all 1,287 records were checked. Every subset record
matches the current catalog's Drive ID, size and MD5. Track IDs, metadata,
artwork, user ratings and playlists continue to use the existing catalog.

## Verified playback

Offline regression: 218 source JavaScript tests, 83 source Python tests and
524 orchestration tests passed. The Azure build contained 152 frontend files
and 19.05 MiB, with no audio payloads. Exact-source CI and Azure staging/final
frontend checks also passed.

`scripts/verify-music-worker.mjs` downloaded three actual Worker audio objects
(first, middle and last subset records). All matched their expected SHA-256
hashes and decoded completely with ffmpeg. GET 200, HEAD 200, bounded and suffix
Range 206, unsatisfiable Range 416, ETag 304, OPTIONS 204 and exact Azure-origin
CORS passed. An unrelated Origin was refused with 403. The browser adapter
accepted the live map against all 1,287 catalog tracks and left unmapped tracks
on Drive. Future Worker deployments include this live verification step.

Live browser interaction additionally verified:

- “IN2” by YAANO streamed from the Worker's partial endpoint. The audio element
  reached readyState 4, duration 224.08 seconds, no media error and an advancing
  playback clock. A real seek gesture moved from 87.03 to 32.26 seconds and
  playback continued. Existing album art rendered correctly.
- Uncopied file “Kick In The Teeth - Sesame Girl.opus” streamed through the
  existing Google Drive endpoint. The audio element reached readyState 4,
  duration 168.0605 seconds, no media error and an advancing clock. A real seek
  gesture succeeded and existing artwork rendered.
- The source settings displayed “Verified R2 playback ready” and 1,287 songs.

Screenshots are saved beside this checkpoint. This verifies the cloud browser;
physical Android, headset and background behavior have not been newly tested.
A forced outage of the production R2 endpoint was not introduced; bounded
error fallback is covered by source regression tests, and unmapped-track
fallback was verified live.

## Rollback

Worker checkpoint artifact `11167460451`, named
`worker-checkpoint-36870873575`, retains the partial proof report, generated
configuration, sanitized binding record and versions before/after deployment.
The preceding Worker version is `da7b8ffc-2b1a-40c9-983d-8463ee82be1a`.

Azure run `36873730338` saved artifact `11167888292`, named
`storage-before-36873730338-1`, before
overwrite, using the existing OIDC identity. Clear the release's
`r2ManifestURL` and deploy to return to Drive-only playback. Disable
`MUSIC_PUBLIC_READ` or redeploy the preceding Worker version to stop music
delivery. Preserve original Drive files and existing R2 objects.

## Remaining transfer and mirror gate

The latest transfer report remains incomplete after Google's explicit refusal.
No further bulk transfer was dispatched, no network was rotated, and no
repeated attempt was made to evade it. A successful player request does not
prove that the GitHub runner's source-access restriction has cleared.

The repository secret-name inventory contains `GOOGLE_DRIVE_API_KEY` but no
Google Drive OAuth client/refresh-token secrets; no values were retrieved.
Connected Drive metadata reads resolve the folder and an uncopied sample,
but this does not supply an unattended owner credential to GitHub Actions or
prove bulk-content recovery. Resolve the provider restriction through Google's
supported verification/support process, or configure an owner-authorized
read-only OAuth download identity and verify its access before resuming. OAuth
is a supported authentication method, not a guarantee that quotas or provider
restrictions disappear.

After source access is legitimately restored, resume the existing migrator
using an exact tested source revision, bounded pacing and immediate stopping
on renewed refusal. Require a stable full inventory, full byte verification,
zero failures and `complete=true` before enabling a canonical baseline. Only
then activate the prepared `--incremental --limit 0` mirror in a separate
explicit scheduling change. The existing hourly Drive catalog publisher is
distinct from R2 mirroring and remains unchanged.

Muse's last known update remains message
`c454e4ed-50d1-47cb-8da4-1b12757c236f`, delivered but not acknowledged. No new
Muse message was sent in this continuation. Its existing Muse → Drive upload
path remains intact.

References for source recovery:

- https://support.google.com/recaptcha/answer/6081888
- https://support.google.com/websearch/answer/86640
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://developers.google.com/workspace/drive/api/guides/handle-errors
