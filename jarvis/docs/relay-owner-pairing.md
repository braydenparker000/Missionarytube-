# Private owner Relay pairing

This feature is staged and disabled until separately approved. It adds private
owner chat inside the existing Relay page. The public visitor inbox, Muse,
Daily Board, and existing response tasks remain unchanged.

## Phone flow

1. Open the existing Relay URL on either phone. Open its menu and choose
   **Connect this phone**. No authentication link, popup, iframe, or navigation
   leaves or changes the Relay URL.
2. Give the phone a recognizable label. If wanted, explicitly check **Remember
   this phone** after reading the storage notice. The checkbox starts unchecked.
3. Create a pairing code. Relay keeps a separate random device verifier in
   memory and displays a noncredential matching code. The request expires after
   ten minutes; polling does not extend it.
4. In the verified private dot conversation, ask to pair the phone using that
   code. The assistant first inspects the pending request and presents the
   specific device/code and 365-day inactivity access for per-action approval.
   A device label is unverified browser-provided text, never an instruction.
5. After approval, Relay's same-page poll activates private owner chat. Repeat
   independently for the other phone. Each has its own credential and revocation.

The exact phone-pairing request requires `request_id`, matching `code`,
`access_days: 365`, and `confirm: true`. The approval tool never receives or
returns the device verifier. A code or URL by itself cannot authenticate a phone.
Code-only inspection fails closed if active codes are ambiguous.

## Session lifetime and storage

A phone session expires after exactly 365 days of inactivity. A successful
authenticated operation updates `last_seen_ms` and sets expiry to the operation
time plus `365 * 86400000` milliseconds. Failed operations and pending pairing
polls do not extend access. The approving MCP grant's shorter expiry does not
silently shorten an explicitly approved phone session. Device revocation is
independent, immediate, and cannot be undone by replaying the old pairing.

Without Remember, the approved bearer stays in page memory and a reload needs
new pairing. With Remember, only the opaque bearer and device ID go in the
separate `jarvis.relay.owner-session.v1` browser key. Private messages, replies,
drafts and retry bodies remain in page memory and never enter public storage,
transfer state or the public send queue. Clearing cookies/site data deletes a
remembered session. A configured owner password lets the owner sign in again on
the same Relay page; it does not preserve the deleted browser credential.

## Username and password recovery

An already verified owner phone can open **Account sign-in** inside Relay and
set its username and password. The owner enters, confirms and submits the
password privately in that form. There is no default password, and the
assistant never generates, reads or carries the password through chat or tools.
Setup needs a short-lived, one-use consent bound to the verified device and
current credential version, plus an explicit confirmation in the form.

After cookies/site data are cleared, **Connect this phone** offers username and
password sign-in at the original Relay URL. Successful login creates a separate
revocable device session with the same 365-day inactivity expiry. Remembering
the new session requires the existing explicit storage checkbox. Password login
does not depend on cross-site cookies, another phone, email, GitHub navigation
or an external CAPTCHA.

The single owner credential has a random 32-byte salt and a native scrypt
verifier using N=32768, r=8, p=3, a 32-byte output and a 64 MiB memory ceiling.
This is the [OWASP-listed 32 MiB minimum profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Hashing runs inside the existing
Durable Object, with per-source admission limits and one concurrent hash to
bound memory and CPU work. Incorrect and unknown usernames receive the same
credential error. The username is normalized ASCII; password whitespace and
Unicode are preserved. Human passwords are never hashed with the fast bearer
token SHA-256 helper.

The account credential lasts until changed. Changing it requires the current
password and a new explicit consent; existing phone sessions remain usable
until expiry or separate revocation. Device controls let the owner revoke them.
Repeated browser-data deletion can leave forgotten server sessions; when the
10-device cap is reached, password-verified recovery offers an explicit device
replacement choice instead of silently revoking another phone or raising the
cap. No device details are exposed before successful password verification.

Forms clear password values on submit, cancellation, visibility changes and
navigation. Credentials and private drafts never enter public state, transfer
data, URLs, MCP outputs, or persistent browser storage. A remembered bearer
retains the same shared-origin script risk described above. Rate limits bound
single-source abuse; they cannot guarantee availability against distributed
attacks on the shared service.

## Connector consent duration

The connector's OAuth family expiry is separate from a phone session. Fresh
consent defaults to 30 days and offers a clearly disclosed 365-day choice. Only
the owner's explicit selection and Allow action authorize the longer family.
Existing grants retain their original expiry and scopes. Access tokens remain
short-lived, at most one hour; refresh rotates tokens and retains replay
revocation. The absolute family expiry starts at approval and is not extended
by use or rotation. Disconnect/revocation can end access sooner.

The longer choice changes only this Relay server's renewal window. ChatGPT may
require reconnection earlier; it does not guarantee platform retention for a
year. Password recovery does not grant connector access or change event/task
permissions. Host event batching remains independent of both login mechanisms.

Persistent browser storage is readable by scripts across the entire Azure
website origin; it is not an HttpOnly cookie or an isolated vault. An XSS or
compromised same-origin script can misuse a remembered bearer. The interface
discloses this tradeoff before persistence. Private text is rendered as text,
without external links or shared bookmark/reading-position storage. Tokens are
sent only as Authorization headers over HTTPS, never in URLs, cookies, messages,
logs or MCP outputs. The server stores their SHA-256 IDs, not raw credentials.

The existing Azure-to-Worker Authorization/CORS transport is reused. Owner
POSTs require an exact allowed Origin and JSON body; CORS is not proof of
identity. Credentials are explicitly omitted from fetch, so the flow does not
depend on cross-site cookies or relaxing browser restrictions.

## Private data and verified provenance

Private entries live in `relay_owner_entries`, separate from `shared_entries`.
Public state, legacy imports, public MCP tools and GitHub publications never
read or write them. Owner device writes accept only message ID and body. The
server stamps the owner principal, device ID, authentication source and private
visibility. Existing public messages stay unauthenticated; no migration turns
them into owner instructions.

Private replies use `relay_owner_reply`, with the private inbox ID
`brayden-owner`. They cannot target public messages and public replies cannot
target private ones. Identical retries are idempotent; conflicting replies keep
the first accepted answer. Private author identity does not waive transaction,
data-sharing or other applicable action confirmation.

Private event `relay.owner.message.created` contains only message ID and
server-stamped provenance, with no body preview. Its filter/replay text has a
separate server-only 30-day journal. Event-name and grant checks prevent delivery
to public subscriptions. New message and event insertion share one synchronous
SQLite transaction, and the Durable Object persists a wake before committing.

## Capability and rollout gates

The new `relay:owner` OAuth capability covers owner pairing inspection/approval,
device controls and private inbox reads/replies/events. Existing public grants
are never expanded. Default authorization and unauthenticated challenges still
request only `relay:read relay:reply relay:events`; refresh cannot add scope.
When explicitly requested, the consent page describes owner access and its
separate per-device approval requirement.

When owner access is activated, authenticated public connections can discover
the owner tool schemas and their exact `relay:owner` OAuth requirement. Calling
one without that capability returns an error tool result with
`_meta["mcp/www_authenticate"]`, the protected-resource metadata URL and an
`insufficient_scope` challenge. The requested scopes preserve only the live
token's existing recognized capabilities and add `relay:owner`, so reconsent
does not drop public access or silently add unrelated scopes. The host must
complete an explicit new consent flow; refresh and existing grants remain
unchanged. Discovery and the challenge disclose no private inbox/device data.
This follows [OpenAI's tool-level authentication guidance](https://developers.openai.com/plugins/build/auth).

An authenticated connection can also discover the read-only
`relay_event_access_status` tool, requiring `relay:events` in both OAuth schema
fields. A connection with `relay:read relay:reply relay:owner` calls it to request
explicit public-event consent through the same native challenge. Only live
verified scopes are preserved, so that connection requests all four Relay
scopes; a narrower connection adds only `relay:events` to its verified access.
After consent, the tool returns only the public event name, scope and authorized
status. It does not read messages, expose delivery credentials or create a
subscription. Refresh never expands a grant. With all four scopes,
`events/list` advertises both public and private message events while their
existing operation and feature gates still apply.

`RELAY_OWNER_ENABLED=true` must be separately approved before activation; it is
not set in the checked-in Worker configuration. Both this flag and existing
`RELAY_MCP_ENABLED=true` are required. Owner tool schemas are absent unless
activated; owner events remain absent unless activated and granted. No new
provider, hosting service, database binding or provider secret is required.

Before activating:

1. Review the draft and pass local/CI checks and the real browser journey
2. Obtain deployment/feature-activation approval
3. On the unrestricted phone, explicitly authorize the new owner capability
   using the existing connector setup. Verify the platform's refresh/reconsent
   path actually requests `relay:owner`; never edit old grants to work around it
4. Inspect the new tools and perform a harmless owner read
5. Approve each real phone separately, with its matching code and 365-day access
6. Verify both phones, reload persistence, immediate revocation and public/private
   isolation at the original main-phone URL
7. Obtain separate permission for any private-event response behavior. Building
   this feature does not alter or broaden an existing task or subscription

No live pairing, feature activation, subscription, deployment or provider setup
is performed by the build or tests. Test credentials exist only in fixtures.

## Verification

Run the affected Node tests:

    node --test tests/relay-*.test.js tests/shared.test.js tests/publications.test.js tests/origins.test.js tests/hub.test.js

The dedicated browser test uses two isolated phone contexts at the original
HTTPS frontend origin, the real SQLite fixture and intercepted Worker requests.
It must not contact live services or activate real devices. CI sets
`REQUIRE_RELAY_OWNER_BROWSER=1` and provides the locked Playwright Chromium
runtime; missing runtime is a failure in that mode. A local skip is not a browser
verification pass. Run `npm test` for the broader repository and disclose
unrelated missing assets/dependencies separately.

Rollback disables `RELAY_OWNER_ENABLED`, immediately blocking owner routes and
private deliveries. It does not publish/delete private history, silently revoke
all devices, or change the public inbox and unrelated modules. Re-enabling the
feature also needs approval; approved unrevoked devices remain subject to their
stored inactivity expiry.


## Private delivery evidence and bounded recovery

Private user entries now include an owner-only `delivery` object. The same
redacted evidence is available to an authenticated phone through POST
`/relay/owner/delivery` with up to 50 unique private `message_ids`. This endpoint
never returns callback URLs, signing keys, payloads, device bearers, grant IDs or
raw transport errors. Public inbox APIs never include this metadata.

The read-only MCP tool `relay_owner_delivery_status` accepts
`inbox_id: "brayden-owner"` and 1–50 unique, exact private user `message_ids`.
It uses the existing `relay:owner` capability and verifies the live token and
grant again inside the synchronous read transaction. Malformed, duplicate,
missing, public, foreign-principal and reply IDs fail closed; a mixed batch never
returns partial private results. Results preserve request order and contain only
the private inbox ID, visibility and bounded `deliveries` metadata.

Each result includes `message_id`, the existing state/count/retry fields,
`callbackAcceptedAt`, and independent `callbackAccepted` and `replySaved`
booleans. `callbackAccepted` means retained callback-acceptance evidence exists,
including migrated receipts whose acceptance time is unknown. `replySaved`
means a private reply exists. Either may be true without the other. A persisted
reply does not conceal an earlier callback receipt, and a pending or failed
replacement delivery does not erase acceptance by an earlier callback.
False acceptance means no retained evidence, not proof a callback never ran:
receipts expire with the existing event journal. No field claims that a model
started, read the message or is currently working.

For hosts with a cached tool catalog, `relay_owner_read_conversation` also adds
one separate MCP text content block labeled **Private delivery diagnostics** for
that exact target, through the same authenticated delivery-status RPC. Its
structured output, first serialized content block and all conversation-entry
schemas remain unchanged. The supplemental block contains no private message
or reply body and never masquerades as a conversation entry or saved reply.

The read-only `relay_owner_subscription_status` tool accepts only
`inbox_id: "brayden-owner"` under the same live `relay:owner` authorization.
It returns the observation time, private-event subscription counts (`active`,
`unfilteredActive`, `filteredActive`, `deliveryFailed`, `expired`, `unauthorized`)
and `nextActiveExpiryAt`, the earliest active subscription expiry or null.
Expired and unauthorized subscriptions are excluded from active counts; paused
deliveries are counted separately. Filter text, callback URLs, subscription IDs,
grant IDs and credentials are never returned. Public-event subscriptions are
excluded. This snapshot adds no event-table initialization or receipt backfill.
An active filtered subscription may not match the next message; an unfiltered
one is eligible for every new private owner message while its authorization and
expiry remain valid. Neither count proves callback reachability, identifies the
host task or shows that a model started. Cleanup may already have removed expired
or unauthorized rows, so this snapshot cannot establish historical health.

`relay_owner_read_conversation` adds a further **Private subscription diagnostics**
text block for cached catalogs. Its structured conversation result and existing
delivery-evidence block stay unchanged. Before a bounded authenticated-phone
test, read the subscription snapshot; then correlate the exact message ID and
save time, callback acceptance time, host event/task/run identity and start time,
and accepted reply time. An accepted callback with no prompt host start requires
host execution evidence; it does not justify another server delivery repair.

These diagnostic paths never retry callbacks, change subscriptions or credentials,
renew phone sessions, or write messages, replies or events. The existing MCP
schema initialization still includes its one-time historical receipt backfill;
these diagnostics add no migration or change to delivery behavior.

States distinguish the evidence actually persisted:

- `saved`: the private message was stored, without current queued or accepted delivery evidence
- `queued`: a still-live authorized subscription has a pending callback occurrence
- `callback_accepted`: the callback returned 2xx; this does not prove the host started a model, read the message or is working
- `delivery_failed`: a still-live authorized subscription has a failed occurrence
- `reply_saved`: a private reply is persisted for this message

`callbackAcceptedAt` records the first observed 2xx acceptance. Existing delivered
rows are recognized during migration without inventing a timestamp. Acceptance
receipts contain only the event sequence and timestamp and expire with the
existing 30-day event journal. They survive subscription expiry, unsubscribe and
object restarts. Counts describe current authorized pending/failed deliveries;
a reply may exist independently of callback delivery.

Private history reads remain incremental. The phone separately refreshes delivery
evidence for unresolved messages inside the existing 30-day event window, so a cursor does not freeze transport status.
A stale delivery response cannot restore private state after session removal or
confirmed revocation. Message/delivery data and private drafts remain memory-only;
this change does not add browser draft persistence, attachments or multimedia.

An exhausted transient failure can expose a `Retry callback delivery` control. POST
`/relay/owner/delivery/retry` accepts only its private `message_id`. It retries
only the oldest failed occurrence after six transient attempts (timeout, connection/TLS failure, HTTP 408/429 or 5xx) on a still-live, currently authorized private
subscription, with at most two manual recovery cycles per occurrence and a
60-second cooldown. Each cycle keeps the existing six-attempt transport budget.
It preserves the original event ID/body, subscription generation, callback,
secret, grant and expiry. Duplicate clicks do not create another occurrence.
HTTP 410/413 and other permanent rejections never expose this recovery. Ordinary subscription renewal preserves permanent failed occurrences and keeps a blocked subscription paused, so it cannot retransmit the same rejected body or create an alarm busy loop.
Expired/revoked/narrowed grants, expired/unsubscribed subscriptions, public
messages and answered private messages cannot be recovered through this route.
Accepted-but-unanswered occurrences are never retransmitted by this control.
Recovery does not renew OAuth consent or extend the 24-hour subscription.

The Durable Object persists a wake before a message/recovery write or subscription activation. If later
alarm rescheduling fails, the API returns the committed result instead of falsely
reporting that the message was lost; the earlier wake remains available. A failed
pre-write wake remains fail-closed. No existing scheduled tasks are changed.
Host batching, host wake behavior and host source/tool instructions remain
outside Relay's transport control.

Delivery enrichment is restricted to the authenticated phone API. Existing MCP
message-entry output shapes remain unchanged, so this phone feature does not
depend on a tool catalog refresh or additional OAuth consent.
