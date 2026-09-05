import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});vm.runInContext(await readFile('assets/js/playback/diagnostics.js','utf8'),context);
const {create,failureCode,describe}=context.AstraPlayback.diagnostics;
test('playback report cannot include source credentials or arbitrary metadata',()=>{
  const log=create();
  log.select({kind:'direct',url:'https://private.example.test/movie?token=SECRET',title:'PRIVATE TITLE',requestPolicy:{required:true,headers:{Authorization:'SECRET'}},facts:{container:'MKV',codec:'H.264',audioCodec:'SECRET'}});
  log.record('failure',{engine:'compatibility',currentTime:12.34,failure:{kind:'network',detail:'HTTP 403 https://private.example.test?token=SECRET'}});
  const text=log.report({release:'0.31.0',capabilities:{mediaSource:true,webCodecs:true}}),data=JSON.parse(text);
  for(const secret of ['SECRET','private.example.test','PRIVATE TITLE','Authorization','https:'])assert.equal(text.includes(secret),false);
  assert.equal(data.source.container,'MKV');assert.equal(data.source.audio,'unknown');assert.equal(data.events[0].failure,'HTTP_403');assert.equal(data.events[0].position,12.3);
});
test('network reports do not pretend to distinguish CORS from connection failures',()=>{
  assert.equal(failureCode({kind:'network',detail:'Failed to fetch'}),'NETWORK_OR_BROWSER_ACCESS');
  assert.match(describe({kind:'network'}),/does not always reveal which/);
  assert.match(describe({detail:'HTTP 410'}),/expired/);assert.match(describe({detail:'HTTP status 429'}),/limiting requests/);
});
test('diagnostics bound repeated buffering events and expose real playback quality',()=>{
  let clock=0;const log=create({now:()=>clock});
  for(let i=0;i<100;i++){clock+=20;log.record('buffering')}
  assert.ok(JSON.parse(log.report()).events.length<4);
  for(let i=0;i<100;i++){clock+=1000;log.record('playing')}
  const data=JSON.parse(log.report({media:{currentTime:35,duration:40,readyState:4,paused:false,getVideoPlaybackQuality:()=>({droppedVideoFrames:2,totalVideoFrames:420})}}));
  assert.equal(data.events.length,40);assert.equal(data.playback.position,35);assert.equal(data.playback.totalFrames,420);
});
