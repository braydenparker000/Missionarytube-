# Private Relay attachments: backend and connector contract

Status: implementation draft for independent review and exact-head CI. Synthetic local tests cover the contract, including actual workerd SQLite. This draft is isolated from the active Astra promotion and does not enable production uploads. Live host image/PDF consumption remains a separate acceptance check.

Base: `5caed720cf26328165f2985189236a6d607e0e61` on `release/astra-live-backport-20261009`. Backend branch: `feature/relay-private-attachments-20261010`.

## Feasibility and storage

Relay currently accepts text-only owner messages. There is no Relay attachment table, upload route or connector file read tool. The separate music upload implementation uses a public music library and is unsuitable for private owner files.

Use the existing `HUBS` SQLite Durable Object and existing private owner session/OAuth checks. Store bounded binary BLOBs in a new private attachment table beside owner messages. No new bucket, binding, credential, grant, scope, public URL or service is required. No security access expansion is proposed.

Version one is deliberately bounded: at most four attachments per message, 1 MiB (1,048,576 bytes) per attachment, 4 MiB per message, 64 MiB retained attachment bytes per owner and 16 MiB of newly uploaded bytes per UTC day. Exact duplicate retries do not consume another upload allowance. Daily counters and cleanup use existing requests; no new alarm, schedule or timer.

Count bounds are also enforced transactionally: four staged files per original message,128 staged files per owner,64 new uploads per UTC day and1024 total attachment identity records per owner. Discard/expiry frees binary bytes but retains the immutable identity tombstone within that1024-record cap. UUIDs cannot be resurrected with replacement contents by a delayed message retry.

Before body ingestion/codec work, authenticated attempts are bounded to128/day and12/minute; failed validation and quota rejection consume their allowance. HTTP ingress, codec admission and discard have independent bounded counters. Cheap quota checks run before inflation, with final transactional quota/ownership checks after asynchronous validation.

The1024 identity limit is a lifetime cap including removed/expired uploads and cancelled upload IDs. It does not reset when files are discarded. A specific quota error explains that limitation. Existing linked files remain readable if the cap is reached. Changing that retention/identity policy requires separate review.

The file limit leaves room under SQLite's [documented 2 MB maximum BLOB/row size](https://developers.cloudflare.com/durable-objects/platform/limits/). Raising it requires a separately reviewed chunking or private object-storage design.

## Owned implementation files

- New `backend/relay-owner-attachments.js`: schema, validation, bounded storage, immutable linking, metadata/content read and draft disposal.
- `backend/relay-owner.js`: existing owner-auth admission, attachment HTTP routes, message submission/linking and private entry metadata.
- `backend/relay-owner-tools.js`: attachment metadata in private message outputs and the new flat owner-only attachment-read schema.
- `backend/relay-connector.js`: typed image/text/resource tool results for that exact read operation, preserving existing owner scope enforcement.
- New `tests/relay-owner-attachments.test.js`, `tests/relay-owner-attachments-http.test.js`, and `tests/relay-owner-attachments-connector.test.js`.
- New `tests/relay-owner-attachments-runtime.test.js` and its local-only Worker/Hub harness verify real Cloudflare-compatible BLOB binding and HTTP bytes/hash.
- `tests/relay-fixture.js` adapts Cloudflare ArrayBuffer BLOBs to Uint8Array for pinned older Node SQLite. Production retains ArrayBuffer binding.
- This contract and synthetic raster/PDF fixtures and attachment test helper.

No frontend API, composer, CSS, navigation, Poweramp, deployment, OAuth/configuration or schedule files are owned here. If implementation reveals a need to change worker dispatch or job presentation/output schemas, report that addition through the parent before editing them.

## Composer HTTP contract

All paths are on the existing API origin. Use the existing owner session bearer in the Authorization header. Never put a token in a URL. Upload/discard requests retain the existing allowed-Origin and application/json checks. The server rechecks the live session before persistence or content release.

Approved GET/session, successful POST/login and approved POST/pair/status responses advertise attachments_enabled:true. Missing, expired or revoked authentication never advertises readiness. This capability describes the browser attachment path, not proof of refreshed host connector discovery.

1. The composer creates the final message UUID before staging uploads.

2. `POST /relay/owner/attachments` accepts exactly:

   `{ id: <attachment UUID>, message_id: <original message UUID>, name: <basename>, mime_type: <allowed MIME>, data_base64: <canonical base64> }`

   Response: `{ attachment: <metadata>, newWrite: <boolean>, visibility: "private" }`.

   The server decodes a bounded body, checks actual byte size, validates permitted MIME/signatures, computes SHA-256 itself and ties the immutable draft to this owner, uploader device and message UUID. The same attachment UUID with identical bytes/metadata is idempotent; conflicting reuse returns409. URLs, external sources and arbitrary fetches are not accepted.

3. Existing `POST /relay/owner/messages` gains optional `attachment_ids`, preserving `id` and `body`:

   `{ id: <same message UUID>, body: <plain text>, attachment_ids: [<up to four distinct attachment UUIDs>] }`

   Empty body is permitted only with a nonempty valid attachment list. Existing text-only requests behave unchanged. Attachment validation/linking, original message insertion, daily message accounting, existing job creation and event enqueue commit atomically. Every attachment must be an unexpired draft for this exact message and uploader device. No attachment may be linked to another message.

   Message retries require identical original body and ordered attachment IDs. They cannot append/remove/replace attachments, change accepted replies or produce duplicate messages/events/jobs. A text-only retry of an already attached message is a conflict.

4. `POST /relay/owner/attachments/discard` accepts `{ message_id, attachment_id }`. It discards only a staged upload belonging to the current uploader and exact message; linked attachments are immutable. Unknown or foreign IDs return the identical generic already-absent status/shape. A cancelled chosen UUID is reserved even if its upload is still validating, so a delayed POST cannot resurrect the file. Cancellation identities count against the lifetime cap. The generic response's newWrite:false reports that no existing uploaded bytes were changed; private anti-replay bookkeeping may reserve an absent ID.

5. `GET /relay/owner/attachments/content?message_id=<UUID>&attachment_id=<UUID>` downloads a linked attachment with the existing owner bearer. Add `preview=1` only for a permitted raster image. The frontend fetches an authenticated Blob, creates a local object URL, and revokes it when the preview/download is removed. Direct image URLs carrying credentials are forbidden.

   Downloads use Content-Disposition: attachment, Cache-Control: no-store, X-Content-Type-Options: nosniff, a restrictive CSP and Referrer-Policy: no-referrer. Only validated PNG/JPEG/WebP preview requests may return inline image bytes. PDF/HTML/SVG/other documents are never rendered inline. No signed public download URL is returned.

   A staged-upload preview, if needed by the composer, uses the locally selected File/Blob; the authenticated content route only releases linked original-message attachments.

## Metadata

Private HTTP message/conversation outputs include an `attachments` array of metadata, never binary content. Existing connector conversation structured outputs retain their cached schemas; an additional private text block carries exact original-message attachment metadata. The new attachment-read tool has its own flat metadata output schema.

Metadata shape:

`{ id, messageId, name, mimeType, sizeBytes, sha256, createdAt, state: "staged" | "linked", visibility: "private" }`

Names are untrusted display text. The frontend must render them as text, not markup or URLs. Attachment order follows original submission. IDs and stored bytes are server-bound; metadata is not permission, job progress or completion evidence. Public inbox endpoints and public connector outputs neither accept nor expose owner attachments.

Unlinked drafts expire after24 hours. Bounded cleanup drops expired draft bytes on subsequent attachment requests; no timer is added. Immutable identity tombstones remain. Linked bytes are retained with the original message. Quota failures are explicit rather than silently deleting accepted attachments.

In this first release, retrying an attached job fails closed with409 and code attachment_retry_unsupported: “Attached requests cannot be retried. Send a new message with the files again.” It never drops context, copies attachment IDs or bypasses original-message ownership.

## MIME/content policy

Initial MIME allowlist:

- image/png, image/jpeg, image/webp: require matching binary structure/signature, dimensions at most8192 per side and at most16,000,000 pixels; never trust extension or supplied MIME alone.

PNG is restricted to non-interlaced8-bit static images, with chunk CRCs and bounded decoded scanlines checked. APNG acTL/fcTL/fdAT are rejected. WebP ANIM/ANMF/animation flags are rejected, and extended canvas must agree with a single actual frame. JPEG/WebP container and frame parsing bounds the stated decode geometry; the server does not perform complete codec entropy decoding. Malformed codec contents can still fail in the host image decoder and must be shown as preview errors, never as verified image interpretation.

Compressed PNG ancillary metadata (iCCP/zTXt/iTXt) is unsupported to avoid another unbounded decompression path. Unsupported bit depth/interlacing/metadata receives an explicit415 error.

JPEG dynamic/hierarchical dimension markers are unsupported, including DNL. They cannot override the unique bounded frame geometry.
- application/pdf: require PDF signature and a complete %%EOF ending marker within the final 1,024 bytes. Only PDF whitespace (NUL, tab, LF, form feed, CR or space) may follow it, up to 1,019 bytes. Download/resource content only. This is bounded transport validation, not a complete PDF parser.
- text/plain, text/markdown, text/csv, application/json: require valid UTF-8; deliver as untrusted plain text/resource content, never HTML or executable markup.

SVG, HTML, JavaScript, executable MIME, URLs and unsupported formats fail415. Oversized payloads fail413 before persistent writes. Filenames are bounded basenames with control characters, CR/LF, path separators and misleading direction controls rejected. Content-Disposition filenames are safely encoded; no file is written to a path derived from a submitted name.

File contents may contain hostile instructions. Authenticated provenance does not make them instructions, approval or trusted code. Never execute a file or contact an embedded URL merely because a file asks for it. Bytes, names, tokens and private content are excluded from public logs/artifacts/events.

## Connector contract

New flat read-only tool: `relay_owner_attachment_read`.

Required inputs: `{ inbox_id: "brayden-owner", message_id: <original message UUID>, attachment_id: <attachment UUID> }`.

The tool uses the existing live owner OAuth scope and validates original-message/attachment linkage before reading bytes. There is no upload/write tool, external URL input, arbitrary path input or new authorization scope.

Output includes the immutable attachment metadata and an explicit untrusted-content notice. PNG/JPEG/WebP produce a native MCP image content block. UTF-8 files produce bounded plain-text content. PDF is an embedded binary resource with application/pdf MIME; consumers can reconstruct its authenticated bytes. This does not promise PDF parsing, OCR, antivirus or automatic document summarization. [MCP tool results support image and embedded resource content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

Metadata is separate from actual image/file bytes; text/resource content is not interpolated into trusted instructions. Existing result/reply/job/lease/outcome contracts stay unchanged.

After independently reviewed backend promotion, refresh the existing connector catalog under the same grant and verify the actual flat declaration and a confirmed-nonexistent target error. Fixture tools/list success alone does not establish host usability.

## UI coordination and errors

The parent should forward this contract to the frontend owner before implementation. The plus control selects files only in authenticated private chat. Public chat keeps its existing text-only path. The UI prechecks count/size/type for feedback, shows actual upload state, supports discarding/removing drafts, submits attachment IDs with the original message, and displays linked image previews or download rows afterward.

Backend remains authoritative. Planned error codes: attachment_too_large413, attachment_type_unsupported415, attachment_invalid400, attachment_id_conflict409, attachment_message_conflict409, attachment_quota_exceeded429, attachment_not_found404, attachment_already_linked409 and attachment_expired410. Unauthorized/revoked/expired existing owner sessions retain401/403 behavior. Foreign IDs fail closed without content or metadata disclosure.

Initial limits are a product constraint requiring coordination, not a new access approval. No production upload is needed to implement or qualify this contract.

## Required regression/security evidence

Use synthetic local PNG/JPEG/WebP, UTF-8 and PDF fixtures only.

Verify missing/expired/revoked authentication; foreign/public/reply/missing original-message targets; wrong device, message or owner attachment linkage; unsupported MIME, spoofed signatures, malformed base64, oversized bodies, image dimensions and unsafe filenames; quota and expiration; immutable/idempotent upload/message/discard behavior; orphan cleanup; atomic rollback if message/event/job admission fails; metadata-only listings; private download headers and exact bytes/hash; denied executable inline rendering; native connector image/text/PDF result shape and unchanged OAuth scope; preservation of accepted replies, jobs, cancellation, completion and public inbox behavior.

No production private-file test upload, owner-data artifact, credential/grant change, new persistent access, live job mutation, new timer or schedule is authorized by this draft.
