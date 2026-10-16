# Dormant Makima compatibility adapter

Prepared from `release/astra-live-backport-20261009` at `fed2369` (includes UI PR145).
This is a separate branch for a draft PR. No merge, deployment, live OAuth app or
client registration, secret configuration, grant, webhook, or external agent
message was performed. Production configuration and all UI files are unchanged.

## Boundary and implementation

| Item | Makima boundary |
| --- | --- |
| MCP endpoint / audience | `<issuer>/relay/makima/mcp` |
| Authorization server | `<issuer>/relay/makima` |
| Protected resource metadata | `<issuer>/.well-known/oauth-protected-resource/relay/makima/mcp` |
| Authorization metadata | `<issuer>/.well-known/oauth-authorization-server/relay/makima` |
| Identity / scope | `agent:makima` / `relay:makima` only |
| Registry and text store | Separate existing `HUBS` object named `jarvis-makima-v1` |
| Tools | `makima_channel_list`, `makima_channel_send` only |
| Owner ingress | Authenticated `GET`/`POST /relay/owner/makima` |
| Default | Closed unless the explicit flag and complete distinct configuration exist |

The small transport adapter reuses the existing OAuth broker through a
server-owned policy. Default callers retain the ChatGPT policy, callback,
principal, registry, scopes, cookies, consent wording and MCP 2026 behavior.
Makima does not route through `relayRpc`, the Lucy–Muse REST adapter, project
membership, public inbox tools, or private owner inbox tools. Its OAuth state is
in a separate Durable Object; even matching opaque identifiers in another object
cannot authenticate here. No new binding or migration is required.

Makima's public client ID has one exact callback:
`https://www.cursor.com/agents/mcp/oauth/callback`. DCR is not advertised and
every registration request is rejected, including the mixed HTTPS/localhost/
custom-scheme array. Redirect URIs are compared as exact strings. There are no
wildcards, normalization exceptions, localhost allowances or ignored callbacks.
This adapter supports the HTTPS route only; personal/desktop Bot behavior is
still an owner-side compatibility question.

Owner sign-in still verifies GitHub user ID 183016859, but uses a separate GitHub
OAuth app ID and secret. Configuration that repeats the existing app ID or
secret fails closed. No upstream token is persisted or forwarded. Makima tokens
are issued only after explicit consent, with S256 PKCE, state, isolated
`__Host-jarvis-makima` cookie, CSRF, exact audience and callback binding, and
rotating refresh tokens. Access tokens last at most one hour; consent defaults
to 30 days and can explicitly select 365 days. Refresh cannot add scopes. Changing
the public client ID, revoking its family, or disabling the adapter blocks old
credentials. Makima's client ID is public metadata, never a bearer secret.

The owner route verifies the existing private device session before crossing
the object boundary and again before releasing the result. It forwards only
explicit text/message IDs and stamps `owner`; it never forwards a device bearer,
token hash, owner history, files or private teammate data. Makima sends are
server-stamped `makima`; extra sender/channel/attachment fields are rejected.
This adds no owner UI and gives Lucy and Muse no automatic access to this lane.
An owner handoff is an explicit share into the Makima channel, not proof the Bot
has received or acted on it.

Each send supplies a UUID, exact body (up to 6000 characters) and optional
`reply_to` referencing this channel only. Identical retries return the original
entry with `newWrite:false`; changed text, target or sender yields a conflict.
Concurrent retries commit one row through SQLite transactions. Reads page at 50
entries using a numeric cursor. The channel stops accepting new messages at 10000
entries. There are no files, job execution, events, webhook registration,
outbound messages, subscriptions, alarms, or speculative wake changes.

## Compatibility evidence and limits

Cursor support [confirmed missing version headers on reused Bot sessions](https://forum.cursor.com/t/grok-bot-remote-mcp-requests-omit-mcp-protocol-version-on-reused-sessions-causing-empty-http-400/174114/5).
The [report's initialize transcript](https://forum.cursor.com/t/grok-bot-remote-mcp-requests-omit-mcp-protocol-version-on-reused-sessions-causing-empty-http-400/174114)
uses 2025-06-18; this is not proof of 2026-07-28 support. Therefore this endpoint
uses the [MCP 2025 lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
and JSON responses over [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
It is stateless and issues no MCP session ID. Since it supports one version only,
an absent version header selects 2025-06-18; an explicit mismatch is rejected.
This compatibility exception never changes `/relay/mcp`'s mandatory headers.

Cursor support [listed the HTTPS, localhost and custom-scheme callbacks](https://forum.cursor.com/t/grok-bot-custom-mcp-oauth-fails-before-sign-in-redirect-uri-not-allowed/171877/5).
The [static CLIENT_ID report includes a fix and reporter confirmation](https://forum.cursor.com/t/grok-bot-custom-mcp-needs-static-oauth-client-id-blocks-oracle-netsuite/168121).
These support a fixed public-client design, but do not verify Brayden's personal
Bot, its exact callback, authorization UI, scope/resource parameters, or wake.
There is no static secret-header workaround in this implementation.

## Offline protocol and isolation matrix

| Synthetic case | Expected and observed |
| --- | --- |
| Unconfigured, partially configured, disabled, or reused app credentials | 503; no Makima object allocated |
| Resource/server metadata | Makima-only audience and scope; S256; no registration endpoint |
| DCR exact callback or mixed callback array | Rejected without allocating a client |
| Wrong callback, client, audience, scope, plain PKCE or duplicate parameters | Rejected before identity-provider I/O |
| Mock owner login, explicit consent, valid PKCE code | Separate Makima grant and token family |
| Wrong verifier/client/callback/audience; code replay | Rejected without issuing access |
| Refresh rotation, attempted scope expansion, family replay/revoke | Narrow scope retained; invalid requests/revoked tokens blocked |
| ChatGPT cookie or incorrect CSRF; consent cancellation | No grant issued |
| 2025-06-18 initialize, initialized notification, ping, tools/list | Standard 2025 result; notification 202 with empty body |
| Header omitted after initialize | Supported on Makima only |
| Explicit 2026-07-28, 2025-03-26, empty or unknown version header | 400 |
| Unsupported initialize version without conflicting header | Server offers 2025-06-18; client must accept or disconnect |
| Malformed JSON, batch, invalid RPC, wrong type/Accept or origin | Rejected |
| GET MCP stream | 405 (no stream offered) |
| server/discover, events, resources, owner/project/private/public tools | Unavailable; no broader capability listed |
| Owner/Lucy/Muse/Mast credentials at Makima; Makima at existing lanes | Rejected in both directions |
| Seeded existing private history | Absent from Makima; no copied tables |
| Explicit owner text → Makima list/reply → owner list | Only those shared messages visible |
| Eight concurrent identical sends | Exactly one new row |
| Same UUID with changed body, target, sender or whitespace | Conflict; first row preserved |
| Foreign reply target, sender/channel/file spoofing | Rejected |
| More than 50 messages, invalid cursor | Bounded pages; invalid cursor rejected |
| Revocation between HTTP ingress and RPC, or across owner read bridge | Cached access/data release blocked |
| Real local workerd broker and Durable Object routing | Mock OAuth + initialize + missing-header list/send/retry pass |

Reproduce without provider access:

```sh
node --test tests/relay-makima*.test.js tests/relay-oauth*.test.js tests/relay-owner.test.js tests/relay-agent-chat.test.js
npx --no-install esbuild backend/worker.js --bundle --platform=browser --external:node:crypto --format=esm --outfile=/tmp/jarvis-makima-worker.mjs
```

The Makima suite has 12 SQLite/Worker tests and one local workerd test. Only
synthetic credentials and mock identity-provider responses are used; workerd
dispatch explicitly disables redirect following. No external agent messages are
sent. The broad backend/Relay run passed 1,286 tests, skipped 101 and failed one
mandatory Chrome check because qualified Chrome 154.0.8037.97 is unavailable in
this environment. This is not full browser qualification. A final run of every non-browser Relay test plus shared/publication/origin/Hub
contracts passed **1,269 tests with zero failures or skips**. The existing 154
OAuth checks and the Worker bundle pass. No real Grok connection or wake was tested.

## Exact later owner setup (not performed)

1. Confirm Makima's actual personal Bot allows a static public `CLIENT_ID`,
   `relay:makima` scope, resource `<issuer>/relay/makima/mcp`, and exactly
   `https://www.cursor.com/agents/mcp/oauth/callback`. If it only offers DCR,
   localhost, a custom scheme, a different callback, or omits required OAuth
   parameters, stop: the exact blocked client behavior needs investigation or a
   separately reviewed callback policy. Do not weaken validation.
2. After action-time approval, have the release owner merge/deploy the reviewed
   code **with the flag unset/false**. Keep the existing relay, credentials,
   project memberships and frontend release settings unchanged. Complete the
   qualified browser gate before release.
3. Owner creates a separate GitHub OAuth app for Makima owner sign-in. Set its
   homepage to the existing Jarvis site and its only authorization callback to
   `<issuer>/relay/makima/oauth/github/callback`. Store its ID as
   `RELAY_MAKIMA_GITHUB_CLIENT_ID` and its new secret as
   `RELAY_MAKIMA_GITHUB_CLIENT_SECRET` through the owner's secure Worker settings.
   Never reuse or paste Lucy/Muse/Mast/device bearers or the old app secret.
4. Owner chooses a new public 64-character lowercase-hex client ID, configuring
   `RELAY_MAKIMA_CLIENT_ID` server-side and the same static `CLIENT_ID` in
   Makima's Bot MCP configuration. This is a server-configured public client,
   not a secret or dynamic registration; no live registration has happened here.
5. Only after specific activation approval, set `RELAY_MAKIMA_ENABLED=true`
   (existing `RELAY_MCP_ENABLED` must also be true). Add the new MCP endpoint to
   Makima's Bot, authenticate through the new app, and consent to
   `relay:makima` only. Do not share authorization codes or tokens in chat,
   repository files, logs, or issue comments.
6. With an existing authenticated owner device, explicitly share one harmless
   fresh UUID/text through `POST /relay/owner/makima`. Invoke Makima manually,
   have her list and send a reply preserving IDs on retries, and confirm the
   reply via `GET /relay/owner/makima`. The UI has no Makima control yet; use a
   trusted local owner client without copying the device token to Makima. Stop
   at this bounded test; it proves only the observed manual connection. Any
   team membership, owner UI, or automatic wake needs its own design/approval.

Immediate rollback is setting the Makima flag false and revoking the Makima
token family at `/relay/makima/oauth/revoke` with its own client ID. Turn the flag
back on only after review. Disabling blocks access but preserves explicitly
shared channel text; it does not delete history or change existing lanes.

Prepared activation request for a later owner decision:

> Approve only the reviewed Makima adapter release, its separate sign-in app
> and public OAuth client, and a `relay:makima` grant to Brayden's Makima Bot for
> the isolated text channel plus one harmless manual roundtrip. Default renewal
> is 30 days. No private owner or existing teammate history, broader tools,
> project membership, webhook, automatic wake, or external agent messages are
> authorized by this request.
