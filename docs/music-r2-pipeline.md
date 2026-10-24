# Music on R2: the pipeline

How music gets from Muse into the player, and what keeps it working.

```
 Muse ── signed uploads ──▶ Worker /music/uploads/*  ──▶ R2 bucket jarvis-music
                                                            native/audio/<sha256>.opus
                                                            native/art/<sha256>.jpg|png
                                                            catalog/r2-library-v1.json   (the stored catalog)
                                                            catalog/r2-library-last-good-v1.json
 Player ◀── /music/library.json (light index, ETag) ◀── Worker ◀──┘
        ◀── /music/library/audio|art|waveform/<id>
```

## Delivery (what phones download)

- **`/music/library.json`** is the stored catalog without its per-track
  waveforms (three quarters of its compressed size): about 1.3 MB compressed
  for 7,500 tracks instead of 5.2 MB. Tracks that have a waveform carry
  `waveformBars: true`.
- It carries an `ETag` and `Cache-Control: no-cache`; the player revalidates,
  so an unchanged index costs a 304. The player checks every 10 minutes.
- **`/music/library/waveform/<id>`** is one track's waveform: one byte per bar
  (16 to 1000 bars), `application/octet-stream`, cached for a week. The player
  fetches it when the track plays and keeps it.
- Audio and art are unchanged: content-addressed, verified on every read,
  `immutable`, with ranges.

## Last known good

The stored catalog is one file, and today Muse also edits it directly. A
broken edit used to take all music down (503). Now:

- Each new valid catalog is copied to `catalog/r2-library-last-good-v1.json`.
- When the stored catalog is invalid, missing or over the size limit, the
  Worker keeps serving the last valid one (from memory, or from that copy
  after a restart) with `X-Music-Catalog: last-good`, and does not re-read the
  broken file until it is replaced.
- A catalog replaced in the middle of a read is not "broken": that request
  gets a 503 and the next one reads the new catalog.

## Health

`GET /music/health` (same origin rules as the library) reports, without any
keys or message text:

```json
{"ok": true, "servingLastGood": false, "problem": null,
 "catalog": {"etag": "…", "count": 7494, "generatedAt": "…", "storedBytes": 13335814,
             "limitBytes": 16777216, "usedPercent": 79.5, "publicBytes": 8352209, "waveforms": 7494}}
```

`ok: false` with `servingLastGood: true` means the stored catalog needs fixing;
`problem.reason` says how it is broken. The deploy check
(`scripts/verify-music-worker.mjs`) also checks the 304, a waveform and health.

## Next: one writer for the catalog

Still to do, with Muse:

- The catalog moves into a Durable Object (one row per track) with a single
  writer: no 16 MiB cap, no "library changed concurrently" conflicts, and
  registering a track no longer rewrites the whole file. The R2 file and the
  light index are generated from it, so they are always valid, and earlier
  versions are kept for rollback.
- Signed endpoints for batch registration, tag edits, deletion, waveforms and
  cover replacement, so nothing edits the catalog file directly.
- A regular integrity sweep: catalog entries whose objects are missing, and
  uploaded objects that were never registered.
