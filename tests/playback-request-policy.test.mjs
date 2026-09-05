import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlayback} from './helpers/playback.mjs';
const {requests: R} = await loadPlayback();
const url = 'https://media.example.test/stream';

test('empty header hints do not require a proxy or fetch player', () => {
  for (const hints of [undefined, null, {}, {request:{}}, {response:{}}]) {
    const policy=R.analyze(url,hints);
    assert.equal(policy.required,false);
    assert.equal(policy.supported,true);
  }
});

test('browser-settable addon credentials and custom headers are usable', () => {
  const policy=R.analyze(url,{request:{Authorization:'Bearer synthetic-test', 'X-Playback-Key':'synthetic-key',Accept:'video/*'}});
  assert.equal(policy.required,true);
  assert.equal(policy.supported,true);
  const init=R.fetchInit(policy,url,{headers:{Range:'bytes=100-199'},credentials:'include',redirect:'follow'});
  assert.equal(init.headers.get('authorization'),'Bearer synthetic-test');
  assert.equal(init.headers.get('x-playback-key'),'synthetic-key');
  assert.equal(init.headers.get('range'),'bytes=100-199');
  assert.equal(init.credentials,'omit');
  assert.equal(init.mode,'cors');
  assert.equal(init.redirect,'error','credentials cannot follow even a same-origin redirect to another origin');
});

test('segment origins never inherit addon credentials, including from earlier init objects', () => {
  const policy=R.analyze(url,{request:{Authorization:'Bearer synthetic-test', 'X-Playback-Key':'synthetic-key'}});
  const original=R.fetchInit(policy,url,{headers:{Range:'bytes=200-299'}});
  const redirected=R.fetchInit(policy,'https://other.example.test/segment.m4s',original);
  assert.equal(redirected.headers.get('authorization'),null);
  assert.equal(redirected.headers.get('x-playback-key'),null);
  assert.equal(redirected.headers.get('range'),'bytes=200-299');
  assert.equal(original.headers.get('authorization'),'Bearer synthetic-test','input object remains unchanged');
});

test('demuxer range wins over a static addon range', () => {
  const policy=R.analyze(url,{request:{Range:'bytes=0-99'}});
  assert.equal(R.fetchInit(policy,url,{headers:{Range:'bytes=100-199'}}).headers.get('range'),'bytes=100-199');
  assert.equal(R.fetchInit(policy,new URL('https://other.example.test/segment'),{headers:{Range:'bytes=100-199'}}).headers.get('range'),'bytes=100-199');
});

test('browser-controlled and response-header requirements explain the server requirement', () => {
  for(const name of ['Referer','Origin','Cookie','Host','User-Agent','Sec-Fetch-Site','Proxy-Authorization','Content-Length']) {
    const policy=R.analyze(url,{request:{[name]:'synthetic'}});
    assert.equal(policy.supported,false,name);
    assert.throws(()=>R.fetchInit(policy,url),/media server/);
  }
  assert.equal(R.analyze(url,{response:{'Access-Control-Allow-Origin':'*'}}).supported,false);
});

test('malformed or unsafe headers fail without exposing values', () => {
  for(const hints of [true,[],{request:[]},{request:{'bad name':'secret'}},{request:{Authorization:'secret\r\nCookie: bad'}},{request:{Authorization:12}},{request:{Authorization:'first',authorization:'second'}}]) {
    const policy=R.analyze(url,hints);
    assert.equal(policy.supported,false);
    assert.throws(()=>R.fetchInit(policy,url),error=>error.playbackType==='access'&&!error.message.includes('secret'));
  }
  const policy=R.analyze(url,{request:{Authorization:'Bearer synthetic'}});
  assert.throws(()=>R.fetchInit(policy,'https://user:secret@media.example.test/stream'),/media server/);
  assert.throws(()=>R.fetchInit(policy,'data:text/plain,test'),/media server/);
});
