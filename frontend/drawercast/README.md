# Retired: the old Poweramp player

The player UI in this folder is no longer in use. Jarvis's Poweramp tile
opens the new player, [`frontend/claude-player/`](../claude-player/). This
folder is kept so the old player can be studied or restored, and because
some of its modules are still shared (below). Don't build new features here.

| File | Status |
| --- | --- |
| `index.html`, `player.js`, `audio-core.js`, `shuffle-worker.js`, `fonts/` | Retired player UI. Not linked from the site; `/drawercast/` still serves it for old bookmarks. |
| `r2-library.js`, `r2-api.js`, `audio-analysis.js` | **Live.** Imported by the Worker (`backend/music-*.js`) and the R2 library tools. |
| `drive-api.js`, `drive-catalog.js` | **Live.** Imported by My Media and the Drive catalog publisher. |

On the site, `drawercast/catalog/` is a data directory that frontend
publishing leaves in place (`scripts/inspect-frontend.mjs`). Moving the live
modules out of this folder belongs to the repository cleanup, together with
the build, release pins and tests that name these paths.
