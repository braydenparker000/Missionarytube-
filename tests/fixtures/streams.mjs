/**
 * Synthetic add-on stream fixtures.
 *
 * Every host is under a reserved test TLD (RFC 2606 `.test`), every token-like
 * value is obviously fake, and nothing here comes from a real add-on, debrid
 * account, or the owner's configuration.
 */

export const PAGE_URL = "https://astra.example.test/";

export const cached1080 = {
  name: "Alpha Debrid",
  title: "Example Movie 2019 1080p WEB-DL x264 AAC 5.1 3.4 GB [RD+]",
  url: "https://cdn.example.test/media/example-1080p.mp4",
  behaviorHints: { filename: "example.1080p.web-dl.x264.mp4", videoSize: 3400000000 },
  _addonName: "Alpha"
};

export const uncached4kHevc = {
  name: "Alpha Debrid",
  title: "Example Movie 2019 2160p UHD BluRay REMUX HEVC HDR10 Atmos 7.1 62 GB",
  url: "https://cdn.example.test/media/example-2160p.mp4",
  behaviorHints: { filename: "example.2160p.remux.hevc.mp4", videoSize: 62000000000 },
  _addonName: "Alpha"
};

export const hlsStream = {
  name: "Gamma Live",
  title: "Example Channel live 720p",
  url: "https://cdn.example.test/live/example/index.m3u8",
  behaviorHints: { isLive: true },
  _addonName: "Gamma"
};

export const dashStream = {
  name: "Delta Adaptive",
  title: "Example Movie 1080p adaptive",
  url: "https://cdn.example.test/dash/example/manifest.mpd",
  _addonName: "Delta"
};

export const youtubeStream = {
  name: "Trailer",
  title: "Example Movie official trailer",
  ytId: "aqz-KE-bpKQ",
  _addonName: "Cinemeta"
};

export const externalStream = {
  name: "Open in provider",
  title: "Example Movie",
  externalUrl: "https://provider.example.test/watch/example",
  _addonName: "Epsilon"
};

export const torrentStream = {
  name: "Zeta Torrent",
  title: "Example Movie 2019 1080p BluRay x264",
  infoHash: "0000000000000000000000000000000000000000",
  sources: ["tracker:udp://tracker.example.test:1337"],
  _addonName: "Zeta"
};

export const mixedContentStream = {
  name: "Eta Legacy",
  title: "Example Movie 720p",
  url: "http://insecure.example.test/media/example-720p.mp4",
  _addonName: "Eta"
};

export const unsafeSchemeStream = {
  name: "Theta",
  title: "Example Movie",
  url: "javascript:alert(1)",
  _addonName: "Theta"
};

export const mkvStream = {
  name: "Iota",
  title: "Example Movie 1080p x264",
  url: "https://cdn.example.test/media/example.mkv",
  _addonName: "Iota"
};

export const proxyHeadersStream = {
  name: "Kappa Restricted",
  title: "Example Movie 1080p",
  url: "https://cdn.example.test/media/restricted.mp4",
  behaviorHints: { proxyHeaders: { request: { Referer: "https://provider.example.test/" } } },
  _addonName: "Kappa"
};

export const notWebReadyStream = {
  name: "Lambda",
  title: "Example Movie 1080p",
  url: "https://cdn.example.test/media/example.mp4",
  behaviorHints: { notWebReady: true },
  _addonName: "Lambda"
};

export const audioStream = {
  name: "Mu Radio",
  title: "Example Radio live stream 128 kbps",
  url: "https://cdn.example.test/radio/example.mp3",
  _addonName: "Mu"
};

/** Objects that must be classified without throwing. */
export const malformed = [
  null,
  undefined,
  {},
  [],
  42,
  "not a stream",
  { url: null },
  { url: {} },
  { name: {}, title: [], description: 7, url: "https://cdn.example.test/ok.mp4" },
  { behaviorHints: null, url: "https://cdn.example.test/ok2.mp4" },
  { behaviorHints: "nope", url: "https://cdn.example.test/ok3.mp4" },
  { infoHash: 12345 },
  { ytId: {} }
];

export const everyShape = [
  cached1080,
  uncached4kHevc,
  hlsStream,
  dashStream,
  youtubeStream,
  externalStream,
  torrentStream,
  mixedContentStream,
  unsafeSchemeStream,
  mkvStream,
  proxyHeadersStream,
  notWebReadyStream,
  audioStream
];

/** Capability probe for a modern Android Chrome build. */
export function androidChromeCapabilities(overrides = {}) {
  return {
    pageProtocol: "https:",
    nativeHls: false,
    hlsSupported: true,
    dashSupported: true,
    canPlayType(type) {
      if (/^video\/mp4/.test(type) && /avc1/.test(type)) return "probably";
      if (/^video\/mp4/.test(type) && /hvc1/.test(type)) return "";
      if (/^video\/webm/.test(type)) return "probably";
      if (/^audio\/(mpeg|mp4|aac)/.test(type)) return "probably";
      if (/^video\/mp4$/.test(type)) return "maybe";
      return "";
    },
    ...overrides
  };
}

/** A synthetic series with deliberately shuffled, partially annotated videos. */
export function seriesMeta() {
  return {
    id: "tt0000001",
    type: "series",
    name: "Example Series",
    videos: [
      { id: "tt0000001:2:1", season: 2, episode: 1, title: "Second premiere" },
      { id: "tt0000001:1:2", season: 1, episode: 2, title: "Second" },
      { id: "tt0000001:0:1", season: 0, episode: 1, title: "Holiday special" },
      { id: "tt0000001:1:1", season: 1, episode: 1, title: "Pilot" },
      { id: "tt0000001:1:10", season: 1, episode: 10, title: "Finale" },
      { id: "tt0000001:extra", title: "Unnumbered extra" }
    ]
  };
}

export const SRT_SAMPLE =
  "﻿1\r\n" +
  "00:00:01,000 --> 00:00:04,000\r\n" +
  "First line\r\nsecond line\r\n" +
  "\r\n" +
  "2\r\n" +
  "0:00:05,500 --> 0:00:08,250\r\n" +
  "Single-digit hour cue\r\n";

export const subtitleList = [
  { url: "https://subs.example.test/example.en.srt", lang: "eng", _addonName: "OpenSubs" },
  { url: "https://subs.example.test/example.en.srt", lang: "eng", _addonName: "OpenSubs" },
  { url: "https://subs.example.test/example.en.vtt", lang: "en", _addonName: "OpenSubs" },
  { url: "https://subs.example.test/example.es.srt", lang: "spa", _addonName: "OpenSubs" },
  { url: "ftp://subs.example.test/example.fr.srt", lang: "fre" },
  { url: "", lang: "de" },
  null,
  { lang: "it" }
];
