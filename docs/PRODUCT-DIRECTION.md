# Astra product direction and execution plan

Status: approved direction, implementation in progress  
Product thesis: **Astra is a private media observatory** — a quiet, artwork-led place to decide what to watch or hear, understand why it is available, and begin playback without surrendering personal data or control.

## 1. Quality bar

Astra is finished when it feels deliberate on a Samsung Galaxy A15 in Chrome, not merely when it renders correctly on a development laptop. Every release must preserve the existing static-Azure architecture, local-first data model, add-on protocol, YouTube relay boundary, and explicit source selection.

The experience should combine:

- the immediate legibility and restrained navigation of a premium streaming app;
- the editorial confidence and artwork respect of a curated cinema service;
- the source transparency and playback control of a serious personal media client;
- the privacy and durability of a local-first tool.

The visual ratio is 70% Midnight Gallery, 20% Observatory, and 10% Signal Deck. Astronomy appears through naming, spatial rhythm, orbits, coordinates, and restrained line work—not starfields, decorative gradients, or sci-fi chrome.

## 2. Non-negotiable constraints

- Remain a framework-free static web application deployed to Azure Storage.
- Keep all personal state in the browser. No accounts, analytics, tracking, or server-side profile.
- Preserve Player V3, the current add-on contracts, and the YouTube relay architecture.
- Never autoplay a title, episode, countdown, or failover choice without a user action.
- Never imply that a recommendation is personalized when Astra has insufficient local evidence.
- Never hide an incompatible source; explain its compatibility and let the viewer choose.
- Keep the four primary destinations: Home, Search, Library, Settings.
- Support Android Chrome first, then modern desktop Chrome. No PWA or framework migration in this program.
- Honor safe areas, keyboard access, 200% text zoom, forced focus visibility, and `prefers-reduced-motion`.

## 3. Measurable experience budgets

These are release gates, not aspirations.

| Area | Budget |
| --- | --- |
| Input response | A local tap, filter, or navigation action visibly responds within 100 ms. Target field INP is 200 ms or better. |
| Route change | Primary navigation settles in 180–260 ms; no route choreography exceeds 360 ms. |
| Motion | Animate transform and opacity only for page/card choreography. One active page transition at a time. Reveal at most 12 items per batch with total stagger capped at 240 ms. |
| Initial Home DOM | At most 72 media cards and 1,400 total elements after the first settled render. |
| Inactive routes | An inactive catalog route retains state and scroll data, not its heavy card DOM. No more than one heavy catalog surface remains mounted. |
| Progressive catalog | Render the lead deck and at most three catalog rows initially. Append more rows only near the viewport, in batches of at most two. |
| Images | Artwork is natively lazy-loaded outside the lead deck, has reserved aspect ratio, and cannot cause horizontal layout shift. |
| Effects | Persistent backdrop blur is limited to the top bar and mobile dock. At widths up to 419 px, prefer opaque surfaces or reduced blur. |
| Network truth | Every remote lane exposes loading, empty, timeout, and failure states independently. Late results cannot replace a newer query or title. |
| Narrow layout | No horizontal page overflow at 360, 412, 834, or 1069 CSS px. Primary controls remain at least 44×44 px. |
| Text scaling | Core journeys remain usable at 200% text zoom with no clipped action labels or unreachable controls. |
| Regression | Unit/integration checks, production build, browser journeys, and security checks must all pass before merge. |

Real-device acceptance on the Galaxy A15 is the final authority where a synthetic metric and felt smoothness disagree.

## 4. Information architecture

### Home — Tonight

Home answers “what can I continue or choose now?” in this order:

1. **Continue** appears first when genuine progress exists and never invents an entry.
2. **Tonight** is one decisive lead surface derived from available catalogs and local signals. It states the reason for the choice.
3. **Your Orbit** contains Saved, Recent, and Finished entry points when those collections exist.
4. **Sectors** are provider-owned catalog rows with honest provider/type labels and user-controlled order.

The lead surface uses one dominant artwork, one title, one concise rationale, and at most two actions. It is not an endlessly rotating billboard. Automatic motion pauses for reduced motion, document invisibility, and user interaction.

### Search — universal command surface

Search accepts titles, people, genres, content types, and YouTube URLs in one field. It returns:

1. immediate local matches from loaded metadata, history, and library;
2. independent add-on provider lanes;
3. a separate YouTube lane when enabled;
4. precise progress copy while providers are pending;
5. provider-specific recovery without discarding successful lanes.

Lightweight query interpretation may recognize phrases such as “movie under two hours” only when each applied constraint is visible and removable. Astra must not pretend to understand unsupported natural language.

### Dossier — one continuous title journey

Opening artwork leads to a single dossier arranged as artwork, decision, story, episodes, and sources. The dossier preserves media identity across providers, keeps season/episode order deterministic, and scopes every remote response to the title that requested it.

### Library — personal shelves

Library contains In Progress, Saved, Recent, and Finished. Empty states explain how an item reaches each shelf. Completion and progress are based only on actual playback events.

### Settings — Control Room

Settings groups Home layout, providers, coverage/health, playback, YouTube, audio, and local data. Each screen explains impact before controls. Destructive data actions are isolated, explicit, and recoverable through export where possible.

### Player and source selection

The source picker stays user-initiated, one-handed, and information-rich. Compatibility, quality, release detail, audio, subtitles, and provider remain inspectable without turning each row into a wall of text. Playback continuity preserves position across compatible delivery or quality changes and never loops failover.

## 5. Delivery sequence

Each stage ships as a focused pull request from fresh `main`, passes all gates, and is squash-merged. If a stage misses its acceptance criteria, revert that squash commit rather than layering fixes over uncertain behavior.

### Stage 1 — application entry and release ownership

**Purpose:** make the app reviewable and cache-safe without changing the interface.

Changes:

- move the application IIFE out of `index.html` into `assets/js/app.js`;
- move the tiny early `.js` class bootstrap into `assets/js/bootstrap.js`;
- declare the release once in a version meta value and resolve all local asset cache keys during build;
- make tests inspect the external application source explicitly;
- fail the build on an unresolved release placeholder or mismatched visible version.

Acceptance:

- source HTML contains only shell markup and ordered external scripts;
- application dependencies load before `app.js`;
- the built HTML has one consistent semantic release value and no placeholder;
- all existing behavior tests and the production build pass;
- rendered production is visually unchanged.

Rollback: revert the single stage commit; storage schemas and behavior are unchanged.

### Stage 2 — route ownership and bounded rendering

**Purpose:** remove the measured source of mobile jank: inactive screens retaining thousands of nodes.

Changes:

- add a route runtime with generation tokens, abort signals, disposal callbacks, and stored scroll position;
- release heavy Home/Search/Library DOM when another heavy route becomes active;
- split Home into lead, initial sectors, and IntersectionObserver-driven sector batches;
- cap discover results per mounted batch and append on demand;
- stop image, observer, timer, and animation work when its route loses ownership;
- apply `content-visibility` only where it improves offscreen layout without breaking focus or accessibility.

Acceptance:

- navigation between Home and Search never leaves both full catalogs mounted;
- the settled initial Home and reveal budgets in section 3 pass in an automated DOM-budget test;
- returning restores route state and approximate scroll position;
- stale route work cannot write into the current page;
- no focus target is removed while it owns focus.

Rollback: route runtime is additive; revert to the previous persistent-page behavior without changing stored data.

### Stage 3 — Home: Private Observatory

**Purpose:** make the first screen decisive, personal, and visually ownable.

Changes:

- implement Continue, Tonight, Your Orbit, and progressively revealed Sectors;
- replace the billboard carousel with a restrained lead composition and explicit rationale;
- derive the artwork accent locally while preserving text contrast and the blue action color;
- use responsive editorial crops and calmer typography at 360–419 px;
- retain Home layout controls and provider attribution.

Acceptance:

- the first viewport contains one clear decision and no competing carousels;
- no section appears without real backing data;
- zero progress produces no Continue section;
- lead artwork failure has a composed, readable fallback;
- reduced motion produces the same hierarchy with no timed rotation.

Rollback: keep the Stage 2 renderer and restore the previous Home templates.

### Stage 4 — universal Search

**Purpose:** make discovery fast before the network and honest while the network works.

Changes:

- render local results synchronously;
- present remote providers as independent lanes with live status;
- add visible, removable interpretation chips for supported type/genre/duration clauses;
- keep URL recognition and YouTube as explicit provider behavior;
- provide lane-specific retry, timeout copy, and final summary;
- virtualize or progressively append large result sets.

Acceptance:

- local feedback appears inside the 100 ms response budget;
- a failed provider cannot erase or block another provider;
- clearing or replacing a query cancels old work and prevents stale writes;
- keyboard submit, clear, filtering, retry, and result opening all work at 200% zoom.

Rollback: query interpretation and the new renderer remain behind one Search entry function and can be reverted independently.

### Stage 5 — Library, dossier, source sheet, and Control Room

**Purpose:** carry the same clarity through selection, playback, and ownership.

Changes:

- reorganize Library into In Progress, Saved, Recent, and Finished shelves;
- compose the dossier as decision, story, episodes, and sources;
- redesign source rows for one-handed scanning with expandable technical detail;
- strengthen title-to-source-to-player continuity;
- regroup Settings by user intent and clarify health/privacy/data states.

Acceptance:

- every shelf has a truthful population rule and empty state;
- saved/progress state survives reload and backup round-trip;
- title or episode changes cancel old stream requests;
- close, back, source choice, subtitle choice, and recovery remain reachable with one hand;
- no new automatic playback path exists.

Rollback: templates and CSS revert without storage migration.

### Stage 6 — motion, accessibility, and adaptive polish

**Purpose:** make the experience feel continuous without spending the device’s frame budget.

Changes:

- tune card→dossier→source→player continuity;
- enforce single-owner page transitions and bounded reveal choreography;
- arbitrate horizontal rails, vertical page scroll, and dismiss gestures;
- reduce blur and layer promotion on constrained devices;
- complete reduced-motion, keyboard, focus-return, safe-area, and text-scale passes.

Acceptance:

- no hover-only action or gesture-only escape route;
- reduced motion has no hidden delay or invisible intermediate state;
- focus returns to the invoking control after modal/surface dismissal;
- rapid navigation cannot strand an overlay or stale page;
- browser traces show no avoidable long task caused by mounting an inactive catalog.

Rollback: motion is an enhancement layer; synchronous fallbacks preserve every control.

### Stage 7 — hardening and production acceptance

**Purpose:** prove the whole product, not isolated screens.

Automated journeys:

1. fresh load → Home → title → sources → player → close;
2. search while one provider fails → successful result → player;
3. save → Library → reload → reopen;
4. series → season → episode → source → next-episode offer;
5. Settings → provider health → export/import round trip;
6. rapid Home/Search/Library switching during active requests;
7. reduced motion, keyboard-only, 200% zoom, and 360 px width.

Production acceptance:

- test and build suites pass from a clean checkout;
- CSP/dependency/privacy checks remain green;
- DOM, motion, and viewport budgets pass;
- deployed asset versions match the visible release;
- smoke journeys pass against the Azure URL;
- final feel is checked on the Galaxy A15, including cold load, rapid navigation, scrolling, search typing, source sheet, and player close/recovery.

## 6. Release decision rule

A stage merges only when it is more capable or smoother in the tested journey without becoming less truthful, less private, or harder to recover. New visual ambition does not excuse a missed interaction, accessibility, or lifecycle budget.
