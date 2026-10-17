import test from 'node:test';
import assert from 'node:assert/strict';
import {drivePublisherAuth,DrivePublisherStopped} from '../scripts/drive-publisher-auth.mjs';
import {createDriveApi} from '../public/drawercast/drive-api.js';

const env={GOOGLE_DRIVE_AUTH_MODE:'oauth',GOOGLE_DRIVE_CLIENT_ID:'test-client',GOOGLE_DRIVE_CLIENT_SECRET:'test-secret',GOOGLE_DRIVE_REFRESH_TOKEN:'test-refresh'};
const drive='https://www.googleapis.com/drive/v3/files/track123456789?alt=media&key=test-key';
test('owner grant uses a serialized refresh, header authorization and no query key',async()=>{
  const calls=[];
  const auth=drivePublisherAuth({env,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/token')) {await new Promise(resolve=>setImmediate(resolve));return Response.json({access_token:'test-access',expires_in:3600});}
    return new Response('audio',{status:206});
  }});
  await Promise.all([1,2,3].map(()=>auth.fetcher(drive,{headers:{Range:'bytes=0-4'}})));
  assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,1);
  assert.equal(calls[0].options.body.get('refresh_token'),'test-refresh');
  for(const call of calls.slice(1)) {
    assert.equal(new URL(call.url).searchParams.has('key'),false);
    assert.equal(call.options.headers.get('Authorization'),'Bearer test-access');
    assert.equal(call.options.headers.get('Range'),'bytes=0-4');
    assert.equal(call.options.redirect,'error');
  }
});
test('tokens refresh before expiry',async()=>{
  let at=0,refreshes=0;
  const auth=drivePublisherAuth({env,now:()=>at,fetcher:async url=>url.endsWith('/token')?Response.json({access_token:'test-'+(++refreshes),expires_in:3600}):new Response()});
  await auth.fetcher(drive);at=3500000;await auth.fetcher(drive);assert.equal(refreshes,1);
  at=3541000;await auth.fetcher(drive);assert.equal(refreshes,2);
});
test('OAuth is never added to Azure, lookalike domains or unrelated Google endpoints',async()=>{
  const calls=[];
  const auth=drivePublisherAuth({env,fetcher:async(url,options)=>{calls.push({url,options});return new Response();}});
  for(const url of ['https://missionarytube.z13.web.core.windows.net/assets/catalog.json','https://www.googleapis.com.evil.test/drive/v3/files','https://www.googleapis.com/calendar/v3/calendars'])await auth.fetcher(url,{headers:{Range:'bytes=0-4'}});
  assert.equal(calls.length,3);
  assert.ok(calls.every(call=>!new Headers(call.options.headers).has('Authorization')));
});
test('grant errors, redirects and Drive refusals stop later requests without leaking values',async()=>{
  for(const failure of ['refresh','redirect','refusal']) {
    let calls=0;
    const auth=drivePublisherAuth({env,fetcher:async url=>{
      calls++;
      if(url.endsWith('/token'))return failure==='refresh'?Response.json({error_description:'test-secret'},{status:400}):Response.json({access_token:'test-access',expires_in:3600});
      if(failure==='redirect')throw Error('test-access');
      return new Response('test-secret',{status:403});
    }});
    await assert.rejects(auth.fetcher(drive),error=>error instanceof DrivePublisherStopped&&!/test-secret|test-access|test-refresh/.test(error.message));
    const before=calls;await assert.rejects(auth.fetcher(drive),DrivePublisherStopped);assert.equal(calls,before);
  }
});
test('OAuth configuration fails closed and explicit public-key mode remains available',()=>{
  assert.throws(()=>drivePublisherAuth({env:{GOOGLE_DRIVE_AUTH_MODE:'oauth'}}),DrivePublisherStopped);
  const fallback=drivePublisherAuth({env:{GOOGLE_DRIVE_AUTH_MODE:'public_api_key',GOOGLE_DRIVE_API_KEY:'test-public'}});
  assert.equal(fallback.key,'test-public');assert.equal(fallback.authenticated,false);
});
test('authenticated catalog API emits keyless listing and media URLs',async()=>{
  const calls=[];
  const api=createDriveApi('',async url=>{
    calls.push(url);return Response.json(url.includes('fields=id%2Cname%2CmimeType')?{id:'folder123456789',name:'Music',mimeType:'application/vnd.google-apps.folder'}:{files:[]});
  },{authenticated:true});
  assert.equal(new URL(api.mediaURL({id:'track123456789'})).searchParams.has('key'),false);
  await api.list('folder123456789');assert.equal(calls.length,2);assert.ok(calls.every(url=>!new URL(url).searchParams.has('key')));
  assert.throws(()=>createDriveApi(''));
});
