# Direct R2 music uploads

The existing Worker binding handles upload and playback. R2 account credentials
stay in Actions; Muse receives none. There is no recurring R2 mirror.

`/music/library.json` is the independent R2 library. Its tags are prepared once
at upload, not parsed by every phone. Registered songs are discovered on refresh
or the player's five-minute check (deferred while R2 is playing). Drive has its
own source, IDs and configuration, and is never a playback fallback.

## Private Muse setup

Muse requires the owner's authorization inside its private app before creating
the dedicated signing key. Use Ed25519 **PKCS8 PEM**, not its existing SSH key:

    umask 077
    openssl genpkey -algorithm ED25519 -out "$HOME/workspace/jarvis-music-upload.pem"

The private file stays with Muse at mode 0600 across runs. Only the 32-byte raw
public verification key (64 lowercase hex characters) is returned through the
Jarvis Muse inbox. Obtain it without printing private material:

    openssl pkey -in "$HOME/workspace/jarvis-music-upload.pem" -pubout -outform DER | tail -c 32 | xxd -p -c 32

Register that nonsecret public key using `muse_public_key` in the existing manual
Worker workflow. Empty allowlist disables uploads. Remove the public key to revoke
upload access. No key, password or bearer token belongs in the player config.

## Upload contract and client

Download `scripts/upload-music-r2.py` from the exact tested source revision.
It requires Python, mutagen and openssl, reads already finished tagged Opus,
extracts its embedded JPEG/PNG cover, and performs no download or conversion:

    python upload-music-r2.py '01 - Polyphia - Genesis.opus' --key "$HOME/workspace/jarvis-music-upload.pem" --report upload-result.json

The destination is fixed to `jarvis-hub-api.braydenparker999.workers.dev` and
redirects are rejected. The private key signs requests locally and is never sent.

1. PUT `/music/uploads/audio/<sha256>.opus` (`audio/ogg`, at most 32 MiB).
2. PUT `/music/uploads/art/<sha256>.jpg` or `.png` (at most 2 MiB).
3. POST `/music/uploads/register` (`application/json`, at most 16 KiB): audio
   hash/size, filename, prepared metadata and optional cover hash/size/extension.

Sign the UTF-8, newline-separated values `jarvis-r2-upload-v1`, method, origin,
path, Content-Type, SHA-256, byte length, Unix timestamp and raw public key hex.
Headers are X-Music-Public-Key, X-Music-Signature (128 hex), X-Music-Timestamp,
X-Music-Size, X-Music-Sha256. The signature is valid for five minutes. Origin,
method, path and exact bytes are bound to it; browser uploads are refused.

On an HTTP failure, the standalone uploader still stops with exit status 1 and
the existing `Upload stopped: Upload HTTP ...` message. It also prints one JSON
`uploadReceipt` line, available to importing callers as `UploadHTTPError.receipt`.
The receipt contains status, the original signed Unix timestamp, request timing,
hashes of the canonical signing message and raw public key, and bounded response
metadata. It never includes a signature, private key/path, full headers,
credentials, or arbitrary response text.
The `--report` file remains a successful-registration report and is not replaced
by an error receipt.

Only an exact known Worker JSON error with its expected status is recognized.
For example, 401 plus `Authorized music signature required` produces
`worker_error_code: signature_required`; an HTML or unknown 401 stays
`unattributed_http_error`. A Cloudflare header alone does not prove Worker
invocation. Recognition identifies a known response pattern; it cannot
cryptographically authenticate the responder or exclude an intermediary echo.
Error bodies are read once with a 1 KiB limit and one sentinel byte;
truncated, unreadable or unrecognized bodies cannot establish Worker attribution.
The receipt aids diagnosis of that request and adds no retries. It does not prove
recovery or reconstruct earlier failures whose request/response data was lost.

Server hashing plus R2's checksum verifies uploaded bytes. Content-addressed blobs
are immutable and retries reuse them. Only registration publishes a song after
both referenced objects match server-created proof. Interrupted uploads remain
unlisted and can be resumed by rerunning the client. Concurrent registrations use
conditional index writes; a conflict never silently replaces another upload.
Same audio SHA-256/size retains its existing song identity; first registration's
metadata wins. This preserves ratings/playlists and avoids duplicate Genesis if
it is identical to the already migrated file. No delete/overwrite API is exposed.

Initial library seeding uses the stable verified full migration report and already
published metadata, with no Google downloads. It retains `r2_<legacy ID>` for the
1,287 migrated songs. New songs use `r2_native_<SHA256>`. Legacy covers remain
their immutable Azure image URLs; new covers are stored in R2.

An upload response proves registration, not playback. Completion still requires
actual audio hash/decode, Range/CORS, cover decode and player seeking with Drive
disabled. Physical Android background playback is a separate unverified check.
