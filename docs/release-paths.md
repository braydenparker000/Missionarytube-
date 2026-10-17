# Component release paths

This extends [the component inventory](release-inventory.md) with code-backed release-path distinctions. Reviewed against deployment commit `0c521d76` on 2026-10-17. It is documentation only, is not consumed by a publisher, and authorizes no deployment or retirement. Source-main egress references below describe that pinned source revision, not proof of the current deployed bundle.

## Binding provenance

The [general Azure workflow](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L129-L169) runs `prepare-music-worker.mjs` when the pinned release enables the podcast Worker path. It prepares a generated music configuration. The actual Worker upload additionally requires non-receipt-only mode and the identity gate's `deploy == true` result; only that upload uses `backend/wrangler.music.generated.json`. Preparation alone does not imply an upload.

The [private-workspace workflow](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/publish-private-workspace.yml#L61-L72) invokes the collaboration publisher separately from its static publication. The [collaboration publisher](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/publish-private-collaboration.mjs#L21-L28) preserves existing bindings using `keep_bindings` derived from validated live binding types, restricted to plain text, secret text, Durable Object namespaces and R2 buckets. It sends no replacement binding values, migrations, triggers or activation settings.

Its [line-11 import](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/publish-private-collaboration.mjs#L9-L13) includes `readWorkerSettings` and `checkedBindings` from the binding-check helper. This is a read/check dependency, not a generated-config path: the collaboration script contains neither `prepare-music-worker.mjs` nor `wrangler.music.generated.json`.

[Before and after guards](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/publish-private-collaboration.mjs#L53-L72) compare the complete observed identity, check the pinned settings digest, verify uploaded code, and assert unchanged settings and schedules. A matching bundle is reused rather than uploaded again. This path can preserve `MUSIC_R2` if already live; it does not create that binding. These historical pinned publishers are not interchangeable with the newer private-board frontend-only publisher.

## Trigger and deployment gates

- A matching main-branch push to [the general workflow](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L62-L94) starts qualification. Production upload jobs require manual `workflow_dispatch`; a workflow name containing “Deploy” is not evidence of deployment.
- Manual dispatch is necessary but not sufficient. The general deploy job requires main, `AZURE_DEPLOY_ENABLED == 'true'`, qualification success and the complete input exclusions in its [job condition](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L88-L96). Individual specialized jobs have their own input conditions. Selecting a specialized operation can skip general qualification/deployment in favor of that operation's guarded path; do not summarize all manual dispatches as “qualification plus deploy.”
- Within the general job, receipt-only reconciliation, enabled components and identity checks further determine whether a Worker is uploaded. Use the exact selected job and step conditions, not merely the event type.
- The verified music Worker workflow is manual-dispatch-only. No dispatch is part of documenting these paths.

## Egress route and preservation boundary

The pinned source [configuration](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/backend/wrangler.jsonc#L7-L10) names a Vercel egress URL. [webhookTransport](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/backend/relay-events.js#L238-L256) returns null without both URL and token, otherwise POSTs through that endpoint; the [alarm caller](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/backend/worker.js#L142-L148) passes the transport to the outbox drain. This supports an intended route, not an end-to-end delivery claim. An HTTP 405 from a GET would only show an answering endpoint, not successful webhook delivery; no new live probe was needed for this document.

The Azure egress path is a retirement candidate requiring caller and rollback review, not proven unused or approved for removal. Shared dependencies must stay: [the egress tests](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/tests/relay-egress.test.js#L7-L15) import the shared pinned-HTTPS module, re-export and server, and also directly require the Azure adapter. Even deleting the Azure adapter alone would require an explicit test/coverage disposition.

The [packager](https://github.com/braydenparker999/jarvis/blob/ed7bbd436689be3ac9cca1ab5f111341dd690b80/scripts/package-relay-egress.mjs#L5-L18) supports Azure, Vercel and Netlify; its non-Azure branch still copies the shared module from `relay-egress/api/shared/`. A future narrowly scoped retirement could assess the Azure workflow, provider-specific artifacts and Azure packaging branch, but cannot wholesale remove `relay-egress/` or the shared packaging script. Preserve the Vercel package and shared modules until callers and equivalent coverage are accounted for.

## Dependency counts

The private frontend inventory contains **18 published files plus 45 preserved dependencies, 63 paths total**, with no overlap. Of the preserved dependencies, 42 are under `assets/`; the other three are `mast/index.html`, `private/lucy.html` and `private/mast.html`. This is a component closure, not the whole site's file count. Existing inventory validation remains read-only and does not establish fresh live-state proof.
