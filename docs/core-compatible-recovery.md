# Local exact podcast migration and CORE recovery chain

This is a local qualification helper, without provider transport or production activation. It is based on PR130's reviewed producer and keeps the original production recipes, default canonical refusal, pair proof and action approval gates unchanged.

The chain is explicitly three steps:

1. Original qualified `f999581aa979712b4b63a6783b7c56842fedb6a1` ZIP artifact11599059865:174 public files; ZIP SHA256 `c2d8abe103d35ae3d2b7bb36c9483a6bd3bb089ed1c625cc2f1e0972a8f91fc1`; input digest `bf3f58f741c2153cb68668c6ebb3b3b50996167269b4aa5aede04297391fd903`.
2. An explicit derived175-file compatibility view: the same old main/Astra/Relay bytes, with only the four accepted podcast assets below supplied from the candidate. This is a derived local view, never the hosted174-file artifact or a claim about current live bytes.
3. The actual integrated CORE source `ed7bbd436689be3ac9cca1ab5f111341dd690b80`, tree `39972082e41f11a6d98496f3fa356bda8a38b48b`:179 local-built files; input digest `4d62ca1ee23e3e0031acddb5ab0cbc1cf2a953520b3bf9c41cabd9902be41163`. This is not a downloaded hosted PR131 artifact.

The accepted source change removes executable JSONP discovery and adds bounded JSON CORS discovery with credentials omitted, redirects refused, a1MiB response bound and cancellation. The document updates its app query version; the service worker advances shellv2 to shellv3 and precaches the new directory dependency. API origin, core storage code, CSS, routes, and audio/art cache versions remain exact. Reverting these assets to old bytes would discard the accepted security fix.

The finite contract checks both complete input inventories and exact source/ZIP identities, then checks the only four canonical differences. No general path allowlist exists. It copies all inputs into private state and freezes the audit envelope. Conditional fictional writes proceed `directory.js`→`app.js`→`index.html`→`sw.js`. Every step verifies the whole canonical closure and a valid forward prefix; drift, wrong MIME, unsupported mixed ordering and same-target ETag races refuse. Restart uses observed bytes instead of a saved checkpoint. Interrupted writes and lost responses can resume without reapplying committed steps.

The migration admits only its module-created private fictional store. It calls captured internal map operations, never arbitrary get/put adapters or overridden methods. It cannot make a provider write. Its guard is an explicit local action boundary; passing it is not a production approval. A real migration transport and production admission/approval protocol would need separate review and wiring.

The old worker uses network-first shell reads. During an interrupted migration it can have a safe app response without a cached directory dependency. An offline dependency fetch then fails closed; uninterrupted offline opening is not promised at that intermediate point. Offline readiness requires finishing all four writes and observing a complete activev3 cache online. Tests exercise this intermediate refusal while cached audio still returns206, then verify the actual completev3 shell offline, byte ranges, art cache, IndexedDB feeds and local storage. Main pointer rollback retains the approved safe podcast canonical layer and does not restore JSONP.

With an explicit `--podcast-migration` option, the local preparation wrapper retains separate raw174, derived175 and candidate179 publications. The helper digest and finite migration envelope bind the derivation proof. The original default `compatibleLoaders(raw,candidate)` still refuses. The unchanged original schema interruption, source adversarial and paired browser gates then run on the exact derived/current pair after the separately verified raw→derived transition. The original approval checker runs against these actual release IDs and rejects altered actions, identities and pointer expectations. Missing hosted pair authority remains refused; no production pair record is emitted.

```sh
JARVIS_CHROME=/path/to/qualified/chrome node24 scripts/prepare-core-rollback-pair.mjs \
  /path/to/original-f999-qualified.zip \
  ed7bbd436689be3ac9cca1ab5f111341dd690b80 /path/to/node22 \
  /path/to/clean-external-f999-checkout --podcast-migration
node --test tests/podcast-canonical-migration.test.mjs
```

The wrapper requires its clean source checkout to be at the exact candidate, verifies the reviewed ZIP seal, reproduces all174 baseline bytes with the unchanged builder, and builds all179 candidate bytes. The new tests use immutable source snapshots and the unchanged builder to reproduce the same complete maps; all browser provider responses are fictional and unrecognized origins refuse. The actual original ZIP remains the wrapper's provenance input.

This evidence does not establish a current complete live static backup, actual current Worker identity, provider database restore, live capacity, or production applicability. The production gate stays closed until separately approved canonical migration, full live baseline/admission and exact hosted pair proof exist. A later guard patch with the same179 frontend bytes but a different source/backend digest requires a new exact pair qualification; theed7 evidence does not qualify that later source.
