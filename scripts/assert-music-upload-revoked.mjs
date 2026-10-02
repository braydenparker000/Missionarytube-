import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {signatureMessage} from '../.jarvis-source/public/drawercast/r2-library.js';
const api='https://jarvis-hub-api.braydenparker999.workers.dev',path='/music/uploads/register',type='application/json';
const privateKey=createPrivateKey(await readFile('.jarvis-source/.music-test-key.pem'));
const key=createPublicKey(privateKey).export({type:'spki',format:'der'}).subarray(-32).toString('hex');
const bytes=Buffer.from('{}'),hash=createHash('sha256').update(bytes).digest('hex'),time=String(Math.floor(Date.now()/1000)),size=String(bytes.length);
const signature=sign(null,Buffer.from(signatureMessage({method:'POST',origin:api,path,type,hash,size,time,key})),privateKey).toString('hex');
const response=await fetch(api+path,{method:'POST',body:bytes,headers:{'Content-Type':type,'X-Music-Public-Key':key,'X-Music-Sha256':hash,
  'X-Music-Timestamp':time,'X-Music-Size':size,'X-Music-Signature':signature},signal:AbortSignal.timeout(30000)});
assert.equal(response.status,401,'Temporary upload signing key was not revoked');await response.body?.cancel();
console.log('Live server rejects the correctly signed temporary verification key after revocation.');
