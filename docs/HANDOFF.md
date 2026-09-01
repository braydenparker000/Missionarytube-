# Handoff

State of Astra for a new session. Short on purpose; the code is the detail.

## What this is

A private, mobile-first streaming client. Static HTML/CSS/JS served from Azure
Storage. No build step beyond copying files, no runtime framework, no server of
its own. Content comes entirely from Stremio-compatible add-ons the owner
installs; Astra shows nothing it was not handed.

- Live: https://missionarytube.z13.web.core.windows.net/
- Primary client: **Android Chrome**. Everything is judged at 360–430px.
- Product scope: movies, shows, anime, and music as a secondary experience.
  YouTube, podcasts and radio are deliberately out of scope and dropped at
  catalog collection (`assets/js/hub.js`, `OUT_OF_SCOPE`).

## Deploy

Push to `main` → `.github/workflows/deploy-azure-storage.yml` runs `npm test`,
`npm run build`, then uploads `dist/` to the `$web` container over OIDC. Gated on
the repo variable `AZURE_DEPLOY_ENABLED`. The path filter is `*.html`,
`assets/**`, `scripts/build.mjs`, `package.json` — a docs-only change does not
deploy. A failing test or build cannot reach the site.

## Where things are

| Path | What |
| --- | --- |
| `index.html` | The whole app: shell, all view renderers, event bindings, player chrome |
| `assets/css/obsidian.css` | Design system. Tokens first, then components built from them |
| `assets/js/hub.js` | Content-type taxonomy and what is in product scope |
| `assets/js/catalog-registry.js` | Provider/catalog identity, Home layout preferences |
| `assets/js/playback/*` | streams, adapters, engine, episodes, subtitles, settings |
| `assets/js/progress-store.js` | Playback progress, bounded and quota-safe |
| `tests/` | Node test runner. `npm test` = `scripts/check.mjs` + the suite |

## Decisions that are load-bearing

Do not undo these without asking — each was an explicit owner decision.

1. **Add-on order is the order.** `streams.prepare()` returns sources exactly as
   the add-on sent them. No ranking, sorting, filtering or hiding. The add-on's
   own configuration is where the owner expresses what they want back. Astra
   adds only a per-source compatibility verdict, because whether *this device*
   can decode a release is the one thing the add-on cannot know.
2. **Nothing plays that was not chosen.** No auto-pick, no automatic failover,
   no next-episode countdown. The engine is handed exactly the tapped source.
   `engine.js` keeps failover machinery but it is off unless a caller passes
   `autoFailover: true`, and the app never does. The settings that only fed
   ranking or auto-start (`maxResolution`, `preferCached`, `hdrPreference`,
   `autoFailover`, `autoplayNext`) are removed from the schema.
3. **Audio tracks need MSE.** Chromium has never implemented
   `HTMLMediaElement.audioTracks` — not on the prototype, verified in-browser.
   So `adapterKindFor()` sends HLS to hls.js whenever MSE exists, even though
   Android Chrome claims native HLS support; native is the fallback only for a
   browser without MSE (Safari, which implements `audioTracks` anyway). A direct
   MP4/MKV still cannot expose tracks in Chrome: the audio menu says so and
   lists other sources for the episode by advertised language instead.
4. **Honesty over polish.** Nothing is shown that was not measured. No invented
   availability, no placeholder standing in for missing data, no synthesised
   telemetry. Empty and error states explain themselves and offer a way forward.

## Constraints

- Preserve static Azure Storage compatibility. Browser assets only.
- Prefer web-platform capability over dependencies. The only runtime third-party
  code is hls.js and dash.js, both pinned to an exact version with an SRI hash;
  `npm test` fails the build on a mutable channel or a missing integrity hash.
- Never commit secrets, tokens, storage keys or configured add-on URLs. Add-on
  URLs can carry private debrid tokens.
- Keep tap targets on the `--tap` token, honour safe-area insets, and disable
  animation outright under `prefers-reduced-motion`.

## Verifying real behaviour

`npm test` and `npm run build` are the gate, but neither renders anything. For
UI or playback work, drive the real app: Playwright and Chromium are available
(`/opt/node22/lib/node_modules/playwright`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
never run `playwright install`). The pattern that worked: a throwaway local
server on `127.0.0.1` serving the repo plus synthetic Stremio add-ons, seeded
into `localStorage` under `astra.v1.*`, with generated SVG artwork and a real
recorded WebM so the player actually plays. Keep it in scratch — it is not part
of the deployable app, and it must never point at a real add-on.

## Open items

- **Unverified on hardware:** the hls.js routing change was tested only under
  mobile emulation. Confirm on a physical Android phone with a multi-audio HLS
  source.
- **Unreviewed:** the change shipped in PR #14 went to production without a
  Codex review, at the owner's instruction. Worth a look when there is budget.
- **Parked:** an mp4box.js + MSE demuxer for direct-file multi-audio. Scoped and
  deliberately deferred — MP4-only, and blocked by codec licensing for the
  AC-3/E-AC-3/DTS/TrueHD tracks most remuxes carry, so it would not help the
  common case.
- The engine's failover code is currently unreachable. Leave or remove
  deliberately, not by accident.

## Working agreement

Claude writes the first implementation; Codex reviews adversarially. See
`CLAUDE.md`, `AGENTS.md`, and `docs/AI-COLLABORATION.md`. Keep pull requests
focused and reversible, and put acceptance-criteria evidence in the PR.
