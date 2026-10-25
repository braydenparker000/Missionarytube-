# Daily Board: Muse's procedure

Muse writes the Daily Board and publishes it straight to the Worker. The old
path (a JSON comment on a public GitHub issue, imported later by a Worker that
polls GitHub without a login and gets rate limited) is no longer needed.
The report format is unchanged: [`schema.js`](../frontend/daily-board/v1/schema.js),
with [`one.json`](../tests/fixtures/daily-board/one.json) as a shape example.

All calls use Muse's existing Mast token, the one it already uses for the
Jarvis chat: `Authorization: Bearer <token>`, server to server, no `Origin`
header. Base: `https://jarvis-hub-api.braydenparker999.workers.dev`.

## The board brief

The owner's choices for the board live in the Worker, so every run reads the
same brief and a change sticks:

```json
{"focus": "What the board is for, in the owner's words (≤ 1000 chars)",
 "interests": [{"topic": "AI and developer tools", "priority": "high", "notes": "optional angle (≤ 500)"},
               {"topic": "Argentina's economy", "priority": "normal"}],
 "avoid": ["celebrity gossip"],
 "regions": ["Argentina", "United States"],
 "depth": "headlines | standard | deep",
 "stories": {"min": 4, "max": 7},
 "lookbackHours": 36,
 "sources": {"prefer": ["primary sources, official data"], "avoid": ["…"]},
 "notes": "anything else (≤ 2000)"}
```

Required: `focus`, `interests` (1–30, priority `high|normal|low`), `depth`,
`stories` (1–12), `lookbackHours` (6–168). The rest is optional.

Depth means:

- **headlines**: what happened, one or two short blocks and one or two
  sources per story. A two-minute read.
- **standard**: what happened, why it matters, what comes next; two or three
  independent sources per story.
- **deep**: standard plus background, a comparison or timeline where it
  helps, competing readings labelled as interpretation, three or more sources
  including a primary one, and what is still unknown.

`GET /relay/mast/board` returns it (with `version`). To change it:

```json
POST /relay/mast/board/profile
{"version": 3, "profile": { …the whole brief… }}
```

`version` must be the one just read; a 409 means it changed in between (the
response has `current`): reapply the change to that and save again. A 400
names the field that is wrong.

### Setting it up with the owner

In the Muse chat, interview the owner once, a few questions at a time, and
offer examples rather than blank questions:

1. What is the board for: staying informed generally, work, investing,
   local life? (focus)
2. Which topics, and which matter most? (interests and priority)
3. What to skip. (avoid)
4. Which places matter? (regions)
5. How deep: headlines, standard or deep (explain the three)? How many
   stories on a normal day?
6. How far back to look: the last day, two days, a week? (lookbackHours)
7. Sources to favour or avoid.

Read the brief back in plain words, save it once they agree, and confirm it
saved. Afterwards, "more X", "less Y", "go deeper on Z" in the chat are brief
changes: read, change, save, confirm in one line.

## Each run (daily, 07:00 Rosario)

1. `GET /relay/mast/board` →
   `{today, timezone, publishedToday, missing, recent, profile, version, board}`.
   - `publishedToday: true`: stop quietly.
   - `profile: null`: don't publish. Ask the owner (once that day) to set up
     the brief.
2. Research to the brief: high priority first, within `lookbackHours`, its
   regions and sources, nothing from `avoid`, at its depth, between
   `stories.min` and `stories.max` stories (fewer on a genuinely quiet day,
   never filler).
3. Write the report: `schema: "jarvis-daily-board-v1"`, `date: today`,
   `timezone: "America/Argentina/Cordoba"`, `visibility: "public"`,
   `synthetic: false`, a new lowercase UUID as `id`, kept for this date's
   retries. Keep the whole report under about 18 KB.
4. Check before publishing: every story has dated sources; each story's
   `claim` is honest (`fact`, `forecast` or `interpretation`); links are plain
   HTTPS with no query string; **the board is public**: nothing private about
   the owner, including the brief itself.
5. Publish:

   ```json
   POST /relay/mast/board/publish
   {"report": { … }}
   → 201 {"published": true, "entry": {"id", "date", "title", "createdAt"}, "board": "https://…/daily-board/"}
   ```

   - **200 `duplicate: true`**: it was already published (an earlier retry
     landed). Done.
   - **400**: the message names the problem (`Report rejected: Invalid
     source`, a date out of range…). Fix it and publish again with the same
     id.
   - **409 with `existing`**: a different report already has this date (the
     old writer, or a second run). Don't mint a new id to get around it; tell
     the owner.
   - **5xx or no answer**: send the exact same report again. It never
     doubles.

   The report is on the board the moment the 201 or 200 comes back; there is
   nothing to poll.
6. End quietly. No message to the owner unless something failed.

`missing` lists the last 7 days without a report. Publish a missed day only
when the owner asks; the date can be up to 7 days back.

## The old writer

The external "Publish Jarvis Daily Board" automation still posts to GitHub
around 07:05. Only one report per date is ever accepted, so the two cannot
double up; whichever arrives first wins. Once Muse's first run is on the board,
the owner switches the old automation off. The GitHub path
([daily-board-publishing.md](daily-board-publishing.md)) keeps working as a
fallback.

The board page says "Today's report hasn't arrived yet" after 08:00 Rosario
when the day's report is missing.
