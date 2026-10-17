import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {decodeScreenshotPNG,compareScreenshotPNG} from './helpers/poweramp-png.js';

function png(rows,{channels=4,filter=0}={}){
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  const chunk=(type,data)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};
  const width=rows[0].length/channels,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(rows.length,4);header[8]=8;header[9]=channels===4?6:2;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  const raw=rows.flatMap((row,y)=>[filter,...row.map((value,x)=>{
    const a=x>=channels?row[x-channels]:0,b=y?rows[y-1][x]:0,c=y&&x>=channels?rows[y-1][x-channels]:0;
    return (value-[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter]+256)&255;
  })]);
  return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]);
}

test('screenshot PNG reader reconstructs every native row filter in RGB and RGBA',()=>{
  for(const channels of [3,4])for(let filter=0;filter<=4;filter++){
    const rows=[[20,35,60,...(channels===4?[255]:[]),90,120,220,...(channels===4?[180]:[])],[21,36,61,...(channels===4?[255]:[]),95,130,230,...(channels===4?[140]:[])]];
    const image=decodeScreenshotPNG(png(rows,{channels,filter}));assert.equal(image.width,2);assert.equal(image.height,2);
    assert.deepEqual([...image.pixels],channels===4?rows.flat():rows.flatMap(row=>[...row.slice(0,3),255,...row.slice(3),255]));
  }
});

test('screenshot pixel report includes exact and thresholded differences plus bounded regions',()=>{
  const baseline=png([[10,20,30,255,40,50,60,255],[70,80,90,255,100,110,120,255]]);
  const compact=png([[11,20,30,255,40,55,60,255],[70,80,90,255,100,110,120,255]]);
  const report=compareScreenshotPNG(baseline,compact,{regions:{tiny:{left:0,top:0,width:1,height:1},changed:{left:1,top:0,width:1,height:1}}});
  assert.equal(report.exactChangedPixels,2);assert.equal(report.changedPixels,1);assert.equal(report.changedFraction,.25);assert.equal(report.maxChannelDelta,5);
  assert.deepEqual(report.changedBounds,{left:1,top:0,width:1,height:1});assert.equal(report.regions.tiny.changedPixels,0);assert.equal(report.regions.changed.changedPixels,1);
  assert.equal(compareScreenshotPNG(baseline,baseline).exactChangedPixels,0);
});

test('screenshot PNG comparisons reject corrupt, oversized, unsupported, and mismatched images',()=>{
  assert.throws(()=>decodeScreenshotPNG(Buffer.from('not png')));
  const valid=png([[1,2,3,255]]),oversized=Buffer.from(valid);oversized.writeUInt32BE(17_000_000,16);assert.throws(()=>decodeScreenshotPNG(oversized),/bounded/);
  const indexed=Buffer.from(valid);indexed[25]=3;assert.throws(()=>decodeScreenshotPNG(indexed),/RGB/);
  assert.throws(()=>decodeScreenshotPNG(valid.subarray(0,30)),/complete/);
  assert.throws(()=>compareScreenshotPNG(valid,png([[1,2,3,255,4,5,6,255]])),/width/);
});
