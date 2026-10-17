import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {youtubeDate, youtubeUploadDate, savedYouTubeDate} from '../public/mymedia/metadata.js';
import {enrichVideos} from '../public/mymedia/discovery.js';
import {sortVideos, parseLibrary} from '../public/mymedia/library.js';
import {creatorGroups, knownCreators, videoPresentation} from '../public/mymedia/presentation.js';

test('original YouTube dates reject invalid calendars and extraction/Drive timestamps',()=>{
  assert.equal(youtubeUploadDate('20130228'),Date.UTC(2013,1,28));
  assert.equal(youtubeUploadDate('2013-02-28'),Date.UTC(2013,1,28));
  for(const value of ['20250229','20261301','2026-1-2','20040101','99991231','bad',null])assert.equal(youtubeUploadDate(value),0);
  assert.deepEqual(youtubeDate({youtubePublishedAt:'2026-02-30T00:00:00Z'}),{youtubeAt:0,youtubeDateKind:''});
  assert.deepEqual(youtubeDate({epoch:1790000000,createdTime:'2026-10-01',addedAt:1790000000000}),{youtubeAt:0,youtubeDateKind:''});
  assert.deepEqual(youtubeDate({upload_date:'20130228',timestamp:1790000000}),{youtubeAt:Date.UTC(2013,1,28),youtubeDateKind:'upload'});
  assert.deepEqual(youtubeDate({timestamp:1700000000}),{youtubeAt:1700000000000,youtubeDateKind:'published'});
  assert.deepEqual(savedYouTubeDate({youtubeAt:1790000000000,youtubeDateKind:'drive'}),{youtubeAt:0,youtubeDateKind:''});
});

test('YouTube sorts put undated videos last in both directions and preserve archive order',()=>{
  const videos=[{id:'a',title:'Unknown',addedAt:99,duration:0}, {id:'b',title:'Older',youtubeAt:10,addedAt:100,duration:60}, {id:'c',title:'Latest',youtubeAt:20,addedAt:1,duration:300}];
  const original=structuredClone(videos);
  assert.deepEqual(sortVideos(videos,'youtube-newest').map(v=>v.id),['c','b','a']);
  assert.deepEqual(sortVideos(videos,'youtube-oldest').map(v=>v.id),['b','c','a']);
  assert.deepEqual(sortVideos(videos,'newest').map(v=>v.id),['b','a','c']);
  assert.deepEqual(sortVideos(videos,'shortest').map(v=>v.id),['b','c','a']);
  assert.deepEqual(sortVideos(videos,'longest').map(v=>v.id),['c','b','a']);
  assert.deepEqual(videos,original);
});

test('enrichment keeps original YouTube date separate and cached dates remain validated',()=>{
  const video={id:'video123456789',youtubeId:'abcdefghijk',name:'Video.mp4',title:'Video',folder:'Videos',addedAt:1790000000000};
  const [enriched]=enrichVideos([video],{videos:[{youtubeId:'abcdefghijk',upload_date:'20100506',creator:'Creator'}]});
  assert.equal(enriched.youtubeAt,Date.UTC(2010,4,6));assert.equal(enriched.addedAt,video.addedAt);
  assert.equal(enriched.youtubeDateKind,'upload');
  const cache=parseLibrary(JSON.stringify({id:'folder123456789',name:'Videos',videos:[enriched]}));
  assert.equal(cache.videos[0].youtubeAt,Date.UTC(2010,4,6));
});

test('a folder alone is not represented as a creator; grounded case-insensitive prefixes work',()=>{
  const library={name:'Videos',videos:[{title:'StampyLongHead - An episode',folder:'Videos'}, {title:'Another episode',folder:'Videos/stampylonghead'}, {title:'A playlist video',folder:'Videos/Weekend playlist'}]};
  const creators=knownCreators(library);
  assert.equal(videoPresentation(library.videos[0],creators).creator,'stampylonghead');
  assert.deepEqual(creatorGroups(library,creators).map(g=>[g.name,g.items.length]),[['stampylonghead',1]]);
});

test('metadata builder preserves yt-dlp upload_date without treating epoch as the upload',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mymedia-dates-'));
  try{
    await writeFile(join(dir,'one.info.json'),JSON.stringify({id:'abcdefghijk',channel:'Creator',upload_date:'20100506',epoch:1790000000}));
    await writeFile(join(dir,'two.info.json'),JSON.stringify({id:'lmnopqrstuv',channel:'Creator',epoch:1790000000}));
    execFileSync(process.execPath,['scripts/build-video-metadata.mjs',dir]);
    const result=JSON.parse(await readFile(join(dir,'jarvis-video-metadata.json'),'utf8'));
    assert.equal(result.version,2);assert.equal(result.videos[0].youtubeUploadDate,'2010-05-06');
    assert.equal(result.videos[0].addedAt,1790000000000);
    assert.equal(result.videos[1].youtubeUploadDate,undefined);
  }finally{await rm(dir,{recursive:true,force:true});}
});
