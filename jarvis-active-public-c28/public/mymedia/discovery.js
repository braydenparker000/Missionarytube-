import {youtubeDate} from './metadata.js';
// Stable daily sampling with round-robin collection diversity.
export function hash(value){let n=2166136261;for(const c of String(value)){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
export function discover(videos,progress={},limit=12,seed=new Date().toISOString().slice(0,10)){
  const groups=new Map();
  for(const v of videos){if(progress[v.id]?.done)continue;const key=v.creator||v.folder||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v);}
  const queues=[...groups.entries()].sort(([a],[b])=>hash(seed+a)-hash(seed+b)).map(([,items])=>items.sort((a,b)=>hash(seed+a.id)-hash(seed+b.id)));
  const result=[];let index=0;while(result.length<limit&&queues.some(q=>q.length)){const q=queues[index++%queues.length];if(q.length)result.push(q.shift());}return result;
}
export function withinTime(videos,minutes){return minutes>0?videos.filter(v=>Number.isFinite(v.duration)&&v.duration>0&&v.duration<=minutes*60):videos;}
export function enrichVideos(videos,manifest){
  const rows=Array.isArray(manifest?.videos)?manifest.videos.slice(0,20000):[];
  const byId=new Map(),byYouTube=new Map(),byName=new Map();
  for(const row of rows){if(!row||typeof row!=='object')continue;if(row.id)byId.set(row.id,row);if(row.youtubeId)byYouTube.set(row.youtubeId,row);if(row.name)byName.set(row.name,row);}
  return videos.map(v=>{const row=byId.get(v.id)||byYouTube.get(v.youtubeId)||byName.get(v.name);if(!row)return v;return {...v,
    creator:typeof row.creator==='string'?row.creator.slice(0,160):'',
    description:typeof row.description==='string'?row.description.slice(0,2000):'',
    topics:Array.isArray(row.topics)?row.topics.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,80)):[],
    addedAt:Number.isFinite(row.addedAt)&&row.addedAt>0?row.addedAt:v.addedAt||0,
    ...youtubeDate(row)};});
}
