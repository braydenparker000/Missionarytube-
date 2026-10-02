import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {signatureMessage} from '../.jarvis-source/public/drawercast/r2-library.js';
const api='https://jarvis-hub-api.braydenparker999.workers.dev',path='/music/uploads/register',type='application/json';
const privateKey=createPrivateKey(await readFile('.jarvis-source/.music-test-key.pem'));
const key=createPublicKey(privateKey).export({type:'spki',format:'der'}).subarray(-32).toString('hex');
const bytes=Buffer.from('{}'),hash=createHash('sha256').update(bytes).digest('hex'),size=String(bytes.length);
const enabled=process.argv.includes('--enabled'),expected=enabled?422:401;
// Invalid registration cannot write anything. Poll only the previous policy
// during normal edge propagation; never retry a rejected music transfer.
for(let attempt=0;attempt<31;attempt++){
const time=String(Math.floor(Date.now()/1000));
const signature=sign(null,Buffer.from(signatureMessage({method:'POST',origin:api,path,type,hash,size,time,key})),privateKey).toString('hex');
const response=await fetch(api+path,{method:'POST',body:bytes,headers:{'Content-Type':type,'X-Music-Public-Key':key,'X-Music-Sha256':hash,
  'X-Music-Timestamp':time,'X-Music-Size':size,'X-Music-Signature':signature},signal:AbortSignal.timeout(30000)});
await response.body?.cancel();
if(response.status===expected){console.log(enabled?'Live server recognizes the temporary verification key.':'Live server rejects the correctly signed temporary verification key after revocation.');break;}
assert.equal(response.status,enabled?401:422,'Unexpected upload policy response');
assert.ok(attempt<30,'New upload policy did not reach this edge within 60 seconds');
await new Promise(resolve=>setTimeout(resolve,2000));
}
