import {writeFile} from 'node:fs/promises';
import {readCatalog,catalogTrack} from '../public/drawercast/drive-catalog.js';
import {validateR2Manifest} from '../public/drawercast/r2-api.js';
import {validateLibrary} from '../public/drawercast/r2-library.js';
const origin='https://missionarytube.z13.web.core.windows.net',api='https://jarvis-hub-api.braydenparker999.workers.dev';
const root='1VlEUztloW5saoM7iF11fodDKSmCGP2ZZ';
const catalog=await readCatalog({root,pointerURL:origin+'/assets/drive-catalog-v2.json',baseURL:origin+'/assets/drive-catalog-v2/'});
const records=catalog.records.map(r=>catalogTrack(r,root));
const response=await fetch(api+'/music/manifest.json',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(40000)});
if(response.status!==200)throw Error('Verified full migration manifest is required');
const manifest=await response.json();validateR2Manifest(manifest,{root,manifestURL:api+'/music/manifest.json',tracks:records});
if(manifest.files.length!==1287||manifest.inventoryBytes!==4989786207||manifest.sourceRevision!=='c6285c5fe33f8cf874f775c5c561e6dd3833aa32b15730edb34a3b8729ff19ec')throw Error('Unexpected migration baseline');
const byId=new Map(manifest.files.map(f=>[f.driveId,f]));
const keys=['title','artist','album','albumArtist','genre','composer','year','track','disc','dur','sr','ch','codec','bits','rgTrack','rgAlbum','rgTrackPeak','rgAlbumPeak'];
const tracks=records.map(t=>{const f=byId.get(t.remoteId);return {id:'r2_'+t.remoteId,audioKey:f.key,size:f.size,sha256:f.sha256,md5:f.md5,mimeType:f.mimeType,
  r2Identity:{...f.r2Identity,etag:f.r2Identity.etag.replace(/^"|"$/g,'')},path:t.path,folder:t.folder.replace(/^Google Drive\//,'Cloudflare R2/'),
  metadata:Object.fromEntries(keys.filter(k=>t[k]!=null).map(k=>[k,t[k]])),
  ...(t.coverURL?{coverURL:origin+t.coverURL}:{})};});
const data=validateLibrary({version:1,kind:'r2-library',complete:true,count:tracks.length,generatedAt:new Date().toISOString(),tracks});
await writeFile(process.argv[2]||'r2-library-seed.json',JSON.stringify(data));
console.log('Prepared independent library from verified R2 objects and published metadata: '+tracks.length+' tracks; no Google requests.');
