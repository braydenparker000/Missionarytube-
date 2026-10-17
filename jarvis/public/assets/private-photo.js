const LIMIT=1048576;
// Canonicalize every raster, including small screenshots. Original files stay untouched.
export async function preparePrivatePhoto(file){
 if(file.size>24*LIMIT)throw Error(file.name+': choose a photo under 24 MB.');
 let bitmap;
 try{
  const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const png=header[0]===137&&header[1]===80&&header[2]===78&&header[3]===71;
  const jpeg=header[0]===255&&header[1]===216;
  const webp=String.fromCharCode(...header.slice(0,4))==='RIFF'&&String.fromCharCode(...header.slice(8,12))==='WEBP';
  if(!png&&!jpeg&&!webp)throw Error('Not a supported raster image');
  // A file picker may provide no MIME, or application/octet-stream. Decode verified bytes.
  bitmap=await createImageBitmap(new Blob([file],{type:png?'image/png':jpeg?'image/jpeg':'image/webp'}));
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>64000000)throw Error('Image dimensions exceed the photo limit.');
  let scale=Math.min(1,4096/Math.max(bitmap.width,bitmap.height),Math.sqrt(16000000/(bitmap.width*bitmap.height)));
  const canvas=document.createElement('canvas');
  const basename=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9 _-]/g,'_').trim().slice(0,80)||'Screenshot';
  for(let attempt=0;attempt<5;attempt++,scale*=.75){
   canvas.width=Math.max(1,Math.floor(bitmap.width*scale));canvas.height=Math.max(1,Math.floor(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   // Preserve lossless screenshot text whenever it fits the existing server bound.
   let blob=attempt===0?await new Promise(resolve=>canvas.toBlob(resolve,'image/png')):null;
   if(!blob?.size||blob.size>LIMIT)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
   if(blob?.size&&blob.size<=LIMIT){const extension=blob.type==='image/png'?'png':'jpg';return {file:new File([blob],basename+'-upload.'+extension,{type:blob.type,lastModified:file.lastModified}),notice:'Prepared a compatible '+(extension==='png'?'PNG':'JPEG')+' upload copy locally (under 1 MB). Review it before sending; your original is unchanged.'};}
  }
  throw Error('Could not fit this photo within 1 MB.');
 }catch{throw Error(file.name+': photo could not be prepared. Choose a smaller JPEG, PNG or WebP.');}
 finally{bitmap?.close();}
}
