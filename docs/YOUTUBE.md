# YouTube through Invidious

MissionaryTube plays YouTube natively. It searches, opens and plays a video
inside the app's own Player V3, using the real stream URLs Invidious resolves.

**There is no YouTube embed anywhere.** No `iframe`, no IFrame API, no
`youtube.com/embed`, and no path that sends the viewer to YouTube to watch it
instead. That is a hard rule the test suite enforces, not a preference: the
embed does not work on the target device.

## How it plays

Invidious returns two different kinds of format, and they are not
interchangeable.

**Progressive** (`formatStreams`) carries video and audio in one file, so it
goes straight into `<video src>`. A media element load is not a CORS request,
which is why this works against Google's hosts with nothing in between. The
catch is the ceiling: YouTube now publishes at most 360p this way, and 720p
only sometimes.

**Adaptive** (`adaptiveFormats`) is video-only and audio-only, separately. Two
URLs cannot be assigned to one `<video>` element. The correct browser-side
answer is Media Source Extensions, which is what dash.js does with the DASH
manifest Invidious generates from those same formats. MSE fetches its segments
from JavaScript, so it *does* need CORS — and Google's video hosts do not send
it. That is the one specific case where video data has to travel through the
Invidious instance (`?local=true`).

**Live** has neither. Invidious exposes `hlsUrl`, served by the instance, and
hls.js plays it.

So a video becomes an ordered list of deliveries:

| Order | Delivery | Through our server? | Reaches |
| --- | --- | --- | --- |
| 1 | DASH, adaptive | yes, segments only | up to 1080p, with in-place quality switching |
| 2 | Progressive, direct | no | 360p, sometimes 720p |
| 3 | Progressive, re-resolved through the instance | yes | same, and recovers a signed URL bound to another address |

With no private instance configured the adaptive entry drops to the back, so a
volunteer's bandwidth is never the first thing spent. Everything else is
unchanged, and playback still works — just capped at what progressive offers.

Those entries are ordinary Astra streams. Once a variant looks like every other
stream the app handles, the source picker, the compatibility verdict, the
playback engine, the adapters, progress and Continue Watching all work on it
without knowing YouTube exists.

## Quality

The player's quality menu lists **Auto** plus every height that will genuinely
play. A height is only offered when the device reports it can decode that
video codec *and* an audio format exists that it can decode too — advertising
1080p whose audio cannot be played would be advertising silence.

- An adaptive height switches **in place**: dash.js swaps the representation
  under the element, so the position and the buffer survive.
- A progressive height is a different file, so it reloads — and the playhead is
  carried across explicitly rather than restarting.

## Instances

Configuration lives in one file, [`assets/js/youtube/config.js`](../assets/js/youtube/config.js):

| Value | Meaning |
| --- | --- |
| `privateInvidiousUrl` | Our own server. Ships empty; set in Settings → YouTube. |
| `publicFallbackInstances` | Three public instances, used only as fallbacks. |
| `requestTimeout` | How long any one request may take. Default 9s. |
| `instanceCooldown` | How long a failing instance is rested. Default 120s. |

No instance host appears anywhere else in the codebase.

The instance manager treats "which server answers" as its own problem:

- every instance carries measured health — latency, failures, cooldown;
- a request that fails on one instance is retried on another, up to three;
- a failing instance is rested rather than hammered, and a rate limit earns a
  longer rest than a one-off error;
- a rested instance recovers by itself once its cooldown elapses;
- the instance that answered is pinned for the session, so a working server is
  not re-raced on every keystroke;
- the private instance takes the work back as soon as it is healthy again,
  because the public ones are fallbacks and nothing else;
- availability probing runs *beside* the first real request, never in front of
  it, so nothing in the UI waits on a sweep.

A video that is genuinely unavailable — removed, private, age restricted — is
recognised as the video's problem, not the server's, so it is reported rather
than retried across every instance in the list.

## Setting up your own instance

See [`deploy/invidious/`](../../deploy/invidious/README.md). It is a Docker
Compose file for Invidious plus PostgreSQL, sized for an Oracle Cloud Always
Free ARM VM, with the CORS and proxy settings the frontend needs already set.

Paste its address into **Settings → YouTube**. It is stored in that browser
only and never committed.

## Failure

Every failure ends in a MissionaryTube error, never a redirect to YouTube:

> YouTube playback is temporarily unavailable.

Handled explicitly: instance offline, timeout, 403, 429, 5xx, malformed JSON,
an unavailable or removed video, no usable stream, an expired playback URL, and
the search API being unreachable. A lapsed signed URL is re-resolved **once**
per attempt — enough to recover, bounded so a dead video cannot loop.

## Checking it actually plays

`npm test` covers the modules: instance selection and failover, the API client
and its sanitizing, the playback plan and quality ladder, the adapters' quality
control, and the wiring in `index.html`. None of that proves a video plays.

`npm run test:browser` does. It launches Chromium at a phone-shaped viewport,
serves the real site, and plays real video generated with `ffmpeg`. What is
substituted is only the remote services, by four local servers whose
differences are the point:

| Server | Stands in for | Sends CORS headers? |
| --- | --- | --- |
| invidious | the API and the compatibility proxy | yes |
| google | the direct progressive host | **no** |
| addon | a Stremio add-on | yes |
| app | the site itself | n/a |

The CORS-less media host is not an oversight: it is how the check proves that
direct progressive playback works with nothing in between, and that adaptive
playback genuinely needs the proxy.

Twenty-one checks run, including instance failover with the configured server
genuinely refusing every request, and a signed URL genuinely returning 403.

Two honest caveats:

- The bundled Chromium ships without proprietary codecs, so the generated media
  is VP9 and Opus in WebM rather than H.264 and AAC. The app never names a
  codec of its own — it asks `canPlayType` and `MediaSource.isTypeSupported` —
  so the paths under test are the ones a real Android Chrome takes.
- It is a mock Invidious. It implements the endpoints and the response shapes,
  but it cannot prove that a real instance is up, or that YouTube has not
  changed something since.

## Privacy and security

Everything an instance returns is treated as untrusted external data. Every
field is re-derived into a typed record with validated ids and validated URLs;
`descriptionHtml` is never read; a playback URL that is not `http(s)` never
reaches a `<video src>`; and a manifest or caption URL is only trusted when it
belongs to the server that answered.

The frontend needs no API key and holds no secret. There is nothing to leak.
