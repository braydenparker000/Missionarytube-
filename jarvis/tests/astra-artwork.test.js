import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const registrySource=await readFile(new URL('../public/media/assets/js/catalog-registry.js',import.meta.url),'utf8');
const indexSource=await readFile(new URL('../public/media/index.html',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/media/assets/js/app.js',import.meta.url),'utf8');

function registry(){
  const context=vm.createContext({});
  vm.runInContext(registrySource,context);
  return context.AstraCatalogs;
}

test('Astra orders and deduplicates artwork aliases',()=>{
  const catalogs=registry();
  const meta={
    poster:'https://img.test/poster.jpg',
    posterUrl:'https://img.test/poster.jpg',
    imageUrl:'https://img.test/image.jpg',
    thumbnail:'https://img.test/thumb.jpg',
    background:'https://img.test/backdrop.jpg'
  };
  assert.deepEqual(Array.from(catalogs.artCandidates(meta,'poster')),[
    'https://img.test/poster.jpg',
    'https://img.test/image.jpg',
    'https://img.test/thumb.jpg',
    'https://img.test/backdrop.jpg'
  ]);
  assert.deepEqual(Array.from(catalogs.artCandidates(meta,'backdrop')),[
    'https://img.test/backdrop.jpg',
    'https://img.test/thumb.jpg',
    'https://img.test/poster.jpg',
    'https://img.test/image.jpg'
  ]);
  assert.deepEqual(Array.from(catalogs.artCandidates(meta,'video')),[
    'https://img.test/thumb.jpg',
    'https://img.test/image.jpg',
    'https://img.test/backdrop.jpg',
    'https://img.test/poster.jpg'
  ]);
});

test('Astra preserves catalog artwork when full metadata returns blanks',()=>{
  const catalogs=registry();
  const previous={name:'Catalog title',poster:'https://img.test/working.jpg',background:'https://img.test/working-wide.jpg'};
  const merged=catalogs.mergeMeta(previous,{name:'Full title',poster:'  ',background:null,description:'Full description'});
  assert.equal(merged.name,'Full title');
  assert.equal(merged.description,'Full description');
  assert.equal(merged.poster,previous.poster);
  assert.equal(merged.background,previous.background);
  const replaced=catalogs.mergeMeta(previous,{poster:'https://img.test/new.jpg'});
  assert.equal(replaced.poster,'https://img.test/new.jpg');
});

test('Astra startup scripts are deferred and release assets share one version',()=>{
  assert.match(indexSource,/meta name="astra-release" content="0\.34\.6"/);
  assert.match(indexSource,/rel="preconnect" href="https:\/\/v3-cinemeta\.strem\.io"/);
  assert.match(indexSource,/rel="preconnect" href="https:\/\/images\.metahub\.space"/);
  const externalScripts=[...indexSource.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  assert.ok(externalScripts.length>20);
  for(const match of externalScripts){
    assert.match(match[0],/\bdefer\b/,match[1]);
    assert.match(match[1],/\?v=0\.34\.6$/,match[1]);
  }
});

test('Astra images use ordered fallback handling without a referrer',()=>{
  assert.match(appSource,/globalThis\.AstraArtworkFallback=function/);
  assert.match(appSource,/function bindArtwork\(root=document\)/);
  assert.doesNotMatch(appSource,/\son(?:load|error)="/);
  assert.match(appSource,/referrerpolicy="no-referrer"/);
  assert.match(appSource,/AstraCatalogs\.mergeMeta\(item,d\.meta\)/);
});
