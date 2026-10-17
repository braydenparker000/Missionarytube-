import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {browseCountText} from '../public/mymedia/presentation.js';

const appUrl = new URL('../public/mymedia/app.js', import.meta.url);

test('browseCountText uses shown-of-total wording only when the grid is paginated', () => {
  assert.equal(browseCountText(60, 120), '60 of 120 videos');
  assert.equal(browseCountText(120, 180), '120 of 180 videos');
  assert.equal(browseCountText(1, 3), '1 of 3 videos');
  assert.equal(browseCountText(60, 60), '60 videos', 'everything on screen: no redundant "of"');
  assert.equal(browseCountText(120, 120), '120 videos');
  assert.equal(browseCountText(5, 5), '5 videos');
  assert.equal(browseCountText(1, 1), '1 video');
  assert.equal(browseCountText(0, 0), '0 videos');
});

test('the focused view renders the browse count through browseCountText', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /import\s*\{[^}]*browseCountText[^}]*\}\s*from\s*['"]\.\/presentation\.js['"]/);
  assert.match(app, /<p class="browse-count">\$\{browseCountText\(shown\.length,items\.length\)\}<\/p>/,
    'focused count is "N of M videos" when paginated, "N videos" otherwise');
  // The grid shows exactly the counted subset: shown-of-total can never drift.
  assert.match(app, /const items=videos, shown=items\.slice\(0,pageLimit\);/);
});

test('the browse count is not a live region and adds no competing count', async () => {
  const app = await readFile(appUrl, 'utf8');
  const countLine = app.split('\n').find(line => line.includes('class="browse-count"'));
  assert.ok(countLine, 'a .browse-count template exists');
  assert.ok(!/role=|aria-live|aria-atomic/.test(countLine), 'no live-region announcement on the count');
  assert.equal((app.match(/browse-count/g) || []).length, 1,
    'only the single template sets the count — nothing else was added');
});

test('empty focused results keep their wording and carry no count', async () => {
  const app = await readFile(appUrl, 'utf8');
  // The focused branch is one ternary: count template when items exist,
  // the media-empty template otherwise — the empty side renders no count.
  assert.match(app, /items\.length\?`<p class="browse-count">[^`]*`:`<div class="media-empty">[^`]*`/);
  assert.match(app, /No matching videos/);
  assert.match(app, /Save something for later/);
});

test('pagination behavior is unchanged by the wording pass', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /\$\('load-more'\)\.hidden=items\.length<=pageLimit;/);
  assert.match(app, /\$\('load-more'\)\.onclick=\(\)=>\{pageLimit\+=60;/);
});

test('#status still carries freshness/loading/error states, not counts', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /status\(library \? 'Checking Drive for new videos…' : 'Loading your videos…'\);/);
  assert.match(app, /Showing the last saved list\./);
  assert.match(app, /function summary\(\) \{\s*\n?\s*if \(!library\) return '';/);
  assert.match(app, /updated \$\{when\.toLocaleString/);
  const statusFn = /function status\(text, error = false, el = \$\('status'\)\)/.test(app);
  assert.ok(statusFn, '#status still receives loading, error, and cached/offline states');
});

test('creator-directory counts stay distinct from video-result counts', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /<span class="folder-total">\$\{g\.items\.length\}<\/span>/,
    'folder shelves keep their own totals');
  assert.ok(app.includes("<small>${group.items.length} video${group.items.length===1?'':'s'}</small>"),
    'creator directory links keep their own video counts');
});
