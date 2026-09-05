# Playback 0.32

This release keeps native/HLS/DASH playback and the existing player controls.
Mediabunny remains the first compatibility path: copy usable video, convert
audio only when necessary. Unsupported video/audio or rejected converted media
can fall back once to libmedia AVPlayer 1.3.1. Network failures do not trigger
another decoder reading the same inaccessible bytes.

The fallback uses WebCodecs when supported and FFmpeg WebAssembly decoders
otherwise. It outputs a MediaStream to Astra's video element, keeping ordinary
video picture-in-picture. The adapter owns the content clock, seeking, audio
selection, speed and resource cleanup. External captions render against that
clock; captions are currently visible in the page, not in video PiP. Embedded
subtitle selection is not exposed by this release.

## Delivery

The software decoder uses a custom I/O loader with bounded 2 MiB byte reads,
20-second request deadlines, cancellation and the existing origin-scoped
request-header policy. Protected redirects are rejected before custom headers
could leave their origin. No full movie is downloaded into memory.

For a selected Torrentio TorBox URL, an optional read-only account lookup maps
the exact torrent hash and a unique matching filename to TorBox's file ID.
The JSON download endpoint can then supply the CDN URL directly. Lookup is
bounded to five pages and six seconds. Failure preserves the original URL.
It never adds torrents or changes the account. Tokens come only from the
already-selected URL and are excluded from diagnostics and persistent state.

Progressive source loading uses fixed provider slots: an addon may finish
early, but final addon order and each addon's result order remain unchanged.
Closing or changing the title aborts its pending requests. Existing filters,
expanded details, keyboard focus and the visible result anchor are retained.

## Reproducible engine assets

JavaScript comes from the exact npm lockfile. The entire UMD output is copied
because its workers and runtime chunks use relative paths. Decoder binaries
come from the libmedia v1.3.1 release commit
`152f629d3021fd8013efa464fcb7b55f9fbe7753`; `scripts/libmedia-assets.json`
records each file's SHA-256. The build refuses mismatches. Assets are served
from Astra's own origin and fetched by the browser only when needed.

Unmodified libmedia is copyright Gaoxing Zhao and contributors, distributed
under LGPLv3. License texts are in `assets/licenses/libmedia-COPYING.*.txt`.
The corresponding source and build scripts are available at
https://github.com/zhaohappy/libmedia/tree/152f629d3021fd8013efa464fcb7b55f9fbe7753
and the exact package sources are included by the pinned npm packages.
The separate engine scripts and WASM files can be replaced with compatible
modified versions without changing Astra's application bundle.

## Practical limits and checks

Azure static hosting does not provide cross-origin isolation. This integration
uses libmedia's worker proxy without requiring SharedArrayBuffer. Software
decoding performance still depends on resolution, bitrate and device speed;
it does not guarantee smooth high-resolution HEVC on a Galaxy A15. Browser
network restrictions, DRM and missing/broken source data remain constraints.

`playback-check.html` includes generated HEVC and AC3/EAC3/DTS checks that
explicitly disable both WebCodecs and MSE, plus seek/pause/resume controls.
The software checks prove the decoder path rather than a native fallback.
Unit tests cover ordered partial results, cancellation, TorBox file identity,
byte-range integrity, header isolation and player-clock/control lifecycle.
The user's authenticated TorBox streams and phone performance require testing
on that device; generated desktop clips cannot establish those results.
