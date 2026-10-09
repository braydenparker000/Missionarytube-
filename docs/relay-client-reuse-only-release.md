# Relay client release with Worker reuse only

This release pins `c85a42d2bea5d12d576ac84080660a34f11732c4`: five reviewed Relay client files over the live `f999581aa979712b4b63a6783b7c56842fedb6a1` source. Astra, podcasts, backend source, source dependencies, configuration, credentials and feature grants are unchanged.

The production identity entrypoint requires the exact release-bound `workerReusePolicy`. It admits the original eleven-recipe receipt only from source `f999581aa979712b4b63a6783b7c56842fedb6a1`, orchestration `9c01243ad03b921a0b0614d5eb003944a2807a6c`, and backend digest `2b9daec99e498c7c43f658ca1898f09dc6fed83b92f87a3b82e77ee32cb128b5`. Ten recipe blobs remain identical; only the identity script changes. Its new blob is recorded in the immutable release metadata after the code is finalized, without a self-referential hash.

The finite transition changes no historical receipt bytes. All original run, tree, job, success-stamp, live version and settings checks execute against the original eleven historical recipe blobs. An unbranded or changed policy, unknown source/backend/recipe, dirty release metadata, missing receipt, provider refusal or failed proof stops before emitting a deployment flag or checkpoint. A successful plan emits only `deploy=false`; record and verification retain actual active Worker checks.

The original workflow, publication, backup, configuration and authentication gates are unchanged. Existing qualified-artifact validation, real readiness, the verified ETag-stable full storage backup and its uploaded rollback artifact, staged-byte checks, final Worker revalidation and live checks remain necessary. Local tests and artifact comparisons do not attest current provider identity, permissions, live capacity or a recoverable current account snapshot.

The archived identity fixture is byte exact to the original reviewed script. Historical observer and deployment-capable CLI assertions continue to test that archived contract; separate tests exercise the current reuse-only entrypoint and finite transition. Fictional transport fixtures declare the known identity for unit proof tests; no live configuration or private provider body is copied.

Required checks are `npm test` and `npm run build` with the exact source checkout on Node 22.23.3 and Node 24.21.0, using the qualified Chrome 154 browser. The unchanged hosted qualification still owns all eight source lanes and the immutable frontend artifact. No local result authorizes merging or deployment.
