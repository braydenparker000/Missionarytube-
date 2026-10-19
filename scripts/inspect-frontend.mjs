import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileManifest,CONFIGURATION_FILES} from './qualified-artifact.mjs';

export const ORIGIN='https://missionarytube.z13.web.core.windows.net';
// Configured values and independently published data remain provider-owned.
const DATA_FILES=['content/jarvis.json','assets/drive-catalog-v2.json'];
const DATA_DIRECTORIES=['drawercast/catalog/','assets/drive-catalog-v2/'];
export const preservedPath=path=>CONFIGURATION_FILES.includes(path)||DATA_FILES.includes(path)||DATA_DIRECTORIES.some(prefix=>path.startsWith(prefix));
export async function inspectFrontend(root,{fetcher=fetch,prefix=''}={}){
 if(prefix&&!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix))throw Error('Invalid runtime path prefix');
 const files=(await fileManifest(resolve(root))).map(f=>({...f,path:prefix+f.path})).filter(f=>f.path!=='release.json'&&!preservedPath(f.path));
 const rows=new Array(files.length);let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{
  while(cursor<files.length){const i=cursor++,file=files[i];
   try{
    const response=await fetcher(ORIGIN+'/'+file.path,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.status!==200){rows[i]={...file,status:response.status};continue;}
    const bytes=Buffer.from(await response.arrayBuffer());
    const liveSha256=createHash('sha256').update(bytes).digest('hex');
    rows[i]={...file,status:200,liveSha256,liveBytes:bytes.length,matched:liveSha256===file.sha256&&bytes.length===file.bytes};
   }catch{rows[i]={...file,status:'unavailable'};}
  }
 }));
 return {schema:1,origin:ORIGIN,files:rows,preserved:CONFIGURATION_FILES.concat(DATA_FILES,DATA_DIRECTORIES),matched:rows.filter(f=>f.matched).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const report=await inspectFrontend(process.argv[2]||'dist');
 await writeFile('frontend-live-comparison.json',JSON.stringify(report,null,2)+'\n');
 // Inspection reports differences; only a publisher's exact baseline can authorize writes.
 console.log(JSON.stringify({inspected:report.files.length,matched:report.matched,differences:report.files.filter(f=>!f.matched)},null,2));
}
