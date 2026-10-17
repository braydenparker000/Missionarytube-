import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';

// Bounded, dependency-free reader for the 8-bit RGB/RGBA PNGs Chromium emits.
// Unsupported formats fail loudly rather than silently comparing encoded bytes.
export function decodeScreenshotPNG(bytes){
  assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature');
  let width,height,channels;const compressed=[];
  for(let at=8;at<bytes.length;){
    assert.ok(at+12<=bytes.length,'complete PNG chunk');
    const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+12+length;
    assert.ok(end<=bytes.length,'complete PNG data');const data=bytes.subarray(at+8,at+8+length);
    if(type==='IHDR'){
      assert.equal(length,13);width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      assert.ok(width>0&&height>0&&width*height<=16_000_000,'bounded screenshot dimensions');
      assert.equal(data[8],8,'8-bit screenshot');assert.ok([2,6].includes(data[9]),'RGB/RGBA screenshot');
      channels=data[9]===6?4:3;assert.equal(data[10],0);assert.equal(data[11],0);assert.equal(data[12],0,'non-interlaced screenshot');
    }else if(type==='IDAT')compressed.push(data);
    at=end;if(type==='IEND')break;
  }
  assert.ok(channels&&compressed.length,'PNG header and image data');
  const stride=width*channels,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(stride+1)*height});
  assert.equal(raw.length,(stride+1)*height);const pixels=Buffer.alloc(width*height*4),rows=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4,'supported PNG row filter');
    for(let x=0;x<stride;x++){
      const at=y*stride+x,left=x>=channels?rows[at-channels]:0,up=y?rows[at-stride]:0,corner=y&&x>=channels?rows[at-stride-channels]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);
      rows[at]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
    for(let x=0;x<width;x++){const from=y*stride+x*channels,to=(y*width+x)*4;rows.copy(pixels,to,from,from+3);pixels[to+3]=channels===4?rows[from+3]:255;}
  }
  return {width,height,pixels};
}

export function compareScreenshotPNG(baseline,compact,{channelTolerance=2,regions={}}={}){
  const a=decodeScreenshotPNG(baseline),b=decodeScreenshotPNG(compact);
  assert.equal(b.width,a.width,'paired screenshot width');assert.equal(b.height,a.height,'paired screenshot height');
  const measure=rect=>{
    const x0=Math.max(0,Math.floor(rect?.left||0)),y0=Math.max(0,Math.floor(rect?.top||0));
    const x1=Math.min(a.width,Math.ceil(rect?rect.left+rect.width:a.width)),y1=Math.min(a.height,Math.ceil(rect?rect.top+rect.height:a.height));
    let changedPixels=0,exactChangedPixels=0,maxChannelDelta=0,totalDelta=0,minX=a.width,minY=a.height,maxX=-1,maxY=-1;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const at=(y*a.width+x)*4;let peak=0;
      for(let c=0;c<4;c++){const delta=Math.abs(a.pixels[at+c]-b.pixels[at+c]);peak=Math.max(peak,delta);totalDelta+=delta;}
      maxChannelDelta=Math.max(maxChannelDelta,peak);if(peak)exactChangedPixels++;
      if(peak>channelTolerance){changedPixels++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    }
    const pixels=Math.max(0,x1-x0)*Math.max(0,y1-y0);
    return {pixels,changedPixels,exactChangedPixels,changedFraction:pixels?changedPixels/pixels:0,maxChannelDelta,meanChannelDelta:pixels?totalDelta/(pixels*4):0,
      changedBounds:changedPixels?{left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1}:null};
  };
  return {width:a.width,height:a.height,channelTolerance,...measure(),regions:Object.fromEntries(Object.entries(regions).map(([name,rect])=>[name,measure(rect)]))};
}
