// Shared by the offline publisher, Worker adapter, and browser. No report code.
export const MAX_BYTES = 20000;
const fail = message => { throw new TypeError(message); };
const str = (v, max=2000) => typeof v === 'string' && v.trim() && v.length <= max;
const object = v => v && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, allowed) => { if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('Unknown field'); };
const list = (v, max) => { if (!Array.isArray(v) || !v.length || v.length > max) fail('Invalid list'); };
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function safeURL(v) {
  if (!str(v, 1000)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/i.test(u.hostname) && !/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname) && u.hostname.includes('.'); } catch { return false; }
}
export function validateReport(r) {
  if (new TextEncoder().encode(JSON.stringify(r)).length > MAX_BYTES) fail('Report too large');
  keys(r, ['schema','id','date','timezone','title','summary','visibility','synthetic','stories']);
  if (r.schema !== 'jarvis-daily-board-v1' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.id) || !date(r.date) || r.timezone !== 'America/Argentina/Cordoba' || r.visibility !== 'public' || typeof r.synthetic !== 'boolean' || !str(r.title,120) || !str(r.summary,1000)) fail('Invalid report metadata');
  list(r.stories,12); const ids = new Set();
  const unique = id => { if (!str(id,64) || !/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) fail('Invalid or duplicate stable ID'); ids.add(id); };
  for (const s of r.stories) {
    keys(s,['id','title','label','composition','claim','sources','blocks']); unique(s.id);
    if (!str(s.title,160) || !str(s.label,80) || !['flow','split','band'].includes(s.composition) || !['fact','forecast','interpretation'].includes(s.claim)) fail('Invalid story');
    list(s.sources,12);
    for(const source of s.sources) {
      keys(source,['title','url','publishedOn','eventOn','note']);
      if(!str(source.title,160)||!safeURL(source.url)||!(source.publishedOn===null||date(source.publishedOn))||!(source.eventOn===null||date(source.eventOn))||!str(source.note,500)) fail('Invalid source');
    }
    list(s.blocks,16);
    for(const b of s.blocks) {
      unique(b.id);
      const common=['id','type','text'];
      if(!str(b.text)) fail('Every block requires readable text');
      switch(b.type) {
        case 'prose': keys(b,common); break;
        case 'comparison': case 'timeline':
          keys(b,[...common,'items']); list(b.items,8);
          for(const i of b.items) { keys(i,['label','text']); if(!str(i.label,100)||!str(i.text,600))fail('Invalid item'); } break;
        case 'chart':
          keys(b,[...common,'unit','items']); if(!str(b.unit,40))fail('Chart unit required'); list(b.items,8);
          for(const i of b.items) { keys(i,['label','value']); if(!str(i.label,100)||!Number.isFinite(i.value)||i.value<0||i.value>1e9)fail('Invalid chart'); } break;
        case 'image':
          keys(b,[...common,'asset','alt','annotations']);
          if(!/^assets\/[a-z0-9-]+\.(png|webp|jpg)$/.test(b.asset)||!str(b.alt,500))fail('Only reviewed local images');
          list(b.annotations,8); for(const a of b.annotations) { keys(a,['label','text']); if(!str(a.label,100)||!str(a.text,600))fail('Invalid annotation'); } break;
        case 'explanation':
          keys(b,[...common,'steps']); list(b.steps,8); for(const step of b.steps)if(!str(step,600))fail('Invalid explanation'); break;
        default: fail('Unsupported block type');
      }
    }
  }
  return r;
}
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const legacyBody = r => [r.summary,...r.stories.flatMap(s=>[s.title,...s.blocks.map(b=>b.text),...s.sources.map(x=>`${x.title}: ${x.url}`)])].join('\n\n');
