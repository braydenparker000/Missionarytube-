import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {challenge} from '../backend/relay-common.js';
import {MAKIMA_CALLBACK,MAKIMA_VERSION} from '../backend/relay-makima-policy.js';

test('offline workerd runs actual Makima OAuth and stateless MCP with no live egress', {timeout:30000},async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../backend/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['node:crypto']});
  const origin='https://relay.makima.test',path='/relay/makima',resource=origin+path+'/mcp',client='c'.repeat(64),verifier='synthetic-workerd-verifier-'.repeat(3);
  const outbound=[];
  const mf=new Miniflare(convertV4MiniflareOptions({name:'local-makima',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-19',cf:false,telemetry:{enabled:false},
    bindings:{RELAY_MCP_ENABLED:'true',RELAY_MAKIMA_ENABLED:'true',RELAY_MCP_ORIGIN:origin,RELAY_MAKIMA_CLIENT_ID:client,RELAY_MAKIMA_GITHUB_CLIENT_ID:'synthetic-workerd-app',RELAY_MAKIMA_GITHUB_CLIENT_SECRET:'synthetic-workerd-upstream-secret'},
    durableObjects:{HUBS:{className:'Hub',useSQLite:true}},outboundService(request){
      // Every possible outbound call is intercepted; unexpected calls fail.
      const url=new URL(request.url);outbound.push(url.origin+url.pathname);
      if(url.href==='https://github.com/login/oauth/access_token')return Response.json({access_token:'synthetic-workerd-upstream-token',token_type:'bearer'});
      if(url.href==='https://api.github.com/user')return Response.json({id:183016859});
      throw Error('Unexpected fixture egress');
    }}));
  const request=(suffix,init)=>mf.dispatchFetch(origin+path+suffix,{...init,redirect:'manual'});
  const form=body=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});
  const cookie=r=>r.headers.get('Set-Cookie').split(';')[0];
  try{
    const login=await request('/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:client,redirect_uri:MAKIMA_CALLBACK,resource,scope:'relay:makima',state:'synthetic-state',code_challenge_method:'S256',code_challenge:await challenge(verifier)}));
    assert.equal(login.status,302);
    const upstream=new URL(login.headers.get('Location'));
    const consent=await request('/oauth/github/callback?'+new URLSearchParams({state:upstream.searchParams.get('state'),code:'synthetic-code'}),{headers:{Cookie:cookie(login)}});
    assert.equal(consent.status,200);
    const html=await consent.text(),csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)[1];
    const allow=await request('/oauth/approve',{...form({csrf,decision:'allow'}),headers:{...form({}).headers,Origin:origin,Cookie:cookie(consent)}});
    assert.equal(allow.status,302);
    const code=new URL(allow.headers.get('Location')).searchParams.get('code');
    const exchange=await request('/oauth/token',form({grant_type:'authorization_code',client_id:client,redirect_uri:MAKIMA_CALLBACK,resource,code,code_verifier:verifier}));
    assert.equal(exchange.status,200);const token=await exchange.json();assert.equal(token.scope,'relay:makima');
    const rpc=async(method,params={})=>{
      const r=await request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
      assert.equal(r.status,200);return r.json();
    };
    const init=await rpc('initialize',{protocolVersion:MAKIMA_VERSION,capabilities:{},clientInfo:{name:'synthetic-grok',version:'1'}});
    assert.equal(init.result.protocolVersion,MAKIMA_VERSION);
    const args={id:crypto.randomUUID(),body:'synthetic-workerd-channel-text'};
    const send=()=>rpc('tools/call',{name:'makima_channel_send',arguments:args});
    assert.equal((await send()).result.structuredContent.newWrite,true);
    assert.equal((await send()).result.structuredContent.newWrite,false);
    const page=await rpc('tools/call',{name:'makima_channel_list',arguments:{}});
    assert.deepEqual(page.result.structuredContent.messages.map(m=>m.body),[args.body]);
    assert.deepEqual(outbound,['https://github.com/login/oauth/access_token','https://api.github.com/user']);
  }finally{await mf.dispose();}
});
