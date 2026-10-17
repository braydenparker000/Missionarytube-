import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseName, createVideoApi, mediaURL, thumbnails, parseLibrary, parseProgress, recordProgress, resumeTime,
  continueWatching, searchVideos, sortVideos, groupByFolder, formatDuration, srtToVtt} from '../public/mymedia/library.js';
import {apps} from '../public/assets/hub.js';

const key = 'AIza' + 'x'.repeat(35), root = 'folder123456789', child = 'child1234567890';
const folder = {id:root, name:'Videos', mimeType:'application/vnd.google-apps.folder'};
const file = (id, name, extra = {}) => ({id, name, mimeType:'video/mp4', size:'1000', modifiedTime:'2026-09-22T03:19:32Z', ...extra});

test('parses yt-dlp names and keeps titles without an ID', () => {
  assert.deepEqual(parseName('Bob Ross - Secluded Bridge (Season 10 Episode 4) [vrAMRxBB5KI].mp4'),
    {title:'Bob Ross - Secluded Bridge (Season 10 Episode 4)', youtubeId:'vrAMRxBB5KI'});
  assert.deepEqual(parseName('ScrapMan - This Castle Hide and Seek has Some Tricky Spots.mp4'),
    {title:'ScrapMan - This Castle Hide and Seek has Some Tricky Spots', youtubeId:''});
  assert.equal(parseName('Not an id [short].mkv').youtubeId, '');
});

test('lists every page and subfolder, keeps only videos and pairs sidecars', async () => {
  const calls = [];
  const responses = [folder,
    {files:[file('video1234567890', 'One [abcdefghijk].mp4', {videoMediaMetadata:{durationMillis:'61500', width:1920, height:1080}}),
      {id:'subtitle123456', name:'One [abcdefghijk].en.vtt', mimeType:'text/vtt'},
      {id:'imagefile12345', name:'One [abcdefghijk].webp', mimeType:'image/webp'},
      {id:'notes123456789', name:'notes.txt', mimeType:'text/plain'},
      {id:child, name:'Bob Ross', mimeType:'application/vnd.google-apps.folder'}], nextPageToken:'next'},
    {files:[file('video2234567890', 'Two.webm', {thumbnailLink:'https://lh3.googleusercontent.com/drive-storage/abc'}),
      file('locked12345678', 'Locked.mp4', {capabilities:{canDownload:false}})]},
    {files:[file('video3234567890', 'Three.mkv', {thumbnailLink:'https://evil.test/x.jpg'})]}];
  const api = createVideoApi(key, async (url, options) => { calls.push({url:new URL(url), options}); return Response.json(responses.shift()); });
  const result = await api.list('https://drive.google.com/drive/folders/' + root + '?usp=sharing');
  assert.deepEqual(result.videos.map(v => v.id), ['video1234567890', 'video2234567890', 'video3234567890']);
  const [one, two, three] = result.videos;
  assert.equal(one.duration, 62); assert.equal(one.height, 1080); assert.equal(one.youtubeId, 'abcdefghijk');
  assert.deepEqual(one.subtitles, [{id:'subtitle123456', lang:'en', format:'vtt'}]);
  assert.equal(one.image, 'imagefile12345');
  assert.equal(two.thumbnail, 'https://lh3.googleusercontent.com/drive-storage/abc');
  assert.equal(three.folder, 'Videos/Bob Ross'); assert.equal(three.thumbnail, '', 'foreign thumbnail hosts are dropped');
  assert.equal(calls[2].url.searchParams.get('pageToken'), 'next');
  assert.ok(calls.every(c => c.url.origin === 'https://www.googleapis.com' && c.options.credentials === 'omit'));
});

test('a failed page rejects the whole listing, and errors are readable', async () => {
  const responses = [Response.json(folder), Response.json({files:[], nextPageToken:'next'}), Response.json({error:{}}, {status:403})];
  await assert.rejects(createVideoApi(key, async () => responses.shift()).list(root), /Anyone with the link/);
  await assert.rejects(createVideoApi(key, async () => Response.json({error:{}}, {status:404})).list(root), /not found/);
  await assert.rejects(createVideoApi(key, async () => Response.json({...folder, mimeType:'video/mp4'})).list(root), /not a folder/);
  assert.throws(() => createVideoApi(''), /not configured/);
  await assert.rejects(createVideoApi(key).list("x' in parents"), /folder link/);
});

test('repeated pagination tokens stop instead of looping', async () => {
  let call = 0;
  const api = createVideoApi(key, async () => Response.json(call++ === 0 ? folder : {files:[], nextPageToken:'again'}));
  await assert.rejects(api.list(root), /pagination repeated/);
  assert.equal(call, 3);
});

test('media and thumbnail URLs stay on Google hosts, in fallback order', () => {
  const url = new URL(mediaURL('video1234567890', key));
  assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/drive/v3/files/video1234567890');
  assert.equal(url.searchParams.get('alt'), 'media');
  assert.throws(() => mediaURL('../x', key));
  assert.deepEqual(thumbnails({image:'imagefile12345', youtubeId:'abcdefghijk', thumbnail:'https://lh3.googleusercontent.com/a'}, key).map(u => new URL(u).host),
    ['www.googleapis.com', 'i.ytimg.com', 'lh3.googleusercontent.com']);
  assert.deepEqual(thumbnails({youtubeId:'', thumbnail:''}, key), []);
});

test('progress resumes mid-video, resets near the end and keeps watched', () => {
  const at = recordProgress(null, 300, 1000, false, 5);
  assert.deepEqual(at, {t:300, d:1000, done:false, at:5});
  assert.equal(resumeTime(at), 300);
  assert.equal(resumeTime(recordProgress(null, 5, 1000)), 0, 'barely started');
  const near = recordProgress(at, 950, 1000);
  assert.equal(near.done, true); assert.equal(resumeTime(near), 0);
  const ended = recordProgress(at, 1000, 1000, true);
  assert.equal(ended.t, 0); assert.equal(ended.done, true);
  assert.equal(recordProgress(ended, 20, NaN).done, true, 'rewatching keeps the watched mark');
  assert.equal(recordProgress(ended, 20, NaN).d, 1000);
});

test('stored data is validated before use', () => {
  assert.deepEqual(parseProgress('{"video1234567890":{"t":5,"d":10,"at":1},"bad id!":{"t":1,"d":2},"video2234567890":{"t":"x"}}'),
    {video1234567890:{t:5, d:10, done:false, at:1}});
  assert.deepEqual(parseProgress('not json'), {});
  assert.deepEqual(parseProgress('[]'), {});
  assert.equal(parseLibrary('{"id":"x"}'), null);
  assert.equal(parseLibrary('{"id":"x","videos":[]}'), null);
  const saved = JSON.stringify({id:root,name:'Videos',fetched:1,videos:[
    {id:'video1234567890',name:'One.mp4',title:'One',folder:'Videos',image:'bad id!',subtitles:[{id:'subtitle123456',lang:'en',format:'vtt'},null]},
    {id:'bad id!',title:'Broken',folder:'Videos'}]});
  assert.equal(parseLibrary(saved,child),null,'a cache from another folder is not used');
  const restored=parseLibrary(saved,root);
  assert.deepEqual(restored.videos.map(v=>v.id),['video1234567890']);
  assert.equal(restored.videos[0].image,null);
  assert.deepEqual(restored.videos[0].subtitles,[{id:'subtitle123456',lang:'en',format:'vtt'}]);
});

test('continue watching, search, sort and folder sections', () => {
  const videos = [
    {id:'a', title:'Bob Ross - Winter Mist', folder:'Videos', modified:1, duration:1500},
    {id:'b', title:'Dark Souls hammers', folder:'Videos', modified:3, duration:4000},
    {id:'c', title:'Episode 10', folder:'Videos/Bob Ross', modified:2, duration:60},
    {id:'d', title:'Episode 9', folder:'Videos/Bob Ross', modified:4, duration:60}];
  const progress = {a:{t:100, d:1500, at:1}, b:{t:200, d:4000, at:9}, c:{t:59, d:60, done:true, at:10}};
  assert.deepEqual(continueWatching(videos, progress).map(v => v.id), ['b', 'a']);
  assert.deepEqual(searchVideos(videos, 'bob winter').map(v => v.id), ['a']);
  assert.deepEqual(searchVideos(videos, 'ROSS').map(v => v.id), ['a', 'c', 'd'], 'folder names are searchable');
  assert.deepEqual(sortVideos(videos, 'newest').map(v => v.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(sortVideos(videos, 'title').map(v => v.id), ['a', 'b', 'd', 'c'], 'numbers sort naturally');
  assert.deepEqual(sortVideos(videos, 'longest').map(v => v.id)[0], 'b');
  assert.deepEqual(groupByFolder(videos, 'Videos').map(g => [g.label, g.items.length]), [['All videos', 2], ['Bob Ross', 2]]);
});

test('formats durations and converts SRT subtitles', () => {
  assert.equal(formatDuration(62), '1:02');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(NaN), '0:00');
  assert.equal(srtToVtt('﻿1\r\n00:00:01,500 --> 00:00:02,000\r\nHi\r\n'), 'WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.000\nHi\n');
  assert.equal(srtToVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nHi'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nHi');
});

test('launcher entry, folder config and page security policy are in place', async () => {
  assert.ok(apps.some(a => a.id === 'mymedia' && a.href === '/mymedia/' && a.group === 'Library'));
  const drive = JSON.parse(await readFile(new URL('../public/assets/drive-config.json', import.meta.url), 'utf8'));
  assert.equal(drive.apiKey, '', 'no key is committed');
  assert.match(drive.videoFolderId, /^[A-Za-z0-9_-]{10,}$/);
  const config = JSON.parse(await readFile(new URL('../public/staticwebapp.config.json', import.meta.url), 'utf8'));
  const csp = config.routes.find(r => r.route === '/mymedia*').headers['Content-Security-Policy'];
  for (const need of ["media-src 'self' blob: https://www.googleapis.com", "connect-src 'self' https://www.googleapis.com", 'https://i.ytimg.com', "'wasm-unsafe-eval'"]) assert.ok(csp.includes(need), need);
  assert.ok(!/unsafe-inline/.test(csp));
  const html = await readFile(new URL('../public/mymedia/index.html', import.meta.url), 'utf8');
  assert.ok(!/\sstyle=/.test(html), 'no inline styles under this CSP');
  assert.match(html, /mymedia-release" content="0\.38\.0"/);
  assert.match(html, /id="toggle-folders"/);
  const app = await readFile(new URL('../public/mymedia/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/mymedia/mymedia.css', import.meta.url), 'utf8');
  assert.match(app, /<details class="folder-shelf"/);
  assert.match(app, /OPEN_FOLDERS_KEY/);
  assert.match(css, /\.thumb img\{position:relative;z-index:1/,
    'loaded thumbnails render above the placeholder layer');
});

test('a refused Drive request is reported instead of switching decoders', async () => {
  const {driveProblem} = await import('../public/mymedia/player.js');
  const reply = status => async (url, init) => { assert.equal(init.headers.Range, 'bytes=0-0'); return new Response('x', {status}); };
  assert.equal(await driveProblem('https://www.googleapis.com/x', reply(206)), '');
  assert.match(await driveProblem('https://www.googleapis.com/x', reply(403)), /refused/);
  assert.match(await driveProblem('https://www.googleapis.com/x', reply(404)), /no longer in Drive/);
  assert.match(await driveProblem('https://www.googleapis.com/x', async () => { throw TypeError('offline'); }), /connection/);
});


test('My Media reports a second silent stall after its one retry', async () => {
  const {play}=await import('../public/mymedia/player.js');
  const events=new Map(),errors=[],modes=[];
  const media={src:'',paused:false,ended:false,currentTime:0,
    addEventListener(type,fn){const list=events.get(type)||[];list.push(fn);events.set(type,list)},
    removeEventListener(type,fn){events.set(type,(events.get(type)||[]).filter(x=>x!==fn))},
    emit(type){for(const fn of events.get(type)||[])fn()},
    play(){this.paused=false;this.emit('play');return Promise.resolve()},
    pause(){this.paused=true},
    removeAttribute(){this.src=''},
    load(){}};
  const done=new Promise(resolve=>{
    const handle=play(media,'https://www.googleapis.com/file',{stallMs:5,retryDelayMs:1,
      onMode:mode=>modes.push(mode),onError:message=>{errors.push(message);resolve(handle)}});
    media.emit('waiting');
  });
  const handle=await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('stall was never reported')),500))]);
  assert.deepEqual(modes,['native','retrying']);
  assert.equal(errors.length,1);
  assert.match(errors[0],/stopped loading/);
  handle.close();
});

test('My Media manages PiP shutdown', async () => {

  const app = await readFile(new URL('../public/mymedia/app.js', import.meta.url), 'utf8');
  assert.match(app, /enterpictureinpicture/);
  assert.match(app, /leavepictureinpicture/);
  assert.match(app, /document\.visibilityState === 'hidden'/);
  assert.match(app, /stop:stopPlayback/);
});
