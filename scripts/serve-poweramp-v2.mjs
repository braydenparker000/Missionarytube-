import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

// Deliberately serves only the V2 subtree. Research and other applications are inaccessible.
export async function serveV2({root=resolve('frontend/poweramp-v2'),port=0}={}) {
  root=resolve(root);
  const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(!url.pathname.startsWith('/poweramp-v2/')){res.writeHead(404);res.end();return;}
      const path=resolve(root,decodeURIComponent(url.pathname.slice('/poweramp-v2/'.length))||'index.html');
      if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      const info=await stat(path);if(!info.isFile())throw new Error('Not a file');
      const bytes=await readFile(path);
      res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
  return {url:`http://127.0.0.1:${server.address().port}/poweramp-v2/`,close:()=>new Promise(ok=>server.close(ok))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=await serveV2({root:process.env.V2_ROOT||resolve('frontend/poweramp-v2'),port:Number(process.env.PORT)||8765});
  console.log(`Poweramp V2: ${server.url}`);
}
