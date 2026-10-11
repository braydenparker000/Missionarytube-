# Private owner-to-Mast text chat (inactive)

`/mast/` reuses the owner session/password API and conversation CSS. The Relay chat menu links here. It never uses public `/muse/`, shared messages, GitHub publication import, Lucy's owner entries, attachment storage or project grants. History lives in a separate SQLite table in the existing durable object. Only explicit sends here enter that table. No messages or drafts are persisted in browser storage.

Owner routes: `GET /relay/owner/mast?after=0`, `POST /relay/owner/mast` with `{id,body}`. Existing owner authentication, origin checks, revocation and transactions apply. IDs must be UUIDs; owner text is limited to 4,000 characters. Same ID/body/device retries return the existing message; changed retries conflict. Lists are chronological pages of 50 with `nextCursor`. One reply per owner message; replies are appended when received. The page refreshes while visible every 15 seconds and manually. Saved means awaiting Mast, never proof of delivery or execution. Failed sends keep their original ID and text for safe retry.

## Narrow Mast adapter

Server-to-server only, with an independent bearer credential:

- `GET /relay/mast/messages?after=0`: reads only this dedicated conversation, including its replies. Follow `nextCursor`; persist your cursor only after processing. A responder should also reconcile owner messages without a reply after interruption.
- `POST /relay/mast/reply`: `{id,reply_to,body}`; UUID IDs, at most 6,000 characters. `reply_to` must identify an owner message in this conversation. Retry the exact same reply ID/body after an uncertain response. Duplicate replies return 200; conflicting IDs/bodies return 409.

Authorization is checked again inside storage. The adapter cannot select another inbox, read Lucy's history, call owner APIs, use project channels, impersonate Lucy, upload attachments or invoke work. Browser-origin adapter requests are rejected. No outbound callback, model provider or scheduling machinery is added. This is a pull/reply protocol for an approved Mast runner, not an automatic model response.

## One activation requirement

Obtain specific approval for the Mast runner's access to this conversation, then provision its dedicated credential and configure `RELAY_MAST_TOKEN_SHA256` with its SHA-256 digest and `RELAY_MAST_ENABLED=true`. Neither setting is configured by this PR. Existing owner/MCP gates must also remain enabled. Missing/invalid configuration fails closed: adapter requests and owner sends return 503; authenticated owner reads return an inactive state without creating Mast storage. No credentials, flags, grants, schedules or deployments were changed. Approval must cover who holds the credential and how the runner reads/replies; do not reuse an owner or Lucy credential.

The adapter has no scheduled runner yet. Natural inline files/images are deferred; Lucy's attachment layout is unchanged.

## Focused evidence

`relay-mast.test.js`: closed defaults, revoked/absent owner sessions, wrong adapter credentials, Lucy-history isolation, idempotent sends/replies and cross-history reply rejection.
`relay-mast-browser.test.js`: real synthetic Worker/SQLite routing, phone send with lost response and safe retry, chronological reply, reduced-height composer, no public routes or browser transcript persistence, inactive state. Screenshots under `docs/evidence/owner-mast-chat/` contain synthetic data only; not a live Mast exchange.
