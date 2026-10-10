# Dormant shared-project release

This candidate pins combined source PR118 `0a3bf1e124e2f8d1d8fb235e96060a10eb4c0a98` (tree `c54ea4ec2d135d3da5caa1545602657a0fc4115d`), containing the exact reviewed PR112 dormant inbox, PR115 playback reliability, PR116 cancelled-favicon fixture and PR117 stationary-release fixture deltas on the current released attachment/navigation source. No project access, callbacks or agent execution is activated.

## Release gate

The existing read-only Worker settings preflight and every live-identity calculation now require each of these names to be absent or an exact plain-text `false`:

- `RELAY_PROJECT_ENABLED`
- `RELAY_PROJECT_ADMIN_ENABLED`
- `RELAY_PROJECT_EVENTS_ENABLED`

Enabled values, unknown values/types, secret-backed flags and duplicate names fail closed. Missing/failed/malformed provider settings and missing expected HUBS identity are not absence proof. Inspection uses the existing fixed settings GET and sealed CI identity; it never writes variables, grants or credentials and never logs provider values. Source/generated Wrangler configuration adds none of these flags. Existing non-project variables and resource-preservation checks remain unchanged.

Because `keep_vars` preserves live values, source defaults alone cannot prove dormancy. The gate checks the actual provider settings before Worker publication, then again during record, verification and receipt. Later deliberate activation requires separately approved access and a separately reviewed release-mode change; do not silently weaken this gate or treat deployment as activation consent.

## Safe pause and rollback restriction

Keep this new Worker and all project flags off as the safe pause. Do not automatically redeploy an older Worker merely because a later project activation fails.

Before any older-code rollback, while the new Worker still enforces project authorization:

1. Unsubscribe only the project-specific callbacks through the supported, separately authorized control.
2. Independently verify zero project subscription rows, activation reservations and queued outbox rows.
3. Preserve the proof with the exact Worker/rollback identities and preserve unrelated subscriptions.
4. Only then consider older code. It does not understand project bindings or their revocation and can otherwise drain leftover callback rows under parent event authority.

This draft performs none of those control operations and asserts no live row inspection. Production flags remain closed. Project history must not be dropped. Backup artifacts remain available, but their existence is not authorization to bypass this rollback gate.

## Separate activation work

Lucy participation needs exact-current OAuth-family binding, finite project/logical-agent authority and connection-wide identity disclosure. Mast credentials/storage, project-event subscription/automation and actual two-way host execution require their own approval and qualification. No owner token export, grant, binding, subscription, hook installation, runtime flag write or schedule change is included here. Callback acceptance is not model wake or execution.

## Qualification

Existing hosted full deployment tests/build and all eight source components must qualify the final exact pair, followed by independent review. Poweramp UI and all eight existing frontend dependency seals are unchanged. PR113/114 attachment follow-ups are not included. PR115 changes transport recovery and MediaSession action registration without changing Poweramp UI. PR117 models setup release at rest using one original contact with a 100 ms stationary interval and a native >=80 ms assertion; measured rapid release/regrab, held-owner, pixel and performance gates remain intact. Physical headset/Android acceptance and historical hosted emulated-fling causality remain unverified.
