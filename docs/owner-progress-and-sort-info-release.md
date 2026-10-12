# Private progress updates and sort information

Publishes exact qualified Jarvis source `46a26806f123de296d4e50b4ee7b753bbff0304b` from source PR144, including reviewed PR143 `5f859a3732bae8b28494922928a3684668792b6a`. Source qualification run `38290294735` passed all eight lanes and the source gate.

The Worker differs from the current production backend source `95d39031bb7b80f637c969a761e2aff9cc6a1040` in only `relay-connector.js`, `relay-owner-assistant-attachments.js`, and `relay-owner-tools.js`. It permits nonempty immutable private owner text deliveries with an empty attachment list through the existing owner tool and authorization. Existing settings, resource bindings, secret references, Mast behavior, and project gates are retained and verified after upload.

The static overlay contains only `assets/relay-attachment-contract.js`, `assets/relay-owner-ui.js`, `drawercast/index.html`, and `drawercast/player.js`. Exact source, existing live, staged and published hashes are pinned. Azure document security metadata is retained. Date Added sorting and upload-time provenance stay intact; the explanation moves to an accessible info button inside the selected Date Added sort menu. The released shuffle worker and all unrelated blobs are verified unchanged.

The opt-in `publish_owner_progress` mode verifies the successful exact-source proof and production parent receipt `58c16ed005994bebe63248954e363a0708760cc06029c027725048c89cbf2238`, builds the Worker without publishing, checkpoints current version `e2726f23-35c7-4245-81f6-aa54420cc035` and complete settings digest `3c39815e49f25015e028032211cf8135acfdef92249d72dd08a54b21fb733da8`, saves static backups and rollback identity before writing, deploys the Worker, then publishes dependencies before importers. The final receipt and whole-store/settings checks precede completion.

The publication creates no credentials, grants, schedules or bindings. Lucy attachment UI hold remains in effect. Actual owner progress delivery and readback use the existing owner connector after deployment.
