# Private workspace static patch

Source: `braydenparker999/jarvis` branch `feat/unified-private-jarvis`, exact SHA in `scripts/private-workspace-pins.json`. Entry: `/private/`.

The existing default main/release pin predates live UI patches. This release therefore uploads only 12 explicitly pinned frontend files, verifies 16 existing live dependencies, backs up overwritten files before publication, and updates the Home launcher last. It publishes a separate `private-workspace-release.json` with source/orchestration/file digests. Existing `release.json`, `release-qualified.json`, Worker code/settings, credentials, access, schedules and unrelated blobs are untouched. Uses the existing Azure federated identity and static hosting account/container.

The workflow `publish-private-workspace.yml` runs only by explicit dispatch on main with existing AZURE_DEPLOY_ENABLED. Source npm dependencies are installed with lifecycle scripts disabled; synthetic offline tests run before Azure login. No real test messages are sent. The publisher rejects dependency or target drift; backups remain as Actions artifacts. Interrupted writes can be retried only when files are original or exact proposed bytes.

Acceptance evidence: 3 new tests including mobile/desktop Chromium smoke, original history, attachments for both recipients, wrong-recipient exclusion, draft retention, refresh, exact task IDs, correction/completion semantics and revoked/page-only auth reset. 160 related owner/Mast/attachment tests and 16 navigation/origin checks pass. Deployment repository: npm test 1072 passed; npm run build succeeded using its existing pinned source. Broad source npm test was attempted but failed in unrelated aligned-page/browser checks and stalled; it is not a full qualification proof. Scoped CI evidence is separate from historical full release qualification.

Known access boundary: Collaboration displays an unavailable read-only panel because the existing shared channel rejects browser access and has no owner-browser read endpoint. No backend authorization is broadened. Makima remains disconnected and generates no network requests.
