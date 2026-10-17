// Test-only entry point. These seed routes are never part of the production bundle.
import worker, {Hub} from '../../backend/worker.js';
import {projectStore} from '../../backend/relay-projects.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {hash, RELAY_OWNER} from '../../backend/relay-common.js';

export class ProjectFixtureHub extends Hub {
  async fetch(request) {
    if (new URL(request.url).pathname === '/__fixture/seed') {
      const scope = 'relay:owner', resource = 'https://local.project.test/relay/mcp', access = 'e'.repeat(64), accessHash = await hash(access);
      const principal = {principal:RELAY_OWNER,grantId:'fixture-owner',scopes:[scope],accessHash};
      const expiresAt = Date.now()+86400000;
      relayOAuthStore(this.ctx,{op:'get',key:'fixture-missing'});
      this.ctx.storage.sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)','grant:fixture-owner','grant',JSON.stringify({principal:RELAY_OWNER,scope,resource,revoked:false,expiresAt}),expiresAt);
      this.ctx.storage.sql.exec('INSERT INTO relay_oauth VALUES(?,?,?,?)','access:'+accessHash,'access',JSON.stringify({grantId:'fixture-owner',scope}),expiresAt);
      const grants = {};
      for (const [name, char] of [['lucy','1'],['mast','2'],['other','3']]) {
        const token = 'jpi_'+char.repeat(64), grantId=crypto.randomUUID();
        const result=projectStore(this.ctx,this.env,{op:'admin',principal,args:{op:'create',grantId,tokenHash:await hash(token),project:name==='other'?'other-project':'jarvis',agent:name==='other'?'lucy':name,expiresAt:new Date(expiresAt).toISOString(),confirm:true}});
        if(!result.ok)throw Error('Fixture grant failed: '+await result.text());
        grants[name]={token,grantId};
      }
      return Response.json({grants,access});
    }
    return super.fetch(request);
  }
}
export default {
  fetch(request,env) {
    if(new URL(request.url).pathname==='/__fixture/seed')return env.HUBS.get(env.HUBS.idFromName('jarvis-shared-v2')).fetch(request);
    return worker.fetch(request,env);
  }
};
