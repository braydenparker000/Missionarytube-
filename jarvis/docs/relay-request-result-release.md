# Ordinary Relay request-to-result release

This is the bounded communication release on the existing infrastructure. Its
base is merged release `faf74fc38bdb9522c622430b133116f7407be444`, whose tree is
exactly the verified live source `c85a42d2bea5d12d576ac84080660a34f11732c4`.
Deployment recovery baseline is `4c18a226e10968437941d82b77c3c09383815898`,
production run `37940431555/1`. The 12 Relay backend and 10 conversation asset
blobs come from reviewed source main
`ed7bbd436689be3ac9cca1ab5f111341dd690b80`; relevant assertions and the additional
complete request-to-result regressions accompany those exact production bytes.

## Resulting behavior

An already answered public request can receive a later final, artifact revision
or correction. The accepted chat reply remains immutable. Separate append-only
reports retain their event/request/attempt identities, payload retry checks,
version conflicts, provenance, server sequence and times. Exact-result and
change-cursor readers consume every page and recover after partial reads or
rate limits. The existing conversation style presents those reports and links,
including after visibility changes and reload.

The independently validated numeric-comment import hint can avoid the existing
read-triggered delay within its fixed GitHub issue/author/schema and shared
abuse/egress limits. Original reads and reconciler remain the fallback. Actual
MCP exact-result/change readers reconcile lost hints themselves; the existing
Hub alarm also recovers publications without a browser. New public-result
notifications are separate from user-message execution notifications, preventing
progress/reply wake loops and repeated execution.

Public reports identify submitted claims, never authenticated private work.
Public text, destination prefixes and artifact links cannot create a grant or
forward private content. Private typed tools retain the existing live grant,
matching claimed run, immutable reply and explicit completion/result version.
The private change feed shows later corrections without replaying the request.
No credentials, auth grants, subscription, schedule or spending configuration is
changed. No live Muse activation/trial, private synthetic session or direct-push
capability is introduced or claimed.

## Scope separation

Poweramp, Astra, MyMedia and Podcasts remain byte-identical to the live base.
The existing draft safety fixes remain intact. No page layout or design system
is introduced. Only the required conversation behavior changes.

The separate account-admission, native paid-dispatch, profile-pricing and
preflight architecture is not present in this branch's production tree or
Worker import graph. Its large modeled prices, initial-only evidence lifetime,
finite ledger and trusted upstream proof gate activation of that optional
subsystem. They do not gate this ordinary release, which uses the existing
Worker/Hub dispatch, storage, authentication and callback transport.

## Qualification and promotion

All original live-base test files remain; relevant CORE fixtures retain their
assertions while recognizing the new cursor transport. Every test in this
branch's complete inventory and all eight original qualification components
remain required, including both Node runtimes, mandatory browser coverage and
the complete serial performance plan. Fictional closed-egress integration tests
exercise hidden final artifacts, retries, out-of-order/concurrent corrections,
full pagination, partial/rate-limited reads, provenance forgery, private grants,
visibility, drafts and reload. Fixture timing does not promise live host latency.

Promotion needs exact-head hosted CI, a corresponding independently reviewed
deployment pin, normal fresh Worker qualification and actual new backend/config
identity, existing namespace/schema compatibility and complete backup/restore
checks. The new public-coordination and public-reader-cache modules must be
staged and hash/MIME verified before their importer scripts. Existing release
refusal diagnostics and per-action gates remain. A successful old Worker reuse
receipt cannot qualify these changed backend bytes.

Independent parent review is required before merge or deployment. No live host
execution capability is inferred from fixtures or callback acknowledgements.
