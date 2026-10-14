# Makima connection checkpoint — 2026-10-14

The owner-approved resume completed Makima-only enablement through the connected
Cloudflare API. This is endpoint readiness, not a completed Grok connection.
No new credentials, OAuth grants, agent messages, webhooks or routines were
created. Poweramp and the legacy uploader remain outside this work.

## Verified deployment

- Qualified Jarvis source: `099ec1a0b2b621a3799f4f8346490903f212a912`.
- Previously uploaded, disabled Worker version: `54544c04-10e7-4087-9edf-54fe55ea97e0`.
- Enabled Worker version: `f477e46b-7d17-436e-9b3f-16dadb6d6933`, 100% traffic.
- Unchanged code SHA-256: `e12a5f82dcf64ebf2e83840a72fbff86e8b172f67eada8032e7615b8d547cf70`.

The [disabled inspection](https://github.com/braydenparker000/Missionarytube-/actions/runs/38574586870)
observed HTTP 503 with the exact inactive response, the approved public client
and separate encrypted Makima app secret present, and the expected code hash.
The prior deployment had accepted that code but stopped before enablement on an
unexpected public status. That run did not record the status; its original cause
cannot be established from the available evidence.

The active version was also the latest saved version immediately before the
settings PATCH. Only `RELAY_MAKIMA_ENABLED` changed to `true`. Every other binding
used Cloudflare's documented `inherit` type, so values stayed server-side.
Runtime settings and writable annotations were retained; migrations were not
replayed. Safe before/after projections matched for all other settings, resource
identifiers and existing public flags. No code upload occurred during this resume.

The [enabled inspection](https://github.com/braydenparker000/Missionarytube-/actions/runs/38576534092)
passed and independently verified the enabled version and unchanged code hash:

| Public check | Observed result |
| --- | --- |
| Protected-resource metadata | HTTP 200; exact Makima audience, authorization server and sole `relay:makima` scope |
| Authorization-server metadata | Exact Makima issuer, sole scope, S256; no dynamic registration endpoint |
| Untrusted callback authorization request | HTTP 400 `redirect_uri_mismatch`; no Location header |
| MCP request without authorization | HTTP 401 |
| Real Grok OAuth, tools and message exchange | Not performed; owner action required |
| Webhook wake | Not tested or changed |

This environment still receives Cloudflare 1010 access denial. Ordinary public
requests from the existing authorized Actions diagnostic succeeded. No custom
user-agent, proxy, bypass or alternative credential was used for public requests.

## Remaining owner steps

Configure the personal Bot's custom MCP connection with:

- URL: `https://jarvis-hub-api.braydenparker999.workers.dev/relay/makima/mcp`
- Public CLIENT_ID: `b6bf3d2688484111e45ab58a644208918b875ad6fccc16f3ef65ad986aab4def`
- CLIENT_SECRET: empty.
- Scope: `relay:makima` only.

Before signing in or selecting Allow, inspect the authorization request locally
and confirm its `redirect_uri` is exactly
`https://www.cursor.com/agents/mcp/oauth/callback`. If it differs or is not
observable, stop and report that condition. Report only the callback string or
match/no-match; never send full OAuth URLs, state, PKCE, cookies, codes or tokens.
Do not enable dynamic registration or relax the callback allowlist.

Only on a verified callback match, continue the already-approved owner consent
with a 30-day fixed refresh-family deadline and access lasting at most one hour.
Do not select 365 days. Then test the two private Makima tools with one explicitly
shared harmless message and its reply. The owner bridge is
`/relay/owner/makima`, protected by the existing owner session; no broader history
or inbox should be exposed. Synthetic tests do not establish real Bot compatibility.

For the bounded trial, revoke the family while Makima is enabled, then disable
the flag. Disabling alone blocks requests but does not revoke families or delete
channel text. Webhook registration and automatic wake need a separate decision.

## Saved implementation evidence

[Jarvis PR 146](https://github.com/braydenparker999/jarvis/pull/146) contains the
isolated adapter. The [draft setup and protocol matrix](https://github.com/braydenparker999/jarvis/pull/147)
record the original offline qualification and secure setup; their earlier paused
deployment status is superseded by this checkpoint.

The operational branch's checks passed: 1,079 repository tests, no failures or
skips, `npm run build`, and 16 focused preservation/public-policy tests. These
checks cover the operational helpers. Earlier adapter tests cover channel
isolation, duplicate-safe writes and the bounded MCP protocol matrix.

The historical deployment helper deliberately retains its old version/hash
precondition and will refuse the now-enabled version. Do not rerun it or update
that guard to bypass reconciliation. Inspection remains GET-only and may be run
without granting OAuth access. This draft does not authorize future deployment
or merging.
