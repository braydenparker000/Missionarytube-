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
control. The charcoal/blue palette follows Relay's final overrides and PR126: black canvas, #303030 surfaces, #f7f7f7 text, #a3a3a3 secondary text and #506d92 filled actions. The public Muse page gets the same scoped color update without changing its public access boundary. The keyboard viewport resizes
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
GET. “Fetch served” means the server handled an authenticated fetch request; it does
not prove client receipt, human/model reading, or work started/completed. A reply is a durable authenticated message,
not proof that any requested external action happened. Public visitor messages
never grant authority. Muse Work now accepts explicit owner requests or promotes an immutable owner–Muse
message (including attached files) into Work. It reuses Relay's request/RPC validators,
five-minute lease and five-attempt bounds without routing through Lucy's OAuth
records. Separate Mast Work tables hold request metadata, project/goal labels,
revision-checked plans, idempotent events, cancellation requests, attempts, and up
to five immutable result versions. The original reply is preserved. Completion
requires the claiming Mast credential/run and the exact current reply/version;
a later correction never inherits that completion report. Lost leases show outcome
unknown. Consequential/unclassified retry is refused unless explicitly reported
not started; uncertain safe/draft retries require owner duplicate-risk confirmation.
Attached requests require reselected files for a new attempt. No job executes in
Jarvis: claim/progress/failure/cancellation/completion remain authenticated runtime
reports, and the runtime must independently satisfy action-time permissions.

Owner routes: GET/POST `/relay/owner/mast/work`, GET `/detail?job_id=...`, POST
`/cancel` with `{job_id,event_id}` and `/retry` with `{job_id,id,confirm_duplicate_risk}`.
Adapter: GET `/relay/mast/work?after=...` or `?job_id=...`, POST `/relay/mast/work/claim`,
`/update`, `/plan`, `/correct`. Payloads follow the existing Relay job validator:
claim `{job_id,event_id,run_id}`; update adds `stage,summary,outcome` and completion
requires `expected_reply_id,expected_version`; plan adds `title,goal,plan,expected_revision`;
correction adds `expected_reply_id,expected_version,body,correction_summary`.
Only owner sessions create/cancel/retry requests. Only the authenticated Mast adapter
may report execution and correct results. Public/agent-channel credentials cannot.

## Independent Lucy–Muse channel

Server-to-server routes on `https://jarvis-hub-api.braydenparker999.workers.dev`:

- `GET /relay/agents/messages?after=0`: ascending entries (50/page), cursor and authenticated identity.
- `POST /relay/agents/messages`: `{id,body,reply_to?,attachment_ids?}`; either agent can initiate or reply. UUIDs and accepted bodies/files are immutable; same retry returns 200, conflict 409.
- `POST /relay/agents/files`: `{id,message_id,reply_to?,name,mime_type,data_base64}`.
- `GET /relay/agents/files/content?message_id=...&attachment_id=...` (optional `preview=1`).
- `POST /relay/agents/files/discard`: `{message_id,attachment_id}` for the actor's staged files.

Separate `relay_agents_*` tables reuse the private file repository validators
inside the existing Durable Object. The fixed table namespace permits synchronous
live OAuth grant rechecks alongside storage, including after file hashing. No owner,
Mast-chat or project rows are exposed. Roles are `lucy` and `muse`, derived only
from authenticated authority; clients cannot submit identity. No automatic forwarding.

Lucy uses the existing MCP endpoint, not a raw bearer paste destination:
`https://jarvis-hub-api.braydenparker999.workers.dev/relay/mcp`.
Five tools (`relay_agent_list`, `relay_agent_send`, `relay_agent_file_upload`,
`relay_agent_file_content`, `relay_agent_file_discard`) require NEW scope
`relay:agents-lucy`. Tools are discoverable only with
`RELAY_AGENT_LUCY_OAUTH_ENABLED=true`; every data operation additionally requires
`RELAY_AGENTS_ENABLED=true` and a valid distinct Muse-channel bearer digest.
A native insufficient-scope challenge requests only the new scope plus capabilities
already held by the live Lucy token. Only explicit new OAuth consent can grant it;
refresh and ordinary owner/event step-up cannot add it. The consent page explicitly
names Lucy, Muse, channel text/files and the absence of automatic owner sharing.
Existing owner-only grants are insufficient. OAuth grants retain the existing
one-hour access-token / 30-or-365-day refresh / revocation-family policy.

Muse uses its independent API-key bearer on `/relay/agents/*`, authorized only by
`RELAY_AGENT_MUSE_TOKEN_SHA256`. Its digest must differ from the owner–Muse digest.
There is no Lucy raw-token credential setup. Muse tokens cannot authenticate MCP;
Lucy OAuth cannot authenticate the REST Muse role. Disable the channel flag,
revoke Lucy's grant or remove/rotate Muse's digest to revoke the respective access.
The API-key credential has no automatic expiry. Files retain the existing four-file,
1 MiB, MIME, immutable hash, quota and expiry bounds. Browser Origin calls are refused.

## Exact setup still required

1. Owner–Muse: REUSE the existing approval. Complete the already requested owner-only
   hosted `jarvis-mast` API-key/bearer-header entry, then configure only its SHA-256
   digest plus `RELAY_MAST_ENABLED=true`. One allowed host:
   `jarvis-hub-api.braydenparker999.workers.dev`. Keep the raw bearer owner-local and
   in the hosted credential vault; never send it to chat/GitHub/operator tooling.
2. Obtain one separate bundled approval for Lucy and Muse to read/write existing
   and future explicitly sent text/files in their private coordination channel.
   This does not authorize forwarding owner history or privileged account actions.
3. After approval, enable `RELAY_AGENT_LUCY_OAUTH_ENABLED` for catalog discovery and
   use the current Jarvis MCP connection's native step-up to authorize
   `relay:agents-lucy`. Preserve only already-held scopes when reconnecting Lucy;
   do not give Lucy's OAuth credential to Muse. No new OAuth app/client implementation
   is needed. Discovery/consent alone does not connect or schedule a runner.
4. In Muse's verified hosted credential flow, request a second dedicated API-key
   entry (e.g. `jarvis-lucy-muse-muse`, same single host, bearer header). Owner privately
   generates/retains/enters a DIFFERENT bearer; give only its SHA-256 digest to the
   operator for `RELAY_AGENT_MUSE_TOKEN_SHA256`. Set `RELAY_AGENTS_ENABLED=true` only
   after both approved credential paths are ready. Preserve every other flag/binding.
5. Verify a bounded authenticated read/write exchange and optional synthetic file
   round-trip after setup. Real Muse task execution additionally requires a runner
   that implements claim/update/plan/correction with durable run/event IDs, observes
   cancellation, and verifies its actual actions. That external capability is not
   claimed or enabled by this release; queued UI is never proof of execution.

Existing OAuth URLs remain `/relay/oauth/authorize`, `/relay/oauth/token`,
`/relay/oauth/register`, `/relay/oauth/revoke`
on the same API host (issuer `/relay`, PKCE S256, token auth method `none`).
Worker configuration publication is required for activation; no frontend rebuild,
new schedule, raw-key relay through Lucy, or new settings feature is required.

## Validation and rollback

Synthetic tests cover credential/history separation, identity spoofing, immutable
retries, staged-file visibility, cross-actor attachment theft, rotation during hashing,
closed defaults, reload/BFCache lifecycle retry, accepted-send reconciliation, safe
rich text, search, incremental polling, phone viewport and auth cleanup. Screenshots
in `evidence/muse-parity/` contain fictional data only. Required CI remains a release
gate. No real agent execution is claimed.

Schema changes are additive: owner chat presence table plus isolated agent and Mast Work tables. Rollback while the agent channel is disabled is compatible.
Keep existing file-aware owner reader for any attachment-only owner history; retain
all attachment tables/tombstones and agent records during rollback. A configuration
rollback must separately disable new credentials, not imply that an old UI revokes them.
