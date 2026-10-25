// Claude Player in Chrome: the seek bar's served waveforms, and search
// results opening their levels in the library as the reference does.
// Run: node --test tests/claude-player-search-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {openPlayer, chrome} from './helpers/claude-player-browser.mjs';

const skip = !chrome && 'Chrome is required';
// A track's served waveform: 500 bars, one peak byte each, with a shape.
const BARS = Uint8Array.from({length: 500}, (_, i) => 20 + Math.round(230 * Math.abs(Math.sin(i / 37))));

test('a served waveform keeps every bar, and one landing mid-fade is drawn', {skip}, async t => {
  const h = await openPlayer(t, {tracks: [{waveform: BARS}, {waveform: BARS}]});
  const {page} = h;
  await page.waitForFunction(() => window.__cp.player.track?.wave?.length === 500, null, {timeout: 10000});
  const wave = await page.evaluate(() => window.__cp.player.track.wave);
  assert.deepEqual(wave.slice(0, 3), Array.from(BARS.slice(0, 3), x => Math.round(x / 255 * 1000) / 1000));
  // The seek bar samples the bars (numBars), as for the index's inline waveforms.
  await page.waitForFunction(() => { const v = window.__cp.ctx.root.findViewById('waveseek'); return v.values && !v.target; });
  const shown = await page.evaluate(() => Array.from(window.__cp.ctx.root.findViewById('waveseek').values));
  assert.equal(shown.length, 100);
  assert.ok(Math.abs(shown[1] - wave[5]) < 1e-6, 'nearest bar, not the loudest of five');
  // A placeholder fade, then the waveform before it ends: the waveform stays.
  await page.evaluate(() => { const v = window.__cp.ctx.root.findViewById('waveseek'), t = window.__cp.player.track; v.setWave(new Float32Array(100).fill(0.2), true); setTimeout(() => v.setWave(t.wave, true), 50); });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => { const v = window.__cp.ctx.root.findViewById('waveseek'); return v.values && Array.from(v.values); });
  assert.deepEqual(after, shown);
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
