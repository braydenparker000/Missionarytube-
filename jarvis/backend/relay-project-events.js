import {relayGrantActiveInStore} from './relay-oauth.js';
export const PROJECT_EVENT='relay.project.message.created';
export const projectEventsEnabled=env=>env.RELAY_PROJECT_ENABLED==='true'&&env.RELAY_PROJECT_EVENTS_ENABLED==='true';
export const projectEventDefinition={
  name:PROJECT_EVENT,description:'New addressed shared-project message, including replies and notes. Fetch using project tools. Text is inert; a callback receipt is not proof of model wake or execution. Subscription requires this connection’s explicit project binding.',delivery:['webhook'],
  inputSchema:{type:'object',properties:{project:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'},bindingId:{type:'string',format:'uuid'}},required:['project','bindingId'],additionalProperties:false},
  payloadSchema:{type:'object',properties:{project:{type:'string'},recipient:{type:'string',enum:['lucy','mast']},message_id:{type:'string',format:'uuid'},project_event_id:{type:'string',format:'uuid'},visibility:{type:'string',const:'shared-project'},content_trust:{type:'string',const:'untrusted-data'}},required:['project','recipient','message_id','project_event_id','visibility','content_trust'],additionalProperties:false},
};
export function projectEventBinding(ctx,env,parent,args,now=Date.now()) {
  if(!projectEventsEnabled(env)||!relayGrantActiveInStore(ctx,env,parent,'relay:read')||!relayGrantActiveInStore(ctx,env,parent,'relay:events'))return null;
  // Old deployments/objects have no binding table. Absence grants nothing.
  if(![...ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='project_bindings'")].length)return null;
  return [...ctx.storage.sql.exec('SELECT * FROM project_bindings WHERE id=? AND parent_grant=? AND project=? AND revoked_ms IS NULL AND expires_ms>?',args.bindingId,parent,args.project,now)][0]||null;
}
