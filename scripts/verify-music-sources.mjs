import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const release=JSON.parse(await readFile('jarvis-release.json','utf8'));
const expectedPartial=new URL(release.r2ManifestURL).pathname==='/music/partial/manifest.json';
const expectedNative=new URL(release.r2ManifestURL).pathname==='/music/library.json';
const player=release.storageOrigin+'/drawercast/';
const folder='music-verification/browser';
await mkdir(folder,{recursive:true});
const report={checkedAt:new Date().toISOString(),sourceCommit:release.commit,checks:[],passed:false};
let browser,page,touchSession,sample,stage='release';
const sanitize=s=>String(s).replace(/https?:\/\/[^\s<>"']+/g,value=>{
  try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[URL omitted]';}
});
const check=(name,detail)=>{report.checks.push({name,passed:true,...detail});console.log('PASS '+name);};
const media=()=>page.evaluate(()=>[...document.querySelectorAll('audio')].filter(a=>a.currentSrc).map(a=>{
  const u=new URL(a.currentSrc);return {origin:u.origin,partial:u.pathname.startsWith('/music/partial/'),
    currentTime:a.currentTime,duration:a.duration,paused:a.paused,readyState:a.readyState,error:a.error?.code??null};
}));
const contact=(id,x,y)=>({id,x,y,radiusX:1,radiusY:1,force:1});
const touch=(type,points)=>touchSession.send('Input.dispatchTouchEvent',{type,touchPoints:points});
const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>done())));
async function touchSeek(fraction){
  const r=await page.locator('#mini-seek').boundingBox();assert.ok(r);
  await touch('touchStart',[contact(1,r.x+r.width*.1,r.y+r.height/2)]);
  for(let i=1;i<=8;i++){await touch('touchMove',[contact(1,r.x+r.width*(.1+(fraction-.1)*i/8),r.y+r.height/2)]);await frame();}
  await touch('touchEnd',[]);
}
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
  stage=kind+' restored transport controls';
  await page.waitForFunction(()=>{
    const controls=document.querySelector('#transport .ctrls');
    if(document.body.classList.contains('scrubbing')||!controls||Number(getComputedStyle(controls).opacity)<.99)return false;
    return ['#btn-play','[data-act="prev"]','[data-act="next"]'].every(selector=>{
      const button=document.querySelector(selector),r=button?.getBoundingClientRect();
      return r&&r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&
        document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button;
    });
  },null,{timeout:6000});
  check(kind+' transport controls restore and remain tappable',{viewport:'393x852'});
  await page.screenshot({path:folder+'/'+kind+'-playing.png'});
  await page.waitForFunction(()=>document.querySelector('#btn-play')?.getAttribute('aria-label')==='Pause');
  // The gesture suppresses accidental taps briefly; wait on its playback clock.
  await page.waitForFunction(at=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>at+1),after.currentTime,{timeout:6000});
  await page.locator('#btn-play').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].every(a=>a.paused),null,{timeout:6000});
  stage=kind+' mini thumb and expansion';
  await page.locator('[data-nav="library"]').click();
  await page.getByRole('button',{name:'All Songs',exact:true}).click();
  const slider=page.locator('#mini-seek');
  const chosen=await page.evaluate(()=>PA.Engine.current.id);
  await touchSeek(.65);
  await page.waitForFunction(()=>Math.abs(PA.Engine.time()/PA.Engine.duration()-.65)<.015);
  assert.equal(await page.evaluate(()=>PA.Engine.current.id),chosen);assert.ok((await media()).every(a=>a.paused));
  check(kind+' real touch mini seeking preserves the paused song',{viewport:'393x852',fraction:.65});
  const thumb=()=>page.evaluate(()=>{
    const rail=document.querySelector('#mini-seek').getBoundingClientRect(),fill=document.querySelector('#mini-fill');
    const r=fill.getBoundingClientRect(),pseudo=getComputedStyle(fill,'::after');
    return {left:r.left-rail.left,right:r.left+parseFloat(pseudo.width)-rail.right,transform:getComputedStyle(fill).transform};
  });
  await slider.press('Home');
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a.currentSrc&&a.paused&&a.currentTime<.5));
  assert.ok(Math.abs((await thumb()).left)<2);
  await slider.press('End');
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a.currentSrc&&a.paused&&a.duration-a.currentTime<1));
  assert.ok(Math.abs((await thumb()).right)<2);
  assert.notEqual((await thumb()).transform,'none');
  await page.screenshot({path:folder+'/'+kind+'-mini.png'});
  const selected=await page.evaluate(()=>PA.Engine.current.id);
  const title=await page.locator('#mini-title').boundingBox();assert.ok(title);
  await page.mouse.click(title.x+title.width/2,title.y+title.height/2,{clickCount:2});
  await page.locator('#sc-player').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>PA.Engine.current.id),selected);
  assert.ok((await media()).every(a=>a.paused));
  check(kind+' mini thumb reaches both endpoints and rapid expansion preserves paused track',{viewport:'393x852'});
  if(kind==='r2')await restoredTouch();
}
async function restoredTouch(){
  stage='restored metadata-only touch seek';
  const id=await page.evaluate(()=>PA.Engine.current.id);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(id=>PA.Engine.current?.id===id&&PA.Engine.duration()>0&&PA.R2Source.mapping?.complete===true,id,{timeout:60000});
  assert.equal(await page.evaluate(()=>PA.Engine.el().src),'');
  await page.locator('[data-nav="library"]').tap();await page.getByRole('button',{name:'All Songs',exact:true}).tap();
  await touchSeek(.4);
  assert.ok(Math.abs(await page.evaluate(()=>PA.Engine.time()/PA.Engine.duration())-.4)<.015);
  assert.equal(await page.evaluate(()=>PA.Engine.el().src),'');assert.equal(await page.evaluate(()=>PA.Engine.current.id),id);
  await page.locator('#mini-play').tap();
  await page.waitForFunction(()=>!PA.Engine.el().paused&&PA.Engine.el().readyState>=3&&Math.abs(PA.Engine.time()/PA.Engine.duration()-.4)<.04,null,{timeout:15000});
  await page.locator('#mini-play').tap();await page.waitForFunction(()=>PA.Engine.el().paused);
  check('restored song accepts touch seek before Play and resumes at the chosen position',{viewport:'393x852',fraction:.4});
  stage='native scrolling and bounded song window';
  await touchSession.send('Emulation.setCPUThrottlingRate',{rate:4});
  try{
    await touch('touchStart',[contact(1,150,530)]);
    for(let y=510;y>=230;y-=20){await touch('touchMove',[contact(1,150,y)]);await frame();}
    await touch('touchEnd',[]);
    await page.waitForFunction(()=>document.querySelector('#list-body').scrollTop>100);
    assert.equal(await page.evaluate(()=>PA.Engine.current.id),id);assert.equal(await page.evaluate(()=>PA.Engine.el().paused),true);
    const mounted=await page.locator('#list-body .trow').count(),total=await page.evaluate(()=>document.querySelector('#list-body .zoom-list').__items.length);
    assert.ok(mounted<220&&total>mounted);check('native touch scroll keeps the paused song with a bounded DOM',{viewport:'393x852',mounted,total,cpuThrottle:4});
  }finally{await touchSession.send('Emulation.setCPUThrottlingRate',{rate:1});}
  await page.screenshot({path:folder+'/r2-touch-scroll.png'});
}
try{
  const current=await fetch(release.storageOrigin+'/release.json',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  assert.equal(current.commit,release.commit);check('live source pin',{commit:current.commit});
  const [catalog,mapping]=await Promise.all([release.storageOrigin+'/assets/drive-catalog-v2.json',release.r2ManifestURL].map(async url=>{
    const response=await fetch(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200);return response.json();
  }));
  const driveCount=catalog.count;let r2Count=expectedNative?mapping.count:mapping.files.length;
  assert.ok(Number.isSafeInteger(driveCount)&&Number.isSafeInteger(r2Count)&&r2Count>0&&(expectedNative||driveCount>=r2Count));
  assert.equal(mapping.complete,!expectedPartial);
  report.mapMode=expectedNative?'library':mapping.mode;report.mapComplete=mapping.complete;
  stage='browser startup';
  browser=await chromium.launch({headless:true,executablePath:process.env.MUSIC_BROWSER_EXECUTABLE,args:['--no-sandbox']});
  page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
  touchSession=await page.context().newCDPSession(page);
  page.setDefaultTimeout(15000);
  await page.goto(player,{waitUntil:'domcontentloaded'});
  stage='independent libraries';
  // Native uploads may append songs between preflight and the browser's fetch.
  // Validate the exact snapshot committed by the browser, rather than waiting
  // forever for it to equal an earlier independent HTTP response's count.
  await page.waitForFunction(expected=>{
    if(!window.PA)return false;const tracks=[...PA.LIB.map.values()],r2=tracks.filter(t=>t.source==='r2');
    return tracks.filter(t=>t.source==='drive').length===expected.driveCount&&r2.length>0&&
      (expected.native?PA.R2Source?.mapping?.complete===true&&PA.R2Source.mapping.matches(r2):r2.length===expected.r2Count);
  },{driveCount,r2Count,native:expectedNative},{timeout:60000});
  if(expectedNative){r2Count=await page.evaluate(()=>[...PA.LIB.map.values()].filter(t=>t.source==='r2').length);check('current R2 catalog snapshot',{count:r2Count});}
  sample=await page.evaluate(()=>{
    const t=[...PA.LIB.map.values()].filter(t=>t.source==='r2'&&!t.id.startsWith('r2_native_')).sort((a,b)=>a.id.localeCompare(b.id))[0];
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
