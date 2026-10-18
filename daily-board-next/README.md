# Composable Daily Board

The approved design, reusable renderer and daily structured content are separate:
`design.css`, `render.js`/`components.css`, and `schema.js` with two synthetic
fixtures. The maintained production route is `jarvis/public/daily-board`; its
component pin and full imported-source tree guard are updated explicitly.

Approved reference: Library `libfile_c72e6df1f9f08191970a2b6961c56dc5`, version 3,
`Jarvis-Daily-Board.html`, 186193 bytes, SHA256
`055a3bfd9f3db4b413f6206e0c8ee7f61fb7c71173aaac20117d334ec7818edb`.
Retrieved locally; original unchanged. `design.css` is its exact style element,
including embedded Instrument Sans variable font. Original report prose and
JavaScript are not copied. Audio matching is not a required component.

Supported components: prose, comparison, timeline, chart, local annotated image,
and a keyboard-operable explanation sequence. Optional flow, split and graphite
band compositions can appear in any order. Sources preserve publication and
 event dates, notes, and fact/forecast/interpretation labels. The report date is
explicit Rosario local date. Both fixtures are synthetic and rejected by the
publisher. Images require separate reviewed asset deployment.

The existing owner-authenticated issue importer, shared_entries SQLite storage,
public API, immutable IDs and date reservations are reused unchanged. Structured
JSON travels inside the bounded existing briefing body. Thus no Worker deployment
or database migration is necessary. The final implementation avoids a new table
or public API. Historical text remains readable; unknown structured content falls
back to its summary. No arbitrary HTML, script, CSS, SVG or formulas are accepted.
See [PUBLISHING.md](PUBLISHING.md) for the exact publishing and readback contract.
Human public-content review remains required; validation cannot determine whether
ordinary prose contains sensitive information.

## Validation

```sh
node --test tests/daily-board-next.test.mjs scripts/publish-daily-board.test.mjs
node daily-board-next/check-integration.mjs
node daily-board-next/check-browser.mjs /workspace/reference/Jarvis-Daily-Board.html
npm test
npm run build
```

`check-integration.mjs` exercises the actual unchanged importer and sharedStore
in a disposable copy with Node SQLite, including owner/source rejection, exact
structured readback, identical retries and ID/date conflicts. It never contacts
production. `check-browser.mjs` serves the original reference and both fixtures,
checks 360/390/1200 CSS pixel widths, keyboard interaction and inert text fallback.

Evidence in `evidence/`: nine browser cases without overflow or page errors,
mobile fixture captures, and approved reference first-screen capture. Screenshots
were visually inspected. Content/story count and some compositions differ: the
candidate generic timeline uses ruled items, and has no desktop reference rail.
This is an adaptation of the approved design, not a pixel-identical six-story
reproduction. No physical Galaxy A15 verification is claimed.

Initial root setup had .jarvis-source at 35bbe3ef260dec0206a57cd69aa5ec40b84c8e20
instead of required c28c1b2f70aabb5217b08bf31ffe4c93d0353765, causing 120 failures
and a refused build. An isolated checkout restored the exact required revision
from canonical history without touching the shared checkout. The initial review
candidate passed 1184 root tests and a 192-file/20.09 MiB retained-production build.
Final activation checks and deployment receipt are recorded in the PR/Actions;
these earlier counts alone are not activation evidence.

## Publication and rollback

User approval now permits this Daily Board merge/deployment. The new manual
`publish-daily-board.yml` uses existing Azure federation, preserves rollback bytes
before writing, compares blob ETags immediately before upload, verifies every
new dependency before publishing the route last, and verifies public readback.
Only the six named Daily Board blobs are writable; no Worker, private frontend,
Poweramp, schedule, credential, database, release.json or access setting changes.
The existing azure-production concurrency group serializes against other
publishers. Unknown route/dependency state fails closed. Artifact receipts retain
exact commit, component tree and file hashes.

Rollback runs the same workflow with the original run ID. It verifies the current
route is the exact candidate and restores only captured previous route bytes and
content properties with an ETag condition. New assets and all reports remain; no
permanent deletion is performed. Revert the component source pin before any later
full-site publication. Historical clients may display the structured body as text;
the activated reader displays it as reviewed components.

The parent owns automation cutover and real researched content. Preserve the
07:00 Rosario cadence. Never publish synthetic fixtures as a real edition.

Activation verification before deployment: 1186 root tests passed in the isolated
exact-pin checkout; production build passed with 197 files / 20.23 MiB. Seven
focused checks pass after adding byte-equality coverage for maintained modules.
`check-live-reader.mjs <dist-directory>` also passed against the built route under
its actual CSP: embedded font loads, an encoded synthetic API response renders,
and selection of a historical plain-text report works at 390px without overflow.
This controlled response was never published to production.
