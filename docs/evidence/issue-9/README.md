# Issue #9 acceptance evidence

Screenshots from the Playwright walkthrough for the Astra Obsidian redesign, captured on
Chromium 140 with Pixel 7 emulation against a synthetic two-provider add-on set. Every host in
the fixture is a reserved `.test` name; nothing resolves and nothing is a real service.

The captures are taken at exactly 360×800 and 412×915 CSS px with `deviceScaleFactor: 2`, then
downscaled to 1× WebP for the repository. `widths/` holds one capture per width in the
320–430px range issue #9 names, plus the reduced-motion and 200% text-scaling passes.

These files are documentation only. `scripts/build.mjs` copies `assets/` and root HTML into
`dist/`, so nothing here is deployed.

## Order

`412x915/` and `360x800/` are numbered in walkthrough order, which is also the
navigation → source selection → playback → audio switching → close/reopen sequence:

| # | Screen |
| --- | --- |
| 01 | First-run home, nothing installed |
| 02 | Media hub with no provider for any sector |
| 03 | Add-ons after installing two providers |
| 04 | Media hub with eight sectors live |
| 05 | Editorial home built from real catalogs |
| 06 | Movie dossier |
| 07 | Source picker |
| 08 | Video playback |
| 09 | Series dossier and browser |
| 10 | Picker with a long release name |
| 11 | An expanded source record |
| 12 | Audio-track menu |
| 13 | Expanded audio player |
| 14 | Docked audio bar, browsing continues |
| 15 | Radio |
| 16 | Podcast dossier |
| 17 | YouTube surface |
| 18 | Failed source lookup |
| 19 | Empty library |
