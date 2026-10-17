# Home, Daily Board, My Media and Guitar UI alignment

Baseline: `8ca912e1cc0f3751bf852d6373267322c79755ff` on `release/astra-live-backport-20261009`. This is the branch receiving the current merged UI work, including #100, #104 and #124; main is behind it. Existing My Media count/sticky/card work and Guitar selection fixes are retained. This PR adds styling, not duplicate implementations of those changes.

## Reference and scope

Inspected STYLE_GUIDE.md, Relay and Muse entry pages, shell.css, premium.css, conversation.css, muse.css and the **final overrides in relay.css**. No AGENTS.md or .agents/skills files exist in this repository or the mounted workspace guidance directories.

The final Relay rules supersede its earlier light/indigo and warm-amber rules: black canvas, #303030 surfaces, #393939 raised surfaces, #f7f7f7 text, #a3a3a3 secondary text, #dce3eb focus/accent and #506d92 selected/primary fills. Muse at this baseline still loads the older warm conversation stylesheet. This change uses the newest Relay treatment for the four requested pages; Muse styling and reconciliation remain with the parent task.

Reuse: existing shell typography, SVG icons, launcher navigation/search/clock, shared sheets, media feed and player, Guitar controls and notation. One scoped stylesheet adds palette/control alignment, quieter Home sizing, readable full briefings, 48px media targets and non-color selected navigation cues. The sticky library toolbar follows the new 72px header. Shared app.js only manages the Home/Board class, stylesheet load and theme-color across SPA routes. No Relay or Muse owned files, auth, Poweramp, schedules, deployment workflow, Date lookup or YouTube Archive implementation changed.

## Verification

Real Chromium pages, local static server, fictional network data; no live writes. Screenshots are actual renders, not mockups. Inspected all four pages at phone and desktop sizes.

- Six focused browser suites: aligned-pages, launcher, My Media layout/refinement/counts, Guitar selection. Across final successful runs: **48 passed, one explicit live-thumbnail skip**. The historical refinement baseline had to be fetched before its successful rerun.
- Home: 360/390/430px and 1200px, all destinations, search, favorites editing, Back, clock rollover, safe-area fixture, reduced motion, existing shared drafts/storage isolation checks.
- Daily Board: 360/390/1200px populated, empty and service-error dialog, full multiline content, skip-to-content keyboard focus and Home navigation.
- Guitar: 360/390/1200px empty, search, song, track sheet, saved reload, search failure preserving input, enlarged text, actual worker notation and PDF download; existing selection/browser suite also passes.
- My Media: 320/360/390/430/768/1200px across suites, sticky browsing and compact/keyboard space, positive search, sorting, creators, pagination, folders, save/queue, Back/Forward/reload, progress, native video and captions, menu hit geometry, contrast and keyboard focus.
- Focused unit suites: guitar, guitar-selection, mymedia, mymedia-layout, mymedia-refinement, mymedia-counts: **48 passed**. Score tests: **4 passed**. `git diff --check` passed.

Reproduce browser coverage:

```sh
git fetch origin 8c4f6de790b3e06cd78b11706dfa2c055174bbf1
JARVIS_CHROME=/usr/bin/chromium JARVIS_LIVE_THUMBNAILS=0 JARVIS_SCREENSHOT_DIR=/tmp/ui-evidence node --test tests/aligned-pages-browser.test.js tests/launcher-browser.test.js tests/mymedia-layout-browser.test.js tests/mymedia-refinement-browser.test.js tests/mymedia-counts-browser.test.js tests/guitar-selection-browser.test.js
```

Limit: live i.ytimg.com thumbnail requests return HTTP 403 from this environment's proxy. Only that external-artwork check was explicitly disabled; fixture artwork, fallback artwork and local native playback were covered. These checks do not establish live backend/provider health, physical Android keyboard/PiP behavior, native Android file-picker behavior, or deployment qualification. No merge/deploy performed.

## Screenshots

| Page | Phone (390px) | Desktop (1200px) |
| --- | --- | --- |
| Home | [Phone](home-390.png) | [Desktop](home-1200.png) |
| Daily Board | [Phone](daily-board-390.png) | [Desktop](daily-board-1200.png) |
| Guitar notation | [Phone](guitar-score-390.png) | [Desktop](guitar-score-1200.png) |
| My Media | [Phone](mymedia-390.png) | [Desktop](mymedia-1200.png) |

Additional states: [empty board](daily-board-empty-390.png), [board service error](daily-board-error-390.png), [track picker](guitar-tracks-390.png), [Guitar search error](guitar-error-390.png).
