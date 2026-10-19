/* TorBox's JSON download endpoint avoids a redirect on every byte-range read.
   Credentials are read only from an already selected, trusted provider URL.
   This resolver never creates, deletes, queues or modifies a torrent. */
(function(global){
  'use strict';
  const API='https://api.torbox.app/v1/api/';
  const integer=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value));
  const name=value=>String(value||'').split(/[\\/]/).pop();
  function identify(value){
    let u;try{u=new URL(value);}catch{return null;}
    if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
    if(u.hostname==='api.torbox.app'&&/^\/v1\/api\/(torrents|usenet|webdl)\/requestdl$/.test(u.pathname)){
      if(!u.searchParams.get('token')||u.searchParams.get('zip_link')==='true')return null;
      const type=u.pathname.split('/')[3],idKey={torrents:'torrent_id',usenet:'usenet_id',webdl:'web_id'}[type];
      if(!integer(u.searchParams.get(idKey))||!integer(u.searchParams.get('file_id')||0))return null;
      return {direct:u.href};
    }
    if(u.hostname!=='torrentio.strem.fun')return null;
    const p=u.pathname.split('/');
    if(p[1]!=='resolve'||p[2]!=='torbox'||!p[3]||!/^([a-f0-9]{40})$/i.test(p[4]||'')||!p[5])return null;
    try{return {token:decodeURIComponent(p[3]),hash:p[4].toLowerCase(),filename:name(decodeURIComponent(p[5]))};}catch{return null;}
  }
  async function resolve(url,{signal,fetch:request=global.fetch}={}){
    const source=identify(url);if(!source)return url;
    const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,6000);
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const json=async(target,headers={})=>{
      const response=await request(target,{signal:controller.signal,headers,credentials:'omit',mode:'cors',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('Provider lookup failed');
      const body=await response.json();if(body.success!==true)throw new Error('Provider lookup unavailable');return body.data;
    };
    try{
      if(signal?.aborted)throw new DOMException('Playback cancelled','AbortError');
      let download=source.direct;
      if(!download){
        if(/[\r\n]/.test(source.token))return url;
        // Bound library reads. Only an exact hash and unique filename match
        // can select a file; torrent file indices are not TorBox file IDs.
        let torrent;
        for(let offset=0;offset<500;offset+=100){
          const items=await json(API+'torrents/mylist?limit=100&offset='+offset,{Authorization:'Bearer '+source.token});
          if(!Array.isArray(items))return url;
          torrent=items.find(item=>String(item.hash||'').toLowerCase()===source.hash);
          if(torrent||items.length<100)break;
        }
        if(!torrent||!integer(torrent.id))return url;
        const files=(torrent.files||[]).filter(file=>name(file.short_name||file.name)===source.filename);
        if(files.length!==1||!integer(files[0].id))return url;
        const params=new URLSearchParams({token:source.token,torrent_id:String(torrent.id),file_id:String(files[0].id)});
        download=API+'torrents/requestdl?'+params;
      }
      const target=new URL(download);target.searchParams.set('redirect','false');
      const data=await json(target.href);
      if(signal?.aborted)throw new DOMException('Playback cancelled','AbortError');
      const final=new URL(typeof data==='string'?data:'');
      if(final.protocol!=='https:'||final.username||final.password)return url;
      return final.href;
    }catch(error){
      if(signal?.aborted)throw new DOMException('Playback cancelled','AbortError');
      // Preserve the original path when lookup is unavailable. Some servers
      // permit the redirect chain even when their account API rejects CORS.
      return url;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  global.AstraPlayback=global.AstraPlayback||{};
  global.AstraPlayback.delivery={identify,resolve};
})(globalThis);
