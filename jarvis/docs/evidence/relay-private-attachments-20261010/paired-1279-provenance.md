# Clean paired Relay run (before multi-file race correction)

This is the actual complete TAP output from the clean paired run, not a reconstruction or a frontend-only result. It does **not** qualify the subsequent multi-file selection race correction.

- Frontend: `2e8a9dba4c8ea22d79bdc4520961129ebef290ad`
- Backend: `e8f9e2be23520f8eecaf31e65864f28da6214a2e`
- Navigation base: `f3bfaa88290b6a736b499c2aebe5390e98b64e66`
- Common release baseline: `5caed720cf26328165f2985189236a6d607e0e61`
- Local combined commit: `7be1bf282e7f2440178fcde9e64d23458d6a7d46`
- Combined Git tree: `e731b0a3d00261bdf2e2cc054c30c8825c41d253`
- Runtime: Node22.23.3, Chrome154.0.8037.97, Linux.
- Exact test command, from the combined repository root: `node --test tests/relay-*.test.js`
- Result: 1,279 passed, 0 failed, 0 cancelled, 0 skipped; duration190509.51478ms.

The combined checkout applied the frontend/navigation delta from the common baseline onto the formal backend head. Empty Git diffs verified that `backend` and `tests/relay-fixture.js` matched the backend head, and `public` matched the frontend head. No capability-enabling or BLOB diagnostic adapter was used. The disabled-service navigation scenario explicitly supplies false; delivery and HTTP cancellation tests require the actual backend true signal.

[Full TAP log](paired-1279.tap), SHA-256 `7652ca3be9227b016e32fd0e361890746d30663f232c14f925497af64ef35859`.

The log contains test labels, timing and synthetic fixture cost counters. Intentionally invalid synthetic URL userinfo in test labels was replaced by `[redacted-userinfo]`; no result, timing or test was removed. No credentials, private records or environment variable values are included. Loopback fixture tests do not establish production CORS/TLS, physical-device behavior or live connector consumption.
