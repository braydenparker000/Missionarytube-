# Durable private owner jobs

Each private owner request has a durable job in the existing SQLite Durable
Object. The job ID and request ID are the same UUID. The request remains an
ordinary private owner message, delivered by the existing owner event path.
Existing event responders and hourly fallback tasks are unchanged.

A normal authenticated `relay_owner_reply` saves an immutable plain-text reply
and its available result in the same synchronous transaction. It does **not**
complete the requested work, report a known action outcome or infer a blocker
from the reply's wording. An acknowledgement, a blocker and a useful report all
establish reply availability only. Identical retries preserve the original reply,
save time and lifecycle event; conflicting replies return 409. An explicitly
failed or cancelled job retains that state when an explanatory reply is saved.

Work completion requires a separate typed `relay_owner_job_update` operation
from the actual authenticated execution that claimed the job. It binds a known
outcome and checking summary to the exact accepted reply and current result
version. Authentication establishes the submission and execution association;
it does not independently certify factual correctness or external side effects.
The chat reply stays immutable. No body marker, read operation, callback receipt
or natural-language inference can claim or complete work.

These records track the evidence Relay receives. They do not start an executor,
create new schedules, forward private text to Muse or public services, or establish
the identity of a particular assistant persona. Publishing new MCP tool schemas
does not prove that a connected host has discovered or can call those tools.

## Browser API

The existing authenticated phone bearer and exact allowed Origin protect writes.
OAuth tokens cannot be used as phone sessions. Successful `/session`, approved
`/pair/status`, and successful `/login` responses advertise `jobs_enabled: true`.
An older service without that field can continue ordinary private chat without
speculative job API calls. All job responses use `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`.

| Method and route under `/relay/owner` | Input | Response |
| --- | --- | --- |
| POST `/jobs` | `id`, `title`, `body`, `action_kind` | `job`, ordinary `entry`, `newWrite` |
| GET `/jobs` | Optional `after` creation-sequence cursor and `limit` | `jobs`, `nextCursor` |
| GET `/jobs/detail` | Exact `job_id` | `job`, chronological `events` |
| POST `/jobs/cancel` | Exact `job_id` | `job`, `newWrite` |
| POST `/jobs/retry` | Parent `job_id`, separate attempt `id`, optional `confirm_duplicate_risk: true` | New attempt `job`, ordinary `entry`, `newWrite` |

The title is 1–120 characters, body is 1–4,000 characters, and action kind is
`unclassified`, `read_only`, `draft`, or `consequential`. The classification is
owner-supplied data; it grants no permission and does not waive action-specific
confirmation. Extra identity, stage, artifact, result or credential fields are
rejected. Duplicate query parameters and token-bearing queries are rejected.

The browser generates the UUID before its first send and retains that exact
request ID and payload for an ambiguous-response retry. Reusing an ID with a
different body, explicit title, classification or submitting device fails with
409. A successful identical retry does not create another request or event.
Creating a job, normal request, existing private event and daily rate accounting
is atomic; an event failure rolls all of them back. The existing Durable Object
wake is persisted before creation and separate retry insertion.

Every newly saved ordinary private message also gets a job with title **Owner
request** and kind `unclassified`. Its body is never parsed to infer intent,
authorization, command markers, stage or safety. Historical private messages
materialize only when selected in a job page or exact job read. Their existing
immutable private replies project available results using the actual saved reply
time. Without explicit typed completion evidence they report `outcome_unknown`
and `completion_unverified`, with `finishedAt: null`. Old stored `completed` rows
created solely by accepted replies are projected the same way without rewriting
their stored rows, journals, replies or correction history. This projection does
not replay events or claim execution. Replies accepted by a restored older Worker
retain their original identity and text.

Reads of existing metadata also leave missing reply linkage untouched. They use
the actual saved private reply for the returned projection. Only an explicit
reply, correction or completion write may reconcile that linkage transactionally.
The earlier lazy-materialization behavior remains limited to selected requests
with entirely absent job metadata: it creates queued metadata and a `result_saved`
event, never an execution claim or completion event.

The job sequence is its immutable user-message sequence. Pages preserve strict
creation order, with a default limit of 20 and maximum of 50. Status changes do
not advance this cursor. Refresh active jobs by exact ID or read all pages again
to observe completion, cancellation acknowledgement or failure.

## Stages and execution evidence

| Stage | Server evidence |
| --- | --- |
| `queued` | The private request is saved; no authenticated execution claim exists. |
| `running` | The owner-connected assistant explicitly claimed it, and its five-minute grant/run lease is current. |
| `outcome_unknown` | An execution lease expired, or a reply is available without typed work-completion evidence. The reason distinguishes these cases; neither asserts that execution stopped or failed. |
| `waiting_for_owner` | The matching execution recorded a blocker and explicit outcome. |
| `completed` | The matching authenticated claimed execution explicitly reported a known completed outcome associated with the accepted reply and result version. |
| `failed` | The matching current execution recorded an explicit failure summary and outcome. |
| `cancelled` | An authenticated execution acknowledged the owner's cancellation request with a known or not-started outcome. |

Callback acceptance remains in the separate existing `delivery` diagnostics. A
2xx callback never claims, renews, runs or completes a job. `running` means an
execution acknowledgement within the current lease; it is not continuous CPU,
model or external-service monitoring. The `execution` object contains only a
noncredential `runId`, last `acknowledgedAt`, and `leaseExpiresAt`. The OAuth
grant binding stays server-side. A run UUID alone cannot claim or change a job.

The optional MCP tools `relay_owner_jobs_list`, `relay_owner_job_read`,
`relay_owner_job_claim`, `relay_owner_job_update`, and
`relay_owner_job_result_correct` use only the existing live
`relay:owner` scope. They revalidate both OAuth token and grant inside the same
synchronous transaction as the operation. Public read/reply/event scopes, a
claimed principal, device bearers, or public Muse-prefixed messages provide no
job authority.

Claim accepts `inbox_id`, `job_id`, `run_id`, and `event_id`. The queued job can
have one claim; competing executions fail. Progress accepts `inbox_id`, `job_id`,
`event_id`, optional matching `run_id`, and `stage`. Running progress renews the
lease. Waiting or failed progress additionally requires a plain-text `summary`
and explicit `outcome` (`not_started`, `known`, or `unknown`). A globally unique
event UUID is bound to the exact normalized event payload and OAuth grant.
Identical event retries succeed without renewing leases or duplicating events;
different payloads, targets or grants fail with 409. Progress is bounded to 100
events per job, with cancellation acknowledgement, reply saving and explicit
completion still allowed.

Typed completion uses the existing `relay_owner_job_update` tool with
`stage: "completed"`, the matching `run_id`, a unique `event_id` distinct from the accepted reply ID,
`expected_reply_id`, `expected_version` (1–5), a nonempty plain-text `summary`
and `outcome: "known"`. The saved reply must exist and its current version must
match atomically. A different grant, run, reply, version or reused event payload
fails closed. An expired matching claim may settle a known completed outcome;
this does not renew, resume or reclaim its execution. An identical lost-response
retry preserves the original completion event and time.

The append-only `work_completed` event is the completion evidence. `completion`
is null without it; otherwise it contains its event/run IDs, accepted reply ID,
bound result version, summary, save time and authenticated private provenance.
Later information corrections retain that original completion association; they
do not certify the factual accuracy of the original or corrected text. Historic
reply-only `completed` events are not typed work-completion evidence.

Expired claims cannot be silently reclaimed. An active lease also prevents a
different grant from writing a competing normal final reply. The first accepted
immutable reply remains authoritative. A waiting job has no automatic resumption
or approval protocol in this slice: the owner can send a separate private message
with a decision. A reply saves information; a matching typed completion operation
can report the known finished outcome. Message or reply text is never interpreted
as machine-readable permission. Once an immutable reply is available, a new claim
or heartbeat cannot silently restart that request.

For a cached host, the existing `relay_owner_read_conversation` retains its exact
structured result and original serialized content. A fourth separately labeled
**Private job lifecycle** text block supplies redacted server lifecycle evidence.
The earlier private delivery and subscription diagnostic blocks remain intact.
For the original result it contains no private reply body. It reports the explicit
`completion` association and `resultVersion`
and, only after a correction, the explicitly labeled `latestResult` plain-text
body, checking rationale and authenticated provenance. The original structured
conversation and serialized first content block retain the immutable first
reply. This owner-authorized supplemental read contains no device credential,
OAuth grant, hidden command, synthetic conversation entry or execution
instruction, and its label disclaims factual certification.

Authentication provenance is preserved exactly. A paired-device request reports
`owner-device-session`, a password-session request reports
`owner-password-session`, and an accepted assistant reply reports
`owner-oauth-mcp`. The current source catalog declares all three entry values.
The connected host catalog observed during the 2026-10-08 review still declares
only the paired-device and OAuth values for its cached pending/conversation
schemas. An empty pending result proves the old tool can be invoked, but does
not prove that this host accepts a returned password-session entry. Fixture
tests cover the unchanged stored provenance through the existing pending, read
and final-reply paths; live phone-request acceptance through that cached host
remains unproven until a password-origin request is successfully returned. Do
not relabel password provenance to satisfy a stale schema. Resolving the cached
host schema requires a supported catalog refresh or compatibility fix and adds
no authority, credential or scope. The fourth lifecycle block remains
supplemental data, never an alternative write or authorization channel.

## Cancellation and separate attempts

Browser cancellation records `cancelRequested` and a durable cancellation-request
event. It leaves the execution stage unchanged. Claiming and further running
progress are blocked. A request is never displayed as cancelled merely because
the owner clicked Cancel or a callback was accepted.

Only authenticated `relay_owner_job_update` with `stage: "cancelled"`, an explicit
summary, and `outcome: "not_started"` or `"known"` can acknowledge cancellation.
A claimed job requires the owning OAuth grant and matching run ID, even after
lease expiry; another host cannot assert the original execution stopped. A
never-claimed job can be acknowledged by current owner OAuth only after verifying
that the request will not execute. An unknown outcome cannot claim cancellation.
The cancellation request remains historical evidence after acknowledgement.
A typed completion from the owning execution may instead report known completed
work while preserving the cancellation-request fact. Saving reply text cannot do
so, and neither operation fabricates a cancellation acknowledgement.

Retry creates a new private request with a distinct immutable UUID, linked parent
and root job IDs and incremented attempt number. The original request, final
state and result stay intact. Each parent has at most one child; a logical lineage
has at most five attempts. Identical retry sends return the same child, while
different child IDs or submitting devices fail with 409.

Explicitly completed, queued, running and waiting requests cannot be retried. A
still-live execution claim also prevents retry when its saved reply projects an
unverified outcome. Failed,
cancelled, or outcome-unknown requests may be eligible, with these further guards:

- Consequential or unclassified requests are unavailable for retry when their
  outcome is unknown or possibly performed (`known`), even with a duplicate-risk
  checkbox. The authenticated terminal execution must specifically attest
  `not_started` before another attempt becomes eligible.
- Read-only or draft requests with an unknown outcome require the owner's explicit
  `confirm_duplicate_risk: true` before a separate attempt is created.
- Eligible consequential or unclassified requests still require that explicit
  confirmation. The field acknowledges duplicate-request risk; it is not an
  approval for external actions or data sharing.

Relay cannot guarantee exactly-once external side effects. An execution must
still use the destination's actual idempotency mechanism or reconcile the action
before claiming it did not start. Stable root job IDs are correlation IDs, not
proof that an external API deduplicates requests. This slice does not introduce
automatic retries of consequential actions or an external action executor.

## Private results and verification

Available replies expose `format: "plain_text"`, body, immutable reply ID and saved
time. HTML-looking input is data. Render titles, progress, request and result
bodies with text nodes, and allow only independently checked safe links. The API
accepts no interactive HTML, iframe, credential-bearing artifact URL, browser
execution command or token property. Private content remains in owner tables;
public inbox routes, publications and Muse integrations never read these jobs.

## Append-only private result corrections

The original private chat reply and `job.result` remain immutable. A saved reply
with unverified completion, or an explicitly completed job, can accept up to four
separate authenticated plain-text corrections. Failed and cancelled work remains
excluded. Its original result is version 1; corrections are versions 2–5.
This mechanism corrects saved information only. It cannot execute an action,
change the execution stage, finish a queued job, resume failed or cancelled work,
or alter cancellation or retry authority.

The optional `relay_owner_job_result_correct` MCP tool requires the existing
live owner scope and these exact fields:

| Field | Meaning |
| --- | --- |
| `inbox_id` | Exactly `brayden-owner`. |
| `job_id` | Exact private request/job UUID. |
| `event_id` | Fresh correction UUID, different from the original reply UUID. |
| `expected_reply_id` | The original accepted private reply UUID. |
| `expected_version` | Current result version, from 1 through 4. |
| `body` | Full corrected result, 1–6,000 characters of plain text. |
| `correction_summary` | Checking rationale, 1–1,000 characters of plain text. |

Read the request, original reply and current history before submitting a
correction. The expected original reply and version are checked atomically.
Competing corrections based on the same version accept only one; the other
returns 409. The event UUID binds the exact normalized payload, target and
submitting OAuth grant. An identical lost-response retry returns the same
`acceptedResult` without inserting a revision or advancing its timestamp. A
retry of an older accepted event still returns that exact revision, alongside
the job's current latest revision. Conflicting event reuse returns 409. A fifth
correction is refused by the bounded revision limit.

`job.resultVersion` is 0 before any accepted reply and otherwise 1–5.
`job.latestResult` is null before a reply and otherwise contains:

| Field | Meaning |
| --- | --- |
| `id` | Original reply UUID for version 1; correction event UUID for later versions. |
| `version` | Contiguous result version from 1 through 5. |
| `format`, `body` | `plain_text` and the accepted full text. |
| `replyId` | Original immutable private reply association for every version. |
| `createdAt` | Original reply save time or correction save time. |
| `correctionSummary` | Null for version 1; later correction's checking rationale. |
| `authentication_source` | `owner-oauth-mcp`. |
| `author_authenticated`, `visibility` | `true` and `private`. |

Exact job detail also returns `resultHistory` in contiguous version order, with
at most five records; its last item equals `latestResult`. Appending a correction
advances `updatedAt` monotonically to its save time. The original `result`, chat
reply, `finishedAt`, stage and accepted earlier revisions stay intact. Job list
and exact detail reads expose the latest information without appending another
conversation entry. Refresh job pages or exact detail to see corrections to
already answered jobs; the immutable message cursor does not advance for them.

Display a later version as **Authenticated correction**, with its rationale and
save time, while preserving access to the original reply and earlier versions.
Neither the first accepted result nor a correction has a server-certified
factual-verification badge. The rationale is the authenticated author's checking
account, not independent proof. HTML, PHP, iframe or command-looking text remains
plain data and must be rendered as text. No browser correction-write route,
credential, scope or external forwarding mechanism is added.

## First-version public Muse limitation

Public Muse publications still use the existing immutable, append-only public
reply importer. If an initial receipt or preliminary answer was accepted for a
`replyTo`, a later corrected publication for that same target cannot replace it.
The first reply remains and the conflicting publication is reported in importer
diagnostics. A Muse name, public body, claimed verification, callback receipt or
GitHub publication does not authenticate a private job executor or control its
progress, completion, cancellation or corrections. Nothing automatically copies
the public result into a private job, including when both lanes share a UUID.

The private correction tool is supported only when the connected host actually
discovers and can call it. A cached catalog with only the original read/reply
tools cannot write a correction; publishing its schema is not live callability
evidence. Its existing authenticated conversation read can still see an already
saved correction in the separately labeled lifecycle block without changing the
original immutable reply or requiring a new catalog.
Where unavailable, the owner can explicitly submit a separate private follow-up
request that names the prior request/reply and asks for review or correction.
That new request receives its own UUID and immutable final reply, preserving the
earlier conversation. This is an information follow-up, not a retry permission
or automatic repetition of an external action. Public Muse corrections likewise
need a separate supported follow-up/public request; this version adds no public
revision or multi-reply protocol. Privacy and action-specific approvals continue
to apply to the content of any follow-up.

## Qualification

Run the focused lifecycle, adversarial, compatibility, owner and OAuth checks
with the repository's pinned Node 22.23.3 and additional Node 24.21.0 owner
security coverage. Browser and complete release qualification remain mandatory
under [the release recipe](release-qualification.md). Fixture completion evidence
does not claim a live host run; release reporting must separately record the
actual accepted private request, available callable tools and immutable result.
