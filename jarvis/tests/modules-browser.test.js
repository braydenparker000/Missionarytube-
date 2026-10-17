import {conversationMenu} from './helpers/relay-conversation-browser-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve,extname} from 'node:path';
import {chromium} from 'playwright-core';
import {API_ORIGIN} from '../public/assets/config.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';
import {STORAGE_KEY as QUICK_AI_KEY} from '../public/assets/quick-ai-core.js';
import {RELAY_TRANSFER_KEY,LEGACY_TRANSFER_KEY,quickAITransfer} from '../public/assets/relay-transfer.js';
import {OWNER_DRAFT_KEY} from '../public/assets/relay-draft-store.js';
const chrome=process.env.JARVIS_CHROME;
const publicRoot=resolve('public');
const policy=JSON.parse(await readFile(join(publicRoot,'staticwebapp.config.json'),'utf8'));
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.otf':'font/otf'};
const stamp='2026-10-03T03:00:00Z';
const messageId=i=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
const relayMessages=Array.from({length:25},(_,i)=>({id:messageId(i),body:i%2?'## A useful reply\nA **clear answer**, with a [source](https://example.com).\n\n- One practical step\n- A second step\n\n'+('More context. '.repeat(25)):'A question about '+i,role:i%2?'assistant':'user',kind:i%2?'reply':undefined,replyTo:i%2?messageId(i-1):undefined,createdAt:stamp}));
const videos=Array.from({length:24},(_,i)=>({id:'video0000000'+String(i).padStart(2,'0'),name:['Mediterranean Sundance','The craft of photography','Building something remarkable','Winter light','A quiet place to explore','An introduction to rhythm'][i%6]+' '+i+' [vrAMRxBB5KI].mp4',mimeType:'video/mp4',modifiedTime:new Date(Date.parse(stamp)-i*86400000).toISOString(),videoMediaMetadata:{durationMillis:String((i+1)*120000),height:1080,width:1920}}));
const guitarSong={songId:1,revisionId:1,title:'Lágrima',artist:'Francisco Tárrega',tracks:[{partId:0,kind:'guitar',instrumentId:24,instrument:'Classical guitar',name:'Guitar'},{partId:1,kind:'guitar',instrumentId:24,instrument:'Guitar',name:'Second guitar'}]};
const tuning=[64,59,55,50,45,40];
const score={meta:guitarSong,revisions:[{trackMeta:{...guitarSong.tracks[0],tuning},revision:{tuning,instrumentId:24,measures:Array.from({length:8},(_,i)=>({signature:[3,4],voices:[{beats:Array.from({length:3},(_,j)=>({duration:[1,4],notes:[{fret:(i+j)%8,string:j}]}))}]}))}}]};

test('redesigned modules: mobile flows, retained state, safe text and notation preview',{skip:!chrome||!existsSync(chrome),timeout:120000},async t=>{
 const server=createServer(async(req,res)=>{try{let p=resolve(publicRoot,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(publicRoot+'/')&&p!==publicRoot)throw Error();if((await stat(p)).isDirectory())p=join(p,'index.html');res.writeHead(200,{'Content-Type':mime[extname(p)]||'application/octet-stream'});let content=await readFile(p);if(extname(p)==='.html'){const routePath='/'+p.slice(publicRoot.length+1);const csp=(policy.routes.find(r=>routePath.startsWith(r.route.replace('*','')))?.headers?.['Content-Security-Policy']||policy.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g,'');content=content.toString().replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);}res.end(content);}catch{res.writeHead(404);res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 async function session(width=390){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:true}),page=await context.newPage(),errors=[],requests=[],navigations=[];
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations.push(frame.url());});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text());});let inbox=[...relayMessages,{id:messageId(25),role:'user',body:MUSE_PREFIX+'Please find a new album.',createdAt:stamp},{id:messageId(26),role:'assistant',kind:'reply',replyTo:messageId(25),body:'## Your music is ready\nOpen [Poweramp]('+origin+'/drawercast/).',createdAt:stamp}];
  await context.route('**/*',async route=>{
   const r=route.request(),url=new URL(r.url()),json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   requests.push({url:url.href,path:url.pathname,method:r.method(),body:r.postData()});
   if(url.origin===origin){if(url.pathname==='/assets/quick-ai-config.json')return json({version:3,geminiKey:'test-gemini',groqKey:'test-groq',tavilyKey:'test-search'});if(url.pathname==='/assets/drive-config.json')return json({apiKey:'AIza'+'x'.repeat(35),videoFolderId:'folder123456789'});return route.continue();}
   if(url.origin===API_ORIGIN){
    // Emulate a valid old public service rather than aborting the newer route.
    if(url.pathname==='/shared/changes')return json({error:'This fictional legacy service does not support changes'},404);
    if(url.pathname==='/shared/state')return json({mode:'github-publications',coordinationVersion:1,messages:inbox,posts:[],publisher:{ok:true},nextCursor:null,public_inbox:true,author_authenticated:false,execution_authorized:false});
    if(url.pathname==='/shared/messages'){const m=r.postDataJSON(),existing=inbox.find(entry=>entry.id===m.id);if(existing)return existing.role==='user'&&existing.body===m.body?json({entry:existing}):json({error:'Fictional immutable ID conflict'},409);const entry={id:m.id,body:m.body,role:'user',createdAt:stamp};inbox.push(entry);return json({entry},201);}
    if(url.pathname==='/guitar/search')return json({results:[guitarSong]});if(url.pathname==='/guitar/songs/1')return json({song:guitarSong});if(url.pathname==='/guitar/songs/1/score')return json(score);
   }
   if(url.host==='www.googleapis.com'){
    if(url.searchParams.get('alt')==='media')return route.abort();
    if(url.pathname.endsWith('/folder123456789'))return json({id:'folder123456789',name:'My videos',mimeType:'application/vnd.google-apps.folder'});
    const q=url.searchParams.get('q')||'';
    if(q.includes('folder123456789'))return json({files:[0,1,2].map(i=>({id:'collection0000'+i,name:['Guitar','Photography','Long watches'][i],mimeType:'application/vnd.google-apps.folder'}))});
    const index=Number(/collection0000(\d)/.exec(q)?.[1]);return json({files:videos.filter((v,i)=>i%3===index)});
   }
   if(url.host==='generativelanguage.googleapis.com')return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'## A clear answer\nHere is **useful information**.\n\n- First point\n- Second point'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:15,candidatesTokenCount:22}})+'\n\n'});
   return route.abort();
  });
  return {page,context,errors,requests,navigations,addMessage(m){inbox.push(m);}};
 }
 async function checkLayout(page){const m=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:innerHeight,body:document.documentElement.scrollHeight}));assert.ok(m.scroll<=m.width+1,'no document-level horizontal overflow');}
 async function screenshot(page,name){if(process.env.JARVIS_SCREENSHOT_DIR){await mkdir(process.env.JARVIS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.JARVIS_SCREENSHOT_DIR,name+'.png')});}}
 try{
  await t.test('Relay keeps message nodes, reading position and draft during refresh; bookmarks and quotes work',async()=>{
   const s=await session(),{page}=s;await page.goto(origin+'/jarvis/');await page.locator('.message-row').last().waitFor();
   await page.locator('#messages').evaluate(p=>p.scrollTop=0);await page.locator('#message-text').fill('An unfinished thought');
   const token=await page.locator('.message-row').first().evaluate(n=>{n._sentinel='retained';return n.dataset.messageId;});
   const before=await page.locator('#messages').evaluate(p=>p.scrollTop);
   s.addMessage({id:messageId(27),role:'assistant',kind:'reply',replyTo:messageId(24),body:'New reply',createdAt:stamp});
   await conversationMenu(page,'Refresh inbox');await page.locator('[data-message-id="'+messageId(27)+'"]').waitFor();
   assert.equal(await page.locator('.message-row').first().evaluate(n=>n._sentinel),'retained');assert.equal(await page.locator('#message-text').inputValue(),'An unfinished thought');assert.ok(Math.abs(await page.locator('#messages').evaluate(p=>p.scrollTop)-before)<3);
   await page.locator('[data-message-id="'+token+'"] .message-actions').click();await page.getByRole('button',{name:'Bookmark',exact:true}).click();assert.equal(await page.locator('.bookmarked').count(),1);
   await conversationMenu(page,'Bookmarks');assert.equal(await page.locator('.message-row').count(),1);
   await page.locator('.message-actions').click();await page.getByRole('button',{name:'Quote in reply',exact:true}).click();assert.match(await page.locator('#message-text').inputValue(),/> A question/);
   await conversationMenu(page,'Latest messages');await checkLayout(page);await screenshot(page,'relay');assert.deepEqual(s.errors,[]);await s.context.close();
  });
  await t.test('Quick AI streams formatted replies, opens saved chats, and transfers a draft to Relay',async()=>{
   const s=await session(),{page}=s;await page.goto(origin+'/quick-ai/');await page.locator('#prompt').fill('Explain this clearly');await page.locator('#send').click();await page.locator('.ai-message.assistant .reply-menu').waitFor();assert.equal(await page.locator('.ai-message.assistant h3').textContent(),'A clear answer');assert.equal(await page.locator('.ai-message.assistant li').count(),2);
   await page.locator('#chat-drawer').click();assert.equal(await page.locator('.saved-chat-row').count(),1);await page.locator('[data-close="history-dialog"]').click();await checkLayout(page);await screenshot(page,'quick-ai');
   await page.locator('.reply-menu').click();await page.getByRole('button',{name:'Continue in Relay',exact:true}).click();await page.getByRole('button',{name:'Public Relay · shared',exact:true}).click();await page.locator('#message-text').waitFor();assert.match(await page.locator('#message-text').inputValue(),/Explain this clearly/);assert.deepEqual(s.errors,[]);await s.context.close();
  });
  for(const destination of ['owner','public'])for(const failSource of [true,false])
   await t.test(`Quick AI ${destination} transfer ${failSource?'keeps unsaved prompt and answer open after source-save failure':'saves new source content before normal navigation'}`,async()=>{
    const s=await session(360),{page,context}=s;
    try{
     const oldHistory={version:1,active:'source-save',chats:[{id:'source-save',title:'Saved source control',draft:'',provider:'gemini',search:false,messages:[
      {role:'user',content:'Previously saved question',attachments:[]},{role:'assistant',content:'Previously saved answer',status:'complete',attachments:[]}]}]};
     await context.addInitScript(({key,value})=>{if(location.pathname==='/quick-ai/')localStorage.setItem(key,value);},{key:QUICK_AI_KEY,value:JSON.stringify(oldHistory)});
     const sourceURL=origin+'/quick-ai/?fixture=source-save#same';
     await page.goto(sourceURL);await page.locator('#prompt').waitFor();
     const original=await page.evaluate(key=>localStorage.getItem(key),QUICK_AI_KEY);
     if(failSource)await page.evaluate(key=>{
      sessionStorage.setItem(key,JSON.stringify({body:'Existing owner draft stays untouched'}));
      localStorage.setItem('jarvis.shared.v1',JSON.stringify({version:1,messages:[],posts:[],outbox:[],composer:'Existing public draft stays untouched',syncedAt:null}));
     },OWNER_DRAFT_KEY);
     const previousDestinations=await page.evaluate(key=>({owner:sessionStorage.getItem(key),public:localStorage.getItem('jarvis.shared.v1')}),OWNER_DRAFT_KEY);
     await page.evaluate(({key,failSource})=>{
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(name,value){if(failSource&&this===localStorage&&name===key)throw new DOMException('Synthetic source-save failure','QuotaExceededError');return set.call(this,name,value);};
      sessionStorage.setItem('source-save-control','tab storage remains writable');
     },{key:QUICK_AI_KEY,failSource});
     const freshQuestion='New source question for '+destination,freshDraft='New unsent source draft for '+destination;
     await page.locator('#prompt').fill(freshQuestion);await page.locator('#send').click();
     await page.locator('.reply-menu').nth(1).waitFor();
     await page.locator('#prompt').fill(freshDraft);
     const freshAnswer='## A clear answer\nHere is **useful information**.\n\n- First point\n- Second point';
     assert.match(await page.locator('.ai-message.user').last().textContent(),new RegExp(freshQuestion));
     assert.equal(await page.locator('.ai-message.assistant').last().locator('h3').textContent(),'A clear answer');
     const providerRequests=s.requests.filter(request=>new URL(request.url).host==='generativelanguage.googleapis.com');
     assert.equal(providerRequests.length,1);assert.equal(providerRequests[0].method,'POST');assert.ok(providerRequests[0].body.includes(freshQuestion));
     const navigationCount=s.navigations.length;
     await page.locator('.reply-menu').last().click();await page.getByRole('button',{name:'Continue in Relay',exact:true}).click();
     await page.getByRole('button',{name:destination==='owner'?'Owner chat · private':'Public Relay · shared',exact:true}).click();
     if(failSource){
      await page.locator('#storage-status').filter({hasText:'No Relay draft was prepared.'}).waitFor();
      assert.equal(page.url(),sourceURL);assert.equal(s.navigations.length,navigationCount);
      assert.equal(await page.locator('#prompt').inputValue(),freshDraft);
      assert.equal(await page.locator('.ai-message.assistant').last().locator('h3').textContent(),'A clear answer');
      assert.equal(await page.locator('.ai-message.assistant').last().getByRole('button',{name:'Copy',exact:true}).isVisible(),true);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),QUICK_AI_KEY),original,'Failed source saves preserve the previously stored history exactly');
      for(const key of [RELAY_TRANSFER_KEY,LEGACY_TRANSFER_KEY])assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null,'Source-save failure cannot stage either Relay destination');
      assert.deepEqual(await page.evaluate(key=>({owner:sessionStorage.getItem(key),public:localStorage.getItem('jarvis.shared.v1')}),OWNER_DRAFT_KEY),previousDestinations,'Source-save failure leaves both existing destination drafts untouched');
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('source-save-control')),'tab storage remains writable');
     }else{
      await page.waitForURL(origin+'/jarvis/');
      const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),QUICK_AI_KEY);
      assert.equal(saved.chats[0].draft,freshDraft);assert.equal(saved.chats[0].messages.at(-2).content,freshQuestion);assert.equal(saved.chats[0].messages.at(-1).content,freshAnswer);
      const expected=quickAITransfer(freshQuestion,freshAnswer,destination).body;
      if(destination==='public'){await page.locator('#message-text').waitFor();assert.equal(await page.locator('#message-text').inputValue(),expected);}
      else{await page.waitForFunction(key=>!!sessionStorage.getItem(key),OWNER_DRAFT_KEY);assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).body,OWNER_DRAFT_KEY),expected);assert.match(await page.locator('#conversation-visibility').textContent(),/private/i);assert.equal(await page.locator('#message-text').count(),0);}
     }
     assert.deepEqual(s.requests.filter(request=>request.method==='POST'&&new URL(request.url).origin===API_ORIGIN&&/^\/(?:relay\/owner\/|shared\/messages|v1\/messages)/.test(request.path)),[],'Transfer never sends a Relay message or job');
     assert.deepEqual(s.errors,[]);await checkLayout(page);
    }finally{await context.close();}
   });
  await t.test('Muse stays conversation-only, preserves multiline input and renders useful links',async()=>{
   const s=await session(),{page}=s;await page.goto(origin+'/muse/');await page.locator('.incoming').waitFor();assert.equal(await page.getByRole('link',{name:'Poweramp',exact:true}).count(),1);assert.equal(await page.getByText('Activity',{exact:true}).count(),0);await page.locator('#prompt').fill('First line');await page.locator('#prompt').press('Enter');assert.equal(await page.locator('#prompt').inputValue(),'First line\n');await checkLayout(page);await screenshot(page,'muse');assert.deepEqual(s.errors,[]);await s.context.close();
  });
  await t.test('My Media explores collections, filters by time, saves videos and retains navigation',async()=>{
   const s=await session(),{page}=s;await page.goto(origin+'/mymedia/');await page.locator('.feed-grid .video-tile').first().waitFor();assert.equal(await page.locator('.feed-grid .video-tile').count(),24);assert.equal(await page.locator('.featured-collection').count(),0);assert.equal(await page.locator('#library-search').isVisible(),true);assert.equal(await page.locator('#continue').isVisible(),false);await checkLayout(page);await screenshot(page,'my-media');
   await page.locator('[data-view="library"]').click();await page.waitForURL('**/#library');await page.locator('.folder-summary').first().click();await page.locator('.folder-shelf .text-button').first().click();await page.waitForURL('**/#collection=*');await page.locator('.video-grid .video-tile').first().waitFor();assert.equal(await page.locator('.video-grid .video-tile').count(),8);
   await page.locator('.video-menu').first().click();await page.getByRole('button',{name:'Save for later',exact:true}).click();await page.locator('[data-view="saved"]').click();await page.waitForFunction(()=>document.querySelector('#view-title')?.textContent==='Saved');assert.equal(await page.locator('.video-grid .video-tile').count(),1);
   await page.locator('[data-view="explore"]').click();await page.waitForFunction(()=>document.querySelector('#view-title')?.textContent==='Explore');await page.locator('#time-filter').click();await page.getByRole('button',{name:'Under 10 minutes',exact:true}).click();assert.equal(await page.locator('.video-grid .video-tile').count(),5);
   await page.locator('#search-toggle').click();await page.locator('#search').fill('Mediterranean');assert.ok(await page.locator('.video-grid .video-tile').count());assert.deepEqual(s.errors,[]);await s.context.close();
  });
  await t.test('Guitar previews the actual score, reuses it for PDF, saves tracks and reopens saved tabs',async()=>{
   const s=await session(),{page}=s;await page.goto(origin+'/guitar/');await page.locator('#song-query').fill('Lagrima');await page.locator('#search-button').click();await page.locator('.song-result').first().click();await page.locator('#preview-tab').click();await page.locator('#notation-preview img').first().waitFor();await page.waitForFunction(()=>document.querySelector('#notation-preview img')?.naturalWidth>0);assert.equal(await page.locator('#notation-preview img').first().evaluate(n=>n.naturalWidth>0),true);
   await page.locator('#save-tab').click();await checkLayout(page);await screenshot(page,'guitar');await page.locator('#download-pdf').click();await page.locator('#save-pdf').waitFor();assert.equal(await page.locator('#open-pdf').getAttribute('href').then(x=>x.startsWith('blob:')),true);
   await page.locator('[data-guitar-view="saved"]').click();assert.equal(await page.locator('#tab-library .song-result').count(),1);await page.locator('#tab-library .song-result').click();assert.equal(await page.locator('#track-picker').textContent(),'All guitar tracks');assert.equal(await page.locator('#song input[name="part"]:checked').inputValue(),'0,1');assert.deepEqual(s.errors,[]);await s.context.close();
  });
  for(const width of [360,1200])await t.test('all five pages fit '+width+'px',async()=>{const s=await session(width);for(const path of ['jarvis','quick-ai','muse','mymedia','guitar']){await s.page.goto(origin+'/'+path+'/');await s.page.waitForTimeout(100);await checkLayout(s.page);}assert.deepEqual(s.errors,[]);await s.context.close();});
 }finally{await browser.close();await new Promise(done=>server.close(done));}
});
