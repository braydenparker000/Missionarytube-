// Minimal XML reader for apktool output: elements, attributes, text, CDATA,
// comments and the standard entities. Each element records its decoded text and
// its raw inner markup (needed for strings that carry inline HTML such as <b>).

const ENTITIES = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src) {
  const root = {tag: '#document', attrs: {}, children: [], text: '', inner: ''};
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt + 4) + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      i = src.indexOf('>', lt) + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const el = stack.pop();
      el.inner = src.slice(el.innerStart, lt);
      delete el.innerStart;
      i = end + 1;
      continue;
    }
    // Start tag: scan to the closing '>' while respecting quoted attribute values.
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    const body = src.slice(lt + 1, j);
    const selfClosing = body.endsWith('/');
    const tagEnd = body.search(/[\s/]|$/);
    const tag = body.slice(0, tagEnd);
    const attrs = {};
    const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    const attrText = body.slice(tagEnd);
    while ((m = re.exec(attrText))) attrs[m[1]] = decodeEntities(m[3] ?? m[4]);
    const el = {tag, attrs, children: [], text: '', inner: '', innerStart: j + 1};
    top.children.push(el);
    if (selfClosing) delete el.innerStart;
    else stack.push(el);
    i = j + 1;
  }
  const doc = root.children.find(c => typeof c === 'object');
  return doc ?? root;
}
