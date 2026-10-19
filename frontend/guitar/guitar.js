import {icon, sheet, readLocal, writeLocal} from '../assets/ui.js';
import { API_ORIGIN } from '/assets/config.js';
import { filename, createDownload, nativeSaveMode, saveToDevice, triggerDownload, withDeadline, renderInWorker } from './runtime.js';
import { allGuitarValue, resolveParts } from './track-selection.js';
const $ = id => document.getElementById(id);
let busy = false, current = null, results = [], readyDownload = null, scoreCache=null, previewURLs=[], libraryView='recent';
const stored=readLocal('jarvis.guitar.library.v1',{});
let recent=Array.isArray(stored.recent)?stored.recent.filter(x=>x&&Number.isInteger(x.songId)).slice(0,30):[], saved=Array.isArray(stored.saved)?stored.saved.filter(x=>x&&Number.isInteger(x.songId)).slice(0,100):[];
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
const text = (tag, value, className) => { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; };
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearReadyDownload() {
  readyDownload?.revoke(); readyDownload = null;
  const actions = $('pdf-actions'); if (actions) actions.hidden = true;
  for (const id of ['open-pdf', 'direct-download']) {
    const link = $(id); if (link) { link.removeAttribute('href'); link.removeAttribute('download'); }
  }
  const generate = $('download-pdf'); if (generate){generate.textContent='Save PDF';generate.hidden=false;}
}
function lock(value) {
  busy = value;
  for (const e of document.querySelectorAll('main button, main input')) e.disabled = value;
  $('content').setAttribute('aria-busy', String(value));
}
async function api(path, signal) {
  try {
    const r = await fetch(API_ORIGIN + '/guitar/' + path, { signal, cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) throw Error(data.error || 'Songsterr is unavailable. Please try again.');
    return data;
  } catch (e) {
    if (signal.aborted) throw Error('Songsterr took too long. Please try again.');
    if (e instanceof TypeError || e instanceof SyntaxError) throw Error("Couldn't reach Songsterr. Check your connection and try again.");
    throw e;
  }
}
function showResults() {
  $('results').replaceChildren(); $('results').hidden = false;
  const duplicates = new Map();
  for (const r of results) { const key = r.title.toLowerCase() + '|' + r.artist.toLowerCase(); duplicates.set(key, (duplicates.get(key) || 0) + 1); }
  for (const r of results) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'song-result';
    const label = document.createElement('span'); label.append(text('strong', r.title), text('small', r.artist));
    const counts = new Map(); for (const t of r.tracks) counts.set(t.kind, (counts.get(t.kind) || 0) + 1);
    let instruments = [...counts].map(([kind, n]) => `${n} ${kind === 'other' ? 'other' : kind}`).join(' · ');
    if (duplicates.get(r.title.toLowerCase() + '|' + r.artist.toLowerCase()) > 1) instruments += ` · Version ${r.songId}`;
    if (instruments) label.append(text('small', instruments, 'instruments'));
    button.append(label, text('span', '›')); button.onclick = () => choose(r.songId); $('results').append(button);
  }
}
$('search-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return;
  const q = $('song-query').value.trim(); if (q.length < 2) { status('Enter at least two characters.', true); return; }
  current=null;clearPreview();clearReadyDownload();libraryView='search';renderLibrary();
  lock(true); status('Searching…'); current = null; $('song').hidden = true; $('results').replaceChildren();
  try {
    const data = await withDeadline(signal => api(`search?q=${encodeURIComponent(q)}`, signal), 20000);
    if (!Array.isArray(data.results)) throw Error('Songsterr returned invalid search results.');
    results = data.results; showResults(); status(results.length ? '' : 'No songs found. Try another title or artist.');
  } catch (e) { status(e.message, true); } finally { lock(false); }
};
async function choose(id) {
  if (busy) return;
  clearReadyDownload();
  lock(true); status('Loading tracks…');
  try {
    const data = await withDeadline(signal => api(`songs/${id}`, signal), 20000);
    if (!data.song?.tracks?.length) throw Error('No usable tracks in this Songsterr version.');
    // Render first, then persist: showSong() must read the previous visit's
    // remembered selection from `recent` before rememberSong() overwrites it.
    // (Calling rememberSong() first let snapshot() capture the checked radio
    // of the previously viewed song and leak it into the new song.)
    clearPreview(); current = data.song; const parts = showSong(); rememberSong(parts); status(''); $('tab-library').hidden = true; history.replaceState(null, '', '#song=' + current.songId);
  } catch (e) { status(e.message, true); } finally { lock(false); }
}
function showSong() {
  clearReadyDownload();
  const root = $('song'); root.replaceChildren(); root.hidden = false; $('results').hidden = true;
  const back = text('button', '‹ Results', 'text-button change-song'); back.type = 'button';
  back.onclick = () => { if (busy) return; clearReadyDownload(); root.hidden=true;clearPreview();current=null;history.replaceState(null,'','#'+libraryView);if(results.length)$('results').hidden=false;else renderLibrary();status(''); };
  root.append(back, text('h2', current.title), text('p', current.artist, 'song-artist'));
  const guitars = current.tracks.filter(t => t.kind === 'guitar');
  const preferred = guitars.length ? guitars : current.tracks;
  // Resolve the effective selection: a remembered value is honored only when
  // it names a real option for THIS song; otherwise fall back to the guitar
  // default ("All guitar tracks" when offered, else first guitar track).
  const allValue = allGuitarValue(current.tracks);
  const chosenValue = resolveParts(current.tracks, recent.find(x => x.songId === current.songId)?.parts, saved.find(x => x.songId === current.songId)?.parts);
  const chosen = current.tracks.find(t => String(t.partId) === chosenValue) || preferred[0];
  const select = document.createElement('fieldset'); select.className = 'track-list';
  function option(value, name, instrument, checked = false) {
    const label = document.createElement('label'); label.className = 'track-option';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'part'; radio.value = value; radio.checked = checked;
    const title = text('span', name); if (instrument) title.append(text('small', instrument));
    label.append(radio, title); return label;
  }
  if(current.tracks.length===1) root.append(text('p', `${chosen.name}${chosen.instrument && chosen.name !== chosen.instrument ? ' · ' + chosen.instrument : ''}`, 'single-track'));
  else {
    select.append(text('legend', 'Track'));
    for (const t of preferred) select.append(option(String(t.partId), t.name, t.instrument || t.kind, String(t.partId) === chosenValue));
    if (allValue) select.append(option(allValue, 'All guitar tracks', '', chosenValue === allValue));
    const others = current.tracks.filter(t => !preferred.includes(t));
    if (others.length) {
      const details = document.createElement('details'); details.append(text('summary', 'Other instruments'));
      for (const t of others) details.append(option(String(t.partId), t.name, `${t.kind} · ${t.instrument}`, String(t.partId) === chosenValue));
      select.append(details);
    }
    const picker=text('button',chosenValue===allValue?'All guitar tracks':chosen.name,'track-picker');picker.type='button';picker.id='track-picker';picker.insertAdjacentHTML('beforeend',icon('chevron'));
    const dialog=document.createElement('dialog');dialog.className='app-sheet';const head=document.createElement('div');head.className='dialog-heading';head.append(text('h2','Choose track'));const close=text('button','×','icon-button');close.type='button';close.setAttribute('aria-label','Close track picker');close.onclick=()=>dialog.close();head.append(close);dialog.append(head,select);root.append(picker,dialog);picker.onclick=()=>dialog.showModal();select.addEventListener('change',()=>{const parts=select.querySelector('input:checked')?.value;picker.firstChild.textContent=parts===allValue?'All guitar tracks':current.tracks.find(t=>String(t.partId)===parts)?.name||'Track';rememberSong(parts);dialog.close();});
  }
  const download = text('button', 'Save PDF', 'primary guitar-download'); download.type = 'button'; download.id = 'download-pdf';
  const actions = document.createElement('div'); actions.id = 'pdf-actions'; actions.className = 'pdf-actions'; actions.hidden = true;
  const save = text('button', 'Save PDF', 'primary guitar-download'); save.type = 'button'; save.id = 'save-pdf';
  const open = text('a', 'Open PDF', 'secondary guitar-download'); open.id = 'open-pdf'; open.target = '_blank'; open.rel = 'noopener';
  const direct = text('a', 'Direct download', 'secondary guitar-download'); direct.id = 'direct-download';
  save.onclick = async () => {
    if (!readyDownload || save.disabled) return;
    if (!nativeSaveMode(readyDownload)) {
      triggerDownload(readyDownload); status('Download requested. If Chrome stays quiet, use Open PDF.'); return;
    }
    save.disabled = true;
    try {
      const mode = await saveToDevice(readyDownload);
      status(mode === 'file-picker' ? 'PDF saved to the folder you chose.' : 'Choose Files, Drive, or another app in the system sheet.');
    } catch (e) {
      if (e?.name === 'AbortError') status('Save cancelled. The PDF is still ready.');
      else status("Couldn't open Android's save options. Try Open PDF or Direct download.", true);
    } finally { save.disabled = false; }
  };
  open.onclick = () => status('PDF opened in a new tab. Use Chrome’s download button there.');
  direct.onclick = () => status('Direct download requested. Check Chrome Downloads.');
  actions.append(save, open, direct);
  if(current.tracks.length>1)select.onchange=()=>{clearReadyDownload();clearPreview();status('');};
  download.onclick = () => { clearReadyDownload(); generate(parts(), download, actions, open, direct, save); };
  const saveTab=text('button',saved.some(x=>x.songId===current.songId)?'Saved tab':'Save tab','text-button');saveTab.type='button';saveTab.id='save-tab';saveTab.onclick=()=>{toggleSaved();saveTab.textContent=saved.some(x=>x.songId===current.songId)?'Saved tab':'Save tab';};root.insertBefore(saveTab,root.querySelector('h2'));
  const preview=text('button','Preview tab','secondary guitar-download');preview.id='preview-tab';preview.type='button';
  const paper=text('div','','notation-paper notation-fit');paper.id='notation-preview';paper.append(text('p','Preview the selected track before saving.','notation-placeholder'));
  const parts=()=>current.tracks.length===1?String(chosen.partId):select.querySelector('input:checked')?.value||chosenValue;
  preview.onclick=async()=>{if(busy)return;lock(true);status('Preparing notation…');try{const cached=await prepareScore(parts());showPreview(cached.score);status(cached.score.warnings.length?'Preview ready. Some notation could not be converted exactly.':'Preview ready');}catch(e){status(e.message,true);}finally{lock(false);}};
  const collection=text('button','Organize saved tab','text-button');collection.type='button';collection.onclick=()=>sheet('Save to a collection',['Learning','Repertoire','Favorites'].map(name=>({label:name,action:()=>{const item={...snapshot(),collection:name};saved=saved.filter(x=>x.songId!==item.songId);saved.unshift(item);persistLibrary();saveTab.textContent='Saved tab';}})));
  root.append(preview,paper,download,actions,collection);
  return chosenValue;
}
async function generate(parts, download, actions, open, direct, save) {
  if (busy || !current || !parts) return;
  lock(true); status('Preparing tab…'); const song = current;
  const selected = parts.split(',').map(Number).map(id => song.tracks.find(t => t.partId === id));
  const label = selected.length === 1 ? selected[0].name : 'All guitar tracks';
  try {
    await withDeadline(async signal => {
      const cached=await prepareScore(parts,signal);const {data,score}=cached;showPreview(score);
      const pdf=await import('./pdf.js');
      signal.throwIfAborted();
      const blob = await pdf.createPdf(score, data.meta, label, signal, (i, total) => status(`Creating PDF… ${Math.round(i / total * 100)}%`));
      signal.throwIfAborted();
      readyDownload = createDownload(blob, filename(song.title, label));
      open.href = readyDownload.url;
      direct.href = readyDownload.url; direct.download = readyDownload.name;
      actions.hidden = false;
      download.hidden=true;save.focus();
      status(score.warnings.length ? 'PDF ready — choose a save method below. Some notation could not be converted exactly.' : 'PDF ready — choose a save method below.');
    }, 120000);
  } catch (e) { status(e.message?.includes('Songsterr') || e.message?.includes('connection') ? e.message : "Couldn't generate this tab. Try another Songsterr version.", true); }
  finally { lock(false); }
}

function snapshot(parts){return {songId:current.songId,title:current.title,artist:current.artist,parts:resolveParts(current.tracks,parts??$('song').querySelector('input:checked')?.value),at:Date.now()};}
function persistLibrary(){if(!writeLocal('jarvis.guitar.library.v1',{recent:recent.slice(0,30),saved:saved.slice(0,100)}))status('Could not save your tab library on this device.',true);}
function rememberSong(parts){
  const item=snapshot(parts);
  recent=recent.filter(x=>x.songId!==item.songId);recent.unshift(item);
  // Saved tabs must retain the current choice even after the recent list evicts it.
  saved=saved.map(entry=>entry.songId===item.songId?{...entry,parts:item.parts}:entry);
  persistLibrary();
}
function toggleSaved(){const found=saved.some(x=>x.songId===current.songId);saved=found?saved.filter(x=>x.songId!==current.songId):[{...snapshot(),collection:'Learning'},...saved];persistLibrary();}
function clearPreview(){for(const url of previewURLs)URL.revokeObjectURL(url);previewURLs=[];scoreCache=null;const root=$('notation-preview');if(root)root.replaceChildren(text('p','Preview the selected track before saving.','notation-placeholder'));}
async function prepareScore(parts,externalSignal){
  if(scoreCache?.parts===parts&&scoreCache.songId===current.songId)return scoreCache;
  const song=current;
  const work=async signal=>{const data=await api(`songs/${song.songId}/score?revision=${song.revisionId}&parts=${parts}`,signal);status('Laying out notation…');const score=await renderInWorker(data,signal);if(current!==song)throw Error('Song changed. Preview the new selection.');scoreCache={songId:song.songId,parts,data,score};return scoreCache;};
  return externalSignal?work(externalSignal):withDeadline(work,120000);
}
function showPreview(score){
  const root=$('notation-preview');for(const url of previewURLs)URL.revokeObjectURL(url);previewURLs=[];root.replaceChildren();
  const label=text('div',score.measures+' measures','notation-meta');const zoom=text('button','Actual size','notation-zoom');zoom.type='button';zoom.onclick=()=>{const fit=root.classList.toggle('notation-fit');zoom.textContent=fit?'Actual size':'Fit width';};label.append(zoom);root.append(label);
  const draw=systems=>{for(const system of systems){const url=URL.createObjectURL(new Blob([system.svg],{type:'image/svg+xml'}));previewURLs.push(url);const img=document.createElement('img');img.src=url;img.alt='Notation, measures '+(system.first+1)+'–'+(system.last+1);img.loading='lazy';img.width=system.width;img.height=system.height;root.append(img);}};
  draw(score.systems.slice(0,4));if(score.systems.length>4){const more=text('button','Show full tab','notation-more');more.type='button';more.onclick=()=>{more.remove();draw(score.systems.slice(4));};root.append(more);}
}
function renderLibrary(){
  $('tab-library').hidden=!!current||libraryView==='search';
  document.querySelectorAll('[data-guitar-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.guitarView===libraryView)));
  const root=$('tab-library');root.replaceChildren();if(root.hidden)return;
  const items=libraryView==='saved'?saved:recent;
  if(!items.length){const empty=text('div','','tab-empty');empty.append(text('h2',libraryView==='saved'?'Your repertoire starts here':'Find your next piece'),text('p',libraryView==='saved'?'Save a tab to keep it close.':'Search a song or artist above. Recently opened tabs will appear here.'));root.append(empty);return;}
  const groups=libraryView==='saved'?[...new Set(items.map(x=>x.collection||'Learning'))]:['Recently opened'];
  for(const name of groups){root.append(text('h2',name,'tab-section-title'));for(const item of items.filter(x=>libraryView==='recent'||(x.collection||'Learning')===name)){const button=text('button','','song-result');button.type='button';const label=text('span','');label.append(text('strong',item.title),text('small',item.artist));button.append(label);button.insertAdjacentHTML('beforeend',icon('chevron'));button.onclick=()=>choose(item.songId);root.append(button);}}
}
for(const tab of document.querySelectorAll('[data-guitar-view]'))tab.onclick=()=>{if(busy)return;current=null;clearPreview();clearReadyDownload();$('song').hidden=true;$('results').hidden=true;libraryView=tab.dataset.guitarView;history.replaceState(null,'','#'+libraryView);renderLibrary();if(libraryView==='search')$('song-query').focus();};
$('guitar-menu').onclick=()=>sheet('Guitar',[{label:'Search Songsterr',icon:'search',action:()=>{document.querySelector('[data-guitar-view="search"]').click();}},{label:'Saved tabs',icon:'bookmark',action:()=>{document.querySelector('[data-guitar-view="saved"]').click();}},{label:'Credits',icon:'info',action:()=>{location.href='/guitar/credits.html';}}]);
const initial=/^#song=(\d+)$/.exec(location.hash);if(initial)choose(Number(initial[1]));else{if(['saved','search'].includes(location.hash.slice(1)))libraryView=location.hash.slice(1);renderLibrary();}
addEventListener('pagehide',e=>{if(!e.persisted){readyDownload?.revoke();for(const url of previewURLs)URL.revokeObjectURL(url);}});
