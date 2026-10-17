# Relay and Muse adversarial QA

The independent QA fixtures use the real Worker routes, SQLite implementation,
OAuth registry and owner controller. Every account, credential, request, reply and
correction is fictional and ephemeral. Browser contexts are offline; CDP forwards
only approved fixture requests with the browser's original Azure Origin and
CORS behavior. Unexpected egress, browser exceptions and origin failures fail the
checks. No production message is sent or replayed.

The approved toolchain is Node 22.23.3 or 24.21.0 and Google Chrome for Testing
154.0.8037.97. The browser helper checks both identities and does not substitute
another browser or change security settings. Release qualification requires the
browser and includes every `tests/relay-*.test.js` file automatically.

## Reply availability and explicit completion correction

The 2026-10-08 correction separates immutable reply availability from work
completion. The exact released `e63fa716cf3e90522b6d6b1f1bcf36e67a67d186`
archive falsely reports an acknowledgement, a blocker and a report as completed.
The new independent semantic suite records 44 expected failures and 15 passing
controls on that archive. Its corrected run passes 66/66 on both Node 22.23.3 and
24.21.0, with zero failures, cancellations or skips. Seven corruption subtests
require a valid typed completion setup absent from the old implementation;
the literal baseline therefore counts 59 tests rather than 66.

The final mandatory Relay inventory passes **884/884**, with zero failures,
cancellations or skips, on Node 24.21.0 and Chrome 154.0.8037.97 in 57.612 seconds.
The Worker also bundles successfully with the locked esbuild dependency.
The final focused UI/browser run passes 60/60, with a subsequent strict
event/reply-ID identity check passing after the last guard was added. These
fixture checks establish local behavior; published-head CI is the separate
qualification proof.

Tests cover unchanged replies and journals during legacy reads, typed waiting
and failure after reply arrival, concurrent responders, active-claim retry
denial, revoked/public authorization, lost and conflicting event responses,
result-version races and corrections. Only a live authorized grant with an
actual matching recorded claim can report completion, bound to the exact saved
reply and current version. An expired execution lease may record that terminal
known outcome under its original still-live grant/run; it cannot renew or
reclaim execution. Failed or cancelled jobs cannot later complete. A pending
cancellation remains visible even when the owning execution reports completed
work. Body wording is never parsed into stage or permission.

The [correction evidence manifest](conversation-evidence/owner-completion-manifest.json)
records frozen source/log hashes and three fictional phone captures. The
390×520 inspector scrolls without horizontal overflow; these captures do not
prove physical phone keyboard behavior or live optional-tool discovery.
Existing plain reply clients remain usable, with completion unverified until a
supported host can call the explicit progress tool. No authentication, scope,
credential, callback or responder schedule is changed.

| QA deliverable | Behavior exercised |
| --- | --- |
| `tests/relay-conversation-adversarial-browser.test.js` | Scope switches, expiry, reload, late responses, separate drafts, Back, keyboard, reading anchors, inert attacker text, save uncertainty, actual cancellation acknowledgement, callback versus linked retry, corrected private results and offline execution evidence. |
| `tests/relay-owner-jobs-adversarial.test.js` | Public/Muse authority denial, grant-bound execution, duplicate callbacks and events, expiry, cancellation, duplicate-risk retry limits, racing attempts and immutable public publication. |
| `tests/relay-owner-completion-semantics.test.js` | Baseline-failing reply/completion distinction, typed grant/run and exact result/version association, unchanged legacy reads, competing writers, cancellation/retry safety, replay and malformed durable evidence. |
| `tests/relay-owner-jobs-ui-adversarial.test.js` | Strict private provenance, bounded associated correction history, stale-response rejection, retained send UUIDs, mutable job refresh, network failures and local validation. |
| `tests/relay-public-delivery-adversarial-browser.test.js` | Held initial reads, lost accepted/unreceived POST receipts, rejection, stale paginated history, more than 250 online rows, exact UUID collisions, independent tabs, blocked draft storage and partial enqueue recovery. |
| `tests/relay-public-store-adversarial.test.js` | Full board history across tab writes, failed independent draft persistence, a deterministic 49-to-51 queue admission race and exact-acceptance journal draining. |
| `tests/launcher-browser.test.js` | Existing launcher content, identity, schema, draft, Back and isolation journeys; exact receipts/journals, unchanged malformed storage, all mutating API calls, and nonempty old-inbox fixtures proving no automatic publication after restore/reload/refresh. |
| `tests/relay-public-legacy-history.test.js` | Older local history retention, bounded accepted caching, exact receipt association, old flags without publication authority, and read-only mismatch preflight before any journal/draft/aggregate write. |
| `tests/relay-public-legacy-acceptance.test.js` | Inherited saved flags, truncated old-history recovery, exact tuple-bound receipt evidence, mixed genuine/current queues, receipt retention beyond 250 old rows, same-UUID queue overlaps, and raw/cache/queue conflict preflight with zero persistence writes. |
| `tests/relay-public-legacy-acceptance-browser.test.js` | Actual offline/online/reload journeys for inherited flags and 301 old rows, genuine paginated shared receipts, stale reads, linked reply identity, same-UUID queue/journal overlap until exact receipts, all API mutations, and initial conflict before any public storage write. |
| `tests/helpers/relay-conversation-browser-fixture.js` | Qualified browser, real authenticated routes, fail-closed CDP routing, held/aborted requests, storage inspection and synthetic evidence capture. |
| `tests/helpers/relay-conversation-evidence.mjs` | Reproducible baseline/current owner, public and Muse captures at four viewport sizes. |

Existing owner UI and browser assertions retain authentication and private-content
persistence requirements while allowing only the exact safe `owner`/`public`
scope preference. Page-only access, expiry and disconnect stay in the private
sign-in-required view until an explicit Public chat choice. The password-browser
CDP helper ignores an invalid interception only when that exact Network request
was proven cancelled, or the page is explicitly closing. Other fulfillment,
Origin and security errors remain fatal.

The visual matrix covers 360×800, 390×844, 412×915 and 1280×900. Captures record
viewport width, document width and visible control geometry. Main controls meet
48×48px targets, and the inspected views have no horizontal overflow. Short-height
checks reduce the viewport by 320px and confirm the composer remains visible;
they model available space and do not establish physical phone keyboard behavior.
Enter inserts a newline and Ctrl+Enter sends one request. Private reading anchors
are memory-only and remain stable across in-page scope changes and new progress.
An open long inspector keeps disclosure state and its visible text through an
actual authenticated lifecycle or correction update.

The initial slow-read regression reproduces the reported missing Muse/Relay send
using fictional text: queue a request during a held initial GET, then release the
old snapshot. The prior implementation loses the visible row and queued body
without a POST. The fixed path must retain the original UUID and payload until an
exact accepted entry proves acceptance. Pending-queue absence alone is never used
as proof. Public and Muse fixtures also preserve accepted immutable entries when
a later paginated response is stale.

Corrections retain the original accepted private chat reply and original job
result. The latest correction has an exact original-reply association, distinct
record ID, bounded ordered history, explanation and authenticated private
provenance. Tests reject malformed or forged projections and verify inert unsafe
links/text. Authentication identifies the publisher; the UI does not claim that
it verifies the correction's factual content. A public Muse correction using the
same reply target cannot replace the first accepted public reply or finalize a
private job.

An offline private refresh displays retained evidence as Last known. A locally
elapsed execution window becomes acknowledgement expired with outcome unconfirmed;
it does not mutate the server stage or create retry permission. A callback receipt
cannot establish execution or acknowledge cancellation. Cancellation remains
requested until the matching authenticated assistant acknowledgement. Retrying
delivery keeps the request UUID, while an allowed work retry creates one distinct
linked child and preserves duplicate-risk restrictions.

The preceding queue-overlap release validation passed **805/805 tests**, with no failures, cancellations or
skips, using Node 24.21.0 and Chrome 154.0.8037.97. This includes the existing
owner/password browser journeys and all final recovery/security regressions,
including the inherited-acceptance correction, same-UUID queue overlap and
raw/cache/queue conflict guards.
The five new QA test files contribute 38 top-level cases and 62 counted tests,
including each Relay/Muse child journey. Eight further legacy-history cases are
included automatically. The two additional legacy-acceptance files contribute
20 top-level cases and 40 counted tests. The focused acceptance/browser run passed
**40/40** using Node 24.21.0 and Chrome 154.0.8037.97. A subsequent **10/10** unit run
added full queued-role and normalized reply-target checks; all are included in
the final 805-test mandatory run. The preceding combined public/store/Muse/shared
and complete launcher suites passed **89/89**, including **12/12 launcher tests**,
using Node 22.23.3 and the same Chrome 154 binary before this narrow queue-overlap
follow-up. The full mandatory Relay command was:

```sh
REQUIRE_RELAY_OWNER_BROWSER=1 JARVIS_CHROME="$QUALIFIED_CHROME" \
CHROMIUM_PATH="$QUALIFIED_CHROME" PLAYWRIGHT_CHROMIUM_EXECUTABLE="$QUALIFIED_CHROME" \
"$QUALIFIED_NODE" tests/helpers/ci-test-inventory.mjs run relay --require-browser
```

The final logs are `relay-legacy-queue-overlap-final-node24.tap`,
`legacy-queue-overlap-focused-node24.tap` and `legacy-queue-overlap-tuples-node24.tap`
in the synthetic evidence directory `/tmp/jarvis-relay-qa`.
The latest `qa-legacy-queue-overlap-manifest.json` records
toolchain identity,
source and artifact SHA256 hashes, viewport geometry and the separate earlier
failing baseline proofs. All 313 recorded implementation/test/toolchain source
files remained unchanged during and after the final run. This establishes the
tested working-tree content; the release owner's committed-head qualification
remains the publication proof. The earlier 738/738, 757/757, 764/764, 765/765 and 783/783
local Relay proofs predate the queue-overlap follow-up and are superseded.
The prior release owner's Node 22 lane reported 764 passes and one duplicate-test
skip, with that case covered by its Node 24 owner lane at 765 passes and zero skips;
that release evidence is separate from this final 805/805 local run.

Final recovery checks prove that a durable journal followed by a failed per-tab
draft clear is recovered under its original UUID without offering that submitted
intent for another Send. A separately edited draft survives. A permanent pending
UUID conflict retains its original unsaved payload and visible attention state
while a different intent is accepted once. Previously accepted immutable-content
divergence still fails closed. Synthetic credential-bearing HTTP(S) links in
saved private results and corrections retain their text without becoming anchors.

Exact-head frontend qualification exposed two launcher fixture selectors matching
both the persistent sync error and its toast. The adapter now targets the
persistent status, returns the actual immutable `{entry}` save receipt, and keeps
the full content-state comparison while checking the additive composer UUID and
complete original pending journal. Existing content, author, identity, schema,
draft, Back, channel and unrelated-storage assertions remain intact.

The subsequent unchanged legacy assertion exposed a product regression: an older
local message without a cloud-accepted flag or queued send disappeared on restore.
The fix keeps that original ID/body readable and explicitly local through reload,
empty complete reads and another tab's updates. It does not allocate a new UUID,
create a journal or assert cloud acceptance. The original legacy store remains
unchanged, and malformed storage still displays a retention error without being
overwritten. Exact matching UUID, role and body evidence is required for a local
copy to become accepted.

Independent review also reproduced a mismatch in the known accepted-cache path:
another tab's accepted row with the same UUID and different body could replace the
local copy before the association guard ran. Both `external()` and `commit()` now
fail closed. External updates run read-only association preflight before migrating
an independent incoming queue to journals; the focused regression checks zero
draft, journal and aggregate writes on mismatch. The original current text remains
available and unaccepted in the open page. Because another tab may already have
overwritten the aggregate, the warning asks the reader to keep the page open and
copy the text before reload; it does not promise recovery after reload.

Ordinary sync no longer invokes old-inbox migration. The explicit recovery API and
original old-store bytes remain intact. Old sending/outbox flags and a cached
`legacyPending: true` do not authorize a new shared-public send. The launcher
fixture includes a nonempty archived remote user that an accidental import would
publish. Both a newly recovered old key and a cached public state preserve the
exact local history/draft, remain unaccepted, and make zero mutating API calls
through offline load, reload and a complete online shared GET. No old `/v1` or
migration route is invoked. Existing explicit public version-1 queued UUIDs still
send normally. The fixture records every API mutation, rather than checking only
the message endpoint, and retains every original content/privacy/schema assertion.
The latest manifest records these proofs and all final source hashes.

The inherited-acceptance baseline uses the exact pre-correction `dd188551` public
assets. Cached public version-1 rows with `saved: true` inherited from an old inbox
showed Awaiting reply after an empty actual shared GET. Both `legacyPending: true`
and an already normalized false flag reproduced the defect when the original
old-store bytes remained. With 301 old rows, the first commit serialized 250 and
reload hid the oldest 51 even though the original raw history survived. The
baseline observations record offline load, offline reload, fresh empty shared
read and online reload, with zero mutating API calls and an unchanged draft/raw
store. Desired-behavior regressions fail against those frozen assets.

The correction classifies positively associated old tuples before persistence,
recovers missing raw rows even from a previously truncated cache, and labels
unconfirmed text Local history · on this device. A shared receipt creates
`sharedAcceptance` evidence bound to version, UUID, role, exact body and reply
target. Cache-only merges preserve valid evidence; old raw fields and global sync
timestamps cannot create it. The marker is cached receipt evidence, never
permission or authorization. Legacy-associated history and its genuine receipt
evidence stay outside the ordinary 250-row accepted-cache limit. The tests prove
301 subsequently confirmed old rows remain accepted through stale empty reads
and offline reload, with unchanged IDs/bodies and retained original raw bytes.
Unrelated genuine public rows and existing explicit public queues retain their
separate behavior. An old flag does not queue or publish text; the one current
public queue fixture sends only its original UUID/body once. All local-only
restoration variants record zero mutating API calls, including migration routes.

Initial restore also checks raw and cached rows sharing a UUID but differing in
body, role or reply target, including a genuinely tuple-marked cached row. It
fails before journal migration, tab-draft writes or aggregate writes and keeps
both old/shared stores byte-identical, with the independent queue intact. The
browser instruments persistence after fixture seeding and confirms the accurate
initial-load retention error without an API mutation. This differs from the
already-open-page tab conflict: no overwritten aggregate or copy-visible-text
claim is made during initial restore. If the old raw store, migration flag and
per-row evidence are all absent, past row authority cannot be reconstructed from
a timestamp or global mode; the code does not guess it.

The queue-overlap follow-up uses the exact released `e4c72ca` assets as a separate
failing baseline. An old `saved: true` row and an explicit current public outbox
with the same UUID/body could cause restore to consume the intent without a
shared receipt or remote write. The new cases cover both migration-flag values
and aggregate-only, existing-journal-only and combined queues. They preserve the
original UUID/body, journal and separate draft through offline load/reload and
a complete empty actual shared GET. A held POST proves the intent remains
unconfirmed until its exact receipt; releasing it accepts that UUID once. A
genuine prior actual shared GET receipt can instead finish a redundant queue
without another POST, including stale-read and reload controls.

Same-ID queued body, role or reply-target conflicts with legacy-associated history
fail before restore migration, commit or external writes. An absent queued reply
target is normalized to null and cannot inherit a different target from history.
Proved and unproved aggregate/journal fixtures retain raw history, genuine receipt
evidence, queued text and tab drafts byte-for-byte, with zero persistence or API
mutations. The released-asset run records 28 passing controls and 12 expected
counted failures; the corrected mandatory run retains every prior assertion.

Synthetic screenshots and fixture results do not establish live assistant tool
availability, production deployment, physical phone keyboard behavior or
owner-phone acceptance. No product failure remains in the final qualified Relay
or combined public/launcher fixture runs. The release owner's separate broader
non-Relay local run recorded 1034 passes and two counted failures from one existing
My Media remote-cover child and its parent aggregate. The real cover host was
blocked: Chrome reported `net::ERR_TUNNEL_CONNECTION_FAILED`, and TLS-verified
curl received proxy CONNECT 403 with no image bytes. That test remains unchanged;
committed-head CI in its independent environment remains the broader release proof.
