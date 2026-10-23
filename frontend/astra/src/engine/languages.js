// Language codes from containers (ISO 639-2, both bibliographic and
// terminology forms, or BCP 47) reduced to one comparable form and a name.

const names = (() => { try { return new Intl.DisplayNames(['en'], {type: 'language'}); } catch { return null; } })();

/** 'eng', 'en-US' and 'en' all become 'en'; unknown or 'und' becomes ''. */
export function baseLanguage(code) {
  const raw = String(code || '').trim();
  if (!raw || /^(und|mul|zxx|mis)$/i.test(raw)) return '';
  try { return new Intl.Locale(Intl.getCanonicalLocales(raw)[0]).language || ''; } catch { return raw.toLowerCase().slice(0, 3); }
}

/** A readable name: 'Spanish', 'Brazilian Portuguese', or '' when unknown. */
export function languageName(code) {
  const raw = String(code || '').trim();
  if (!baseLanguage(raw)) return '';
  try { return names?.of(Intl.getCanonicalLocales(raw)[0]) || raw; } catch { return raw; }
}

/** The viewer's languages in preference order, as base codes, without duplicates. */
export function preferredLanguages(list = globalThis.navigator?.languages || [globalThis.navigator?.language || 'en']) {
  return [...new Set(list.map(baseLanguage).filter(Boolean))];
}
