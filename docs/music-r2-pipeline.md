# Music on R2: the pipeline

How music gets from Muse into the player, and what keeps it working.

```
 Muse ── signed uploads ─────▶ Worker /music/uploads/audio|art ─▶ R2 native/audio, native/art
      ── signed changes ─────▶ Worker /music/uploads/<op> ─▶ catalog writer (Durable Object
                                                              "music-catalog-v1": one row per track,
                                                              waveforms, change log)
                                                                │ publishes after each change
                                                                ▼
                                                     R2 catalog/r2-library-v1.json (no waveforms)
 Player ◀── /music/library.json (light index, ETag) ◀── Worker read path ◀──┘
        ◀── /music/library/audio|art/<id> (R2)  ◀── /music/library/waveform/<id> (writer)
```

Muse's side of this is in [muse-music-sop.md](muse-music-sop.md).

## The catalog writer

`backend/music-catalog.js`, one Durable Object (`music-catalog-v1`):

- **One writer.** Register, register-batch, analysis, patch, replace-audio
  and delete run here one at a time: no "library changed concurrently", and a
  change is a row update, not a read-modify-write of the whole file (about
  0.2 s per change at 7,500 tracks, publish included; a batch of 100 is one
  publish).
- **Published, not edited.** After each change the catalog file is rebuilt
  from the rows, validated as a whole (album claims included), and written
  with a conditional put. A failed write is retried by the object's alarm;
  `/music/health` shows `writer.pendingPublish` meanwhile.
- **Waveforms live in the writer**, one per row, served per track. The file
  is about 8.4 MB instead of 13.3 MB (the 16 MiB limit now holds about
  15,000 tracks).
- **Stable ids.** `replace-audio` keeps the track's id (so its plays and
  ratings); the catalog's validator now allows a native id whose audio has
  been replaced.
- **Outside edits.** On first use the writer takes in the existing file. If
  the file is later replaced by someone else and nothing here is waiting to be
  published, it is taken in too. If something is waiting, that is a conflict:
  changes are refused (409) until `reimport` (take the file) or
  `publish {force: true}` (keep the writer's rows).
- **Change log**: every change keeps the record as it was before (last
  20,000), for repair by hand.
- **Audit** compares the bucket with the rows: missing objects, wrong sizes,
  orphans.

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

The catalog is one file in R2. A broken edit of it (before the writer, Muse
edited it directly) used to take all music down (503). Now:

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
             "limitBytes": 16777216, "usedPercent": 79.5, "publicBytes": 8352209, "waveforms": 7494},
 "writer": {"ready": true, "count": 7494, "pendingPublish": false, "conflict": null,
            "withoutWaveform": 0, "lastAudit": {"missing": 0, "orphans": 0, "…": "…"}}}
```

`ok: false` with `servingLastGood: true` means the stored catalog needs fixing;
`problem.reason` says how it is broken. The deploy check
(`scripts/verify-music-worker.mjs`) also checks the 304, a waveform and health.
