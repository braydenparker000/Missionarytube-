const ROOT = 'https://www.googleapis.com/drive/v3/files';
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const AUDIO = /\.(mp3|m4a|m4b|aac|flac|wav|wave|ogg|oga|opus|weba|webm|mp4|aif|aiff|wma|mka)$/i;
export function folderId(value) {
  const input = String(value || '').trim();
  if (ID.test(input)) return input;
  let url; try { url = new URL(input); } catch { throw Error('Paste a Google Drive folder link.'); }
  const id = url.hostname === 'drive.google.com' && url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id || !ID.test(id)) throw Error('Paste a Google Drive folder link.');
  return id;
}
export function createDriveApi(key, fetcher = fetch, {authenticated = false} = {}) {
  if (!authenticated && !/^AIza[A-Za-z0-9_-]{30,}$/.test(key || '')) throw Error('The shared Drive API key is not configured.');
  async function get(path, params, signal) {
    const url = new URL(ROOT + path);
    for (const [name, value] of Object.entries(authenticated ? params : {...params, key})) url.searchParams.set(name, value);
    const response = await fetcher(url.href, {signal, credentials:'omit', cache:'no-store'});
    const data = await response.json();
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason || '';
      if (response.status === 404) throw Error('Drive folder not found. Set it to Anyone with the link → Viewer.');
      if (response.status === 429 || /rateLimit|quota/i.test(reason)) throw Error('Drive is limiting requests. Wait a moment, then refresh.');
      if (response.status === 403) throw Error('Drive refused access. Check public sharing, Drive API enablement, and the API key restrictions.');
      throw Error('Drive could not be read (HTTP ' + response.status + ').');
    }
    return data;
  }
  function mediaURL(file) {
    if (!ID.test(file.id || '')) throw Error('Invalid Drive file ID.');
    const url = new URL(ROOT + '/' + file.id);
    url.searchParams.set('alt','media'); if (!authenticated) url.searchParams.set('key', key);
    return url.href;
  }
  async function manifest(folder, signal) {
    const root = folderId(folder);
    const page = await get('', {
      q:"'" + root + "' in parents and name = 'drive-prepared.json' and trashed = false",
      pageSize:'1',
      fields:'files(id,md5Checksum,size)'
    }, signal);
    const file = page.files?.[0];
    if (!file) throw Error('Drive metadata manifest was not found.');
    const response = await fetcher(mediaURL(file), {signal, credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store'});
    if (!response.ok) throw Error('Drive metadata manifest could not be downloaded.');
    const data = await response.json();
    if (data?.version !== 1 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) {
      throw Error('Drive metadata manifest is invalid.');
    }
    return data.files;
  }
  async function list(folder, signal, progress) {
    const root = folderId(folder);
    const info = await get('/' + root, {fields:'id,name,mimeType'}, signal);
    if (info.mimeType !== 'application/vnd.google-apps.folder') throw Error('Choose a folder, not an individual file.');
    const visited = new Set(), files = new Map();
    async function readFolder(current) {
      const children = [];
      let token = '', seen = new Set();
      do {
        const page = await get('', {q:"'" + current.id + "' in parents and trashed = false", pageSize:'1000', fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,md5Checksum,capabilities(canDownload))', ...(token ? {pageToken:token} : {})}, signal);
        if (page.incompleteSearch || !Array.isArray(page.files)) throw Error('Drive returned an incomplete folder listing. Your saved library is unchanged.');
        for (const f of page.files) {
          if (!ID.test(f.id || '') || typeof f.name !== 'string') continue;
          if (f.mimeType === 'application/vnd.google-apps.folder') children.push({id:f.id,path:current.path+'/'+f.name});
          else if (AUDIO.test(f.name)) files.set(f.id,{...f,folder:current.path,availability:f.capabilities?.canDownload===false?'blocked':'ready'});
        }
        if (files.size > 50000) throw Error('Choose a folder with fewer than 50,000 songs.');
        token = page.nextPageToken || '';
        if (token && seen.has(token)) throw Error('Drive pagination repeated. Your saved library is unchanged.');
        seen.add(token);
      } while (token);
      return children;
    }
    // Most large libraries contain many sibling album/artist folders. Read a
    // small batch in parallel so a complete snapshot does not spend one network
    // round trip per folder, while keeping concurrency low enough for Drive.
    let frontier = [{id:root,path:info.name}];
    while (frontier.length) {
      const level = [];
      for (const current of frontier) {
        if (visited.has(current.id)) continue;
        if (visited.size >= 5000) throw Error('This folder has more than 5,000 subfolders. Choose a smaller music folder.');
        visited.add(current.id); level.push(current);
      }
      frontier = [];
      for (let i=0; i<level.length; i+=6) {
        const children = await Promise.all(level.slice(i,i+6).map(readFolder));
        for (const group of children) frontier.push(...group);
        if (typeof progress === 'function') progress({files:files.size,folders:visited.size});
      }
    }
    return {id:root,name:info.name,files:[...files.values()]};
  }
  // Metadata reads are bounded byte ranges, never full-track downloads.
  function metadataFile(track, signal) {
    const size=Number(track.size), blocks=[];
    let budget=0, count=0;
    if(!Number.isSafeInteger(size)||size<=0)throw Error('Invalid audio file size.');
    return {size, slice(start=0,end=size){
      start=Math.max(0,start<0?size+start:start);end=Math.min(size,end);
      return {async arrayBuffer(){
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        const cached=blocks.find(b=>start>=b.start&&end<=b.end);
        if(cached)return cached.bytes.slice(start-cached.start,end-cached.start).buffer;
        const length=Math.max(end-start,Math.min(128*1024,size-start));
        if(length<=0)return new ArrayBuffer(0);
        if(++count>8||budget+length>2*1024*1024)throw Error('Embedded artwork exceeds the metadata read budget.');
        budget+=length;
        const stop=start+length;
        const response=await fetcher(mediaURL({id:track.remoteId}),{signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Range:'bytes='+start+'-'+(stop-1)}});
        const range=response.headers.get('content-range');
        // Drive does not CORS-expose Content-Range. Validate it when available;
        // always require HTTP 206 and exactly the requested body length.
        if(response.status!==206||(range&&range!==`bytes ${start}-${stop-1}/${size}`)){
          await response.body?.cancel();throw Error('Drive did not return the requested metadata range.');
        }
        const reader=response.body?.getReader();if(!reader)throw Error('Missing metadata response.');
        const chunks=[];let total=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>length)throw Error('Metadata response exceeded its byte range.');chunks.push(value);}}
        finally{await reader.cancel();}
        if(total!==length)throw Error('Incomplete metadata response.');
        const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        blocks.push({start,end:stop,bytes});return bytes.slice(0,end-start).buffer;
      }};
    }};
  }
  return {list,mediaURL,manifest,metadataFile};
}
export function driveTrack(file, root, prepared, old = {}) {
  const same=!!file.md5Checksum && old.md5===file.md5Checksum && old.size===Number(file.size);
  const match=!!prepared && prepared.md5===file.md5Checksum && prepared.size===Number(file.size);
  const meta=match?prepared:(same&&old.driveTagVersion===1?old:{});
  const ext=file.name.split('.').at(-1).toLowerCase();
  const stem=file.name.replace(/\.[^.]+$/, '').replace(/^\d+\s*-\s*/, '').replace(/\s*\[[A-Za-z0-9_-]{11}\]$/, '');
  const named=/^\d+\s*-\s*(.+?)\s+-\s+(.+)\.[^.]+$/.exec(file.name);
  return {...old, id:'gd_'+file.id, remote:true, source:'drive', remoteId:file.id, driveFolder:root,
    title:meta.title || named?.[2] || stem,
    artist:meta.artist || named?.[1] || '', album:meta.album || '', albumArtist:meta.albumArtist || '', genre:meta.genre || '',
    composer:meta.composer||'', year:meta.year||0, track:meta.track||0, disc:meta.disc||0,
    artKey:same?old.artKey||null:null, customArt:same?old.customArt||false:false, driveTagVersion:same?old.driveTagVersion||0:0,
    rgTrack:meta.rgTrack,rgAlbum:meta.rgAlbum,rgTrackPeak:meta.rgTrackPeak,rgAlbumPeak:meta.rgAlbumPeak,
    folder:'Google Drive/'+file.folder, path:file.folder+'/'+file.name, ext, mimeType:file.mimeType,
    size:Number(file.size)||0, mtime:Date.parse(file.modifiedTime)||0, md5:file.md5Checksum || '',
    dur:meta.dur || (same ? old.dur || 0 : 0), sr:meta.sr||0, ch:meta.ch||0,
    codec:meta.codec||'', bits:meta.bits||0, rootId:null, rel:null, missing:false, needsPerm:false, errored:false,
    waveformVersion:0, waveformFile:null,
    rating:old.rating||0, plays:old.plays||0, lastPlayed:old.lastPlayed||0, added:old.added||Date.now()};
}
