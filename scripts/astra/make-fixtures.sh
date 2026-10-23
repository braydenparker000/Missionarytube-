#!/usr/bin/env bash
# Regenerates the synthetic media in tests/fixtures/astra/ used by the Astra
# playback tests. Every file is a 6 s colour-bar test pattern with sine tones,
# so a test can tell audio tracks apart by pitch: 440 Hz, 880 Hz, 660 Hz,
# 1320 Hz. Requires ffmpeg with libx264, libx265, libvpx and libopus, and Node.
# Usage: bash scripts/astra/make-fixtures.sh
set -euo pipefail
out="$(cd "$(dirname "$0")/../.." && pwd)/tests/fixtures/astra"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

D=6
video=(-f lavfi -i "testsrc2=size=320x180:rate=24:duration=$D")
tone() { echo "-f lavfi -i sine=frequency=$1:sample_rate=48000:duration=$D"; }
x264=(-c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -g 48 -keyint_min 48 -sc_threshold 0 -b:v 120k -bf 2)

cat > "$work/en.srt" <<'SRT'
1
00:00:01,000 --> 00:00:02,500
Hello from Astra

2
00:00:03,000 --> 00:00:04,500
<i>Second</i> line
SRT

cat > "$work/ja.ass" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1
Style: Sign,Arial,16,&H0000FFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,8,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Konnichiwa{\i1} Astra{\i0}
Dialogue: 0,0:00:01.00,0:00:05.00,Sign,,0,0,0,,{\an8}Top sign
ASS

# H.264 with AAC (English, 440 Hz) and AC-3 5.1 (Spanish, 880 Hz), an SRT and an ASS track.
ff "${video[@]}" $(tone 440) $(tone 880) -i "$work/en.srt" -i "$work/ja.ass" \
  -map 0:v -map 1:a -map 2:a -map 3:s -map 4:s "${x264[@]}" \
  -c:a:0 aac -b:a:0 64k -c:a:1 ac3 -ac:a:1 6 -b:a:1 192k -c:s:0 srt -c:s:1 ass \
  -metadata:s:a:0 language=eng -metadata:s:a:0 title=English -metadata:s:a:1 language=spa -metadata:s:a:1 title="Español 5.1" \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=jpn -metadata:s:s:1 title=Signs \
  -disposition:a:0 default -disposition:a:1 0 -disposition:s:0 0 -disposition:s:1 0 \
  "$out/multi-audio.mkv"

# E-AC-3 (English, 660 Hz) and DTS (German, 1320 Hz).
ff "${video[@]}" $(tone 660) $(tone 1320) -map 0:v -map 1:a -map 2:a "${x264[@]}" \
  -c:a:0 eac3 -b:a:0 96k -c:a:1 dca -strict -2 -ac:a:1 2 -ar:a:1 48000 -b:a:1 768k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=ger -disposition:a:0 default -disposition:a:1 0 \
  "$out/surround.mkv"

# TrueHD first (no decoder in a browser) and an AAC stereo track (440 Hz).
ff "${video[@]}" $(tone 880) $(tone 440) -map 0:v -map 1:a -map 2:a "${x264[@]}" \
  -c:a:0 truehd -strict -2 -c:a:1 aac -b:a:1 64k \
  -metadata:s:a:0 language=eng -metadata:s:a:0 title="TrueHD 7.1" -metadata:s:a:1 language=eng -metadata:s:a:1 title=Stereo \
  -disposition:a:0 default -disposition:a:1 0 \
  "$out/truehd.mkv"

# MP4 with one AAC track: plays natively.
ff "${video[@]}" $(tone 440) -map 0:v -map 1:a "${x264[@]}" -c:a aac -b:a 64k -movflags +faststart "$out/single.mp4"

# MP4 with two AAC tracks: needs the remux path to choose.
ff "${video[@]}" $(tone 440) $(tone 880) -map 0:v -map 1:a -map 2:a "${x264[@]}" -c:a aac -b:a 64k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=fra -disposition:a:0 default -disposition:a:1 0 -movflags +faststart \
  "$out/dual.mp4"

# HEVC: playable only where the browser has an HEVC decoder.
ff "${video[@]}" $(tone 440) -map 0:v -map 1:a -c:v libx265 -preset ultrafast -tag:v hvc1 -x265-params log-level=error:keyint=48 -b:v 100k -c:a aac -b:a 64k \
  "$out/hevc.mkv"

# VP9 and Opus in WebM: plays natively.
ff "${video[@]}" $(tone 440) -map 0:v -map 1:a -c:v libvpx-vp9 -b:v 100k -g 48 -deadline realtime -cpu-used 8 -c:a libopus -b:a 64k "$out/vp9.webm"

# Picture subtitles. ffmpeg cannot draw text into pictures, so a tiny Blu-ray
# stream (two coloured boxes, 1-2.5 s and 3-4.5 s) is written by script, muxed
# as PGS, then converted picture-to-picture into DVD (VobSub) subtitles.
node "$(dirname "$0")/pgs-fixture.mjs" "$work/boxes.sup"
ff "${video[@]}" $(tone 440) -copyts -i "$work/boxes.sup" -map 0:v -map 1:a -map 2:s "${x264[@]}" -c:a aac -b:a 64k -c:s copy \
  -metadata:s:s:0 language=eng "$out/pgs.mkv"
ff -fix_sub_duration -i "$out/pgs.mkv" -map 0 -c:v copy -c:a copy -c:s dvdsub -metadata:s:s:0 language=spa "$out/vobsub.mkv"

# MP4 with a 3GPP timed text track: goes through Astra so the text can be read.
ff "${video[@]}" $(tone 440) -i "$work/en.srt" -map 0:v -map 1:a -map 2:s "${x264[@]}" -c:a aac -b:a 64k -c:s mov_text \
  -metadata:s:s:0 language=eng -movflags +faststart "$out/text.mp4"

# No cue index (nocues.mkv), and the same written like a live recording with
# clusters of unknown size (live.mkv), which Mediabunny cannot demux.
ff "${video[@]}" $(tone 440) -i "$work/en.srt" -map 0:v -map 1:a -map 2:s "${x264[@]}" -g 24 -c:a aac -b:a 64k -c:s srt \
  -metadata:s:s:0 language=eng -live 1 -cluster_time_limit 1000 "$out/nocues.mkv"
node "$(dirname "$0")/unknown-size.mjs" "$out/nocues.mkv" "$out/live.mkv"

# Only TrueHD audio: no sound is possible in a browser ("Play without sound").
ff "${video[@]}" $(tone 880) -map 0:v -map 1:a "${x264[@]}" -c:a truehd -strict -2 -metadata:s:a:0 language=eng -metadata:s:a:0 title="TrueHD 7.1" "$out/truehd-only.mkv"

# MPEG-TS (unpacked by Astra) and AVI (Mediabunny cannot read it; the software decoder can).
ff "${video[@]}" $(tone 440) -map 0:v -map 1:a "${x264[@]}" -c:a aac -b:a 64k -f mpegts "$out/stream.ts"
ff "${video[@]}" $(tone 440) -map 0:v -map 1:a "${x264[@]}" -bf 0 -c:a mp3 -b:a 64k "$out/h264.avi"

# HLS with a WebVTT subtitle rendition (hls/master.m3u8): the stream's own subtitles.
printf '1\n00:00:01,000 --> 00:00:02,500\nHello from HLS\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond HLS line\n' > "$work/hls.srt"
rm -rf "$out/hls" && mkdir -p "$out/hls"
ff "${video[@]}" $(tone 440) -i "$work/hls.srt" -map 0:v -map 1:a -map 2:s "${x264[@]}" -c:a aac -b:a 64k -c:s webvtt -metadata:s:s:0 language=eng \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_filename "$out/hls/s%v_%03d.ts" -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,s:0,sgroup:subs,language:eng,name:English" "$out/hls/s%v.m3u8"

ls -l "$out"
