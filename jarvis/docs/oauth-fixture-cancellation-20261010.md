# OAuth browser fixture cancellation lifecycle

Hosted run 38079663508 failed at the strict fixture-error assertion after the
same-origin CSRF mismatch case. Production OAuth assertions had completed, but
`Fetch.fulfillRequest` reported `Invalid InterceptionId`. The hosted log did not
retain the failed request identity; attribution of that specific occurrence to
the reproduced race remains an inference.

A diagnostic 100ms delay of allowed favicon responses reproduced that exact
error. Every recorded failure was an allowed GET `/favicon.ico`, resource type
`Other`, after its main document had been replaced. The same-origin CSRF case
also emitted `Network.loadingFailed` with `canceled: true` / `net::ERR_ABORTED`
for the same network ID. Cross-origin navigation can replace the renderer before
that Network event is delivered, so document generation is also tracked.

The fixture now separately accounts for that exact obsolete favicon fulfillment
only when cancellation or document replacement is observed. Unknown origins,
other resource types/methods, different protocol errors, and journey requests
still reach the existing strict error gate. Browser and workerd egress guards,
production CSP, Origin, cookie and OAuth assertions are unchanged.

The CSRF test deliberately holds the real error-page favicon until navigation
commits, then releases its obsolete response and verifies the cancellation was
accounted for once. It still proves that valid approval succeeds after invalid
CSRF. A converse browser case cancels a held document and asserts that teardown
rejects its `Invalid InterceptionId`; this is not a blanket protocol-error ignore.

With the new cancellation accounting disabled, the deterministic CSRF case
fails at the original teardown assertion (10 pass, 2 failed including parent).
The candidate suite passes 12/12 under Node 22.23.3 and official Chrome for
Testing 154.0.8037.97. Diagnostic logs contain only fictional fixture hosts and
request IDs, no live account/session values. No runtime application code changes.
