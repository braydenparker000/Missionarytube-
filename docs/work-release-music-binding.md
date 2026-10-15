# Work release preparation: preserve the existing music binding

This change is a pre-upload configuration guard, not a Work release or activation.
No source pins, credentials, resource bindings, schedules or permissions change.

## Release mapping observed on 2026-10-15

- Deployment PR base: `release/makima-control-20261013` at
  `9b6f72982ab688b5e40b441bec4c6475ef1d5354`. This retains the latest operational
  checkpoint without merging that branch into main.
- Deployment main: `62312796ed96a30a3ad366743cd4b319cea19385`.
- Live frontend is layered: base `363f710068bb6f2c456dbbf183f063484a36fe11`,
  chat/tasks PR145 patch `fed236966d928a4f8221474e502459e13e82e2a4`, then mobile
  file-save patch `d5428cae57e195405afbd140965f9fca16d65110`. Preserve the full
  receipt chain; none of these alone represents every deployed file.
- Backend source `099ec1a0b2b621a3799f4f8346490903f212a912`, recorded code SHA-256
  `e12a5f82dcf64ebf2e83840a72fbff86e8b172f67eada8032e7615b8d547cf70`.
- Active Worker version `f477e46b-7d17-436e-9b3f-16dadb6d6933` serves 100% traffic.
  The published Storage receipt still records `54544c04-10e7-4087-9edf-54fe55ea97e0`;
  [the later operational checkpoint](makima-resume-20261014.md) documents the
  settings-only Makima activation with unchanged code. The present audit read
  the active version and settings, not an independent code download/hash.
- Live `MUSIC_R2` is an `r2_bucket` binding to `jarvis-music`.
  `RELAY_MAST_ENABLED=true`; `RELAY_MAST_WORK_ENABLED` is absent (closed).
- Dormant source PR129 head `9d5cc68cade74580c1a06edd902d6b47b2bbcac0` is for
  adapter inspection only. Its raw Wrangler config omits R2 and is not a release
  candidate. Do not deploy or blanket merge that bundle.

Source evidence: [live receipt](https://missionarytube.z13.web.core.windows.net/release-qualified.json),
[frontend base](https://missionarytube.z13.web.core.windows.net/release.json),
and [enabled Worker inspection](https://github.com/braydenparker000/Missionarytube-/actions/runs/38576534092).

## Guard placement and limits

The deployed chat/tasks publication path is the `simple-chat-tasks` job in
`.github/workflows/deploy-azure-storage.yml`. Its `prepare` command uses
`preservedConfig` to generate `backend/wrangler.music.generated.json`, retaining
the designated R2 binding and clearing candidate variables. Its `checkpoint`
runs before `wrangler deploy` and records the effective config in the backend
digest. The new check compares that exact generated config with live settings
before allowing the checkpoint to be saved.

It requires exactly one existing `MUSIC_R2 → jarvis-music` binding and one matching
candidate R2 binding, including jurisdiction. It rejects absence, duplicates,
another bucket, additional R2 bindings, preview/remote overrides, alternate
environments, nonempty candidate vars and missing `keep_vars`. It reads no secret
values, adds nothing to either input and makes no network calls. A missing live
binding fails; this path cannot silently turn preservation into newly granted
access. Existing complete-binding and nonbinding-settings checks remain in place.

Historical source/version/receipt guards remain unchanged and should refuse the
current later deployment. This PR does not make that old publication runnable.
A future Work release must use a separately reviewed current source/receipt base,
include this effective-config check in its pre-upload checkpoint, and preserve
all live settings. Direct Wrangler invocation can bypass repository guards and
is not an approved Work release path. An API upload using `keep_bindings` needs
its own reviewed preservation check; this change does not alter the Makima helper.

## Host launcher contract still required

1. Exact supported command/API and schema that actually starts an executing
   agent, plus authenticated host-run identity/start evidence or lookup.
2. Existing separate owner–Muse binding; reviewed installed helper bytes and
   dependency identity. No credential values or new access are requested here.
3. Durable private journal and one-time dispatch keyed to the reserved request,
   run ID and payload digest; retries/restarts cannot create a second run.
4. Genuine progress from that execution, cancellation/status checks, an immutable
   result tied to the same run/reply/version, and explicit reconciliation of an
   ambiguous handoff without relaunching.
5. Owner-selected inert text-only request and precise approval for any Work gate
   activation and real round-trip. Attachments remain blocked; no scheduler or
   inbox responder changes are included.

Local validation: focused configuration/generator tests, full `npm test`, and
`npm run build` using the repository's unchanged pinned build source
`c28c1b2f70aabb5217b08bf31ffe4c93d0353765`. The build is a compatibility check,
not a proposed live artifact. Synthetic tests cannot establish host execution.
