import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const html=readFileSync(process.env.POWERAMP_HTML_FILE||(process.env.POWERAMP_PLAYER_FILE?process.env.POWERAMP_PLAYER_FILE.replace(/player\.js$/,'index.html'):new URL('../public/drawercast/index.html',import.meta.url)),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const plain=value=>JSON.parse(JSON.stringify(value));
// Parsed DOM contract fixture, deliberately not a browser/layout/touch test.
class Element {
  constructor(tag='div'){
    this.tagName=tag.toUpperCase();this.attrs=new Map();this.dataset={};this.children=[];this.parentNode=null;this._text='';this._html='';this.events=new Map();this.hidden=false;this.scrollLeft=0;this.capture=new Set();
    this.style={setProperty:(key,value)=>this.style[key]=String(value)};
    const names=new Set();this.names=names;this.classList={add:(...values)=>values.forEach(v=>names.add(v)),remove:(...values)=>values.forEach(v=>names.delete(v)),contains:v=>names.has(v),toggle:(v,on)=>{if(on??!names.has(v))names.add(v);else names.delete(v);}};
  }
  setAttribute(key,value){this.attrs.set(key,String(value));if(key==='class'){this.names.clear();String(value).split(/\s+/).filter(Boolean).forEach(v=>this.names.add(v));}if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase())]=String(value);}
  getAttribute(key){return key==='class'?[...this.names].join(' '):this.attrs.get(key)??null;}
  get id(){return this.getAttribute('id')||'';}set id(v){this.setAttribute('id',v);}
  get disabled(){return this.attrs.has('disabled');}set disabled(v){v?this.attrs.set('disabled',''):this.attrs.delete('disabled');}
  get value(){return this._value??this.getAttribute('value')??this.children.find(n=>n.tagName==='OPTION'&&n.attrs.has('selected'))?.value??this.children[0]?.value??'';}set value(v){this._value=String(v);}
  appendChild(n){n.parentNode=this;this.children.push(n);return n;}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set textContent(v){this._text=String(v);this.children=[];}
  get innerHTML(){return this._html;}set innerHTML(v){this._html=String(v);this.children=[];this._text='';this.parse(String(v));}
  parse(html){const stack=[this];for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();}else if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const n=new Element(tag);const rest=token.slice(tag.length+1);for(const m of rest.matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g))n.setAttribute(m[1],m[2]??m[3]??'');stack.at(-1).appendChild(n);if(!['input','img','br','hr','meta','link'].includes(tag)&&!token.endsWith('/>'))stack.push(n);}else stack.at(-1)._text+=token.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');}}
  insertAdjacentHTML(where,value){assert.equal(where,'beforeend');this.parse(value);}
  matches(selector){return selector.split(',').some(s=>{s=s.trim();const id=s.match(/^#([\w-]+)/),cls=s.match(/^\.([\w-]+)/),tag=s.match(/^([\w-]+)/);if(id&&this.id!==id[1]||cls&&!this.names.has(cls[1])||tag&&this.tagName!==tag[1].toUpperCase())return false;for(const m of s.matchAll(/\[([^=\]]+)(?:="([^\"]*)")?\]/g))if(!this.attrs.has(m[1])||m[2]!=null&&this.getAttribute(m[1])!==m[2])return false;return !!(id||cls||tag||s.startsWith('['));});}
  querySelectorAll(selector){const pieces=selector.trim().split(/\s+/),last=pieces.pop(),out=[];const visit=n=>{for(const c of n.children){if(c.matches(last)){let p=c.parentNode,index=pieces.length-1;while(p&&index>=0){if(p.matches(pieces[index]))index--;p=p.parentNode;}if(index<0)out.push(c);}visit(c);}};visit(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(node){return node===this||this.children.some(n=>n.contains(node));}
  focus(){let root=this;while(root.parentNode)root=root.parentNode;root.activeElement=this;}
  getBoundingClientRect(){return {height:this.names.has('thumb')?64:this.names.has('vslide')?284:70,width:70,top:0,left:0};}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn);}
  setPointerCapture(id){this.capture.add(id);}hasPointerCapture(id){return this.capture.has(id);}releasePointerCapture(id){this.capture.delete(id);}
  fire(type,extra={}){const e={type,key:'',pointerId:1,clientX:100,clientY:100,button:0,isPrimary:true,preventDefault(){this.prevented=true;},...extra};for(const fn of this.events.get(type)||[])fn(e);this['on'+type]?.(e);return e;}
}
function harness(overrides={}){
  const document=new Element('document'),calls=[],resets=[];
  document.innerHTML=html.slice(html.indexOf('  <section id="sc-eq"'),html.indexOf('  <!-- ============ SEARCH'))+'<div id="sheet"></div>';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>r.querySelectorAll(s);
  for(const id of ['fx-panel','volume-panel']){const n=new Element();n.id=id;$('#sc-eq .scroll').appendChild(n);}
  const defaults={eqMode:'graphic',eqFreqs:[31,62,125,250,500,1000,2000,4000,8000,16000],eqGains:Array(10).fill(0),eqQ:Array(10).fill(1.4142),eqTypes:Array(10).fill('peaking'),preamp:0,preset:'Manual',bass:0,treble:0,volume:1,balance:0,speed:1,mono:false,pitchPreserve:true,eqEnabled:true,toneEnabled:true,limiterEnabled:true,audioMode:'custom',reverbEnabled:false,reverbDamp:0,reverbDelay:0,reverbSize:1.2,reverbMix:0};
  const SET={...structuredClone(defaults),...overrides};
  const context=vm.createContext({document,$,$$,SET,DEFAULTS:defaults,EQ:{knob:()=>{},rebuild(){},savePreset:()=>calls.push('savePreset')},BAND_COLORS:['#888888','#990099','#770000'],
    clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),saveSet:()=>calls.push('save'),toast:m=>calls.push(['toast',m]),Engine:{applyEQ:()=>calls.push('eq'),applyVolume:()=>calls.push('volume'),applySpeed:()=>calls.push('speed'),applyReverb:()=>calls.push('reverb')},UI:{drawCurve:()=>calls.push('curve')},
    setVal:(key,value)=>{SET[key]=value;calls.push(['setVal',key,value]);if(['volume','balance','mono'].includes(key))context.Engine.applyVolume();else if(['speed','pitchPreserve'].includes(key))context.Engine.applySpeed();else if(key.startsWith('reverb'))context.Engine.applyReverb();},
    S:body=>'<svg>'+body+'</svg>',InputLifecycle:{active:()=>true,register:(fn,node)=>resets.push({fn,node})},vibrate(){},icoHTML:name=>'<i data-icon="'+name+'"></i>',closeSheet:()=>calls.push('close'),openSheet:()=>calls.push('open')});
  vm.runInContext(section('function normalizeEq(){','EQ.userPresets=[]')+section('function dragCtl(node,','/* =====================================================================\n   MAIN MENU')+section("EQ.tab='eq';",'const rebuildEq=EQ.rebuild;')+section('const EQ_DIALS={','/* Keep the existing delegated lists'),context);
  return {context,EQ:context.EQ,SET,$,$$,document,calls,resets,render(){context.EQ.render();},panels(){context.renderVolumePanel();context.renderFxPanel();}};
}

test('actual graphic render pins the preamp outside the scrolling native band bank',()=>{
  const h=harness();h.render();assert.equal(h.$('#bands [data-preamp]'),null);assert.ok(h.$('#eq-preamp [data-preamp]'));
  assert.equal(h.$$('#bands .band').length,10);assert.equal(h.$('#bands').getAttribute('data-horizontal-gesture'),'eq-bands');
  assert.match(h.$('#bands').innerHTML,/>1K<b/);assert.equal(h.$('#eq-preamp').parentNode,h.$('#bands').parentNode);
  assert.equal(h.$('#eq-preamp [role="slider"]').getAttribute('aria-valuenow'),'0.0');assert.equal(h.$('#m-equ').getAttribute('aria-pressed'),'true');
});
test('parametric cards render channel and filter pills with Q before frequency',()=>{
  const h=harness({eqMode:'parametric',eqTypes:['lowshelf',...Array(9).fill('peaking')]});h.render();
  const card=h.$('#bands [data-b="0"]');assert.ok(card.classList.contains('parametric-band'));assert.ok(card.querySelector('.band-channel').disabled);
  assert.match(card.querySelector('.band-channel').getAttribute('aria-label'),/unavailable/);
  assert.ok(h.$('#bands').innerHTML.indexOf('data-q="0"')<h.$('#bands').innerHTML.indexOf('data-freq="0"'));
  assert.equal(card.querySelector('[data-q="0"]').getAttribute('aria-disabled'),'true');assert.equal(card.querySelector('[data-q-label="0"]').textContent,'Fixed');
  assert.equal(card.querySelector('[data-q="0"]').events.size,0);assert.equal(h.$('#eq-capabilities').hidden,false);
});
test('real gain and frequency bindings clamp, persist and apply the supported engine',()=>{
  const h=harness({eqMode:'parametric'});h.render();const gain=h.$('[data-band="1"]');gain.fire('pointerdown');gain.fire('pointermove',{clientY:-200});gain.fire('pointerup',{clientY:-200});
  assert.equal(h.SET.eqGains[1],15);assert.equal(gain.hasPointerCapture(1),false);assert.equal(h.$('[data-gain-label="1"]').textContent,'15.0');
  const preamp=h.$('[data-preamp]');preamp.fire('keydown',{key:'ArrowDown'});assert.equal(h.SET.preamp,-.1);preamp.fire('keydown',{key:'Home'});assert.equal(h.SET.preamp,0);
  const frequency=h.$('[data-freq="1"]');frequency.fire('keydown',{key:'ArrowUp'});assert.ok(h.SET.eqFreqs[1]>62);assert.equal(h.SET.preset,'Manual');assert.ok(h.calls.includes('save')&&h.calls.includes('eq'));
});
test('filter changes keep the band scroll position and truthful fixed shelf-Q affordance',()=>{
  const h=harness({eqMode:'parametric'});h.render();h.$('#bands').scrollLeft=222;const filter=h.$('[data-type="1"]');filter.value='highshelf';filter.fire('change');
  assert.equal(h.SET.eqTypes[1],'highshelf');assert.equal(h.$('#bands').scrollLeft,222);assert.equal(h.$('[data-q="1"]').getAttribute('aria-disabled'),'true');
  const peak=h.$('[data-type="1"]');peak.value='peaking';peak.fire('change');assert.equal(h.$('[data-q="1"]').getAttribute('aria-disabled'),'false');h.$('[data-q="1"]').fire('keydown',{key:'ArrowUp'});assert.ok(h.SET.eqQ[1]>1.4142);
});
test('native bank add/remove actions stay bounded and keep all supported arrays aligned',()=>{
  const h=harness({eqMode:'parametric'});h.render();h.$('#band-add').fire('click');assert.equal(h.SET.eqFreqs.length,11);h.$('#band-remove').fire('click');assert.equal(h.SET.eqFreqs.length,10);
  h.SET.eqFreqs=[1000];h.SET.eqGains=[0];h.SET.eqQ=[1];h.SET.eqTypes=['peaking'];h.render();assert.equal(h.$('#band-remove').disabled,true);h.$('#band-remove').fire('click');assert.equal(h.SET.eqFreqs.length,1);
  h.SET.eqFreqs=Array(32).fill(1000);h.render();h.$('#band-add').fire('click');assert.equal(h.SET.eqFreqs.length,32);for(const key of ['eqGains','eqQ','eqTypes'])assert.equal(h.SET[key].length,32);
});
test('overflow disables unavailable native actions and dispatches existing save/reset/mode actions',()=>{
  const h=harness({eqGains:Array(10).fill(3),preamp:2,bass:.2,treble:-.1});h.render();h.EQ.moreMenu();
  for(const key of ['auto','lock','rename','share','export','import']){const b=h.$('[data-eq-action="'+key+'"]');assert.equal(b.disabled,true);assert.equal(b.onclick,undefined);assert.match(b.textContent,/unavailable/i);}
  h.$('[data-eq-action="save"]').fire('click');assert.ok(h.calls.includes('savePreset'));h.EQ.moreMenu();h.$('[data-eq-action="restore"]').fire('click');assert.deepEqual(plain(h.SET.eqGains),Array(10).fill(0));assert.equal(h.SET.preamp,0);assert.equal(h.SET.bass,0);assert.equal(h.SET.treble,0);
  h.EQ.moreMenu();h.$('[data-eq-mode="parametric"]').fire('click');assert.equal(h.SET.eqMode,'parametric');assert.equal(h.$('#bands').classList.contains('parametric-bands'),true);
});
test('tab rendering hides whole gain bank and reports effects bypassed in Transparent mode',()=>{
  const h=harness({audioMode:'transparent'});h.render();assert.match(h.$('#eq-playback-state').textContent,/effects bypassed/);assert.match(h.$('#eqstat').textContent,/SAVED/);
  h.EQ.tab='vol';h.render();assert.equal(h.$('#sc-eq .eqbody').hidden,true);assert.equal(h.$('#curve').hidden,true);assert.equal(h.$('#volume-panel').hidden,false);assert.equal(h.$('#fx-panel').hidden,true);
  h.EQ.tab='tone';h.render();assert.equal(h.$('#fx-panel').hidden,false);h.EQ.moreMenu();h.$('#eq-playback-mode').fire('click');assert.equal(h.SET.audioMode,'custom');assert.match(h.$('#eq-playback-state').textContent,/Custom playback/);
});
test('volume dials use supported bindings and stereo expansion stays explicitly unavailable',()=>{
  const h=harness();h.panels();assert.match(h.$('#volume-panel').textContent,/Stereo ExpandUnavailable/);assert.equal(h.$('[data-effect-dial="stereoExpand"]'),null);
  h.$('[data-effect-dial="volume"]').fire('pointerdown');h.$('[data-effect-dial="volume"]').fire('pointermove',{clientY:200});h.$('[data-effect-dial="volume"]').fire('pointerup',{clientY:200});assert.equal(h.SET.volume,.5);assert.equal(h.$('[data-effect-value="volume"]').textContent,'50%');
  h.$('[data-effect-dial="balance"]').fire('keydown',{key:'ArrowUp'});assert.equal(h.SET.balance,.01);h.$('#eq-mono').fire('click');assert.equal(h.SET.mono,true);h.$('#eq-tempo-up').fire('click');assert.equal(h.SET.speed,1.05);h.$('#eq-pitch-preserve').fire('click');assert.equal(h.SET.pitchPreserve,false);
  h.$('#eq-volume-reset').fire('click');assert.equal(h.SET.volume,1);assert.equal(h.SET.balance,0);assert.equal(h.SET.mono,false);assert.equal(h.SET.speed,1);assert.ok(h.calls.includes('volume')&&h.calls.includes('speed'));
});
test('reverb dials map only to existing convolution fields and disable native-only controls',()=>{
  const h=harness();h.panels();assert.match(h.$('#fx-panel').textContent,/FilterUnavailable/);assert.match(h.$('#fx-panel').textContent,/FadeUnavailable/);assert.match(h.$('#fx-panel').textContent,/Pre-Delay MixUnavailable/);
  assert.equal(h.$$('#fx-panel [data-effect-dial]').length,4);h.$('#eq-reverb-toggle').fire('click');assert.equal(h.SET.reverbEnabled,true);h.$('[data-effect-dial="reverbDelay"]').fire('keydown',{key:'ArrowUp'});assert.equal(h.SET.reverbDelay,1);
  h.$('[data-effect-dial="reverbMix"]').fire('pointerdown');h.$('[data-effect-dial="reverbMix"]').fire('pointermove',{clientY:-400});h.$('[data-effect-dial="reverbMix"]').fire('pointerup',{clientY:-400});assert.equal(h.SET.reverbMix,.7);assert.ok(h.calls.includes('reverb'));
  h.$('#eq-reverb-reset').fire('click');assert.equal(h.SET.reverbDelay,0);assert.equal(h.SET.reverbMix,0);assert.equal(h.SET.reverbSize,1.2);
});
test('real drag cancellation cannot keep changing gain after pointercancel or lifecycle reset',()=>{
  const h=harness();h.render();const gain=h.$('[data-band="0"]');gain.fire('pointerdown');gain.fire('pointermove',{clientY:110});gain.fire('pointercancel');const value=h.SET.eqGains[0];gain.fire('pointermove',{clientY:400});assert.equal(h.SET.eqGains[0],value);assert.equal(gain.hasPointerCapture(1),false);
  gain.fire('pointerdown');h.resets.find(r=>r.node===gain).fn();gain.fire('pointermove',{clientY:0});assert.equal(h.SET.eqGains[0],value);
});

test('panel rerenders preserve focus for toggles, tempo steps, reset and filter selection',()=>{
  const h=harness({eqMode:'parametric'});h.panels();h.render();
  for(const id of ['eq-mono','eq-tempo-up','eq-volume-reset','eq-reverb-toggle','eq-reverb-reset']){const button=h.$('#'+id);button.focus();button.fire('click');assert.equal(h.document.activeElement,h.$('#'+id));assert.notEqual(h.document.activeElement,button);}
  const filter=h.$('[data-type="1"]');filter.focus();filter.value='lowshelf';filter.fire('change');assert.equal(h.document.activeElement,h.$('[data-type="1"]'));
});
test('tone pointer-path knob sync refreshes announced values without requiring a full render',()=>{
  const h=harness();h.render();const bass=h.$('#k-bass');h.EQ.knob(bass,.36,-1,1);assert.equal(bass.getAttribute('aria-valuenow'),'36');assert.equal(bass.getAttribute('aria-valuetext'),'36%');
  const treble=h.$('#k-treble');h.EQ.knob(treble,-.27,-1,1);assert.equal(treble.getAttribute('aria-valuenow'),'-27');
});
test('final native-label sync preserves the bypass notice and supported percentage/decibel labels',()=>{
  const h=harness({audioMode:'transparent',eqGains:Array(10).fill(6),preamp:6,bass:.5});
  h.context.nativeValues=()=>({eq_labels:2,tone_labels:1});vm.runInContext(section('  const sync=EQ.sync;EQ.sync=function(){','  const item=PAGES.skin.items'),h.context);h.render();
  assert.match(h.$('#eq-playback-state').textContent,/effects bypassed/);assert.match(h.$('#eqstat').textContent,/SAVED/);assert.equal(h.$('[data-gain-label="0"]').textContent,'100%');assert.equal(h.$('#pv').textContent,'100%');assert.equal(h.$('#bass-v').textContent,'7.5 dB');
});

test('reference CSS scopes card sizing and right-aligned overflow without a compressed landscape bank',()=>{
  assert.match(html,/\.sheet:has\(\.eq-menu-heading\)\{left:auto;right:calc\(8 \* var\(--pa-u\)\)/);
  assert.match(html,/@media\(orientation:landscape\) and \(min-width:650px\)\{#sc-eq\{--pa-u:1px;--eq-bank-height:354px\}\}/);
  assert.doesNotMatch(html,/#sc-eq\{--eq-bank-height:260px/);
});
