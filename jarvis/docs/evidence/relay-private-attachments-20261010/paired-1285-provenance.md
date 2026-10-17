# Clean pair at c754f188 (superseded by atomic chooser correction)

This actual full TAP log qualifies the stated earlier pair only. Independent review subsequently identified partial chooser-batch submission at this head; green tests did not resolve that defect. The atomic-batch correction requires fresh qualification.

- Frontend: `c754f1883a7fc33ca632a9a9d9017ebe397da72a`
- Backend: `e8f9e2be23520f8eecaf31e65864f28da6214a2e`
- Combined local commit: `3acd47fb93aa24a3bb0609086e004dd02cde40c2`
- Combined tree: `fb5d8b23c9473d7c13f605059cd43580aead491e`
- Node22.23.3 / Chrome154.0.8037.97, Linux.
- Exact command from combined repository root: `node --test tests/relay-*.test.js`
- 1285 passed, 0 failed/cancelled/skipped, 199670.848182ms.
- Public files exactly match frontend; backend and SQLite fixture exactly match backend. No temporary enabling/BLOB adapters.
- Hosted owner38055423281 and R2 qualification38055423239 both completed SUCCESS at this exact frontend head.

[Full log](paired-1285.tap), SHA-256 `3b617383507f4105460aeaf634faa9330d06df05f5fa9052043cc1f185186097`. Synthetic invalid URL userinfo labels are redacted; outcomes and timings are unchanged. No credentials, private records or environment-variable values are included. Physical Android/TalkBack, live connector consumption and production CORS/TLS are not qualified.
