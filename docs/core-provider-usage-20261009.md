# One bounded provider usage diagnosis

This separate creation-only workflow observes existing provider metadata and the
current UTC day's account-wide reported usage. It preserves the release pin,
all 11 release recipes and all three original Astra observer files. It cannot
deploy or promote CORE, invoke an object, initialize storage, read SQL, add a
credential/grant or alter provider state. Root controls the single creation push
after independent exact-head review; ordinary updates and reruns skip the read.

Only the final read step receives the existing deployment token/account secret.
Git checks and unit validation precede that exposure. The CLI removes both
environment entries before Git subprocesses. No installation or subprocess
runs with provider authentication. There are at most three fixed GETs:

1. `jarvis-hub-api` settings: exactly one validated `HUBS` / `Hub` binding;
   foreign script/environment or supplied dispatch namespace refuses it.
2. One namespace metadata page, page 1/per_page 100, matched to that exact binding.
   It establishes only the reported SQLite/legacy-KV backend. A missing target
   remains unknown. Its refusal may preserve the binding and continue the
   independent account billing fact, without retrying the namespace endpoint.
3. V2 usage for `from=D&to=D`, with D captured from the current UTC day.

A binding failure stops further reads. The total deadline of 30 seconds includes projection
and sealing, with monotonic checks after crypto before success. Each response
is capped at 256 KiB of decoded data/1024 nonempty chunks; accepted aggregate data is
capped at 768 KiB. A bytes/chunks limit ends all provider egress and seals available
facts. No redirects, retries, date-range expansion, product/cost query, fallback
endpoint or caller target is accepted. HTTP 429 ends all further provider
egress while preserving sealed facts; namespace 401/403 permits only the
independent account billing read. Midnight rollover or timeout prevents a
success envelope. HTTP denials and malformed/error responses yield closed
private per-fact classifications.

The complete billing result must contain at most 16 records. Every record must
match the sealed account and exactly the current UTC day's inclusive start and
exclusive next-midnight end. Only opaque metric ID (at most 64 characters), unit
(at most 24 characters) and finite nonnegative raw quantity at most
`Number.MAX_SAFE_INTEGER` survive projection. Fractional values remain opaque.
Missing quantities/accounts, corrections, duplicate metricIDs and limits refuse
the whole usage fact; no truncation, mapping guess, arithmetic or zero filling.
Empty usage remains unknown. Names, descriptions, costs, subscriptions, zones,
tags, product fields and account/namespace/object IDs are discarded.

Billing is Alpha Restricted and documents no current-day completeness watermark
or DO metric identity enum. Namespace metadata contains no object bytes/catalog.
Data Studio sends deployed-object requests and is excluded. Plan, quota,
completeness, metric semantics, catalog, object storage and retained bounds remain
explicitly unknown. A reported daily quantity is a temporary diagnostic, not a
migration-admission bound. Primary documentation: Cloudflare API Billing Usage
`/methods/get/`, Durable Objects Namespace List, Durable Objects Data Studio,
pricing/limits, GraphQL sampling/introspection, and Node22 Crypto. Linked primary
references are in the external review contract; no private result is committed.

The pinned RSA 4096 recipient public key has SPKI SHA256
`90139e1eb2462f9ccdab4adc70b6bcf79debd7ecca058ede857c6c613aeddda8`.
The recipient private key stays outside repositories and CI and is never a
provider/authentication credential. A fresh AES 256 key and 12-byte nonce encrypt
a 4096-byte zero-padded frame with GCM/full 16-byte tag; RSA-OAEP uses explicit SHA256
and a fixed label. AAD binds repository, reviewed HEAD, runID, attempt, job, day,
recipient fingerprint and fixed request-contract hash. Public read output is
only `observation_sealed` and one ciphertext envelope capped at 8192 bytes, or a
sanitized overall refusal. No raw provider result/error is logged, uploaded,
cached, put in a summary/output or written to an artifact.

Encryption alone does not authenticate the sender. Before decoding, root must
independently verify the exact GitHub run/job/step, successful prerequisite,
reviewed workflow/code HEAD, creation event, original actor/triggering actor and
attempt 1, then retrieve that exact job's logs. Build the external expected
context from those authoritative facts, never from the envelope itself. Reject
additional/duplicate envelopes or replay from another run/job/day/recipient.

The local command is `node scripts/core-provider-usage.mjs decode ENVELOPE
EXPECTED_CONTEXT PRIVATE_KEY NEW_EVIDENCE`. It is forbidden in CI or with provider
authentication present. Expected context and private key must be regular 0600
files outside Git; no task private key is read during tests/review. Root supplies
the independently verified context; the decoder cannot authenticate a caller's
handwritten context. It requires the pinned recipient, authenticates GCM before
accepting plaintext, validates the complete closed projection, and atomically
creates new 0600 evidence under a private directory outside Git without overwrite
or plaintext stdout. It prints only `decode_verified` or a sanitized refusal.

Local fixtures use generated fictional keys and a permanently closed fetch
boundary. No provider request or real credential/private-key read is needed for
Node 22/24 tests, build or review. Existing action-time release qualification and
owner approval gates continue unchanged.
