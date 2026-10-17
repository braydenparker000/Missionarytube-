# Jarvis Relay MCP Events connector

This connector is disabled by default. Qualify deployment, owner OAuth, and the
actual event-to-reply lifecycle before replacing the existing hourly responder. Keep Muse and daily briefings as
they are. No paid upgrade or account/resource creation is included in the build.

## What runs where

The existing `jarvis-hub-api` Worker exposes a separate `/relay/mcp` endpoint. The
old `/mcp`, legacy workspace APIs, GitHub publications importer, and public UI
remain compatible. Both new read tools and `relay_reply` use the real shared
SQLite Durable Object `jarvis-shared-v2`, not the old per-workspace inbox.

Private OAuth tables live in that same object, so a write's final authorization
check and synchronous SQLite commit cannot race a separate-object revocation.
No new Worker, Durable Object binding, or state database is needed.

One small, stateless Node API performs callback HTTPS delivery. It has no inbox,
OAuth database, subscription store, or background polling. The Worker sends one
signed JSON body; the API validates DNS on every attempt, rejects non-public
destinations, pins the validated IP, and retains the original TLS hostname. It
does not receive webhook signing keys, GitHub credentials, or MCP bearer tokens.

### Why the separate Node API

OpenAI requires callback DNS validation **at connection time**, pinning the
validated address while preserving TLS hostname verification. Workers' HTTP and
HTTPS implementations are wrappers around fetch, and do not support `lookup` or
`createConnection`; HTTPS also omits `servername`. Raw Workers sockets restrict
Cloudflare destinations and are not an equivalent arbitrary callback transport.
An open production `startTls` SNI report is an additional risk, not independently
verified proof that every configuration fails.

- [MCP Events callback requirements](https://developers.openai.com/plugins/build/mcp-events)
- [Workers HTTP restrictions](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [Workers HTTPS restrictions](https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/)
- [Workers socket restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

Do not replace the pinned transport with a DNS-check followed by ordinary fetch.
That would leave a DNS-rebinding gap.

## Owner authentication

The current public browser key is public posting access, not proof of identity.
The new OAuth broker authenticates GitHub account ID `183016859` and nobody else.
It uses authorization-code + S256 PKCE on both the ChatGPT and GitHub legs, exact
resource and callback binding, an HttpOnly same-site cookie, a short-lived
single-use login state, and a separate explicit consent page.

The broker requests no repository or private-email permission from GitHub. It
reads the authenticated GitHub `/user` identity and discards that upstream token.
Public visitor message text cannot authorize account actions or private-data
disclosure. Every event and read result marks visitor identity as unauthenticated.
Replies are public.

OAuth access tokens last at most one hour; fresh consent defaults to a 30-day
refresh family and offers an explicit, disclosed 365-day choice. Existing grants
retain their original expiry and scope. Rotation never extends the absolute
expiry selected at approval. ChatGPT may require reconnection earlier, so this
server-controlled window does not guarantee platform retention. Both tokens are opaque
random values whose IDs are hashed in storage. Refresh is atomic, rotates both
tokens, and detects reuse for the family lifetime. Revocation is checked on every
MCP request, before write commits, and before each webhook delivery. Refresh-token
scope narrowing also stops subscriptions whose event permission was removed.
Public downstream client registration identities remain valid for the connection,
including retries after a cancelled first login. Registration grants no access;
GitHub owner authentication, explicit consent, exact callback/resource binding and
S256 PKCE are still required. DCR remains rate limited and capped at 50 client
records; identical public instances of this fixed ChatGPT registration atomically
reuse a surviving identity, so new unauthenticated registrations cannot fill a
permanent pool. Per-consent grants, codes, PKCE and token families remain separate.
Login, consent and authorization-code sessions still expire in ten minutes, and
the access token remains short-lived and client registration does not extend any
existing grant.

This preserves ChatGPT's documented one-registration-per-connection reuse:
[OpenAI client registration requirements](https://developers.openai.com/plugins/build/auth#client-registration).
Valid legacy registration rows migrate without extending bearer grants. Client
metadata uses a far-future SQLite integer expiration to avoid immediate deletion
if the old Worker is restored; old code can still shorten the registration to 30
days after a new consent, so that rollback does not preserve durable behavior.
Already expired or deleted registrations require a fresh DCR registration through the
existing ChatGPT connection setup; the server never recreates an unknown client
from an authorization request. Authorization errors include fixed, nonsecret
`error_description` codes identifying the failed requirement, without echoing
URLs, client IDs, state, PKCE values or credentials.
Public-client reuse is allowed by
[RFC 7591 sections 3.2.1 and 5](https://www.rfc-editor.org/rfc/rfc7591).

## Protocol and tools

- MCP 2.0, protocol `2026-07-28`; stateless `server/discover`, no legacy initialize
- Modern HTTP `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` validation
- `relay_list_pending`: stable pages of unanswered current-store messages
- `relay_read_conversation`: target, accepted reply, and 25 previous public entries
- `relay_reply`: atomic one-reply-per-target claim; identical retries succeed and
  conflicting replies preserve the first accepted answer
- `relay_event_access_status`: read-only scope/event status, discoverable to
  authenticated connections; missing `relay:events` triggers explicit OAuth
  consent while preserving only live verified scopes, without subscribing
- `events/list`, `events/subscribe`, `events/unsubscribe`
- Event `relay.message.created`, inbox `brayden-relay`, optional literal
  case-insensitive `message_contains` filter applied to the complete message

Only a new `/shared/messages` user insertion emits an event. Duplicate retries,
legacy imports, assistant replies, and daily briefings do not. Message insertion
and its event journal are one SQLite transaction. The object persists an alarm
before committing the message, so a crash cannot strand an accepted message event.

Subscriptions have deterministic identity from principal, callback URL, event
name, and canonical arguments. The signed, short-lived challenge must echo before
activation. Verification is cached for five minutes per owner + callback. Signing
keys are 24–64 bytes with the Standard Webhooks `whsec_` representation. Rotation
uses both signatures for five minutes. Secrets are never returned in tools/logs.

Subscriptions are finite, default/max one day; `ttlMs: null` still grants a finite
expiration. ChatGPT renews them. Expiration, revocation, and unsubscribe remove
callback secrets and outbox records. Up to eight subscriptions and 2,000 pending
occurrences per subscription are kept. Overflow stays in the 30-day journal and
is refilled after acknowledgements. Replay beyond retained history explicitly
sets `truncated: true`.

One occurrence per request is signed over the exact serialized bytes, with a
stable event ID and a fresh timestamp/signature on every attempt. Transient
failures back off exponentially for at most six attempts. `410` removes the
subscription; `413` and permanent 4xx are never retried. Exhausted delivery pauses
that subscription until renewal. `2xx` means callback receipt, not that ChatGPT
has executed or replied. The server sends no unsupported gap/terminated controls.

## Exact setup after approval

For the Vercel hosting path, use [the exact Vercel project settings and secure
setup sequence](relay-vercel-setup.md). The Azure sequence below remains an
alternative; it does not need to be performed as well.

1. Approve creating a **GitHub OAuth app** for this connector. GitHub settings:
   name `Jarvis Relay`, homepage the existing Jarvis website, callback
   `https://jarvis-hub-api.braydenparker999.workers.dev/relay/oauth/github/callback`.
   Keep creation of its client secret and all secret entry in a secure owner
   handoff. Configure `RELAY_GITHUB_CLIENT_ID` and `RELAY_GITHUB_CLIENT_SECRET` on
   the existing Worker. Never paste these into a repo, chat, CLI argument, or log.
2. Approve one separate **Azure Static Web Apps Free** resource solely for egress.
   It must use managed APIs, not the existing Azure Storage site. App path
   `relay-egress/public`, API path `relay-egress/api`, output path empty, Node 22.
   The prepared manual workflow is `.github/workflows/deploy-relay-egress.yml`.
   Configure its deployment credential as the `relay-egress` GitHub environment's
   `RELAY_EGRESS_DEPLOYMENT_TOKEN` through secure owner entry. No secret creation
   or configuration has been performed by this build.
3. With action-time approval, create/configure one random 32-byte-or-stronger
   Worker-to-egress credential. Enter the same value securely in Azure backend
   application settings and Worker secrets as `RELAY_WEBHOOK_EGRESS_TOKEN`.
   Set Worker `RELAY_WEBHOOK_EGRESS_URL` to the verified new resource's
   `/api/relay-egress` URL. The credential is not forwarded to callback recipients.
4. Publish the reviewed connector commit only after publication authorization.
   Build/bundle validation must pass. Deploy the existing Worker through its
   normal approved release flow. Keep `RELAY_MCP_ENABLED` absent/false while
   deployment and egress configuration are being verified.
5. Enable `RELAY_MCP_ENABLED=true` only after setup approval. Optional
   `RELAY_MCP_ORIGIN` is the HTTPS Worker origin; default is its existing URL.
   Discovery URLs are
   `/.well-known/oauth-protected-resource/relay/mcp` and
   `/.well-known/oauth-authorization-server/relay`. Authorization issuer is the
   Worker origin plus `/relay`; successful/error callbacks return that exact iss.
6. In [ChatGPT Plugins](https://chatgpt.com/plugins), create a developer-mode
   connection named Jarvis Relay, URL the Worker `/relay/mcp` endpoint. Complete
   GitHub owner sign-in and the explicit consent page. Installation/connection
   and resulting persistent grants are separate approved setup actions.
7. After connection, call a harmless read tool, discover supported event schema,
   then create exactly one event subscription/task for new Relay messages and
   the approved response behavior. Do not guess connector IDs or replace this
   event request with scheduled polling.
8. Run the live qualification checklist below. Only after it passes, and parent
   coordination confirms cutover, pause the old hourly Relay responder. Keep
   unrelated Muse and daily briefing tasks unchanged.

### Cost boundary

Azure's SWA Free plan and managed APIs are a documented deployment option, not a
verified promise of unconditional $0 on this account. Free has no SLA; bandwidth
and API allowances apply at subscription/account level, and API pricing refers
to Functions Consumption rates. The new resource does not authorize a paid plan,
automatic upgrade, paid overage, or billing commitment. Verify eligibility and
the actual cost controls before provisioning. If a paid commitment is required,
stop and obtain the amount/plan approval; do not create it silently.

- [Managed APIs on all SWA plans](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview)
- [Node runtime configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#platform)
- [Backend application settings](https://learn.microsoft.com/en-us/azure/static-web-apps/application-settings)
- [SWA pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/)

### Alternative real-Node deployment packages

The transport is provider-neutral. Azure is a prepared option, not a chosen or
provisioned host. Vercel Node Functions and Netlify Node Functions wrappers are
also included; do not select their Edge runtimes. The same pinned transport is
copied into each self-contained package, with no npm runtime dependency.

Generate a new output directory without deploying:

```
node scripts/package-relay-egress.mjs --provider azure --outdir /tmp/relay-egress-azure
node scripts/package-relay-egress.mjs --provider vercel --outdir /tmp/relay-egress-vercel
node scripts/package-relay-egress.mjs --provider netlify --outdir /tmp/relay-egress-netlify
```

For Vercel, use the generated directory as a separate project with no framework;
it contains `api/relay-egress.mjs`, a Node 22 engine declaration and a 15-second
function duration. For Netlify, use the generated directory with its supplied
`netlify.toml`, publish `public`, and set backend `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`
through its supported UI/CLI/API setting (not in TOML). Both need the same securely
configured backend `RELAY_WEBHOOK_EGRESS_TOKEN`; point the Worker at the verified
production `/api/relay-egress` URL after deployment. Verify any provider deployment
protection does not intercept authenticated server-to-server production calls.

No new account or paid plan is authorized. Personal/free-plan eligibility, caps,
cost controls, and cold-start behavior must be checked for the chosen account
before provisioning. Every hosted option still needs actual pinned-TLS/callback
qualification; locally importing a package is not proof of hosted compatibility.

- [Vercel Node runtime and handlers](https://vercel.com/docs/functions/runtimes/node-js)
- [Netlify Node function handlers](https://docs.netlify.com/build/functions/get-started/)
- [Netlify runtime configuration](https://docs.netlify.com/build/functions/configuration/)

## Validation

Local command: `node --test tests/relay-*.test.js tests/publications.test.js`.
Use Node 22+ (SQLite support required). Run `npm test` for the existing aggregate;
disclose pre-existing failures/skips separately from connector results.

Live qualification is deliberately still pending:

1. Hosted egress validates/pins DNS and verifies original TLS hostname
2. Private, loopback, mapped/NAT64, mixed DNS, Azure platform VIP, and redirects fail
3. Actual GitHub identity, downstream PKCE, consent, revocation, and resource binding
4. Actual ChatGPT `server/discover` and catalogs show these tools and event
5. Signed callback challenge and subscription persistence succeed
6. A real new Relay message receives a callback 2xx; verify an actual ChatGPT run
7. Direct tool reply appears in the same public Relay inbox without GitHub import
8. Duplicate callback/tool retries cause no duplicate answer; filtering works
9. Renewal/rotation/restart/revocation/unsubscribe work; no reply event loop
10. Preserve all old responder and module behavior until this proof is recorded

Rollback: set `RELAY_MCP_ENABLED=false`, confirm event deliveries stop and existing
hourly Relay response still runs, then remove the new connection/subscription only
with the relevant user authorization. No inbox messages, old credentials, or
publications are deleted by rollout or rollback.


### Reliability boundaries

Current `/shared/messages` writes no longer depend on importing the legacy inbox.
Current `/shared/state` reads attempt the legacy import but retain the current
SQLite response if that old inbox fails. Actual current-store failures still
return 503. Legacy imports remain append-only, preserve old data, and emit no
live Relay events. The existing publication importer, public/private isolation,
OAuth scopes, bounded outbox, subscription TTL and journal retention are unchanged.

The private owner UI exposes redacted persisted message/delivery evidence and a
bounded retry control, described in [owner delivery evidence](relay-owner-pairing.md#private-delivery-evidence-and-bounded-recovery).
A successful callback is transport acceptance only. Relay never labels the
assistant “working” without a separate execution claim.
