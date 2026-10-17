# Import verification

Date: 2026-10-17 UTC. Deployment base `1179c4fe40a84a6ddb3fd1dcd37950e6239f12d4`.
Imported source `118673457777c9226e846d4513dc5e4eb206ea38`; exact tree
`9f983eb6a86ddc1989c3d4e7b85fb7c7d2819938`. Node v24.19.0, npm 11.9.0.
The PR head identifies the final import candidate. Code was checked before this
record was added; the final subtree/ancestry checks follow commit creation.

| Acceptance | Evidence |
| --- | --- |
| Exact source bytes/modes | 926 files, all mode 100644; source-tree.txt; recursive Git blob/tree hashing matches the source tree |
| Discovery boundary | all 86 original entrypoints retained; imported tests excluded; three new import/discovery tests |
| Affected checks | 8/8 pass, including original privacy assertions and negative byte/mode/file-set cases; 0.447s |
| Root npm test, once | 1,127 pass, no failures/skips/TODOs; 16.649s |
| Existing build before/after | pass, 0.336s each, using the same clean c28c1b2 pinned checkout |
| Build identity | all 194 dist files match; sorted manifests byte-identical |
| Dependencies and root lockfile | unchanged |
| Active workflows, pins, source selection, Worker config, schedules and endpoints | unchanged |
| PR215 | not merged or incorporated; root media files remain |

Both build manifests have SHA256
`b2ab23bac1a1824f605f680d94c2807e4e40e59480a749d591f6ee4558b5e0d5`.
The build reports 192 files before generating its preview and release metadata.
This proves existing build identity, not qualification of imported runtime code.

The exact import necessarily retains upstream whitespace (including vendored
files). Root patch whitespace checks pass; no upstream formatting was changed.
The deployment privacy scanner initially flagged inherited public-service URLs,
mock OAuth response/negative-test strings, and fixture commit IDs. Its original
assertions remain intact for the deployment tree, while a mandatory exact-tree
check rejects any changed imported content. No permissive host list or token
exception was added. No secret values are present in these transcripts.

Imported application suites were intentionally not run as part of the
orchestration suite. No component cutover or live functional acceptance is
claimed. Existing media qualification limitations remain unchanged.

See ../../docs/jarvis-source-import.md for the remaining cutover checklist and
../../docs/jarvis-source-import-inventory.json for exact original refs, component
pins, and open PR identities, including objects not copied by this import.
