# Direct Lucy–Mast project inbox

This change adds a disabled-by-default shared-project channel to the existing
Jarvis Worker and `jarvis-shared-v2` SQLite Durable Object. It does not import or
publish GitHub comments. Public Relay, owner-private Relay, publications, alarms,
existing MCP tools, DNS-pinned callback delivery, and Poweramp UI are unchanged.

Mast's proposed route is durable HTTPS polling with the local hook adapter.
Lucy's supported route is typed tools on the existing OAuth MCP endpoint, backed
by an explicitly approved server-side project binding. A separately gated MCP
project event supports off-turn delivery through the existing signed, DNS-pinned
callback outbox. No hook, schedule, binding, credential, or subscription is
activated by this build. Delivery acceptance still does not prove model wake,
execution, or billing. The live health of `jarvis-relay-egress` was not checked.
Do not replace its DNS pinning with DNS-check-plus-fetch.

## Authority and approval boundary

A harmless live `relay_owner_subscription_status` call on 2026-10-10 at
18:50:51 UTC succeeded through the existing Jarvis Relay Current connection.
This confirms existing owner authorization is available; no new owner identity
or owner grant is proposed. The read returned aggregate status only, with no
private message history or credentials. It does not prove project membership or
model wake. The new project-grant tools still require deployment and explicit
management enablement before use.

The channel has two fixed participant identities, `lucy` and `mast`, per named
project. Either can read the entire project's history, send requests/notes to the
other, claim addressed requests, reply, report results, and recover blocked work.
There is no attempt to restrict the breadth of the project work they discuss.
These are **project agents**, never owner identities. Their text is inert data,
not shell code, approval, an infrastructure grant, or proof an action happened.

| Existing identity | Reuse decision |
| --- | --- |
| Public browser/workspace key | Not identity proof; rejected by this channel. |
| Existing owner GitHub OAuth | May administer explicit project grants only while the separate management flag is enabled. No automatic project membership. |
| Existing Lucy owner connector | Existing permissions stay unchanged; this build does not extract or copy its OAuth token. Typed project tools require a separately approved exact-grant participation binding; existing owner permissions remain separate. Management tools require both project flags and owner access. |
| Mast's GitHub/comment access | Not an HTTP project credential; no implicit trust or owner grant. |
| Owner phone/password session | Never shared with either project agent; rejected by this channel. |
| Existing project grant | Can be reused only if already explicitly approved for the exact project and agent; none were configured by this build. |

**New persistent access is a separate action-time approval:** each token-based named agent,
project, explicit expiry (at most 365 days), credential storage destination and
runtime must be approved before generating, registering or installing its token.
A token has the form `jpi_` plus 32 cryptographically random bytes encoded as 64
lowercase hex characters. Only SHA-256 of the complete token is stored in Jarvis.
The implementation never issues a token or returns one through an API. Local
fixtures use explicitly fictional values.

Registering the hash is still an access grant, not an innocuous configuration
write. Enabling `RELAY_PROJECT_ADMIN_ENABLED` adds an explicitly gated management
capability to existing `relay:owner` OAuth authority and also needs action-time
approval. It is off by default and can be closed during normal operations.
Revocation, rotation, extension or an additional project is an explicit management
action. Rotation creates a new independently approved grant and revokes the old;
there is no silent expiry extension or automatic identity provisioning.

A normal project token cannot call owner MCP, read private messages, administer
grants, or impersonate the other agent. Every read/write/ACK rechecks grant expiry
and revocation in the same synchronous SQLite transaction as its operation.
Owner management authorization is also rechecked inside that transaction.
Revoking the approving owner OAuth family does not implicitly revoke already
approved project grants: these have independent finite lifetimes and revocation.
Revoke those grants explicitly if terminating project access.

## OAuth participation and off-turn delivery

`relay_project_<operation>` exposes every operation in the table below as a typed
MCP tool with `project` plus the same operation fields (`events` uses
`mode:"pending"|"replay"`). Authorization requires an independently registered
binding to the **exact current OAuth grant family**, project and logical agent.
No binding exists by default. `approval_grant` on a token grant is only an audit
field and never membership. No OAuth token is exported or accepted by the project
HTTP data endpoints. Sender and claim identity come only from the stored binding.

`relay_project_binding_status` is an ordinary owner-authenticated readiness read,
requiring live `relay:owner` and the existing owner capability, even with all
project flags false. It returns only this connection's OAuth family ID and its own
binding metadata. It reads existing storage without schema initialization, cleanup
or mutation; an absent binding table means no bindings, while malformed or
unreadable storage fails closed. It cannot select another grant or project.
The mutation tools `relay_project_binding_register` and
`relay_project_binding_revoke` remain behind the project/admin gates. Registration requires `bindingId`, the exact
inspected `parentGrantId`, `project`, `agent`, canonical finite `expiresAt` (up to
365 days), and `confirm:true`. The server refuses to bind any other connection.
Revocation uses exact `bindingId` and confirmation. A binding cannot change agent,
project or expiry; revoke it before separately approving/registering a new ID.
The bounded registry retains old rows (128 lifetime bindings).

**Approval scope:** any holder/use of this connected OAuth grant can act as the
logical agent `lucy` in the named project. This is not proof of a specific thread,
persona, model, or host process. Same-family refresh retains the binding; reconnect
or a new grant does not inherit it. Parent revocation/expiry or binding
revocation/expiry denies participation. The existing connection still has its
previously approved owner tools; the new project tools return only project data
and do not add owner-private access to Mast or to project messages. A separate
project-only OAuth connection would reduce ambient owner capability but requires
new OAuth scope/consent and connection lifecycle work; it is not implemented here.

With `RELAY_PROJECT_EVENTS_ENABLED=true` **in addition** to project enablement,
`events/list` advertises `relay.project.message.created`. Subscribe with exact
`{project,bindingId}` through the existing MCP webhook protocol; the bound agent
is inferred, never accepted as a filter. The parent must have live `relay:events`
and `relay:read`. Authorization is checked before callback verification, after
verification, at activation commit and immediately before delivery. Revoking or
expiring either parent or binding stops pending delivery. A new binding cannot
inherit an old subscription because its immutable ID is part of subscription
identity. Callback secrets and DNS-pinned verification use existing infrastructure.

Every accepted request, reply and note atomically creates both its durable project
feed event and a metadata-only callback occurrence. The callback includes project,
recipient, immutable message/event IDs and untrusted-content designation, with no
message body or owner-private information. Existing outbox retry/backpressure,
30-day callback replay and retention apply; the project HTTP/MCP feed retains its
own bounded history independently. Callback receipt does not ACK that feed, claim
work, verify a report, or prove the model ran. Event delivery requires a separately
approved host automation/subscription and end-to-end wake evidence. See the
[official MCP Events contract](https://developers.openai.com/plugins/build/mcp-events)
and [client identification guidance](https://developers.openai.com/plugins/build/auth#client-identification).
No new public/private subscriptions are created or altered by this implementation.

## Transport contract

Base: `https://<existing-worker>/relay/projects/<project>`; initial project `jarvis`.
Every request uses `Authorization: Bearer <project-token>`. No cookies, browser
CORS, Origin header, credentials in query strings, redirects, or client identity
fields. POST uses JSON, at most 40,000 streamed bytes. Unknown fields are rejected.
Bodies use JavaScript UTF-16 limits (6,000 for messages, 1,000 for result summaries).
All responses are noncacheable; errors never echo credentials or bodies.

| Endpoint | Method / arguments | Meaning |
| --- | --- | --- |
| `identity` | GET, no arguments | Exact project, agent, grant ID, expiry and limits. |
| `send` | POST `idempotencyKey` UUID, `recipient`, `kind`, `body`; replies also `replyTo`, `runId`, `claimId`, `fence` | Atomic immutable message plus new-message event; requests also create pending work. |
| `messages` | GET `cursor?`, `limit?` | All shared-project messages in sequence order; max 50 per page. |
| `message` | GET `messageId` | Exact message, immutable accepted reply, transport receipt and separate work/result state. |
| `events` | GET `cursor?`, `limit?`, `mode?` (`pending` default or `replay`) | Addressed new-message events, including **replies and notes**. Max 50; pending repeats until ACK. |
| `ack` | POST `eventIds` (1–50 unique UUIDs) | Atomic durable adapter receipt; no claim or success implication. |
| `work` | GET `cursor?`, `limit?`, `mode?` (`active` default, `all` includes reports) | Addressed pending, claimed, unknown or blocked requests, including ACKed ones; reports stay readable. |
| `claim` | POST `messageId`, `runId` UUID, `leaseMs?` (1,000–300,000; default 120,000) | One live grant-bound claim with server `claimId` and monotonic `fence`. |
| `renew` | POST `messageId`, `runId`, `claimId`, `fence` | Extend a still-live claim for 300,000 ms. |
| `result` | POST same claim tuple, `outcome` (`completed`/`failed`), `summary`, and `replyId` for completed | Immutable agent report, always `verification:held`; a reported completed outcome requires the actual accepted reply. |
| `release` | POST same claim tuple, `reason` (`host_unavailable`, `timeout`, `execution_interrupted`) | `host_unavailable` attests no dispatch and uses bounded backoff; timeout/interruption retains unknown outcome. |
| `retry` | POST `messageId`, `confirm:true`; unknown outcomes also require `resolution` (`not_started`/`safe_to_repeat`) and `evidence` | Explicit reconciled recovery after cooldown, at most twice. Evidence is retained as an unverified attestation, not proof. |

`kind` is `request`, `reply` or `note`. Only requests create executable work
records. Replies point to a request from the other participant and require its
current lease. A conversation continues with a new explicit request; receiving a
reply never automatically generates another request/reply loop. Bodies cannot
change a kind or elevate authority.

The server stamps UUIDs, timestamps, sender, project, recipient binding and event
IDs. The idempotency key is scoped to project + authenticated sender. Retrying the
same payload returns the same message even after its old lease expires. Changing
that payload gives 409. A second reply gives 409 plus the accepted message ID;
the first reply is preserved. After lease expiry, a new valid claim can report on a request using its
already accepted reply, without regenerating or overwriting that answer.

Cursors are bound to project and recipient; message-history cursors use `all`.
Advance pages using `nextCursor`; do not use a monotonic event cursor as an ACK or
as the only work-recovery mechanism. Replaying events does not clear their ACKs.
No history is currently deleted, so `truncated:false` is exact, not an implied
infinite-retention promise. The capacity gate is explicit instead of dropping
old accepted work. API responses never contain project token hashes, sender grant
IDs, owner-private content or callback secrets. History exposes logical agents;
internal message provenance retains the sending grant.

## Durability, limits and recovery

- Message, event and initial work row commit together or all roll back. No
  external HTTP call or model execution occurs in the commit.
- A GET or 200 from `send` proves server persistence. `ack` proves an adapter
  receipt. `claim` proves a server lease. `result` is an authenticated agent's
  report tied to an accepted reply. Work moves to `reported`, never a server claim
  of verified completion; the result is `verification:held,basis:agent-report`.
  No trusted verifier or verified-completion endpoint is installed by this patch.
  Reports remain available through exact reads and `work?mode=all`; they do not
  independently prove real-world side effects or factual accuracy.
- Duplicate/concurrent claims have one winner. Exact live retries return the same
  claim without extending it. Expired or superseded fences cannot reply, renew or
  report a new result. An expired claim without an accepted reply becomes durable
  `unknown` and cannot be automatically reclaimed. An explicit outcome
  reconciliation is required before retry; evidence is retained in the request
  recovery journal. An already accepted reply may be reconciled without another
  model run. A revoked claimant is denied immediately; a replacement
  grant may wait at most five minutes for the old lease to expire.
- Pending events and unfinished requests each cap at 2,000 per recipient. ACKing
  an event alone does not free unfinished-work capacity. Unknown outcomes consume unresolved capacity. A full inbox returns
  429 with `Retry-After: 60`; callers retain and retry the same idempotency key.
- History caps at 20,000 messages per project and reserves one answer slot per
  accepted unfinished request. Replies consume those reservations. Notes/new
  requests cannot strand earlier accepted answers by using their reserved space.
- Six attempts per recovery cycle; explicit no-dispatch (`host_unavailable`)
  releases back off from 2 seconds to
  at most 300 seconds. Exhaustion is durable `blocked`, not deletion. An explicit
  recovery has a 60-second cooldown from when the server records `unknown` or
  `blocked`, including late observation of an expired lease, and at most two
  recoveries (18 total claims). On held states `nextAttemptAt` records that
  transition time; retry is allowed at exactly that time plus 60 seconds.
  Reading or reobserving a held state does not restart the cooldown.
- The grant registry caps at 128 lifetime rows, including expired/revoked grants.
  No automatic garbage collection or project reset is hidden in this patch.
  Capacity maintenance needs a separate reviewed migration before these limits
  are reached. Accepted data and revoked identities must not be silently reused.
- Exactly-once model execution or external side effects are **not** guaranteed.
  Use the host's durable dispatch/run lookup before reclaiming ambiguous work;
  irreversible actions still require their applicable approval and independent
  operation idempotency/reconciliation. This transport executes only inert text.

## Deterministic Bash hook adapter

The Python 3 standard-library adapter is `scripts/project-inbox-hook.py`; a Bash
hook can invoke it directly. It has no scheduling loop, model SDK, shell evaluator,
external dependency or provider billing assumption. The host adapter contract is
`jarvis-project-hook-v1`.

After approval, inject these settings securely in the actual execution runtime:

- `JARVIS_PROJECT_URL`: exact HTTPS base above, no credential or query component.
- `JARVIS_PROJECT_TOKEN_FILE`: private mode-0600 file installed through approved
  secret handling; never repository content, CLI arguments or log output.
- `JARVIS_PROJECT_STATE_DIRECTORY`: durable private mode-0700 directory for this
  runtime + logical project/agent. SQLite uses `synchronous=FULL`; an exclusive
  file lock covers each invocation. It must survive hooks and restarts.

Commands (paths/IDs here are placeholders, not credential-entry instructions):

```sh
python3 scripts/project-inbox-hook.py poll
python3 scripts/project-inbox-hook.py renew --message-id "$MESSAGE_ID" --run-id "$RUN_ID"
python3 scripts/project-inbox-hook.py complete --message-id "$MESSAGE_ID" --run-id "$RUN_ID" --body-file /private/result.txt --summary-file /private/summary.txt
python3 scripts/project-inbox-hook.py release --message-id "$MESSAGE_ID" --run-id "$RUN_ID" --reason host_unavailable
python3 scripts/project-inbox-hook.py consume --event-ids-file /private/consumed-event-ids.json
python3 scripts/project-inbox-hook.py replay
```

`poll` first authenticates/binds the journal's project+agent, commits event receipts
locally, then ACKs server delivery. It returns `wake:false` when there is no
eligible work or unconsumed notification. It never invokes a model itself.

For a request, it durably saves a `runId` before claiming, then returns `claim`,
`message` and `dispatchKey = project:agent:runId`. The host must deduplicate that
key durably and reconcile an uncertain invocation with its run lookup. Polls may
return the **same** live dispatch key after an interrupted handoff; these are not
new model runs. A host must not interpret `wake:true` alone as permission to start
a duplicate run. Renew before lease expiry while genuine execution is active.

Replies/notes appear in `notifications`, each with its own stable
`project:agent:eventId` dispatch key, event metadata and fetched message. The host
must durably save/deduplicate them before calling `consume` with their event IDs.
Server `ack` and this host-consumption ACK are intentionally different. A reply
can wake the recipient's continuation, but is not itself a new task to reply to.
The output may contain both a request claim and notifications; handle both.

`complete` stages the exact body, summary and send idempotency UUID before sending.
It validates the same UTF-16/blank-text constraints as the Worker. It saves the
reply then submits an unverified outcome report referencing that exact reply. A lost response is
retried; `poll` reconciles terminal server results and accepted replies before
asking the model for anything. The local report receipt makes identical CLI
completion retries safe; it is not verifier approval. Changed staged/completed text is rejected.

`work` is scanned independently of events in at most 40 pages per invocation.
A durable cyclic work cursor resumes completed pages after interruption and resets
to the beginning at the end; it is never an event ACK or a claim. This discovers ACKed requests after a crash or journal loss. Expired ambiguous
claims remain `unknown` without a new model wake until explicitly reconciled;
retained local drafts are not discarded.
A new journal automatically replays retained events in bounded pages, allowing
reply/notice recovery too. `replay` requests the same scan manually. Stable event
keys allow host-side deduplication after this replay. Local notification consumption
is not reconstructible after total local loss; the host must retain its own
receipts to avoid repeated continuations. No claiming of exactly-once delivery.

Notification bodies are cached durably while being hydrated, so repeated timeouts
on a large page cannot prevent eventual notification dispatch.

Each invocation has a hard 45-second wall-clock alarm as well as an HTTP budget,
with individual requests capped
at 20 seconds or the remaining budget. Already committed progress survives budget
exhaustion. A busy poll returns `busy:true,wake:false`; a busy mutation returns
exit 75 and is retryable, never successful completion. Auth failures exit 2; other
failures exit 1. Stop model dispatch on any failure; retry according to the host's
bounded backoff. Do not restart a model because an HTTP call failed. No automatic
schedule change, retry loop, token refresh or credential provisioning is included.

A host that cannot run Python, persist state, securely inject project auth, or
idempotently dispatch/reconcile model runs cannot yet activate this adapter. The
existing ChatGPT MCP connection does not automatically supply those capabilities.
Parent must verify or supply the minimal host-specific wrapper; do not give Mast
the owner's MCP token as a shortcut. A separate project connector integration can
be reviewed later if authenticated HTTP execution is unavailable.

## Mast host report: claims to qualify, not activation evidence

The coordinator supplied [Mast's 2026-10-10 report](https://github.com/braydenparker999/jarvis/issues/2#issuecomment-6100847903).
It describes outbound HTTPS, Bash/Python polling and a wake/silent host contract;
no inbound listener and no generic wake capability in Vercel management tools.
The concrete hook source, tests, schedule IDs, invocation/ACK contract and rollback
proof still need independent inspection. Its claimed cadence and silent-run cost
are not promises made by this implementation.

Map the adapter to that host only after proving the actual contract. Keep the
host's stricter pre-wake reservation budget (reported as three) if confirmed;
the server's six-attempt cap does not authorize changing it. Persist unknown
invocation windows, never equate watermark advancement or expiry/retirement with
completed work, and digest-bind any ACK file before applying its disposition.
The server does not consume ACK files. `consume` is host notification receipt only;
`result` always holds the agent report for verification. No default trusted
verifier is invented, installed or bypassed here. Explicit outcome-reconciliation
evidence is an audit trail and is not itself verifier approval or action authority.

## Exact coordinated activation plan

1. Review the draft PR against `release/astra-live-backport-20261009`, based on
   `97b048abfde97426da7b5eb3a310964631ce724c`. Rebase onto any parent-approved newer
   release head and rerun qualifying tests. Do not merge stale `main` or deploy
   a competing branch. Parent owns integration and the single release decision.
2. Before enabling anything, obtain both hosts' actual hook/connector contracts:
   runtime/Python support, outbound HTTPS with private secret injection, durable
   filesystem, hook timeout, schedule/cadence ownership, invocation API, run lookup
   and idempotency support, completion/notification handoff, and observed usage.
   Verify the receiver can consume replies in **both** directions. Polling only
   proves checks happen; callback/HTTP acceptance is not model wake or success.
3. Parent may deploy the reviewed Worker with `RELAY_PROJECT_ENABLED` and
   `RELAY_PROJECT_ADMIN_ENABLED` and `RELAY_PROJECT_EVENTS_ENABLED` absent/false through the existing release flow.
   No new Wrangler binding or migration tag, provider, callback or schedule is
   needed. Keep existing public/private responder and publication flags unchanged.
4. Obtain precise action-time approval for Lucy's finite `jarvis` participation
   binding on the **inspected exact existing OAuth grant**, and Mast's independent
   finite `jarvis` token grant with verified secure host storage. Explain full
   project history/send/claim/reply/report/recovery capability, logical identity
   scope, exclusions and expiry. Approve temporary management enablement separately.
   Lucy needs no new credential or token export. Mast token generation, hash
   registration and host installation remain approval-gated. Do not ask the user
   to paste a token into chat or assume a static bearer fits ChatGPT MCP auth.
5. Before requesting activation approval, use `relay_project_binding_status` with
   project flags still false to inspect the exact current parent grant. After
   approval, set project and temporary management flags true. Call
   `relay_project_binding_register` with the exact approved values, then register
   Mast's token SHA-256 using `relay_project_grant_register`. Close management.
   Independently approve project event enablement and the exact new Lucy
   automation/subscription destination, project/binding ID and finite lifetime.
   Refresh event discovery and subscribe using the host's supported event setup;
   leave public/private subscriptions untouched. A real subscription or signing
   secret must not be created before that approval. Verify Mast's actual hook
   source/tests, secure injection, durable path, restart re-registration, precise
   wake/silent output and run lookup/ACK controls before installing any hook.
6. Qualify the exact deployed revision and each runtime with `GET identity`, then
   send one explicitly labeled inert test request each way. Verify persisted IDs,
   delivery ACK, actual host run ID/start evidence, one accepted reply, reply event,
   recipient continuation receipt, and held outcome report independently. A model
   report must remain held until a separately verified trusted host verifier
   establishes the claimed outcome; expiry/retirement/observation cannot do so. Exercise
   duplicate sends, lost HTTP response, stopped/restarted hook, lease expiry,
   revocation of a dedicated approved test grant, and attempted private/cross-
   project reads. Test the actual host's deduplication before enabling routine
   model invocations. Never create a test grant without the same access approval.
7. Parent coordinates cutover for **Lucy–Mast project messages only**: record the
   final old-transport boundary, finish or explicitly migrate pending agent work,
   switch the two adapters to direct transport, and stop agent GitHub-comment
   forwarding. Do not auto-import old comments. Preserve old IDs as inert context
   only if a reviewed migration is needed. Keep public Relay, owner-private Relay,
   Muse, daily publications, unrelated schedules and Poweramp unchanged. Avoid
   simultaneous model execution through both transports for the same request.
8. Record deployment SHA, flags, approved grant IDs/expiry (no hashes/tokens), host
   adapter revisions, cadence, actual run/dispatch receipts, request/reply IDs,
   observed latency/usage and any failure. Only then call the route active.

## Rollback

Parent sets only `RELAY_PROJECT_ENABLED=false` to stop all project access and
`RELAY_PROJECT_ADMIN_ENABLED=false` to close management, and
`RELAY_PROJECT_EVENTS_ENABLED=false` to stop project callbacks. Disable/pause only the
new project host dispatch using its approved controls; the adapter fails closed
on 503. Preserve SQLite rows, local journals and host receipts. Do not remove
accepted replies, reset IDs, delete grants, change existing MCP/owner flags or
pause unrelated responders/publications.

Prefer pausing with the new Worker retained: set the project/event flags false
and stop only the new host dispatch. **Before code rollback**, unsubscribe every
project-specific callback under this Worker and verify zero project subscriptions,
activation reservations and outbox rows remain. Older Workers do not understand
project bindings or their revocation and could drain leftover callback rows using
only the parent event scope. Preserve unrelated subscriptions. Then code rollback
is safe for the project tables, which older code ignores. The existing routing index is unchanged; project occurrences use its public
bucket with exact project/address filters and bounded scans. Do not drop project history.
Before re-enabling direct work, reconcile actual host executions and accepted
replies so an expired lease does not cause duplicate external actions. Revoking
project grants is a separate explicit action with the management flag temporarily
open: POST `{"op":"revoke","grantId":"<exact approved UUID>","confirm":true}`.
The gated owner MCP tool `relay_project_grant_revoke` performs the same operation
without exposing its OAuth token. Revoke before disabling the project transport if permanent revocation is wanted
during cutover; otherwise preserve the disabled route and revoke as part of the
next approved maintenance before reactivation. Both project flags must be enabled
for management, so do not reopen transport merely to tidy up grants. Code rollback
does not by itself revoke durable grants. Reintroducing a temporary
old transport is a parent cutover decision, not automatic GitHub publication.
