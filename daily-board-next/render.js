import {validateReport} from './schema.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function renderBlock(b) {
  const root=el('div',undefined,'board-block'); root.id=`block-${b.id}`;
  root.append(el('p',b.text,'intro'));
  if(b.type==='comparison'||b.type==='timeline') {
    const group=el('div',undefined,b.type==='comparison'?'concept-compare':'evidence-list');
    for(const i of b.items){const item=el('div',undefined,'evidence-item');item.append(el('h3',i.label),el('p',i.text));group.append(item);} root.append(group);
  } else if(b.type==='chart') {
    const figure=el('figure',undefined,'export-figure'); const max=Math.max(1,...b.items.map(i=>i.value));
    figure.append(el('figcaption',`${b.text} · ${b.unit}`));
    for(const i of b.items){const row=el('div',undefined,'export-row');row.append(el('p',`${i.label}: ${i.value} ${b.unit}`,'export-label'));const track=el('div',undefined,'export-track'),fill=el('div',undefined,'export-fill');fill.style.width=`${i.value/max*100}%`;track.setAttribute('aria-hidden','true');track.append(fill);row.append(track);figure.append(row);}root.append(figure);
  } else if(b.type==='image') {
    const figure=el('figure'),image=el('img');image.src=b.asset;image.alt=b.alt;image.loading='lazy';figure.append(image);
    const list=el('ol');for(const a of b.annotations)list.append(el('li',`${a.label}: ${a.text}`));figure.append(list);root.append(figure);
  } else if(b.type==='explanation') {
    const bench=el('div',undefined,'answer-example'),label=el('label','Explore the explanation','control');
    const input=el('input');input.type='range';input.min='0';input.max=String(b.steps.length-1);input.step='1';input.value='0';input.setAttribute('aria-label','Explanation step');
    const output=el('p',b.steps[0],'lab-explain');output.setAttribute('aria-live','polite');input.addEventListener('input',()=>{output.textContent=b.steps[Number(input.value)];});label.append(input);bench.append(label,output);root.append(bench);
    const details=el('details',undefined,'sources');details.append(el('summary','Read all steps'));const list=el('ol');b.steps.forEach(s=>list.append(el('li',s)));details.append(list);root.append(details);
  } else if(b.type!=='prose') root.append(el('p','This visual is unavailable. Its explanation is shown above.','caption'));
  return root;
}
export function renderReport(report,target) {
  // Fail closed for unknown schemas/types; caller retains legacy text fallback.
  validateReport(report); const fragment=document.createDocumentFragment();
  const header=el('header',undefined,'edition');header.append(el('span',report.synthetic?'Synthetic demonstration · not a news report':'Daily Board'),el('time',report.date));fragment.append(header);
  const intro=el('section',undefined,'story');intro.append(el('h1',report.title),el('p',report.summary,'intro'),el('p','Rosario · America/Argentina/Cordoba','caption'));fragment.append(intro);
  for(const s of report.stories) {
    const article=el('article',undefined,`story ${s.composition==='band'?'local-band':'rule'}`);article.id=`story-${s.id}`;
    article.append(el('div',`${s.label} · ${s.claim}`,'section-name'),el('h2',s.title));
    const blocks=el('div',undefined,s.composition==='split'?'lead-grid':'prose');s.blocks.forEach(b=>blocks.append(renderBlock(b)));article.append(blocks);
    const sources=el('details',undefined,'sources');sources.append(el('summary',`Read the sources · ${s.sources.length}`));const list=el('ul');
    for(const source of s.sources){const li=el('li'),a=el('a',source.title);a.href=source.url;a.rel='noopener noreferrer';a.target='_blank';li.append(a,el('span',`Published: ${source.publishedOn??'undated'} · Event: ${source.eventOn??'not specified'}. ${source.note}`));list.append(li);}sources.append(list);article.append(sources);fragment.append(article);
  }
  target.replaceChildren(fragment);
}
export function renderEntry(entry,target) {
  if(entry.report)try{renderReport(entry.report,target);return;}catch{/* Unsupported reports retain readable legacy text. */}
  const article=el('article',undefined,'story');article.append(el('h2',entry.title||'Daily Board'),el('p',entry.body||'Report unavailable','legacy-copy'));target.replaceChildren(article);
}
