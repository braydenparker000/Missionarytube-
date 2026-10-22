# Claude Player (independent Poweramp build 1031 recreation)

Lane: branch `claude/vigilant-galileo-l7udmo`, route `frontend/claude-player/`. The player is a
private, non-commercial recreation built from original code. Merging and deploying need the owner's
approval.

| Document | Contents |
| --- | --- |
| [Architecture and fidelity plan](architecture-plan.md) | Environment/APK report, fidelity strategy, options and selection, decomposition, limitations, milestones and gates, first slice, owner decisions |
| [Coverage matrix](coverage-matrix.md) | Reference component → evidence → status → contract → milestone → limitation; section 5 is the implementation status |
| [Research notebook](research-notebook.md) | Evidence ledger (F01–F60, I1) with a build status per finding with confidence classes and open questions |
| [Renderer bench](experiments/renderer-bench/README.md) | Discriminating rendering experiment and results |

## Running and hosting

- **Locally:** serve `frontend/` with any static server and open `/claude-player/`. Without the R2
  library, import files with the import panel.
- **R2 library:** the player reads `https://jarvis-hub-api.braydenparker999.workers.dev/music/library.json`.
  - The Worker answers only `https://missionarytube.z13.web.core.windows.net`, so the hosted copy must
    live on that site, for example under `$web/claude-player/`.
  - Azure serves the app files only. Music, covers and the index come from the Worker.
- **Index fields the player uses:**
  - `metadata.*` tags
  - `coverKey`, which fetches the Worker art image
  - `metadata.waveform`: base64, one peak byte per bar, loudest bar 255
  - `waveformVersion: 1`: a DCW1 file at `/music/library/waveform/<id>`

Reference artifacts (APK, decoded resources, decompiled classes) are kept outside version control
and are never committed.
