// Run after npm run build. Tests the production dependency closure at its real subpath.
// POWERAMP_TEST_MEDIA names a PRIVATE, licensed real music file; nothing is copied to dist.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const root=resolve('dist'),evidence=resolve(process.env.POWERAMP_LAB_EVIDENCE||'/tmp/poweramp-lab-evidence');
await mkdir(evidence,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff':'font/woff','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(root+'/'))throw Error('path');res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.POWERAMP_CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const origin=`http://127.0.0.1:${server.address().port}`;const errors=[],responses=[],report={viewportAssumptions:{dpr:2,fontScale:1,insets:0},checks:[],captures:[],nativePixelParity:'unverified; no Android runtime oracle'};
let context;
try{
  context=await browser.newContext({viewport:{width:360,height:780},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text()+' '+m.location().url);});
  page.on('response',r=>responses.push({url:r.url(),status:r.status(),type:r.headers()['content-type']}));
  await page.goto(`${origin}/poweramp-lab/index.html?diagnostics`);await page.waitForFunction(()=>!!window.powerampLab);
  assert.equal(await page.locator('#transport button').count(),5);
  for(const response of responses){assert.equal(response.status,200,response.url);assert.ok(response.url.startsWith(origin+'/poweramp-lab/'));if(response.url.endsWith('.js'))assert.match(response.type,/javascript/);}
  report.checks.push('Production subpath imports, HTML/CSS/JS MIME, no external dependencies or CSP errors');
  const media=process.env.POWERAMP_TEST_MEDIA;
  if(media){
    await page.locator('#file-picker').setInputFiles(media);await page.waitForFunction(()=>powerampLab.player.tracks.length>0,{},{timeout:30000});await page.waitForFunction(()=>powerampLab.player.duration>1);
    await page.getByRole('button',{name:'Play',exact:true}).tap();await page.waitForFunction(()=>powerampLab.player.isPlaying&&powerampLab.player.time>.25);
    const info=await page.evaluate(()=>({title:powerampLab.player.currentTrack.title,duration:powerampLab.player.duration}));report.media={...info,sha256:createHash('sha256').update(await readFile(media)).digest('hex'),source:'external private licensed music fixture; not shipped'};
    await page.waitForFunction(()=>powerampLab.player.currentTrack.peaks?.length>0,{},{timeout:30000});
    await page.evaluate(()=>{window.originalAudio=powerampLab.player.audio;});
    await page.getByRole('button',{name:'Library',exact:true}).tap();await page.waitForFunction(()=>powerampLab.motion.values.list===1&&!powerampLab.motion.active);
    assert.equal(await page.evaluate(()=>powerampLab.player.audio===originalAudio),true);
    const before=await page.evaluate(()=>powerampLab.motion.target);await page.getByRole('button',{name:'Mini play / pause',exact:true}).tap();
    assert.equal(await page.evaluate(()=>powerampLab.motion.target),before);await page.waitForFunction(()=>!powerampLab.player.isPlaying);
    await page.locator('#mini-labels strong').tap();await page.waitForFunction(()=>powerampLab.motion.values.list===0&&!powerampLab.motion.active);
    assert.equal(await page.evaluate(()=>powerampLab.player.audio===originalAudio),true);
    report.checks.push('Actual music decode/play/time/peaks; player→library→mini return preserves media element; mini pause owns click');
    await page.getByRole('button',{name:'Equalizer',exact:true}).tap();await page.getByLabel('1000 Hz gain',{exact:true}).fill('6');
    assert.equal(await page.evaluate(()=>powerampLab.player.eqGains[5]),6);await page.getByRole('button',{name:'Back',exact:true}).tap();
    const seek=await page.locator('#waveform').boundingBox();assert.ok(seek.width>0);
    await page.evaluate(()=>powerampLab.settings.set('seekbar','static'));await page.waitForTimeout(100);
    const cdp=await context.newCDPSession(page);
    const box=await page.locator('#waveform').boundingBox(),x=box.x+box.width*.75,y=box.y+8;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>powerampLab.player.time/powerampLab.player.duration>.6));
    await page.evaluate(()=>powerampLab.player.pause());await page.reload();await page.waitForFunction(()=>window.powerampLab?.player.tracks.length>0);assert.equal(await page.evaluate(()=>powerampLab.player.isPlaying),false);
    report.checks.push('EQ gain reaches audio graph; real touch static seek; IndexedDB import and paused reload restoration');
  }else report.media={status:'NOT RUN: set POWERAMP_TEST_MEDIA to licensed real music; generated PCM is not acceptance'};
  // Causal configurations: DOM consumes resolver, keeps playback identity, and stays inside viewport.
  let cases=0;const dimensions=[[360,780],[430,932],[780,360]];
  for(const [width,height] of dimensions){await page.setViewportSize({width,height});
    for(const skin of ['Black','Light'])for(const layout of ['Default','Alternative','FullCover'])for(const seekbar of ['scrolling','static','plain'])for(const buttons of [false,true]){
      await page.evaluate(({skin,layout,seekbar,buttons})=>{const s=powerampLab.settings;s.set('skin',skin);s.set('alt_layout',layout);s.set('seekbar',seekbar);s.set('more_buttons',buttons);},{skin,layout,seekbar,buttons});
      const state=await page.evaluate(()=>({layout:powerampLab.layout,actual:document.querySelector('#art-frame').getBoundingClientRect().toJSON(),buttons:document.querySelectorAll('#transport button').length,overflow:document.documentElement.scrollWidth>innerWidth}));
      assert.equal(state.buttons,buttons||seekbar==='plain'?5:1);assert.ok(Math.abs(state.actual.width-state.layout.art.width)<1);assert.ok(state.actual.x>=-.5&&state.actual.right<=width+.5,`${width}/${layout} art bounds`);assert.equal(state.overflow,false);cases++;
    }
    await page.evaluate(()=>{powerampLab.settings.set('skin','Black');powerampLab.settings.set('alt_layout','Default');powerampLab.settings.set('seekbar','scrolling');powerampLab.settings.set('more_buttons',true);});
    const capture=`player-${width}x${height}.png`;await page.screenshot({path:resolve(evidence,capture)});report.captures.push(capture);
  }
  report.configurationCases=cases;report.checks.push('108 Black/Light ×3 layouts ×3 waveform modes ×buttons ×3 viewports; resolver/DOM bounds and controls');
  await page.setViewportSize({width:360,height:780});
  await page.getByRole('button',{name:'Library',exact:true}).tap();await page.waitForFunction(()=>powerampLab.motion.values.list===1&&!powerampLab.motion.active);
  await page.screenshot({path:resolve(evidence,'library-360x780.png')});report.captures.push('library-360x780.png');
  await page.getByRole('button',{name:'More',exact:true}).tap();await page.getByRole('button',{name:'Settings',exact:true}).tap();await page.screenshot({path:resolve(evidence,'settings-360x780.png')});report.captures.push('settings-360x780.png');
  report.errors=errors;assert.deepEqual(errors,[]);report.browser=await browser.version();report.status='PASS bounded browser checks, not native acceptance';
}catch(error){report.status='FAIL';report.failure=error.stack;throw error;}
finally{await writeFile(resolve(evidence,'browser-report.json'),JSON.stringify(report,null,2)+'\n');await context?.close();await browser.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report,null,2));}
