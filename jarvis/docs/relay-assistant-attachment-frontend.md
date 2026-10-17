# Private assistant attachment frontend

Baseline: active release `97b048abfde97426da7b5eb3a310964631ce724c`.
Backend contract: PR114 `0cb786014b14c454d1869ae1f970397a66f6201f`, documented in `docs/relay-assistant-attachments.md` on that head.

First assistant replies arrive through the existing private message feed. Their file metadata binds to the original user UUID (`replyTo`), not the reply entry ID. The parser requires private authenticated owner-MCP provenance and the fixed owner principal. Downloads use the unchanged bearer-only content route with original message UUID and attachment UUID, bounded MIME/size/SHA-256 verification, raster-only explicit previews and document downloads. User upload validation remains intact.

Later deliverables are separate immutable records. Each original message offers “Updates and files from assistant,” which reads the real `/relay/owner/deliverables` endpoint ten records at a time. This avoids an unbounded request per historical message during inbox refresh. Expand to check deliveries, Refresh updates to check again, Load more updates for subsequent pages, and Close assistant updates to dismiss the view. No delivery is inferred to complete a job or replace an accepted text reply. Duplicate identity/conflicting records, wrong-original metadata and nonadvancing cursors fail closed. The bounded32-record per-conversation limit matches the backend.

Text-only progress updates use this same view and pagination. Empty attachments require nonempty text, and the parser checks authenticated private owner-MCP provenance even without files. No attachment arrangement or preview/download layout changes.

Loading/error/empty states retain existing accepted text; failed refresh preserves loaded files. Refresh and Load more both compare incoming records against all previously loaded immutable records; a conflict preserves the complete prior cache and cursor. Repeated taps cannot duplicate active reads. Close, channel changes and credential loss abort pending list reads; generation checks prevent late results from restoring cleared private state. Existing content-view disposal aborts downloads/previews and revokes object URLs. File search includes filenames in first replies and loaded later deliveries. Empty-body entries hide Copy text.

## Qualification

`relay-assistant-attachments.test.js` covers frontend metadata/provenance, page validation, error retention, cancellation and late credential-loss responses with synthetic fixtures.

`relay-assistant-attachments-browser.test.js` requires the actual paired backend and explicitly skips on the standalone frontend branch. On the pair it uses real public MCP calls and actual Worker/SQLite acceptance, not injected message/content responses. It exercises accepted text followed by generated raster/PDF, a synthetic throw after a successful commit followed by identical retry (not a severed HTTP response), exact private download bytes, public navigation, server revocation plus explicit local credential removal while a preview is held, and a separate server-only revocation case where the next actual file request returns401 and the application clears cached files/Blob URLs/credentials without test-side storage deletion, first file-only reply,11 later deliveries across pages, narrow320px layout and Close. Published data are synthetic; no live owner messages are used. Do not count standalone backend-dependent skips as paired qualification.

The prior synthetic-only browser scenario and incorrect delivery-ID linkage assumption are superseded. Final exact commits, combined tree and test totals belong in PR113 and its evidence artifacts. No backend, Poweramp, public-channel, credential, schedule or deployment changes belong to this frontend branch. Parent owns integration and promotion after independent review. Physical Android/TalkBack, production TLS/CORS and native ChatGPT host-to-live byte delivery remain unqualified.

Server-only revocation is learned on the next authenticated request; this is not push revocation or proof of immediate cleanup while offline. Existing evidence artifacts are historical and remain unchanged.
