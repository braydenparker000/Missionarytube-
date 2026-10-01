import test from 'node:test';
import assert from 'node:assert/strict';
import {r2PlayerConfig} from '../scripts/r2-player-config.mjs';
const release={apiOrigin:'https://music.example.test',r2ManifestURL:'https://music.example.test/music/partial/manifest.json',r2RootId:'musicRoot123456'};
test('R2 deployment config is independent of Drive settings and includes no credentials',()=>{
  assert.deepEqual(r2PlayerConfig({...release,drive:{apiKey:'test-key'}}),
    {rootId:release.r2RootId,manifestURL:release.r2ManifestURL});
});
test('an unconfigured R2 source stays disabled without affecting Drive',()=>{
  assert.deepEqual(r2PlayerConfig({apiOrigin:release.apiOrigin}),{rootId:'',manifestURL:''});
});
test('R2 source configuration refuses wrong roots, endpoints, credentials and insecure origins',()=>{
  for(const change of [{r2RootId:''},{r2RootId:'../root'},
    {r2ManifestURL:release.r2ManifestURL+'?key=test'},
    {r2ManifestURL:'https://other.test/music/partial/manifest.json'},
    {apiOrigin:'http://music.example.test',r2ManifestURL:'http://music.example.test/music/partial/manifest.json'},
    {apiOrigin:'https://user:pass@music.example.test',r2ManifestURL:'https://user:pass@music.example.test/music/partial/manifest.json'}]) {
    assert.throws(()=>r2PlayerConfig({...release,...change}));
  }
});
