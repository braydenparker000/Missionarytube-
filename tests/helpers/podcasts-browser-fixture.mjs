import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// Data-only providers and actual PCM audio, shared by the built-app tests and
// review preview. No production provider, account, state or storage is touched.
export const feedURL='https://podcast.fixture.test/signal.xml';
export function audioFixture() {
  const rate=8000,seconds=180,data=Buffer.alloc(rate*seconds*2),header=Buffer.alloc(44);
  for(let n=0;n<rate*seconds;n++)data.writeInt16LE(Math.round(Math.sin(n*2*Math.PI*220/rate)*900),n*2);
  header.write('RIFF');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);
  header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);
  header.write('data',36);header.writeUInt32LE(data.length,40);return Buffer.concat([header,data]);
}
export async function createPodcastServer({root=resolve('dist'),baseline,port=0}={}) {
  const wav=audioFixture(),requests=[],controls={delay:0,fail:false,audioDelay:0,failAudio:false,old:!!baseline};let origin;
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff','.json':'application/json','.svg':'image/svg+xml'};
  const show=(i=0,base=origin)=>({id:String(i),title:['The Listening Room','Small Hours','Field Notes','Blue Planet'][i%4]+(i>3?' · '+(i+1):''),author:['Signal Studio','Night School','Open Field','Deep Water'][i%4],feedUrl:i?`https://podcast.fixture.test/show-${i}.xml`:feedURL,artwork:base+'/podcasts-fixture/art-'+i+'.svg',description:'Stories about the ordinary things we almost miss. A synthetic show for reviewing the real Podcasts app.'});
  const episodes=base=>Array.from({length:65},(_,i)=>({id:'episode-'+i,title:i?'A little room to listen · '+(i+1):'The spaces between things',publishedAt:new Date(Date.UTC(2026,9,19-i)).toISOString(),duration:180,audioUrl:base+'/podcasts-fixture/audio.wav',type:'audio/wav',bytes:wav.length,description:('A conversation about paying attention, finding a slower rhythm, and making room for something new. These are synthetic episode notes for interaction review.\n\n').repeat(12)}));
  const server=createServer(async(req,res)=>{
    const base=new URL('http://'+req.headers.host).origin,url=new URL(req.url,base);requests.push({path:url.pathname,method:req.method,range:req.headers.range});
    try {
      if(url.pathname==='/'){res.writeHead(302,{Location:'/podcasts/'});res.end();return;}
      if(url.pathname==='/podcasts-fixture/audio.wav'||url.pathname==='/podcasts/audio'){
        if(controls.failAudio){res.writeHead(503);res.end();return;}
        const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||''),start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
        if(start>=wav.length){res.writeHead(416,{'Content-Range':'bytes */'+wav.length});res.end();return;}
        res.writeHead(match?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});
        if(controls.audioDelay){let offset=start;const interval=setInterval(()=>{if(offset>end){clearInterval(interval);res.end();return;}res.write(wav.subarray(offset,Math.min(end+1,offset+8192)));offset+=8192;},controls.audioDelay);res.on('close',()=>clearInterval(interval));return;}
        res.end(wav.subarray(start,end+1));return;
      }
      if(url.pathname.startsWith('/podcasts-fixture/art-')){
        const i=Number(url.pathname.match(/art-(\d+)/)?.[1]||0),colors=['#394cda','#9f6a4f','#416356','#294b63'],name=['THE<br>LISTENING<br>ROOM','SMALL<br>HOURS','FIELD<br>NOTES','BLUE<br>PLANET'][i%4];
        const lines=name.split('<br>').map((s,n)=>`<text x="32" y="${170+n*58}" fill="#f2ede5" font-family="sans-serif" font-weight="700" font-size="48" letter-spacing="-2">${s}</text>`).join('');
        res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${colors[i%4]}"/><circle cx="330" cy="55" r="140" fill="#ffffff12"/><path d="M0 340H400M0 350H400M0 360H400" stroke="#ffffff22"/>${lines}<text x="32" y="56" font-family="sans-serif" font-size="12" letter-spacing="4" fill="#fff9">SYNTHETIC STUDIO</text></svg>`);return;
      }
      if(['/podcasts/browse','/podcasts/search','/podcasts/feed'].includes(url.pathname)){
        const query=url.searchParams.get('q');if(controls.delay)await new Promise(done=>setTimeout(done,controls.delay));
        res.writeHead(controls.fail?503:200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(controls.fail?{error:'Synthetic provider unavailable'}:url.pathname.endsWith('/feed')?{show:{...show(0,base),feedUrl:url.searchParams.get('url')},episodes:episodes(base),nextOffset:null}:{shows:query==='nothing'?[]:Array.from({length:12},(_,i)=>show(i,base))}));return;
      }
      if(url.pathname==='/assets/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(`export const API_ORIGIN=${JSON.stringify(base)};export const DIRECT_API_ENABLED=true;`);return;}
      const directory=controls.old&&baseline?resolve(baseline):resolve(root);
      let file=resolve(directory,'.'+decodeURIComponent(url.pathname));if(file!==directory&&!file.startsWith(directory+sep))throw Error();
      if((await stat(file)).isDirectory())file+='/index.html';
      res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache',...(extname(file)==='.html'?{'Content-Security-Policy':"connect-src 'self'; img-src 'self' data:; media-src 'self' blob:"}:{})});res.end(await readFile(file));
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(done=>server.listen(port,'0.0.0.0',done));origin='http://127.0.0.1:'+server.address().port;
  return {origin,server,controls,requests,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=await createPodcastServer({root:process.argv[2]||'dist',port:Number(process.argv[3]||4173)});
  console.log('Podcasts built-module preview (synthetic providers; real 3-minute WAV): '+app.origin+'/podcasts/');
}
