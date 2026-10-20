const KEY='poweramp-v2:preferences:1';
const defaults={schema:1, repeat:'off', shuffle:false, lastDemoId:null, position:0};
export function readPreferences(storage) {
  try {
    const p=JSON.parse((storage??globalThis.localStorage).getItem(KEY));
    if(p?.schema!==1)return {...defaults};
    return {...defaults,repeat:['off','all','one'].includes(p.repeat)?p.repeat:'off',shuffle:p.shuffle===true,
      lastDemoId:typeof p.lastDemoId==='string'&&/^demo-[a-z0-9-]+$/.test(p.lastDemoId)?p.lastDemoId:null,
      position:Number.isFinite(p.position)?Math.max(0,p.position):0};
  } catch {return {...defaults};}
}
export function savePreferences(state,storage) {
  // Never persist blob URLs, source URLs, local filenames, or playback intent.
  try {(storage??globalThis.localStorage).setItem(KEY,JSON.stringify({schema:1,repeat:state.repeat,shuffle:state.shuffle,
    lastDemoId:state.track?.id?.startsWith('demo-')?state.track.id:null,
    position:state.track?.id?.startsWith('demo-')?state.position:0}));return true;}catch{return false;}
}
