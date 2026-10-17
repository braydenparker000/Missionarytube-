import assert from 'node:assert/strict';
import {createExecutionHarness} from './relay-execution-harness.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {SHARED_OBJECT} from '../../backend/shared.js';
import {RELAY_CALLBACK,RELAY_INBOX,RELAY_PUBLIC_SCOPES,challenge,hash,random} from '../../backend/relay-common.js';
import {validatePublicEvent} from '../../public/assets/public-coordination.js';

// Reuse the real Worker/Hub HTTP/MCP and disk-SQLite harness. This mode-absent
// business oracle is intentionally separate from paid native admission tests.
// Accounts, sources, callbacks and issuer setup are fictional and network closed.
export async function createRequestResultHarness(t){
  const h=await createExecutionHarness(t);
  assert.equal(h.env.RELAY_ACCOUNT_ADMISSION_MODE,undefined);
  async function publicGrant(){
    const client=random(),grantId=random(),verifier=random(),code=random(),access=random(),refresh=random();
    const resource=h.env.RELAY_MCP_ORIGIN+'/relay/mcp';
    const registry=body=>relayOAuthStore(h.env.HUBS.get(SHARED_OBJECT).ctx,body).json();
    await registry({op:'put',key:'client:'+client,category:'client',value:{redirect:RELAY_CALLBACK},expiresAt:h.clock()+600000});
    const params={client_id:client,redirect_uri:RELAY_CALLBACK,code_challenge:await challenge(verifier),scope:RELAY_PUBLIC_SCOPES.join(' ')};
    await registry({op:'authorize',grantId,codeKey:'code:'+await hash(code),params,resource});
    const accessHash=await hash(access);
    const issued=await registry({op:'exchange',key:'code:'+await hash(code),
      match:{client_id:client,redirect_uri:RELAY_CALLBACK,challenge:params.code_challenge,resource},
      accessKey:'access:'+accessHash,refreshKey:'refresh:'+await hash(refresh)});
    assert.equal(issued.scope,RELAY_PUBLIC_SCOPES.join(' '));
    return {access,accessHash,client,grantId,registry};
  }
  return {...h,publicGrant,scope:'fictional-default-mode-business-protocol'};
}

export const publicReport=(requestId,overrides={})=>({schema:'jarvis-coordination-v2',eventId:crypto.randomUUID(),requestId,
  attemptId:crypto.randomUUID(),stage:'final',body:'Fictional independently checked public result',resultVersion:1,artifacts:[],...overrides});
export const publicComment=(payload,id,overrides={})=>({id,user:{id:183016859},issue_url:'https://api.github.com/repos/braydenparker999/jarvis/issues/2',
  created_at:'2026-10-09T00:00:00.000Z',updated_at:'2026-10-09T00:00:00.000Z',body:JSON.stringify(payload),...overrides});

export async function publicPages(h,auth,name,args={},limit=7){
  const pages=[],seen=new Set();let cursor=args.cursor;
  for(let count=0;count<256;count++){
    const page=await h.call(auth,name,{inbox_id:RELAY_INBOX,...args,limit,...(cursor?{cursor}:{})});pages.push(page);
    const items=name==='relay_read_public_changes'?page.changes:page.events;
    assert.ok(Array.isArray(items)&&items.length<=limit,'The real protocol page respects its requested bound');
    for(const item of items){const event=name==='relay_read_public_changes'?item.event:item;
      if(event)validatePublicEvent(event);
    }
    if(page.nextCursor===null)return {pages,cursor:page.cursor,items:pages.flatMap(value=>name==='relay_read_public_changes'?value.changes:value.events)};
    assert.equal(typeof page.nextCursor,'string');assert.ok(page.nextCursor.length<=128);
    assert.ok(!seen.has(page.nextCursor),'A repeated cursor cannot conceal a lost page');seen.add(page.nextCursor);cursor=page.nextCursor;
  }
  assert.fail('Fictional integration exceeds its finite256-page budget');
}

export function privateSnapshot(h){
  return ['relay_owner_entries','relay_owner_jobs','relay_owner_job_events','relay_owner_job_result_corrections'].map(table=>{
    const exists=h.rows("SELECT name FROM sqlite_master WHERE type='table' AND name=?",table).length;
    return exists?h.rows('SELECT * FROM '+table+' ORDER BY rowid'):[];
  });
}
