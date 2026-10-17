# Private attachment frontend follow-up

This follows the independently qualified navigation/local-picker change in PR109.
The backend is owned by PR108; this branch changes no backend implementation.

## Capability and transport

The client enables sending only when the authenticated owner response explicitly
contains `attachments_enabled: true`. Backend PR108 e8f9e2b now supplies this additive signal; absent/false retains the honest local-preview gate.
Public chat stays text-only. No credential, scope, storage service or schedule is
introduced. Only `/jarvis*` gains `blob:` in `img-src` for authenticated raster
previews; other modules' CSP and styles are unchanged.

The draft reserves its message UUID before upload. Up to four files of at most
1 MiB use the exact PR108 staging route and MIME allowlist. Browser-empty MIME
values can be inferred from supported extensions; the server still checks actual
bytes. The frontend validates each receipt's identity, MIME, size and SHA-256.
Upload progress is indeterminate unless actual progress is supplied; selecting a
file never implies acceptance. Uploads begin only on Send.

Once message submission begins, file selection is locked. An unconfirmed send
retries its original UUID, body and ordered attachment IDs. An edited text draft
survives confirmation of that original send. Removing a file during staging
aborts it and attempts draft disposal; message submission is suppressed if the
selection changed. Unconfirmed disposal is labeled, with server-side 24-hour
expiry as fallback. Auth loss clears in-memory file drafts.

Attachment-only messages are allowed when the capability is enabled. The
existing private job parser accepts an empty original message body for that
case while retaining identity, provenance, state and completion validation.
Explicit work-request forms retain their existing text/scope validation; files
are sent through private messages.

## Linked content

Private message metadata renders inert file names and download controls. Raster
previews require an explicit click. Content is fetched with the existing bearer
header, bounded by expected size and verified against its MIME and SHA-256.
Tokens never enter URLs. PDF and text documents are downloads, never inline
frames or executable markup. Object URLs are revoked when previews close, their
view unmounts, owner access is lost, or downloads have started. Delayed reads
cannot recreate a removed view.

## Validation boundaries

`relay-attachment-transport.test.js` checks the frontend contract and controller
retry/cancellation behavior independently. Existing owner/chat/navigation tests
must continue to pass against the old backend with attachments gated.

`relay-attachment-delivery-browser.test.js` requires the companion backend file.
On a frontend-only branch it explicitly skips; on a paired head it requires a
real capability signal and exercises real Worker routes and SQLite, actual
private bytes/downloads, immutable retries, cancellation and view cleanup. Do
not report those skips as end-to-end qualification. No network service or live
owner data is used.

The initial diagnostic combined checkout used backend e3f4c1a and temporarily
supplied the pending capability field and normalized ArrayBuffer bindings for
Node SQLite. Those diagnostics are not production or paired-head qualification.
Final exact commits, checks and blockers belong in the follow-up PR description.

## Held POST qualification

`relay-attachment-http-cancellation-browser.test.js` uses a controllable loopback
HTTP server with the actual Worker/SQLite fixture. It holds requests before
admission or responses after persistence, drops connections, and truncates
response bodies. Browser Network cancellation evidence and server socket closure
must identify the exact POST; the shared GET-only CDP guard is unchanged.

Seven cases cover staged discard plus a late response, pre-admission cancellation
and orphan expiry, revocation/session loss, channel isolation, uncertain upload
and message outcomes, immutable retries/repeated submission, late accepted
responses after logout, and the pinned browser's automatic POST replay. Orphan
expiry advances the fixture clock; it is not a real 24-hour endurance test.

The loopback proxy rewrites only the served API origin and maps local requests to
the approved synthetic origin before invoking the Worker. It does not qualify
production CORS/TLS, physical Android, real owner messages or live connector
behavior. No message acceptance is fabricated. The initial seven-case run passed
against e3f4c1a only with the previously disclosed capability/BLOB diagnostic
adapters. Those adapters are absent from the committed harness. The first clean run with corrected PR108 e8f9e2b and frontend8dea17b
passed all24 focused attachment checks with no skips or adapters. Full combined
release qualification and independent review remain required before promotion.
