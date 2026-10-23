// The viewer's player preferences, kept in this browser only.

const KEY = 'astra.v2.player';
export const DEFAULTS = Object.freeze({
  aspect: 'fit', // fit | fill | zoom
  holdSpeed: 2,
  gestures: true,
  subtitleSize: 18, // Nuvio's scale: 12..40, 18 = 100%
  subtitleColor: '#ffffff',
  subtitleBackground: 0,
  subtitleOutline: true,
  subtitleBold: false,
  subtitleOffset: 20, // 0..200; 20 sits just above the controls area
  audioLanguage: '', // last chosen audio language, base code
  subtitleLanguage: '', // last chosen subtitle language, '' = off
  pauseOverlay: true,
  orientation: 'auto', // auto (follow the phone) | landscape | portrait
  autoPip: true, // picture-in-picture when leaving the app while playing, where the browser allows it
});
export const ORIENTATIONS = [['auto', 'Follow phone'], ['landscape', 'Landscape'], ['portrait', 'Portrait']];

// localStorage is read inside the try: with site data blocked, even reading the property throws.
export function loadPrefs(storage) {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) || '{}');
    const out = {...DEFAULTS};
    // A damaged value falls back to its default instead of reaching the player.
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [k, v] of Object.entries(saved)) if (!(k in DEFAULTS) || typeof v === typeof DEFAULTS[k]) out[k] = v;
    return out;
  } catch { return {...DEFAULTS}; }
}

export function savePrefs(prefs, storage) {
  try { (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(prefs)); return true; } catch { return false; }
}

/** Converts the stored subtitle settings to the renderer's style. */
export function subtitleStyle(p) {
  return {size: p.subtitleSize / 18, color: p.subtitleColor, background: p.subtitleBackground, outline: p.subtitleOutline, bold: p.subtitleBold, offset: 2 + p.subtitleOffset * 0.2};
}

export const SUBTITLE_COLORS = ['#ffffff', '#ffd54f', '#4dd0e1', '#ef5350', '#66bb6a', '#ba68c8', '#ffa726', '#c6ff00', '#42a5f5', '#000000'];
export const SUBTITLE_COLOR_NAMES = {'#ffffff': 'White', '#ffd54f': 'Yellow', '#4dd0e1': 'Cyan', '#ef5350': 'Red', '#66bb6a': 'Green', '#ba68c8': 'Purple', '#ffa726': 'Orange', '#c6ff00': 'Lime', '#42a5f5': 'Blue', '#000000': 'Black'};
export const SUBTITLE_BACKGROUNDS = [0, 0.35, 0.55, 0.8];
export const SPEEDS = [1, 1.25, 1.5, 2];
export const ASPECTS = ['fit', 'fill', 'zoom'];
export const ASPECT_LABELS = {fit: 'Fit', fill: 'Fill', zoom: 'Zoom'};
