// Dormant: Makima (Grok) is hidden from the workspace (private-dormant-agents.js); kept working for a return.
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const cursor=v=>typeof v==='string'&&/^\d{1,15}$/.test(v);
const check=v=>{if(!v)throw Object.assign(Error('Invalid private Makima response'),{kind:'invalid'});};
export function makimaMessage(m){
 check(m&&uuid(m.id)&&Number.isSafeInteger(m.sequence)&&m.sequence>0&&['owner','makima'].includes(m.identity)&&typeof m.body==='string'&&!!m.body.trim()&&m.body.length<=6000&&(m.reply_to===null||uuid(m.reply_to))&&typeof m.created_at==='string'&&Number.isFinite(Date.parse(m.created_at))&&m.channel==='makima'&&m.visibility==='private'&&m.role===(m.identity==='owner'?'user':'assistant'));
 if(m.author_authenticated===true)check(m.authority===(m.identity==='owner'?'owner':'agent')&&m.principal===(m.identity==='owner'?'github:183016859':'agent:makima')&&(m.identity==='owner'?['owner-device-session','owner-password-session']:['makima-oauth-mcp']).includes(m.authentication_source));
 else check(m.author_authenticated===false&&m.authority==='unverified'&&m.principal===null&&m.authentication_source==='legacy-unknown');
 return Object.fromEntries(['id','sequence','identity','body','reply_to','created_at','channel','visibility','role','authority','principal','author_authenticated','authentication_source'].map(k=>[k,m[k]]));
}
export function createMakimaApi(call){
 const api={
  async read(after='0'){
   check(cursor(after));const data=await call('/relay/owner/makima?after='+encodeURIComponent(after));
   check(data.channel==='makima'&&data.identity==='owner'&&data.visibility==='private'&&Array.isArray(data.messages)&&data.messages.length<=50);
   const messages=data.messages.map(makimaMessage);check(messages.every((m,i)=>m.sequence>Number(after)&&(!i||m.sequence>messages[i-1].sequence))&&new Set(messages.map(m=>m.id)).size===messages.length);
   check(data.nextCursor===null||cursor(data.nextCursor)&&messages.length>0&&Number(data.nextCursor)===messages.at(-1).sequence);
   return {messages,nextCursor:data.nextCursor};
  },
  async send(payload){
   check(uuid(payload.id)&&typeof payload.body==='string'&&!!payload.body.trim()&&payload.body.length<=6000&&(payload.reply_to==null||uuid(payload.reply_to)));
   const data=await call('/relay/owner/makima',{body:{id:payload.id,body:payload.body,reply_to:payload.reply_to??null}}),entry=makimaMessage(data.entry);
   check(typeof data.newWrite==='boolean'&&entry.identity==='owner'&&entry.author_authenticated&&entry.id===payload.id&&entry.body===payload.body&&entry.reply_to===(payload.reply_to??null));return entry;
  },
  async lookup(id){
   check(uuid(id));let after='0';
   // The server caps this private lane at 10,000 entries. A failed or truncated
   // read never counts as absence, so it never enables an unsafe fresh write.
   for(let page=0;page<201;page++){const data=await api.read(after),found=data.messages.find(m=>m.id===id);if(found)return found;if(data.nextCursor===null)return null;after=data.nextCursor;}
   throw Error('Private history could not be fully checked');
  }
 };return api;
}
