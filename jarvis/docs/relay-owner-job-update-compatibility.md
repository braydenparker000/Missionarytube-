# Private job update discovery compatibility

`relay_owner_job_update` now advertises one flat input object. Common fields
must remain visible alongside the stage-specific fields. Runtime admission,
owner OAuth, grant/run ownership, leases, reply/version association,
idempotency and cancellation checks are unchanged.

## Observed defect and limits of the diagnosis

The observed host declaration reduced the previous root-plus-`oneOf` schema
to these branches, omitting the common root properties:

```ts
{stage?: 'running'}
| {stage?: 'waiting_for_owner' | 'failed'}
| {outcome: 'known', stage?: 'completed'}
| {outcome: 'not_started' | 'known', stage?: 'cancelled'}
```

This is an incomplete callable declaration. The application's catalog still
contained the common root properties and required fields. No application
handler converts the arguments through those schema branches.

Safe live probes used an explicitly fictional, nonexistent target after a
read confirmed `Original private request not found` with status 404. Full
`running` and `completed` objects sent through the code-mode nested-tool
path reached that same missing-target check, with no private request to
modify. A stage-only object returned the exact plain `Invalid arguments`
error. These observations do **not** reproduce rejection of a full valid
live request, prove that every host path drops fields, or verify the proposed
flat catalog on a deployed host.

The reported failed calls contained the proper common argument keys and
types, without null, undefined or extra keys. They returned `Invalid
arguments`, JSON-RPC code -32602, without an error data/status value.
The cause of those particular rejections remains unproven. Host schema
conversion or validation is a candidate explanation, not an established
trace of the submitted request.

The unchanged application distinguishes these failure paths:

| Condition | JSON-RPC error | Error data |
| --- | --- | --- |
| Missing common field, unknown field or non-object arguments | `Invalid arguments`, -32602 | None |
| Valid input targeting no private original request | `Original private request not found`, -32602 | `status: 404` |
| Wrong execution run or different live owner grant | `Matching authenticated execution lease required`, -32602 | `status: 409` |
| Wrong accepted reply or stale result version | Specific association/version conflict, -32602 | `status: 409` |

The new HTTP/SQLite fixture test verifies the first three error shapes,
including both running and completion grant/run mismatches. Lease and
claim-journal checks cannot be bypassed by flattening discovery.

## Flat contract and conditional server checks

Every invocation requires `inbox_id`, `job_id`, `event_id` and `stage`.
The inbox is the existing private owner inbox; IDs retain UUID validation.
Unrecognized fields are rejected. The stage enum remains `running`,
`waiting_for_owner`, `completed`, `failed` or `cancelled`.

Conditional fields are described at the flat root and enforced by
`relayOwnerJobValidateRpc` and `relayOwnerJobRpc`:

| Stage | Required conditional fields | Restrictions |
| --- | --- | --- |
| `running` | `run_id` | Summary optional; outcome and reply/version fields forbidden. Requires the matching live lease, current grant and genuine claim; cannot renew after reply availability or cancellation request. |
| `waiting_for_owner`, `failed` | `run_id`, nonblank `summary`, `outcome` | Outcome may be `not_started`, `known` or `unknown`; reply/version fields forbidden. Existing current-claim and no-resumption rules remain. |
| `completed` | `run_id`, nonblank `summary`, `outcome: known`, `expected_reply_id`, `expected_version` | Requires the exact accepted immutable reply, current result version 1–5 and the actual owning grant/run claim. Terminal reconciliation may outlive the execution lease while owner OAuth remains live. |
| `cancelled` | Nonblank `summary`, `outcome`; `run_id` for a claimed execution | Requires an actual owner cancellation request and stopped execution. Outcome must be `known` or `not_started`; reply/version fields forbidden. Claimed cancellation retains grant/run ownership checks. |

Exact event retries return the original result without renewing the lease or
duplicating durable evidence. Changed event payloads, targets or writers
conflict. Existing consequential-action retry and attempt limits remain.

## Verification and remaining live acceptance

All test requests, grants, claims, results and replies are synthetic. They
traverse the actual MCP HTTP endpoint and SQLite transactions with external
access blocked; no production private identifiers or content are fixtures.

- On unchanged source `8fb73ad`, the new 41-case contract suite passes 40
  cases and fails only the flat-discovery assertion. Full valid updates,
  completion and server rejection checks already work on that source.
- With the schema change, Node 22.23.3 passes all 41 cases with zero skips.
- Node 24.21.0 passes all 145 contract, completion, correction, lifecycle and
  adversarial cases with zero skips.
- The change touches the update tool's input catalog, this regression test
  and this document. It does not change authentication, transport, storage,
  event responders, schedules or public Muse/importer behavior.

After independent review and deployment, confirm that fresh host discovery
includes all nine properties and the four common required fields. The
original execution owner must then use its genuine existing grant/run and
read the durable job to verify an accepted progress event and explicit
completion association. This child task has not written those live events.
Until that succeeds, real job-update callability remains unverified and a
saved reply continues to mean result available with completion unverified.
