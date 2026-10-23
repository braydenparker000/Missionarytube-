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
});

export function loadPrefs(storage = globalThis.localStorage) {
  try { return {...DEFAULTS, ...JSON.parse(storage.getItem(KEY) || '{}')}; } catch { return {...DEFAULTS}; }
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(prefs)); return true; } catch { return false; }
}

/** Converts the stored subtitle settings to the renderer's style. */
export function subtitleStyle(p) {
  return {size: p.subtitleSize / 18, color: p.subtitleColor, background: p.subtitleBackground, outline: p.subtitleOutline, bold: p.subtitleBold, offset: 2 + p.subtitleOffset * 0.2};
}

export const SUBTITLE_COLORS = ['#ffffff', '#ffd54f', '#4dd0e1', '#ef5350', '#66bb6a', '#ba68c8', '#ffa726', '#c6ff00', '#42a5f5', '#000000'];
export const SUBTITLE_BACKGROUNDS = [0, 0.35, 0.55, 0.8];
export const SPEEDS = [1, 1.25, 1.5, 2];
export const ASPECTS = ['fit', 'fill', 'zoom'];
export const ASPECT_LABELS = {fit: 'Fit', fill: 'Fill', zoom: 'Zoom'};
