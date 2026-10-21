import {button} from './icons.js';
const NS='poweramp.lab.1031.v1.';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(NS+key))??fallback;}catch{return fallback;}};
const save=(key,value)=>localStorage.setItem(NS+key,JSON.stringify(value));
export function panel(title,onClose){
  const el=document.createElement('section');el.className='app-panel';el.setAttribute('aria-label',title);
  const head=document.createElement('header');head.className='panel-header';head.append(button('back','Back',onClose));
  const h=document.createElement('h1');h.textContent=title;head.append(h);el.append(head);
  const body=document.createElement('div');body.className='panel-body';el.append(body);return{element:el,head,body,destroy(){}};
}
export function menu(title,items,onClose){
  const outer=document.createElement('div');outer.className='modal-backdrop';
  const dialog=document.createElement('div');dialog.className='modal';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);
  const h=document.createElement('h2');h.textContent=title;dialog.append(h);
  for(const item of items){const b=document.createElement('button');b.className='menu-option';b.textContent=item.label;b.disabled=Boolean(item.disabled);b.addEventListener('click',()=>{onClose();item.action?.();});dialog.append(b);}
  outer.append(dialog);outer.addEventListener('click',e=>{if(e.target===outer)onClose();});
  queueMicrotask(()=>dialog.querySelector('button')?.focus());return{element:outer,destroy(){}};
}
export function equalizer(player,onClose,notify){
  const view=panel('Equalizer',onClose), {body}=view;
  let state=read('eq',{enabled:true,preamp:0,frequencies:[31,62,125,250,500,1000,2000,4000,8000,16000],gains:Array(10).fill(0)});
  if(!Array.isArray(state.gains)||state.gains.length<5||state.gains.length>32)state={enabled:true,preamp:0,frequencies:[31,62,125,250,500,1000,2000,4000,8000,16000],gains:Array(10).fill(0)};
  let presets=read('eq-presets',{});
  function apply(){player.setEq(state.enabled?state.gains:state.gains.map(()=>0),state.enabled?state.preamp:0);player.setEqFrequencies(state.frequencies);try{save('eq',state);}catch{notify('Unable to save equalizer settings');}}
  const actions=document.createElement('div');actions.className='eq-actions';body.append(actions);
  const enabled=document.createElement('button');enabled.className='text-button';enabled.textContent='Equalizer';enabled.setAttribute('aria-pressed',String(state.enabled));enabled.onclick=()=>{state.enabled=!state.enabled;enabled.setAttribute('aria-pressed',String(state.enabled));apply();};actions.append(enabled);
  const preset=document.createElement('select');preset.setAttribute('aria-label','Equalizer preset');
  function fillPresets(){preset.replaceChildren();for(const name of ['Custom','Flat',...Object.keys(presets)]){const o=document.createElement('option');o.textContent=name;preset.append(o);}}
  fillPresets();preset.onchange=()=>{if(preset.value==='Flat'){state.gains.fill(0);state.preamp=0;}else if(presets[preset.value])state={...state,...structuredClone(presets[preset.value])};drawBands();apply();};actions.append(preset);
  const saveButton=document.createElement('button');saveButton.className='text-button';saveButton.textContent='Save preset';saveButton.onclick=()=>{
    const name=prompt('Preset name');if(!name?.trim())return;presets[name.trim().slice(0,80)]={gains:[...state.gains],frequencies:[...state.frequencies],preamp:state.preamp};try{save('eq-presets',presets);}catch{notify('Unable to save preset');}fillPresets();preset.value=name.trim().slice(0,80);
  };actions.append(saveButton);
  const countLabel=document.createElement('label');countLabel.textContent='Bands ';const count=document.createElement('select');count.setAttribute('aria-label','Equalizer bands');for(const n of [5,10,15,20,31,32]){const o=document.createElement('option');o.value=n;o.textContent=n;count.append(o);}count.value=state.gains.length;
  count.onchange=()=>{const n=Number(count.value);state.frequencies=Array.from({length:n},(_,i)=>Math.round(31.25*(16000/31.25)**(i/(n-1))));state.gains=Array(n).fill(0);drawBands();apply();};countLabel.append(count);actions.append(countLabel);
  const bands=document.createElement('div');bands.className='eq-bands';body.append(bands);
  function drawBands(){bands.replaceChildren();count.value=state.gains.length;
    for(let i=-1;i<state.gains.length;i++){const l=document.createElement('label');l.className='eq-band';const title=document.createElement('span');title.textContent=i<0?'Preamp':state.frequencies[i]>=1000?`${(state.frequencies[i]/1000).toFixed(1)}k`:String(state.frequencies[i]);
      const range=document.createElement('input');range.type='range';range.min=i<0?-24:-15;range.max=i<0?24:15;range.step=.1;range.value=i<0?state.preamp:state.gains[i];range.setAttribute('aria-label',i<0?'Preamp':`${state.frequencies[i]} Hz gain`);
      const output=document.createElement('output');output.textContent=`${Number(range.value).toFixed(1)}`;range.oninput=()=>{const value=Number(range.value);if(i<0)state.preamp=value;else state.gains[i]=value;output.textContent=value.toFixed(1);preset.value='Custom';apply();};l.append(title,range,output);bands.append(l);
    }
  }
  drawBands();apply();
  const contract=document.createElement('p');contract.textContent='Browser audio output · Web Audio equalizer. Native DVC, hardware output, parametric Q and reverb are not available in this build.';body.append(contract);
  return view;
}
export function restoreEqualizer(player){const state=read('eq',null);if(state?.enabled&&Array.isArray(state.frequencies)&&Array.isArray(state.gains)){player.setEq(state.gains,state.preamp);player.setEqFrequencies(state.frequencies);}}
export function parseLyrics(text){return text.split(/\r?\n/).flatMap(line=>{const stamps=[...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];const content=line.replace(/\[[^\]]*\]/g,'').trim();return stamps.length?stamps.map(s=>({time:Number(s[1])*60+Number(s[2]),text:content})):[{time:null,text:content}];}).filter(l=>l.text).sort((a,b)=>(a.time??Infinity)-(b.time??Infinity));}
export function lyrics(player,onClose,notify){
  const view=panel('Lyrics',onClose);const track=player.currentTrack;const key='lyrics.'+(track?.id||'none');let text=read(key,track?.lyrics||'');
  const controls=document.createElement('div');controls.className='eq-actions';view.body.append(controls);
  const edit=document.createElement('button');edit.className='text-button';edit.textContent='Edit lyrics';controls.append(edit);
  const importButton=document.createElement('button');importButton.className='text-button';importButton.textContent='Import LRC';controls.append(importButton);
  const picker=document.createElement('input');picker.type='file';picker.accept='.lrc,.txt,text/plain';picker.hidden=true;controls.append(picker);importButton.onclick=()=>picker.click();
  const content=document.createElement('div');view.body.append(content);let lines=[],last=-1;
  function show(){content.replaceChildren();lines=parseLyrics(text);last=-1;if(!lines.length){content.textContent='No lyrics. Add lyrics or import a timed LRC file for this track.';return;}for(const line of lines){const row=document.createElement('button');row.className='lyrics-line';row.textContent=line.text;row.disabled=line.time===null;row.onclick=()=>player.seek(line.time);content.append(row);}update();}
  function update(){let active=-1;for(let i=0;i<lines.length;i++)if(lines[i].time!==null&&lines[i].time<=player.time)active=i;if(active===last)return;last=active;[...content.children].forEach((row,i)=>row.classList.toggle('active',i===active));if(active>=0)content.children[active]?.scrollIntoView({block:'center',behavior:'smooth'});}
  function persist(){try{save(key,text);}catch{notify('Unable to save lyrics');}show();}
  picker.onchange=async()=>{const file=picker.files[0];if(file&&file.size<1024*1024){text=await file.text();persist();}else notify('Choose a lyrics file smaller than 1 MiB');};
  edit.onclick=()=>{const area=document.createElement('textarea');area.value=text;area.setAttribute('aria-label','Lyrics text');const done=document.createElement('button');done.className='text-button';done.textContent='Save';done.onclick=()=>{text=area.value;persist();};content.replaceChildren(area,done);area.focus();};
  player.addEventListener('time',update);view.destroy=()=>player.removeEventListener('time',update);show();return view;
}
export function visualization(player,onClose){
  const view=panel('Visualization',onClose);const canvas=document.createElement('canvas');canvas.className='visualization-canvas';canvas.setAttribute('aria-label','Live audio frequency spectrum');view.body.append(canvas);const p=document.createElement('p');p.textContent='Spectrum · live decoded audio. MilkDrop preset rendering is not included.';view.body.append(p);
  const ctx=canvas.getContext('2d');let frame=0,closed=false;
  function draw(){if(closed)return;const w=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio)),h=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);const analyser=player.analyser;if(analyser){const bins=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(bins);const bars=64;for(let i=0;i<bars;i++){const lo=Math.floor((i/bars)**2*bins.length),hi=Math.max(lo+1,Math.floor(((i+1)/bars)**2*bins.length));let peak=0;for(let b=lo;b<hi;b++)peak=Math.max(peak,bins[b]);ctx.fillStyle=`hsl(${30+i*2},85%,55%)`;ctx.fillRect(i*w/bars,h-peak/255*h,w/bars-2,peak/255*h);}}frame=requestAnimationFrame(draw);}
  draw();view.destroy=()=>{closed=true;cancelAnimationFrame(frame);};return view;
}
