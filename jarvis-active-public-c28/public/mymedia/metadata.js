// Original YouTube dates are separate from Drive/archive timestamps.
// A date-only upload_date is kept in UTC so it cannot shift on the phone.
export function youtubeUploadDate(value) {
  const text = String(value || '');
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (!match || Number(match[1]) < 2005 || Number(match[1]) >= 2200) return 0;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const stamp = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === iso ? stamp : 0;
}

export function youtubeDate(row = {}) {
  const upload = youtubeUploadDate(row.upload_date || row.youtubeUploadDate);
  if (upload) return {youtubeAt:upload, youtubeDateKind:'upload'};
  // timestamp means the video became available; epoch is extraction time.
  const stamp = Number(row.timestamp) * 1000;
  const iso = typeof row.youtubePublishedAt === 'string' ? row.youtubePublishedAt : '';
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(iso);
  const published = parts && youtubeUploadDate(parts[1]) && Number(parts[2]) < 24 && Number(parts[3]) < 60 && Number(parts[4]) < 60 ? Date.parse(iso) : 0;
  const value = published || stamp;
  return Number.isFinite(value) && value >= Date.UTC(2005, 0, 1) && value < Date.UTC(2200, 0, 1)
    ? {youtubeAt:value, youtubeDateKind:'published'} : {youtubeAt:0, youtubeDateKind:''};
}

export function savedYouTubeDate(video) {
  return Number.isFinite(video.youtubeAt) && video.youtubeAt >= Date.UTC(2005, 0, 1) && video.youtubeAt < Date.UTC(2200, 0, 1) &&
    ['upload','published'].includes(video.youtubeDateKind)
    ? {youtubeAt:video.youtubeAt, youtubeDateKind:video.youtubeDateKind} : {youtubeAt:0, youtubeDateKind:''};
}
