# Jarvis security / transfer stage integration

Jarvis security work starts at `ea9c09c1ddb172c1f0d668b58a5e7066f1c8318f`
(merged PR73). This repository's inspected main is
`bf12a379754225db770429d01bf730758fab9a4b` and still pins the earlier
`c4d62409a3b67e4e5dac88809c6a4a0290b6e39e` Jarvis source.
The pin, release settings, origins, Entra identity and deployment workflow
are unchanged on this preparation branch. The core owner chooses and
qualifies the final integrated commit before any promotion.

After integrating the Jarvis code and deliberately updating the source pin,
run the existing required `npm test` and `npm run build`, then:

```sh
node scripts/check-jarvis-security-stage.mjs --root dist
```

The read-only artifact gate verifies the shipped Podcasts module has no
directory script/callback execution, the offline shell includes its JSON
adapter, and the destination-bound transfer and tab draft modules are present.
It prints public source hashes for reproducible integration review. It cannot
substitute for runtime provider-contract and private/public transfer journeys.
Running it against the old release is expected to reject the missing new
modules; that does not authorize changing or deploying the current pin.

The independent first Jarvis commit removes Podcasts JSONP without changing
owner-session behavior and is the smallest deployable safe stage. The transfer
stage additionally preserves unsent owner drafts in this tab through expiry
and navigation, while history remains memory-only and a new sign-in is required
before the private composer is usable. Parent review should include its exact
browser regression evidence and the updated storage isolation assertions.

Origin isolation, remembered-bearer storage, CSP restriction and narrower device
administration remain separately gated decisions described in Jarvis
`docs/security-transfer-stage.md`. No policy changes, subscriptions, credentials,
uploads, schedules, merge or deployment actions are part of this preparation.
