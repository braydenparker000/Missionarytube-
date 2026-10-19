# Composable Daily Board

Editable production modules live only in `frontend/daily-board/v1/`; the route
is `frontend/daily-board/index.html`. This directory contains synthetic fixtures,
local preview tools and the content-publication adapter. They import the same
schema and renderer as production. There are no mirrored production modules or
component source pins to maintain. Use `npm run test:daily-board` and `npm run build`.

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
node daily-board-next/check-browser.mjs
npm test
npm run build
```

`check-integration.mjs` exercises the actual unchanged importer and sharedStore
in a disposable copy with Node SQLite, including owner/source rejection, exact
structured readback, identical retries and ID/date conflicts. It never contacts
production. `check-browser.mjs` serves both fixtures (and an optional original reference file),
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

## Frontend publication and rollback

The existing `publish-daily-board.yml` workflow uses the unchanged Azure OIDC
identity and serial production lock. After PR review, merge and required checks,
authorized publication needs `action=publish` and the reviewed main SHA in
`expected_commit`. Leave `parent_run_id` blank: the workflow discovers the latest
successful publication and verifies its archived receipt against every live
Board file. The optional parent field is a recovery override, not source bookkeeping.

Committed source and generated build provenance must agree. The publisher saves
rollback bytes, properties and ETags before changing anything, writes only changed
Board files, preserves shared navigation, and verifies storage/public hashes plus
actual-origin Chrome behavior. Its seven-path allowlist is unchanged. Worker,
data, private frontend, music, schedules, credentials and settings are separate.

Rollback uses `action=rollback`, the publication run in `rollback_run_id`, and the
reviewed orchestration SHA. It validates all saved bytes and current state before
conditionally restoring changed files and their properties. A newer writer's
bytes, headers or metadata stop restoration. Reports and unrelated blobs stay intact.

Production run [39185533893](https://github.com/braydenparker000/Missionarytube-/actions/runs/39185533893)
verified the load-retry improvement: all seven public hashes matched, and Chrome
passed retry at 320/390px, empty-state focus recovery and a real public-feed read.
Its rollback artifact remains retained for 90 days. That run used the source
selection preceding consolidation; source consolidation is a separate review.

Preserve the existing report writer, public-content review and 07:00 Rosario cadence.
Never publish synthetic fixtures as a real edition.
