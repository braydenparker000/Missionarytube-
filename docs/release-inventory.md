# Component release inventory

`release-inventory.json` records the verified 2026-10-16 release, not a declaration that all production files came from one checkout. This file is informational; no publisher consumes it and it does not authorize a deployment.

## Authoritative identities

- Deployment repository: `braydenparker000/Missionarytube-`, repository ID `1350047370`, orchestration commit `6093a80ee86c868ead96c7141cd127a51e8b9b16`. The old `braydenparker999/Missionarytube-` name redirects to this repository.
- Private frontend: qualified source `324d4c4196dc7ee602a23210c62cc92238c7da96`; merged source `0e8d89cecd15e681ae949b116e64df8f52668a6d`, same tree. Successful run [38946691555](https://github.com/braydenparker000/Missionarytube-/actions/runs/38946691555).
- Worker: `jarvis-hub-api`, version `aaf9612a-dc41-4904-bd90-887b4f8f9f7c`, qualified backend source `62ac633f367250ed21b3ecf7a4627263e9e07d9f`. The frontend release preserved Worker code, settings and schedules; their digests are recorded separately.
- `jarvis-release.json` still pins `c28c1b2f70aabb5217b08bf31ffe4c93d0353765` for its general release consumers. This is not the complete current live release. Do not bump it merely to align the strings.

## Composite assets

The inventory lists 18 published frontend assets and 45 preserved dependencies, disjoint by path. In particular, `assets/muse-shell.js`, the versioned Muse shell and `mast/index.html` have independently pinned bytes. Replacing the whole site with one source checkout could regress these dependencies. Coverage is limited to this private frontend closure and Worker identity; other app surfaces are not fully inventoried.

The [public receipt](https://missionarytube.z13.web.core.windows.net/private-workspace-release.json) and all 63 paths were checked at 18:26:18 UTC. Later consumers must refresh live evidence. No credentials, session content or secret settings values belong in this inventory.

## Local, read-only validation

Run `node scripts/check-release-inventory.mjs release-inventory.json` and `node --test scripts/check-release-inventory.test.mjs`.

The checker only reads explicitly supplied local JSON files. It does not use network, credentials, environment variables, child processes or filesystem writes. It validates canonical repository identity, component ownership, immutable hash formats, source/receipt linkage, unique safe paths and non-overlapping assets/dependencies. It does not authenticate GitHub qualification artifacts, prove two Git trees equal or make live service calls.

An optional second argument supplies a separately collected observation JSON with `deploymentCommit`, `source`, `receiptSha256`, `worker` (version/codeSha256/settingsDigest/schedulesDigest) and `files` (the complete 63-path closure with sha256). Every value must match. Matching is comparison only: output always says `liveVerified:false`; caller-supplied evidence does not establish freshness or provenance.

This is a historical snapshot. A future legitimate release needs a reviewed updated inventory and new evidence, not an ignored mismatch. Existing qualification and deployment guards remain authoritative. No workflow or trigger changes are part of this addition.

## Reconciliation and rollback

Main/release ancestry divergence is not a feature inventory. At the checked heads, 469 of main's 579 blobs match the release, 103 differ and 7 are absent. Preserve main-only work and review differences by subsystem before merging ancestry. Neither these counts nor an egress URL alone justify deleting branches, publishers or fallback routes.

This four-file inventory/checker addition has no runtime effect. Rollback is a normal revert of the addition; no public asset or Worker redeployment is required. Consolidating publisher logic must preserve static-only versus Worker activation boundaries and each component's receipts, dependency guards and rollback behavior.
