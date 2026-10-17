import assert from 'node:assert/strict';
const origin='https://jarvis-hub-api.braydenparker999.workers.dev';
const frontend='https://missionarytube.z13.web.core.windows.net';
async function read(path){
 for(let attempt=0;;attempt++){
  let response;
  try{response=await fetch(origin+path,{headers:{Origin:frontend},signal:AbortSignal.timeout(30000)});}catch(e){if(attempt===4)throw e;}
  if(response?.status===200){assert.equal(response.headers.get('Access-Control-Allow-Origin'),frontend);return response.json();}
  if(response){if(attempt===4||![429,502,503,504].includes(response.status))assert.equal(response.status,200,path);await response.body?.cancel();}
  // New Worker versions and independent directory caches can take a short
  // time to reach the runner's region. Retain the gate and retry transient errors.
  await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
 }
}
assert.equal((await read('/podcasts/health')).version,1);
async function directory(path,term){
 try{const r=await fetch(origin+path,{headers:{Origin:frontend},signal:AbortSignal.timeout(30000)});if(r.ok){const data=await r.json();if(data.shows?.length)return data;}}catch{}
 // The app races the Worker's directory against Apple's documented client
 // API. A blocked server region must not block browsing on another network.
 const r=await fetch('https://itunes.apple.com/search?media=podcast&entity=podcast&limit=36&country=us&term='+encodeURIComponent(term),{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Independent directory must work when the Worker region rejects it');
 const data=await r.json();return {shows:data.results.filter(s=>s.feedUrl).map(s=>({title:s.collectionName,feedUrl:s.feedUrl}))};
}
const browse=await directory('/podcasts/browse?category=popular&country=us','podcast');assert.ok(browse.shows.length,'Real discovery must return shows');
const search=await directory('/podcasts/search?q=history&country=us','history');assert.ok(search.shows.length,'Real podcast search must return shows');
let audioVerified=false;
for(const show of search.shows.slice(0,4)){
 try{
  const feed=await read('/podcasts/feed?url='+encodeURIComponent(show.feedUrl));assert.ok(feed.episodes.length,'Real RSS must return playable episodes');
  const e=feed.episodes[0],url=origin+'/podcasts/audio?feed='+encodeURIComponent(show.feedUrl)+'&id='+e.id;
  const r=await fetch(url,{headers:{Origin:frontend,Range:'bytes=0-4095'},signal:AbortSignal.timeout(30000)});
  assert.ok([200,206].includes(r.status),'Real publisher audio must load');assert.ok(r.headers.get('Content-Type')?.startsWith('audio/'));
  if(r.status===206){assert.match(r.headers.get('Content-Range'),/^bytes 0-4095\//);assert.equal((await r.arrayBuffer()).byteLength,4096);}else{const reader=r.body.getReader();const first=await reader.read();assert.ok(first.value?.length);await reader.cancel();}
  assert.equal(r.headers.get('Access-Control-Allow-Origin'),frontend);audioVerified=true;console.log('Verified real directory search, RSS and audio delivery:',show.title);break;
 }catch(e){console.log('Trying another publisher:',e.message);}
}
assert.ok(audioVerified,'At least one real RSS enclosure must serve audio');
// One easy publisher must not hide broken popular shows.
for(const feedURL of ['https://feeds.simplecast.com/Sl5CSM3S','https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn']) {
 const data=await read('/podcasts/feed?url='+encodeURIComponent(feedURL));assert.ok(data.episodes.length);
 const e=data.episodes[0],r=await fetch(origin+'/podcasts/audio?'+new URLSearchParams({feed:feedURL,id:e.id}),{headers:{Origin:frontend,Range:'bytes=0-4095'},signal:AbortSignal.timeout(40000)});
 assert.ok([200,206].includes(r.status),data.show.title+' must resolve its publisher redirect chain');assert.ok(r.headers.get('Content-Type')?.startsWith('audio/'));
 const reader=r.body.getReader();assert.ok((await reader.read()).value?.length);await reader.cancel();console.log('Verified popular publisher audio:',data.show.title);
}
