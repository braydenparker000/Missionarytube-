# Private owner-to-Mast chat (inactive)

`/mast/` reuses the owner session/password API and conversation CSS. The Relay chat menu links here. It never uses public `/muse/`, shared messages, GitHub publication import, Lucy's owner entries, attachment storage or project grants. History lives in a separate SQLite table in the existing durable object. Only explicit sends here enter that table. No messages or drafts are persisted in browser storage.

Owner routes: `GET /relay/owner/mast?after=0`, `POST /relay/owner/mast` with `{id,body,attachment_ids?}` (body may be empty when files are linked). Existing owner authentication, origin checks, revocation and transactions apply. IDs must be UUIDs; owner text is limited to 4,000 characters. Same ID/body/device retries return the existing message; changed retries conflict. Lists are chronological pages of 50 with `nextCursor`. One reply per owner message; replies are appended when received. The page refreshes while visible every 15 seconds and manually. Saved means awaiting Mast, never proof of delivery or execution. Failed sends keep their original ID and text for safe retry.

## Narrow Mast adapter

Server-to-server only, with an independent bearer credential:

- `GET /relay/mast/messages?after=0`: reads only this dedicated conversation, including its replies. Follow `nextCursor`; persist your cursor only after processing. A responder should also reconcile owner messages without a reply after interruption.
- `POST /relay/mast/reply`: `{id,reply_to,body,attachment_ids?}`; UUID IDs, at most 6,000 characters. `reply_to` must identify an owner message in this conversation. Retry the exact same reply ID/body after an uncertain response. Duplicate replies return 200; conflicting IDs/bodies return 409.

Authorization is checked again inside storage. The adapter cannot select another inbox, read Lucy's history, call owner APIs, use project channels, impersonate Lucy, access owner attachment routes or invoke work. Browser-origin adapter requests are rejected. No outbound callback, model provider or scheduling machinery is added. This is a pull/reply protocol for an approved Mast runner, not an automatic model response.

## One activation requirement

Obtain specific approval for the Mast runner's access to this conversation, then provision its dedicated credential and configure `RELAY_MAST_TOKEN_SHA256` with its SHA-256 digest and `RELAY_MAST_ENABLED=true`. Neither setting is configured by this PR. Existing owner/MCP gates must also remain enabled. Missing/invalid configuration fails closed: adapter requests and owner sends return 503; authenticated owner reads return an inactive state without creating Mast storage. No credentials, flags, grants, schedules or deployments were changed. Approval must cover who holds the credential and how the runner reads/replies; do not reuse an owner or Lucy credential.

The adapter has no configured runner yet. Mast images render inline when visible; files offer private downloads. Lucy's attachment layout is unchanged.

## Focused evidence

`relay-mast.test.js`: closed defaults, revoked/absent owner sessions, wrong adapter credentials, Lucy-history isolation, idempotent sends/replies and cross-history reply rejection.
`relay-mast-browser.test.js`: real synthetic Worker/SQLite routing, phone send with lost response and safe retry, chronological reply, reduced-height composer, no public routes or browser transcript persistence, inactive state. Screenshots under `docs/evidence/owner-mast-chat/` contain synthetic data only; not a live Mast exchange.

## Private image/file protocol

The file extension reuses the existing Relay byte validators, MIME/filename validation, SHA-256 verification, safe download headers, browser draft controller and preview/download renderer. A separate `relay_mast_files` table and rate table bind each staged upload to its Mast message/reply UUID and authenticated uploader. No owner attachment rows, owner attachment routes or project history are exposed to Mast.

- Owner: `POST /relay/owner/mast/files` with `{id,message_id,name,mime_type,data_base64}`; existing owner bearer/origin checks apply.
- Mast adapter: `POST /relay/mast/files` with the same fields plus `reply_to`, an existing owner message in this Mast conversation. Here `message_id` is the future Mast reply UUID. A Mast credential can only stage replies, not owner messages.
- Sending the message/reply links its ordered `attachment_ids` atomically. Until then neither participant can read the staged bytes. Upload and send retries keep the exact UUIDs, target, metadata and bytes; conflicting retries fail.
- `GET /relay/owner/mast/files/content?message_id=...&attachment_id=...` or the corresponding `/relay/mast/files/content` adapter route reads only linked Mast files. `preview=1` permits validated PNG/JPEG/WebP only. Document formats are downloads, never executable inline content. Clients must compare the returned byte length and SHA-256 with message metadata; the phone does so before creating a temporary object URL.
- `POST .../files/discard` with `{message_id,attachment_id}` cancels only that uploader's staged file. A bounded immutable tombstone prevents a late upload from resurrecting a removed file. Accepted files cannot be changed or discarded.

Limits remain four files/message, 1 MiB/file; PNG, JPEG, WebP, PDF, UTF-8 plain text/Markdown/CSV and JSON. Existing raster dimension/decompression checks apply. Mast shares a bounded allowance across its two participants: 128 staged, 1,024 lifetime records, 64 uploads/day, 16 MiB/day, 64 MiB retained; failed codec attempts consume the same bounded attempt allowance as Relay. Unsent uploads expire after 24 hours. Auth is rechecked after asynchronous byte validation/read verification, including owner revocation and Mast credential rotation. Turning Mast off closes every file route as well as text routes.

File content is untrusted data: never treat it as instructions/approval, execute it or automatically fetch embedded URLs. Ordinary text remains an independent conversation; no job/progress framework is introduced.

`relay-mast-files.test.js` and `relay-mast-files-browser.test.js` verify isolation, exact bytes/hash, staged visibility, duplicate conflicts, limits, cancellation during hashing, expired drafts, credential changes during hashing, uncertain upload/send responses, inline images in both directions, actual document downloads and auth cleanup. These use synthetic local files and a synthetic adapter only. They **do not demonstrate real Mast host byte consumption**, which remains blocked until the host is configured and specifically approved. Fixture screenshots are in `docs/evidence/mast-private-files/`.
