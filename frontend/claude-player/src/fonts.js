// Font registry: maps reference font resources/families to CSS families and
// the metrics FastTextView needs (bounding-box top/bottom, "Z" bounds), all in
// font units so they scale with the text size.

const TT_BOLD = {family: 'cp-ttnorms', weight: 700, upm: 950, yMax: 1010, yMin: -450, zTop: 620, zBottom: -80};
const TT_MEDIUM = {family: 'cp-ttnorms', weight: 500, upm: 950, yMax: 1080, yMin: -225, zTop: 700, zBottom: 0};
const M3_REGULAR = {family: 'cp-manrope3', weight: 400, upm: 1060, yMax: 956, yMin: -255, zTop: 720, zBottom: 0};
const M3_MEDIUM = {family: 'cp-manrope3', weight: 500, upm: 1060, yMax: 963, yMin: -253, zTop: 719, zBottom: 0};
const M3_EXTRABOLD = {family: 'cp-manrope3', weight: 800, upm: 1060, yMax: 1005, yMin: -295, zTop: 720, zBottom: 0};
// Platform sans-serif (Roboto) on Android; Chrome on Android resolves sans-serif to the same family.
const SYS = w => ({family: 'sans-serif', weight: w, upm: 2048, yMax: 2163, yMin: -555, zTop: 1456, zBottom: 0, system: true});

export const FONT_FACES = [
  {family: 'cp-ttnorms', weight: 700, file: 'fonts/tt-norms-pro-bold.otf'},
  {family: 'cp-ttnorms', weight: 500, file: 'fonts/tt-norms-pro-medium.otf'},
  {family: 'cp-manrope3', weight: 400, file: 'fonts/manrope3-regular.otf'},
  {family: 'cp-manrope3', weight: 500, file: 'fonts/manrope3-medium.otf'},
  {family: 'cp-manrope3', weight: 800, file: 'fonts/manrope3-extrabold.otf'},
];

const RESOURCE_FONTS = {
  ttnormspro_bold: () => TT_BOLD,
  ttnormspro_medium: () => TT_MEDIUM,
  manrope_regular_smaller: () => M3_REGULAR,
  manrope_medium_smaller: () => M3_MEDIUM,
  manrope_extrabold_smaller: () => M3_EXTRABOLD,
  // Family resource: regular, with the extra-bold face for bold text.
  manrope_smaller: bold => (bold ? M3_EXTRABOLD : M3_REGULAR),
  // Not bundled (lyrics only); the platform face stands in and is reported as a substitute.
  shantellsans_light: () => ({...SYS(300), substitute: 'Shantell Sans Light'}),
};

/**
 * Resolves a font descriptor from fontFamily (string or @font ref), textStyle
 * (0 normal, 1 bold, 2 italic) and typeface.
 */
export function resolveFont(fontFamily, textStyle = 0) {
  const bold = (textStyle & 1) !== 0;
  const italic = (textStyle & 2) !== 0;
  let f = null;
  if (fontFamily) {
    const m = /^@font\/(.+)$/.exec(fontFamily);
    if (m && RESOURCE_FONTS[m[1]]) f = RESOURCE_FONTS[m[1]](bold);
    else if (fontFamily === 'sans-serif-medium') f = SYS(500);
    else if (fontFamily === 'sans-serif-light') f = SYS(300);
    else if (fontFamily === 'sans-serif-thin') f = SYS(100);
    else if (fontFamily === 'sans-serif-black') f = SYS(900);
    else if (fontFamily.startsWith('sans-serif-condensed')) f = {...SYS(fontFamily.endsWith('medium') ? 500 : 400), stretch: 'condensed'};
    else if (fontFamily === 'monospace') f = {...SYS(400), family: 'monospace'};
    else if (fontFamily === 'serif') f = {...SYS(400), family: 'serif'};
  }
  if (!f) f = SYS(400);
  let weight = f.weight;
  // Synthetic bold applies only when the face itself is lighter than bold.
  if (bold && weight < 600) weight = f.system ? 700 : weight;
  return {...f, weight, italic};
}

/** Android Paint.FontMetricsInt top/bottom (floor/ceil) for a size in px. */
export function fontMetricsInt(font, sizePx) {
  const top = Math.floor((-font.yMax / font.upm) * sizePx);
  const bottom = Math.ceil((-font.yMin / font.upm) * sizePx);
  return {top, bottom};
}

/** Paint.getTextBounds("Z") top/bottom relative to the baseline. */
export function zBounds(font, sizePx) {
  return {top: Math.floor((-font.zTop / font.upm) * sizePx), bottom: Math.ceil((-font.zBottom / font.upm) * sizePx)};
}

export function cssFontFamily(font) {
  return font.family === 'sans-serif' || font.family === 'monospace' || font.family === 'serif'
    ? font.family
    : `"${font.family}",sans-serif`;
}

/** Waits for the bundled faces (declared in app.css) to load. */
export async function loadFonts() {
  await Promise.all(FONT_FACES.map(f => document.fonts.load(`${f.weight} 16px "${f.family}"`).catch(() => null)));
}
