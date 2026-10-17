import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const SharedPlayerMotion='),source.indexOf('const ScreenDrag='));
const shorthand={margin:['margin-top','margin-right','margin-bottom','margin-left'],mask:['mask-image','mask-size','mask-position'],font:['font-family','font-size','font-weight','line-height']};
function declaration(entries={}){
  const values=new Map(Object.entries(entries));
  return new Proxy({getPropertyValue:key=>values.get(key)||'',getPropertyPriority:()=>'',setProperty(key,value){for(const property of shorthand[key]||[key])values.set(property,value);}},{
    get(target,key){if(key==='length')return values.size;if(key==='cssText')return [...values].map(([k,v])=>k+':'+v).join(';');if(/^\d+$/.test(String(key)))return [...values.keys()][+key];return target[key];},
    set(target,key,value){if(key==='cssText'){values.clear();for(const pair of value.split(';')){const at=pair.indexOf(':');if(at>0)values.set(pair.slice(0,at),pair.slice(at+1));}}else target[key]=value;return true;}
  });
}
function harness(){
  const sheet={cssRules:[{selectorText:'.parent',style:declaration({font:'inherit',color:'red'})},{selectorText:'#source',style:declaration({margin:'0',mask:'var(--icon)'})},{selectorText:'#source::after',style:declaration({content:'""','box-shadow':'0 0 1px black'})},{selectorText:'.unrelated',style:declaration({'backdrop-filter':'blur(1px)'})}]};
  const document={styleSheets:[sheet],createElement:()=>({style:declaration()})};
  const context=vm.createContext({document});vm.runInContext(code+'\nglobalThis.motion=SharedPlayerMotion;',context);
  const values={'font-family':'Test Font','font-size':'19px','font-weight':'750','line-height':'23px',color:'rgb(1, 2, 3)','margin-top':'1px','margin-right':'2px','margin-bottom':'3px','margin-left':'4px','mask-image':'url(data:image/png;base64,ICON)','mask-size':'contain','mask-position':'50% 50%',content:'none','letter-spacing':'0px','filter':'none','outline-color':'rgb(1, 2, 3)','backdrop-filter':'none','box-shadow':'0 0 1px rgb(0, 0, 0)','pointer-events':'auto','animation-duration':'1s','transition-property':'all','--icon':'url(data:image/png;base64,ICON)'};
  for(let i=0;i<400;i++)values['unused-browser-'+i]='initial';
  const style=declaration(values),parent={style:declaration(),parentElement:null,matches:s=>s==='.parent'},node={style:declaration({'letter-spacing':'2px','--icon':values['--icon']}),parentElement:parent,matches:s=>s==='#source'};
  return {motion:context.motion,document,sheet,node,style};
}

test('compact snapshot derives used properties and shorthand longhands without a paint whitelist',()=>{
  const h=harness(),plan=h.motion.snapshotPlan(h.style),keys=h.motion.snapshotKeys(h.node,plan),css=h.motion.snapshotCSS(h.style,keys);
  for(const key of ['font-family','font-size','font-weight','line-height','color','margin-top','margin-right','margin-bottom','margin-left','mask-image','mask-size','mask-position','box-shadow','content','letter-spacing'])assert.ok(keys.includes(key),key);
  assert.equal(keys.includes('backdrop-filter'),false,'unmatched rules do not enlarge every snapshot');
  assert.equal(keys.some(key=>key.startsWith('unused-browser-')),false);
  assert.equal(keys.includes('--icon'),false,'resolved mask keeps the URL without a second custom-variable copy');
  assert.equal((css.match(/data:image\/png/g)||[]).length,1);
  assert.ok(css.length<h.motion.snapshotCSS(h.style,null).length/5,'large browser-default lists are not serialized');
});

test('new scenes rebuild their plan after inline and CSSOM changes',()=>{
  const h=harness(),first=h.motion.snapshotPlan(h.style);assert.equal(h.motion.snapshotKeys(h.node,first).includes('backdrop-filter'),false);
  h.sheet.cssRules.push({selectorText:'#source',style:declaration({'backdrop-filter':'blur(2px)'})});h.node.style.setProperty('filter','blur(1px)');
  const next=h.motion.snapshotPlan(h.style),keys=h.motion.snapshotKeys(h.node,next);assert.ok(keys.includes('backdrop-filter'));assert.ok(keys.includes('filter'));assert.notEqual(next,first);
});

test('unreadable or absent stylesheets retain the exhaustive snapshot path',()=>{
  const h=harness(),diagnostics={};h.document.styleSheets=[{get cssRules(){throw new Error('SecurityError');}}];assert.equal(h.motion.snapshotPlan(h.style,diagnostics),null);assert.equal(diagnostics.fallback.reason,'stylesheet-rules');assert.equal(diagnostics.fallback.message,'SecurityError');
  assert.equal(h.motion.snapshotKeys(h.node,null),null);assert.ok(h.motion.snapshotCSS(h.style,null).includes('unused-browser-399:initial;'));
  h.document.styleSheets=[];assert.equal(h.motion.snapshotPlan(h.style),null);
});

test('a readable selector rejected by matches contributes only its authored keys globally',()=>{
  const h=harness(),diagnostics={},plan=h.motion.snapshotPlan(h.style,diagnostics),matches=h.node.matches;
  h.node.matches=selector=>{if(selector==='.unrelated')throw new SyntaxError('Unsupported selector');return matches(selector);};
  const keys=h.motion.snapshotKeys(h.node,plan);assert.ok(keys.includes('backdrop-filter'));assert.equal(keys.some(key=>key.startsWith('unused-browser-')),false);assert.equal(diagnostics.selectorFallbacks[0].selector,'.unrelated');
});


test('live class pseudos and important rules retain only referenced local variables',()=>{
  const h=harness(),important=declaration({'mask-image':'var(--local-mask)','color':'var(--local-color)','width':'var(--missing, 4px)'});
  important.getPropertyPriority=()=> 'important';
  h.sheet.cssRules.push({selectorText:'#source::before',style:declaration({content:'""',background:'var(--local-pseudo)'})},{selectorText:'#source',style:important});
  h.node.style.setProperty('--local-mask','url(local-mask)');h.node.style.setProperty('--local-color','cyan');h.node.style.setProperty('--local-pseudo','gold');h.node.style.setProperty('--unused-schema','unused');
  for(const [key,value] of [['--local-mask','url(local-mask)'],['--local-color','cyan'],['--local-pseudo','gold']])h.style.setProperty(key,value);
  const keys=h.motion.snapshotKeys(h.node,h.motion.snapshotPlan(h.style)),css=h.motion.snapshotCSS(h.style,keys);
  for(const key of ['--local-mask','--local-color','--local-pseudo'])assert.ok(keys.includes(key),key);
  assert.equal(keys.includes('--unused-schema'),false);assert.equal(keys.includes('--icon'),false);
  assert.ok(css.includes('--local-mask:url(local-mask);'));assert.equal(css.includes('--missing:'),false,'an absent variable keeps the CSS fallback');
});

const cssList=items=>Object.assign(Object.create(null),{length:items.length,item:index=>items[index]||null},Object.fromEntries(items.map((item,index)=>[index,item])));
test('stylesheet and nested CSS rule lists need only indexed CSSOM access, not array iterators',()=>{
  const h=harness();h.sheet.cssRules=cssList([{cssRules:cssList(h.sheet.cssRules)}]);h.document.styleSheets=cssList([h.sheet]);h.document.adoptedStyleSheets=cssList([]);
  const plan=h.motion.snapshotPlan(h.style);assert.ok(plan,'non-iterable CSSOM lists must not disable compact capture');
  const keys=h.motion.snapshotKeys(h.node,plan);assert.ok(keys.includes('mask-image'));assert.equal(keys.some(key=>key.startsWith('unused-browser-')),false);
});

test('partial axis and vendor aliases discover their aggregate computed property',()=>{
  const h=harness();h.style.cssText+=';background-position:50% 50%';
  const makeProbe=()=>{
    const values=new Map();
    return new Proxy({setProperty(key,value){if(key==='background-position'){values.set('background-position-x',value);values.set('background-position-y',value);}else values.set(key,value);},getPropertyValue(key){if(key==='background-position'){const x=values.get('background-position-x'),y=values.get('background-position-y');return x&&x===y?x:'';}return values.get(key)||'';}},{get(target,key){if(key==='length')return values.size;if(/^\d+$/.test(String(key)))return [...values.keys()][+key];return target[key];},set(target,key,value){if(key==='cssText')values.clear();else target[key]=value;return true;}});
  };
  h.document.createElement=()=>({style:makeProbe()});
  h.sheet.cssRules.push({selectorText:'#source',style:declaration({'background-position-x':'center','background-position-y':'center'})});
  const plan=h.motion.snapshotPlan(h.style),keys=h.motion.snapshotKeys(h.node,plan);
  assert.ok(keys.includes('background-position'),'a partial longhand must not disappear when the aggregate serializes as empty');
  assert.ok(h.motion.snapshotCSS(h.style,keys).includes('background-position:50% 50%;'));
});

test('pending-substitution shorthand CSSOM keeps variables for live pseudo and important paint',()=>{
  const h=harness(),pending=(entries,cssText,important=false)=>{
    const style=declaration(entries);style.getPropertyPriority=()=>important?'important':'';
    return new Proxy(style,{get(target,key){return key==='cssText'?cssText:target[key];}});
  };
  h.sheet.cssRules.push(
    {selectorText:'#source',style:pending({'mask-image':'','mask-position':'','mask-size':''},'mask:var(--local-mask) center / contain no-repeat !important;',true)},
    {selectorText:'#source::before',style:pending({'background-color':'',content:'""'},'background:var(--local-pseudo);content:"";')}
  );
  h.style.setProperty('--local-mask','url(local-mask)');h.style.setProperty('--local-pseudo','rgb(50, 60, 70)');h.style.setProperty('--unused-schema','unused');
  const keys=h.motion.snapshotKeys(h.node,h.motion.snapshotPlan(h.style)),css=h.motion.snapshotCSS(h.style,keys);
  assert.ok(keys.includes('--local-mask'),'important shorthand consumes the retained local mask');
  assert.ok(keys.includes('--local-pseudo'),'live pseudo shorthand consumes the retained local background');
  assert.ok(css.includes('--local-mask:url(local-mask);'));assert.ok(css.includes('--local-pseudo:rgb(50, 60, 70);'));
  assert.equal(keys.includes('--unused-schema'),false);
});

test('compact freezing includes browser scene context, resolved origins, and currentColor consumers',()=>{
  const h=harness(),values={'app-region':'no-drag',visibility:'visible',interactivity:'auto','transform-origin':'251.516px 545.266px','perspective-origin':'251.516px 545.266px','caret-color':'rgb(1, 2, 3)','text-decoration-color':'rgb(1, 2, 3)','-webkit-text-fill-color':'rgb(1, 2, 3)','future-current-color':'rgb(1, 2, 3)'};
  for(const [key,value] of Object.entries(values))h.style.setProperty(key,value);
  const plan=h.motion.snapshotPlan(h.style),keys=h.motion.snapshotKeys(h.node,plan),css=h.motion.snapshotCSS(h.style,keys);
  for(const [key,value] of Object.entries(values)){assert.ok(keys.includes(key),key);assert.ok(css.includes(key+':'+value+';'),key+' is resolved before reparenting');}
  assert.equal(keys.some(key=>key.startsWith('unused-browser-')),false,'context closure does not serialize browser defaults wholesale');
  assert.deepEqual(Array.from(keys).filter(key=>!key.startsWith('--')),Array.from(keys).filter(key=>!key.startsWith('--')).sort((a,b)=>plan.order.get(a)-plan.order.get(b)),'overlapping standard aliases retain exhaustive inventory order');
});

test('exact duplicate selectors merge and unmatched property vocabularies stay lazy per scene',()=>{
  const h=harness();h.sheet.cssRules.push({selectorText:'#source',style:declaration({filter:'blur(2px)'})});
  const diagnostics={},plan=h.motion.snapshotPlan(h.style,diagnostics),expand=plan.expand,calls=[];plan.expand=key=>{calls.push(key);return expand(key);};
  let matches=0;const original=h.node.matches;h.node.matches=selector=>{if(selector==='#source')matches++;return original(selector);};
  const keys=h.motion.snapshotKeys(h.node,plan);
  assert.equal(matches,1,'one matches call covers exactly equal source selectors');assert.equal(diagnostics.selectorGroups,diagnostics.rules-2);
  assert.ok(keys.includes('mask-image'));assert.ok(keys.includes('filter'));assert.equal(calls.includes('backdrop-filter'),false,'unrelated rules are never expanded');
  const reads=calls.length;h.motion.snapshotKeys(h.node,plan);assert.equal(calls.length,reads,'scene-local source cache reuses completed keys');
});

test('single specified color longhand still changes a computed aggregate',()=>{
  const h=harness();h.style.setProperty('text-decoration-color','rgb(1, 2, 3)');h.style.setProperty('text-decoration','none solid rgb(1, 2, 3)');
  const parts=['text-decoration-line','text-decoration-style','text-decoration-color','text-decoration-thickness'];
  const make=()=>{const values=new Map();return new Proxy({setProperty(key,value){for(const field of key==='text-decoration'?parts:[key])values.set(field,value);},getPropertyValue(key){if(key==='text-decoration'){const first=values.get(parts[0]);return first&&parts.every(field=>values.get(field)===first)?first:'';}return values.get(key)||'';}},{get(target,key){if(key==='length')return values.size;if(/^\d+$/.test(String(key)))return [...values.keys()][+key];return target[key];},set(target,key,value){if(key==='cssText'){values.clear();for(const pair of value.split(';')){const at=pair.indexOf(':');if(at>0)target.setProperty(pair.slice(0,at),pair.slice(at+1));}}else target[key]=value;return true;}});};
  h.document.createElement=()=>({style:make()});
  const plan=h.motion.snapshotPlan(h.style),keys=plan.expand('text-decoration-color');
  assert.ok(keys.includes('text-decoration-color'));assert.ok(keys.includes('text-decoration'),'single canonical specified name does not exclude computed aggregate dependencies');
});

test('canonical dependency slots avoid a used-name by full-inventory getter scan',()=>{
  const h=harness(),create=h.document.createElement;let reads=0,writes=0;
  h.document.createElement=()=>{const element=create(),get=element.style.getPropertyValue,set=element.style.setProperty;element.style.getPropertyValue=key=>{reads++;return get(key);};element.style.setProperty=(key,value)=>{writes++;set(key,value);};return element;};
  const entries={};for(let i=0;i<75;i++)entries['unused-browser-'+i]='initial';h.sheet.cssRules.push({selectorText:'#source',style:declaration(entries)});
  const keys=h.motion.snapshotKeys(h.node,h.motion.snapshotPlan(h.style));
  for(let i=0;i<75;i++)assert.ok(keys.includes('unused-browser-'+i));
  assert.equal(reads,0,'dependencies use canonical indexed slots, not repeated specified-value getter scans');
  assert.ok(writes<2*h.style.length,'each inventory and distinct used name is processed once per scene');
});
