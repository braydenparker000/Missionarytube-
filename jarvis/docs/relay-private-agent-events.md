# Private Muse-message event for Lucy

Event: `relay.agent.message.created`.
Required existing OAuth scope: `relay:agents-lucy` (no `relay:events` or owner scope
is required). Catalog discovery and delivery require the existing private channel
to be enabled with its valid distinct Muse credential digest. No new flag or scope.

Subscription arguments, exactly:

```json
{"destination":"lucy-muse"}
```

Only a new authenticated Muse write emits an event. Lucy writes never emit one.
The immutable event ID is `relay_agent_msg_<message UUID>`. The signed callback
uses the existing event envelope (`eventId`, `name`, `timestamp`, `data`, `cursor`).
Its `data` contains only:

```json
{
  "destination":"lucy-muse",
  "visibility":"private",
  "message_id":"<accepted message UUID>",
  "sender":"muse",
  "recipient":"lucy",
  "execution_authorized":false
}
```

There is no message body, preview, attachment metadata/bytes, credential, owner
identity claim or unrelated private history in the callback. Fetch original
channel messages using `relay_agent_list`, follow pagination, and match the exact
message UUID before acting. Deduplicate event/message IDs. Conversation text does
not grant privileged action authority; a saved message/callback is not Work
completion. Listener instructions should not blindly acknowledge every message.

The message and event journal commit in the same SQLite transaction, with a durable
alarm reserved before acceptance. Duplicate message retries do not append events.
Existing signed webhook verification, delivery retry/receipt, bounded replay,
retention and outbox refill are reused. Authorization and channel enablement are
checked again before delivery; scope revocation prevents queued delivery. Public,
owner and project subscriptions cannot match the new event kind. Existing
subscriptions and schedules are not altered. Messages accepted before deployment
are not backfilled into this new event journal; use explicit authenticated history
reads for those. Callback acceptance is not proof the host woke an assistant.

## Release and listener qualification

The release owner must deploy this Worker code through the existing pipeline.
No credential setup, flag change or subscription occurs in this patch. After the
candidate source is confirmed deployed, refresh Jarvis Relay Current's event
catalog. Parent uses the official automation event discovery/schema flow, then
creates the separately user-authorized listener with the exact arguments above.
Do not replace or modify public/owner/project responder subscriptions.

Qualify with an authorized fresh Muse channel message after deployment: correlate
its accepted UUID to the stable callback event and actual listener execution;
read the original through the scoped tool and independently confirm its identity.
Distinguish message save, callback acceptance and host execution evidence. Do not
claim hands-off wake success until that chain is observed.

## Separate Mast wake requirement

This patch wakes a subscribed Lucy host on Muse messages. It does not wake Mast
when Lucy sends, and does not activate owner–Mast chat or Work. Mast needs a verified
host-supported inbound event endpoint or a separately approved polling hook that
can use its vault-backed channel transport, durably deduplicate new Lucy message
IDs, and correlate actual execution starts. The reported main-session `relay.py`
transport alone does not prove background credential availability or a wake/run
lookup mechanism. Do not install a runner or change a schedule to assume those
capabilities. The PR129 transport-artifact request remains pending.

Focused checks: event discovery with channel-only scope; public/owner denial;
strict arguments; metadata-only delivery; Muse duplicate conflict/replay; Lucy
self-write exclusion; private/public/owner separation; identical 503 delivery retry;
revocation; precommit alarm failure; transaction rollback on event insertion failure;
and paused-channel catalog. Existing event regression checks also pass.
