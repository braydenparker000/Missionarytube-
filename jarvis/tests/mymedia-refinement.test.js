import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { progressBarMarkup } from '../public/mymedia/presentation.js';

const cssUrl = new URL('../public/mymedia/mymedia.css', import.meta.url);
const htmlUrl = new URL('../public/mymedia/index.html', import.meta.url);
const appUrl = new URL('../public/mymedia/app.js', import.meta.url);

test('progressBarMarkup is empty without progress, accessible with it', () => {
  assert.equal(progressBarMarkup(0), '');
  assert.equal(progressBarMarkup(null), '');
  assert.equal(progressBarMarkup(undefined), '');
  const bar = progressBarMarkup(62.44);
  assert.match(bar, /role="progressbar"/);
  assert.match(bar, /aria-valuenow="62"/);
  assert.match(bar, /aria-valuemin="0"/);
  assert.match(bar, /aria-valuemax="100"/);
  assert.match(bar, /aria-label="Watched 62 percent"/);
  assert.match(bar, /data-progress="62.4"/, 'paintBars still finds its hook');
  // Clamped to the valid range.
  assert.match(progressBarMarkup(140), /aria-valuenow="100"/);
  assert.match(progressBarMarkup(140), /data-progress="100.0"/);
  for (const invalid of [-5, NaN, Infinity, -Infinity, '20']) assert.equal(progressBarMarkup(invalid), '');
});

test('card() renders progress through progressBarMarkup', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /import\s*\{[^}]*progressBarMarkup[^}]*\}\s*from\s*['"]\.\/presentation\.js['"]/);
  assert.match(app, /progressBarMarkup\(percent\)/);
  assert.doesNotMatch(app, /<span class="bar"><span data-progress/);
});

test('library toolbar wraps search/sort and filters as one sticky unit', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  const css = await readFile(cssUrl, 'utf8');
  // The toolbar wraps both rows: search/sort first, filters second.
  const toolbarStart = html.indexOf('class="library-toolbar"');
  const toolsStart = html.indexOf('id="library-search"');
  const filtersStart = html.indexOf('id="browse-filters"');
  assert.ok(toolbarStart > 0 && toolsStart > toolbarStart && filtersStart > toolsStart,
    'toolbar contains the search/sort row followed by the filter row');
  assert.match(css, /\.library-toolbar\{[^}]*position:sticky/, 'toolbar sticks');
  assert.match(css, /\.library-toolbar\{[^}]*top:calc\(64px \+ env\(safe-area-inset-top\)\)/,
    'toolbar parks below the sticky topbar');
  assert.match(css, /\.library-toolbar\{[^}]*z-index:7/, 'toolbar slides under the topbar (z-index 8)');
  assert.match(css, /\.library-toolbar\{[^}]*background:#101113/, 'opaque background over scrolled content');
});

test('touch targets meet the 44px minimum', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /\.library-tools input\{[^}]*min-height:44px/, 'search input');
  assert.match(css, /\.library-tools select\{[^}]*min-height:44px/, 'sort select');
  assert.match(css, /\.discovery-filters button\{[^}]*min-height:44px/, 'filter chips');
  assert.match(css, /\.video-menu\{[^}]*min-height:48px/, 'card menu button');
});

test('reduced-motion disables smooth scrolling and transitions', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const block = css.match(/@media\(prefers-reduced-motion:reduce\)\{([\s\S]*?)\}\s*$/);
  assert.ok(block, 'a reduced-motion block exists');
  assert.match(block[1], /scroll-behavior:auto/);
  assert.match(block[1], /transition:none/);
});

test('card hierarchy: title leads, creator and status stay ordered', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const titleSize = css.match(/\.video-card strong\{[^}]*font-size:(\d+)px/);
  const creatorSize = css.match(/\.card-creator\{[^}]*font-size:(\d+)px/);
  assert.ok(titleSize && creatorSize, 'both sizes are set');
  assert.ok(Number(titleSize[1]) > Number(creatorSize[1]), 'title is larger than creator');
});

test('focus and compact-height safeguards are scoped to My Media', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /\.media-page select:focus-visible\{outline:2px solid var\(--accent\)/);
  assert.match(css, /\.discovery-filters\{[^}]*padding:5px 5px 8px/);
  assert.match(css, /@media\(max-height:540px\)\{\s*\.library-toolbar\{position:static\}/);
  assert.match(css, /a\.card-creator\{min-height:44px;line-height:44px\}/);
  assert.match(css, /height:4px;background:#23262b/);
  assert.match(css, /\.compact-media-viewport \.library-toolbar\{position:static\}/);
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /window\.visualViewport\?\.addEventListener\('resize', updateCompactViewport\)/);
});
