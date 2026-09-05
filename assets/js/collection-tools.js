/* Device-only collection, search history and backup helpers. */
(function(global){
  'use strict';
  const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const clean=value=>String(value??'').trim().replace(/\s+/g,' ');
  const folded=value=>clean(value).normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  function select(items,{query='',type='all',sort='recent',dates={}}={}){
    const words=folded(query).split(' ').filter(Boolean);
    return items.filter(item=>item&&(type==='all'||item.type===type)&&words.every(word=>folded([item.name||item.title,...(Array.isArray(item.genres)?item.genres:[])].join(' ')).includes(word)))
      .map((item,index)=>({item,index})).sort((a,b)=>{
        if(sort==='title')return clean(a.item.name||a.item.title).localeCompare(clean(b.item.name||b.item.title),undefined,{numeric:true,sensitivity:'base'})||a.index-b.index;
        if(sort==='year')return (parseInt(b.item.releaseInfo||b.item.year||b.item.released)||0)-(parseInt(a.item.releaseInfo||a.item.year||a.item.released)||0)||a.index-b.index;
        return (dates[b.item.type+':'+b.item.id]||0)-(dates[a.item.type+':'+a.item.id]||0)||a.index-b.index;
      }).map(entry=>entry.item);
  }
  function recent(list,value){
    const entries=[value,...(Array.isArray(list)?list:[])].filter(v=>typeof v==='string').map(clean).filter(v=>v&&v.length<=160);
    const seen=new Set();return entries.filter(v=>{const key=folded(v);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
  }
  function backup(raw){
    if(!record(raw)||raw.app!=='Astra'||!Array.isArray(raw.addons)||raw.addons.length>100)throw Error('Choose an Astra backup with a valid add-on list.');
    const addons=raw.addons.map(addon=>{
      if(!record(addon)||typeof addon.url!=='string')throw Error('The backup contains an invalid add-on.');
      let url;try{url=new URL(addon.url);}catch{throw Error('The backup contains an invalid add-on address.');}
      if(url.protocol!=='https:'||url.username||url.password||!url.pathname.endsWith('/manifest.json'))throw Error('Add-on addresses in a backup must be HTTPS manifest URLs.');
      return {url:url.href,enabled:addon.enabled!==false,name:clean(addon.name).slice(0,160),official:url.href==='https://v3-cinemeta.strem.io/manifest.json'};
    });
    if(new Set(addons.map(a=>a.url)).size!==addons.length)throw Error('The backup contains duplicate add-ons.');
    if(raw.library!=null&&!record(raw.library))throw Error('The saved collection is invalid.');
    const library={};
    for(const [key,value] of Object.entries(raw.library||{})){
      if(!record(value)||!record(value.meta)||typeof value.meta.id!=='string'||typeof value.meta.type!=='string'||!value.meta.id||!value.meta.type||key!==value.meta.type+':'+value.meta.id)throw Error('The backup contains an invalid saved title.');
      library[key]={meta:value.meta,added:Number.isFinite(value.added)?value.added:0};
    }
    for(const key of ['settings','appearance','homeLayout','progress','youtube'])if(raw[key]!=null&&!record(raw[key]))throw Error('The backup contains invalid '+key+' data.');
    return {...raw,addons,library};
  }
  // Validate and serialize every value first. If a write fails, restore the
  // previous values before any in-memory application state is changed.
  function commit(storage,values){
    if(!storage)throw Error('Chrome storage is unavailable. Nothing was imported.');
    const entries=Object.entries(values).map(([key,value])=>[key,JSON.stringify(value)]);
    const before=entries.map(([key])=>[key,storage.getItem(key)]);
    try{for(const [key,value] of entries)storage.setItem(key,value);}
    catch(error){for(const [key,value] of before){try{if(value===null)storage.removeItem(key);else storage.setItem(key,value);}catch{}}throw Error('Chrome could not save the backup. Free some device storage and try again.');}
  }
  global.AstraCollections=Object.freeze({select,recent,backup,commit});
})(globalThis);
