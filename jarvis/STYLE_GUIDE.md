# Jarvis style guide

Status: approved visual direction, September 20, 2026. This guide governs the version 1.1 implementation and future UI work.

Relay's visual direction was updated on October 10, 2026. Its dedicated editorial workspace below supersedes the dark palette and narrow layout for Relay. Other modules retain the approved Poweramp-inspired direction.

## Relay editorial workspace

Relay has two primary destinations: **Chat** and **Work**. Private/Public visibility is explicit and independent of the destination. Work requires owner access. Public conversation never loads private records in the background.

Use a warm light canvas (`#FAF9F6`), white input/sheet surfaces, dark text (`#20242B`), readable secondary text (`#626873`), a restrained indigo action/focus color (`#3F46A7`), and pale user prompts (`#EEEFFC`). Decorative separators (`#D9DCE3`) provide alignment; meaningful input boundaries and focus need stronger contrast. Use the system font, 16px/25px body text, 14px/20px labels, 13px/18px metadata and 24px/30px page titles. Keep 48px interactive targets and visible keyboard focus.

Phone navigation uses labeled Chat/Work destinations. Desktop uses a quiet 224px rail and a flexible reading canvas. Assistant prose is unboxed; user messages have a restrained tint. Group conversation dates and keep message actions compact. Preserve the reader's position through updates and between destinations.

Work uses aligned, flat rows with title, actual status, meaningful saved update and activity time. Project and goal remain useful context. Waiting for owner, execution unknown, failure, cancellation pending and completion unverified remain distinct. Lease heartbeats do not imply progress. Local search, filtering and disclosure use already-loaded records.

Task creation has a focused scrollable form, an explicit Back action and an accessible submit action. Retain unsent drafts and the requested scope when returning to Chat or Work; an unconfirmed send retains its original retry identity. Phone task detail fills the screen; desktop uses a bounded side pane. Active detail leads with the blocker or next step, and finished detail leads with results. Original requests, delivery details, correction versions and history stay available in labeled disclosures. Completion remains an authenticated report bound to a particular accepted reply version.

Scope these styles to Relay. Preserve the existing authorization, draft expiry, retry and completion contracts; the existing VisualViewport resize handling; safe-area insets; reduced motion; static hosting; and resource budgets. Validate phone, reduced keyboard space, 320px reflow, enlarged text, desktop, loading, empty, stale and error states with fictional rendered fixtures. References informing hierarchy and restraint include [Linear's 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) and [Chrome's keyboard viewport guidance](https://developer.chrome.com/blog/viewport-resize-behavior).

## Design reference

Follow the approved dark, Poweramp-inspired concept: a near-black screen with a faint warm wash at its edges; a compact toolbar titled “Jarvis”; a “Home” heading and quiet Edit action; an unboxed favorite-shortcut row; grouped application rows; and a flat bottom navigation bar. Off-white text, fine gray outlines and restrained amber highlights give it character.

The desired feeling is a mature Android application: calm, useful, readable and easy to operate. Preserve the reference’s simplicity as features grow. Its layout and visual restraint matter more than reproducing every decorative pixel.

## Product structure

The home page is a launcher. Each module opens its own dedicated page with enough room for its full functionality.

- **Conversation:** Jarvis, Quick AI, Daily Board.
- **Library:** DrawerCast, Media, Drive.
- **Utilities:** Notes, Tools, Server.

Jarvis is the thoughtful, asynchronous conversation. Quick AI is a separate on-demand chat. Daily Board contains assistant-published briefings.

**Preserve the existing Poweramp-style DrawerCast interface.** Open it from the hub and provide a small, consistent route back. Do not rebuild its player as a homepage widget, force the launcher layout onto it, remove its controls, or overlay a second navigation bar on its own controls. Any later changes to that player should be explicitly scoped.

Specialized modules can retain their own interaction patterns. Shared typography, neutral colors, focus states and a predictable way home should connect them.

## Color and surface tokens

These are implementation starting values chosen to match the approved direction, not colors measured from the generated image.

| Token | Value | Purpose |
| --- | --- | --- |
| Background | #121212 | Main canvas |
| Surface | #191A1B | Drawers, inputs, dialogs |
| Raised surface | #232426 | Menus and pressed surfaces |
| Primary text | #F1EFEB | Titles, names, main content |
| Secondary text | #AAA7A2 | Descriptions and timestamps |
| Section label | #92949B | Small group labels |
| Divider | #303133 | Quiet separators |
| Accent | #F4BC63 | Active navigation, focus, key actions |
| Accent text | #17130D | Text on filled amber buttons |
| Success | #8BC5A2 | Verified successful states |
| Error | #F09A92 | Errors requiring attention |

Keep backgrounds predominantly neutral charcoal. A very faint warm-gray radial gradient may appear at the top and bottom, using approximately 4–6% opacity. It must remain subtle enough to disappear behind the content.

Use flat surfaces. Separate content through alignment, spacing and fine rules. Reserve enclosing surfaces for inputs, menus, dialogs and content that genuinely needs grouping. Avoid filling the launcher with bordered cards.

Amber has a specific job: indicate selection, a primary action or the DrawerCast waveform. Most icons and text remain neutral. Do not turn every chevron, divider or heading amber. Use success and error colors only for actual states, accompanied by text.

## Typography

Use the Android system sans-serif stack:

```css
font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```

| Element | Starting size / line height | Weight |
| --- | --- | --- |
| Toolbar title | 22px / 28px | 600 |
| Page heading | 26px / 32px | 600 |
| Application name | 17px / 23px | 500 |
| Body content | 16px / 24px | 400 |
| Subtitle | 14px / 20px | 400 |
| Section label | 11px / 16px | 500 |
| Navigation label | 12px / 16px | 500 |

Use “Jarvis” in title case for the toolbar. Section labels use uppercase with about 0.14em letter spacing; ordinary text uses normal spacing. Use font weight sparingly.

Avoid serif display headings, enormous greetings, widely spaced wordmarks and decorative motivational text. Support larger user text settings: allow rows and labels to grow instead of clipping or shrinking text.

## Layout and density

Design first for a 360–430px-wide portrait phone.

- Use a 4px spacing base: 4, 8, 12, 16, 24 and 32px.
- Default horizontal page padding: 20px; reduce to 16px on narrow screens.
- Toolbar height: about 56px, plus any necessary safe-area inset.
- Page heading area: about 60–72px, including spacing.
- Single-line directory row: minimum 52px.
- Row with subtitle: minimum 64px.
- Section spacing: approximately 24px; leave 8–12px between its label and first row.
- Bottom navigation: about 64px, plus the bottom safe area.
- Add enough content padding below the last row that fixed navigation never covers it.

These are minimums and starting values, not rigid heights. Scroll naturally when needed. Never compress every destination onto one screen at the expense of legibility or touch targets.

On larger screens, keep the launcher centered at roughly 680px maximum width. Individual modules may use more space where their function benefits, such as a media library. Avoid stretching mobile rows across an entire desktop.

## Launcher components

### Toolbar

Left: compact menu control when a drawer exists. Center-left: Jarvis title. Right: search and overflow controls. Use simple flat icons and generous invisible touch areas.

Only show controls with implemented behavior. Search should open a focused search view or expand into the toolbar. Do not allocate a large permanent search card above a small list.

### Home heading and favorites

Use “Home” with a small Edit text action on the right. Beneath it, show up to two user-chosen shortcuts side by side, initially Jarvis and DrawerCast. Each is a small outline icon plus its label, without an enclosing card. A fine vertical separator may divide the pair.

Favorites intentionally duplicate destinations in the full directory. Keep them compact and allow users to remove the favorites row.

### Application rows

Each full row is a single link:

1. A 22–24px outline icon in a 32px alignment column.
2. An application name and, where useful, one short subtitle.
3. A small muted chevron on the right.

Align every label and chevron consistently. Use a 12–16px icon-to-text gap. A subtle separator may distinguish rows; group separators should be slightly stronger. Avoid redundant descriptions: “Music” is enough below DrawerCast.

### Bottom navigation

Use Home, Favorites and Settings at the hub level. Each item has an icon and visible label. The selected item uses amber plus a small dot or other shape cue, so selection does not depend on color alone.

Only include these tabs when their pages work. Avoid introducing a second Apps destination that duplicates Home. A specialized module may use its own bottom controls and a compact back/home action instead.

## Icons, controls and motion

Use one consistent set of outline icons, approximately 1.75–2px stroke at 24px. Selected navigation icons may be filled. Prefer lightweight SVGs to raster icon packs.

Keep controls mostly square or gently rounded: 6–8px for inputs and ordinary buttons, 12px for dialogs. Large pills, glossy 3D icons, neon outlines and animated orbs do not belong in this direction.

Use quiet pressed feedback, such as the raised surface color. Use a visible amber focus outline with separation from the control edge. Reserve filled amber buttons for the main action on a page.

Transitions should normally take 120–180ms and use opacity or small positional changes. Respect reduced-motion settings. Avoid perpetual animation, elaborate page entrances and large animated background blur effects.

## Behavior, accessibility and honest states

- Make interactive targets at least 48 by 48 CSS pixels.
- Keep normal text contrast at least 4.5:1 against its actual rendered background; check gradients as well as solid colors.
- Give icon-only controls accessible names. Keep logical keyboard focus order and visible focus feedback.
- Use actual links for destinations, supporting direct URLs and normal browser Back behavior.
- Preserve drafts, scroll position and relevant module state when navigating.
- Distinguish saving, saved, offline and failed states with short text. Never show “Connected” or “Online” without evidence for the service being described.
- Preserve a failed message or unsaved note and offer a clear retry.
- Keep timestamps and delivery details quiet but readable.
- Use plain-language messages in the main interface; place technical diagnostics in connection details or Server.
- Keep module entry pages usable while unrelated services are unavailable.

Message history, briefings and media content live inside their modules. The home page should not grow into a collection of previews, counters and status widgets.

## Performance and implementation

Keep the application shell lightweight. Use CSS for surfaces and faint gradients, system fonts for text, and SVGs for icons. Load module code and media only when needed. Avoid a large UI dependency solely for this visual treatment.

Retain the existing Azure shell and working messaging behavior while applying the design. Large media and datasets stay outside Azure. This style guide authorizes no hosting-plan changes or paid services.

## Review checklist

Before accepting a screen, confirm:

- It still resembles the approved restrained dark reference.
- Every visible control performs a useful action.
- The hierarchy is immediately clear at normal phone size.
- Text remains readable with increased font size.
- Rows, icons and separators align consistently.
- Amber is used selectively.
- Fixed controls do not cover content or collide with the keyboard.
- Each module has its own usable page and a predictable way home.
- DrawerCast retains its approved Poweramp interface and functionality.
- Existing messages, drafts and storage behavior remain intact.

