import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const origin='https://missionarytube.z13.web.core.windows.net',api='https://jarvis-hub-api.braydenparker999.workers.dev';
const upload=JSON.parse(await readFile('music-verification/native/upload.json','utf8'));
const folder='music-verification/native/browser';await mkdir(folder,{recursive:true});
const report={checkedAt:new Date().toISOString(),sourceCommit:process.env.SOURCE_COMMIT,id:upload.id,passed:false};
let browser,page;
try{
  console.log('Waiting for the exact tested frontend and native R2 configuration.');
  const deadline=Date.now()+15*60000;let ready=false;
  while(Date.now()<deadline){
    const [release,config]=await Promise.all(['/release.json','/assets/r2-config.json'].map(async path=>{
      const r=await fetch(origin+path,{cache:'no-store',signal:AbortSignal.timeout(15000)});return r.json();
    }));
    if(release.commit===process.env.SOURCE_COMMIT&&config.manifestURL===api+'/music/library.json'){ready=true;break;}
    await new Promise(r=>setTimeout(r,10000));
  }
  assert.ok(ready,'The exact tested native frontend was not deployed within 15 minutes');
  browser=await chromium.launch({headless:true,executablePath:process.env.MUSIC_BROWSER_EXECUTABLE,args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});page.setDefaultTimeout(20000);
  await page.goto(origin+'/drawercast/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(id=>window.PA?.LIB.map.has(id),upload.id,{timeout:60000});
  await page.locator('[data-nav="menu"]').click();await page.getByRole('button',{name:'Music tools',exact:true}).click();
  await page.locator('#sheet [data-a="sources"]').click();await page.locator('#sc-settings[data-page="sources"]').waitFor({state:'visible'});
  for(const kind of ['drive','local','server']){const control=page.locator('[data-source-toggle="'+kind+'"]');if(await control.getAttribute('aria-checked')==='true')await control.click();}
  const r2=page.locator('[data-source-toggle="r2"]');if(await r2.getAttribute('aria-checked')!=='true')await r2.click();
  report.driveDisabled=true;assert.equal(await page.evaluate(()=>PA.Views.counts().all),1288);
  await page.locator('#set-close').click();await page.locator('#sc-settings').waitFor({state:'hidden'});
  const title=await page.evaluate(id=>PA.LIB.map.get(id).title,upload.id);
  await page.locator('[data-nav="search"]').click();await page.locator('#q').fill(title);
  await page.locator('#q-body .trow[data-id="'+upload.id+'"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&!a.error&&a.readyState>=3&&a.currentTime>1&&a.currentSrc.includes('/music/library/audio/r2_native_')),null,{timeout:30000});
  if(!await page.locator('#sc-player').isVisible())await page.locator('#mini').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#artA')).backgroundImage.includes('/music/library/art/'));
  const cover=await page.evaluate(async()=>{const css=getComputedStyle(document.querySelector('#artA')).backgroundImage,u=css.slice(4,-1).replace(/^"|"$/g,'');const i=new Image();i.src=u;await i.decode();return {width:i.naturalWidth,height:i.naturalHeight,origin:new URL(u).origin};});
  assert.equal(cover.width,320);assert.equal(cover.height,320);assert.equal(cover.origin,api);report.artwork=cover;
  const active=()=>page.evaluate(()=>{const a=[...document.querySelectorAll('audio')].find(a=>!a.paused&&a.currentSrc);return {time:a.currentTime,duration:a.duration,readyState:a.readyState,error:a.error?.code??null,path:new URL(a.currentSrc).pathname};});
  const before=await active();const bounds=await page.locator('#transport').boundingBox();assert.ok(bounds);
  await page.mouse.move(bounds.x+bounds.width*.35,bounds.y+18);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.65,bounds.y+18,{steps:12});await page.mouse.up();
  await page.waitForFunction(time=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&!a.error&&a.currentTime>time+5),before.time,{timeout:10000});
  report.audio=await active();report.seekBefore=before.time;assert.equal(report.audio.error,null);
  await page.screenshot({path:folder+'/r2-native-playing.png'});report.passed=true;
}catch(error){report.failure=String(error.message).replace(/https?:\/\/[^\s"']+/g,'[URL omitted]');process.exitCode=1;console.error('Native upload player verification failed; see sanitized report.');if(page)await page.screenshot({path:folder+'/failure.png'}).catch(()=>{});}
finally{await writeFile(folder+'/report.json',JSON.stringify(report,null,2)+'\n');await browser?.close();}
