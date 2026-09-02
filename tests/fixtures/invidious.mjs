/**
 * Invidious API response shapes, as the real API returns them.
 *
 * Hosts are reserved test names so nothing here can resolve to a real server,
 * but the field names, nesting and quirks are the ones the client has to cope
 * with: `type` discriminators on search results, `videoThumbnails` arrays,
 * `formatStreams` versus `adaptiveFormats`, and codec strings inside `type`.
 */

export const PRIVATE_INSTANCE = "https://invidious.example.test";
export const PUBLIC_A = "https://public-a.example.test";
export const PUBLIC_B = "https://public-b.example.test";
export const PUBLIC_C = "https://public-c.example.test";

export const TEST_CONFIG = {
  privateInvidiousUrl: PRIVATE_INSTANCE,
  publicFallbackInstances: [PUBLIC_A, PUBLIC_B, PUBLIC_C]
};

const GOOGLE = "https://r1---sn-example.googlevideo.test/videoplayback";

/** A signed progressive URL, with the `expire` parameter Google really sends. */
export function progressiveUrl(itag, expireSeconds) {
  return `${GOOGLE}?expire=${expireSeconds}&itag=${itag}&mime=video%2Fmp4&source=youtube`;
}

export function thumbnails(id) {
  return [
    { quality: "maxres", url: `https://images.example.test/vi/${id}/maxres.jpg`, width: 1280, height: 720 },
    { quality: "medium", url: `https://images.example.test/vi/${id}/medium.jpg`, width: 320, height: 180 }
  ];
}

/** A search result row for a video. */
export function searchVideo(id, title, overrides = {}) {
  return {
    type: "video",
    title,
    videoId: id,
    author: "Example Channel",
    authorId: "UCexampleexampleexample",
    authorUrl: "/channel/UCexampleexampleexample",
    videoThumbnails: thumbnails(id),
    description: "A description returned by the instance.",
    descriptionHtml: "<b>never read</b>",
    viewCount: 1234567,
    published: 1_600_000_000,
    publishedText: "3 years ago",
    lengthSeconds: 213,
    liveNow: false,
    premium: false,
    isUpcoming: false,
    ...overrides
  };
}

export function searchChannel(id = "UCchannelchannelchannel") {
  return {
    type: "channel",
    author: "Example Channel",
    authorId: id,
    authorUrl: `/channel/${id}`,
    authorThumbnails: [{ url: `https://images.example.test/ch/${id}.jpg`, width: 176, height: 176 }],
    subCount: 512000,
    videoCount: 340,
    description: "Channel description."
  };
}

export function searchPlaylist(id = "PLexampleexample") {
  return {
    type: "playlist",
    title: "Example Playlist",
    playlistId: id,
    author: "Example Channel",
    authorId: "UCexampleexampleexample",
    videoCount: 2,
    videos: [
      { title: "First", videoId: "aaaaaaaaaaa", lengthSeconds: 100, videoThumbnails: thumbnails("aaaaaaaaaaa") },
      { title: "Second", videoId: "bbbbbbbbbbb", lengthSeconds: 200, videoThumbnails: thumbnails("bbbbbbbbbbb") }
    ]
  };
}

/**
 * A full video record.
 *
 * The default is the common modern shape: exactly one progressive format at
 * 360p, with everything above it only available as separate video-only and
 * audio-only adaptive streams.
 */
export function videoDetail(id = "dQw4w9WgXcQ", overrides = {}) {
  const expire = Math.floor(Date.now() / 1000) + 21600;
  return {
    title: "An Example Video",
    videoId: id,
    videoThumbnails: thumbnails(id),
    description: "Line one.\nLine two.",
    descriptionHtml: "<b>never read</b>",
    published: 1_600_000_000,
    publishedText: "3 years ago",
    viewCount: 8675309,
    likeCount: 42000,
    author: "Example Channel",
    authorId: "UCexampleexampleexample",
    authorUrl: "/channel/UCexampleexampleexample",
    subCountText: "1.2M",
    lengthSeconds: 213,
    liveNow: false,
    isUpcoming: false,
    genre: "Music",
    dashUrl: `${PRIVATE_INSTANCE}/api/manifest/dash/id/${id}`,
    formatStreams: [
      {
        url: progressiveUrl(18, expire),
        itag: "18",
        type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        quality: "medium",
        container: "mp4",
        encoding: "h264",
        qualityLabel: "360p",
        resolution: "360p",
        size: "640x360",
        bitrate: 560000,
        fps: 30
      }
    ],
    adaptiveFormats: [
      {
        url: progressiveUrl(140, expire),
        itag: "140",
        type: 'audio/mp4; codecs="mp4a.40.2"',
        container: "m4a",
        encoding: "aac",
        bitrate: 129000,
        clen: "3456789",
        audioQuality: "AUDIO_QUALITY_MEDIUM",
        audioSampleRate: 44100,
        audioChannels: 2
      },
      {
        url: progressiveUrl(137, expire),
        itag: "137",
        type: 'video/mp4; codecs="avc1.640028"',
        container: "mp4",
        encoding: "h264",
        qualityLabel: "1080p",
        resolution: "1080p",
        bitrate: 4400000,
        clen: "45678901",
        fps: 30
      },
      {
        url: progressiveUrl(136, expire),
        itag: "136",
        type: 'video/mp4; codecs="avc1.4d401f"',
        container: "mp4",
        encoding: "h264",
        qualityLabel: "720p",
        resolution: "720p",
        bitrate: 2200000,
        clen: "22345678",
        fps: 30
      },
      {
        url: progressiveUrl(135, expire),
        itag: "135",
        type: 'video/mp4; codecs="avc1.4d401e"',
        container: "mp4",
        encoding: "h264",
        qualityLabel: "480p",
        resolution: "480p",
        bitrate: 1100000,
        clen: "11345678",
        fps: 30
      },
      {
        url: progressiveUrl(571, expire),
        itag: "571",
        type: 'video/mp4; codecs="av01.0.13M.08"',
        container: "mp4",
        encoding: "av01",
        qualityLabel: "4320p",
        resolution: "4320p",
        bitrate: 40000000,
        clen: "400000000",
        fps: 60
      }
    ],
    captions: [
      { label: "English", languageCode: "en", url: `/api/v1/captions/${id}?label=English` },
      { label: "Deutsch", languageCode: "de", url: `/api/v1/captions/${id}?label=Deutsch` }
    ],
    recommendedVideos: [searchVideo("ccccccccccc", "Something else")],
    ...overrides
  };
}

/** A live broadcast: HLS, no progressive and no usable DASH. */
export function liveDetail(id = "liveaaaaaaa") {
  return videoDetail(id, {
    title: "A Live Broadcast",
    liveNow: true,
    lengthSeconds: 0,
    dashUrl: "",
    hlsUrl: `${PRIVATE_INSTANCE}/api/manifest/hls_playlist/id/${id}/itag/0/local/true.m3u8`,
    formatStreams: [],
    adaptiveFormats: []
  });
}

export const STATS = {
  version: "2.0",
  software: { name: "invidious", version: "2024.01.01", branch: "master" },
  openRegistrations: false,
  usage: { users: { total: 100, activeHalfyear: 10, activeMonth: 5 } }
};
