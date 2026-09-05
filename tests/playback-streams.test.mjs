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

test("the full release name stays visible instead of a generic provider label", () => {
  const release = "Example.Show.S02E03.1080p.WEB-DL.Dual-Audio.x264-GROUP";
  const stream = normalize({
    name: "Cached provider",
    title: release,
    url: "https://cdn.example.test/show-s02e03.mp4"
  });
  assert.equal(stream.title, release);
  assert.equal(stream.sourceName, "Cached provider");
});

test("anime-style episode numbers are matched conservatively", () => {
  const context = { pageUrl: fixtures.PAGE_URL, video: { id: "anime:12", episode: 12 } };
  const match = S.normalize({ title: "Example Anime - 12 [1080p] Japanese", url: "https://cdn.example.test/e12.mp4" }, context);
  const mismatch = S.normalize({ title: "Example Anime - 13 [1080p] English", url: "https://cdn.example.test/e13.mp4" }, context);
  assert.equal(match.facts.episodeStatus, "match");
  assert.equal(mismatch.facts.episodeStatus, "mismatch");
  assert.deepEqual(Array.from(match.facts.audioLanguages), ["Japanese"]);
});

test("series identity preserves exact filenames and distinguishes pack files", () => {
  const filename = "Example.Show.S02.COMPLETE/" + "very-long-release-segment-".repeat(10) + "S02E03.mkv";
  const raw = {
    name: "Cached provider",
    title: "Example Show S02 complete pack",
    infoHash: "0000000000000000000000000000000000000000",
    fileIdx: 7,
    behaviorHints: { filename }
  };
  const context = { pageUrl: fixtures.PAGE_URL, video: { id: "show:2:3", season: 2, episode: 3 } };
  const first = S.normalize(raw, context);
  const second = S.normalize({ ...raw, fileIdx: 8 }, context);

  assert.equal(first.facts.filename, filename, "the filename is never truncated");
  assert.equal(first.fileIdx, 7);
  assert.equal(first.facts.episodeStatus, "match");
  assert.notEqual(S.identityKey(first), S.identityKey(second), "two files in the same torrent remain distinct");
});

test("the add-on's order is the order, exactly", () => {
  // Astra does not rank, reorder or drop what an add-on returned: the add-on's
  // own configuration is where the owner expressed what they want back.
  const raw = [fixtures.uncached4kHevc, fixtures.cached1080, fixtures.hlsStream, fixtures.dashStream];
  const prepared = S.prepare(S.normalizeAll(raw, { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  assert.equal(prepared.length, raw.length, "nothing is filtered out");
  assert.deepEqual(
    prepared.map((entry) => entry.stream.title),
    raw.map((stream) => stream.title),
    "and nothing is moved"
  );

  // Including when the first result is one this device cannot play: a source
  // is labelled unplayable, never demoted or hidden.
  const reversed = S.prepare(S.normalizeAll([...raw].reverse(), { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  assert.deepEqual(
    reversed.map((entry) => entry.stream.title),
    [...raw].reverse().map((stream) => stream.title),
    "order follows the input, not a score"
  );
});

test("no ranking surface is exported any more", () => {
  for (const gone of ["rank", "score", "rescore", "bestCandidate", "autoEligible"]) {
    assert.equal(S[gone], undefined, `${gone} would let something reorder or auto-pick`);
  }
  const prepared = S.prepare(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  for (const entry of prepared) {
    assert.equal("score" in entry, false, "an entry carries no score");
    assert.equal("aboveCeiling" in entry, false, "and no ceiling verdict");
    assert.equal("autoEligible" in entry, false, "and nothing marking it auto-selectable");
  }
});

test("malformed input still prepares without throwing", () => {
  const prepared = S.prepare(S.normalizeAll(fixtures.malformed, { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  assert.equal(prepared.length, fixtures.malformed.length);
  prepared.forEach((entry) => assert.equal(typeof entry.why, "string"));
});

test("a series pack mismatch is labelled, never hidden or moved", () => {
  const video = { id: "show:2:3", season: 2, episode: 3 };
  const prepared = S.prepare(S.normalizeAll([
    { title: "Example Show S02E04 1080p", url: "https://cdn.example.test/wrong.mp4" },
    { title: "Example Show Season 2 complete pack", infoHash: "0000000000000000000000000000000000000000" },
    { title: "Example Show S02E03 720p", url: "https://cdn.example.test/right.mp4" }
  ], { pageUrl: fixtures.PAGE_URL, video }), { capabilities: caps });

  assert.equal(prepared[0].stream.facts.episodeStatus, "mismatch");
  assert.equal(prepared[1].stream.facts.episodeStatus, "ambiguous-pack");
  assert.equal(prepared[2].stream.facts.episodeStatus, "match");
  // The wrong episode stays first because the add-on returned it first. The
  // viewer is told what it is and decides; nothing decides for them.
  assert.equal(prepared[0].stream.url, "https://cdn.example.test/wrong.mp4");
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

test("every source carries a short explanation", () => {
  const ranked = S.prepare(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  ranked.forEach((entry) => {
    assert.ok(entry.why.length > 0, `${entry.stream.title} has no explanation`);
    if (!entry.evaluation.playable) {
      assert.equal(entry.why, entry.evaluation.reasons[0].text, "a blocked source explains what is blocking it");
    }
  });
});

test("MediaCapabilities refinement upgrades and downgrades without throwing", async () => {
  const entries = S.prepare(S.normalizeAll([fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  const refined = await S.refineWithDecodingInfo(entries, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async () => ({ supported: false, smooth: false })
  });
  assert.equal(refined[0].evaluation.state, S.STATE.PROBABLY_READY);
  assert.equal(refined[0].evaluation.playable, true);

  const rejecting = S.prepare(S.normalizeAll([fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
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
    S.prepare(S.normalizeAll(fixtures.everyShape, { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
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
  const bareContainer = S.prepare(
    S.normalizeAll([{ name: "No codec named", title: "Example 720p", url: "https://cdn.example.test/a.webm" }], {
      pageUrl: fixtures.PAGE_URL
    }),
    { capabilities: caps }
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
  const withCodec = S.prepare(S.normalizeAll([fixtures.cached1080], { pageUrl: fixtures.PAGE_URL }), { capabilities: caps });
  await S.refineWithDecodingInfo(withCodec, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async (config) => {
      asked.push(config.video.contentType);
      return { supported: true, smooth: true };
    }
  });
  assert.deepEqual(asked, ['video/mp4; codecs="avc1.640029"']);
});

test("a decodingInfo downgrade updates the verdict and its explanation, not the order", async () => {
  const ranked = S.prepare(
    S.normalizeAll(
      [
        { name: "H264 direct", title: "Example 1080p x264 4 GB", url: "https://cdn.example.test/a.mp4" },
        { name: "HLS", title: "Example 720p adaptive", url: "https://cdn.example.test/b.m3u8" }
      ],
      { pageUrl: fixtures.PAGE_URL }
    ),
    { capabilities: caps }
  );
  assert.equal(ranked[0].stream.title, "Example 1080p x264 4 GB");

  const refined = await S.refineWithDecodingInfo(ranked, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async () => ({ supported: false, smooth: false })
  });

  const downgraded = refined.find((entry) => entry.stream.title === "Example 1080p x264 4 GB");
  assert.equal(downgraded.evaluation.state, S.STATE.PROBABLY_READY);
  assert.equal(
    downgraded.why,
    "The device reports it cannot decode this source.",
    "the explanation states what the device just reported"
  );
  // The list the viewer is reading must not rearrange itself under their thumb.
  assert.deepEqual(
    refined.map((entry) => entry.stream.title),
    ["Example 1080p x264 4 GB", "Example 720p adaptive"],
    "a changed verdict never reorders the list"
  );
});

test("an uppercase DV tag is recognised as Dolby Vision", () => {
  // "Movie 2160p DV HEVC" is a common add-on title shape.
  assert.equal(normalize({ title: "Example 2160p DV HEVC", url: "https://cdn.example.test/a.mp4" }).facts.hdr, "Dolby Vision");
  assert.equal(normalize({ title: "example 2160p dv hevc", url: "https://cdn.example.test/a.mp4" }).facts.hdr, "Dolby Vision");
  assert.equal(normalize({ title: "Example 2160p Dolby Vision", url: "https://cdn.example.test/a.mp4" }).facts.hdr, "Dolby Vision");
  // A word merely containing "dv" is not a Dolby Vision tag.
  assert.equal(normalize({ title: "Example Advent 1080p", url: "https://cdn.example.test/a.mp4" }).facts.hdr, "");

  // And it reaches the picker as a stated fact, not as a ranking input.
  const prepared = S.prepare(S.normalizeAll([{ title: "Example 2160p DV HEVC", url: "https://cdn.example.test/a.mp4" }], { pageUrl: fixtures.PAGE_URL }),
    { capabilities: caps });
  assert.equal(prepared[0].stream.facts.hdr, "Dolby Vision");
});

test("the device probe describes the source's real workload", async () => {
  // Asking about 1080p for a 2160p source invites a "smooth" answer the device
  // could not honour at 3840x2160, which would then upgrade the 4K entry.
  const asked = [];
  const capture = async (config) => {
    asked.push({
      contentType: config.video.contentType,
      width: config.video.width,
      height: config.video.height,
      bitrate: config.video.bitrate
    });
    // Reject unless the request matches the entry's actual resolution.
    const ok =
      (/2160/.test(config.video.contentType) && false) ||
      (config.video.width === 3840 && config.video.height === 2160) ||
      (config.video.width === 1280 && config.video.height === 720);
    return { supported: ok, smooth: ok };
  };

  const uhd = S.prepare(
    S.normalizeAll([{ name: "UHD", title: "Example 2160p VP9", url: "https://cdn.example.test/uhd.webm" }], {
      pageUrl: fixtures.PAGE_URL
    }),
    { capabilities: caps }
  );
  await S.refineWithDecodingInfo(uhd, { ...fixtures.androidChromeCapabilities(), decodingInfo: capture });

  assert.equal(asked.length, 1);
  assert.equal(asked[0].width, 3840, "a 2160p source is probed at 3840x2160");
  assert.equal(asked[0].height, 2160);
  assert.ok(asked[0].bitrate >= 20000000, `a 4K bitrate estimate, got ${asked[0].bitrate}`);

  // 720p must not collapse back to the 1080p default.
  asked.length = 0;
  const hd = S.prepare(
    S.normalizeAll([{ name: "HD", title: "Example 720p VP9", url: "https://cdn.example.test/hd.webm" }], {
      pageUrl: fixtures.PAGE_URL
    }),
    { capabilities: caps }
  );
  await S.refineWithDecodingInfo(hd, { ...fixtures.androidChromeCapabilities(), decodingInfo: capture });

  assert.equal(asked.length, 1);
  assert.equal(asked[0].width, 1280, "a 720p source is probed at 1280x720");
  assert.equal(asked[0].height, 720);
  assert.ok(asked[0].bitrate < 8000000, "and with a lower bitrate estimate than 1080p");
});

test("workloads are resolution specific and monotonic", () => {
  const uhd = S.workloadFor({ facts: { resolution: "2160p" } });
  const fhd = S.workloadFor({ facts: { resolution: "1080p" } });
  const hd = S.workloadFor({ facts: { resolution: "720p" } });

  assert.deepEqual([uhd.width, uhd.height], [3840, 2160]);
  assert.deepEqual([fhd.width, fhd.height], [1920, 1080]);
  assert.deepEqual([hd.width, hd.height], [1280, 720]);
  assert.ok(uhd.bitrate > fhd.bitrate && fhd.bitrate > hd.bitrate, "bitrate estimates rise with resolution");
  assert.equal(S.workloadFor({ facts: { resolution: "" } }), null);
});

test("a source with no known resolution is not probed at all", async () => {
  // The workload cannot be described honestly, so no question is asked.
  let asked = 0;
  const noResolution = S.prepare(
    S.normalizeAll([{ name: "Unlabelled", title: "Example VP9 movie", url: "https://cdn.example.test/x.webm" }], {
      pageUrl: fixtures.PAGE_URL
    }),
    { capabilities: caps }
  );
  assert.equal(noResolution[0].stream.facts.resolution, "");
  assert.ok(noResolution[0].evaluation.contentType.includes("codecs="), "it would otherwise qualify");

  await S.refineWithDecodingInfo(noResolution, {
    ...fixtures.androidChromeCapabilities(),
    decodingInfo: async () => {
      asked += 1;
      return { supported: false, smooth: false };
    }
  });
  assert.equal(asked, 0);
  assert.equal(noResolution[0].evaluation.playable, true, "and its synchronous verdict stands");
});


test("MKV and negative browser hints still permit a real playback attempt", async () => {
  const raw = {...fixtures.mkvStream, _addonOrder: 7, behaviorHints: {notWebReady: true}};
  const normalized = normalize(raw);
  assert.equal(normalized.addonOrder, 7);
  const entries = S.prepare([normalized], {capabilities:caps});
  assert.equal(entries[0].evaluation.playable, true);
  await S.refineWithDecodingInfo(entries, {...fixtures.androidChromeCapabilities(), decodingInfo: async()=>({supported:false,smooth:false})});
  assert.equal(entries[0].evaluation.playable, true);
  assert.equal(classify({...raw,url:'javascript:alert(1)'}).playable,false);
});
