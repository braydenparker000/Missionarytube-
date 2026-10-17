import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/media/assets/js/collection-tools.js',import.meta.url),'utf8');
const context=vm.createContext({URL});
vm.runInContext(source,context);
const {restoreAddons,restoreLibrary}=context.AstraCollections;

test('Astra can start with a damaged add-on value and retains valid providers',()=>{
  const defaults=[{url:'https://v3-cinemeta.strem.io/manifest.json',enabled:true}];
  assert.equal(restoreAddons({url:'not-an-array'},defaults)[0].url,defaults[0].url);
  assert.equal(restoreAddons([],defaults).length,0,'an intentionally empty add-on list is preserved');
  const result=restoreAddons([null,{url:'javascript:alert(1)'},{url:'https://addon.test/manifest.json',enabled:false},
    {url:'https://addon.test/manifest.json',enabled:true}],defaults);
  assert.equal(result.length,1);
  assert.equal(result[0].enabled,false);
  assert.equal(result[0].url,'https://addon.test/manifest.json');
});

test('Astra keeps sound saved titles when neighboring browser data is damaged',()=>{
  const result=restoreLibrary({'movie:one':{meta:{type:'movie',id:'one',name:'One'},added:10},
    'movie:two':{meta:null},'movie:wrong':{meta:{type:'movie',id:'another'}},'movie:empty':null});
  assert.deepEqual(Object.keys(result),['movie:one']);
  assert.equal(result['movie:one'].meta.name,'One');
  assert.deepEqual(Object.keys(restoreLibrary('corrupted')),[]);
});
