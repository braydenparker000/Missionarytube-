# Relay and Guitar file saving

Relay previously fetched a private attachment, clicked a hidden download link, claimed “Download started”, and revoked its Blob URL after one second. The browser cannot confirm a completed download from that click. A slow private fetch also cannot safely carry user activation into native save/share APIs.

Relay now prepares authenticated bytes in memory, then offers an explicit ready-file tap: Save to Files when a picker is exposed, otherwise file sharing if `navigator.canShare({files})` accepts the actual file. Open file and Direct download remain available. Preparation and native-sheet cancellation are handled separately; repeated taps cannot start another read or sheet. Native write success is reported only after close; write failures abort. Share/open/download messages explicitly avoid claiming a file was saved.

Guitar uses the same feature-detected helper for its prepared PDF. Both paths keep active Blob URLs alive. A URL already handed to the browser remains valid for five minutes after view disposal to avoid interrupting a viewer/download; unused URLs are released immediately. Prepared files are never stored in browser persistence. Existing private read authorization, image previews and inline image behavior are retained.

## Source reconciliation

The live `release.json` still names `363f710068bb6f2c456dbbf183f063484a36fe11`; `release-qualified.json` records the later Chat/Tasks overlay from `fed236966d928a4f8221474e502459e13e82e2a4`. The live attachment module is SHA256 `ad3407c0e688b175be3c4879aaa57698197d2a1365f5cd76324c97f4f8aae2e0`, matching the current release branch. Both Guitar files match that branch byte-for-byte. This change starts at `099ec1a0b2b621a3799f4f8346490903f212a912` and changes only saving code and synthetic tests; any publication must overlay only the four saving modules, dependency first. Do not publish this source tree wholesale or alter Worker/settings, paused development, credentials, schedules or uploads.

## Browser API evidence (checked 2026-10-13)

- Chrome's [File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) recommends detecting the specific picker method and invoking it before asynchronous preparation, and notes writes are committed on close.
- The [Web Share specification](https://www.w3.org/TR/web-share/) requires transient activation, file capability checks, and rejects cancellation with AbortError. Fulfillment is a handoff to a share target; it is not a portable filesystem completion receipt.
- A native Android save picker is not promised. Browser capabilities and installed share targets determine available actions. Open/download are explicit fallbacks.

Tests use synthetic files only. Browser API sheets are stubbed to verify call timing, errors, cancellation and repeat taps. Chromium mobile viewport/touch emulation verifies the actual download event and exact synthetic bytes, retained URL after disposal, and authenticated attachment integration including revocation. This is not physical Android, Android Files, Drive, or TalkBack validation.
