import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentFixture,id,raster,saved,output} from './helpers/relay-attachment-fixture.js';
import {ATTACHMENT_BODY_LIMIT} from '../backend/relay-owner-attachments.js';
test('attachment HTTP: successful password login advertises the same capability without changing credential policy',async t=>{
 const s=await attachmentFixture(t),password='synthetic-attachment-password';
 const consent=await output(await s.store({op:'credentials_prepare',token_hash:s.first.token_hash,purpose:'setup'}));assert.equal(consent.status,200);
 const saved=await s.store({op:'credentials_save',token_hash:s.first.token_hash,username:'fixture.owner',password,password_confirmation:password,consent_token:consent.body.consent_token,confirm:true,access_days:365,preserve_existing_sessions:true});assert.equal(saved.status,201);
 const login=await output(await s.http('/login',{body:{username:'fixture.owner',password,label:'Synthetic password phone'},token:null}));assert.equal(login.status,201);assert.equal(login.body.attachments_enabled,true);assert.equal(login.body.device.authentication_source,'owner-password-session');
 const bad=await output(await s.http('/login',{body:{username:'fixture.owner',password:'incorrect-synthetic-password',label:'Synthetic password phone'},token:null}));assert.equal(bad.status,401);assert.equal(bad.body.attachments_enabled,undefined);
});
test('attachment HTTP: capability is advertised only for an approved session and pairing',async t=>{
 const s=await attachmentFixture(t);
 const session=await output(await s.http('/session'));assert.equal(session.status,200);assert.equal(session.body.attachments_enabled,true);
 const pair=await s.phone('Another synthetic phone');
 const approved=await output(await s.http('/pair/status',{body:{request_id:pair.request_id},token:pair.token}));assert.equal(approved.body.attachments_enabled,true);
 const absent=await output(await s.http('/session',{token:null}));assert.equal(absent.status,401);assert.equal(absent.body.attachments_enabled,undefined);
 s.sql('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?',Date.now(),s.first.device_id);
 const revoked=await output(await s.http('/session'));assert.equal(revoked.status,401);assert.equal(revoked.body.attachments_enabled,undefined);
});
test('attachment HTTP: JSON upload and atomic send produce authenticated exact binary download',async t=>{
 const s=await attachmentFixture(t),message=id(),attachment=id(),bytes=Buffer.from(raster.png,'base64');
 const upload=await s.http('/attachments',{body:{id:attachment,message_id:message,name:'synthetic.png',mime_type:'image/png',data_base64:raster.png}});
 const a=await saved(upload);assert.equal(a.sizeBytes,bytes.length);
 const sent=await s.http('/messages',{body:{id:message,body:'',attachment_ids:[attachment]}});assert.equal(sent.status,201);
 const url='/attachments/content?message_id='+message+'&attachment_id='+attachment;
 const download=await s.http(url);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 assert.equal(download.headers.get('Cache-Control'),'no-store');assert.equal(download.headers.get('X-Content-Type-Options'),'nosniff');
 assert.match(download.headers.get('Content-Disposition'),/^attachment;/);assert.match(download.headers.get('Content-Security-Policy'),/sandbox/);
 const preview=await s.http(url+'&preview=1');assert.equal(preview.status,200);assert.equal(preview.headers.get('Content-Type'),'image/png');assert.match(preview.headers.get('Content-Disposition'),/^inline;/);
 const list=await output(await s.http('/messages'));assert.equal(list.body.messages[0].attachments[0].sha256,a.sha256);
 assert.equal(JSON.stringify(list.body).includes(raster.png),false);
 const unauthorized=await s.http(url,{token:null});assert.equal(unauthorized.status,401);
});
test('attachment HTTP: text contents and hostile filenames always download with safe headers',async t=>{
 const s=await attachmentFixture(t),message=id(),payload='<script>throw new Error("untrusted");</script>',name='fixture"><script>.txt';
 const a=await saved(await s.upload(message,{name,data_base64:Buffer.from(payload).toString('base64')}));
 assert.equal((await s.send(message,[a.id])).status,201);
 const route='/attachments/content?message_id='+message+'&attachment_id='+a.id;
 const response=await s.http(route);assert.equal(response.headers.get('Content-Type'),'text/plain');assert.match(response.headers.get('Content-Disposition'),/^attachment;/);
 assert.equal(response.headers.get('Content-Disposition').includes('<script>'),false);assert.equal(await response.text(),payload);
 assert.equal((await s.http(route+'&preview=1')).status,415);
});
test('attachment HTTP: unknown/expired/revoked auth is denied before reading or decoding upload bodies',async t=>{
 const s=await attachmentFixture(t),malformed='{';
 for(const token of [null,'0'.repeat(64)])assert.equal((await s.http('/attachments',{body:malformed,token})).status,401);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachment_attempts')[0].n,0);
 s.sql('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?',Date.now()-1,s.first.device_id);
 assert.equal((await s.http('/attachments',{body:malformed})).status,401);
 s.sql('UPDATE relay_owner_sessions SET expires_ms=?,revoked_ms=? WHERE device_id=?',Date.now()+100000,Date.now(),s.first.device_id);
 assert.equal((await s.http('/attachments',{body:malformed})).status,401);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,0);
});
test('attachment HTTP: request bytes, origin, fields, method and duplicate query constraints fail closed',async t=>{
 const s=await attachmentFixture(t),body={id:id(),message_id:id(),name:'fixture.txt',mime_type:'text/plain',data_base64:'eA=='};
 assert.equal((await s.http('/attachments',{body,origin:'https://foreign.example.test'})).status,403);
 assert.equal((await s.http('/attachments',{body,origin:null})).status,403);
 assert.equal((await s.http('/attachments',{body:{...body,url:'https://internal.example.test/'}})).status,400);
 assert.equal((await s.http('/attachments',{body:{...body,principal:s.principal.principal}})).status,400);
 assert.equal((await s.http('/attachments',{body:' '.repeat(ATTACHMENT_BODY_LIMIT+1)})).status,413);
 assert.equal((await s.http('/attachments')).status,405);
 assert.equal((await s.http('/attachments/content?message_id='+id()+'&message_id='+id()+'&attachment_id='+id())).status,400);
 assert.equal((await s.http('/attachments/content?message_id='+id()+'&attachment_id='+id()+'&token=secret')).status,400);
 assert.equal((await s.http('/attachments/content?message_id='+id()+'&attachment_id='+id()+'&preview=true')).status,400);
 assert.equal(s.sql('SELECT COUNT(*) AS n FROM relay_owner_attachments')[0].n,0);
});
test('attachment HTTP: invalid JSON consumes ingress allowance without reaching codec or persistence',async t=>{
 const s=await attachmentFixture(t);
 for(let i=0;i<12;i++)assert.equal((await s.http('/attachments',{body:'{'})).status,400);
 assert.equal((await s.http('/attachments',{body:'{'})).status,429);
 assert.equal(s.sql("SELECT attempts FROM relay_owner_attachment_attempts WHERE bucket LIKE 'ingress:day:%'")[0].attempts,12);
 assert.equal(s.sql("SELECT COUNT(*) AS n FROM relay_owner_attachment_attempts WHERE bucket LIKE 'codec:%'")[0].n,0);
});
test('attachment HTTP: binary verification yields and rechecks session revocation before content release',async t=>{
 const s=await attachmentFixture(t),message=id(),a=await saved(await s.upload(message));await s.send(message,[a.id]);
 const original=crypto.subtle.digest.bind(crypto.subtle);let hashes=0;
 t.mock.method(crypto.subtle,'digest',async(...args)=>{hashes++;if(hashes===2)s.sql('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?',Date.now(),s.first.device_id);return original(...args);});
 const response=await s.http('/attachments/content?message_id='+message+'&attachment_id='+a.id);
 assert.equal(response.status,401);assert.equal(response.headers.get('Content-Type').startsWith('application/json'),true);
 assert.equal((await response.text()).includes('Synthetic untrusted file.'),false);
});
