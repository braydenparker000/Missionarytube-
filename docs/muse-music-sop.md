# Music on R2: Muse's procedure

This replaces the earlier procedure (serial uploads with long rests, whole
catalog edits through the Cloudflare REST API). The Worker now holds the
catalog itself, so every change is one small signed call, and nothing ever
writes the catalog file directly. Background: [music-r2-pipeline.md](music-r2-pipeline.md).

## Rules

1. **Never write `catalog/` keys** (v1, the v2 mirror or the backup) and never
   write media objects through the REST API. Everything goes through the
   Worker's signed endpoints below. A direct edit of the catalog file is still
   taken in when nothing else is pending, but it is the slow, risky path.
2. **Waveforms travel with their track**: in the registration, or later with
   `patch` or `waveforms`. Never rewrite the catalog to change them. Make them
   with `scripts/audio/waveform.py` and send `"waveformKind": "rms"` (see
   Waveforms below); a waveform sent without a kind counts as old peak bars.
3. **Batch registrations** (up to 100 per call) once their audio and art are
   uploaded. One batch is one catalog write.
4. **Back off on 429 and 5xx** (as now), but there is no need for long rests
   between tracks: the Worker no longer rewrites a 13 MB file per track.
5. **Read `/music/health` after a wave.** `ok`, `writer.pendingPublish:false`
   and no `writer.conflict` mean the catalog is consistent.

## Signing (unchanged)

Every call is signed with the registered Ed25519 key, exactly as uploads are
today: headers `X-Music-Public-Key`, `X-Music-Timestamp` (Unix seconds,
within 5 minutes), `X-Music-Size`, `X-Music-Sha256` (of the body),
`X-Music-Signature` (hex) over these lines joined with `\n`:

```
jarvis-r2-upload-v1
<METHOD>
https://jarvis-hub-api.braydenparker999.workers.dev
<path>
<Content-Type>
<sha256 of body>
<body size>
<timestamp>
<public key hex>
```

Catalog calls are `POST` with `Content-Type: application/json` and a JSON
object body (send `{}` when there is nothing to say). Bodies are limited to
64 KiB, or 1 MiB for `register-batch`. No `Origin` header (server to server).

## Adding tracks

1. `PUT /music/uploads/audio/<sha256>.opus` (Ogg Opus, ≤ 32 MiB).
2. `PUT /music/uploads/art/<sha256>.jpg|png` if there is a cover (≤ 2 MiB).
3. Register, one or many:

```json
POST /music/uploads/register
{"sha256": "<audio sha256>", "size": 4072589, "name": "Artist - Title.opus",
 "metadata": {"title": "…", "artist": "…", "album": "…", "dur": 168.06, "codec": "opus"},
 "cover": {"sha256": "<art sha256>", "ext": "jpg", "size": 51234},
 "waveform": "<base64 of 16–1000 bytes, one peak per bar>"}

POST /music/uploads/register-batch
{"tracks": [ <registration>, … up to 100 ]}
→ {"results": [{"registered": true, "duplicate": false, "id": "r2_native_…"},
               {"registered": false, "sha256": "…", "status": 409, "error": "Upload audio before registration"}, …],
   "registered": 98, "count": 7592, "published": true}
```

Items in a batch succeed or fail on their own; retry only the failed ones.
Registering audio that is already there is a duplicate (with its existing id);
a waveform sent with a duplicate fills in a missing one.

## Changing tracks

```json
POST /music/uploads/patch
{"id": "r2_native_…",
 "metadata": {"album": "Fixed", "albumArtist": "Band", "genre": null},   // null removes a tag
 "path": "Band/Album/Title.opus", "folder": "Cloudflare R2/Band",
 "waveform": "<base64>",                                                 // or null to remove
 "cover": {"sha256": "…", "ext": "png", "size": 1234}}                   // uploaded first; null removes
```

Any subset of those fields (with a waveform, add `"waveformKind": "rms"`
when it comes from `waveform.py`). Analysis corrections stay on
`POST /music/uploads/analysis` (unchanged).

```json
POST /music/uploads/replace-audio
{"id": "r2_native_…", "sha256": "<new audio sha256>", "size": 123, "name": "Title (Remaster).opus",
 "waveform": "<base64 for the new audio>", "deleteOld": true}
```

The track **keeps its id**, so plays and ratings stay with it. Upload the new
audio first. Its old analysis is dropped (it described the old audio); the
old audio object is deleted unless another track uses it (`deleteOld: false`
keeps it).

```json
POST /music/uploads/delete
{"ids": ["r2_native_…", …], "deleteObjects": true}
→ {"deleted": [...], "notFound": [...], "deletedObjects": ["native/audio/…", …]}
```

Entry and objects in one call; an object another track still uses is kept.

## Waveforms

The seek bar draws a song's loudness the way Poweramp does (notebook F99):
100 bars, each the RMS of an equal slice of the song, divided by
sqrt(max² + 0.01) and raised to the power 1.35. The server keeps the
measurement; the player does the drawing.

- **Make them** with `python3 scripts/audio/waveform.py FILE…` (FFmpeg): 500
  bins, each the RMS of an equal span of the decoded audio (all channels, full
  scale 1.0), one byte per bin, `round(255 * sqrt(rms))`, base64. Absolute,
  not normalised: a quiet song draws lower than a loud one.
- **Send them** with their kind: `"waveformKind": "rms"` on `register`,
  `register-batch` items, `patch` and `replace-audio`, or in bulk:

```json
POST /music/uploads/waveforms
{"items": [{"id": "r2_native_…", "waveform": "<base64>", "kind": "rms"}, … up to 200]}
→ {"updated": 200, "notFound": [], "count": 8225, "published": true}
```

  One call is one catalog write. A waveform without `"rms"` is the older
  peak kind, which the player can only approximate.
- **Backfill** every track that has no `rms` waveform yet (resumable; downloads
  each song from the Worker once (one request a song: the Worker is on the
  free plan, 100,000 requests a day), measures it, sends signed batches of
  200):

```
python3 scripts/audio/waveform.py --backfill --key KEY.pem --jobs 4 --state waveforms.done
```

- **Redo broken ones.** A measured song has hundreds of distinct bins; a
  waveform of only a few flat steps came from a decode that stopped after
  the first second. `--redo-bad` checks every `rms` waveform and re-measures
  those (use a new state file: the old one lists them as done). The tool now
  refuses a song whose decode stops short of its length, so a cut stream is
  a reported failure, never a waveform. Run it unchanged, in full: no
  sampling, excerpts or a different measurement.

```
python3 scripts/audio/waveform.py --backfill --redo-bad --key KEY.pem --jobs 4 --state waveforms.redo
```

## Backups, checks and conflicts

- `POST /music/uploads/export` `{}` returns the whole catalog with waveforms
  inline (the familiar format). Use it for local backups instead of keeping a
  master copy to edit.
- `POST /music/uploads/audit` `{}` compares the bucket with the catalog:
  entries whose objects are missing, objects nothing uses (with samples).
  Nothing is deleted; delete orphans with care.
- `GET /music/health` (any client with the site's Origin, or none):
  `writer.count`, `writer.pendingPublish`, `writer.conflict`,
  `writer.lastAudit`, plus what phones are served.
- **Conflict** (a 409 with `"conflict": true`): the catalog file was replaced
  outside the Worker while changes here were waiting. Choose:
  `POST /music/uploads/reimport {"confirm": true}` takes the file as the
  truth, or `POST /music/uploads/publish {"force": true}` keeps the Worker's
  changes. `publish` without force just retries a pending write.
