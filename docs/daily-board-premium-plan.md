# Daily Board premium plan

Status: approved plan, 25 October 2026. Nothing here is built or deployed yet.
Owner decisions are recorded in [section 9](#9-owner-decisions).

The goal: every edition looks and reads like a premium publication, beats
ChatGPT's GPT-6 Intelligent UI on the things a morning briefing needs, and
still shows up on time when Muse is having a bad day.

## 1. The bar: what "better than Intelligent UI" means

OpenAI shipped Intelligent UI with GPT-6 on 7 October 2026
([announcement](https://openai.com/index/gpt-6-for-everyone/)). The model
builds answers from a library of native, streamable components: charts,
diagrams, tabs, forms, calculators. A compiler draws the interface while the
model writes, and the model decides when plain text is better. Google's
[A2UI](https://a2ui.org/) protocol is built the same way: agents send
declarative component data and the client draws it with its own widgets.
Data, not code.

The Daily Board already works like that: Muse sends JSON blocks, and our
renderer draws them. So the architecture stays. What has to change is the
size of the component library, the craft of the design, and how well Muse
uses both.

ChatGPT's answers are built for one chat message: generic styling, gone once
you scroll away, no voice, no memory of yesterday. A briefing can beat that
on:

| Dimension | Intelligent UI | Premium Daily Board target |
| --- | --- | --- |
| Identity | One house style for every answer | A designed publication: masthead, cover, edition themes, serif display type |
| Structure | Ad hoc per answer | Editorial anatomy per story: dek, what happened, why it matters, what's next, room for disagreement |
| Trust | Citations at the end | Every block points to its sources; claims typed as fact, forecast or interpretation; freshness shown |
| Continuity | None across chats | Story threads across days: "Day 3 of the Brazil runoff", what changed since yesterday |
| Personal | Per prompt | Built from your saved brief, Rosario-local times and the regions you chose |
| Formats | Screen only | Screen, listen, print and PDF, offline, calendar exports |
| Reliability | On demand | Due at 07:00, checked before it goes up, a watchdog if it's late |

## 2. Where it is today (audit, 25 October)

From the six live structured editions (18–24 October) and screenshots at
390 px and 1280 px:

- **81% of blocks are prose** (100 of 123). One chart in six editions, no
  images, no maps, no key-number tiles.
- **The layout doesn't feel premium.** The edition headline wraps to six lines
  in a narrow column on desktop with no space before the summary. Edition
  choice is a native `<select>`. Comparison grids leave orphan cells.
- **Process notes leak into reader copy.** The 24 October summary ends with
  "Research cutoff: … no assumption about anyone's reading history".
  "Interpretation:" is typed by hand inside prose, so the reader can't tell
  it apart from fact at a glance.
- **Reports are near the size cap.** 11–17.6 KB against a 20 KB limit, so
  richer blocks won't fit.
- **Days were missed.** 17 and 19 October have no report.
- **Everything ships through one font** (Instrument Sans as base64 inside a
  140 KB `design.css`). There's no motion system.

What's already good and stays: strict schema validation, no report code ever
runs, sources with publish and event dates, claim labels, the
one-report-per-date guarantee, idempotent retries, and a fallback to plain
text.

## 3. Architecture

Keep the pattern, version the contract.

- **New schema `jarvis-daily-board-v2`** in `frontend/daily-board/v2/schema.js`,
  shared by the Worker (`prepare`) and the browser, like v1. `decodeReport`
  dispatches on `schema`. The v1 renderer stays for history. Unknown block
  types still fail closed.
- **A larger size cap for v2 on Muse's direct path**: 48 KB. Raise
  `backend/shared.js`'s briefing limit for entries that carry a v2 envelope
  only. The GitHub importer path stays at 20 KB with v1.
- **An edition-level design layer.** The report picks one of about six
  curated themes (`theme: "ink" | "ember" | "tide" | …`, all dark) and a cover style.
  It never supplies raw colours or CSS, so every edition looks designed
  without any styling coming from the report itself.
- **Block-to-source links.** Every block can carry `cites: [0, 2]`, indexes
  into the story's sources. The renderer draws footnote markers that open a
  source card.
- **Assets** (images, audio) are uploaded separately and referenced by
  content hash, never by URL (section 5.5).

Ordering rule for every phase: the schema and renderer ship to the page, the
Worker ships, and only then does Muse's procedure mention the new feature.
Until then, the Worker rejects a report that uses a new block with a clear
400, so nothing breaks on the page.

## 4. Component library v2

Each component is data only, with fixed limits, and drawn by our code. Muse
gets a cookbook entry for each one: when to use it, when not to, and a good
and a bad example.

**Edition level**

1. **Cover.** Masthead, date, edition number, theme, and either cover art
   (5.5) or a generated pattern drawn from the date (always available, no
   asset needed), plus a one-line "edition thesis".
2. **The 30-second board.** Built from each story's `dek`. One line per story;
   tap a line to jump to its story. Shows reading time and story count.
3. **Since yesterday.** Short deltas for continuing threads ("Brazil: polls
   closed; count under way"). Built from `thread` links (section 6).

**Story anatomy** (fields, not prose)

4. `dek` (≤ 160 chars), `whyItMatters`, `whatsNext`, and an optional
   `disagreement`: the strongest competing reading, labelled. These are the
   Semafor and Axios structures, given their own visual treatment.
5. **Story compositions**, expanded from `flow | split | band` to
   `lead | feature | data | brief | band`. The lead gets a big headline and
   cover art. `brief` is a two-line item for quiet news.

**Blocks**

6. **Key numbers.** One to four tiles: value, unit, change and direction,
   `asOf`, citation. Tabular numerals, with an optional tiny trend line.
7. **Chart v2.** Line, bar, grouped bar or diverging. Up to three series and
   60 points, an annotation layer ("rate cut here"), an accessible data table
   behind a toggle. Hand-built SVG, no library.
8. **Perspectives.** Two to four tabs on one question ("What happened /
   Why it matters / What's next", or "Government's view / Opposition's
   view"). Keyboard-accessible tabs, with a print fallback that shows them all.
9. **Timeline v2.** Dated entries, a "you are here" marker, past versus
   scheduled styling, and an optional thread link to an earlier edition.
10. **Explainer stepper.** Today's `explanation` block upgraded: each step can
    highlight part of an attached diagram or chart.
11. **What-if.** A slider over a precomputed table that Muse supplies (for
    example, peso at −10…+10% → price of a basket). The page only looks values
    up; it never evaluates a formula.
12. **Map.** Locally shipped SVG base maps (Argentina by province, South
    America, world; Natural Earth, public domain, simplified at build time)
    with pins, highlighted regions and labels. No map service and no CSP
    change.
13. **Watch today.** Dated agenda items with times shown in Rosario time
    ("Brazil polls close 17:00 Brasília · 17:00 here"), each with an
    add-to-calendar `.ics` generated in the browser.
14. **Quote.** A pull quote with speaker, role and citation.
15. **Callouts.** `unknown` (what isn't known yet), `context`, and
    `correction` (links the edition and story it corrects).
16. **Image.** Uploaded editorial art or a licensed photo, with alt text, a
    credit, and a required `kind: illustration | photo`. AI art always shows
    "Illustration".
17. **Source cards.** Publisher, title, dates, `type: primary | official |
    independent | analysis`, and a freshness badge ("published 3 h before this
    edition").

## 5. Design system

**5.1 Type.** Add an open-licence (OFL) serif display face for headlines and
decks: shortlist Newsreader, Fraunces, Source Serif 4. Keep Instrument Sans
for UI and labels. Self-host subset WOFF2 files instead of base64; that's a
CSP change (`font-src 'self'`) and roughly 100 KB smaller CSS. Use
`text-wrap: balance` for headlines, `pretty` for prose, a 62–70 character
measure, tabular and old-style numerals where each fits, and hanging
punctuation for quotes.

**5.2 Layout.** A 12-column grid on desktop and a single column on phones.
The cover and lead story use the full width. Data stories put the chart
beside the text. Briefs run in a two-column band. Fix today's headline column
and orphan grid cells.

**5.3 Themes.** Dark only: today's "ink" look, refined. No light theme and no
theme switch. Edition themes add an accent colour and cover treatment within
the dark design.

**5.4 Motion.** View Transitions for switching editions. Restrained reveal on
scroll. All of it off under `prefers-reduced-motion`. A skeleton screen
instead of "Opening your Daily Board…".

**5.5 Imagery.** Reuse the signed-upload pattern Muse already uses for music
art (`docs/muse-music-sop.md`, Ed25519 signed calls to the Worker). Add a
board asset endpoint that checks the file's actual bytes (magic bytes), size
(≤ 400 KB WebP or AVIF), dimensions, and SHA-256. Images are served from the
Worker with safe headers and referenced in the report by hash. This needs a
CSP `img-src` addition for the Worker origin. Policy (owner decision):
editorial AI illustration is the default, always labelled, and never a
photoreal depiction of real people or events. Real photos are used in the
rarer cases where they are clearly better (a place, a launch, a document),
only with the licence recorded (for example, Wikimedia Commons with author and
licence, or an official press image). The generated date pattern is the
fallback, so a missing image never looks broken.

**5.6 Accessibility.** WCAG 2.1 AA, keyboard-only use, 200% zoom, 360 px
width, screen-reader labels on every interactive block, a data table behind
every chart. These follow the rules already in `docs/PRODUCT-DIRECTION.md`.

## 6. Reader features

- **Editions by date**: a calendar strip instead of the dropdown, sorted by
  report date, which also fixes the issue where a late-published report jumps
  to the top. Previous and next edition controls.
- **Threads**: a stable `thread` ID (for example `brazil-runoff-2026`) on a
  story. The page shows "Day 3 · follow this story", links earlier
  installments, and powers "Since yesterday".
- **Listen**: start with the browser's built-in speech (`speechSynthesis`),
  free and no CSP change. Later, a Muse-produced audio edition using Muse's
  podcast skill, uploaded through the same asset path.
- **Read state**: unread dots and progress, saved on the device.
- **Search** across loaded editions, done in the browser.
- **Offline and installable**: a service worker caches the latest edition
  and its assets, plus a web app manifest.
- **Print and PDF**: a print stylesheet that opens every tab and step.
- **Deep links**: `#story-<id>` already exists. Add a share button that copies
  the link.

## 7. Making Muse reliable

This is the part most likely to fail, so it gets the most layers.

**7.1 A better contract.** Rewrite `docs/muse-daily-board.md` as a style
guide and component cookbook: the edition structure, voice rules (no process
notes in reader copy, a typed `disagreement` instead of inline
"Interpretation:"), a decision table for which block fits which situation,
and two complete gold-standard example editions (flagged synthetic) that
Muse reads every run.

**7.2 A dry-run check in the Worker.** `POST /relay/mast/board/check` takes
a draft and returns `errors` (would be rejected), `warnings`, and a
`score`. Checks:

- Variety: prose share at most 60%, at least two visual blocks, at least one
  data block when the brief's depth is standard or deep.
- Sourcing: sources per story meet the depth's minimum, at least one primary
  source on deep, source `publishedOn` within the brief's `lookbackHours`.
- Craft: headline and dek lengths, every story has a `dek` and
  `whyItMatters`, numbers carry `asOf`, process phrases ("research cutoff",
  "no assumption about") in reader copy are flagged.
- Coverage: high-priority topics in the brief appear; nothing from `avoid`.
- Continuity: a story too similar to one from the last three editions
  without a `thread` link is flagged.

Errors block publishing. Warnings don't: Muse fixes them once, then
publishes, so the board never fails to appear over style alone. The score is
saved with the edition for tracking.

**7.3 Drafts and visual preview.** `POST /relay/mast/board/draft` stores one
draft per date, private and expiring. `/daily-board/?draft=<token>` renders
it. Muse has a full browser in its Secure VM, so its run becomes: research →
write → check → draft → **look at it** → fix → publish.

**7.4 A connector instead of hand-written HTTP (to verify).** Muse supports
custom connectors. The Worker already runs MCP servers (`backend/connector.js`,
`relay-connector.js`). A small board connector (`board_read`, `board_check`,
`board_draft`, `board_publish`, `board_profile`) with typed inputs would
remove a whole class of request mistakes. First, confirm that Muse's custom
connectors can call a remote MCP server and how they authenticate.

**7.5 Watchdog.** A Durable Object alarm at 07:45 Rosario checks
`publishedToday`. If no report has landed, it notifies the owner through the
existing Jarvis inbox or relay events, and records the miss.

**7.6 Backup writer: not now.** A Claude cloud session could write the
edition when Muse misses 08:00 (the "Jarvis Claude" scheduled-task pattern,
`docs/jarvis-claude.md`). The owner declined it for now; Muse is the only
writer and the watchdog is the safety net.

**7.7 Scorecard.** Store each edition's score, publish time and warnings.
Add a weekly owner-only summary (on time, missed days, average score,
component variety) and a board entry in `evals/`.

**7.8 Feedback: through the brief.** No feedback controls on the page (owner
decision). Changes go through the Muse chat as brief edits ("more X, less Y"),
which `board_profile` already supports.

**7.9 Known Muse limits.** The owner is already on a paid Muse plan, so a
deep daily run with images fits. Muse launched in the US first. Web pages Muse reads can contain prompt
injection: the schema limits what a report can do, and the check endpoint
flags anything off-brief.

## 8. Delivery plan

Three PRs, each with tests, each following the README release path: merge →
successful Validate → **Deploy to Azure Storage** with `expected_commit` for
the page, then **Deploy verified music Worker** for the Worker. Every deploy
needs the owner's explicit approval. Fewer, larger PRs are possible because
one PR can carry both page and Worker changes; the order only matters at
deploy time (page first, then Worker, then Muse's procedure).

| PR | What ships | Main files | Proof |
| --- | --- | --- | --- |
| 1. Premium board | v2 schema and renderer dispatch, 48 KB cap for v2, edition themes, the premium dark design (type, grid, cover, the 30-second board, date edition picker, skeleton, motion; v1 editions benefit too), and component set A: story anatomy fields, key numbers, chart v2, perspectives, callouts, quote, watch today, source cards with `cites` | `frontend/daily-board/v2/*`, `index.html` (CSP), `live.js`, `backend/shared.js`, `backend/relay-mast-board.js` | Schema unit tests; one fixture per component; v1 history renders; screenshots at 390 and 1280 px; axe-core clean; keyboard tests; CSP check (`scripts/verify-daily-board.mjs`) |
| 2. Muse reliability | `check` and `draft` endpoints, draft preview page, 07:45 watchdog, scorecard, rewritten Muse procedure with two gold editions | `backend/relay-mast-board.js`, `backend/relay-mast.js`, `docs/muse-daily-board.md` | `backend/tests/relay-mast-board.test.js` extended; one supervised Muse run from draft to publish |
| 3. Media and continuity | Signed board asset uploads (illustrations and licensed photos), maps, timeline v2, explainer stepper, what-if, Listen, threads and "since yesterday", read state, search, offline, print | New `backend/board-assets.js`, `v2/maps/*.svg`, a service worker | Byte-validation tests; image and CSP browser tests; offline test; size budget |

Muse's procedure moves to v2 after PR 1 is live, and gets its full rewrite in
PR 2. PR 3 adds one cookbook section per new feature.

**Tools and resources**

- Testing: Node's test runner, Playwright with the preinstalled Chromium,
  axe-core (dev only), screenshot comparison at fixed widths,
  `scripts/verify-daily-board.mjs` for CSP and fonts, and a performance budget
  (under 150 KB of JS and CSS on first load, excluding fonts).
- Design: OFL fonts subset with fonttools; Natural Earth base maps simplified
  with mapshaper at build time; hand-built SVG charts; View Transitions API;
  Web Speech API.
- References: OpenAI's Intelligent UI post (component library, when to use
  text), A2UI v0.9 (catalog and data-binding ideas), Semafor and Axios story
  structures, The Economist Espresso (finishable daily edition).
- Muse: Secure VM browser (for previewing drafts), image generation,
  podcast skill, scheduled tasks, custom connectors, the signed upload
  pattern it already uses for music.

## 9. Owner decisions

Recorded 25 October 2026.

1. **Images**: AI editorial illustration by default (labelled, never
   photoreal people or events); real, licensed photos in the rarer cases where
   they are better.
2. **Backup writer**: not now.
3. **Feedback controls on the page**: no. Brief changes go through Muse.
4. **Muse plan**: already on a paid plan.
5. **Look**: dark theme only.

## 10. Risks

- **Muse quality drifts.** Covered by the check endpoint, gold editions and
  the scorecard. Hard errors stay narrow so the board still
  appears.
- **Richer reports cost more to research.** Watch the Muse usage meter in
  the first week; the brief's `depth` and `stories` settings control cost.
- **Imagery can mislead.** AI art must be labelled and can't depict real
  people or events photorealistically; photos need a recorded licence. The generated pattern is always available instead.
- **Weight and speed.** Fonts get subset, maps simplified, and images capped
  at 400 KB, with the performance budget enforced in tests.
- **Cache mismatch during a deploy.** Ship order (page, then Worker, then
  procedure) and fail-closed validation keep an old page from seeing blocks
  it doesn't know.
