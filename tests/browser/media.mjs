/**
 * Generate the media the browser check actually plays.
 *
 * Nothing here is committed: real video is produced on demand with ffmpeg so
 * the check exercises a genuine decode, a genuine audio track and a genuine
 * DASH ladder rather than a fixture that only looks like one.
 *
 * Each clip carries a burnt-in frame counter and a distinct audio tone, so a
 * failure shows up as a still picture or silence rather than as a green test.
 *
 * The codecs are VP9 and Opus in WebM rather than H.264 and AAC, because the
 * Chromium that Playwright bundles ships without proprietary codecs. The app
 * never names a codec of its own - it asks `canPlayType` and
 * `MediaSource.isTypeSupported` - so the paths under test are the same ones a
 * real Android Chrome takes with an H.264 stream.
 */
import { execFile } from "node:child_process";
import { mkdir, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The four videos the check plays: short, long, music-shaped, and 1080p. */
export const VIDEOS = [
  { id: "short000001", title: "Short Clip", seconds: 8, tone: 440, heights: [360, 720], author: "Bench Channel" },
  { id: "long0000002", title: "Long Feature", seconds: 45, tone: 330, heights: [360, 720], author: "Bench Channel" },
  { id: "music000003", title: "Rhythm Clip", seconds: 15, tone: 523, heights: [360, 720], author: "Bench Records" },
  { id: "hd108000004", title: "A 1080p Capable Video", seconds: 10, tone: 660, heights: [360, 720, 1080], author: "Bench Studio" }
];

const SIZES = { 360: "640x360", 480: "854x480", 720: "1280x720", 1080: "1920x1080" };
const BITRATES = { 360: "400k", 480: "800k", 720: "1200k", 1080: "2400k" };
// VP9 defaults are far too patient for a check that has to finish.
const FAST_VP9 = ["-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-threads", "4"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function ffmpegPath() {
  // The static build installed for this check, then anything on PATH.
  for (const candidate of [process.env.FFMPEG_PATH, "ffmpeg"]) {
    if (candidate) return candidate;
  }
  return "ffmpeg";
}

async function source(dir, video) {
  const path = join(dir, `${video.id}-source.webm`);
  if (await exists(path)) return path;
  const tallest = SIZES[Math.max(...video.heights)];
  await run(ffmpegPath(), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${tallest}:rate=25:duration=${video.seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=${video.tone}:duration=${video.seconds}`,
    // A frame counter, so a still picture is visible as a still picture.
    "-vf", "drawtext=text='%{frame_num}':fontsize=72:fontcolor=white:x=40:y=40:box=1:boxcolor=black@0.6",
    "-c:v", "libvpx-vp9", ...FAST_VP9, "-b:v", "1500k", "-pix_fmt", "yuv420p", "-g", "50",
    "-c:a", "libopus", "-b:a", "96k", "-ac", "2",
    path
  ], { maxBuffer: 1 << 24 });
  return path;
}

/** One muxed progressive file per height: what `<video src>` gets. */
async function progressive(dir, video, from) {
  const made = [];
  for (const height of video.heights.filter((value) => value <= 720)) {
    const path = join(dir, `${video.id}-${height}.webm`);
    if (!(await exists(path))) {
      await run(ffmpegPath(), [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", from,
        "-s", SIZES[height], "-b:v", BITRATES[height],
        "-c:v", "libvpx-vp9", ...FAST_VP9, "-pix_fmt", "yuv420p",
        "-c:a", "libopus", "-b:a", "96k",
        path
      ], { maxBuffer: 1 << 24 });
    }
    made.push({ height, path, itag: height === 360 ? "18" : "22" });
  }
  return made;
}

/**
 * A real DASH package: separate video representations plus one audio
 * representation, which is the shape adaptive YouTube actually has and the
 * reason Media Source Extensions is involved at all.
 */
async function dash(dir, video, from) {
  const out = join(dir, `${video.id}-dash`);
  const manifest = join(out, "manifest.mpd");
  if (await exists(manifest)) return { dir: out, manifest };
  await mkdir(out, { recursive: true });

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", from];
  video.heights.forEach(() => args.push("-map", "0:v:0"));
  args.push("-map", "0:a:0");
  video.heights.forEach((height, index) => {
    args.push(`-b:v:${index}`, BITRATES[height], `-s:v:${index}`, SIZES[height]);
  });
  args.push(
    "-c:v", "libvpx-vp9", ...FAST_VP9, "-pix_fmt", "yuv420p", "-g", "50", "-keyint_min", "50",
    "-c:a", "libopus", "-b:a", "96k",
    "-adaptation_sets", "id=0,streams=v id=1,streams=a",
    "-dash_segment_type", "webm",
    "-use_template", "1", "-use_timeline", "0", "-seg_duration", "2",
    "-f", "dash", manifest
  );
  await run(ffmpegPath(), args, { maxBuffer: 1 << 24 });
  return { dir: out, manifest };
}

/** A WebVTT caption track, so the caption path is exercised for real. */
async function captions(dir, video) {
  const path = join(dir, `${video.id}.vtt`);
  if (await exists(path)) return path;
  const cues = [];
  for (let at = 0; at + 2 <= video.seconds; at += 2) {
    const stamp = (value) => new Date(value * 1000).toISOString().slice(11, 23);
    cues.push(`${stamp(at)} --> ${stamp(at + 2)}\n${video.title} at ${at}s`);
  }
  await writeFile(path, `WEBVTT\n\n${cues.join("\n\n")}\n`, "utf8");
  return path;
}

/** A poster image, so the cards render with real artwork. */
async function thumbnail(dir, video, from) {
  const path = join(dir, `${video.id}.jpg`);
  if (await exists(path)) return path;
  await run(ffmpegPath(), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", from, "-frames:v", "1", "-s", "640x360", path
  ], { maxBuffer: 1 << 24 });
  return path;
}

/** Build everything, reusing whatever is already on disk. */
export async function buildMedia(dir) {
  await mkdir(dir, { recursive: true });
  const built = [];
  for (const video of VIDEOS) {
    const from = await source(dir, video);
    built.push({
      ...video,
      source: from,
      progressive: await progressive(dir, video, from),
      dash: await dash(dir, video, from),
      captions: await captions(dir, video),
      thumbnail: await thumbnail(dir, video, from)
    });
  }
  return built;
}

/** Whether ffmpeg is usable, so the check can skip rather than fail. */
export async function ffmpegAvailable() {
  try {
    await run(ffmpegPath(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}
