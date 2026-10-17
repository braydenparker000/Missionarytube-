import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const start=source.indexOf('const SharedPlayerMotion=');
const end=source.indexOf('const ScreenDrag=',start);
function motionHarness({reference=false,...extra}={}){
  assert.ok(start>=0&&end>start,'The shared-player motion implementation is present');
  const context=vm.createContext({clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),...extra});
  vm.runInContext(source.slice(start,end)+'\nglobalThis.motion='+(reference?'SnapshotReferenceMotion':'SharedPlayerMotion')+';',context);
  return {context,motion:context.motion};
}
const rect=(left,top,width,height)=>({left,top,width,height});
const endpoints={
  surface:{mini:rect(9,703,375,75),full:rect(0,0,393,852)},
  art:{mini:rect(25,712,36,36),full:rect(14,13,365,365)},
  title:{mini:rect(74,714,225,16.2),full:rect(14,398,250,28.8)},
  sub:{mini:rect(74,732.2,225,13.8),full:rect(14,428.8,295,24)},
  play:{mini:rect(332,712,36,36),full:rect(150,526,93,93)},
  seek:{mini:rect(25,761,343,12),full:rect(17,725,359,26)}
};
const coords=['left','top','width','height'];
function expectRect(actual,a,b,p,label){
  for(const key of coords){
    const expected=a[key]+(b[key]-a[key])*p;
    assert.ok(Number.isFinite(actual[key]),`${label}.${key} is finite`);
    assert.ok(Math.abs(actual[key]-expected)<1e-9,`${label}.${key}: ${actual[key]}, expected ${expected}`);
  }
}

test('shared-player rectangles follow the complete mini-to-full path at every acceptance checkpoint',()=>{
  const {motion}=motionHarness();
  for(const p of [0,.25,.5,.75,1]){
    const painted=motion.sceneGeometry(endpoints,p);
    for(const [name,pair] of Object.entries(endpoints))expectRect(painted[name],pair.mini,pair.full,p,`${name}@${p}`);
  }
});

test('opening and closing share one reversible geometry rather than a second screen path',()=>{
  const {motion}=motionHarness();
  const opened=[0,.25,.5,.75,1].map(p=>motion.sceneGeometry(endpoints,p));
  const closed=[1,.75,.5,.25,0].map(p=>motion.sceneGeometry(endpoints,p));
  assert.deepEqual(JSON.parse(JSON.stringify(closed)),JSON.parse(JSON.stringify(opened.reverse())));
});

test('the expanded shell keeps the art, labels, and control inside the same evolving player surface',()=>{
  const {motion}=motionHarness();
  for(const p of [0,.25,.5,.75,1]){
    const g=motion.sceneGeometry(endpoints,p),s=g.surface;
    for(const name of ['art','title','sub','play','seek']){
      const n=g[name];
      assert.ok(n.left>=s.left&&n.top>=s.top,`${name}@${p} starts inside shell`);
      assert.ok(n.left+n.width<=s.left+s.width+1e-9&&n.top+n.height<=s.top+s.height+1e-9,`${name}@${p} ends inside shell`);
    }
  }
});

test('morph geometry uses captured bounds instead of a hard-coded phone width',()=>{
  const {motion}=motionHarness();
  for(const [width,height,safeTop,safeBottom] of [[360,780,24,20],[430,932,47,34],[852,393,0,0]]){
    const mini=rect(11,height-safeBottom-160,width-22,82),full=rect(0,safeTop,width,height-safeTop-safeBottom);
    for(const p of [0,.25,.5,.75,1])expectRect(motion.mixRect(mini,full,p),mini,full,p,`${width}x${height}@${p}`);
  }
});

test('captured element rectangles retain the currently displayed coordinates',()=>{
  const {motion}=motionHarness();
  const painted=rect(31.25,241.875,178.5,178.5);
  expectRect(motion.rect({getBoundingClientRect:()=>({...painted,right:209.75,bottom:420.375})}),painted,painted,0,'painted capture');
});

function clockHarness(){
  let now=1000,id=0;const frames=new Map(),timers=new Map();
  const h=motionHarness({performance:{now:()=>now},
    requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);},
    setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout(key){timers.delete(key);}});
  return {...h,frames,timers,
    frame(ms){now+=ms;const pending=[...frames];frames.clear();for(const [,fn] of pending)fn(now);},
    advance(ms){now+=ms;for(const [key,t] of [...timers])if(t.at<=now){timers.delete(key);t.fn();}}};
}

test('pausing shared settling retains the last actually painted rectangle until a regrab resumes it',()=>{
  const h=clockHarness(),m={p:.25};let completions=0;
  h.motion.paint=function(m,p){m.p=p;m.geometry=this.sceneGeometry(endpoints,p);};
  h.motion.paint(m,m.p);
  const finish=h.motion.settle(m,1,200,()=>completions++);h.frame(50);
  const held=m.p,rects=JSON.parse(JSON.stringify(m.geometry));
  assert.ok(held>.25&&held<1);finish.cancel();h.frame(1000);h.advance(1000);
  assert.equal(m.p,held);assert.deepEqual(JSON.parse(JSON.stringify(m.geometry)),rects);
  assert.equal(completions,0,'an interrupted owner cannot complete later');assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  const reverse=h.motion.settle(m,0,200,()=>completions++);
  assert.equal(m.p,held,'new settling starts at the displayed position');h.frame(50);assert.ok(m.p<held&&m.p>0);
  h.frame(150);assert.equal(m.p,0);assert.equal(reverse.pending,false);assert.equal(completions,1);
  expectRect(m.geometry.art,endpoints.art.mini,endpoints.art.full,0,'reversed art endpoint');
});

test('zero-duration shared settling reaches the exact endpoint without retaining a dead owner',()=>{
  const h=clockHarness(),m={p:.6};let completions=0;
  h.motion.paint=function(m,p){m.p=p;m.geometry=this.sceneGeometry(endpoints,p);};
  const finish=h.motion.settle(m,1,0,()=>completions++);
  assert.equal(m.p,1);assert.equal(completions,1);assert.equal(finish.pending,false);
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  expectRect(m.geometry.art,endpoints.art.mini,endpoints.art.full,1,'instant full art endpoint');
});

test('a stale shared-settle completion cannot snap a newer retargeted owner to its previous endpoint',()=>{
  const h=clockHarness(),m={p:.2};const completions=[];
  h.motion.paint=function(m,p){m.p=p;m.geometry=this.sceneGeometry(endpoints,p);};
  const old=h.motion.settle(m,1,220,()=>completions.push('old'));h.frame(40);old.cancel();
  h.motion.settle(m,0,120,()=>completions.push('new'));h.frame(120);h.advance(1000);
  assert.equal(m.p,0);assert.deepEqual(completions,['new']);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
});

function fakeNode(){
  const values=new Map(),priorities=new Map(),attrs=new Map();
  const property=key=>String(key).replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
  const methods={setProperty(key,value,priority=''){values.set(key,String(value));priorities.set(key,priority);},
    getPropertyValue:key=>values.get(key)||'',getPropertyPriority:key=>priorities.get(key)||'',
    removeProperty(key){values.delete(key);priorities.delete(key);}};
  const style=new Proxy(methods,{get(object,key){return key in object?object[key]:values.get(property(key))||'';},
    set(object,key,value){values.set(property(key),String(value));priorities.set(property(key),'');return true;}});
  return {style,hidden:false,inert:false,dataset:{},setAttribute:(key,value)=>attrs.set(key,String(value)),getAttribute:key=>attrs.get(key)??null,removeAttribute(key){attrs.delete(key);if(key==='style'){values.clear();priorities.clear();}},querySelector(){return null;},remove(){this.removed=true;}};
}
function paintedRect(node){
  const r=rect(parseFloat(node.style.left),parseFloat(node.style.top),parseFloat(node.style.width),parseFloat(node.style.height));
  const transform=/translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+),([-\d.]+)\)/.exec(node.style.transform||'');
  if(transform){r.left+=+transform[1];r.top+=+transform[2];r.width*=+transform[3];r.height*=+transform[4];}
  return r;
}
function paintedMorph(){
  const pairNodes={};for(const key of ['title','sub','play','seek'])pairNodes[key]={mini:fakeNode(),full:fakeNode()};
  const background=fakeNode(),fullClone=fakeNode();
  return {p:0,endpoints,mini:fakeNode(),full:fakeNode(),surface:fakeNode(),background,fullClone,art:fakeNode(),
    backgroundReveal:{mask:fakeNode(),node:background,bounds:endpoints.surface.full},fullReveal:{mask:fakeNode(),node:fullClone,bounds:endpoints.surface.full},
    artNodes:{mini:fakeNode(),full:fakeNode()},pairs:pairNodes,dim:fakeNode(),nav:fakeNode(),
    miniRadius:[29,29,0,0],artRadius:{mini:[12,12,12,12],full:[60,60,60,60]},navRadius:{mini:[0,0,29,29],full:[29,29,29,29]}};
}

test('snapshot reference: runtime paint applies shared geometry and suppresses every canonical duplicate at each checkpoint',()=>{
  const {motion}=motionHarness({reference:true,SET:{listBg:true}}),m=paintedMorph();
  for(const p of [0,.25,.5,.75,1]){
    motion.paint(m,p);
    expectRect(paintedRect(m.surface),endpoints.surface.mini,endpoints.surface.full,p,`painted shell@${p}`);
    expectRect(paintedRect(m.art),endpoints.art.mini,endpoints.art.full,p,`painted art@${p}`);
    for(const [key,nodes] of Object.entries(m.pairs))for(const end of ['mini','full'])expectRect(paintedRect(nodes[end]),endpoints[key].mini,endpoints[key].full,p,`painted ${key}.${end}@${p}`);
    assert.equal(m.mini.style.opacity,'0');assert.equal(m.full.style.opacity,'0');
    assert.equal(m.artNodes.mini.style.opacity,String(1-p));assert.equal(m.artNodes.full.style.opacity,String(p));
    assert.equal(m.fullClone.style.opacity,String(p));assert.equal(m.background.style.opacity,String(p));
  }
});

test('snapshot reference: invisible canonical controls remain inert and excluded from accessibility while the morph owns display',()=>{
  const {motion}=motionHarness({reference:true,SET:{listBg:true}}),m=paintedMorph();
  motion.paint(m,.5);
  for(const node of [m.mini,m.full]){
    assert.equal(node.inert,true,'canonical controls cannot receive keyboard focus behind the shared paint');
    assert.equal(node.getAttribute('aria-hidden'),'true','only the transient painted player owns the scene');
  }
});

test('snapshot reference: cleanup retires transient layers and restores preserved inline styles and mini ownership',()=>{
  const {motion}=motionHarness({reference:true,Nav:{cur:'list'},Engine:{current:{id:'fixture'}},SET:{listBg:true}}),m=paintedMorph();
  m.layer=fakeNode();m.input=fakeNode();m.original={miniInert:false,miniAria:null};
  m.mini.style.setProperty('opacity','.85','important');m.dim.style.setProperty('opacity','.2');
  m.styles=[motion.styleSnapshot(m.mini,['opacity','transform']),motion.styleSnapshot(m.dim,['opacity'])];
  m.mini.dataset.sharedPlayer=m.full.dataset.sharedPlayer='1';let disposed=0,disconnected=0;
  m.disposeInput=()=>disposed++;m.observer={disconnect:()=>disconnected++};motion.paint(m,.4);motion.clean(m);
  assert.equal(m.layer.removed,true);assert.equal(m.input.removed,true);assert.equal(disposed,1);assert.equal(disconnected,1);
  assert.equal(m.mini.style.getPropertyValue('opacity'),'.85');assert.equal(m.mini.style.getPropertyPriority('opacity'),'important');
  assert.equal(m.dim.style.getPropertyValue('opacity'),'.2');assert.equal(m.mini.style.getPropertyValue('transform'),'');
  assert.equal(m.mini.dataset.sharedPlayer,undefined);assert.equal(m.full.dataset.sharedPlayer,undefined);
  assert.equal(m.mini.hidden,false);assert.equal(m.mini.inert,false);assert.equal(m.mini.getAttribute('aria-hidden'),null);
});


// The production transaction borrows the actual mini widgets and the mounted
// full screen. Snapshot-shaped fixtures above deliberately exercise only the
// retained visual-baseline implementation.
function persistentMorph(){
  const pairNodes={};for(const key of ['art','title','sub','play','seek']){pairNodes[key]={mini:fakeNode(),full:fakeNode()};const box=endpoints[key].mini;Object.assign(pairNodes[key].mini.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});}
  for(const key of ['title','sub'])pairNodes[key].mini.firstElementChild=fakeNode();
  const appearance={fontFamily:'Fixture Sans',fontSize:16,fontWeight:700,lineHeight:19.2,color:'white',background:'transparent',borderColor:'#666',borderWidth:0,padding:{left:0,top:0},radius:[0,0,0,0]};
  const appearances={};for(const key of ['title','sub','play'])appearances[key]={mini:{...appearance},full:{...appearance,fontSize:28,lineHeight:33.6}};
  return {p:0,endpoints,pairs:pairNodes,appearances,mini:fakeNode(),full:fakeNode(),A:fakeNode(),B:fakeNode(),mask:fakeNode(),content:fakeNode(),backgroundMask:fakeNode(),backgroundContent:fakeNode(),background:fakeNode(),input:fakeNode(),dim:fakeNode(),nav:fakeNode(),styles:[],original:{},retired:false,
    miniRadius:[29,29,0,0],artRadius:{mini:[12,12,12,12],full:[60,60,60,60]},navRadius:{mini:[0,0,29,29],full:[29,29,29,29]},artMiniSize:'cover',artFullSize:'contain',nativeSeekVisible:true};
}
function persistentHarness(m){
  return motionHarness({SET:{listBg:true},Nav:{cur:'list'},Engine:{current:{id:'fixture'}},DockLayout:{schedule(){}},$:selector=>selector==='#artA'?m.A:null});
}
function transformedBox(node,base){
  const match=/translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+),([-\d.e+]+)\)/.exec(node.style.transform||'');assert.ok(match,node.style.transform);
  return rect(base.left+ +match[1],base.top+ +match[2],base.width* +match[3],base.height* +match[4]);
}

test('persistent paint has one actual widget owner and exact geometry at every checkpoint',()=>{
  const m=persistentMorph(),{motion}=persistentHarness(m),owners=Object.fromEntries(Object.entries(m.pairs).map(([key,pair])=>[key,pair.mini]));
  for(const p of [0,.001,.25,.5,.75,.8,.9,.999,1,.5,0]){
    motion.paint(m,p);
    for(const mask of [m.mask,m.backgroundMask])expectRect(transformedBox(mask,endpoints.surface.mini),endpoints.surface.mini,endpoints.surface.full,p,`persistent shell@${p}`);
    for(const [key,pair] of Object.entries(m.pairs)){assert.equal(pair.mini,owners[key]);expectRect(paintedRect(pair.mini),endpoints[key].mini,endpoints[key].full,p,`actual ${key}@${p}`);assert.equal(pair.mini.style.opacity,'1');if(key!=='art')assert.equal(pair.full.style.opacity,'0');}
    assert.equal(m.A.style.opacity,'0');assert.equal(m.B.style.opacity,'0');assert.equal(m.mini.style.opacity,'1');assert.equal(m.background.style.opacity,String(p));
    assert.ok(Math.abs(Number(m.full.style.opacity)-Math.max(0,Math.min(1,(p-.8)/.2)))<1e-9,'full-only controls reveal late without exposing shared duplicates');
  }
});

test('persistent canonical controls stay inert and inaccessible while the shared owner paints',()=>{
  const m=persistentMorph(),{motion}=persistentHarness(m);motion.paint(m,.5);
  for(const node of [m.mini,m.full]){assert.equal(node.inert,true);assert.equal(node.getAttribute('aria-hidden'),'true');}
  for(const pair of Object.values(m.pairs))assert.equal(pair.mini.removed,undefined,'actual widgets remain mounted');
});

test('persistent cleanup is idempotent and resets presentation without removing live nodes',()=>{
  const m=persistentMorph(),{motion}=persistentHarness(m);let releases=0;
  m.releaseInput=()=>releases++;m.mini.style.setProperty('width','375px','important');m.dim.style.setProperty('opacity','.2');m.styles=[motion.styleSnapshot(m.mini,['width']),motion.styleSnapshot(m.dim,['opacity'])];
  m.mini.dataset.sharedPlayer=m.full.dataset.sharedPlayer='1';m.mask.dataset.active=m.backgroundMask.dataset.active='1';
  motion.paint(m,.4);motion.clean(m);motion.clean(m);
  assert.equal(m.retired,true);assert.equal(releases,1);assert.equal(m.input.hidden,true);assert.equal(m.backgroundMask.hidden,true);assert.equal(m.mask.dataset.active,undefined);assert.equal(m.backgroundMask.dataset.active,undefined);
  for(const node of [m.mask,m.content,m.backgroundMask,m.backgroundContent,m.background,m.input,m.mini,m.full,...Object.values(m.pairs).flatMap(pair=>[pair.mini,pair.full])])assert.equal(node.removed,undefined);
  assert.equal(m.mask.style.transform,'');assert.equal(m.content.style.transform,'');assert.equal(m.mini.style.width,'375px');assert.equal(m.mini.style.getPropertyPriority('width'),'important');assert.equal(m.dim.style.opacity,'.2');
  assert.equal(m.mini.style.opacity,'');assert.equal(m.full.style.opacity,'');assert.equal(m.mini.dataset.sharedPlayer,undefined);assert.equal(m.full.dataset.sharedPlayer,undefined);
  assert.equal(m.mini.hidden,false);assert.equal(m.mini.inert,false);assert.equal(m.mini.getAttribute('aria-hidden'),'false');assert.equal(m.full.hidden,true);assert.equal(m.full.inert,true);assert.equal(m.full.getAttribute('aria-hidden'),'true');
  const transform=m.pairs.art.mini.style.transform;motion.paint(m,1);assert.equal(m.pairs.art.mini.style.transform,transform,'a retired owner cannot repaint live widgets');
});
