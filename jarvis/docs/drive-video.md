# My Media: Google Drive videos

`/mymedia/` is a video library for one Google Drive folder of downloaded YouTube videos. It lists the folder and plays each file in the browser, straight from Google's servers. Nothing is proxied through Azure or Cloudflare, and no video is stored in this repository or the deployed site.

The folder is `1lU0PKBXwi6uMy5L9VV2bptYQm1t7ImoW`, set as `videoFolderId` in `public/assets/drive-config.json`. The owner chose to build it into the site rather than paste it on the page. It must stay shared as **Anyone with the link → Viewer**. The page uses the same shared `GOOGLE_DRIVE_API_KEY` that DrawerCast uses, injected at deploy time by `scripts/configure-drive.mjs`. The committed config has no key.

## Files

- `public/mymedia/index.html`, `mymedia.css`: the page, in the Jarvis style.
- `public/mymedia/library.js`: Drive listing, name parsing, sidecar pairing, sorting, search and watch progress. Pure functions, covered by `tests/mymedia.test.js`.
- `public/mymedia/player.js`: plays a file and falls back to Astra's decoders.
- `public/mymedia/app.js`: the page logic.
- Launcher entry: `My Media` in the Library group of `public/assets/hub.js`.
- Security policy: the `/mymedia*` route in `public/staticwebapp.config.json`. The Missionarytube build turns it into a `<meta>` CSP. It allows Drive (`www.googleapis.com`), YouTube thumbnails (`i.ytimg.com`) and Drive thumbnails (`*.googleusercontent.com`), and nothing else remote.

## Library

- Every refresh reads the whole folder, including subfolders and every page of results. The list is replaced only when the whole read succeeds, and the last good list is kept in the browser for an instant, offline-tolerant start.
- Video files: `.mp4 .m4v .webm .mkv .mov`. Each subfolder becomes a collapsed folder row that can be opened individually; the page also offers Open all/Close all controls and remembers open folders in that browser.
- Titles: yt-dlp's `Title [videoID].ext` naming gives a clean title and the video's YouTube thumbnail. Files without an ID keep their file name as the title.
- Sidecars with the same name as the video are picked up automatically: subtitles (`Title [id].en.vtt`, `.srt`, converted to WebVTT in the browser) and a thumbnail image (`.jpg .png .webp`).
- Thumbnails are tried in order: a sidecar image, then YouTube's thumbnail, then Drive's own thumbnail, then a plain placeholder.
- Thumbnail images are explicitly stacked above the placeholder layer so a successfully loaded image cannot be hidden by the fallback tile.
- Search matches every word against the title and folder. Sorting: newest, title (numbers sort naturally) or longest.

## Playback

1. The browser's own player streams the Drive file with byte ranges, so seeking works. This covers MP4 (H.264/AAC) and WebM (VP9/AV1, Opus), which is what nearly all YouTube downloads are.
2. If the browser rejects the file's format (MKV, AC-3/DTS audio, a codec without hardware support), the page loads Astra's compatibility player from `/media/assets/js/playback/`. It repackages the file in the browser, and if the browser still cannot decode it, Astra's WebAssembly decoder takes over. That decoder is fine up to about 720p on a phone.

Controls: the browser's native controls (fullscreen, which rotates to landscape where Android allows it), plus ±10 s, speed (remembered), subtitles, picture in picture and Mark watched. The lock screen gets the title and seek buttons. Keyboard: `j`/`l` skip 10 s, `k` play/pause, `f` fullscreen.

Progress is saved in the browser every 5 seconds, on pause and when leaving the page. A video resumes where you left off unless you had watched less than 10 seconds or more than 93%. Reaching 93% or the end marks it watched, and rewatching keeps the mark. Continue watching shows the six most recent unfinished videos. Nothing is synced between devices.

## Limits

- Google does not publish Drive's per-file download limit. It is meant for files downloaded by many people, so rewatching your own videos should not reach it. If it is reached, that one file is blocked for about a day.
- Mobile data: 1080p uses about 1–3 GB an hour.
- Android Chrome pauses video in the background unless picture in picture is on.
- Anyone with the folder link can see the videos, and the API key is visible in the deployed page, as it is for DrawerCast.

## Verification

- `npm test` runs `tests/mymedia.test.js`, which covers listing, pagination, sidecars, name parsing, progress, stored-data validation, sorting, search, subtitle conversion, the launcher entry and the security policy.
- The browser check used Chromium at phone size, with Drive faked by a local server that supports byte ranges. It covered the launcher entry, the library and its sections, WebM native playback, ±10 s, VTT and SRT subtitles, speed, Continue watching, resume after reload, marking watched at the end, Up next and search. It also covered the fallbacks: an H.264 MP4 through Astra's software decoder (the test browser has no H.264), an H.264 + AC-3 MKV, and a VP9 MKV in a subfolder. No CSP violations were logged.
- Still to check on the phone against the real folder: playback, seeking and resuming.
