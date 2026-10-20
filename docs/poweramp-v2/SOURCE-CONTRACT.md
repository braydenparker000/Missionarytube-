# V2 external-source contract and publication baseline

Investigated 2026-10-20 against `braydenparker000/Missionarytube-` commit
`4fd9547d37d5845fbafb3f0edad53b6150a8cedd`. These are original notes about external
service contracts, not V1 implementation. No personal catalog or media was
requested; no production writes were performed. No V1 frontend files were read.

## Recommended first remote adapter

Use the independently maintained R2 library endpoint, not the older Drive clone
manifest. At this checkout `scripts/r2-player-config.mjs:1-13` produces the
same-origin static `/assets/r2-config.json` containing `{rootId, manifestURL}`.
The native endpoint has `rootId: ''`; `manifestURL` is the configured API origin
plus `/music/library.json`. Never infer a different host from an arbitrary track
field. V2 can load the published configuration and validate a fixed approved
HTTPS origin/path before fetching.

`backend/worker.js:35-36` routes `nativeMusic` before the older `music` handler.
The read contract is directly visible in `backend/music-upload.js:107-130`:

| Purpose | Method/path | Result |
|---|---|---|
| Native catalog | GET `/music/library.json` | Validated stored library JSON, `private, no-store` |
| Audio | GET/HEAD `/music/library/audio/{id}` | Verified registered audio, range capable |
| R2 artwork | GET/HEAD `/music/library/art/{id}` | Verified cover; 404 when absent |
| Read preflight | OPTIONS on those read paths | 204 for permitted methods/origin |

Public reads require existing `MUSIC_R2` and `MUSIC_PUBLIC_READ === 'true'`.
They do not require a bearer token when enabled. CORS is not authentication.
Query parameters are rejected with 400. Non-read methods return 405. Unknown
IDs/paths/covers return 404. Disabled delivery returns 403. Missing storage,
stale/mismatched object proofs, catalog failures, or a replaced object return
503; errors contain sanitized messages. V2 must retain the selected source and
explicit user playback intent on error, rather than silently use another source.

**Local development constraint:** `backend/origins.js:1-3` allows only
`https://missionarytube.z13.web.core.windows.net`. Browser catalog fetches from
localhost are therefore rejected. Use synthetic local fixtures for contract
tests. Do not add origins, proxies, query credentials, or omit browser security
to make the prototype pass. Real remote-source browser proof requires a later
approved deployment at the authorized origin. This is independent of whether a
server-side GET without an Origin header would be accepted.

## Catalog schema recovered without V1 adapter source

`scripts/build-r2-library.mjs:14-20` constructs:

```text
{
  version: 1,
  kind: 'r2-library',
  complete: true,
  count: tracks.length,
  generatedAt: ISO timestamp,
  tracks: [{
    id, audioKey, size, sha256, mimeType, r2Identity,
    path, folder, metadata,
    md5?, coverURL?, coverKey?, coverSha256?, coverSize?,
    coverMimeType?, coverIdentity?
  }]
}
```

IDs follow `r2_...`; native registered IDs are `r2_native_` plus the 64-digit
audio SHA-256 (`backend/music-upload.js:88-94`). Read routes additionally apply
the service's ID validator after matching `[A-Za-z0-9_-]+`. Keep IDs as opaque
identities; do not derive UI identity from names or folders.

Metadata fields identified by the seeder and prepared uploader are `title`,
`artist`, `album`, `albumArtist`, `genre`, `composer`, `year`, `track`, `disc`,
`dur` (seconds), `sr`, `ch`, `codec`, optional `bits`, ReplayGain/R128 fields,
and optional `audioAnalysis`. Sources: `scripts/build-r2-library.mjs:14-18`,
`scripts/upload-music-r2.py:213-221`, and `backend/music-upload.js:63-85`.
The native registrar requires positive `metadata.dur` for new uploads. A V2
client should validate only its required supported fields and impose documented
resource bounds; exact existing validator limits were not read because they
reside in the excluded V1 source boundary. Render all metadata as text.

Construct audio URLs from the approved API origin and the validated track ID;
do not expose/use `audioKey` directly as a bucket path. For tracks with
`coverKey`, use `/music/library/art/{id}`. Older records may instead have
`coverURL` pointing at immutable artwork on the approved Azure origin
(`scripts/build-r2-library.mjs:19`; `docs/JARVIS-MUSIC-SOURCES-STATUS.md:196-201`).
Reject alternate hosts, credentials, query strings and unsafe URL schemes in
artwork. No downloaded content, track name, private URL, ID or object proof is
needed in test evidence.

No known public waveform schema was established by this investigation. Do not
treat `audioAnalysis` as waveform peaks without its own evidence. Leave a real
timeline fallback when no independently validated peaks exist.

## Range and cache behavior

`backend/music.js:130-143` supports one ordinary, open-ended, or suffix byte
range. Multiple/malformed/unsatisfiable ranges return 416 with
`Content-Range: bytes */{size}`. Valid ranges return 206. HEAD ignores Range
and returns complete object headers without a body. Strong matching `If-Range`
permits a range; a mismatch returns full bytes. `If-None-Match` handles weak or
strong matching ETags and returns 304. The native route uses the same parser
(`backend/music-upload.js:119-130`).

Successful immutable media/art responses include `Accept-Ranges: bytes`, ETag,
Content-Type, Last-Modified and Content-Length, with
`public, max-age=604800, immutable`. Catalog/errors/304/416 remain no-store.
Read CORS exposes Content-Length, Content-Range, Accept-Ranges, ETag and
Last-Modified and permits Range, If-Range and If-None-Match. Let the persistent
HTMLMediaElement request its own ranges. No full-file fetch/decode is needed
for initial playback.

Legacy `/music/manifest.json` and `/music/partial/manifest.json` expose verified
Drive mappings, not title/artist catalog metadata (`backend/music.js:34-83`).
They are unnecessary for the first native R2 adapter. Keep their catalogs and
all upload/registration/signature endpoints out of V2's read-only interface.

## Verified publication baseline

The latest five workflow records included successful frontend publication
run **39367236692**, created `2026-10-20T04:00:13Z`, completed
`2026-10-20T04:04:48Z`, event `workflow_dispatch`, head commit
`4fd9547d37d5845fbafb3f0edad53b6150a8cedd`. The later music-verification run
**39367649701** succeeded; its detailed results were not inspected here.

Downloaded **only for receipt inspection** the existing evidence artifact
**12240570192**, `frontend-evidence-39367236692`, 7,691,810 bytes. Its SHA-256
was independently computed and matched the GitHub artifact digest:
`1170740380eae02535bd6c393863602a865a03c119190526fa4ce5bfb470551b`.
The archive is outside Git in `private-v2-contracts/frontend-evidence.zip`.
No before/after application file was extracted or inspected.

`receipt.json` says schema1/kind frontend/action publish, the exact commit above,
frontend tree `49a1ef6d793f3987f6c3a83bf426fb1b242e4a1d`, `dirty:false`,
246 file records, `workerChanged:false`, `dataChanged:false`, and verifiedAt
`2026-10-20T04:04:31.922Z`. The tree also matches `git rev-parse HEAD:frontend`.

A fresh public GET of `/release.json` returned schema2, the same repository,
commit and frontend tree, `dirty:false`, and `bytes:21525932`. This is a
current release-metadata match, not a new exhaustive live-byte audit. It
establishes a stronger baseline than a historical prose status report and does
not authorize V2 publication.

Sources:
- https://github.com/braydenparker000/Missionarytube-/actions/runs/39367236692
- https://github.com/braydenparker000/Missionarytube-/actions/runs/39367649701
- https://missionarytube.z13.web.core.windows.net/release.json

No V2 was merged, deployed, or live-tested by this investigation.

## Implemented V2 adapter (branch work, not production)

New independent files:
- `frontend/poweramp-v2/remote-source.js`
- `tests/poweramp-v2/remote-source.test.mjs`

Interface: `loadRemoteCatalog({apiOrigin, fetcher = fetch, signal})` resolves to
`{tracks, dispose()}`. No automatic configuration lookup or source activation;
root UI owns the authorized-origin gate. Track fields are `id,title,artist,album,
duration,src,artwork?`; waveform/analysis and legacy cover URLs are ignored.
The adapter checks catalog identity/count/completeness, unique opaque IDs,
content identity fields, metadata types and duration, and optional native cover
proof fields before constructing exact service routes. It does not itself
verify audio hashes or claim browser integrity proof. Empty complete libraries
remain empty. Zero metadata duration is permitted as unknown until media
metadata loads; negative/nonfinite or over-seven-day duration is rejected.

V2-specific safety choices: 16 MiB streaming body limit, 50,000-track limit,
512-character normalized plain-text labels, 20-second abortable request timeout,
2 MiB native artwork bound (also visible in current native upload limits).
No credentials, redirect following, mutation requests, cache writes, logging,
or personal media fetching were introduced. A rejected source is an error;
there is no cross-source fallback.

Validation: `node --test tests/poweramp-v2/remote-source.test.mjs` passed **9/9**
with Node24.19.0. Cases include exact requests and URLs, empty library,
untrusted URLs/credentials, duplicate or malformed records, metadata bounds,
size-bound chunked bodies, wrong MIME/invalid UTF-8/JSON, safe HTTP/network
errors, body-stream cancellation and pre-aborted requests. Scoped diff
whitespace check also passed. These are synthetic contract tests, not live
CORS/playback or device proof.
