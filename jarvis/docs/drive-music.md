# Google Drive music source

The public test folder is `1VlEUztloW5saoM7iF11fodDKSmCGP2ZZ` (50 songs at setup). Drive API key-only reads and byte-range requests were verified for both WebM/Opus and M4A content from the Storage origin. This integration uses `files.list` and `files.get?alt=media`; it does not scrape Drive pages or proxy music through Azure/Cloudflare.

The existing DrawerCast player, audio processing, queue, preload and waveform code remain in use. Google Drive Music is a separate library category and settings entry. A15 refresh/disconnection and Drive refresh/disconnection remove only their own source's tracks. Local files and other-source tracks remain intact. Listing follows pagination and subfolders and commits only after the complete read succeeds. Song IDs remain stable across refreshes; ratings and play counts are retained.

The owner approved public access to this folder and an embedded shared API key. `GOOGLE_DRIVE_API_KEY` is stored in the two existing repositories' Actions secrets, then injected by `scripts/configure-drive.mjs` into the deployed `assets/drive-config.json`. The tracked placeholder contains no key. No key is saved in track metadata or library exports. Existing Google Cloud API restrictions and billing settings are not changed.

## Metadata manifest

The folder listing remains authoritative. DrawerCast reads `drive-prepared.json` at startup, whenever the player becomes visible, and once per minute while it stays visible. A changed manifest updates matching cached metadata immediately; a new Drive ID or changed MD5/size triggers one quiet recursive folder sync so newly uploaded songs appear without using Refresh folder or reloading the page. The manifest is only the lightweight change signal—an authoritative folder walk still validates additions and removals before committing a new snapshot. A missing or invalid manifest is ignored and the last complete library remains available.

`scripts/prepare-drive.py` downloads each file to a temporary directory, reads its tags with ffprobe and writes `drive-prepared.json`. Upload that file to the music folder. It never writes audio or keys into the output or git.

```
python scripts/prepare-drive.py FOLDER_ID --key-file /private/path/to/key
```

Use a private key file outside the repository. Files over 50 MiB or 30 minutes require an explicit budget change.

Bundled waveforms were removed on 2026-09-22: Muse replaced the original songs with new Drive IDs, so the 50 checked-in `.dcw` files no longer matched any song. Drive tracks use live waveform samples while playing.

## Verification and rollback

`npm test` covers Drive pagination, recursive folders, key-free stored metadata, source isolation, failed reads, manifest revision validation, and songs missing from the manifest. Browser verification must prove actual playback, seeking, switching tracks, and persistence. Screen-lock/background behavior on the physical restricted Android remains a device test, not something a desktop cloud browser can prove.

Baseline before Drive: source `55f338a3aecb3898c88665f22310fd14e9d024c1`; Storage deployment `6bc585cf3995bb24356cc31fc374703c80724048`. Use the workflow's pre-deployment blob backup or revert source and the release pin. If reverting an already-used browser, first remove Drive through its settings so an older player does not mistake persisted Drive tracks for A15 tracks. No files were changed or deleted in the source Drive folder.


## Embedded metadata after a Drive remux

Drive's file listing does not expose embedded music tags. DrawerCast now reads bounded byte ranges for visible songs and the selected song, using its existing tag parser. Opus/Ogg tags and embedded artwork are read from the file header; the full song is never downloaded for metadata or waveform analysis. Range responses must be HTTP 206 with exactly the requested body length (Drive hides Content-Range from browser JavaScript), with a 2 MiB / 8 request ceiling per metadata job. A refused range is cancelled. Jobs run one at a time, pause new work while playback buffers, prioritize the selected track, and cancel abandoned cover reads when tracks change.

Tags and 220px artwork thumbnails are cached in IndexedDB. Cache validity includes Drive ID, MD5 and file size; refresh preserves unchanged metadata and invalidates changed content. Numbered `track - artist - title.opus` filenames give immediate display labels until real tags arrive. Album/category metadata fills as songs are inspected; a complete prebuilt Drive catalog remains a future option for large libraries. No automatic full-library metadata scan or waveform preparation is added.

The now-playing cover clears on selection rather than showing the previous track while loading. The normal player visualization redraws at most 30 times per second; fullscreen visualization retains the normal animation rate. Actual first-play latency still depends on Drive and the connection. Muse replaced the initial 50 files with new Drive IDs; the old prepared waveforms have since been removed.

Rollback for this fix: source `9a537718b28ee1e4c905864e4ae1b3546d9fc7ae`, Storage deployment `856140c507f900b0bd8304c1187b63b41f4ec139`. The existing Storage deployment creates its normal pre-upload blob backup. Drive music and Azure federation are unchanged.

Live testing also reproduced delayed manual skips: the generic crossfade awaited the next cloud stream before selecting it, leaving the old title and audio active. Manual selections involving Drive now take the immediate selection path and release abandoned streams. Local/A15 manual fades and automatic crossfade/gapless behavior are retained. New metadata jobs wait at least one second after selection and continue waiting while the active audio is buffering.
