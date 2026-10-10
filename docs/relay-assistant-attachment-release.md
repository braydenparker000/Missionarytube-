# Private assistant attachment release

Pins combined source PR119 `de90c20dce73e6f370795c085d9307e2c7a4f8e2`, tree `8d268413dc9f66e99428a6462fcc98ea49cf1d61`, based on released `4f649ea3446b82da9dd42c3c5928d2f79b0864b5`.

The source contains reviewed frontend PR113 `94f7e73d531f474a93dd2ea826e641c075793b0a` and corrected backend PR114 `2ca9559671be7973793dbac44c86b4ea8dcd5a53`. Twenty paths retain exact reviewed blobs. Two backend files compose only reviewed attachment hunks while preserving all released dormant-project authorization and routing. Playback reliability fixes and Poweramp UI remain intact.

## Sealed deployment

The attachment contract is now exactly 2,986 UTF-8 bytes with SHA256 `b02ee0d8f10eb2f4df3998cada4aec5090b1a46760e1fd9179e2708b8f1b5abc`. It remains the sixth of eight dependencies and is verified before the attachment UI dependency and before owner API/UI importer overwrite. The other seven byte/hash seals, refusal tests, staging order, prewrite backup and immutable artifact gates are unchanged. All 14 Worker recipe entries derive from this exact deployment tree. No workflow or permission expansion is included.

## Authorization and dormant-project guard

Assistant attachment tools use existing live owner authorization. This publication creates no grants, credentials, project bindings, subscriptions or schedules. Project flags remain absent or exact plain-text false under the inherited fail-closed live settings checks. Unknown/partial provider inspection cannot authorize deployment. Existing owner enablement is preserved separately.

Safe pause retains the current Worker with project flags off. Before any older-code rollback, separately authorize project unsubscribe and independently verify zero project subscription, activation-reservation and outbox rows while current binding enforcement remains available. Do not assume an older Worker can enforce new project binding revocation.

## Qualification limits

Fresh current-baseline source/owner gates, full paired deployment qualification and independent exact composed-file/pair review are required. Prior standalone or old-baseline combined evidence does not qualify this tree. Actual native host consumption, physical Android/TalkBack and authenticated production attachment behavior remain separate acceptance; do not invent owner messages or upload private files to claim them.
