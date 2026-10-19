// Shared publisher/reader contract. Only complete, verified generations may commit.
import {driveTrack, folderId} from './drive-api.js';
export const POINTER='/assets/drive-catalog-v2.json';
export const BASE='/assets/drive-catalog-v2/';
export const MAX_SHARD=512*1024;
const HEX=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
const fail=()=>{throw Error('The published music catalog is incomplete or invalid.');};
const str=(v,max=4096)=>typeof v==='string'&&v.length<=max;
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function validatePointer(p,root){
  if(p?.version!==2||p.complete!==true||p.rootId!==folderId(root)||!HEX.test(p.generation)||!str(p.name,512)||!Number.isFinite(Date.parse(p.publishedAt))||!Number.isSafeInteger(p.count)||p.count<0||p.count>50000||!Array.isArray(p.shards)||p.shards.length<1||p.shards.length>128)fail();
  let count=0;
  for(const s of p.shards){if(!HEX.test(s.sha256)||!Number.isSafeInteger(s.bytes)||s.bytes<2||s.bytes>MAX_SHARD||!Number.isSafeInteger(s.count)||s.count<0)fail();count+=s.count;}
  if(count!==p.count)fail();
  return p;
}
export function validateRecords(records){
  if(!Array.isArray(records)||records.length>50000)fail();
  const ids=new Set();
  for(const r of records){
    if(!r||!str(r.id,200)||!str(r.name,512)||!r.name||!str(r.folder)||!r.folder||!str(r.mimeType,128)||!Number.isSafeInteger(Number(r.size))||Number(r.size)<=0||!str(r.md5Checksum,128)||!Number.isFinite(Date.parse(r.modifiedTime))||!['ready','blocked'].includes(r.availability))fail();
    folderId(r.id);if(ids.has(r.id))fail();ids.add(r.id);
    if(r.folder.split('/').some(p=>p==='..'||p==='.')||r.name.includes('/'))fail();
    if(r.cover!=null&&!HEX.test(r.cover))fail();
    if(r.metadataCheckedAt!=null&&(!Number.isSafeInteger(r.metadataCheckedAt)||r.metadataCheckedAt<0))fail();
    if(r.metadataReady!=null&&typeof r.metadataReady!=='boolean')fail();
    if(r.prepared!=null){
      if(typeof r.prepared!=='object'||Array.isArray(r.prepared))fail();
      for(const [key,value] of Object.entries(r.prepared)){
        if(!['md5','size','title','artist','album','albumArtist','genre','composer','year','track','disc','dur','sr','ch','codec','bits','rgTrack','rgAlbum','rgTrackPeak','rgAlbumPeak'].includes(key))fail();
        if(typeof value==='string'?!str(value):!Number.isFinite(value))fail();
        if(['dur','size','sr','ch','bits'].includes(key)&&(!Number.isFinite(value)||value<0))fail();
      }
    }
  }
  return records;
}
export async function readJSON(url,max,fetcher,signal){
  const response=await fetcher(url,{signal,credentials:'omit',cache:'no-store'});
  if(!response.ok){await response.body?.cancel();throw Error('Music catalog download failed (HTTP '+response.status+').');}
  const reader=response.body?.getReader();if(!reader)fail();
  const chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max)fail();chunks.push(value);}}
  finally{await reader.cancel();}
  const bytes=new Uint8Array(total);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  return {bytes,data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
}
export async function readCatalog({root,generation,fetcher=fetch,signal,pointerURL=POINTER,baseURL=BASE}){
  const {data:pointer}=await readJSON(pointerURL,32768,fetcher,signal);validatePointer(pointer,root);
  if(pointer.generation===generation)return {pointer,unchanged:true};
  const groups=[];
  for(let i=0;i<pointer.shards.length;i+=4){
    groups.push(...await Promise.all(pointer.shards.slice(i,i+4).map(async(s,j)=>{
      const {bytes,data}=await readJSON(baseURL+'g/'+pointer.generation+'/'+(i+j)+'.json',MAX_SHARD,fetcher,signal);
      if(bytes.length!==s.bytes||await sha256(bytes)!==s.sha256||!Array.isArray(data)||data.length!==s.count)fail();return data;
    })));
  }
  const records=validateRecords(groups.flat());if(records.length!==pointer.count)fail();
  return {pointer,records};
}
export async function buildCatalog(records,{root,name,publishedAt=new Date().toISOString()}){
  validateRecords(records);records=[...records].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const shards=[];let batch=[],bytes=2;
  for(const r of records){const size=encoder.encode(JSON.stringify(r)).length+(batch.length?1:0);if(size+2>MAX_SHARD)fail();
    if(bytes+size>MAX_SHARD){shards.push(encoder.encode(JSON.stringify(batch)));batch=[];bytes=2;}
    batch.push(r);bytes+=size;
  }
  if(batch.length||!shards.length)shards.push(encoder.encode(JSON.stringify(batch)));
  const descriptors=await Promise.all(shards.map(async bytes=>({sha256:await sha256(bytes),bytes:bytes.length,count:JSON.parse(new TextDecoder().decode(bytes)).length})));
  const generation=await sha256(encoder.encode(JSON.stringify({root,name,shards:descriptors})));
  const pointer={version:2,rootId:root,name,generation,publishedAt,complete:true,count:records.length,shards:descriptors};validatePointer(pointer,root);
  return {pointer,shards};
}
export function catalogTrack(record,root,old={}){
  // Initial publication may contain filename labels while optional preparation
  // catches up. Keep richer cached tags for identical bytes during migration.
  const same=record.md5Checksum&&old.md5===record.md5Checksum&&old.size===Number(record.size);
  const prepared=same&&old.driveTagVersion===1?{...old,...record.prepared}:record.prepared;
  const track=driveTrack(record,root,prepared,old);
  track.catalogVersion=2;track.availability=record.availability;
  track.coverURL=record.cover?BASE+'covers/'+record.cover+'.jpg':null;
  return track;
}
// Requests and generation marker share one transaction. Resolve on COMMIT,
// never on an individual request's success. No network awaits inside it.
export function commitCatalog(db,{pointer,records}){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['tracks','kv'],'readwrite'), tracks=tx.objectStore('tracks');
    const pending=new Map(records.map(r=>['gd_'+r.id,r])), fresh=[],gone=[];
    const request=tracks.openCursor();
    request.onsuccess=()=>{
      const cursor=request.result;
      if(cursor){
        const old=cursor.value,record=pending.get(cursor.key);
        if(record){const t=catalogTrack(record,pointer.rootId,old);cursor.update(t);fresh.push(t);pending.delete(cursor.key);}
        else if(old.source==='drive'){gone.push(cursor.key);cursor.delete();}
        cursor.continue();
      }else{
        for(const record of pending.values()){const t=catalogTrack(record,pointer.rootId);tracks.put(t,t.id);fresh.push(t);}
        tx.objectStore('kv').put(pointer,'drive.catalog.v2');
      }
    };
    tx.oncomplete=()=>resolve({fresh,gone});tx.onabort=tx.onerror=()=>reject(tx.error||Error('Music catalog could not be saved.'));
  });
}
