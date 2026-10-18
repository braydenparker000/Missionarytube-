# Daily Board review candidate

Implemented against canonical `braydenparker000/Missionarytube-` at
`64ac7e70db402a1cd3be73217b46e845762f2981`. This directory is **not included in
the production build**. No source pin, workflow, schedule, credential, database,
public issue or production asset was changed. Mast's Poweramp work is untouched.

## Reference and separation

Approved Library item: `libfile_c72e6df1f9f08191970a2b6961c56dc5`, version 3,
`Jarvis-Daily-Board.html`, 186193 bytes, SHA256
`055a3bfd9f3db4b413f6206e0c8ee7f61fb7c71173aaac20117d334ec7818edb`.
Retrieved independently and verified locally. Original remains unchanged at
`/workspace/reference/Jarvis-Daily-Board.html`.

- `design.css` is the original HTML's exact style element, including its offline
  Instrument Sans variable font, black background, graphite surfaces, typography,
  spacing, interaction colors, safe-area and reduced-motion rules. Existing
  example-specific CSS remains inert where no component uses it. No original
  report JavaScript or personalized prose is copied into the renderer.
- `render.js` owns reusable, text-safe components: prose, comparison, timeline,
  chart, local annotated imagery and a keyboard-operable step explanation.
  `components.css` contains the small layout additions. Three optional story
  compositions are flow, split and graphite band; any order and count from
  one to twelve stories is valid. No section or experiment is mandatory.
- `schema.js` validates daily JSON independently of presentation. Limits include
  20,000 UTF-8 bytes/report, 12 stories, 16 blocks/story and eight visual items.
  IDs are stable and unique. Unknown fields, schemas and block types fail closed;
  the reader retains legacy text for an unsupported report. All report strings
  enter the DOM through textContent; no HTML, script, arbitrary SVG, CSS, formulas
  or embedded remote content is accepted.
- `fixtures/one.json` uses comparison and timeline; `two.json` uses chart,
  interactive explanation, prose and annotated schematic. **Both are synthetic**,
  visibly labeled, and refused by the offline publisher. Neither is a daily news
  report. Values and events are invented demonstration data, not statistics.

Sources retain separate publication and event dates (including explicitly
undated sources), explanatory notes, and fact/forecast/interpretation labels.
Report date is explicit Rosario local calendar date; timezone is
`America/Argentina/Cordoba`. Transport publication time remains the existing
trusted comment timestamp, separate from those dates. No prior editions or
historical series are fabricated.

## Existing flow and implementation boundary

The inspected importer accepts authenticated owner comments from legacy
`braydenparker999/jarvis#2`, with a separately enabled destination issue reader.
The destination configuration supports the reserved `Missionarytube-#250`.
Source comments are journaled; `sharedStore` writes `shared_entries` and
`shared_briefing_dates`; public state/history APIs feed text cards. The supplied
operational history says the additive reader is enabled and publisher switching
is deferred. **This task did not query or change live settings.**

Root component manifests still pin the existing Daily Board route separately
from shared assets. Imported source has an explicit tree-integrity boundary.
Consequently, `integration.patch` is prepared but unapplied; it modifies only
`jarvis/backend/shared.js`, `publications.js`, and `worker.js`. It passes
`git apply --check` at the recorded base. The maintained-tree integrity pin must
be updated in the reviewed activation change, not silently bypassed here.

The patch retains existing owner/source authentication and journaling, validates
an optional report on existing briefing publications, and adds a GET-only
`/shared/report?id=<uuid>` read. It intentionally leaves immutable public-history
entry fields and digests unchanged. The staged `live.js` uses the existing shared
API to list legacy briefings, then optionally retrieves the structured sidecar;
unavailable/unsupported data leaves the text readable. The public message path
still projects only user `id` and `body` and cannot submit reports.

`store.js` uses the same SQLite-backed Durable Object, a sidecar keyed by the
existing briefing UUID, and the existing date reservation. Legacy insertion and
sidecar insertion share a transaction. Canonical equality makes repeated content
idempotent and changed content a conflict. Readback is validated and compared by
`verifyReadback`. Migration is explicit; runtime reads never auto-create tables.
The sidecar read does not trigger a new GitHub fetch or change scheduler budgets.

`publisher.mjs` prepares a local JSON file only, with exclusive creation and no
network calls. It requires explicit public-content review, rejects synthetic
fixtures and bounds the complete envelope to the existing 30,000-character
importer limit. Public is the only accepted visibility. This is **not automated
classification of sensitive prose**: a human must review every source, image and
text before setting the review attestation. URL validation rejects credentials,
query strings, fragments, non-HTTPS schemes and literal private-network hosts;
links are navigational, never server-fetched. Images must be reviewed local
raster assets. No private workspace content was used in the fixtures.

## Reproduction and evidence

From repository root:

```sh
node --test tests/daily-board-next.test.mjs
node daily-board-next/check-integration.mjs
node daily-board-next/check-browser.mjs /workspace/reference/Jarvis-Daily-Board.html
node daily-board-next/stage.mjs
node_modules/.bin/esbuild daily-board-next/live.js --bundle --format=esm --external:/assets/* --outdir=/tmp/daily-board-review-bundle
git apply --check daily-board-next/integration.patch
```

The preview is `daily-board-next/index.html`, served over local HTTP. Select One
or Two to inspect the independent fixtures. `stage.mjs` prepares the proposed
live route only under `/tmp`; it does not alter `dist`, manifests or pins.
The integration check applies the patch to a disposable copy, compiles the
patched Worker, and runs the **actual** importer and sharedStore against Node
SQLite. Its temporary migration is local only, never a live DO/D1 operation.

Verification on 2026-10-18, Node v24.19.0:

- Focused unit/persistence suite: 4 tests passed, 0 failed.
- Patched Worker ESM bundle compiled. Real importer/SQLite integration passed:
  owner/source rejection, report acceptance, idempotent retry, visual-only
  conflict, private visibility rejection, exact readback, unchanged legacy
  public entry shape, and rollback retaining legacy text.
- Browser: 9 Chromium cases, reference and both fixtures at 360, 390 and 1200
  CSS pixels. No horizontal overflow or page errors. Explanation keyboard End
  key and inert unknown-report/HTML-looking legacy fallback passed.
  Evidence: `evidence/browser-results.json`, mobile full-page fixture captures,
  and approved-reference first-screen capture. Mobile captures were visually
  inspected; they retain black, font, ruled sections and graphite band treatment.
  This is not a pixel-identical reconstruction of the reference's six stories:
  content, story count, desktop rail and some bespoke visual treatments differ.
  The generic timeline uses ruled chronological items rather than the reference's
  decorative stem. Visual design acceptance remains open.
- Candidate frontend ESM bundle: 10.3 KB (unminified JS; embedded font CSS separate).
- Initial root `npm test`: 1067 passed / 120 failed, caused by the pre-existing
  `.jarvis-source` setup missing pinned commits/files. Initial root build refused
  HEAD `35bbe3ef260dec0206a57cd69aa5ec40b84c8e20` against required
  `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`. Expected pins were not changed.
- Restored the required revision **in isolation**, mirroring the workflow's exact
  checkout: local shared clones of canonical history into
  `/tmp/daily-board-qualification` and its `.jarvis-source`, detached the latter
  at `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`, copied this candidate, reused
  installed node_modules. Original shared checkout stayed untouched.
  `npm test`: **1184 passed, 0 failed**, 29.752 seconds.
  `npm run build`: **passed**, 192 files, 20.09 MiB, no media payloads.
  This root build verifies retained production behavior; it does not include
  this review-only candidate. Candidate builds are identified separately above.

No physical Galaxy A15 test, live Worker readback, live content publishing,
full Cloudflare runtime integration or production deployment is claimed.

## Migration, rollback and approval gates

1. Review visual adaptation, schema/components, public-content rules, integration
   diff and the actual deployed Worker component identity (the imported source
   is not automatically the live Worker). Rebase this small patch onto that
   qualified identity if needed; retain unrelated Worker/Poweramp changes.
2. Qualify the integration and component build; approve the maintained-source
   boundary update, exact new route/assets and release pins through the existing
   component publishing SOP. Do not switch the entire shared assets tree.
3. With separate database approval, export the affected object's state and run
   `migrations/001-up.sql` inside the existing shared DO transaction after
   sharedSchema. It creates one sidecar table; no destructive rewrite/backfill.
   No D1 database, new Worker, new schedule or new credential is needed.
4. Deploy the approved Worker reader before publishing structured content. Old
   writers remain valid. Deploy the reviewed static route and dependency closure
   through the existing guarded publisher, with CSP allowing the embedded font.
5. Review real public content, prepare its envelope locally, use the existing
   authenticated issue writer, and verify full structured readback by ID.
   Only after that validation consider the separately deferred writer switch
   to issue #250. Do not publish the synthetic fixtures or create test entries
   on the public board. Preserve source and date conflict handling.
6. Roll back by disabling the new writer first, restoring the previously pinned
   frontend/Worker, and retaining legacy rows/journals/date reservations. Keeping
   the unused sidecar is the least destructive rollback. If its removal is
   separately approved, export payloads and apply `001-down.sql`; it only drops
   that sidecar. Old readers continue to show the legacy text.

Workflow side effects were inspected before deciding not to push: root Validate
runs on pull requests; Azure deployment listens to main pushes including
`tests/**`; other main-push/workflow-run verification jobs exist. A future PR
must remain draft; merging is not authorized and can trigger downstream work.
There is no new workflow or publish switch in this candidate. All publication,
merge, deployment, migration, schedule and access changes remain pending approval.
