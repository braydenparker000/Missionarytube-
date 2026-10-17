import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {knownCreators, videoPresentation, sortDisplayedVideos} from '../public/mymedia/presentation.js';

test('archive channel prefixes are split only when grounded in a collection or explicit metadata', () => {
  const library = {name:'YouTube Videos', videos:[
    {title:'The Backlogs - A challenge - Part 2', folder:'YouTube Videos'},
    {title:'An older challenge', folder:'YouTube Videos/The Backlogs'},
    {title:'Guitar - A melody', folder:'YouTube Videos/Guitar', creator:'A musician'}
  ]};
  const creators = knownCreators(library);
  const original = structuredClone(library);
  assert.deepEqual(videoPresentation(library.videos[0], creators), {title:'A challenge - Part 2', creator:'The Backlogs', collection:'YouTube Videos'});
  assert.deepEqual(videoPresentation(library.videos[1], creators), {title:'An older challenge', creator:'', collection:'The Backlogs'});
  assert.equal(videoPresentation({title:'Unknown - A title', folder:'Videos'}, creators).title, 'Unknown - A title');
  assert.equal(videoPresentation({title:'Unknown - A title', folder:'Videos'}, creators).creator, '');
  assert.deepEqual(library, original, 'presentation never changes library records');
});

test('explicit creator metadata wins; ambiguous titles and missing metadata stay honest', () => {
  assert.deepEqual(videoPresentation({title:'Actual channel - A video', creator:'Actual channel', folder:'Videos'}, []), {title:'A video', creator:'Actual channel', collection:'Videos'});
  assert.deepEqual(videoPresentation({title:'Folder name - A video', creator:'Actual channel', folder:'Videos'}, ['Folder name']), {title:'Folder name - A video',creator:'Actual channel',collection:'Videos'});
  assert.equal(videoPresentation({title:'Actual channel - ', creator:'Actual channel'}, []).title, 'Actual channel - ');
  assert.equal(videoPresentation({title:'Title - With a hyphen', folder:'Videos'}, []).title, 'Title - With a hyphen');
  assert.deepEqual(videoPresentation({title:'A plain filename'}, []), {title:'A plain filename', creator:'', collection:''});
  assert.deepEqual(knownCreators(null), []);
});

test('the layout keeps the native player, honest details, visible search, and scoped styles', async () => {
  const html = await readFile(new URL('../public/mymedia/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/mymedia/mymedia.css', import.meta.url), 'utf8');
  assert.match(html, /id="library-search" role="search"/);
  assert.match(html, /<video id="video" controls playsinline preload="metadata">/);
  assert.match(html, /class="watch-main"/);
  assert.match(html, /class="shelf watch-next"/);
  assert.match(html, /id="video-details"[^>]*hidden/);
  assert.match(css, /\.video-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.media-page #player-view\{display:grid/);
  assert.ok(!/\.video-menu\{[^}]*100vw/.test(css), 'menus do not depend on viewport arithmetic');
  assert.ok(!/\sstyle=/.test(html), 'the page still respects its strict CSP');
});

test('Title sorting follows visible titles while other sorts and stored records stay unchanged', () => {
  const videos = [{title:'Bob Ross - Zebra',id:'a',modified:1,duration:120},
    {title:'ScrapMan - Apple 10',id:'b',modified:3,duration:360},
    {title:'ScrapMan - Apple 2',id:'c',modified:2,duration:240}];
  assert.deepEqual(sortDisplayedVideos(videos,'title',['Bob Ross','ScrapMan']).map(v=>v.id),['c','b','a']);
  assert.deepEqual(sortDisplayedVideos(videos,'newest').map(v=>v.id),['b','c','a']);
  assert.deepEqual(sortDisplayedVideos(videos,'longest').map(v=>v.id),['b','c','a']);
  assert.equal(videos[0].title,'Bob Ross - Zebra');
});
