import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
function node(){
  const handlers={},classes=new Set(),captures=new Set();
  return {handlers,style:{setProperty(){}},dataset:{},children:[],clientWidth:393,clientHeight:700,scrollTop:0,hidden:false,
    classList:{add(...s){s.forEach(x=>classes.add(x))},remove(...s){s.forEach(x=>classes.delete(x))},toggle(s){classes.has(s)?classes.delete(s):classes.add(s)},contains:s=>classes.has(s)},
    addEventListener(n,fn,options){(handlers[n]??=[]).push({fn,options})},removeEventListener(){},
    setAttribute(k,v){(this.attrs??={})[k]=v},getAttribute(k){return this.attrs?.[k]??null},contains:()=>true,setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
    getBoundingClientRect:()=>({left:0,top:0,bottom:700,width:393,height:700}),closest:()=>null,
    appendChild(child){this.children.push(child);return child},remove(){},querySelector:()=>null,querySelectorAll:()=>[],cloneNode(){const n=node(),parts=new Map();n.removeAttribute=()=>{};n.setAttribute=()=>{};n.querySelector=s=>{if(!parts.has(s))parts.set(s,node());return parts.get(s)};return n;},
    fire(type,args={}){const e={type,pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:150,clientY:250,target:this,cancelable:true,detail:1,preventDefault(){this.prevented=true},stopPropagation(){this.propagationStopped=true},stopImmediatePropagation(){this.stopped=true},...args};for(const {fn} of handlers[type]||[]){fn(e);if(e.stopped)break;}return e;}
  };
}
function harness(){
 let now=1000,seq=0;const timers=new Map(),frames=new Map(),nodes=new Map(),calls=[];
 const Engine={current:{id:'one'},_playRequest:1,queue:[],pos:0,duration:()=>100,time:()=>20,next:()=>calls.push('next'),prev:()=>calls.push('prev'),toggle:()=>calls.push('toggle'),seek:v=>calls.push(['seek',v]),seekBy:v=>calls.push(['seekBy',v])};
 const doc=node();doc.body=node();const win=node();win.matchMedia=()=>({matches:false});
 const ScreenDrag={state:null,complete(){this.state=null;},pause(){},returnInterrupted(){return false;},abort(){this.state=null},begin(target,direction){this.state??={target,direction};},move(){},end(commit){calls.push(['navigate',commit,this.state?.target,this.state?.direction]);this.state=null;},cancel(){this.state=null;}};
 const context=vm.createContext({Engine,ScreenDrag,SCREENS:{player:'#sc-player',list:'#sc-list'},Sheets:{request:0},SET:{animations:'disabled',longPressMenu:true,longPressMs:480,swipeToChange:true,doubleTapPause:true,seekStyle:'wave',seekStep:10},NativeSettings:{values:{}},Nav:{cur:'player',lastLibrary:'library',go:s=>calls.push(['nav',s])},UI:{setArtEl(){},renderProgress(){},drawViz(){}},
 SwipeArt:{ready:new Map(),cached(t){return this.ready.get(t?.id)||null;},decode:()=>Promise.resolve(),neighbors(){},warm:()=>Promise.resolve(null)},peekTrack:d=>({id:d>0?'two':'zero',title:'Other'}),resolveTrackStep:d=>({track:{id:d>0?'two':'zero',title:'Other'},direction:d,delta:d,kind:'advance'}),commitTrackStep:step=>{step.direction>0?Engine.next():Engine.prev();return true;},ctxMenuTrack:()=>calls.push('menu'),playerSwipeUp:()=>calls.push('swipeUp'),trackSub:()=>'',el:()=>node(),vibrate(){},proSkip:d=>calls.push(['category',d]),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),fmtTime:String,Waveform:{span:()=>100},
 performance:{now:()=>now},Date:{now:()=>now},setTimeout:(fn,ms=0)=>{timers.set(++seq,{fn,at:now+ms});return seq},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms,ms});return seq},clearInterval:id=>timers.delete(id),requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),document:doc,window:win,innerHeight:850,
 $:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},$$:()=>[]});
 vm.runInContext(source.slice(source.indexOf('const InputLifecycle='),source.indexOf('const Nav='))+'\nglobalThis.lifecycle=InputLifecycle;',context);
 vm.runInContext(source.slice(source.indexOf('function paintSeekFraction('),source.indexOf('function setupSeekGestures(')),context);
 const h={context,Engine,ScreenDrag,nodes,calls,doc,win,timers,frames,advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();if(t.ms&&timers.has(id))t.at=now+t.ms;}},paint(){for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}}};
 return h;
}
function run(h,from,to,tail=''){vm.runInContext(source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)+from.length))+tail,h.context);}
function motion(h){run(h,'const GestureMotion=','const SwipeArt=','\nglobalThis.motion=GestureMotion;');}
function art(){const h=harness();motion(h);run(h,'function libraryDestination()','function setupMiniGestures()','\nsetupArtGestures();');return h;}
function swipe(h,n,dx,dy=0){n.fire('pointerdown');h.advance(100);n.fire('pointermove',{clientX:150+dx,clientY:250+dy});h.paint();h.advance(130);n.fire('pointerup',{clientX:150+dx,clientY:250+dy});}
function seek(){const h=harness();run(h,'function setupSeekGestures()','function setupVizGestures()','\nsetupSeekGestures();');return h;}
test('artwork: left and right swipes each change one track',()=>{for(const [dx,expected] of [[-120,'next'],[120,'prev']]){const h=art();swipe(h,h.nodes.get('#artstage'),dx);assert.deepEqual(h.calls,[expected]);}});
test('artwork: insufficient slow swipe returns without skipping',()=>{const h=art();swipe(h,h.nodes.get('#artstage'),30);assert.deepEqual(h.calls,[]);});
test('artwork: double tap toggles playback once',()=>{const h=art(),n=h.nodes.get('#artstage');for(let i=0;i<2;i++){n.fire('pointerdown');h.advance(40);n.fire('pointerup');h.advance(60);}assert.deepEqual(h.calls,['toggle']);});
test('artwork: long press opens menu without a trailing tap',()=>{const h=art(),n=h.nodes.get('#artstage');n.fire('pointerdown');h.advance(500);n.fire('pointerup');assert.deepEqual(h.calls,['menu']);});
test('artwork: pointercancel never changes track',()=>{const h=art(),n=h.nodes.get('#artstage');n.fire('pointerdown');n.fire('pointermove',{clientX:0});h.paint();n.fire('pointercancel',{clientX:0});assert.deepEqual(h.calls,[]);});
test('artwork: second contact cancels swipe; next single-finger gesture recovers',()=>{const h=art(),n=h.nodes.get('#artstage');n.fire('pointerdown');n.fire('pointermove',{clientX:0});n.fire('pointerdown',{pointerId:2,isPrimary:false});n.fire('pointerup',{clientX:0});n.fire('pointerup',{pointerId:2});assert.deepEqual(h.calls,[]);swipe(h,n,-120);assert.deepEqual(h.calls,['next']);});
test('gesture binding: capture loss and backgrounding cancel active drag',()=>{for(const event of ['lostpointercapture','blur','visibilitychange']){const h=art(),n=h.nodes.get('#artstage');n.fire('pointerdown');n.fire('pointermove',{clientX:0});if(event==='blur')h.win.fire(event);else if(event==='visibilitychange'){h.doc.hidden=true;h.doc.fire(event);}else n.fire(event);n.fire('pointerup',{clientX:0});assert.deepEqual(h.calls,[]);}});
test('artwork: ignored buttons do not start swipes',()=>{const h=art(),n=h.nodes.get('#artstage');n.fire('pointerdown',{target:{closest:()=>({})}});n.fire('pointermove',{clientX:0});n.fire('pointerup',{clientX:0});assert.deepEqual(h.calls,[]);});
test('artwork: ambiguous diagonal drags must not count as double tap',()=>{const h=art(),n=h.nodes.get('#artstage');for(let i=0;i<2;i++){n.fire('pointerdown');h.advance(40);n.fire('pointermove',{clientX:170,clientY:270});h.paint();n.fire('pointerup',{clientX:170,clientY:270});h.advance(40);}assert.deepEqual(h.calls,[]);});
test('artwork: vertical swipe opens library',()=>{const h=art();swipe(h,h.nodes.get('#artstage'),0,120);assert.deepEqual(h.calls,[['navigate',true,'library',1]]);});
test('vertical navigation: reversing past the origin must not commit the original direction',()=>{const h=art();h.context.SCREENS={player:'#sc-player',library:'#sc-library'};run(h,'const ScreenDrag=','function libraryDestination()');const n=h.nodes.get('#artstage');n.fire('pointerdown');h.advance(30);n.fire('pointermove',{clientY:130});h.paint();h.advance(150);n.fire('pointermove',{clientY:370});h.paint();h.advance(150);n.fire('pointerup',{clientY:370});assert.equal(h.calls.some(x=>Array.isArray(x)&&x[0]==='nav'),false);});
function mini(){const h=harness();motion(h);run(h,'function setupMiniGestures()','function setupPlayerSwipeDown()','\nsetupMiniGestures();');return h;}
test('mini-player: tap opens player',()=>{const h=mini(),n=h.nodes.get('#mini');n.fire('pointerdown');h.advance(40);n.fire('pointerup');assert.deepEqual(h.calls,[['nav','player']]);});
test('mini-player: upward swipe opens player',()=>{const h=mini();swipe(h,h.nodes.get('#mini'),0,-120);assert.deepEqual(h.calls,[['navigate',true,'player',-1]]);});
test('mini-player: implicit child capture transfer retains tap and upward drag ownership',()=>{
  for(const drag of [false,true]){
    const h=mini(),n=h.nodes.get('#mini'),title=node();n.fire('pointerdown',{target:title});
    assert.equal(n.hasPointerCapture(1),true);
    n.fire('lostpointercapture',{target:title});
    assert.equal(h.context.lifecycle.gesture?.node,n,'old title capture loss must preserve the mini owner');
    h.advance(40);if(drag){n.fire('pointermove',{clientY:130});h.paint();}
    n.fire('pointerup',{clientY:drag?130:250});
    assert.deepEqual(h.calls,drag?[['navigate',true,'player',-1]]:[['nav','player']]);
    assert.equal(h.context.lifecycle.gesture,null);
  }
});
test('mini-player: actual owner loss and genuine child pointercancel still cancel navigation',()=>{
  for(const [type,child] of [['lostpointercapture',false],['pointercancel',true]]){
    const h=mini(),n=h.nodes.get('#mini'),title=node();n.fire('pointerdown',{target:title});
    n.fire('pointermove',{clientY:130});h.paint();n.fire(type,{target:child?title:n});n.fire('pointerup',{clientY:130});
    assert.deepEqual(h.calls,[]);assert.equal(h.context.lifecycle.gesture,null);
  }
});
test('mini-player: play/seek children are excluded from navigation swipe',()=>{const h=mini(),n=h.nodes.get('#mini');n.fire('pointerdown',{target:{closest:()=>({})}});n.fire('pointerup');assert.deepEqual(h.calls,[]);});
test('mini-player: left and right swipes change one track without opening player',()=>{for(const [dx,expected] of [[-120,'next'],[120,'prev']]){const h=mini();swipe(h,h.nodes.get('#mini'),dx);assert.deepEqual(h.calls,[expected]);}});
test('artwork: a song change during animation prevents a stale swipe skip',()=>{const h=art(),n=h.nodes.get('#artstage');h.context.SET.animations='normal';swipe(h,n,-120);h.Engine.current={id:'changed'};h.advance(1000);assert.deepEqual(h.calls,[]);});
test('seek rail: clamps release position to track bounds',()=>{for(const [x,v] of [[-30,0],[500,100]]){const h=seek(),n=h.nodes.get('#seek');n.fire('pointerdown');n.fire('pointerup',{clientX:x});assert.deepEqual(h.calls,[['seek',v]]);}});
test('waveform: horizontal drag commits seek and suppresses trailing click',()=>{const h=seek(),n=h.nodes.get('#transport');n.fire('pointerdown',{target:{closest:()=>null}});n.fire('pointermove',{clientX:100});h.paint();n.fire('pointerup',{clientX:100});assert.ok(h.calls[0][1]>20);assert.equal(n.fire('click').prevented,true);});
test('waveform: canceled or superseded drag does not seek',()=>{for(const mode of ['cancel','changed']){const h=seek(),n=h.nodes.get('#transport');n.fire('pointerdown',{target:{closest:()=>null}});n.fire('pointermove',{clientX:100});if(mode==='changed')h.Engine._playRequest++;n.fire(mode==='cancel'?'pointercancel':'pointerup',{clientX:100});assert.deepEqual(h.calls,[]);assert.equal(h.context.UI.seekDragging,false);}});
function eq(){const h=harness();run(h,'function dragCtl(','/* =====================================================================\n   MAIN MENU');const n=node();h.context.n=n;h.context.moves=[];vm.runInContext('dragCtl(n,(dx,dy)=>moves.push([dx,dy]))',h.context);return {h,n};}
test('EQ: vertical drag reports correct delta',()=>{const {h,n}=eq();n.fire('pointerdown');n.fire('pointermove',{clientY:200});n.fire('pointerup');assert.deepEqual(JSON.parse(JSON.stringify(h.context.moves)),[[0,-50]]);});
test('EQ: second finger must not overwrite active drag origin',()=>{const {h,n}=eq();n.fire('pointerdown');n.fire('pointerdown',{pointerId:2,isPrimary:false,clientY:500});n.fire('pointermove',{clientY:200});assert.deepEqual(JSON.parse(JSON.stringify(h.context.moves)),[[0,-50]]);});
test('EQ: another finger release must not terminate original drag',()=>{const {h,n}=eq();n.fire('pointerdown');n.fire('pointerup',{pointerId:2});n.fire('pointermove',{clientY:200});assert.deepEqual(JSON.parse(JSON.stringify(h.context.moves)),[[0,-50]]);});
test('EQ: lost pointer capture must stop subsequent movement',()=>{const {h,n}=eq();n.fire('pointerdown');n.fire('lostpointercapture');n.fire('pointermove',{clientY:200});assert.equal(h.context.moves.length,0);});
function list(){const h=harness();run(h,'const ListZoom=','// Preserve the existing delegated actions','\nglobalThis.zoom=ListZoom;');const box=node();box.dataset.zoom='3';box.dataset.zoomKey='files';box.contains=()=>true;box.children=[node()];const target=node();target.closest=s=>s==='.zoom-list'?box:box.children[0];h.doc.elementFromPoint=()=>target;for(const sel of ['#list-body','#q-body'])h.context.$(sel).querySelector=()=>box;h.context.zoom.set=(b,id)=>{b.dataset.zoom=String(id);h.calls.push(['zoom',id]);};h.context.zoom.install();return {h,n:h.nodes.get('#list-body'),box,target};}
const touch=(id,x,y)=>({identifier:id,clientX:x,clientY:y});
test('list: one-finger movement leaves scrolling to the browser and blocks accidental row clicks',()=>{const {h,n,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300)]});h.advance(30);const move=n.fire('touchmove',{target,touches:[touch(1,100,200)]});h.paint();n.fire('touchend',{touches:[]});assert.notEqual(move.prevented,true);assert.equal(n.scrollTop,0,'no main-thread scroll writes');assert.equal(h.frames.size,0,'no custom momentum loop');assert.equal(n.fire('click').stopped,true);});
test('list: pinch changes layout and blocks row activation',()=>{const {h,n,box,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300),touch(2,200,300)]});n.fire('touchmove',{target,touches:[touch(1,75,300),touch(2,225,300)]});h.paint();assert.equal(box.dataset.zoom,'4');assert.equal(n.fire('click').stopped,true);n.fire('touchend',{touches:[]});});
test('list: canceled pinch restores starting layout and scroll',()=>{const {h,n,box,target}=list();n.scrollTop=100;n.fire('touchstart',{target,touches:[touch(1,100,300),touch(2,200,300)]});n.fire('touchmove',{target,touches:[touch(1,75,300),touch(2,225,300)]});h.paint();n.fire('touchcancel',{touches:[]});assert.equal(box.dataset.zoom,'3');assert.equal(n.scrollTop,100);});
test('list: remaining finger after pinch does not start an accidental scroll',()=>{const {h,n,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300),touch(2,200,300)]});n.fire('touchend',{touches:[touch(1,100,300)]});n.fire('touchmove',{target,touches:[touch(1,100,100)]});h.paint();assert.equal(n.scrollTop,0);n.fire('touchend',{touches:[]});});

// Deeper pass: interactions between gesture owners, click suppression, and navigation.
test('list: deliberate new tap after settled scroll must be accepted',()=>{const {h,n,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300)]});h.advance(30);n.fire('touchmove',{target,touches:[touch(1,100,200)]});h.paint();h.advance(200);n.fire('touchend',{touches:[]});h.advance(100);n.fire('touchstart',{target,touches:[touch(2,100,200)]});h.advance(40);n.fire('touchend',{touches:[]});assert.notEqual(n.fire('click',{target}).stopped,true);});
test('list: a deliberate new tap immediately after pinching must be accepted',()=>{const {h,n,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300),touch(2,200,300)]});n.fire('touchend',{touches:[]});h.advance(100);n.fire('touchstart',{target,touches:[touch(3,100,200)]});h.advance(40);n.fire('touchend',{touches:[]});assert.notEqual(n.fire('click',{target}).stopped,true);});
test('list: normal stationary tap is not blocked',()=>{const {n,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300)]});n.fire('touchend',{touches:[]});assert.notEqual(n.fire('click',{target}).stopped,true);});
function delegated(){const h=harness(),root=node(),box=node(),row=node();box.__items=[{id:'one'}];box.__spec={kind:'all'};box.parentNode=root;row.parentNode=box;row.dataset.i='0';row.dataset.id='one';row.closest=()=>row;h.context.Selection={mode:false,enter:id=>h.calls.push(['select',id]),toggle:id=>h.calls.push(['select-toggle',id])};h.context.Views={push:s=>h.calls.push(['list-nav',s])};h.context.Engine.setQueue=()=>h.calls.push('play-row');run(h,'function installListDelegation(','/* =====================================================================\n   CONTEXT MENUS');h.context.root=root;vm.runInContext('installListDelegation(root)',h.context);return {h,root,box,row};}
test('row: long press selects without trailing playback',()=>{const {h,root,row}=delegated();root.fire('touchstart',{target:row,touches:[touch(1,100,300)]});h.advance(500);root.fire('touchend',{touches:[]});root.fire('click',{target:row});assert.deepEqual(h.calls,[['select','one']]);});
test('row: scroll movement cancels pending long press',()=>{const {h,root,row}=delegated();root.fire('touchstart',{target:row,touches:[touch(1,100,300)]});root.fire('touchmove',{touches:[touch(1,100,280)]});h.advance(500);assert.deepEqual(h.calls,[]);});
test('row: long press must not fire after app loses focus',()=>{const {h,root,row}=delegated();root.fire('touchstart',{target:row,touches:[touch(1,100,300)]});h.win.fire('blur');h.advance(500);assert.deepEqual(h.calls,[]);});
test('row: long press must not fire after list is replaced',()=>{const {h,root,row,box}=delegated();root.fire('touchstart',{target:row,touches:[touch(1,100,300)]});row.isConnected=false;box.isConnected=false;h.context.Nav.cur='settings';h.advance(500);assert.deepEqual(h.calls,[]);});
test('waveform: a separate button tap right after scrubbing must be accepted',()=>{const h=seek(),n=h.nodes.get('#transport'),target={closest:()=>({})};n.fire('pointerdown',{target:{closest:()=>null}});n.fire('pointermove',{clientX:100});n.fire('pointerup',{clientX:100});h.advance(100);n.fire('pointerdown',{target});n.fire('pointerup',{target});assert.notEqual(n.fire('click',{target}).prevented,true);});
test('waveform: leaving the app during a scrub must clear dragging state',()=>{const h=seek(),n=h.nodes.get('#transport');n.fire('pointerdown',{target:{closest:()=>null}});n.fire('pointermove',{clientX:100});h.win.fire('blur');assert.notEqual(h.context.UI.seekDragging,true);});
test('seek rail: leaving the app during a scrub must clear dragging state',()=>{const h=seek();h.nodes.get('#seek').fire('pointerdown');h.doc.hidden=true;h.doc.fire('visibilitychange');assert.notEqual(h.context.UI.seekDragging,true);});
function alpha(){const h=harness();h.context.$$=(sel,n)=>sel==='span'?Array.from('^#ABCDEFGHIJKLMNOPQRSTUVWXYZ',(letter,i)=>({textContent:letter,getBoundingClientRect:()=>({top:i*25,bottom:(i+1)*25})})):[];run(h,'function alphaInitial(','/* =====================================================================\n   INIT','\nsetupAlphaScrub();');return h;}
test('alphabet strip: capture loss must hide the active letter bubble',()=>{const h=alpha(),n=h.nodes.get('#alpha');n.fire('pointerdown');n.fire('lostpointercapture');assert.equal(h.nodes.get('#alphabubble').classList.contains('on'),false);});
test('alphabet strip: second finger must not move active letter',()=>{const h=alpha(),n=h.nodes.get('#alpha');n.fire('pointerdown',{clientY:100});const before=h.nodes.get('#alphabubble').textContent;n.fire('pointermove',{pointerId:2,isPrimary:false,clientY:600});assert.equal(h.nodes.get('#alphabubble').textContent,before);});
test('alphabet strip: original pointercancel clears letter bubble',()=>{const h=alpha(),n=h.nodes.get('#alpha');n.fire('pointerdown');n.fire('pointercancel');assert.equal(h.nodes.get('#alphabubble').classList.contains('on'),false);});
function viz(){const h=harness();motion(h);h.context.Visualization={reveal(){}};h.context.toggleVizFull=on=>h.calls.push(['viz',on]);h.context.VIZ_PRESETS=[{name:'A'},{name:'B'}];h.context.UI.vizPresetIdx=0;run(h,'function setupVizGestures()','function setupAlphaScrub()','\nsetupVizGestures();');return h;}
test('visualizer: second finger must not trigger a track skip',()=>{const h=viz(),n=h.nodes.get('#vizfull');n.fire('pointerdown');n.fire('pointerup',{pointerId:2,isPrimary:false,clientX:300});assert.deepEqual(h.calls,[]);});
test('shuffle: its context menu must not be overwritten by parent button editor',()=>{const h=harness();h.context.nativeValues=()=>({sub_aa_buttons_no_lp_edit:false});h.context.dialog=title=>h.calls.push(title);h.context.editPlayerButtons=()=>h.calls.push('button-editor');h.context.icoHTML=()=>'';const lines=source.split('\n');vm.runInContext(lines.find(l=>l.includes("$('.togglerow').addEventListener('contextmenu'"))+'\n'+lines.find(l=>l.includes("$('#t-shuffle').oncontextmenu=")),h.context);const child=h.nodes.get('#t-shuffle'),parent=h.nodes.get('.togglerow'),e=child.fire('contextmenu');child.oncontextmenu(e);if(!e.propagationStopped)parent.fire('contextmenu',{target:child});assert.deepEqual(h.calls,['Shuffle']);});

function navigation(h){
 h.context.SCREENS={player:'#sc-player',library:'#sc-library',list:'#sc-list',eq:'#sc-eq'};
 h.context.Selection={mode:false};h.context.history={pushState(){}};h.context.UI.syncNav=()=>{};h.context.UI.fitPlayer=()=>{};h.context.UI.drawCurve=()=>{};h.context.EQ={render(){}};
 motion(h);run(h,'const ScreenDrag=','function libraryDestination()');
 run(h,'const Nav=','window.addEventListener(\'popstate\'','\nglobalThis.navigation=Nav;globalThis.screenDrag=ScreenDrag;');
 return h.context.navigation;
}
test('mini-player expansion makes outgoing list inert before the second click',()=>{
 const {h,root,row}=delegated(),nav=navigation(h),screen=h.context.$('#sc-list');screen.id='sc-list';root.closest=()=>screen;
 nav.go('list');h.calls.length=0;nav.go('player');root.fire('click',{target:row});
 assert.equal(screen.inert,true);assert.equal(h.calls.includes('play-row'),false);
 h.advance(300);assert.equal(screen.hidden,true);
});
test('navigation refreshes progress after the mini-player becomes visible',()=>{
 const h=harness(),nav=navigation(h),mini=h.context.$('#mini');mini.hidden=true;
 const visibility=[];h.context.UI.renderProgress=()=>visibility.push(mini.hidden);
 nav.go('library');assert.deepEqual(visibility,[false]);
});
test('new navigation cancels a pending swipe without overriding the selected tab',()=>{
 const h=harness(),nav=navigation(h);h.context.SET.animations='normal';
 h.context.screenDrag.begin('library',1);h.context.screenDrag.move(180);h.context.screenDrag.end(true,.6);
 nav.go('eq');h.advance(1000);assert.equal(nav.cur,'eq');assert.equal(h.context.$('#sc-library').hidden,true);
});
test('a fast reversal cancels even when the swipe had crossed its distance threshold',()=>{
 const h=harness();motion(h);assert.equal(h.context.motion.commits(-130,1,393),false);assert.equal(h.context.motion.commits(130,-1,393),false);
 assert.equal(h.context.motion.commits(-130,-1,393),true);
});
test('interrupted artwork settling starts the next contact at its displayed position',()=>{
 const h=art();h.context.SET.animations='normal';const stage=h.nodes.get('#artstage'),a=h.nodes.get('#artA');swipe(h,stage,-120);
 h.context.getComputedStyle=n=>({transform:n===a?'matrix(1,0,0,1,-60,0)':n.style.transform});
 stage.fire('pointerdown');assert.equal(a.style.transform,'translateX(-60px)');h.advance(80);stage.fire('pointermove',{clientX:170});h.paint();assert.equal(a.style.transform,'translateX(-40px)');
 stage.fire('pointerup',{clientX:170});h.advance(600);assert.deepEqual(h.calls,[]);
});
test('tapping to interrupt an artwork settle neither skips nor becomes a double tap',()=>{
 const h=art();h.context.SET.animations='normal';const stage=h.nodes.get('#artstage'),a=h.nodes.get('#artA');swipe(h,stage,-120);
 h.context.getComputedStyle=n=>({transform:n===a?'matrix(1,0,0,1,-60,0)':n.style.transform});
 stage.fire('pointerdown');h.advance(40);stage.fire('pointerup');h.advance(600);assert.deepEqual(h.calls,[]);assert.equal(a.style.transform,'');
});
test('interrupted mini-player settling retains its content position and cancels the old skip',()=>{
 const h=mini();h.context.SET.animations='normal';const n=h.nodes.get('#mini'),slide=n.children[0];swipe(h,n,-120);
 h.context.getComputedStyle=node=>({transform:node===slide?'matrix(1,0,0,1,-60,0)':node.style.transform});
 n.fire('pointerdown');assert.equal(slide.style.transform,'translateX(-60px)');h.advance(80);n.fire('pointermove',{clientX:180});h.paint();assert.equal(slide.style.transform,'translateX(-30px)');
 n.fire('pointerup',{clientX:180});h.advance(600);assert.deepEqual(h.calls,[]);
});
test('vertical settling resumes and reverses from the displayed position without stale navigation',()=>{
 const h=harness(),nav=navigation(h),drag=h.context.screenDrag;h.context.SET.animations='normal';drag.begin('library',1);drag.move(180);drag.end(true,.6);
 const to=h.context.$('#sc-library');h.context.getComputedStyle=n=>({transform:n===to?'matrix(1,0,0,1,0,-400)':n.style.transform});
 drag.pause();assert.equal(to.style.transform,'translateY(-400px)');drag.begin('eq',-1);assert.equal(drag.state.progress,300);assert.equal(drag.state.target,'library');
 drag.move(-80);assert.equal(drag.state.progress,220);assert.equal(to.style.transform,'translateY(-480px)');drag.end(false,-.6);h.advance(600);
 assert.equal(nav.cur,'player');assert.equal(to.hidden,true);
});
test('a held contact interrupts vertical navigation and release resumes the owned destination',()=>{
 const h=harness(),nav=navigation(h),drag=h.context.screenDrag;h.context.SET.animations='normal';drag.begin('library',1);drag.move(180);drag.end(true,.6);
 const to=h.context.$('#sc-library');h.context.getComputedStyle=n=>({transform:n===to?'matrix(1,0,0,1,0,-400)':n.style.transform});drag.pause();h.advance(600);assert.equal(nav.cur,'library');
 assert.equal(drag.returnInterrupted(),true);h.advance(600);assert.equal(nav.cur,'library');assert.equal(to.hidden,false);assert.equal(h.context.$('#sc-player').hidden,true);
});
test('visual offsets support both 2D and 3D transform matrices',()=>{
 const h=harness();motion(h);const n=node();h.context.getComputedStyle=()=>({transform:'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,12,-34,0,1)'});
 assert.equal(h.context.motion.offset(n),12);assert.equal(h.context.motion.offset(n,'y'),-34);
});
test('rotation cancels a mini seek contact before cached geometry can commit the wrong position',()=>{
 const h=seek(),n=h.nodes.get('#mini-seek');n.fire('pointerdown');h.win.fire('resize');n.fire('pointerup',{clientX:393});assert.deepEqual(h.calls,[]);assert.equal(h.context.UI.seekDragging,false);
 n.fire('pointerdown',{clientX:0});n.fire('pointerup',{clientX:196.5});assert.deepEqual(h.calls,[['seek',50]]);
});
test('canceled visualizer contact never skips a track',()=>{
 const h=viz(),n=h.nodes.get('#vizfull');n.fire('pointerdown');n.fire('pointermove',{clientX:300});h.paint();n.fire('pointercancel');assert.deepEqual(h.calls,[]);
});
test('a moved label contact suppresses its click but a fresh tap and keyboard activation work',()=>{
 const h=harness();motion(h);const n=node(),label=node();h.context.n=n;vm.runInContext('GestureMotion.bind(n,{})',h.context);
 n.fire('pointerdown',{target:label});n.fire('pointermove',{target:label,clientY:370});n.fire('pointerup',{target:label,clientY:370});
 assert.equal(n.fire('click',{target:label}).prevented,true);
 n.fire('pointerdown',{target:label});n.fire('pointerup',{target:label});assert.notEqual(n.fire('click',{target:label}).prevented,true);
 assert.notEqual(n.fire('click',{target:label,detail:0}).prevented,true);
});
test('mini seek commits once, ignores another finger, and never opens the player',()=>{
 const h=seek(),n=h.nodes.get('#mini-seek');n.fire('pointerdown',{clientX:0});n.fire('pointerup',{pointerId:2,clientX:393});assert.deepEqual(h.calls,[]);
 n.fire('pointerup',{clientX:196.5});assert.deepEqual(h.calls,[['seek',50]]);assert.equal(n.fire('click').prevented,true);
});
test('mini seek cancels after backgrounding or a song change and supports keyboard seeking',()=>{
 for(const mode of ['background','changed']){const h=seek(),n=h.nodes.get('#mini-seek');n.fire('pointerdown');if(mode==='background')h.win.fire('blur');else h.Engine.current={id:'new'};n.fire('pointerup',{clientX:393});assert.deepEqual(h.calls,[]);assert.equal(h.context.UI.seekDragging,false);}
 const h=seek();h.nodes.get('#mini-seek').fire('keydown',{key:'ArrowRight'});assert.deepEqual(h.calls,[['seek',25]]);
});
test('playback progress does not overwrite a mini seek preview while the finger owns it',()=>{
 const h=seek(),n=h.nodes.get('#mini-seek'),fill=h.context.$('#mini-fill');
 const start=source.indexOf('  renderProgress:function('),end=source.indexOf('  lastProg:',start);
 vm.runInContext('UI.renderProgress='+source.slice(start+'  renderProgress:'.length,end).trim().replace(/,$/,'')+';',h.context);
 n.fire('pointerdown',{clientX:196.5});h.context.UI.renderProgress();assert.equal(fill.style.transform,'translateX(50%)');assert.equal(n.attrs['aria-valuenow'],'50');assert.equal(n.attrs['aria-valuetext'],'50 of 100');
 n.fire('pointercancel');assert.equal(fill.style.transform,'translateX(20%)');assert.equal(n.attrs['aria-valuenow'],'20');
});
test('mini seeking measures its rail once per contact and commits against the same bounds',()=>{
 const h=seek(),n=h.nodes.get('#mini-seek');let reads=0;
 n.getBoundingClientRect=()=>{reads++;return {left:0,width:400};};
 n.fire('pointerdown',{clientX:100});n.fire('pointermove',{clientX:200});n.fire('pointermove',{clientX:300});h.paint();n.fire('pointerup',{clientX:300});
 assert.equal(reads,1);assert.deepEqual(h.calls,[['seek',75]]);assert.equal(h.nodes.get('#mini-fill').style.transform,'translateX(75%)');
});
test('mini seek batches movement into one display frame and cancels the pending paint on release',()=>{
 const h=seek(),n=h.nodes.get('#mini-seek'),fill=h.context.$('#mini-fill');
 n.fire('pointerdown',{clientX:0});for(let i=1;i<=20;i++)n.fire('pointermove',{clientX:i*10});
 assert.equal(h.frames.size,1);assert.equal(fill.style.transform,'translateX(0%)');h.paint();
 assert.ok(fill.style.transform.startsWith('translateX(50.'));
 n.fire('pointermove',{clientX:300});n.fire('pointercancel');assert.equal(h.frames.size,0);assert.equal(h.context.UI.seekDragging,false);
});
test('gesture velocity and tap duration use contact timestamps when event processing is delayed',()=>{
 const h=harness();motion(h);const n=node(),done=[];h.context.n=n;h.context.done=done;
 vm.runInContext('GestureMotion.bind(n,{end:s=>done.push(s)})',h.context);
 n.fire('pointerdown',{timeStamp:2000});h.advance(600);
 n.fire('pointermove',{clientX:110,timeStamp:2020});h.advance(500);
 n.fire('pointerup',{clientX:110,timeStamp:2030});
 assert.equal(done[0].vx,-2);assert.equal(done[0].elapsed,30);
 n.fire('pointerdown',{timeStamp:3000});n.fire('pointermove',{clientX:110,timeStamp:3020});n.fire('pointerup',{clientX:110,timeStamp:3200});
 assert.equal(done[1].vx,0,'a real pause before release cancels stale momentum');
});
function tapButton(){const h=harness(),button=node();h.context.button=button;run(h,'function bindTapButton(','function bindTransportButton(');vm.runInContext('bindTapButton(button,()=>Engine.toggle())',h.context);return {h,button};}
test('play buttons act on the owning touch release even when Chrome emits no click',()=>{
 const {h,button}=tapButton();button.fire('pointerdown');h.advance(30);button.fire('pointerup');assert.deepEqual(h.calls,['toggle']);
 assert.equal(button.fire('click').prevented,true,'compatibility click cannot activate twice');
 button.fire('pointerdown');h.advance(30);button.fire('pointerup');assert.deepEqual(h.calls,['toggle','toggle']);
});
test('play touches cannot activate after movement, cancellation, or lifecycle changes',()=>{
 for(const mode of ['move','cancel','background']){const {h,button}=tapButton();button.fire('pointerdown');if(mode==='move')button.fire('pointermove',{clientX:200});else if(mode==='cancel')button.fire('pointercancel');else h.win.fire('blur');button.fire('pointerup');assert.deepEqual(h.calls,[]);assert.equal(button.fire('click').prevented,true,'a canceled touch cannot become a compatibility click');}
 const {h,button}=tapButton();button.fire('pointerdown');button.fire('pointerdown',{pointerId:2,isPrimary:false});button.fire('pointerup');assert.deepEqual(h.calls,[]);
});
test('play mouse and keyboard clicks remain available without duplicate pointer actions',()=>{
 const {h,button}=tapButton();button.fire('pointerdown',{pointerType:'mouse'});button.fire('pointerup',{pointerType:'mouse'});assert.deepEqual(h.calls,[]);
 button.onclick({stopPropagation(){}});assert.deepEqual(h.calls,['toggle']);
 button.fire('pointerdown');button.fire('pointerup');assert.notEqual(button.fire('click',{detail:0}).prevented,true);button.onclick({stopPropagation(){}});assert.deepEqual(h.calls,['toggle','toggle','toggle']);
});
test('track menus open immediately and late artwork cannot reopen or overwrite a newer menu',async()=>{
 const h=harness(),resolvers=new Map(),heads=[],arts=[];
 h.context.getArtURL=t=>new Promise(resolve=>resolvers.set(t.id,resolve));h.context.esc=String;h.context.icoHTML=()=>'';
 h.context.openSheet=()=>{h.context.Sheets.open='sheet';h.context.Sheets.request++;h.calls.push('menu-open');};h.context.trackSub=()=>'';
 h.context.$('#sheet').querySelector=()=>{const head=node();head.isConnected=true;heads.push(head);return head;};h.context.UI.setArtEl=(head,url)=>arts.push(url);
 run(h,'async function ctxMenuTrack(','function trackAction(');
 const a=h.context.ctxMenuTrack({id:'A',title:'First'});assert.deepEqual(h.calls,['menu-open']);await a;
 await h.context.ctxMenuTrack({id:'B',title:'Second'});resolvers.get('A')('art-A');resolvers.get('B')('art-B');await Promise.resolve();assert.deepEqual(arts,['art-B']);
 await h.context.ctxMenuTrack({id:'C',title:'Third'});h.context.Sheets.open=null;h.context.Sheets.request++;resolvers.get('C')('art-C');await Promise.resolve();assert.deepEqual(arts,['art-B']);assert.equal(h.calls.length,3);
});
test('display deduplication requires matching migration identity, checksum, size, and enabled R2',()=>{
 const h=harness(),drive={id:'drive:old',remoteId:'old',source:'drive',md5:'a',size:100},r2={id:'r2:old',remoteId:'old',source:'r2',md5:'a',size:100},other={...drive,id:'drive:other',remoteId:'other'};
 h.context.LIB={ids:[drive.id,r2.id,other.id],map:new Map([drive,r2,other].map(t=>[t.id,t]))};h.context.SourceLibrary={enabled:()=>true,kind:t=>t.source};
 run(h,'function sourceTrackEnabled(','async function loadLibrary(');
 assert.deepEqual(Array.from(h.context.allTracks(),t=>t.id),[r2.id,other.id]);assert.equal(h.context.allTracks(true).length,3);
 r2.md5='b';assert.equal(h.context.allTracks().length,3);r2.md5='a';r2.size=101;assert.equal(h.context.allTracks().length,3);
 r2.size=100;h.context.SourceLibrary.enabled=kind=>kind!=='r2';assert.deepEqual(Array.from(h.context.allTracks(),t=>t.id),[drive.id,other.id]);
});
test('upcoming display follows playback order and repeat modes',()=>{
 const h=harness();h.context.PlaybackQueue={active:false};h.context.sourceTrackEnabled=()=>true;h.Engine.queue=[{id:'A'},{id:'B'},{id:'C'}];h.Engine.order=[2,0,1];h.Engine.pos=1;h.Engine.current=h.Engine.queue[0];
 run(h,'function upcomingTracks()','function installPlaybackRework()');
 assert.deepEqual(Array.from(h.context.upcomingTracks(),t=>t.id),['B']);h.context.SET.repeatMode='all';assert.deepEqual(Array.from(h.context.upcomingTracks(),t=>t.id),['B','C','A']);
 h.context.SET.repeatMode='one';assert.deepEqual(Array.from(h.context.upcomingTracks(),t=>t.id),['A']);
});
test('added queue completion takes precedence over repeat-all in the displayed order',()=>{
 const h=harness();h.context.PlaybackQueue={active:true};h.context.nativeValues=()=>({queue_end:1});h.context.sourceTrackEnabled=t=>!!t;h.Engine.queue=[{id:'A'},{id:'B'}];h.Engine.order=[0,1];h.Engine.pos=1;h.context.SET.repeatMode='all';
 run(h,'function upcomingTracks()','function installPlaybackRework()');assert.deepEqual(Array.from(h.context.upcomingTracks()),[]);
 h.context.nativeValues=()=>({queue_end:0});assert.deepEqual(Array.from(h.context.upcomingTracks(),t=>t.id),['A','B']);
});
test('playback order keeps exact queue indices for repeated songs',()=>{
 const h=harness();h.context.PlaybackQueue={active:false};h.context.sourceTrackEnabled=t=>!!t;h.Engine.queue=[{id:'A'},{id:'B'},{id:'A'}];h.Engine.order=[0,1,2];h.Engine.pos=1;
 run(h,'function upcomingTracks()','function installPlaybackRework()');assert.deepEqual(Array.from(h.context.upcomingIndices()),[2]);
});
test('rows accept Enter and Space without duplicate click actions',()=>{
 const {h,root,row}=delegated();root.fire('keydown',{target:row,key:'Enter'});root.fire('keydown',{target:row,key:' '});assert.equal(h.calls.filter(x=>x==='play-row').length,2);
});
test('a context menu cannot activate a row during a pinch even with detail zero',()=>{
 const {n,target}=list();n.fire('touchstart',{target,touches:[touch(1,100,300),touch(2,200,300)]});assert.equal(n.fire('contextmenu',{detail:0}).stopped,true);
});
test('A–Z can reach a row that is still loading; a newer view cancels the deferred jump',()=>{
 for(const cancel of [false,true]){const h=alpha(),strip=h.nodes.get('#alpha'),body=h.nodes.get('#list-body'),box=node();let pending;
  strip.__anchors=new Map([['Z',900]]);box.isConnected=true;box.__ensureRow=(i,fn)=>{assert.equal(i,900);pending=fn;return null};body.querySelector=()=>box;
  strip.fire('pointerdown',{clientY:687});strip.fire('pointerup');if(cancel)h.context.lifecycle.cancel();pending({offsetTop:900});assert.equal(body.scrollTop,cancel?0:840);
 }
});
test('alphabet hit testing uses visible letter bounds rather than the strip padding',()=>{
 const h=alpha(),strip=h.nodes.get('#alpha');strip.getBoundingClientRect=()=>({top:64,height:566.421875});
 h.context.$$=sel=>sel==='span'?Array.from('^#ABCDEFGHIJKLMNOPQRSTUVWXYZ',(text,i)=>({textContent:text,getBoundingClientRect:()=>({top:133.484375+i*15.265625,bottom:148.75+i*15.265625})})):[];
 strip.fire('pointerdown',{clientY:553});assert.equal(h.nodes.get('#alphabubble').textContent,'Z');strip.fire('pointerup');assert.equal(h.nodes.get('#alphabubble').classList.contains('on'),false);
});
test('alphabet anchors fold accented initials and do not let non-Latin titles preempt Z',()=>{
 const h=harness();h.context.baseName=value=>value.split('/').pop();
 run(h,'function alphaInitial(','function setupAlphaScrub()');
 const start=source.indexOf('  buildAlpha:function('),end=source.indexOf('  buildFabs:',start);
 vm.runInContext('globalThis.buildAlpha='+source.slice(start+'  buildAlpha:'.length,end).trim().replace(/,$/,'')+';',h.context);
 const titles=[...Array.from({length:30},(_,i)=>'A'+i),'Över Frusen Mark','Pacifico','Zapateado','Zero','東京'];
 for(const type of ['tracks','groups']){
  h.context.buildAlpha({type,open:'folder',items:titles.map(title=>({title,key:'Music/'+title}))});
  const anchors=h.nodes.get('#alpha').__anchors;
  assert.equal(anchors.get('O'),30);assert.equal(anchors.get('Z'),32);assert.equal(anchors.get('W'),32);assert.equal(anchors.get('#'),34);
 }
});
test('the final song-row renderer exposes a named keyboard button',()=>{
 const h=harness();h.context.Views={};h.context.nativeValues=()=>({});h.context.trackArtist=()=> 'Artist';h.context.trackAlbum=()=> 'Album';h.context.icoHTML=()=>'';h.context.esc=String;
 run(h,'Views.rowHTML=function','const groupsBeforeRework=');const html=h.context.Views.rowHTML({id:'song',title:'Title'},0,{kind:'all'});
 assert.match(html,/role="button" tabindex="0" aria-label="Title — Artist — Album"/);
});
test('playlist rows expose the playlist name without throwing',()=>{
 const h=harness();h.context.icoHTML=()=>'';h.context.esc=String;const start=source.indexOf('playlistList:function('),end=source.indexOf('  buildAlpha:',start);
 vm.runInContext('globalThis.playlists='+source.slice(start+'playlistList:'.length,end).trim().replace(/,$/,'')+';',h.context);
 assert.match(h.context.playlists([{name:'Favorites',ids:['song']}]).innerHTML,/aria-label="Favorites"/);
});

// A release can report newer coordinates than the last delivered move.
// Test the actual handler rather than assuming browser move and paint ordering.
test('waveform release commits its final coordinate rather than its last move preview',()=>{
 const h=seek(),n=h.nodes.get('#transport');n.fire('pointerdown',{clientX:150});n.fire('pointermove',{clientX:100});h.paint();n.fire('pointerup',{clientX:50});
 assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'seek');assert.ok(Math.abs(h.calls[0][1]-(20+100/393*100))<1e-8);assert.equal(h.context.UI.seekDragging,false);
});
test('waveform movement first observed at release is a seek and cannot become a transport tap',()=>{
 const h=seek(),n=h.nodes.get('#transport');n.fire('pointerdown',{clientX:150});n.fire('pointerup',{clientX:50});
 assert.equal(h.calls.length,1);assert.ok(Math.abs(h.calls[0][1]-(20+100/393*100))<1e-8);assert.equal(n.fire('click').prevented,true);
});
test('waveform static rail release uses its cached geometry and final position',()=>{
 const h=seek(),n=h.nodes.get('#transport');h.context.SET.nativeSeekbar=1;let reads=0;n.getBoundingClientRect=()=>{reads++;return {left:10,width:400};};
 n.fire('pointerdown',{clientX:100});n.fire('pointermove',{clientX:200});h.paint();n.fire('pointerup',{clientX:310});
 assert.deepEqual(h.calls,[['seek',75]]);assert.equal(reads,1,'only the contact start measures the timeline');
});
test('release-coordinate waveform seek cannot survive a song change, other pointer, or cancellation',()=>{
 for(const mode of ['song','pointer','cancel']){const h=seek(),n=h.nodes.get('#transport');n.fire('pointerdown',{clientX:150});n.fire('pointermove',{clientX:100});
  if(mode==='song')h.Engine.current={id:'replacement'};n.fire(mode==='cancel'?'pointercancel':'pointerup',{clientX:50,...(mode==='pointer'?{pointerId:2}:{})});assert.deepEqual(h.calls,[]);
 }
});
test('seek rail caches geometry for the whole contact and commits its release coordinate',()=>{
 const h=seek(),n=h.nodes.get('#seek');let reads=0;n.getBoundingClientRect=()=>{reads++;return {left:10,width:400};};
 n.fire('pointerdown',{clientX:100});n.fire('pointermove',{clientX:200});n.fire('pointerup',{clientX:310});
 assert.deepEqual(h.calls,[['seek',75]]);assert.equal(reads,1);
});

function transportButton(action){
 const h=harness(),button=node();button.dataset.act=action;h.context.button=button;
 run(h,'function bindTapButton(','function paintSeekFraction(');vm.runInContext('bindTransportButton(button)',h.context);return {h,button};
}
test('transport next and previous act exactly once on touch release without compatibility click',()=>{
 for(const action of ['next','prev']){const {h,button}=transportButton(action);button.fire('pointerdown');h.advance(30);button.fire('pointerup');assert.deepEqual(h.calls,[action]);assert.equal(button.fire('click').prevented,true);}
});
test('transport touch movement, cancellation, capture loss, and app blur cannot skip a song',()=>{
 for(const mode of ['movement','cancel','capture','blur']){const {h,button}=transportButton('next');button.fire('pointerdown');
  if(mode==='movement')button.fire('pointermove',{clientX:170});else if(mode==='cancel')button.fire('pointercancel');else if(mode==='capture')button.fire('lostpointercapture');else h.win.fire('blur');
  button.fire('pointerup');assert.deepEqual(h.calls,[]);assert.equal(button.fire('click').prevented,true);
 }
});
test('transport release during a waveform scrub is suppressed but a fresh tap works',()=>{
 const {h,button}=transportButton('next');button.fire('pointerdown');h.context.UI.seekDragging=true;button.fire('pointerup');assert.deepEqual(h.calls,[]);
 h.context.UI.seekDragging=false;button.fire('pointerdown');button.fire('pointerup');assert.deepEqual(h.calls,['next']);
});
test('transport rewind and fast-forward hold seek once and cannot also skip a category',()=>{
 for(const [action,amount] of [['ff',10],['rew',-10]]){const {h,button}=transportButton(action);button.fire('pointerdown');h.advance(460);assert.deepEqual(h.calls,[['seekBy',amount]]);
  button.fire('pointerup');assert.deepEqual(h.calls,[['seekBy',amount]]);assert.equal(button.fire('click').prevented,true);
 }
});
test('transport keyboard activation works after an owned touch and during click suppression',()=>{
 const {h,button}=transportButton('next');button.fire('pointerdown');button.fire('pointerup');const event=button.fire('click',{detail:0});assert.notEqual(event.prevented,true);button.onclick(event);assert.deepEqual(h.calls,['next','next']);
});

test('a new seek or control contact cancels a pending artwork skip before it can replace the selected song',()=>{
 const h=art();h.context.SET.animations='normal';const stage=h.nodes.get('#artstage'),outside=node();stage.contains=target=>target===stage;
 swipe(h,stage,-120);assert.ok(h.context.lifecycle.motionSettle);
 h.doc.fire('pointerdown',{target:outside,pointerId:8});h.advance(600);assert.deepEqual(h.calls,[]);assert.equal(h.nodes.get('#artA').style.transform,'');assert.equal(h.context.lifecycle.motionSettle,null);
 h.doc.fire('pointerup',{pointerId:8});swipe(h,stage,-120);h.advance(600);assert.deepEqual(h.calls,['next']);
});
test('a new outside contact cancels pending mini-player track settling without losing normal navigation',()=>{
 const h=mini();h.context.SET.animations='normal';const n=h.nodes.get('#mini'),outside=node();n.contains=target=>target===n;
 swipe(h,n,-120);assert.ok(h.context.lifecycle.motionSettle);h.doc.fire('pointerdown',{target:outside,pointerId:8});h.advance(600);assert.deepEqual(h.calls,[]);assert.equal(n.children[0].style.transform,'');
 h.doc.fire('pointerup',{pointerId:8});n.fire('pointerdown');h.advance(340);n.fire('pointerup');assert.deepEqual(h.calls,[['nav','player']]);
});
test('stationary mini-player releases have no gap between tap and long-press duration',()=>{
 for(const ms of [280,340,480,700]){const h=mini(),n=h.nodes.get('#mini');n.fire('pointerdown');h.advance(ms);n.fire('pointerup');assert.deepEqual(h.calls,[['nav','player']],String(ms));}
});
test('mini seek and play children cancel pending mini swipes before excluded controls take ownership',()=>{
 for(const selector of ['#mini-play','.mini-seek']){const h=mini();h.context.SET.animations='normal';const n=h.nodes.get('#mini'),control=node();control.closest=s=>s==='#mini-play,.mini-seek'?control:null;
   swipe(h,n,-120);h.doc.fire('pointerdown',{target:control,pointerId:8});h.advance(600);assert.deepEqual(h.calls,[],selector);assert.equal(h.context.lifecycle.motionSettle,null);
 }
});
test('artwork menu-button contact cancels pending art swipe instead of allowing an old skip',()=>{
 const h=art();h.context.SET.animations='normal';const stage=h.nodes.get('#artstage'),button=node();button.closest=s=>s==='button'?button:null;
 swipe(h,stage,-120);h.doc.fire('pointerdown',{target:button,pointerId:8});h.advance(600);assert.deepEqual(h.calls,[]);assert.equal(h.context.lifecycle.motionSettle,null);
});
