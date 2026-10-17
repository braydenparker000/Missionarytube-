import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),provider=args[args.indexOf('--provider')+1],out=resolve(args[args.indexOf('--outdir')+1]||'');
if(!['azure','vercel','netlify'].includes(provider)||!args.includes('--outdir')||!out)throw Error('Usage: node scripts/package-relay-egress.mjs --provider azure|vercel|netlify --outdir <new-directory>');
// Refuse overwriting a checkout or existing destination. No deployment/credentials.
await mkdir(out,{recursive:false});
if(provider==='azure'){
  await cp(resolve(root,'relay-egress/api'),resolve(out,'api'),{recursive:true});
  await cp(resolve(root,'relay-egress/public'),resolve(out,'public'),{recursive:true});
}else{
  await mkdir(resolve(out,'shared'),{recursive:true});
  await cp(resolve(root,'relay-egress/api/shared/pinned-https.mjs'),resolve(out,'shared/pinned-https.mjs'));
  const web=await readFile(resolve(root,'relay-egress/adapters/web-handler.mjs'),'utf8');
  await writeFile(resolve(out,'shared/web-handler.mjs'),web.replace("'../api/shared/pinned-https.mjs'","'./pinned-https.mjs'"));
  const wrapper=await readFile(resolve(root,`relay-egress/adapters/${provider}.mjs`),'utf8');
  if(provider==='vercel'){
    await mkdir(resolve(out,'api'));
    await writeFile(resolve(out,'api/relay-egress.mjs'),wrapper.replace("'./web-handler.mjs'","'../shared/web-handler.mjs'"));
    await writeFile(resolve(out,'vercel.json'),JSON.stringify({version:2,framework:null,buildCommand:'',outputDirectory:'public',functions:{'api/relay-egress.mjs':{maxDuration:15}}},null,2)+'\n');
    await mkdir(resolve(out,'public'));
    await cp(resolve(root,'relay-egress/public/index.html'),resolve(out,'public/index.html'));
  }else{
    await mkdir(resolve(out,'netlify/functions'),{recursive:true});
    await writeFile(resolve(out,'netlify/functions/relay-egress.mjs'),wrapper.replace("'./web-handler.mjs'","'../../shared/web-handler.mjs'"));
    await cp(resolve(root,'relay-egress/public'),resolve(out,'public'),{recursive:true});
    await writeFile(resolve(out,'netlify.toml'),'[build]\n  publish = "public"\n[build.environment]\n  NODE_VERSION = "22"\n[functions]\n  directory = "netlify/functions"\n  node_bundler = "esbuild"\n');
  }
  await writeFile(resolve(out,'package.json'),JSON.stringify({name:'jarvis-relay-egress-'+provider,version:'1.0.0',private:true,type:'module',engines:{node:'22.x'}},null,2)+'\n');
}
await writeFile(resolve(out,'README.md'),`# Jarvis Relay egress: ${provider}\n\nLocal deployment package only. Configure RELAY_WEBHOOK_EGRESS_TOKEN via the provider's secure backend environment settings and use the real Node runtime. No account, resource, credential or paid commitment has been created. Verify host cost/eligibility and obtain setup approval before deployment. Endpoint: /api/relay-egress. See source docs/relay-mcp-events.md for the full qualification and cutover checklist.\n`);
console.log(JSON.stringify({provider,outdir:out,endpoint:'/api/relay-egress',deployed:false}));
