// Claude Player in Chrome: the seek bar's served waveforms, and search
// results opening their levels in the library as the reference does.
// Run: node --test tests/claude-player-search-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPlayer, chrome} from './helpers/claude-player-browser.mjs';

const skip = !chrome && 'Chrome is required';
// A track's served waveform: 500 bars, one peak byte each, with a shape.
const BARS = Uint8Array.from({length: 500}, (_, i) => 20 + Math.round(230 * Math.abs(Math.sin(i / 37))));

test('served waveforms draw the reference way: loudness bins as its 100 bars, old peak bars squared; one landing mid-fade is drawn', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{waveform: BARS}, {waveform: BARS, waveformKind: 'rms'}]});
  const {page} = h;
  await page.waitForFunction(() => window.__cp.player.track?.wave?.length === 500, null, {timeout: 10000});
  const wave = await page.evaluate(() => window.__cp.player.track.wave);
  assert.deepEqual(wave.slice(0, 3), Array.from(BARS.slice(0, 3), x => Math.round((x / 255) ** 2 * 1000) / 1000));
  // The seek bar samples the bars (numBars) by nearest bar.
  await page.waitForFunction(() => { const v = window.__cp.ctx.root.findViewById('waveseek'); return v.values && !v.target; });
  const shown = await page.evaluate(() => Array.from(window.__cp.ctx.root.findViewById('waveseek').values));
  assert.equal(shown.length, 100);
  assert.ok(Math.abs(shown[1] - wave[5]) < 1e-6, 'nearest bar, not the loudest of five');
  // A placeholder fade, then the waveform before it ends: the waveform stays.
  await page.evaluate(() => { const v = window.__cp.ctx.root.findViewById('waveseek'), t = window.__cp.player.track; v.setWave(new Float32Array(100).fill(0.2), true); setTimeout(() => v.setWave(t.wave, true), 50); });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => { const v = window.__cp.ctx.root.findViewById('waveseek'); return v.values && Array.from(v.values); });
  assert.deepEqual(after, shown);
  // The next song's waveform came ahead; it is loudness bins, drawn as the reference's 100 bars.
  await page.waitForFunction(() => window.__cp.library.tracks[1]?.wave?.length === 100, null, {timeout: 10000});
  const {bars, expected} = await page.evaluate(async b => {
    const {barsFromMeanSquares, rmsBytesToMeanSquares} = await import('/claude-player/src/library/waveform.js');
    return {bars: window.__cp.library.tracks[1].wave, expected: barsFromMeanSquares(rmsBytesToMeanSquares(b))};
  }, Array.from(BARS));
  assert.deepEqual(bars, expected);
  assert.deepEqual(h.errors, []);
});

test('an album opened from search results opens in the library under "Search"; up returns to the results', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{title: 'Harbor Light', album: 'Low Tide'}, {title: 'Paper Boat', album: 'Low Tide'}, {title: 'Night Bus', album: 'Orbit'}]});
  const {page} = h;
  const state = () => page.evaluate(() => {
    const lw = window.__cp.ctx.listWidget, top = lw.stack.at(-1), edit = window.__cp.ctx.root.findViewById('search_edit');
    let shown = true;
    for (let v = edit; v; v = v.parent) if (v.visibility !== 0) shown = false;
    return {nav: window.__cp.ctx.topNav.nav, list: lw.libList.source?.title, back: top ? lw.backTitleFor(top) : null, searchBar: shown, query: document.querySelector('.cp-search-input')?.value};
  });
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_lib', null));
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_search', null));
  await page.waitForFunction(() => document.activeElement?.classList.contains('cp-search-input'));
  await page.keyboard.type('low');
  await page.waitForFunction(() => [...window.__cp.ctx.listWidget.libList.children].some(v => v.listIndex >= 0 && v.findViewById?.('title')?.text === 'Low Tide'));
  await page.evaluate(() => { const L = window.__cp.ctx.listWidget.libList; [...L.children].find(v => v.listIndex >= 0 && v.findViewById?.('title')?.text === 'Low Tide').onClick(); });
  await page.waitForTimeout(800);
  assert.deepEqual(await state(), {nav: 'nav_lib', list: 'Low Tide', back: 'Search', searchBar: false, query: 'low'});
  // The back decor (cmd_list_up_nav) goes up: the same results, in search.
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_up_nav', null));
  await page.waitForFunction(() => window.__cp.ctx.topNav.nav === 'nav_search');
  await page.waitForTimeout(500);
  const back = await state();
  assert.equal(back.searchBar, true);
  assert.equal(back.query, 'low');
  assert.equal(back.list, 'Search');
  // Back again leaves search for the library it was opened from.
  await page.goBack();
  await page.waitForFunction(() => window.__cp.ctx.topNav.nav === 'nav_lib');
  assert.equal((await state()).list, 'Library');
  assert.deepEqual(h.errors, []);
});

test('the search categories can be put in any order: chips and result sections follow, and it is kept', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{title: 'Low Song', album: 'Low Tide'}, {title: 'Other', album: 'Low Tide'}]});
  const {page} = h;
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_search', null));
  await page.waitForFunction(() => document.activeElement?.classList.contains('cp-search-input'));
  await page.keyboard.type('low');
  const view = () => page.evaluate(() => ({chips: window.__cp.ctx.searchCats.children.map(b => b.text).slice(0, 3), sections: window.__cp.ctx.listWidget.libList.source.rows.filter(r => r.sep).map(r => r.sep)}));
  await page.waitForFunction(() => window.__cp.ctx.listWidget.libList.source?.rows?.some(r => r.sep));
  assert.deepEqual(await view(), {chips: ['All', 'Albums', 'Artists'], sections: ['Albums', 'All Songs']});
  // All Songs (category 8) first, then the reference's order.
  await page.evaluate(async () => { const m = await import('/claude-player/src/widgets/search.js'); m.setSearchOrder(window.__cp.ctx, [8, 0, 1, 2, 3, 4, 5, 6, 7, 9]); });
  await page.waitForFunction(() => window.__cp.ctx.listWidget.libList.source?.rows?.find(r => r.sep)?.sep === 'All Songs');
  assert.deepEqual(await view(), {chips: ['All', 'All Songs', 'Albums'], sections: ['All Songs', 'Albums']});
  assert.equal(await page.evaluate(() => localStorage.getItem('cp-search-order')), '[8,0,1,2,3,4,5,6,7,9]');
  // The List Options rows come in the same order, each with its handle.
  await page.evaluate(() => window.__cp.ctx.listWidget.openListOptionsFor('search'));
  await page.waitForTimeout(600);
  const handles = await page.evaluate(() => [...document.querySelectorAll('[aria-label^="Move "]')].map(e => e.getAttribute('aria-label')).slice(0, 2));
  assert.deepEqual(handles, ['Move All Songs', 'Move Albums']);
  // A stored order that is not a whole set of categories is ignored.
  assert.deepEqual(await page.evaluate(async () => { localStorage.setItem('cp-search-order', '[1,1,2]'); return (await import('/claude-player/src/widgets/search.js')).searchOrder(); }), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(h.errors, []);
});
