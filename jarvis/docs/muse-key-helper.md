# Owner-only phone key helper

Expected live path: `/muse-key/` on the existing Jarvis site. Publish through the
coordinated source/deployment release; this change does not promote itself.
No backend, account, credential, grant, flag or schedule change is needed.

The owner taps **Generate on this phone**. Native `crypto.getRandomValues` creates
32 bytes (256 bits), encoded as 64 lowercase hexadecimal characters. Native
WebCrypto SHA-256 hashes the UTF-8 bytes of that exact hex string, matching
`backend/relay-common.js`. The owner copies the private key only into the verified
Lucy–Muse channel hosted secure form, then copies only the fingerprint to Lucy.
This must be a distinct key from owner–Muse `jarvis-mast`.

Only initial HTML, CSS and JavaScript loads use the network. Generation, hashing,
copying and clearing make no requests. No shared shell, third-party resource,
analytics, URL data, logs or persistent storage are used. Both a page CSP and the
route header restrict connections to `none`; forms, frames and workers are blocked.
The route also requests no-store caching, no referrer and no framing. Generation
fails closed outside a secure top-level context or without WebCrypto, and refuses
a page controlled by a service worker. Nothing is generated before a trusted tap.

Values remain only in the page until Clear, reload or page exit. Switching to the
secure form in another tab/app leaves the helper available for fingerprint copy.
Clipboard is controlled by the phone: Clear does not erase it. Copy failure selects
only the intended field for manual phone copying. The owner should retain the key
privately if needed again. No key is uploaded to this site.

Focused browser check: 320px and 390px phone layouts, >=48px buttons, deterministic
32-byte test sequence, independent Node SHA-256 match, distinct clipboard payloads,
manual-copy fallback, no requests after generation/copy, empty local/session
storage, missing crypto, Clear during pending hashing and pagehide cleanup.
Evidence images in `evidence/muse-key-helper/` contain **fixed public dummy data**,
never usable credentials. Do not provision their key or fingerprint.

Release owner: publish these files and route configuration with the existing
pipeline; verify `/muse-key/` loads over HTTPS with the restrictive CSP before
sending the link. The agent must not tap Generate in a real owner's session or
inspect their populated page. No live credential was generated during development.
