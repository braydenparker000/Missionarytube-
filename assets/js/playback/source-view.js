(function (global) {
  'use strict';
  const defaults = () => ({addon:'all',quality:'all',language:'all',sort:'addon',query:''});
  const providerKey = entry => String(entry.stream.addonOrder ?? 0);
  function options(entries) {
    const providers = new Map(), qualities = new Set(), languages = new Set();
    for (const entry of entries) {
      const s=entry.stream, f=s.facts;
      const key=providerKey(entry);
      const item=providers.get(key)||{key,label:s.addonName||s.sourceName||'Source',count:0};
      item.count++;providers.set(key,item);
      if(f.resolution)qualities.add(f.resolution);
      (f.audioLanguages||[]).forEach(x=>languages.add(String(x).toLowerCase()));
    }
    return {providers:[...providers.values()],qualities:[...qualities],languages:[...languages]};
  }
  function select(entries, selected = {}) {
    const view={...defaults(),...selected}, query=String(view.query).trim().toLowerCase();
    const rows=entries.map((entry,index)=>({entry,index})).filter(({entry})=>{
      const s=entry.stream,f=s.facts;
      return (view.addon==='all'||providerKey(entry)===view.addon)&&
        (view.quality==='all'||f.resolution===view.quality)&&
        (view.language==='all'||(f.audioLanguages||[]).some(x=>String(x).toLowerCase()===view.language))&&
        (!query||[s.title,s.sourceName,s.addonName].join(' ').toLowerCase().includes(query));
    });
    if(['quality','size-asc','size-desc'].includes(view.sort)) rows.sort((a,b)=>{
      const f=a.entry.stream.facts,g=b.entry.stream.facts;
      if(view.sort==='quality')return (g.resolutionRank||0)-(f.resolutionRank||0)||a.index-b.index;
      const x=f.sizeBytes||0,y=g.sizeBytes||0;
      if(!x||!y)return (x?0:1)-(y?0:1)||a.index-b.index;
      return (view.sort==='size-asc'?x-y:y-x)||a.index-b.index;
    });
    return rows.map(x=>x.entry);
  }
  global.AstraStreamView=Object.freeze({defaults,providerKey,options,select});
})(globalThis);
