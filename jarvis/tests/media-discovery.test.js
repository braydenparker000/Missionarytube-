import test from 'node:test';
import assert from 'node:assert/strict';
import {discover,withinTime,enrichVideos} from '../public/mymedia/discovery.js';
const videos=Array.from({length:24},(_,i)=>({id:'video'+i,title:'Video '+i,folder:'Library/'+(i%3),duration:i===0?0:(i+1)*100,youtubeId:'id'+i,name:'Video '+i+'.mp4'}));
test('discovery varies collections, excludes watched videos and stays stable for a day',()=>{
 const progress={video4:{done:true}},one=discover(videos,progress,12,'2026-10-03');
 assert.equal(new Set(one.map(v=>v.id)).size,12);
 assert.ok(!one.some(v=>v.id==='video4'));
 assert.equal(new Set(one.slice(0,3).map(v=>v.folder)).size,3);
 assert.deepEqual(discover(videos,progress,12,'2026-10-03'),one);
 assert.notDeepEqual(discover(videos,progress,12,'2026-10-04'),one);
 assert.equal(videos[0].id,'video0','source order is preserved');
 assert.deepEqual(discover([],{},12),[]);
});
test('time budget excludes unknown durations and respects its boundary',()=>{
 const result=withinTime(videos,10);assert.ok(result.length);assert.ok(result.every(v=>v.duration>0&&v.duration<=600));
 assert.ok(result.some(v=>v.duration===600));assert.equal(withinTime(videos,0),videos);
});
test('optional metadata matches Drive ID, YouTube ID or filename without removing videos',()=>{
 const metadata={videos:[{id:'video1',creator:'Creator one',topics:['Guitar',null],description:'Notes'},{youtubeId:'id2',creator:'Creator two'},{name:'Video 3.mp4',creator:'Creator three'}]};
 const result=enrichVideos(videos,metadata);assert.equal(result.length,videos.length);assert.equal(result[1].creator,'Creator one');assert.deepEqual(result[1].topics,['Guitar']);assert.equal(result[2].creator,'Creator two');assert.equal(result[3].creator,'Creator three');assert.equal(result[0],videos[0]);assert.deepEqual(enrichVideos(videos,{}),videos);
});
