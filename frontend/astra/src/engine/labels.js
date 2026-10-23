// Names people recognise for codecs and channel layouts.

const VIDEO_NAMES = {avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', prores: 'ProRes'};
const AUDIO_NAMES = {aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', dts: 'DTS'};
// Codecs Mediabunny reads as "unknown", named by their container ids.
const INTERNAL_NAMES = {
  A_TRUEHD: 'Dolby TrueHD', A_MLP: 'MLP', 'A_DTS/LOSSLESS': 'DTS-HD MA', 'A_DTS/EXPRESS': 'DTS Express', A_ALAC: 'ALAC',
  A_MPEG: 'MPEG audio', 'A_REAL/COOK': 'RealAudio', V_MPEG2: 'MPEG-2', V_MPEG1: 'MPEG-1', 'V_MPEG4/ISO/ASP': 'MPEG-4 (Xvid/DivX)',
  'V_MPEG4/ISO/SP': 'MPEG-4 Part 2', 'V_MS/VFW/FOURCC': 'Video for Windows (Xvid/DivX)', 'V_REAL/RV40': 'RealVideo',
  V_THEORA: 'Theora', V_MPEGH_ISO_HEVC: 'HEVC', mp4v: 'MPEG-4 Part 2', 'ac-4': 'Dolby AC-4', mlpa: 'Dolby TrueHD',
};

export function videoCodecName(track) {
  return VIDEO_NAMES[track.codec] || INTERNAL_NAMES[track.internalCodec] || String(track.internalCodec || 'Unknown video');
}
export function audioCodecName(track) {
  if (track.codec?.startsWith('pcm')) return 'PCM';
  return AUDIO_NAMES[track.codec] || INTERNAL_NAMES[track.internalCodec] || String(track.internalCodec || 'Unknown audio');
}
export function channelName(n) {
  return ({1: 'Mono', 2: 'Stereo', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1'})[n] || (n ? n + ' channels' : '');
}
