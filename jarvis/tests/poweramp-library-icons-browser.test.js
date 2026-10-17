import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';
import {servePowerampFixture,openFixturePage,mobileContext} from './helpers/poweramp-fixture.js';

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
async function assertIcons(page,root,labels){
  const actions=await page.locator(root+' .fab').evaluateAll(buttons=>buttons.map(button=>{
    const icon=button.querySelector(':scope > svg,:scope > .native-icon'),style=icon&&getComputedStyle(icon),rect=icon?.getBoundingClientRect();
    return {label:button.getAttribute('aria-label'),labeled:button.classList.contains('fab-labeled'),
      tag:icon?.tagName.toLowerCase(),raster:icon?.classList.contains('raster-icon'),display:style?.display,
      visibility:style?.visibility,opacity:style?.opacity,width:rect?.width,height:rect?.height,
      mask:style?.maskImage||style?.webkitMaskImage};
  }));
  assert.deepEqual(actions.map(a=>a.label),labels);
  for(const action of actions){
    assert.ok(action.tag,`${action.label} has an icon in ${root}`);
    assert.equal(action.labeled,action.label==='Select');
    if(action.labeled){assert.equal(action.display,'none','Select keeps its approved text-only appearance');continue;}
    assert.notEqual(action.display,'none',`${action.label} icon display in ${root}`);
    assert.notEqual(action.visibility,'hidden');assert.ok(Number(action.opacity)>0);
    assert.ok(action.width>0&&action.height>0,`${action.label} icon has visible geometry`);
    if(action.raster)assert.ok(action.mask&&action.mask!=='none',`${action.label} retains its mask image`);
  }
}

// Required browser rendering target. An unavailable browser fails rather than
// silently skipping the production and downloaded-file computed-style checks.
test('Poweramp real production and downloaded library action icon visibility',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const directory=await mkdtemp(join(tmpdir(),'poweramp-icon-browser-'));let browser,fixture;
  try{
    const preview=await buildPreview(join(directory,'preview.html'));
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    fixture=await servePowerampFixture();
    for(const downloaded of [false,true])await t.test(downloaded?'fresh downloaded preview boot':'production module boot',async()=>{
      let h,context,page;const errors=[];
      try{
        if(downloaded){
          context=await browser.newContext(mobileContext);page=await context.newPage();
          page.on('pageerror',error=>errors.push(error.message));
          await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort('blockedbyclient'):route.continue());
          await page.goto(pathToFileURL(preview.output).href);await page.waitForFunction(()=>window.powerampPreview?.ready);
        }else{h=await openFixturePage(browser,fixture,{count:120,art:false});context=h.context;page=h.page;}
        const settled=()=>page.waitForFunction(()=>!document.querySelector('.player-scene-input')&&!PA.LibraryPageMotion.state&&!PA.LibraryPageMotion.finish&&!document.querySelector('#sc-list').dataset.scene&&!document.querySelector('#sc-library').dataset.scene);
        await page.locator('[data-nav="library"]').tap();await settled();
        await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled();
        const trackLabels=['Shuffle songs','Play songs','Search library','Select','List actions'];
        await assertIcons(page,'.library-header-actions',trackLabels);
        await page.locator('#list-body').evaluate(body=>{body.scrollTop=500;});
        await page.waitForFunction(()=>!document.querySelector('#list-fabs').hidden);
        await assertIcons(page,'#list-fabs',trackLabels);
        await page.locator('#list-body').evaluate(body=>{body.scrollTop=0;});
        await page.waitForFunction(()=>document.querySelector('#list-fabs').hidden);
        await assertIcons(page,'.library-header-actions',trackLabels);
        for(const category of ['Albums','Playlists']){
          await page.locator('#sc-list .library-back').tap();await settled();
          await page.getByRole('button',{name:category,exact:true}).tap();await settled();
          await assertIcons(page,'.library-header-actions',['Search library','List actions']);
          // Explicitly disable only the header to exercise the real group dock.
          await page.evaluate(()=>{PA.NativeSettings.values.list_header_buttons=0;PA.NativeSettings.apply();});
          await page.waitForFunction(()=>!document.querySelector('#list-fabs').hidden);
          await assertIcons(page,'#list-fabs',['Search library','List actions']);
          await page.evaluate(()=>{PA.NativeSettings.values.list_header_buttons=1;PA.NativeSettings.apply();});
        }
        assert.deepEqual(downloaded?errors:h.errors,[]);
        if(downloaded)assert.equal(await page.locator('#preview-error').isHidden(),true);
      }finally{await context?.close();}
    });
  }finally{await browser?.close();await fixture?.close();await rm(directory,{recursive:true,force:true});}
});
