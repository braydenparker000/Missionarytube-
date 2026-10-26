# Guitar engine

`frontend/guitar/engine.js` is a module worker built from these sources:

- `core.js`: loads a score (Songsterr revisions through the converter, or a
  Guitar Pro 3–7 file through alphaTab), renders the dark tab-only reader
  systems with bar and beat positions, builds the playback timeline (repeats
  expanded, string/fret/technique per note, tempo map, chord changes), and
  renders the A4 notation + tab systems that `frontend/guitar/pdf.js` prints.
- `worker.js`: the message protocol (`load`, `reader`, `timeline`, `print`).
- `vendor/`: the Songsterr → alphaTab converter adapted from
  [songsterr-downloader](https://github.com/Metaphysics0/songsterr-downloader)
  (MIT, `frontend/guitar/licenses/songsterr-downloader.txt`). Jarvis adds capo,
  written chord names and let ring.

`core.js` imports `frontend/guitar/chords.js` and `frontend/guitar/timeline.js`
so the page and the engine name chords and techniques the same way.

Build after changing any of these files, and commit the bundle:

```
node scripts/guitar/build.mjs
```

The first run installs the lockfile's exact versions (alphaTab 1.8.1,
opentype.js 1.3.4, esbuild 0.25.10) into `scripts/guitar/node_modules`, which is
ignored. CI never rebuilds the bundle. `pdf.js` is unchanged from the original
release and is not rebuilt here.
