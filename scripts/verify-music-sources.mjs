import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const release=JSON.parse(await readFile('jarvis-release.json','utf8'));
const expectedPartial=new URL(release.r2ManifestURL).pathname==='/music/partial/manifest.json';
const player=release.storageOrigin+'/drawercast/';
const folder='music-verification/browser';
await mkdir(folder,{recursive:true});
const report={checkedAt:new Date().toISOString(),sourceCommit:release.commit,checks:[],passed:false};
let browser,page,sample,stage='release';
const sanitize=s=>String(s).replace(/https?:\/\/[^\s<>"']+/g,value=>{
  try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[URL omitted]';}
});
const check=(name,detail)=>{report.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
const media=()=>page.evaluate(()=>[...document.querySelectorAll('audio')].filter(a=>a.currentSrc).map(a=>{
  const u=new URL(a.currentSrc);return {origin:u.origin,partial:u.pathname.startsWith('/music/partial/'),
    currentTime:a.currentTime,duration:a.duration,paused:a.paused,readyState:a.readyState,error:a.error?.code??null};
}));
async function sources(){
  await page.locator('[data-nav="menu"]').click();
  await page.getByRole('button',{name:'Music tools',exact:true}).click();
  await page.locator('#sheet [data-a="sources"]').click();
  await page.locator('#sc-settings[data-page="sources"]').waitFor({state:'visible'});
}
async function toggle(kind,on){
  const control=page.locator('[data-source-toggle="'+kind+'"]');
  if(await control.getAttribute('aria-checked')!==String(on))await control.click();
  assert.equal(await control.getAttribute('aria-checked'),String(on));
}
async function closeSettings(){
  if(await page.locator('#sc-settings').isVisible())await page.locator('#set-close').click();
  await page.locator('#sc-settings').waitFor({state:'hidden'});
}
async function play(kind,origin){
  stage=kind+' playback';
  await closeSettings();await page.locator('[data-nav="search"]').click();
  await page.locator('#q').fill(sample.title);
  const id=(kind==='r2'?'r2_':'gd_')+sample.remoteId;
  await page.locator('#q-body .trow[data-id="'+id+'"]').click();
  // A real user tap selects the track; observe the actual media element.
  await page.waitForFunction(expected=>[...document.querySelectorAll('audio')].some(a=>
    !a.paused&&!a.error&&a.readyState>=3&&a.currentTime>1&&a.currentSrc&&new URL(a.currentSrc).origin===expected),origin,{timeout:30000});
  const first=(await media()).find(a=>!a.paused&&a.origin===origin);
  await page.waitForFunction(at=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&!a.error&&a.currentTime>at+1),first.currentTime,{timeout:6000});
  assert.equal(await page.evaluate(()=>window.PA.Engine.current.source),kind);
  check(kind+' audio advances',{...first,partial:first.partial});
  assert.equal(first.partial,kind==='r2' && expectedPartial);
  if(!await page.locator('#sc-player').isVisible())await page.locator('#mini').click();
  stage=kind+' artwork';
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#artA')).backgroundImage.startsWith('url('),{timeout:15000});
  const artwork=await page.evaluate(async()=>{
    const css=getComputedStyle(document.querySelector('#artA')).backgroundImage;
    const url=css.slice(4,-1).replace(/^"|"$/g,'');
    const img=new Image();img.src=url;await img.decode();
    return {width:img.naturalWidth,height:img.naturalHeight,origin:new URL(url).origin};
  });
  assert.ok(artwork.width>0&&artwork.height>0);assert.equal(artwork.origin,release.storageOrigin);
  check(kind+' artwork renders',artwork);
  stage=kind+' seeking';
  const before=(await media()).find(a=>!a.paused&&a.origin===origin).currentTime;
  const bounds=await page.locator('#transport').boundingBox();assert.ok(bounds);
  await page.mouse.move(bounds.x+bounds.width*.60,bounds.y+18);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.35,bounds.y+18,{steps:12});await page.mouse.up();
  await page.waitForFunction(at=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&!a.error&&a.currentTime>at+5),before,{timeout:10000});
  const after=(await media()).find(a=>!a.paused&&a.origin===origin);
  check(kind+' seek continues playback',{before,after:after.currentTime,origin:after.origin});
  await page.screenshot({path:folder+'/'+kind+'-playing.png'});
  await page.waitForFunction(()=>document.querySelector('#btn-play')?.getAttribute('aria-label')==='Pause');
  // The gesture suppresses accidental taps briefly; wait on its playback clock.
  await page.waitForFunction(at=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>at+1),after.currentTime,{timeout:6000});
  await page.locator('#btn-play').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].every(a=>a.paused),null,{timeout:6000});
}
try{
  const current=await fetch(release.storageOrigin+'/release.json',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  assert.equal(current.commit,release.commit);check('live source pin',{commit:current.commit});
  const [catalog,mapping]=await Promise.all([release.storageOrigin+'/assets/drive-catalog-v2.json',release.r2ManifestURL].map(async url=>{
    const response=await fetch(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200);return response.json();
  }));
  const driveCount=catalog.count,r2Count=mapping.files.length;
  assert.ok(Number.isSafeInteger(driveCount)&&driveCount>=r2Count&&r2Count>0);
  assert.equal(mapping.complete,!expectedPartial);
  report.mapMode=mapping.mode;report.mapComplete=mapping.complete;
  stage='browser startup';
  browser=await chromium.launch({headless:true,executablePath:process.env.MUSIC_BROWSER_EXECUTABLE,args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(15000);
  await page.goto(player,{waitUntil:'domcontentloaded'});
  stage='independent libraries';
  await page.waitForFunction(expected=>window.PA&&[...PA.LIB.map.values()].filter(t=>t.source==='r2').length===expected.r2Count&&
    [...PA.LIB.map.values()].filter(t=>t.source==='drive').length===expected.driveCount,{driveCount,r2Count},{timeout:60000});
  sample=await page.evaluate(()=>{
    const t=[...PA.LIB.map.values()].filter(t=>t.source==='r2').sort((a,b)=>a.id.localeCompare(b.id))[0];
    return {title:t.title,remoteId:t.remoteId};
  });
  await sources();
  await page.getByRole('button',{name:'Manage Cloudflare R2',exact:true}).waitFor();
  await page.getByRole('button',{name:'Manage Google Drive',exact:true}).waitFor();
  check('separate source rows',{driveCount,r2Count});
  await toggle('local',false);await toggle('server',false);await toggle('drive',false);await toggle('r2',true);
  assert.equal(await page.evaluate(()=>PA.Views.counts().all),r2Count);
  await page.screenshot({path:folder+'/separate-sources.png'});
  check('Drive disabled leaves only R2',{count:r2Count});
  await play('r2',release.apiOrigin);
  await sources();await toggle('r2',false);await toggle('drive',true);
  assert.equal(await page.evaluate(()=>PA.Views.counts().all),driveCount);
  check('R2 disabled leaves only Drive',{count:driveCount});
  await play('drive','https://www.googleapis.com');
  await sources();await toggle('drive',false);await toggle('r2',true);
  await page.screenshot({path:folder+'/separate-sources.png'});
  report.passed=true;
}catch(error){
  report.failure={stage,message:sanitize(error.message)};
  if(page)await page.screenshot({path:folder+'/failure.png'}).catch(()=>{});
  process.exitCode=1;console.error('Music source verification failed at '+stage+'. See sanitized report.');
}finally{
  await writeFile(folder+'/report.json',JSON.stringify(report,null,2)+'\n');
  await browser?.close();
}
