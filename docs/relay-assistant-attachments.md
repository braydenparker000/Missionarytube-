# Private assistant attachment delivery contract

Status: implemented draft for independent review and paired frontend qualification. This branch starts from active release 97b048abfde97426da7b5eb3a310964631ce724c. Synthetic local attachment checks pass, including actual workerd/public MCP routing. It does not enable production changes.

## Native MCP delivery from available bytes

All tools are flat, require the existing live relay:owner OAuth capability, and return metadata only for writes. Supply actual available file bytes encoded as canonical base64; there is no URL/path fetch, invented artifact ID, public object URL, credential argument or new grant.

The local helper scripts/relay-assistant-file-args.mjs validates and packages an available image/PDF/supported file into the exact upload arguments, using bounded reads, stable supplied UUIDs and a local SHA-256. It has no credentials, network or write capability. A caller can load its JSON output programmatically and pass arguments to the refreshed native upload tool without printing private file bytes into the conversation or publishing them in logs. Invocation: node scripts/relay-assistant-file-args.mjs <local-file> <original-message-UUID> <delivery-UUID> <attachment-UUID> [MIME]. A local filesystem path is consumed only by this helper, never accepted or fetched by the backend MCP tool. After staging, compare the receipt hash/size and commit with the same stable IDs. Do not treat successful packaging as file delivery.

1. relay_owner_attachment_upload({inbox_id:"brayden-owner",message_id,delivery_id,attachment_id,name,mime_type,data_base64})
   - message_id is the existing authenticated private original user message.
   - Choose stable UUIDs for delivery_id and attachment_id before starting. Every file for one delivery uses the same delivery_id.
   - Stage one bounded validated file. Return {inbox_id,attachment,newWrite,visibility:"private"}.
   - Identical retries return the existing receipt; changing bytes, names, MIME, target or original message cannot replace it.
2. relay_owner_reply_with_attachments({inbox_id:"brayden-owner",message_id,delivery_id,body,attachment_ids})
   - Commit the first immutable accepted reply and its ordered files atomically.
   - One to four distinct staged files; body may be empty for a file-only reply.
   - Existing accepted replies remain untouched. A conflicting reply fails; choose the later-deliverable tool when the original already has an accepted reply.
3. relay_owner_deliverable_send({inbox_id:"brayden-owner",message_id,delivery_id,body,attachment_ids})
   - Append one immutable later assistant deliverable to the original conversation.
   - For an owner-requested text progress update, pass nonempty body (at most 6,000 characters) and attachment_ids: []. Files remain optional only for this later-delivery tool; the first file reply still requires one to four staged files.
   - It neither consumes nor replaces an accepted reply, rewrites a job result, nor marks work complete.
   - The same stable UUID, body, ordered file IDs and original message are required on uncertain-write retries.
   - Both commit tools return {inbox_id,delivery,newWrite,visibility:"private"}.
   - Text updates share the existing 32-delivery limit, authentication, grant binding and stable creation-order pagination. They are agent-authored status text, not independently verified execution or completion evidence. No new scope, credential or HTTP route is introduced.
4. relay_owner_attachment_discard({inbox_id:"brayden-owner",message_id,delivery_id,attachment_id})
   - Dispose only the same grant's unlinked stage; linked files remain immutable.
   - A bounded cancellation tombstone prevents a delayed upload from resurrecting that UUID.
5. relay_owner_deliverables_list({inbox_id:"brayden-owner",message_id,cursor,limit})
   - Bounded stable creation-order pages of later deliverables. cursor and limit are optional, default 10, maximum 25.
   - {inbox_id,message_id,deliverables,nextCursor,visibility:"private"}.

Accepted files remain readable by the existing owner-authenticated download and relay_owner_attachment_read paths. Staging/publishing ownership is bound to the originating live grant; no grant identifier is returned. Keep the original bytes and stable IDs until an uncertain write is reconciled by an identical retry or an authenticated read.

Assistant file/delivery UUID reservations are symmetric with inbound uploads, unknown-file disposal and prospective user-message IDs. New writes cannot reuse a reserved identity; the same checks run before validation and at final admission to close asynchronous races. Identical already accepted deliveries reconcile from their stored provenance/body/ordered files before checking for a later alias admitted by an older Worker. Already accepted inbound byte identities also retain their exact retry behavior. This does not rename, delete or replace either accepted record.

## Frontend contract

GET /relay/owner/conversation?message_id=<original UUID> adds:
- reply.attachments for a first reply committed with files.
- deliverables: the first creation-order page (up to 10).
- deliverablesNextCursor: string or null. Additional pages use GET /relay/owner/deliverables?message_id=<original UUID>&after=<cursor>&limit=<1..25>.

Each later delivery is:
{id,messageId,kind:"deliverable",role:"assistant",body,createdAt,author_authenticated:true,principal:"github:183016859",authentication_source:"owner-oauth-mcp",visibility:"private",attachments:[metadata]}

For a text update, attachments is empty and body is nonempty. The private phone view displays these under “Updates and files from assistant” in creation order, with the accepted reply intact. A cached native host may still enforce the old attachment_ids minimum of one; refresh its tool metadata under the existing relay:owner connection before using text-only updates. Do not claim live delivery from code/catalog tests alone or add credentials/scopes to bypass a stale schema.

Commit receipts use the same delivery shape with kind:"reply" or "deliverable". A reply delivery's id is the actual immutable accepted reply UUID. Filename and body remain inert untrusted display data. Attachment metadata remains:
{id,messageId,name,mimeType,sizeBytes,sha256,createdAt,state:"linked",visibility:"private"}
messageId always identifies the original private user message, including files delivered on replies/later deliverables. Original user-message attachments exclude assistant deliveries.

Use the existing bearer-only GET /relay/owner/attachments/content?message_id=<metadata.messageId>&attachment_id=<metadata.id>, with preview=1 only for a validated raster image. Verify the actual byte size, MIME and SHA-256 before creating an in-memory object URL. PDF/text/JSON are downloads. No credentials in URLs, inline PDF frame, executable HTML or public download link. Existing preview/download lifecycle cleanup applies.

These are conversation file-delivery facts, not completion or execution evidence. Render later deliverables separately from accepted replies and job result corrections. Keep the accepted reply stable. The cached existing MCP conversation output schema stays compatible; additive file/deliverable details are separate private content blocks, and the new list tool provides pagination.

## Bounds and safeguards

Reuse the supported static PNG/JPEG/WebP, PDF, UTF-8 text/Markdown/CSV and JSON formats and validators. Preserve the 1 MiB/file, four files/delivery, 128 staged owner files, 64 new uploads/day, 16 MiB/day, 64 MiB retained bytes and 1,024 lifetime attachment identities. Both inbound and outbound files share these quotas. At most 32 later deliveries per original conversation. Unlinked stages expire after 24 hours with retained identity tombstones.

The large MCP envelope is allowed only for an authenticated owner attachment-upload tool header. Admission attempts are charged before its body is read, and codec attempts before expensive validation. Other MCP requests retain their existing small limit. Authentication is rechecked after asynchronous validation and inside the final synchronous write/link transaction.

No frontend implementation, live upload, deployment, credential/scope change, new storage provider, schedule or job-completion control is included in this backend draft. Native host file-byte availability/catalog refresh and actual host-to-live private delivery remain explicit release acceptance checks.

## Synthetic qualification evidence

The focused inbound/outbound attachment suite passes 83 checks without skips. Tests cover lost stage/commit responses and identical retries; ordered file linkage; cross-message/delivery/grant isolation and actual public/reply/foreign-owner rows; cancellation during hashing and permanent identity tombstones; quota races and admission before body/codec work; revocation; active execution ownership; atomic reply/event/link rollback; preservation of accepted text replies, result versions and completed execution attestations; later deliveries before an accepted reply; identity collision protection; and pagination at the 32-delivery limit.

Seven review regressions cover accepted-reply and later-delivery UUID reuse by inbound uploads; reconciliation with a preexisting legacy alias; pending/accepted UUID reuse by new messages and staging; no-op inbound cancellation against reservations; reverse inbound reservation protection; both completion orders of held upload hashes; and user-message admission during a file hash. Six failed on the prior candidate, and all seven pass after the symmetric guard/reconciliation fix. These are local synthetic state/race tests; they do not upload owner data.

The local workerd test uses actual public /relay/mcp requests, OAuth token validation, production Worker/Hub routes and SQLite. It stages a genuine image, commits a file-only first reply, appends a genuine PDF and maximum 1 MiB UTF-8 file, retries commits, checks native read results and exact authenticated download bytes/hash, rejects wrong-original and unauthorized downloads, verifies session revocation and records zero outbound egress. This is local native transport/runtime evidence, not a claim of live ChatGPT host delivery or production TLS/CORS qualification.
