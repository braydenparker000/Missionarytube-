# Implemented state and interaction contracts

## Player, library and mini-player

Player is scene progress0; library is1. The same artwork node moves from a resource-derived full-art geometry to28px mini artwork. Other controls crossfade; inactive scene controls are inert, so expansion cannot click a row underneath. Buttons, browser Back, reduced motion, resize and scene reversal use the same controller. Per-category navigation/history and scroll restoration are still limited.

Library categories expose songs, albums, artists and queue membership. Search filters title/artist/album. Title sorting is explicit. Rows use a96px stock-size resource baseline and a bounded visible window; the grouping cards and detailed row typography are provisional because no runtime reference was available. Queue displays the source membership, not a fully editable upcoming shuffle schedule.

Current reference variant: black built-in theme, standard over-art labels, visible mini-player seekbar, and explicit previous/next buttons. The optional seekbar is a chosen supported variant, not a claim about the owner's settings. Previous/next placement, card grid, full-art bounds, landscape composition and dynamic backdrop need calibration.

## Gesture contracts

| Input | Implemented result | Reference status |
|---|---|---|
| Library nav / mini-player tap | Open library / expand player; audio element and selected track survive | Journey target; exact native choreography unknown |
| Artwork vertical upward drag | Move player toward library; release past midpoint settles library | V2 provisional mapping |
| Mini-player upward drag | Move library toward player; release past midpoint settles player | V2 provisional mapping |
| Artwork horizontal drag beyond20% width | Next/previous; shorter gesture cancels | Threshold/direction provisional |
| Reversed or cancelled scene drag | Settle using current progress or return to the contact's original target on cancel | Browser-tested; native curve unknown |
| Second contact anywhere | Cancel active gesture; prevent both contacts from activating a different control | Browser policy, tested with real CDP contacts |
| Full waveform pointer seek | Freeze displayed sample window at contact start; map pointer against centered current time; show marker/time preview; recenter at release | Centered display is direct resource evidence; pointer mapping provisional |
| Waveform cancel | Restore contact-start playback position | Browser contract |
| Track replacement during seek | End old contact ownership; old coordinates cannot seek the new track | Browser regression |
| Mini seek | Absolute track-position slider; never expand player or activate a row | Functional target, browser-tested |
| Main play/pause long press | Pause and reset position (Stop) | Stop wiring direct;550ms hold threshold provisional |
| Keyboard seek/list/Menu | Native range keys; arrows/Home/End/Enter select virtual rows; dialog focus remains inside menu | Browser accessibility contract |

V2 touch slop8px, horizontal20% commit, vertical travel55% of viewport (minimum180px), and cubic settle easing are explicit experiment parameters, not extracted Android constants. Velocity-based flings and broader native long-press menus remain open.

## Playback and source state

Selection, play intent, confirmed media status and queue position are distinct. A row selection requests play; browsing or selecting a source does not. Manual next/previous preserves current pause intent. Previous restarts the track after3s; this is provisional behavior. Repeat-one affects natural completion, while explicit next still navigates. Shuffle traverses a randomized bag, avoids duplicate visits within a cycle, avoids immediate boundary repeats and retraces actual previous history.

Pause invalidates pending play promises. Stale errors/successes cannot replace a newer track's state. Browser interruptions preserve pause rather than scheduling autonomous restart. A source failure stays visible and never substitutes another source. Loading/buffering/error are media-derived states; native background continuation is unverified.

Progress comes from actual media time. Demo waveform peaks come from the same generated PCM samples; local files without analyzed peaks show an honest timeline. No fabricated waveform is used for unknown media. The seek owner, animation progress and playback progress are separate state.

## Verification boundaries

`tests/poweramp-v2/browser.test.mjs` uses real browser touch inputs for drag, reversal, cancellation, two contacts, long press, seeking and clicks. Controlled motion samples at0/25/50/75/100% and the settle replacement check additionally inspect the scene controller directly; those are rendering/continuity evidence, not measured native gesture feel. Audio tests use actual decoded media for playback and causal mocks for promise/error races.

The peer review found cross-target multi-touch, centered seek mapping, synchronous Search focus and storage-getter failure. Each was corrected and covered by a regression. Root review additionally guarded a track changing during an active seek.
