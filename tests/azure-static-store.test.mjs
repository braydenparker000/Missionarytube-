import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {azureUploadArgs,azureStaticStore} from '../scripts/azure-static-store.mjs';
test('Azure publication uses only existing Entra login, fixed account and exact provider preconditions',()=>{
  const args=azureUploadArgs('jarvis-active-release.json','/fixture/payload','application/json',{ifMatch:'"exact-etag"'});
  assert.equal(args[args.indexOf('--account-name')+1],'missionarytube');assert.equal(args[args.indexOf('--auth-mode')+1],'login');assert.equal(args[args.indexOf('--container-name')+1],'$web');assert.equal(args[args.indexOf('--if-match')+1],'"exact-etag"');
  assert.ok(azureUploadArgs('_jarvis/releases/'+'a'.repeat(64)+'/app.js','/fixture/payload','text/javascript',{ifNoneMatch:'*'}).includes('--if-none-match'));
  for(const key of ['../escape','assets/app.js','podcasts/sw.js'])assert.throws(()=>azureUploadArgs(key,'/fixture','text/javascript',{ifNoneMatch:'*'}));
  for(const condition of [undefined,{}, {ifMatch:'*'}, {ifMatch:'"x"',ifNoneMatch:'*'}])assert.throws(()=>azureUploadArgs('index.html','/fixture','text/html',condition));
});
test('provider write denial is sanitized and never retried or replaced by another transport',async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'azure-publication-'));let calls=0;
  try{
    const store=azureStaticStore({env:{STORAGE_ACCOUNT:'missionarytube'},temporary,runner:async()=>{calls++;throw Error('PRIVATE_PROVIDER_ERROR');}});
    await assert.rejects(store.put('jarvis-active-release.json',Buffer.from('fixture'),'application/json',{ifNoneMatch:'*'}),e=>!e.message.includes('PRIVATE')&&/Conditional/.test(e.message));assert.equal(calls,1);
    for(const key of ['AZURE_STORAGE_KEY','AZURE_STORAGE_SAS_TOKEN','AZURE_STORAGE_CONNECTION_STRING','AZURE_STORAGE_SERVICE_ENDPOINT'])assert.throws(()=>azureStaticStore({env:{STORAGE_ACCOUNT:'missionarytube',[key]:'PRIVATE'},temporary}));
  }finally{await rm(temporary,{recursive:true,force:true});}
});
test('bounded static reads require bytes, MIME, ETag and no redirects; only 404 means absent',async()=>{
  const make=fetcher=>azureStaticStore({env:{STORAGE_ACCOUNT:'missionarytube'},temporary:'/fixture',fetcher});
  let observed;
  const good=make(async(url,options)=>{observed={url,options};return new Response('fixture',{headers:{'Content-Type':'application/json','ETag':'"exact"'}});});
  const value=await good.get('jarvis-active-release.json');assert.equal(value.bytes.toString(),'fixture');assert.equal(value.etag,'"exact"');assert.equal(observed.options.redirect,'error');assert.equal(observed.options.credentials,'omit');assert.equal(observed.url,'https://missionarytube.z13.web.core.windows.net/jarvis-active-release.json');
  assert.equal(await make(async()=>new Response('',{status:404})).get('index.html'),null);
  for(const response of [new Response('',{status:403}),new Response('bad',{headers:{'Content-Type':'text/html'}}),new Response('',{headers:{ETag:'"x"','Content-Type':'text/html','Content-Length':'40000000'}})])await assert.rejects(make(async()=>response).get('index.html'),/unavailable/);
});
