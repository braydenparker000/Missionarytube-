# Relay navigation and attachment frontend

This records the independently qualified PR109 navigation checkpoint. For the
subsequent gated transport integration, see [private attachment frontend](relay-private-attachment-frontend.md).

The hamburger opens a left-side navigation panel. Chats keeps the Private/Public
switch in navigation, including the current channel. The redundant top dropdown
is removed. Settings and action sheets retain their own layouts. Existing menu
history ownership remains responsible for Back, Forward, Escape, close and stale
history entries. Side navigation traps keyboard focus without changing other
modules' dialogs.

The composer plus now opens an image/file picker, not navigation. Files and image
previews stay in memory, scoped to the authenticated private
conversation. Public chat remains text-only and hides the attachment control. They are not persisted in browser storage. Removing a file or
losing owner access discards its local state; late preview and chooser results
cannot cross a channel/authentication boundary. SVG and HTML are never rendered
as file previews. Names are inert text. The local preview budget is four files,
1 MiB each, matching the PR108 contract. PNG/JPEG/WebP, PDF, plain text,
Markdown, CSV and JSON are allowed; other MIME types are rejected locally.
The backend remains authoritative for signatures, filenames, quotas and access.

## Explicit delivery gate

Backend PR108 defines the private staging/message/content API. No actual upload
transport is configured, no capability is claimed, and selecting files creates
no server requests. The picker says sending attachments is unavailable. Text
submission with selected files is blocked rather than silently dropping them;
removing files restores the unchanged text-only send path.

The isolated draft model has fixture-tested uploading/error/cancel/retry states.
Only an injected upload transport's actual receipt may produce its ready state;
progress alone cannot. Ready means uploaded, not message accepted. Production UI
never invokes this unbound adapter, and does not show invented upload progress.

## Integration with backend PR108

Before binding transport, independently qualify the backend and agree an explicit
capability discovery field. Follow PR108 exactly: reserve the message UUID before
staging, send ordered attachment IDs with immutable message retries, use bearer
fetches for linked content, and discard staged uploads on removal. The current
contract does not provide a capability flag, and authentication alone is not one. Do not guess public visibility or
turn an owner-session body claim into authorization. No new credentials, scopes,
schedules or paid services are introduced by this frontend.

Full end-to-end image/file chat is **not** delivered by this UI-only PR. Navigation
and the honest local picker can be reviewed independently while transport stays
gated. Integration must preserve text draft/retry identity and must qualify the
combined backend/frontend head before claiming attachment delivery works.

## Evidence

The eight screenshots under `evidence/relay-navigation-attachments-20261010`
compare actual baseline and candidate mobile/desktop UI, using only synthetic
fixture conversations and files. Base source is
`5caed720cf26328165f2985189236a6d607e0e61`; baseline screenshots were captured
on its navigation-identical predecessor `fb332e8`. Astra files are unchanged. Browser checks use pinned Node22.23.3 and
Chrome for Testing154.0.8037.97. They cover keyboard focus, Back/Forward, normal
navigation, draft retention, safe filenames, previews/removal, unavailable send,
private/public isolation, owner access loss and delayed chooser results. Exact
hosted qualification results are recorded in the draft PR. Physical device and
real transport/responder attachment tests remain unrun.
