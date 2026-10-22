// Search history (kj1 "search_history"; notebook F64). Each result set the
// search delivers records its query: a query that extends a stored term
// replaces that term (the term is a prefix of it, and it is not a prefix of
// the term), a query some stored term already extends adds nothing, any
// other query is added. The empty search lists the 16 newest terms.
const STORE = 'cp-search-history';
const MAX_SHOWN = 16;

function load() {
  try { const v = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(v) ? v.filter(e => typeof e?.term === 'string') : []; } catch { return []; }
}

function save(list) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

const starts = (s, p) => s.toLowerCase().startsWith(p.toLowerCase());

/** The terms to show, newest first. */
export function searchHistory() {
  return load().sort((a, b) => b.at - a.at).slice(0, MAX_SHOWN).map(e => e.term);
}

export function recordSearch(term) {
  if (!term) return;
  const list = load(), now = Date.now();
  let updated = false;
  for (const e of list) {
    if (starts(term, e.term) && !starts(e.term, term)) { e.term = term; e.at = now; updated = true; }
  }
  if (!updated && !list.some(e => starts(e.term, term))) list.push({term, at: now});
  // Merged entries can meet on the same term: keep one.
  const seen = new Set();
  save(list.sort((a, b) => b.at - a.at).filter(e => { const k = e.term.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }));
}

export function removeSearch(term) {
  save(load().filter(e => e.term !== term));
}

export function clearSearchHistory() {
  save([]);
}
