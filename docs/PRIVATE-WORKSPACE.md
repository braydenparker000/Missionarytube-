# Unified private Jarvis workspace

Entry: `/private/`, linked from Home's Jarvis and Mast entries. Public Relay and Muse remain under More. Source base is `69b87905ae568c004b457933baa6b8da1ca9dfd5`, verified against live Lucy and Mast code (Mast's live imports use versioned aliases).

Lucy and Mast retain separate existing controllers, transports, authentication, drafts, immutable histories, replies and attachment APIs. Child documents remain mounted while switching so selected files and unsent drafts are retained. Tasks is a read-only projection of the existing two task stores, keyed by agent and ID, with original record/detail JSON and exact completion/version evidence. It creates no execution queue. Makima has no API calls or composer.

Collaboration is explicitly unavailable: `backend/relay-agent-chat.js` rejects browser Origin and there is no existing owner-browser read API. Implementing a real owner channel feed would require an authorized backend access change. No private messages or internal notes are substituted. No Worker script was retrieved and no backend, credentials, schedule or responder was changed.

## Verification

- Three new tests pass, including offline mobile/desktop browser smoke using synthetic Worker/SQLite routing and downloaded, hash-pinned live frontend dependencies.
- Browser cases: original histories, Lucy/Mast recipient isolation, files for both agents, draft retention, refresh, mobile short viewport, task identity, dormant Makima, read-only unavailable collaboration, revocation and authentication failure without a storage event.
- 160 related owner/Mast/attachment/completion contract tests pass.
- Browser screenshots: `/tmp/private-workspace-evidence/mobile.png` and `desktop.png` (synthetic data only).
- Local development smoke uses Chromium 151, not the repository's pinned qualification browser. It is not represented as the historical full qualification proof.
- One bounded review found correction-completion wording and task-read auth-reset bugs; both fixed and tested.

Deployment is a scoped static patch with live dependency and before/after SHA-256 checks, existing Azure federated identity, rollback file artifact, and separate `private-workspace-release.json`. It preserves the existing release pin/receipt and every unrelated blob, including held Poweramp/archive/uploader assets. Home launcher writes last.
