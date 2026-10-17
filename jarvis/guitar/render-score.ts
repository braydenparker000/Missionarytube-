import * as alphaTab from '@coderline/alphatab';
import { SongsterrToAlphaTabConverter } from './vendor/songsterr-to-alphatab.converter';

export const SCORE_WIDTH = 840;
export function renderScore(input) {
  const { score, settings, warnings } = new SongsterrToAlphaTabConverter().buildScore(input);
  if (!score.tracks.length || !score.masterBars.length) throw Error('Empty score');
  for (const t of score.tracks) for (const s of t.staves) {
    const program = t.playbackInfo.program;
    const guitar = program >= 24 && program <= 31, bass = program >= 32 && program <= 39;
    s.showStandardNotation = true;
    s.showTablature = !s.isPercussion && s.tuning.length > 0 && (guitar || bass);
    if (guitar || bass) s.displayTranspositionPitch = -12;
    if (bass) for (const b of s.bars) b.clef = alphaTab.model.Clef.F4;
  }
  settings.core.engine = 'svg';
  settings.core.enableLazyLoading = false;
  settings.core.includeNoteBounds = false;
  settings.display.padding = [0, 0, 0, 0];
  settings.display.scale = 1;
  settings.display.stretchForce = 0.65;
  settings.display.systemPaddingTop = 10;
  settings.display.systemPaddingBottom = 14;
  settings.display.effectBandPaddingBottom = 8;
  settings.display.barsPerRow = -1;
  settings.display.resources.secondaryGlyphColor = new alphaTab.model.Color(0, 0, 0);
  settings.display.resources.barNumberColor = new alphaTab.model.Color(65, 65, 65);
  // Header is drawn separately with wrapping; keep alphaTab's tuning/tempo/track labels.
  for (const name of ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic', 'ScoreTranscriber', 'ScoreCopyright']) {
    const key = alphaTab.NotationElement[name];
    if (key !== undefined) settings.notation.elements.set(key, false);
  }
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = SCORE_WIDTH;
  const systems = []; let failure;
  renderer.error.on(e => { failure = e; });
  renderer.partialRenderFinished.on(e => {
    if (typeof e.renderResult === 'string' && e.firstMasterBarIndex >= 0) systems.push({ svg: e.renderResult, width: e.width, height: e.height,
      first: e.firstMasterBarIndex, last: e.lastMasterBarIndex });
  });
  try {
    renderer.renderScore(score, score.tracks.map(t => t.index));
    if (failure) throw failure;
    // Layout errors must fail visibly, never silently omit a system or a measure.
    const covered = new Set();
    for (const s of systems) if (s.first >= 0) for (let i = s.first; i <= s.last; i++) covered.add(i);
    if (!systems.length || covered.size !== score.masterBars.length) throw Error('Incomplete score rendering');
    return { systems, warnings, measures: score.masterBars.length, musicFontSize: settings.display.resources.engravingSettings.musicFontSize };
  } finally { renderer.destroy(); }
}
