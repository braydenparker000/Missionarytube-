# Chat and Tasks in Relay and Muse

The owner-approved simplification keeps the existing Relay/Muse shell, Manrope,
black and charcoal surfaces, blue bubbles, composers and authenticated channels.
Chat remains the starting point. Tasks has only In progress and History; a task
opens its description, latest saved result, brief updates and View conversation.
Manual task/project/goal forms, status filters and execution-management controls
are removed from these views. Backend authorization and lifecycle rules remain.

Relay's existing `relay_owner_job_plan` classifies a verified original message as
work. Questions without a saved plan/claim stay ordinary chat. The frontend does
not guess intent with keyword matching or create simulated tasks/replies. Muse's
existing authenticated `POST /relay/mast/work/plan` can similarly organize an
existing owner–Mast chat message, retaining its UUID/body/device and creating no
execution claim. This remains behind the unchanged separate Mast Work gate.
When that gate is closed, the private Muse Tasks view explains that it is not
connected. No flag, token, OAuth scope, schedule or host launcher is introduced.
An already-running Mast session still has to read, classify and respond; browser
navigation and HTTP acceptance never establish that it started execution.

Relay appended text/file deliveries now join the chronological chat through
authenticated `GET /relay/owner/updates?after=SEQUENCE`. This is a bounded,
creation-order feed of the existing immutable later deliveries (50/page), with
its own private in-memory cursor. Every delivery is joined to its verified owner
original before metadata is returned. The normal message/reply cursor and reply
slot stay separate. Retries cannot replace accepted deliveries or result history.
The phone session advertises `inline_updates_enabled`; older service versions
retain the existing explicit-delivery panel until paired deployment.

Images load inline only as they become visible in the authenticated private
conversation. Existing download, MIME/hash verification, preview disposal and
revocation cleanup remain. PDF/text files remain downloads. Appended files are
not hidden behind a per-original disclosure. All attachment quota, retention,
staging and expiry rules stay unchanged. Public Relay/Muse and the Lucy–Muse
agent channel receive no private data or automatic forwarding.

Task states derive from actual saved plans, current claims and version-bound
completion reports. Unknown/expired execution and unconfirmed completion remain
visible as such. A newer correction does not inherit an older completion report.
Tasks and details own only transient navigation state; private bodies are never
stored in browser history. Back, reload, uncertain-send retries and independent
private/public drafts keep their existing protections.

The browser cases for retired manual request management are replaced by the
approved natural-chat/Tasks flows. Required backend tests still cover all claim,
cancellation, retry, duplicate, authorization and result-version invariants.
Rendered fixtures use synthetic identities/messages/files and the repository's
checksum-pinned Chrome. They do not launch live agents or activate Work.
