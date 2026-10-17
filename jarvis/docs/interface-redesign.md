# Jarvis module redesign — October 3, 2026

Relay, Quick AI, Muse, My Media and Guitar share matte charcoal surfaces, restrained amber selections, system typography and dependency-free controls. The launcher, Poweramp and Astra remain their own experiences. Module styles are scoped with body classes; every launcher entry that uses SPA navigation includes the module stylesheet.

## Conversations

Relay and Muse retain their existing message schemas, channel isolation, draft keys, retry IDs and publication routes. Messages are updated in place instead of rebuilding the app on each poll. Reading anchors, drafts and selection stay intact. Menus offer copy, bookmark and quote; search and bookmark views filter the existing conversation. Bookmarks and reading position are local. A quote is inserted into an editable draft; it does not create new server-side threading.

Composers use the visual viewport height when the keyboard opens. Enter creates a new line; Ctrl/Cmd+Enter sends. Actual send buttons remain available. Muse remains one conversation; its setup and explanatory details live in its menu. It does not report invented agent progress.

Quick AI preserves existing saved chats and attachments. Model selection stays in the header; history and usage move to sheets. Replies support safe headings, lists, links, quotes and code copying. Source lists and request details expand on demand. Streaming display updates are batched to animation frames. Continue in Relay prepares a local editable draft and never sends it automatically.

## My Media

Explore is the initial view, with a compact featured collection, fresh additions, quick watches, diverse unwatched selections, collections and creators when metadata exists. Library keeps folder organization; closed folders do not construct their full card lists. Saved is a local watch-later list. Continue Watching is a secondary three-item section.

Time filters exclude videos with unknown duration. Discovery rotates daily, samples collections in round-robin order and excludes watched videos. Collections, browse-all views, video links and the navigation tabs use URL hashes. Video cards offer save, watched status, queue and details. The queue is local, editable and consumes entries when opened; it does not introduce automatic playback. Focused results render in batches of 60. Existing decoding, subtitles, speed controls, progress and PiP behavior remain in place.

### Optional creator and topic metadata

A root Drive file named `jarvis-video-metadata.json` can hold `{version:1,videos:[...]}`. Rows match by Drive `id`, `youtubeId`, or exact video `name`, and can provide `creator`, `description`, `topics` and `addedAt`. Missing or unavailable metadata does not prevent playback or folder browsing. Only this small root manifest is read once per refresh; individual video metadata files are not fetched while browsing.

For download workflows that use `yt-dlp --write-info-json`, run:

```sh
node scripts/build-video-metadata.mjs /path/to/video-library
```

Upload the resulting root metadata file with the videos. The builder reads existing sidecars; it performs no downloads and invents no tags or ratings. Creator sections are hidden until real creator metadata is available. Search includes provided creators and topics.

## Guitar

Recent and Saved are local tab references, not duplicated PDF payloads. Saved tabs can be grouped into Learning, Repertoire and Favorites. Tracks open in a sheet and selections are remembered. Preview uses the same actual score renderer as PDF export. It supports a fit-width overview and actual-size scrolling; further systems are revealed on request. PDF export reuses the prepared score. The existing font, notation conversion, warnings and Android save alternatives are preserved.

## Verification

The regression suite and new browser flows cover message node retention, refresh anchors and drafts, bookmarks, quoting, streaming, Relay draft transfer, Muse separation, discovery filters, saved videos, notation previews and PDF generation. The five modules are checked at 360, 390 and 1200 pixels. Browser fixtures enforce the deployment Content Security Policy and never post to live services. Device-level smoothness still requires user feedback on the A15.
