import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayback } from "./helpers/playback.mjs";
import * as fixtures from "./fixtures/streams.mjs";

const { streams: S, settings: SETTINGS } = await loadPlayback();
const caps = S.capabilities(fixtures.androidChromeCapabilities());

function normalize(raw) {
  return S.normalize(raw, { pageUrl: fixtures.PAGE_URL });
}

function classify(raw) {
  return S.evaluate(normalize(raw), caps);
}

test("every supported stream shape normalizes to the right kind", () => {
  const kinds = fixtures.everyShape.map((raw) => normalize(raw).kind);
  assert.deepEqual(kinds, [
    "direct", "direct", "hls", "dash", "youtube", "external", "torrent",
    // A javascript: URL is still a URL-bearing stream; it is the evaluation,
    // not the normalization, that rejects it.
    "direct", "direct", "direct", "direct", "direct", "direct"
  ]);
});

test("structured facts are extracted from add-on titles", () => {
  const uhd = normalize(fixtures.uncached4kHevc).facts;
  assert.equal(uhd.resolution, "2160p");
  assert.equal(uhd.codec, "HEVC");
  assert.equal(uhd.hdr, "HDR10");
  assert.equal(uhd.audioCodec, "Atmos");
  assert.equal(uhd.audioChannels, "7.1");
  assert.equal(uhd.container, "MP4");
  assert.equal(uhd.sizeBytes, 62000000000);
  assert.equal(uhd.sizeText, "62.0 GB");
  assert.equal(uhd.cached, false);

  const cached = normalize(fixtures.cached1080).facts;
  assert.equal(cached.resolution, "1080p");
  assert.equal(cached.codec, "H.264");
  assert.equal(cached.audioChannels, "5.1");
  assert.equal(cached.cached, true, "[RD+] marks a debrid cache hit");

  assert.equal(normalize(fixtures.hlsStream).facts.live, true);
  assert.equal(normalize(fixtures.audioStream).facts.audioOnly, true);
});

test("the original stream object is preserved untouched", () => {
  const normalized = normalize(fixtures.cached1080);
  assert.equal(normalized.raw, fixtures.cached1080);
  assert.equal(normalized.raw.behaviorHints.filename, "example.1080p.web-dl.x264.mp4");
});

test("malformed stream objects never throw and never look playable", () => {
  for (const raw of fixtures.malformed) {
    let normalized;
    let evaluation;
    assert.doesNotThrow(() => {
      normalized = normalize(raw);
      evaluation = S.evaluate(normalized, caps);
    }, `threw on ${JSON.stringify(raw)}`);
    assert.ok(typeof normalized.kind === "string");
    assert.ok(typeof evaluation.state === "string");
    assert.ok(Array.isArray(evaluation.reasons));
    assert.ok(evaluation.reasons.length > 0 || evaluation.playable);
  }
});

test("malformed input still ranks without throwing", () => {
  const ranked = S.rank(S.normalizeAll(fixtures.malformed, { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  assert.equal(ranked.length, fixtures.malformed.length);
  ranked.forEach((entry) => assert.equal(typeof entry.score, "number"));
});

test("unsafe and mixed-content sources are classified, not hidden", () => {
  const mixed = classify(fixtures.mixedContentStream);
  assert.equal(mixed.state, S.STATE.UNSAFE);
  assert.equal(mixed.reasons[0].code, "mixed-content");
  assert.equal(mixed.playable, false);

  const scheme = classify(fixtures.unsafeSchemeStream);
  assert.equal(scheme.state, S.STATE.UNSAFE);
  assert.equal(scheme.reasons[0].code, "unsafe-url");
  assert.equal(scheme.playable, false);

  // Explaining beats disappearing: the picker still has something to show.
  assert.ok(mixed.reasons[0].text.length > 0);
});

test("http media on an http page is not treated as mixed content", () => {
  const httpCaps = S.capabilities(fixtures.androidChromeCapabilities({ pageProtocol: "http:" }));
  const evaluation = S.evaluate(
    S.normalize(fixtures.mixedContentStream, { pageUrl: "http://astra.example.test/" }),
    httpCaps
  );
  assert.notEqual(evaluation.state, S.STATE.UNSAFE);
});

test("sources needing another app or service are marked, not called unsupported", () => {
  assert.equal(classify(fixtures.torrentStream).state, S.STATE.EXTERNAL);
  assert.equal(classify(fixtures.externalStream).state, S.STATE.EXTERNAL);
  assert.equal(classify(fixtures.proxyHeadersStream).state, S.STATE.UNSUPPORTED);
  assert.equal(classify(fixtures.proxyHeadersStream).reasons[0].code, "proxy-headers");
  assert.equal(classify(fixtures.notWebReadyStream).reasons[0].code, "not-web-ready");
  assert.equal(classify(fixtures.mkvStream).reasons[0].code, "container");
});

test("adaptive sources depend on their runtime being available", () => {
  assert.equal(classify(fixtures.hlsStream).state, S.STATE.READY);
  assert.equal(classify(fixtures.dashStream).state, S.STATE.READY);

  const noLibraries = S.capabilities(
    fixtures.androidChromeCapabilities({ hlsSupported: false, dashSupported: false, nativeHls: false })
  );
  assert.equal(S.evaluate(normalize(fixtures.hlsStream), noLibraries).reasons[0].code, "no-hls");
  assert.equal(S.evaluate(normalize(fixtures.dashStream), noLibraries).reasons[0].code, "no-dash");
});

test("content types are only built when they are reliable", () => {
  assert.equal(S.contentTypeFor(normalize(fixtures.cached1080)), 'video/mp4; codecs="avc1.640029"');
  // No container detected means no speculative probe.
  assert.equal(S.contentTypeFor(normalize(fixtures.youtubeStream)), "");
  assert.equal(S.contentTypeFor(normalize({ url: "https://cdn.example.test/x" })), "");
});

test("a cached compatible 1080p source beats an uncertain uncached 4K source", () => {
  const ranked = S.rank(
    S.normalizeAll([fixtures.uncached4kHevc, fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }),
    { settings: SETTINGS.DEFAULTS, capabilities: caps }
  );
  assert.equal(ranked[0].stream.facts.resolution, "1080p");
  assert.equal(ranked[0].stream.facts.cached, true);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.match(ranked[0].why, /Cached/);
});

test("ranking is deterministic across repeated runs and input order", () => {
  const shuffled = [...fixtures.everyShape].reverse();
  const first = S.rank(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  }).map((entry) => entry.stream.url || entry.stream.ytId || entry.stream.infoHash);
  const second = S.rank(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  }).map((entry) => entry.stream.url || entry.stream.ytId || entry.stream.infoHash);
  assert.deepEqual(first, second, "same input ranks identically every time");

  const reversed = S.rank(S.normalizeAll(shuffled, { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  assert.equal(reversed[0].stream.url, fixtures.cached1080.url, "the winner does not depend on input order");
});

test("ranking follows the owner's settings", () => {
  const list = S.normalizeAll([fixtures.uncached4kHevc, fixtures.cached1080], { pageUrl: fixtures.PAGE_URL });

  const noCachePreference = S.rank(list, {
    settings: { ...SETTINGS.DEFAULTS, preferCached: false },
    capabilities: caps
  });
  assert.ok(
    noCachePreference.find((entry) => entry.stream.facts.cached).score <
      S.rank(list, { settings: SETTINGS.DEFAULTS, capabilities: caps }).find((entry) => entry.stream.facts.cached).score,
    "turning off the cached preference lowers a cached source's score"
  );

  const capped = S.rank(list, {
    settings: { ...SETTINGS.DEFAULTS, maxResolution: "1080p" },
    capabilities: caps
  });
  assert.match(
    capped.find((entry) => entry.stream.facts.resolution === "2160p").factors.map((f) => f.label).join(" "),
    /Above your 1080p limit/
  );

  const avoidHdr = S.rank(list, {
    settings: { ...SETTINGS.DEFAULTS, hdrPreference: "avoid" },
    capabilities: caps
  });
  const preferHdr = S.rank(list, {
    settings: { ...SETTINGS.DEFAULTS, hdrPreference: "prefer" },
    capabilities: caps
  });
  const hdrScore = (ranked) => ranked.find((entry) => entry.stream.facts.hdr).score;
  assert.ok(hdrScore(preferHdr) > hdrScore(avoidHdr), "HDR preference moves the HDR source");
});

test("the highest resolution does not automatically win", () => {
  const ranked = S.rank(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  assert.notEqual(ranked[0].stream.facts.resolution, "2160p");
  assert.equal(S.bestCandidate(ranked).evaluation.playable, true);
});

test("every source carries a short explanation", () => {
  const ranked = S.rank(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  ranked.forEach((entry) => {
    assert.ok(entry.why.length > 0, `${entry.stream.title} has no explanation`);
    if (!entry.evaluation.playable) {
      assert.equal(entry.why, entry.evaluation.reasons[0].text, "a blocked source explains what is blocking it");
    }
  });
});

test("MediaCapabilities refinement upgrades and downgrades without throwing", async () => {
  const entries = S.rank(S.normalizeAll([fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  const refined = await S.refineWithDecodingInfo(entries, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async () => ({ supported: false, smooth: false })
  });
  assert.equal(refined[0].evaluation.state, S.STATE.UNSUPPORTED);
  assert.equal(refined[0].evaluation.playable, false);

  const rejecting = S.rank(S.normalizeAll([fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  const survived = await S.refineWithDecodingInfo(rejecting, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async () => {
      throw new Error("not implemented");
    }
  });
  assert.equal(survived[0].evaluation.state, S.STATE.READY, "a failing probe keeps the synchronous verdict");
});

test("evaluation never performs network requests", async () => {
  // A canary: if any code path started probing, this fetch would be called.
  let called = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    called += 1;
    return Promise.reject(new Error("no network in evaluation"));
  };
  try {
    S.rank(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), {
      settings: SETTINGS.DEFAULTS,
      capabilities: caps
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(called, 0);
});

test("a codec that cannot live in the container is not asserted", () => {
  // Add-on titles are free text: "x264" beside a .webm URL is a mislabel.
  const mislabelled = normalize({
    name: "Mislabelled",
    title: "Example Movie 720p x264 AAC",
    url: "https://cdn.example.test/media/example.webm"
  });
  assert.equal(mislabelled.facts.container, "WebM");
  assert.equal(mislabelled.facts.codec, "H.264");
  assert.equal(
    S.contentTypeFor(mislabelled),
    "video/webm",
    "the impossible codec is dropped rather than asserted"
  );

  // A real pairing still carries its codec through.
  assert.equal(
    S.contentTypeFor(normalize({ title: "Example 1080p VP9", url: "https://cdn.example.test/a.webm" })),
    'video/webm; codecs="vp09.00.10.08"'
  );
  assert.equal(
    S.contentTypeFor(normalize({ title: "Example 1080p HEVC", url: "https://cdn.example.test/a.mp4" })),
    'video/mp4; codecs="hvc1.1.6.L93.B0"'
  );
});

test("a mislabelled but playable source is not declared unsupported", () => {
  const webmCaps = S.capabilities(
    fixtures.androidChromeCapabilities({
      canPlayType: (type) => (type === "video/webm" ? "probably" : /avc1/.test(type) ? "probably" : "")
    })
  );
  const evaluation = S.evaluate(
    normalize({ title: "Example 720p x264", url: "https://cdn.example.test/media/example.webm" }),
    webmCaps
  );
  assert.equal(evaluation.playable, true);
  assert.equal(evaluation.state, S.STATE.READY);
});

test("MediaCapabilities is never asked about a bare container type", async () => {
  // Chromium answers "unsupported" for a codec-less content type, which would
  // wrongly hide a playable source.
  const asked = [];
  const bareContainer = S.rank(
    S.normalizeAll([{ name: "No codec named", title: "Example 720p", url: "https://cdn.example.test/a.webm" }], {
      pageUrl: fixtures.PAGE_URL
    }),
    { settings: SETTINGS.DEFAULTS, capabilities: caps }
  );
  assert.equal(bareContainer[0].evaluation.contentType, "video/webm", "the type has no codecs parameter");

  const refined = await S.refineWithDecodingInfo(bareContainer, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async (config) => {
      asked.push(config.video.contentType);
      return { supported: false, smooth: false };
    }
  });

  assert.deepEqual(asked, [], "no probe was made");
  assert.equal(refined[0].evaluation.playable, true, "the source is still offered");

  // A codec-bearing type is still probed.
  const withCodec = S.rank(S.normalizeAll([fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }), {
    settings: SETTINGS.DEFAULTS,
    capabilities: caps
  });
  await S.refineWithDecodingInfo(withCodec, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async (config) => {
      asked.push(config.video.contentType);
      return { supported: true, smooth: true };
    }
  });
  assert.deepEqual(asked, ['video/mp4; codecs="avc1.640029"']);
});
