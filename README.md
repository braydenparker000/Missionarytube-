# Jarvis 1.0

Mobile-first personal hub: Jarvis messages and an assistant-published Daily Board.

- Website: https://missionarytube.z13.web.core.windows.net/
- Inbox reader: https://missionarytube.z13.web.core.windows.net/reader/
- Backend: https://jarvis-hub-api.braydenparker999.workers.dev
- Publications: https://github.com/braydenparker999/jarvis/issues/2

## Delivery

Every phone opens the same public conversation. No password, device pairing, or plugin setup. The owner explicitly accepts public reading and ordinary message posting. Anyone finding the URL can do both.

The Azure Storage static website serves the lightweight application shell. Cloudflare stores messages, replies, and briefings in the existing SQLite Durable Object binding. The assistant publishes structured comments through the connected GitHub account in issue #2. Cloudflare accepts only comments authored by owner ID 183016859, validates their schema, and imports them into SQLite. Ordinary visitors cannot publish assistant replies or briefings.

Replies and briefings are data: publishing a comment does not redeploy either website or Worker. The site polls every 30 seconds while visible. Cloudflare checks GitHub at most once per five minutes when the inbox is read, shared across all visitors. Imported entries remain available if GitHub is unavailable. The reply-delivery status is reported separately from message storage.

Ordinary reply bodies are limited to 6,000 characters. Daily Board briefing bodies may contain up to 20,000 characters; titles remain limited to 120 characters.

The importer is append-only. Do not edit or delete published comments to correct entries: these changes do not remove already imported data. Reply targets and dated briefings are deduplicated. Conflicting publications preserve the first accepted entry and appear in reader diagnostics. GitHub pagination resumes after outages or large backlogs.

## Safe rollout

`public/assets/config.js` contains `DIRECT_API_ENABLED`. While false, the main chat uses the existing legacy shared inbox and checked-in publication file. The reader tries the new API first and reports if the backend upgrade is unavailable. Enable the flag only after the live reader confirms version 6, the actual GitHub reply, and the Daily Board test. This prevents a delayed Cloudflare deployment from breaking the existing site.

The new Worker retains legacy APIs for recovery. Old user messages and trusted checked-in replies/briefings are copied into the shared SQLite store without deleting originals. Legacy assistant/board API rows cannot acquire trusted publication status. Offline drafts and retry queues stay on the phone; successful sends are identified by UUID for safe retries.

## Assistant handoff

The direct Relay MCP Events connector is implemented but disabled by default.
It reads/replies in the current shared SQLite inbox and emits signed inbound
message events. Owner OAuth and the DNS-pinned Node callback transport must be
configured and live-tested before replacing the hourly responder. See
[Relay setup and validation](docs/relay-mcp-events.md). The old connector,
GitHub publication flow, Muse, and daily briefings are unchanged.

See [JARVIS-HANDOFF.md](JARVIS-HANDOFF.md). Scheduling is configured in a separate chat after live delivery is verified. Do not claim an hourly task is active until an actual scheduled run succeeds. Quick Chat and other modules remain future work.

## Private owner Relay (staged)

An optional in-page phone-pairing/private chat lane is implemented behind
`RELAY_OWNER_ENABLED`, which remains disabled until separately approved.
It keeps the original Relay URL unchanged, requires a newly consented
`relay:owner` connector capability and per-phone matching-code approval, and
supports independent revocable sessions with a 365-day sliding inactivity expiry.
The public visitor inbox and existing response tasks are unchanged. See
[owner pairing, privacy, and rollout](docs/relay-owner-pairing.md).

Private owner requests also have durable job records in the same storage. Their
identity survives reload and device changes; authenticated immutable replies
save the result. Callback acceptance remains delivery evidence. Optional
execution claims, cancellation acknowledgements and guarded linked attempts use
the existing owner capability. See [the private job contract and verification](docs/relay-owner-jobs.md).

## Deployment and costs

GitHub main is the source. `public/` is published to the Azure Storage static website `missionarytube` by the existing pinned-release workflow in the Missionarytube repository, which validates the public Quick AI configuration and injects the unrelated Drive key and backs up current blobs before upload. There is no frontend build or Azure API deployment. The former Static Web App (`gray-meadow-09216fd10`) is retired: its deploy workflow was removed and the Worker no longer accepts its origin. `public/staticwebapp.config.json` is ignored by Storage hosting, so its per-route security headers do not apply there. Keep large media and data outside Azure.

Cloudflare uses the existing `jarvis-hub-api` Worker and existing `HUBS` SQLite Durable Object binding. Build settings: root `/backend`, build command empty, deploy command `npx wrangler deploy`, production branch `main`. No new binding or paid resource is required.

No paid upgrade, billing entry, or paid service is authorized. Free-tier limits can interrupt service. Public messages have an application cap of 200 new messages per UTC day, but this does not replace provider limits or a verified Free plan.

## Development

Native JavaScript modules and system fonts; no frontend dependencies. Add future routes under `public/`. Only Quick Chat keys that the owner has explicitly designated public may be placed in its static configuration; keep all other credentials out of browser code.

Run `npm test`. Tests exercise migration, preserved drafts, untrusted-role rejection, SQLite pagination, owner-only publication parsing, retries, outage recovery, backlog continuation, and duplicate prevention. Before deploying, run a Wrangler dry-run; before activating the new UI adapter, verify the live reply and briefing round trip.

## Quick Chat public configuration

Quick Chat runs in the browser. It calls Gemini `gemini-3.5-flash-lite`, Qwen `qwen/qwen3.8-27b` on Groq, and Tavily Search directly. The owner chose public, free-plan API keys to avoid configuring Cloudflare secrets or unlocking each device. The deployment repository's existing Azure workflow injects `QUICK_AI_GEMINI_KEY`, `GROQ_API_KEY`, and `QUICK_AI_TAVILY_KEY` Actions secrets into the static Quick Chat config before upload. The source repository contains only an empty template. Keys are intentionally visible to anyone who opens the deployed site, but are not stored in Quick Chat localStorage, sent to Main Chat or Muse, or logged by our code. Verify each provider account has no paid overages before adding its key. The frontend deploy workflow refuses to change live blobs while any of the three secrets is empty.

Quick Chat keeps its existing `jarvis.quick-ai.v1` text chats and drafts; new image bytes stay in browser IndexedDB. Search sends one editable textual query to Tavily only when enabled, followed by one selected-model request. Google free-tier API data may be used for product improvement. Main Chat and Muse remain on their check-based integrations.

The composer shows reported token usage for completed replies in the current saved chat and Tavily credits for searches made after usage reporting was added. It includes searches even if the model request fails. Groq's remaining daily requests and minute tokens appear when the browser can read its response headers; a rate-limit error without exposed headers is labeled as such. These chat totals omit other devices and consumers of the same public keys and are not an account balance. Gemini project quotas must be checked in AI Studio.

Rollback: pin a previous *public-config* Jarvis revision or disable Quick Chat while preserving the local chat storage. Do not roll back to the older exposed `apiKey` format or reintroduce a Cloudflare Worker dependency. Rotate the old Groq key only after confirming other consumers and the new frontend release.

## Shared engineering delivery

Use the [portable delivery SOP](.agents/skills/deliver-software-efficiently/SKILL.md)
and [bounded delivery plan](docs/delivery-plan.md) for shared project work.
Agents without automatic skill discovery should explicitly read the SOP.
