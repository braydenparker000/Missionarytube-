# Jarvis Relay: Vercel setup

The delivery adapter is a small stateless Node function. The existing Cloudflare
Worker keeps Relay's SQLite data, owner sign-in, MCP tools, event subscriptions,
and retry queue. Vercel receives an authenticated delivery envelope and sends the
signed event through a DNS-validated, IP-pinned TLS connection. It has no Relay
database and does not receive the owner's GitHub client secret or MCP token.

## Source options

The checked-in directory `deploy/relay-egress-vercel` is ready for import. Its
contents are generated from the canonical transport with:

```
node scripts/package-relay-egress.mjs --provider vercel --outdir <new-directory>
```

The focused tests check every checked-in package file against a fresh generated
package, so updates cannot silently leave the importable copy behind.

Prefer a dedicated repository named `jarvis-relay-egress` when using Vercel's
GitHub integration. Publish only the generated directory's contents at the new
repository root. Select **Only select repositories**, then only that repository,
when installing Vercel's GitHub app. It requests substantial repository write
permissions; do not grant all repositories. Creating the repository, publishing
code, and granting persistent app access each require the applicable approval.

Alternatively, import the existing `braydenparker999/jarvis` repository with root
directory `deploy/relay-egress-vercel`. This avoids a new repository but grants
Vercel access to the full selected Jarvis repository, not just the subdirectory.
The directory must exist on the selected remote branch before importing it.
The source does not need the option to include files outside its root.

If a connected Vercel tool can deploy the local package directly within the
approved account and plan, a GitHub integration is unnecessary. Inspect the
tool's actual capabilities before asking for repository permissions or creating
a deployment credential. A tool that only deploys Git references still needs
the reviewed source published first.

## Exact project settings

| Setting | Value |
| --- | --- |
| Project name | `jarvis-relay-egress` |
| Account/plan | Owner's approved personal Hobby account; no paid upgrade |
| Root directory, dedicated repository | `.` |
| Root directory, Jarvis repository | `deploy/relay-egress-vercel` |
| Framework preset | Other |
| Build command | Override enabled, empty |
| Output directory | `public` |
| Node.js version | 22.x |
| Function duration | 15 seconds, already in `vercel.json` |
| Function endpoint | `/api/relay-egress` |
| Runtime | Node.js; do not switch to Edge |
| Production environment variable | `RELAY_WEBHOOK_EGRESS_TOKEN` |

The supplied `vercel.json` fixes the framework, skipped build, static output,
and function duration. `package.json` pins Node 22.x. There are no runtime npm
dependencies. Static serving is limited to `public/index.html`; the transport
source and configuration are outside that directory.

Deploy the production branch containing the reviewed files. If importing a
feature branch, explicitly choose that source for the first deployment and
verify its exact commit; importing the repository's default branch does not
include unpublished local work. Prefer the stable production project domain
returned by Vercel over a preview or commit-specific URL. Obtain the actual
domain from the created deployment rather than guessing it from the project
name.

## Secret and account setup

1. Verify Hobby eligibility and current account limits before creating a
   resource. Do not add a card, start a trial, upgrade, or enable paid overage
   without approval of the actual commitment. A quota exhaustion can interrupt
   delivery even when there is no paid upgrade.
2. After approval, the owner creates a random 32-byte-or-stronger credential in
   their secure credential workflow. They enter the same value into Vercel's
   production backend environment variable and the existing Worker's secret,
   both named `RELAY_WEBHOOK_EGRESS_TOKEN`. Do not put it in chat, source, CLI
   arguments, logs, screenshots, or a public issue. Preview deployments do not
   need the production secret. Redeploy after environment changes so the
   production function receives the value.
3. Use the existing Worker's approved setup flow to configure
   `RELAY_WEBHOOK_EGRESS_URL` as the verified production function URL. Keep
   `RELAY_MCP_ENABLED` absent or false until the remaining owner OAuth setup and
   transport qualification are approved and complete.
   The checked-in Worker configuration already supplies the public GitHub client
   ID and verified egress URL. It keeps existing dashboard variables, and does
   not set the enable flag: an absent flag defaults to disabled, while a later
   owner-approved activation survives future releases.
4. Owner GitHub sign-in needs the separate free OAuth app described in
   [the connector setup](relay-mcp-events.md#exact-setup-after-approval). This app
   asks for no repository or private-email access. It is separate from Vercel's
   repository integration and its credentials stay on the Worker.

Persistent app grants, credential creation/configuration, and security settings
need action-time owner approval. The owner enters and submits secrets themselves
through a secure handoff. Viewing a dashboard or listing projects does not
authorize these changes.

## Qualification before cutover

1. Verify a deployed `/api/relay-egress` POST without the service credential
   returns JSON `401`, or `503` before configuration. A sign-in HTML page,
   deployment-protection challenge, redirect, or provider `404` is not the
   function's expected response. Review any production protection change with
   the owner before changing security settings.
   After configuration, a browser GET returns `405`; before configuration it
   returns `503`. Both are expected application responses.
2. Through the approved secure service workflow, verify authenticated malformed
   requests fail before opening a callback connection. Check localhost, private,
   link-local, reserved, mixed public/private DNS, and redirect cases remain
   blocked. Never expose the service credential to a test recipient.
3. Test a controlled real HTTPS callback with a valid public address and hostname
   certificate. Check the event's exact bytes/signature and successful `204`
   delivery. Real hosted TLS and DNS behavior still need this test; local import
   and mocked tests do not establish it.
4. Complete the actual owner OAuth login/consent, harmless MCP read, and event
   discovery in ChatGPT. Subscribe using the discovered supported schema, then
   create an approved public test message and verify callback receipt, actual
   task execution, and a direct visible reply in the same Relay inbox.
5. Verify retry, literal filtering, reply-loop prevention, renewal, unsubscribe,
   and revocation. Only after the end-to-end lifecycle passes, coordinate the
   approved old responder cutover.

## Current documentation

- [Node Functions and Web handlers](https://vercel.com/docs/functions/runtimes/node-js)
- [Build and root-directory settings](https://vercel.com/docs/builds/configure-a-build)
- [Configuration properties](https://vercel.com/docs/project-configuration/vercel-json)
- [GitHub integration permissions](https://vercel.com/docs/git/vercel-for-github)
