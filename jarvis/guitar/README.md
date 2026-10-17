# Guitar v1

Native page: `public/guitar/`. The hub entry is defined in `public/assets/hub.js`.
No playback, GP/MIDI export, library, cloud save, account or AI functionality.

## Pipeline

The existing Worker handles `GET /guitar/search?q=…`, `GET /guitar/songs/:id`
and `GET /guitar/songs/:id/score?revision=…&parts=0,1` behind Jarvis's existing
origin checks. Search uses Songsterr's own `/api/songs` endpoint. Metadata comes
from the page's `state.meta.current`; selected parts come from Songsterr's revision
CDN. No arbitrary proxy URLs, persistent cache, new bindings or paid services.

The browser starts a disposable module Worker only after Download PDF. It reuses
the reference score builder and alphaTab's SVG system renderer. Bravura symbols
become vector paths, so missing music fonts cannot silently erase notation in
the PDF. jsPDF/svg2pdf place complete systems onto A4 pages with 10 mm margins.
Every master measure must occur in the render output or generation fails.
Rendering is isolated from the UI, bounded by a 120-second generation deadline,
and terminated on timeout. All controls lock until generation finishes.

Part requests are selected by the real `partId`, never a search-result array index.
The revision is rechecked before generation so a changed arrangement cannot
silently select the wrong player. Up to 12 tracks, 2,000 measures per track,
6 MiB per upstream response and 12 MiB combined revision text. Failure of any
selected part fails the whole request; missing parts never become blank staves.

## Reference provenance and adaptations

Reference: https://github.com/Metaphysics0/songsterr-downloader
Pinned revision: `097ee38212715307929b54627c79fbd8af9e41cc`.
MIT notice: `public/guitar/licenses/songsterr-downloader.txt`.

`vendor/` contains the existing score-building implementation, duration mapper,
instrument mapper and types. Changes are limited to relative imports, exposing
`buildScore`, removing GP7/MIDI export-only code, removing the exporter credit
from the score and using raw MIDI percussion IDs for direct alphaTab rendering
(GP7-only articulation indexes are inappropriate without the GP7 round trip).
Direct rendering also requires visible rests (`isEmpty=false`); only synthetic
secondary-voice padding stays invisible. Section text is printed once rather
than duplicated as both marker and label. The observed `upwards` slide is accepted as an alias of `out_up`, parallel to the
existing `downwards` alias. All remaining technique conversion stays upstream.

Print settings separately apply the conventional octave display for guitar/bass,
black secondary voices, neutral measure numbers, and automatic measure spacing across an 840-unit score width. Multiple selected
guitars print as consecutive complete parts, avoiding staves compressed to fit
a single page. SVG dominant baselines are translated to the alignment-baseline
attribute supported by svg2pdf.
Header/footer partials are omitted: Jarvis supplies wrapped title, artist, track
and page numbering. Notation, tempo, sections, repeats and alternate endings
remain in alphaTab's system output. Unsupported upstream effects cause a quiet
post-download warning rather than a false claim of exact reproduction.

alphaTab is unmodified MPL-2.0; its source is available at
https://github.com/CoderLine/alphaTab/tree/v1.8.1 . Bravura is SIL OFL.
Dependency notices and licenses are served under `/guitar/licenses/`.

## Build and verification

```
npm ci
npm run build:guitar
npm test
npm run test:guitar-score
npx wrangler deploy --dry-run --config backend/wrangler.jsonc
```

Generated bundles and font are checked in so both existing static deployment
workflows continue copying `public/` without a new build stage. The renderer,
font and PDF bundle together are about 2.3 MiB, fetched only for PDF generation.
`node scripts/dev-guitar.mjs` starts a development page/API on port 8787.
Its `/guitar/qa-mobile.html` route serves the 390 × 844 browser harness from
`tests/`; it is not included in the production static files. Select a captured
fixture JSON for repeatable failure and layout checks, or leave it empty to use
the development API directly.
`node scripts/qa-songsterr-live.mjs /tmp/guitar-live-fixtures.json` captures live
responses for reproducible browser testing; it uses curl only as the local
environment's transport adapter. This is not production code or a fallback API.

## Deployment gate

Deploy `backend/worker.js` with `backend/wrangler.jsonc` to the existing
`jarvis-hub-api` Worker. Confirm live search and score retrieval from both
existing frontend origins, then run browser downloads against the live service.
Update `jarvis-release.json` in `braydenparker000/Missionarytube-` to the verified
Jarvis source commit only after those checks. The existing Storage workflow
preserves rollback bytes and validates the shell before promoting its homepage.

The Worker and primary Storage release are deployed and live downloads have
passed. See `docs/guitar-validation.md` for the release commits, verification
evidence, and the remaining physical-device testing limitation.
