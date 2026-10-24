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
   `patch`. Never rewrite the catalog to change them.
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

Any subset of those fields. Analysis corrections stay on
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
