# Private Muse chat and Lucy–Muse channel

This release builds on source `8ca912e1cc0f3751bf852d6373267322c79755ff`.
The live audit found source `84d2b02702b64ef09f6f9a44575f5591598860ce`,
with the Mast adapter returning 503 (not activated). UI delivery is not agent connection.

## Owner conversation

`/mast/` remains the stable private URL; its displayed name is Muse. `/muse/`
remains public and is never a fallback. Relay's private menu distinguishes both.
The owner uses the existing owner sign-in/session. No Lucy attachment presentation
or existing schedule changes.

Chat parity now includes shared safe rich text/code rendering and copy actions,
inline verified images and file downloads, local conversation search, explicit
text export, grouped dates, scroll-position preservation and a latest-message
control. The warm editorial palette follows Relay. The keyboard viewport resizes
the reading area and keeps the composer in view. Owner connection management
continues to use Relay's existing account/device UI.

Unsent text and frozen pending IDs live only in sessionStorage for this tab and
this device. Ordinary unsent text expires after 24 hours; uncertain accepted-send
intent is retained until reconciled or explicitly cleared, never silently replaced
with a new ID. No transcript, file bytes or credential is stored in that journal.
Uploads still require a file to be reselected if interrupted before an immutable
message intent exists. Staged bytes expire under the existing file policy.
Failed/unavailable storage blocks submission; explicit clearing warns that the
previous message may have been accepted. Revocation clears private view, draft
and blob URLs. Reload reconciles accepted IDs; explicit Retry reuses unaccepted IDs.
Refresh fetches only entries after the last successfully fetched sequence.

Connection details show configuration separately from the adapter's last successful
GET. “Fetched by Muse” means returned to the authenticated adapter, not read by a
human/model or work started/completed. A reply is a durable authenticated message,
not proof that any requested external action happened. Public visitor messages
never grant authority. This release does not clone Relay Work jobs, result correction
or privileged execution into either chat; those are separate authorization contracts,
not implied by message delivery. Existing owner Work remains in Relay.

## Independent Lucy–Muse channel

Server-to-server routes on `https://jarvis-hub-api.braydenparker999.workers.dev`:

- `GET /relay/agents/messages?after=0`: ascending entries (50/page), cursor and authenticated identity.
- `POST /relay/agents/messages`: `{id,body,reply_to?,attachment_ids?}`; either agent can initiate or reply. UUIDs and accepted bodies/files are immutable; same retry returns 200, conflict 409.
- `POST /relay/agents/files`: `{id,message_id,reply_to?,name,mime_type,data_base64}`.
- `GET /relay/agents/files/content?message_id=...&attachment_id=...` (optional `preview=1`).
- `POST /relay/agents/files/discard`: `{message_id,attachment_id}` for the actor's staged files.

Dedicated Durable Object `jarvis-private-lucy-muse-v1` reuses the private file
repository schema and validators. Its entry roles are `lucy` and `muse`, determined
only by separate bearer hashes. Clients cannot submit identity. It contains no
owner conversation, OAuth grant or project history. Replies cannot target IDs from
another conversation. No messages are auto-forwarded. Files retain the existing
4-per-message / 1 MiB / MIME / integrity / quota / expiry bounds. Rotation is
rechecked after asynchronous file hashing. Origin-bearing browser calls are refused.

The route is closed unless `RELAY_AGENTS_ENABLED=true` and both independent
`RELAY_AGENT_LUCY_TOKEN_SHA256` and `RELAY_AGENT_MUSE_TOKEN_SHA256` are valid,
different SHA-256 digests and neither equals `RELAY_MAST_TOKEN_SHA256`.
Owner OAuth, owner device tokens and the existing Mast bearer do not authorize it.
There is no automatic token expiry. Disable the flag or remove/rotate the relevant
digest to revoke. No flags, credentials, grants or runner schedules are created here.

## Exact setup still required

1. Owner–Muse: complete the already approved owner-only secure bearer entry and
   configure its digest plus `RELAY_MAST_ENABLED`. Confirm a real runner fetch/reply
   separately; the last read-only live probe still found the adapter inactive.
2. Lucy–Muse: obtain separate action-time approval for each runtime's persistent
   read/write access to this channel, then use two dedicated secure bearer entries
   (single host above, bearer header) and their two digests plus the independent flag.
   The owner–Mast approval does not cover this new channel. No owner OAuth substitution.

## Validation and rollback

Synthetic tests cover credential/history separation, identity spoofing, immutable
retries, staged-file visibility, cross-actor attachment theft, rotation during hashing,
closed defaults, reload/BFCache lifecycle retry, accepted-send reconciliation, safe
rich text, search, incremental polling, phone viewport and auth cleanup. Screenshots
in `evidence/muse-parity/` contain fictional data only. Required CI remains a release
gate. No real agent execution is claimed.

Schema changes are additive: owner chat presence table plus independently created
agent-object tables. Rollback while the agent channel is disabled is compatible.
Keep existing file-aware owner reader for any attachment-only owner history; retain
all attachment tables/tombstones and agent records during rollback. A configuration
rollback must separately disable new credentials, not imply that an old UI revokes them.
