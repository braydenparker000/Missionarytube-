# Third-party code in this folder

These files are copied unmodified from the pinned npm packages by
`node scripts/astra/vendor.mjs`, except that the two decoder extensions import
`./mediabunny.js` instead of the bare name `mediabunny`.

| File | Package | Source |
| --- | --- | --- |
| `mediabunny.js` | mediabunny@1.55.7 | https://github.com/Vanilagy/mediabunny/tree/v1.55.7 |
| `mediabunny-ac3.js` | @mediabunny/ac3@1.55.7 | https://github.com/Vanilagy/mediabunny/tree/v1.55.7 |
| `mediabunny-dts.js` | @mediabunny/dts@1.55.7 | https://github.com/Vanilagy/mediabunny/tree/v1.55.7 |

Copyright Vanilagy and contributors. The three packages are distributed under
the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/); the source form
of every file is available at the addresses above and in the npm tarballs.

The AC-3/E-AC-3 and DTS decoders contain WebAssembly builds of decoders from
FFmpeg (https://ffmpeg.org/), which FFmpeg distributes under the GNU Lesser
General Public License 2.1 or later. Their source and build scripts are in the
same upstream repository.
