import test from 'node:test';
import assert from 'node:assert/strict';
import {publicURL,parseFeed,episodeID,durationSeconds,getFeed,directory,podcasts,upstream} from '../backend/podcasts.js';
import {emptyState,keyOf,nextQueued,resumePosition,shouldSleep,compactProgress,clock,positionText,readState} from '../public/podcasts/core.js';
import worker from '../backend/worker.js';
const feedURL='https://feeds.example.org/podcast.xml';
const rss=`<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>History &amp; Sound</title><itunes:author>Somebody</itunes:author><description><![CDATA[<p>A good <b>show</b></p>]]></description><itunes:image href="https://images.example.org/show.jpg"/><item><title>Episode &amp; one</title><guid isPermaLink="false">episode-1</guid><description><![CDATA[<p>Notes with &amp; characters and &lt;item&gt; text.</p>]]></description><pubDate>Fri, 02 Oct 2026 12:00:00 GMT</pubDate><itunes:duration>01:02:03</itunes:duration><enclosure url="https://media.example.org/audio.mp3?a=1&amp;b=2" type="audio/mpeg" length="12000"/></item><item><title>Episode two</title><guid>episode-2</guid><itunes:duration>120</itunes:duration><enclosure url="https://media.example.org/two.mp3" type="audio/mpeg"/></item><item><title>Duplicate</title><guid>episode-1</guid><enclosure url="https://media.example.org/audio.mp3" type="audio/mpeg"/></item><item><title>Private</title><enclosure url="http://127.0.0.1/audio.mp3" type="audio/mpeg"/></item><item><title>Video</title><enclosure url="https://media.example.org/video.mp4" type="video/mp4"/></item></channel></rss>`;
const reply=(data,status=200)=>Response.json(data,{status});
test('public URLs reject credentials, local addresses, numeric tricks and unsafe protocols',()=>{
  for(const url of ['file:///etc/passwd','https://localhost/feed','http://127.0.0.1/','http://2130706433/','http://0x7f000001/','http://[::1]/','https://a.internal/feed','https://127.0.0.1.nip.io/','https://name:pass@feeds.example.org/','https://feeds.example.org:8443/','https://metadata.google.internal/'])assert.throws(()=>publicURL(url));
  assert.equal(publicURL(feedURL+'#test'),feedURL);
});
test('RSS uses stable GUIDs, text-only notes, valid dates, publisher audio and deduplicated episodes',()=>{
  const data=parseFeed(rss,feedURL);assert.equal(data.show.title,'History & Sound');assert.equal(data.show.description,'A good show');assert.equal(data.episodes.length,2);
  assert.equal(data.episodes[0].duration,3723);assert.equal(data.episodes[0].audioUrl,'https://media.example.org/audio.mp3?a=1&b=2');assert.equal(data.episodes[0].id,episodeID('episode-1'));
  assert.ok(!data.episodes[0].description.includes('<p>'));assert.equal(data.episodes[0].publishedAt,'2026-10-02T12:00:00.000Z');
  assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss,feedURL));assert.throws(()=>parseFeed('<html>Not a feed</html>',feedURL));
  assert.equal(durationSeconds('4:30'),270);assert.equal(durationSeconds('invalid'),0);
});
test('all redirects are revalidated before fetching; private redirects are refused',async()=>{
  const calls=[];await assert.rejects(upstream(feedURL,{fetcher:async u=>{calls.push(u);return new Response(null,{status:302,headers:{Location:'http://169.254.169.254/metadata'}});}}));assert.equal(calls.length,1);
});
test('long publisher measurement chains resolve audio and forward byte ranges at every hop',async()=>{
  const calls=[];
  const r=await upstream('https://audio.example.org/hop/0',{headers:{Range:'bytes=0-4095'},fetcher:async(url,options)=>{
    calls.push(url);assert.equal(options.headers.Range,'bytes=0-4095');const hop=Number(new URL(url).pathname.split('/').at(-1));
    return hop<11?new Response(null,{status:302,headers:{Location:'/hop/'+(hop+1)}}):new Response('audio',{status:206,headers:{'Content-Type':'audio/mpeg'}});
  }});
  assert.equal(r.status,206);assert.equal(await r.text(),'audio');assert.equal(calls.length,12);
});
test('redirect loops stop immediately; the larger hop budget still rejects private targets',async()=>{
  let calls=0;
  await assert.rejects(upstream(feedURL,{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{Location:feedURL}});}}),/redirect loop/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(upstream('https://audio.example.org/0',{fetcher:async url=>{const n=Number(new URL(url).pathname.slice(1));calls++;return new Response(null,{status:302,headers:{Location:n===9?'http://169.254.169.254/metadata':'https://audio.example.org/'+(n+1)}});}}));
  assert.equal(calls,10);
});
test('streamed feed byte cap is enforced even without Content-Length',async()=>{
  await assert.rejects(getFeed(feedURL,{fetcher:async()=>new Response('x'.repeat(4*1024*1024+1))}),/too large/);
});
test('large archives retain complete playable episodes within the feed budget',async()=>{
  const body=rss.replace('</channel></rss>','<item><description>'+('x'.repeat(5*1024*1024))+'</description></item></channel></rss>');
  const chunks=new ReadableStream({start(c){for(let i=0;i<body.length;i+=32000)c.enqueue(new TextEncoder().encode(body.slice(i,i+32000)));c.close();}});
  const data=await getFeed(feedURL,{fetcher:async()=>new Response(chunks,{headers:{'Content-Length':String(body.length)}})});assert.equal(data.episodes.length,2);
});
test('feed pages retain stable episode IDs and audio lookup reaches older loaded items',()=>{
  const body='<rss><channel><title>Archive</title>'+Array.from({length:100},(_,i)=>`<item><title>Episode ${i}</title><guid>id-${i}</guid><enclosure url="https://media.example.org/${i}.mp3" type="audio/mpeg"/></item>`).join('')+'</channel></rss>';
  const first=parseFeed(body,feedURL,{limit:40}),second=parseFeed(body,feedURL,{offset:40,limit:40});assert.equal(first.episodes.length,40);assert.equal(first.nextOffset,40);assert.equal(second.episodes[0].id,episodeID('id-40'));
  const audio=parseFeed(body,feedURL,{id:episodeID('id-99')});assert.equal(audio.episodes.length,1);assert.equal(audio.episodes[0].title,'Episode 99');
});
test('directory search returns playable shows and uses bounded podcast-specific queries',async()=>{
  const result=await directory('History','ar',{fetcher:async url=>{const u=new URL(url);assert.equal(u.searchParams.get('country'),'ar');assert.equal(u.searchParams.get('media'),'podcast');assert.equal(u.searchParams.get('limit'),'36');return Response.json({results:[{collectionId:1,collectionName:'History',feedUrl:feedURL},{collectionId:2,collectionName:'No RSS'}]});}});
  assert.equal(result.shows.length,1);await assert.rejects(directory('x','us'),/two characters/);
});
test('directory host rejection falls back to an independent public podcast index',async()=>{
  const calls=[];
  const result=await directory('history','us',{fetcher:async url=>{calls.push(url);return url.startsWith('https://itunes.apple.com/')?new Response('Rejected',{status:403}):Response.json([{title:'A history show',author:'Host',url:feedURL,logo_url:'https://images.example.org/show.jpg',website:'https://show.example.org'}]);}});
  assert.equal(calls.length,3);assert.ok(calls[2].startsWith('https://gpodder.net/search.json'));assert.equal(result.shows[0].feedUrl,feedURL);
});
test('an empty first directory cannot hide a matching popular show from another provider',async()=>{
  let calls=0;
  const r=await directory('The Daily','us',{fetcher:async()=>{calls++;return Response.json({results:calls===1?[]:[{collectionId:1,collectionName:'The Daily',feedUrl:feedURL}]});}});
  assert.equal(r.shows[0].title,'The Daily');assert.equal(calls,2);
});
test('audio is resolved from an RSS enclosure, preserves range headers and rejects non-audio bodies',async()=>{
  const calls=[],fetcher=async(url,opts)=>{calls.push(url);if(url===feedURL)return new Response(rss);assert.equal(opts.headers.Range,'bytes=10-19');return new Response('0123456789',{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':'bytes 10-19/100','Content-Length':'10','Accept-Ranges':'bytes'}});};
  const request=new Request(`https://api.example.org/podcasts/audio?feed=${encodeURIComponent(feedURL)}&id=${episodeID('episode-1')}`,{headers:{Range:'bytes=10-19',Origin:'https://missionarytube.z13.web.core.windows.net'}});
  const r=await podcasts(request,reply,{fetcher});assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 10-19/100');assert.equal(await r.text(),'0123456789');assert.equal(calls.length,2);
  const bad=await podcasts(new Request(request.url),reply,{fetcher:async url=>url===feedURL?new Response(rss):new Response('<html>error</html>',{headers:{'Content-Type':'text/html'}})});assert.equal(bad.status,415);
});
test('missing episodes cannot turn the audio route into an arbitrary URL proxy',async()=>{
  const r=await podcasts(new Request(`https://api.example.org/podcasts/audio?feed=${encodeURIComponent(feedURL)}&id=missing`),reply,{fetcher:async()=>new Response(rss)});assert.equal(r.status,404);
});
test('existing Worker routes retain origin enforcement and expose podcast health',async()=>{
  const r=await worker.fetch(new Request('https://api.example.org/podcasts/health'),{});assert.deepEqual(await r.json(),{ok:true,version:1});
  const rejected=await worker.fetch(new Request('https://api.example.org/podcasts/health',{headers:{Origin:'https://untrusted.example.org'}}),{});assert.equal(rejected.status,403);
});
test('resume, ordered queue, progress bounds and timer transitions preserve listening semantics',()=>{
  const e={id:'one',show:{feedUrl:feedURL}},two={...e,id:'two'};
  assert.equal(resumePosition({position:900},500),499);assert.equal(resumePosition({position:900,played:true},500),0);
  assert.deepEqual(nextQueued([e,two],e),[two]);assert.equal(keyOf(e),feedURL+'#one');
  assert.equal(shouldSleep({deadline:2000},1999),false);assert.equal(shouldSleep({deadline:2000},2000),true);
  assert.equal(shouldSleep({endOfEpisode:true},2000),false);assert.equal(shouldSleep({endOfEpisode:true},2000,true),true);
  assert.equal(Object.keys(compactProgress(Object.fromEntries(Array.from({length:400},(_,i)=>[i,{updatedAt:i}])))).length,300);
  assert.equal(clock(3723),'1:02:03');assert.deepEqual(readState({getItem:()=>'{broken'}),emptyState());
});

test('accessible episode positions include spoken units, total duration and honest unknown duration',()=>{
 assert.equal(positionText(25,60),'25 seconds of 1 minute');
 assert.equal(positionText(3601,7320),'1 hour 1 second of 2 hours 2 minutes');
 assert.equal(positionText(0,0),'0 seconds; duration unavailable');
});
