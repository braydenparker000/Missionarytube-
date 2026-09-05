# Astra 0.33 — the rest of the cinema

This release improves the everyday browsing and collection flows around the existing playback foundation. Static Azure hosting, the four destinations, and the playback engines remain in place.

## Changes

- Home mounts catalog slots in configured order and fills each independently. A slow or failed catalog no longer holds back successful catalogs. Failed rows have a retry action. The first usable feature remains stable while later responses arrive; selected hero sources take priority.
- Library joins saved titles and playback history in a searchable collection. Content type and explicit title/year/recent sorting operate only on this collection. History is no longer silently truncated to 18 titles; cards render in pages of 24. Saved titles have removal and an eight-second Undo action.
- Submitted searches and searches that lead to an opened title are remembered locally, limited to eight. Each can be forgotten, or the list cleared. Typing alone does not persist a search history entry. Leaving Search cancels its pending debounce.
- Browse has a filter reset. Changing content type or provider clears a previously selected specific catalog, so controls no longer appear to change while the old catalog still controls results.
- Settings has a searchable dashboard and editable Cinema, Midnight and Focus appearance presets. The device's reduced-motion preference remains authoritative.
- Backup imports validate structure and addresses before a restore preview. The preview states replacement behavior and offers a backup of the current setup. All values are serialized before writes; a failed persistence attempt tries to restore previous storage values before application state is adopted. This is not a database transaction, and browser storage failure can also prevent rollback.
- Backups include normalized YouTube preferences. The download link is attached before clicking and its object URL is revoked later, instead of immediately. File selection is keyboard accessible and can retry the same file. Imported files are limited to 20 MB.
- Offline messaging, meaningful document titles, and async settings ownership checks improve navigation feedback. Late add-on operations cannot repaint another settings screen.

## Verification

The release suite covers collection matching/sorting, bounded search history, malformed backups, failed persistence rollback, independently completed Home requests, and cancellation after leaving Home. Required regression suite and production build pass.

Live acceptance covers Home, Search, Library, Settings, saving/removing/restoring a title, filtering, appearance changes, and navigation. Results are recorded in the release PR. Cloud Chrome is useful for the interface checks; it does not substitute for real Galaxy A15 touch/performance testing.

No stream ordering, source filtering, decoder selection, or YouTube delivery code is changed by this release. No new dependency, analytics, remote account, or PWA is introduced. Recent searches stay on this device and are deliberately omitted from exports.
