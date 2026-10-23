// Handing a stream to another app on the phone (VLC, MX Player, Just Player…)
// for files no browser can play. Android shows its app chooser; the title
// and the position to start from go along as intent extras.

export const canOpenExternally = (ua = globalThis.navigator?.userAgent || '') => /Android/i.test(ua);

/** An Android intent address for a stream, or null when the address cannot be handed over. */
export function externalPlayerUrl(url, {title = '', position = 0} = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const extras = ['action=android.intent.action.VIEW', 'type=video/*'];
  if (title) extras.push(`S.title=${encodeURIComponent(title)}`);
  if (position > 1) extras.push(`i.position=${Math.round(position * 1000)}`);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};${extras.join(';')};end`;
}
