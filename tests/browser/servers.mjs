/**
 * The world the browser check runs against.
 *
 * Four servers, because the distinctions between them are exactly what the
 * feature depends on:
 *
 *   invidious   the API and the compatibility proxy. Sends CORS headers.
 *   google      the direct progressive host. Sends **no** CORS headers at
 *               all, which is the point: a `<video src>` load is not a CORS
 *               request, and that is why direct progressive playback works
 *               with nothing in between.
 *   addon       a Stremio add-on, so existing playback can be checked too.
 *   app         the site itself, served as static files.
 *
 * Only the remote services are substituted. The browser, the media element,
 * Media Source Extensions, dash.js, the DOM and every line of the app are
 * real.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".m4s": "video/iso.segment",
  ".mpd": "application/dash+xml",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".vtt": "text/vtt; charset=utf-8",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function cors(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "range, content-type, accept");
  response.setHeader("access-control-expose-headers", "content-length, content-range, accept-ranges");
}

function json(response, body, status = 200) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": TYPES[".json"], "content-length": Buffer.byteLength(text) });
  response.end(text);
}

/**
 * Serve a file, honouring Range. Seeking is a range request, so a server that
 * ignores them makes the scrubber look broken for reasons that have nothing to
 * do with the player.
 */
async function sendFile(request, response, path, { withCors = true, log } = {}) {
  let info;
  try {
    info = await stat(path);
  } catch {
    response.writeHead(404).end("not found");
    return;
  }
  if (withCors) cors(response);
  const type = TYPES[extname(path).toLowerCase()] || "application/octet-stream";
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("content-type", type);

  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) {
        response.writeHead(416, { "content-range": `bytes */${info.size}` }).end();
        return;
      }
      if (log) log({ path, range: [start, end] });
      response.writeHead(206, {
        "content-range": `bytes ${start}-${end}/${info.size}`,
        "content-length": end - start + 1
      });
      createReadStream(path, { start, end }).pipe(response);
      return;
    }
  }
  if (log) log({ path, range: null });
  response.writeHead(200, { "content-length": info.size });
  createReadStream(path).pipe(response);
}

function safeJoin(root, urlPath) {
  const cleaned = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  return join(root, cleaned);
}

/* ---- Invidious ---------------------------------------------------------- */

function videoThumbnails(origin, id) {
  return [
    { quality: "maxres", url: `${origin}/vi/${id}/maxres.jpg`, width: 1280, height: 720 },
    { quality: "medium", url: `${origin}/vi/${id}/medium.jpg`, width: 320, height: 180 }
  ];
}

function searchRow(origin, video) {
  return {
    type: "video",
    title: video.title,
    videoId: video.id,
    author: video.author,
    authorId: "UCbenchbenchbenchbenchbe",
    videoThumbnails: videoThumbnails(origin, video.id),
    description: `${video.title}: a generated clip used to prove playback really happens.`,
    descriptionHtml: `<b>${video.title}</b>`,
    viewCount: 100000 + video.seconds * 137,
    published: 1_600_000_000,
    publishedText: "3 years ago",
    lengthSeconds: video.seconds,
    liveNow: false,
    isUpcoming: false
  };
}

function videoRecord(origin, googleOrigin, video) {
  const expire = Math.floor(Date.now() / 1000) + 21600;
  return {
    ...searchRow(origin, video),
    likeCount: 4321,
    subCountText: "12K",
    genre: "Film & Animation",
    // The manifest lives on this instance, which is what makes it usable: MSE
    // fetches its segments from JavaScript and needs CORS to do it.
    dashUrl: `${origin}/api/manifest/dash/id/${video.id}`,
    // The progressive URLs point straight at the CORS-less media host, which
    // is the whole reason progressive needs no proxy.
    formatStreams: video.progressive.map((entry) => ({
      url: `${googleOrigin}/videoplayback?expire=${expire}&id=${video.id}&itag=${entry.itag}&mime=video%2Fwebm`,
      itag: entry.itag,
      type: 'video/webm; codecs="vp9, opus"',
      container: "webm",
      encoding: "vp9",
      qualityLabel: `${entry.height}p`,
      resolution: `${entry.height}p`,
      bitrate: entry.height * 2000,
      fps: 25
    })),
    adaptiveFormats: [
      {
        url: `${googleOrigin}/videoplayback?expire=${expire}&id=${video.id}&itag=251`,
        itag: "251",
        type: 'audio/webm; codecs="opus"',
        container: "webm",
        encoding: "opus",
        bitrate: 96000,
        audioQuality: "AUDIO_QUALITY_MEDIUM",
        audioChannels: 2
      },
      ...video.heights.map((height) => ({
        url: `${googleOrigin}/videoplayback?expire=${expire}&id=${video.id}&itag=${height}`,
        itag: String(height),
        type: 'video/webm; codecs="vp9"',
        container: "webm",
        encoding: "vp9",
        qualityLabel: `${height}p`,
        resolution: `${height}p`,
        bitrate: height * 3000,
        fps: 25
      }))
    ],
    captions: [{ label: "English", languageCode: "en", url: `/api/v1/captions/${video.id}?label=English` }],
    recommendedVideos: []
  };
}

/**
 * `behaviour` lets one test make this instance misbehave without restarting
 * anything: `"down"` refuses everything, which is how failover is proved.
 */
export async function startInvidious({ media, googleOrigin, behaviour = { mode: "ok" }, name = "invidious" }) {
  const byId = new Map(media.map((video) => [video.id, video]));
  const requests = [];
  const state = behaviour;
  let origin = "";

  const handle = async (request, response) => {
    const url = new URL(request.url, origin);
    requests.push({ name, path: url.pathname, search: url.search });

    if (request.method === "OPTIONS") {
      cors(response);
      response.writeHead(204).end();
      return;
    }
    if (state.mode === "down") {
      cors(response);
      json(response, { message: "service unavailable" }, 503);
      return;
    }
    if (state.mode === "hang") {
      return; // never answers; the request's own timeout has to fire
    }

    if (url.pathname === "/api/v1/stats") {
      cors(response);
      json(response, { version: "2.0", software: { name: "invidious", version: "bench" }, usage: { users: { total: 1 } } });
      return;
    }

    if (url.pathname === "/api/v1/search") {
      const wanted = (url.searchParams.get("q") || "").toLowerCase();
      const hits = media.filter((video) => video.title.toLowerCase().includes(wanted) || wanted === "all");
      cors(response);
      json(response, hits.map((video) => searchRow(origin, video)));
      return;
    }

    if (url.pathname === "/api/v1/trending") {
      cors(response);
      json(response, media.map((video) => searchRow(origin, video)));
      return;
    }

    const videoMatch = /^\/api\/v1\/videos\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
    if (videoMatch) {
      const video = byId.get(videoMatch[1]);
      cors(response);
      if (!video) return json(response, { error: "This video is unavailable" }, 404);
      return json(response, videoRecord(origin, googleOrigin, video));
    }

    const captionMatch = /^\/api\/v1\/captions\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
    if (captionMatch) {
      const video = byId.get(captionMatch[1]);
      if (!video) return void response.writeHead(404).end();
      return sendFile(request, response, video.captions);
    }

    // The DASH manifest, with a BaseURL so its relative segment names resolve
    // to this instance rather than to the manifest's own directory.
    const manifestMatch = /^\/api\/manifest\/dash\/id\/([A-Za-z0-9_-]{11})$/.exec(url.pathname);
    if (manifestMatch) {
      const video = byId.get(manifestMatch[1]);
      if (!video) return void response.writeHead(404).end();
      const body = (await readFile(video.dash.manifest, "utf8")).replace(
        /(<Period[^>]*>)/,
        `$1\n\t\t<BaseURL>${origin}/dash/${video.id}/</BaseURL>`
      );
      cors(response);
      response.writeHead(200, { "content-type": TYPES[".mpd"], "content-length": Buffer.byteLength(body) });
      response.end(body);
      return;
    }

    const segmentMatch = /^\/dash\/([A-Za-z0-9_-]{11})\/([\w.-]+)$/.exec(url.pathname);
    if (segmentMatch) {
      const video = byId.get(segmentMatch[1]);
      if (!video) return void response.writeHead(404).end();
      return sendFile(request, response, join(video.dash.dir, segmentMatch[2]));
    }

    // The proxied progressive path: the same itag, re-resolved and served by
    // the instance. This is the recovery route when a signed URL will not play.
    if (url.pathname === "/latest_version") {
      const video = byId.get(url.searchParams.get("id") || "");
      const itag = url.searchParams.get("itag");
      const entry = video && video.progressive.find((item) => item.itag === itag);
      if (!entry) return void response.writeHead(404).end();
      return sendFile(request, response, entry.path);
    }

    const thumbMatch = /^\/vi\/([A-Za-z0-9_-]{11})\//.exec(url.pathname);
    if (thumbMatch) {
      const video = byId.get(thumbMatch[1]);
      if (!video) return void response.writeHead(404).end();
      return sendFile(request, response, video.thumbnail);
    }

    cors(response);
    json(response, { error: "no such endpoint" }, 404);
  };

  const started = await listen((request, response) => {
    handle(request, response).catch(() => {
      try {
        response.writeHead(500).end();
      } catch {
        /* the socket may already be gone */
      }
    });
  });
  origin = started.origin;
  return { ...started, requests, state, name };
}

/**
 * The direct media host. It deliberately sends no CORS headers, so anything
 * that needs them here will fail exactly as it would against Google.
 */
export async function startGoogle({ media }) {
  const byId = new Map(media.map((video) => [video.id, video]));
  const requests = [];
  const state = { mode: "ok" };

  const started = await listen((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push({ name: "google", path: url.pathname, search: url.search, range: request.headers.range || null });

    if (url.pathname !== "/videoplayback") {
      response.writeHead(404).end();
      return;
    }
    if (state.mode === "forbidden") {
      // What a signed URL bound to another address actually returns.
      response.writeHead(403).end("forbidden");
      return;
    }
    const video = byId.get(url.searchParams.get("id") || "");
    const itag = url.searchParams.get("itag");
    const entry = video && video.progressive.find((item) => item.itag === itag);
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    sendFile(request, response, entry.path, { withCors: false });
  });
  return { ...started, requests, state, name: "google" };
}

/** A Stremio add-on, so existing playback is checked against a real source. */
export async function startAddon({ media }) {
  const video = media[0];
  let origin = "";
  const meta = {
    id: "tt-bench-0001",
    type: "movie",
    name: "An Add-on Movie",
    poster: "",
    background: "",
    description: "Served by the mock add-on, to prove existing playback is unchanged.",
    releaseInfo: "2024"
  };

  const started = await listen((request, response) => {
    const url = new URL(request.url, origin || "http://127.0.0.1");
    cors(response);
    if (url.pathname === "/manifest.json") {
      return json(response, {
        id: "test.bench.addon",
        version: "1.0.0",
        name: "Bench Add-on",
        description: "Local add-on for the browser check",
        resources: ["catalog", "meta", "stream"],
        types: ["movie"],
        catalogs: [{ type: "movie", id: "bench", name: "Bench Catalog", extra: [{ name: "search" }] }]
      });
    }
    if (url.pathname.startsWith("/catalog/")) {
      return json(response, { metas: [{ ...meta, poster: `${origin}/poster.jpg` }] });
    }
    if (url.pathname.startsWith("/meta/")) {
      return json(response, { meta: { ...meta, poster: `${origin}/poster.jpg` } });
    }
    if (url.pathname.startsWith("/stream/")) {
      return json(response, {
        streams: [
          {
            name: "Bench",
            title: "An Add-on Movie 720p VP9 WebM",
            url: `${origin}/movie.webm`,
            behaviorHints: { filename: "an-add-on-movie-720p.webm" }
          }
        ]
      });
    }
    if (url.pathname === "/movie.webm") {
      return sendFile(request, response, video.progressive.find((entry) => entry.height === 720).path);
    }
    if (url.pathname === "/poster.jpg") {
      return sendFile(request, response, video.thumbnail);
    }
    response.writeHead(404).end();
  });
  origin = started.origin;
  return { ...started, manifest: `${started.origin}/manifest.json`, name: "addon" };
}

/** The app itself, plus the two player runtimes it loads on demand. */
export async function startApp({ root, libs }) {
  const started = await listen(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") return sendFile(request, response, join(root, "index.html"));
    if (url.pathname.startsWith("/libs/")) {
      const file = libs[url.pathname.slice(6)];
      if (!file) return void response.writeHead(404).end();
      return sendFile(request, response, file);
    }
    return sendFile(request, response, safeJoin(root, url.pathname));
  });
  return { ...started, name: "app" };
}

export function stopAll(servers) {
  return Promise.all(
    servers.map((entry) => new Promise((resolve) => entry.server.close(resolve)))
  );
}
