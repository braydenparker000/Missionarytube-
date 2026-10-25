# Daily Board v2: the premium edition format

The format Muse writes for every edition. The page draws each part with its
own design; the report only carries words and numbers. The full rules are
in [`v2/schema.js`](../frontend/daily-board/v2/schema.js), and
[`premium.json`](../tests/fixtures/daily-board/premium.json) uses every
component (it is synthetic: copy its shape, never its content).

v2 is accepted by `POST /relay/mast/board/publish` once the Worker carrying
it is deployed. Until then, publish v1. The GitHub issue fallback stays v1
only.

## The edition

```json
{"schema": "jarvis-daily-board-v2", "id": "<new lowercase UUID>", "date": "YYYY-MM-DD",
 "timezone": "America/Argentina/Cordoba", "visibility": "public", "synthetic": false,
 "title": "≤ 120", "summary": "≤ 1000",
 "edition": {"theme": "ink|ember|tide|moss|dusk|gold", "thesis": "≤ 200"},
 "stories": [ … 1 to 12 … ]}
```

- **title**: the edition's headline, set large in serif on the cover. Name
  the day's two or three main stories in plain words. No dates, no "Daily
  Board", no process notes.
- **summary**: two or three sentences a reader can stop after. Never put
  research notes in it ("research cutoff", "compared with earlier
  editions", "no assumption about…"): the page already shows the date and
  publish time.
- **edition.thesis**: optional, one sentence on what ties the day together.
- **edition.theme**: the accent colour and cover light. Vary it across the
  week; pick one that suits the day's mood (`ember` warm, `tide` calm, `moss`
  local, `dusk` reflective, `gold` bright, `ink` neutral).
- Whole report: at most 48 KB.

## A story

```json
{"id": "slug", "title": "≤ 160", "label": "≤ 80", "composition": "lead|feature|data|brief|band",
 "claim": "fact|forecast|interpretation", "dek": "≤ 200",
 "whyItMatters": "≤ 600", "whatsNext": "≤ 600",
 "disagreement": {"label": "≤ 80", "text": "≤ 600"},
 "sources": [ … 1 to 12 … ], "blocks": [ … ]}
```

- **title** is a headline with a point of view ("The harbour is busier. The
  town around it is not, yet."), not a topic label.
- **label**: section and date anchor, for example `Economy · August data
  released 21 October`.
- **dek**: the one-line story. The "In 30 seconds" list at the top of the
  page is built from every dek, so each must stand alone.
- **whyItMatters**: required except for briefs. Shown right under the dek.
- **whatsNext**: the next date or decision to watch, when there is one.
- **disagreement**: the strongest competing reading, when one exists. Write
  interpretation here instead of starting a prose block with "Interpretation:".
- **composition**:
  - `lead`: the day's main story. Exactly one per edition, first.
  - `feature`: a normal story.
  - `data`: a story carried by its figures (charts and key numbers get the
    full width).
  - `brief`: a short item: title, dek, sources, no blocks needed.
  - `band`: a set-apart panel, good for local listings.
- **Sources**: `title`, `url` (plain https, no query string), `publisher`,
  `type` (`primary`, `official`, `independent`, `analysis`), `publishedOn`,
  `eventOn` (dates or null), `note` (what it is and its limits).

## Blocks

Every block has a unique `id`, a `type`, and may carry `cites`: the numbers
of the story's sources that support it, counting from 0 (`[0, 2]`). Use
`cites` on every block that states a fact; the reader taps the marks to see
the source.

Pick the component that explains the point best. When plain text is
clearer, use prose.

| Type | Use it for | Don't use it for | Shape |
| --- | --- | --- | --- |
| `prose` | Narrative, context, quotes in passing | Lists of numbers | `text` ≤ 2000 |
| `stats` | 1–4 headline numbers with their change and date | Numbers without an as-of date | `text?`, `items: [{label, value (string, ≤ 16), change?, direction? up\|down\|flat, tone? good\|bad\|neutral, asOf, note?}]` |
| `chart` | A trend (`line`, up to 60 points), a comparison across categories (`column`, up to 12), a ranking (`bar`) | Two or three numbers (use `stats`) | `text` (title), `kind`, `unit`, `labels`, `series: [{name, values}]` (1–3 series; a bar chart has one), `note?` |
| `comparison` | Two to four options or readings side by side | A sequence | `text`, `items: [{label, text}]` |
| `timeline` | A sequence with dates, past to next | Unordered points | `text`, `items: [{label, text, date?, state? past\|now\|next}]` |
| `perspectives` | One question seen 2–4 ways (what happened / why / what next; government / opposition) | Facts that don't differ by view | `text`, `tabs: [{label ≤ 40, text ≤ 900}]` |
| `agenda` | Things happening at a time today or soon. Shown in Rosario time with an add-to-calendar button | Past events | `text`, `items: [{at: "2026-10-25T17:00:00-03:00", label, text?, place?}]` (the time must carry its offset) |
| `quote` | One sentence worth hearing in the speaker's words | Paraphrase | `text` ≤ 400, `speaker`, `role?` |
| `callout` | `unknown` (what isn't known yet), `context`, `correction`, `watch` | Decoration | `kind`, `title?`, `text` |
| `explanation` | A mechanism in 2–8 steps the reader moves through | Anything one paragraph explains | `text`, `steps` |

A good edition mixes them: across a normal day, aim for at most about 60%
prose blocks, at least two visual components, and one data component when
the brief's depth is `standard` or `deep`.

Nothing in a report is code: no HTML, Markdown, styles, scripts or embeds.
Unknown fields or block types are rejected with a 400 that names the
field (for example `Report rejected: Story 2 block 3: kind bar|column|line`).
Fix that field and publish again with the same `id`.
