export const STORAGE_KEY = 'jarvis.podcasts.v1';
export const AUDIO_CACHE = 'jarvis-podcast-audio-v1';
export const MAX_DOWNLOAD = 250 * 1024 * 1024;
export const categories = [['popular','All shows','podcast'],['history','History','history'],['science','Science','science'],['technology','Technology','technology'],['culture','Culture','society culture'],['stories','Stories','fiction storytelling'],['faith','Faith','religion spirituality'],['music','Music','music']];
export const emptyState = () => ({version:1,follows:[],queue:[],downloads:{},progress:{},current:null,speed:1,country:'us',autoplay:true});
export function readState(storage) {
  try { const s = JSON.parse(storage.getItem(STORAGE_KEY)); if (s?.version !== 1) return emptyState();
    return {...emptyState(),...s,recentSearches:Array.isArray(s.recentSearches)?s.recentSearches.filter(q=>typeof q==='string'&&q.length>=2&&q.length<=120).slice(0,6):[],follows:Array.isArray(s.follows) ? s.follows.slice(0,100) : [],queue:Array.isArray(s.queue) ? s.queue.slice(0,100) : [],
      speed:[0.75,1,1.25,1.5,1.75,2,2.5].includes(s.speed) ? s.speed : 1,progress:s.progress || {},downloads:s.downloads || {}};
  } catch { return emptyState(); }
}
export const keyOf = e => e.show.feedUrl + '#' + e.id;
export function hash(s) { let n=2166136261;for(let i=0;i<s.length;i++)n=Math.imul(n^s.charCodeAt(i),16777619);return (n>>>0).toString(16); }
export const offlinePath = e => '/podcasts/offline/' + hash(e.show.feedUrl) + '-' + e.id;
export function clock(n) { n=Math.max(0,Math.floor(Number(n)||0));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(n>=3600?2:1,'0')+':'+String(n%60).padStart(2,'0'); }
export function positionText(position, duration) {
  const spoken = value => {
    const total=Math.max(0,Math.floor(Number(value)||0)),hours=Math.floor(total/3600),mins=Math.floor(total%3600/60),seconds=total%60;
    return [[hours,'hour'],[mins,'minute'],[seconds,'second']].filter(([n])=>n>0).map(([n,unit])=>n+' '+unit+(n===1?'':'s')).join(' ') || '0 seconds';
  };
  return spoken(position)+(duration>0?' of '+spoken(duration):'; duration unavailable');
}
export const minutes = n => n ? (n >= 3600 ? Math.floor(n/3600)+' hr '+Math.round(n%3600/60)+' min' : Math.max(1,Math.round(n/60))+' min') : '';
export const size = n => n>=1024*1024 ? (n/1024/1024).toFixed(1)+' MB' : Math.round(n/1024)+' KB';
export function resumePosition(progress, duration) { return progress?.played ? 0 : Math.max(0,Math.min(progress?.position || 0,duration>0 ? Math.max(0,duration-1) : Infinity)); }
export function nextQueued(queue, episode) { const key=keyOf(episode);const i=queue.findIndex(e=>keyOf(e)===key);return i<0 ? [...queue] : queue.filter((_,n)=>n!==i); }
export function shouldSleep(timer, now, ended=false) { return !!timer && (timer.endOfEpisode ? ended : now >= timer.deadline); }
export function progressEntry(episode, position, duration, played = false) { return {episode,position:Math.max(0,position || 0),duration:duration || episode.duration || 0,played,updatedAt:Date.now()}; }
export function compactProgress(progress) { return Object.fromEntries(Object.entries(progress).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0)).slice(0,300)); }
let database;
function db() {
  if (!database) database = new Promise((resolve,reject)=>{const r=indexedDB.open('jarvis-podcasts',1);r.onupgradeneeded=()=>r.result.createObjectStore('feeds',{keyPath:'feedUrl'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return database;
}
export async function storedFeed(feedUrl) { const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('feeds').objectStore('feeds').get(feedUrl);r.onsuccess=()=>resolve(r.result?.data || null);r.onerror=()=>reject(r.error);}); }
export async function saveFeed(data) { const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('feeds','readwrite');tx.objectStore('feeds').put({feedUrl:data.show.feedUrl,data,updatedAt:Date.now()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); }
