const LIMIT=1048576;
// Make a clearly named upload copy locally. Never change the selected original.
export async function preparePrivatePhoto(file){
 if(file.size<=LIMIT||!['image/jpeg','image/png','image/webp'].includes(file.type))return {file};
 if(file.size>24*LIMIT)throw Error(file.name+': choose a photo under 24 MB.');
 let bitmap;
 try{
  bitmap=await createImageBitmap(file);
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>64000000)throw Error('Image dimensions exceed the photo limit.');
  let scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  for(let attempt=0;attempt<4;attempt++,scale*=.7){
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
   if(blob?.size&&blob.size<=LIMIT){const name=file.name.replace(/\.[^.]+$/,'').slice(0,80)+'-photo.jpg';return {file:new File([blob],name,{type:'image/jpeg',lastModified:file.lastModified}),notice:'Photo resized locally to fit the 1 MB limit. Review the JPEG copy before sending; your original is unchanged.'};}
  }
  throw Error('Could not fit this photo within 1 MB.');
 }catch{throw Error(file.name+': photo could not be prepared. Choose a smaller JPEG, PNG or WebP.');}
 finally{bitmap?.close();}
}
