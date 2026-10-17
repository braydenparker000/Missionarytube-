import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the shipped classic scripts, with transport replaced at the
// manager boundary. No live provider or media request is made by these tests.
const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout});
for(const name of ['config','instances','api','playback']){
  const path=new URL('../public/media/assets/js/youtube/'+name+'.js',import.meta.url);
  vm.runInContext(await readFile(path,'utf8'),context,{filename:path.pathname});
}
const YT=context.AstraYouTube;
const ID='dQw4w9WgXcQ';
const A='https://piped-a.example.test',B='https://piped-b.example.test',C='https://piped-c.example.test';
const empty=()=>({title:'Metadata is not a stream',videoStreams:[],audioStreams:[]});
const muxed=origin=>({url:origin+'/video.mp4',mimeType:'video/mp4',videoOnly:false,height:720,quality:'720p',itag:22});
const audio=origin=>({url:origin+'/audio.m4a',mimeType:'audio/mp4',codec:'mp4a.40.2',videoOnly:false,itag:140});
const video=origin=>({title:'Resolved video',videoStreams:[muxed(origin)],audioStreams:[]});
const answer=body=>({status:200,body});

function harness(routes,{maxAttempts=3,instances=[A,B,C]}={}){
  const calls=[];
  const config=YT.config.resolve({
    privateInstanceUrl:'',
    publicFallbackInstances:instances.map(url=>({url,api:'piped'})),
    maxAttempts
  });
  const now=()=>10_000;
  const manager=YT.instances.createManager({
    config,instances:YT.config.instanceList(config),now,AbortController,
    fetch:async(url,options)=>{
      const parsed=new URL(url);
      calls.push({origin:parsed.origin,path:parsed.pathname,options});
      const response=routes[parsed.origin];
      assert.ok(response,'unexpected provider request: '+parsed.origin);
      return {status:response.status,ok:response.status<400,text:async()=>JSON.stringify(response.body)};
    }
  });
  const client=YT.api.createClient({manager,config,now,AbortController});
  return {client,manager,calls,config};
}

function origins(h){return h.calls.map(call=>call.origin);}
function health(h,origin){return h.manager.snapshot().instances.find(row=>row.url===origin);}
function plan(h,record){
  return YT.playback.buildPlan(record,{
    config:h.config,instance:record.instance,
    capabilities:{canPlayType:()=> 'probably',mse:true,hlsSupported:true,dashSupported:true,isTypeSupported:()=>true}
  });
}

test('Piped empty video and audio arrays fail over, and only the resolved response is cached',async()=>{
  const h=harness({[A]:answer(empty()),[B]:answer(video(B))});
  const record=await h.client.video(ID);
  assert.equal(record.instance,B);
  assert.equal(record.formatStreams.length,1);
  assert.equal(record.formatStreams[0].url,B+'/video.mp4');
  assert.deepEqual(origins(h),[A,B]);
  assert.ok(h.calls.every(call=>call.path==='/streams/'+ID));
  assert.ok(h.calls.every(call=>call.options.credentials==='omit'&&call.options.referrerPolicy==='no-referrer'));
  assert.equal(health(h,A).state,'unhealthy');
  assert.equal(health(h,A).lastError,'malformed');
  assert.equal(health(h,A).successes,0);
  assert.ok(health(h,A).cooldownMs>0);
  assert.equal(health(h,B).state,'healthy');
  assert.equal(h.manager.pinned,B);
  assert.equal(h.client.cacheSize,1);
  assert.equal(await h.client.video(ID),record);
  assert.deepEqual(origins(h),[A,B],'cache does not re-request the empty provider');
});

test('Piped empty bodies exhaust the existing attempt budget without caching or trying a later provider',async()=>{
  const h=harness({[A]:answer(empty()),[B]:answer(empty()),[C]:answer(video(C))},{maxAttempts:2});
  await assert.rejects(h.client.video(ID),error=>{
    assert.equal(error.kind,'malformed');
    assert.equal(error.attempts,2);
    assert.equal(error.instance,B);
    assert.equal(error.message,'The YouTube server returned an unusable response.');
    return true;
  });
  await Promise.resolve();
  assert.deepEqual(origins(h),[A,B]);
  assert.equal(health(h,C).requests,0);
  assert.equal(health(h,C).state,'unknown');
  assert.equal(h.manager.pinned,'');
  assert.equal(h.client.cacheSize,0);
});

test('Piped malformed collection shapes fail over through the real manager',async t=>{
  const cases=[
    ['null body',null],
    ['array body',[]],
    ['text body','not a streams object'],
    ['metadata only',{title:'No streams'}],
    ['missing audio array',{videoStreams:[]}],
    ['null audio array',{videoStreams:[],audioStreams:null}],
    ['text audio array',{videoStreams:[],audioStreams:'audio.mp4'}],
    ['object audio array',{videoStreams:[],audioStreams:{length:1,0:audio(A)}}],
    ['missing video array',{audioStreams:[audio(A)]}],
    ['object video array',{videoStreams:{length:1,0:muxed(A)},audioStreams:[]}],
    ['text video array',{videoStreams:'video.mp4',audioStreams:[]}]
  ];
  for(const [label,body] of cases)await t.test(label,async()=>{
    const h=harness({[A]:answer(body),[B]:answer(video(B))});
    assert.equal((await h.client.video(ID)).instance,B);
    assert.deepEqual(origins(h),[A,B]);
    assert.equal(health(h,A).lastError,'malformed');
  });
});

test('Piped legitimate audio-only and muxed responses stop failover immediately',async t=>{
  await t.test('audio-only with an empty video array',async()=>{
    const h=harness({[A]:answer({...empty(),audioStreams:[audio(A)]})});
    const record=await h.client.video(ID);
    assert.deepEqual(origins(h),[A]);
    assert.equal(record.instance,A);
    assert.equal(record.formatStreams.length,0);
    assert.equal(record.adaptiveFormats.length,1);
    assert.equal(record.adaptiveFormats[0].audioOnly,true);
    assert.equal(record.adaptiveFormats[0].url,A+'/audio.m4a');
    assert.equal(h.manager.pinned,A);
  });
  await t.test('muxed video with no separate audio array',async()=>{
    const h=harness({[A]:answer({videoStreams:[muxed(A)]})});
    const record=await h.client.video(ID);
    assert.deepEqual(origins(h),[A]);
    assert.equal(record.formatStreams.length,1);
    assert.equal(record.adaptiveFormats.length,0);
    const built=plan(h,record);
    assert.equal(built.variants.length,1);
    assert.equal(built.variants[0].kind,'progressive');
    assert.equal(built.variants[0].url,A+'/video.mp4');
  });
  await t.test('existing video-only normalization policy is unchanged',async()=>{
    const h=harness({[A]:answer({videoStreams:[{...muxed(A),videoOnly:true}],audioStreams:[]})});
    const record=await h.client.video(ID);
    assert.deepEqual(origins(h),[A]);
    assert.equal(record.adaptiveFormats.length,1);
    assert.equal(record.adaptiveFormats[0].videoOnly,true);
  });
});

test('Piped live HLS with empty arrays retains a real HLS playback plan',async()=>{
  const h=harness({[A]:answer({...empty(),livestream:true,hls:A+'/live.m3u8'})});
  const record=await h.client.video(ID);
  assert.deepEqual(origins(h),[A]);
  assert.equal(record.live,true);
  assert.equal(record.hlsUrl,A+'/live.m3u8');
  assert.equal(record.formatStreams.length,0);
  assert.equal(record.adaptiveFormats.length,0);
  const built=plan(h,record);
  assert.equal(built.variants.length,1);
  assert.equal(built.variants[0].kind,'hls');
  assert.equal(built.variants[0].url,A+'/live.m3u8');
});

test('Piped manifest validation follows the attempted instance and preserves relative URLs',async t=>{
  const manifests=[['hls','/live.m3u8'],['hls',B+'/live.m3u8'],['dash','/manifest.mpd'],['dash',B+'/manifest.mpd']];
  for(const [field,url] of manifests)await t.test(field+' '+url,async()=>{
    const h=harness({[A]:answer(empty()),[B]:answer({...empty(),livestream:field==='hls',[field]:url})});
    const record=await h.client.video(ID);
    assert.deepEqual(origins(h),[A,B]);
    assert.equal(record.instance,B);
    assert.equal(record[field==='hls'?'hlsUrl':'dashUrl'],new URL(url,B).href);
    assert.equal(health(h,A).lastError,'malformed');
    assert.equal(h.manager.pinned,B);
  });
});

test('Piped invalid or external manifests cannot make empty arrays successful',async t=>{
  const invalid=['',null,{},123,'javascript:alert(1)','data:application/x-mpegurl,x','https://[invalid',B+'/foreign.m3u8','//foreign.example.test/live.m3u8'];
  for(const field of ['hls','dash'])for(const [index,value] of invalid.entries())await t.test(field+' invalid '+index,async()=>{
    const h=harness({[A]:answer({...empty(),[field]:value}),[B]:answer(video(B))});
    const record=await h.client.video(ID);
    assert.deepEqual(origins(h),[A,B]);
    assert.equal(record.instance,B);
    assert.equal(health(h,A).lastError,'malformed');
  });
});

test('existing HTTP error, bounded exhaustion, content and cancellation paths remain intact',async t=>{
  await t.test('HTTP 502 fails over as a server error',async()=>{
    const h=harness({[A]:{status:502,body:{message:'upstream unavailable'}},[B]:answer(video(B))});
    assert.equal((await h.client.video(ID)).instance,B);
    assert.deepEqual(origins(h),[A,B]);
    assert.equal(health(h,A).lastError,'server');
  });
  await t.test('server errors obey the same finite attempt budget',async()=>{
    const h=harness({[A]:{status:502,body:{}},[B]:{status:503,body:{}},[C]:answer(video(C))},{maxAttempts:2});
    await assert.rejects(h.client.video(ID),error=>error.kind==='server'&&error.attempts===2&&error.instance===B);
    assert.deepEqual(origins(h),[A,B]);
    assert.equal(h.client.cacheSize,0);
  });
  await t.test('recognized content unavailability does not fail over',async()=>{
    const h=harness({[A]:answer({error:'Video unavailable'}),[B]:answer(video(B))});
    await assert.rejects(h.client.video(ID),error=>error.kind==='content');
    assert.deepEqual(origins(h),[A]);
    assert.equal(health(h,A).failures,0);
    assert.equal(h.client.cacheSize,0);
  });
  await t.test('pre-aborted caller makes no provider request',async()=>{
    const h=harness({[A]:answer(video(A))}),controller=new AbortController();
    controller.abort();
    await assert.rejects(h.client.video(ID,{signal:controller.signal}),error=>error.kind==='aborted');
    assert.deepEqual(origins(h),[]);
    assert.equal(h.client.cacheSize,0);
  });
});
