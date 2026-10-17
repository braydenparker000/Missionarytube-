# DrawerCast music sources

Settings → Library → Music Sources is the connection home for On this device,
Google Drive, Cloudflare R2, and DrawerCast server. Main library categories combine enabled
sources; each track retains its existing playback adapter and stable ID. Track
Info / Tags identifies its source. Existing Drive folder and server credentials
are reused. Sources reuse the existing services and Azure Storage frontend.

Source switches are per browser (`drawercast.sources.v1`). Older Drive disable
preferences migrate on first use. Disabling hides tracks from browsing, search,
bookmarks, playlists, and playback queues; it does not delete IndexedDB tracks,
art, ratings, plays, playlist IDs, files, or connection settings. Disabling the
playing source stops playback. Saved unavailable sources remain in the library;
connection errors belong to settings rather than unsolicited pairing dialogs.
Refresh still reconciles files actually removed from the source, as before.

Drive listing and metadata requests are cancelled when Drive is disabled. Server
requests, polling, and automatic reconnect are suspended while disabled. Re-enable
restores cached tracks immediately and refreshes the saved source when available.
The local source offers files, ZIPs, supported folder linking, and cache settings.
Music tools and the empty player link to the same source settings.

Rollback source baseline: `28d6981d2f0eb67524db23a6887b5d0c074995d9`.
Storage baseline: `912357c129ced187ad2605c9194a3671d2c0d5d5`.
Deploy uses the existing pinned-source release and unchanged OIDC workflow with
its pre-deployment Storage backup. Reverting the release pin restores the previous
frontend. Source preferences do not change stored track formats.

Automated coverage exercises source isolation, legacy preference migration,
reload persistence, mixed playlists, preserved metadata, queue filtering, active
playback cancellation, unrelated-source switching, and all-sources-disabled state.

## Independent R2 source

Cloudflare R2 is a separate Music Sources row and switch. It loads only verified
objects from its configured partial manifest. Drive always streams from Google;
R2 always streams from the Worker, with no automatic switch between sources.
R2 works with Drive disabled or unavailable and needs no Drive API credential.

R2 entries use `r2_<Drive ID>`; existing Drive entries keep `gd_<Drive ID>`.
Their ratings, play history and playlist entries are separate. If both sources
are enabled, their copies appear as distinct library entries. Disabling either
source hides only its entries and keeps saved user data. A15 reconnection and
removal affect only the server's entries.

The static published metadata snapshot supplies tags and artwork independently
of the Drive playback adapter. The R2 manifest must match IDs, sizes and hashes
before records are committed. Partial status stays `complete=false`; uncopied
tracks never appear in the R2 source. A failed refresh retains its previous
verified library, and a stream failure asks the user to retry R2.

Frontend deployment writes `assets/r2-config.json` with `rootId` and
`manifestURL`. Drive configuration contains only Drive settings.
