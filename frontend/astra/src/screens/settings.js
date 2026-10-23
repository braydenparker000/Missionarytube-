// Settings: grouped rows (Nuvio's layout), each opening a page.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {sheet, toast, emptyCard} from '../ui/components.js';
import {normaliseManifestUrl, fetchManifest} from '../addons/client.js';
import {homeCatalogs} from '../app/content.js';
import {loadPrefs, savePrefs, ORIENTATIONS} from '../player/prefs.js';
import {languageName} from '../engine/languages.js';
import {BACKUP_KEYS, restoreBackup} from '../app/store.js';

const languageLabel = code => code ? languageName(code) || code : '';

const navRow = (iconName, title, detail, run) => h('button', {class: 'set-row link', type: 'button', onclick: run},
  h('span', {class: 'set-icon'}, icon(iconName, {size: 20})), h('span', {class: 'set-text'}, h('b', {}, title), detail ? h('small', {}, detail) : null), icon('chevronRight', {size: 20}));
const switchRow = (title, detail, on, change) => {
  const input = h('input', {type: 'checkbox', role: 'switch', checked: !!on, onchange: e => change(e.target.checked)});
  return h('label', {class: 'set-row'}, h('span', {class: 'set-text'}, h('b', {}, title), detail ? h('small', {}, detail) : null), h('span', {class: 'switch'}, input, h('i')));
};
const choiceRow = (title, options, value, change) => h('div', {class: 'set-row column'}, h('span', {class: 'set-text'}, h('b', {}, title)),
  h('div', {class: 'filter-chips'}, ...options.map(([v, label]) => h('button', {class: 'chip', type: 'button', 'aria-pressed': String(v === value), onclick: () => change(v)}, label))));
const group = (label, ...rows) => h('section', {class: 'set-group'}, h('h2', {class: 'section-label'}, label), h('div', {class: 'set-card'}, ...rows.filter(Boolean)));

class Page {
  constructor(app, title, render) {
    this.app = app;
    this.body = h('div', {class: 'set-page-body'});
    this.el = h('div', {class: 'screen settings-page'}, h('header', {class: 'catalog-head'}, h('button', {class: 'round-btn small', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back', {size: 22})), h('h1', {}, title)), this.body);
    this.renderFn = render;
    this.render();
  }
  render() { this.body.replaceChildren(...[this.renderFn(this)].flat().filter(Boolean)); }
  destroy() { this.off?.(); } // a page that listens (Add-ons) stops when closed
}

export class SettingsScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.body = h('div', {class: 'settings'});
    view.append(this.body);
    this.render();
  }
  onShow() { this.render(); }
  reselect() { this.view.scrollTo({top: 0}); }

  open(title, render) { this.app.push(new Page(this.app, title, render)); }

  render() {
    const app = this.app;
    const addons = app.addons.list;
    this.body.replaceChildren(h('h1', {class: 'page-title'}, 'Settings'),
      group('General',
        navRow('aspect', 'Appearance', 'Poster size and corners', () => this.open('Appearance', p => this.appearance(p))),
        navRow('home', 'Home', 'Hero, rows and their order', () => this.open('Home', p => this.homeLayout(p))),
        navRow('sources', 'Add-ons', `${addons.filter(a => a.enabled !== false).length} active of ${addons.length}`, () => this.open('Add-ons', p => this.addons(p))),
        navRow('play', 'Playback', 'Gestures, speed, subtitles', () => this.open('Playback', p => this.playback(p)))),
      group('Content',
        switchRow('Recent searches', 'Keep the last 10 searches on this device', app.settings.recentSearches !== false, v => app.saveSettings({recentSearches: v}))),
      group('Data',
        navRow('library', 'Your data', 'Back up, restore, clear', () => this.open('Your data', p => this.data(p)))),
      group('About',
        navRow('info', 'Playback lab', 'See how a file plays on this phone', () => { location.href = 'lab/'; }),
        navRow('back', 'Classic Astra', 'The previous version, while this one settles in', () => { location.href = '../media/'; })),
      h('p', {class: 'about'}, 'Astra · new · built on the Stremio add-on protocol. Everything stays on this device.'));
  }

  appearance(page) {
    const s = this.app.settings, save = patch => { this.app.saveSettings(patch); page.render(); this.app.screens.home?.repaintBadges(); };
    return [
      group('Posters',
        choiceRow('Width', [[104, 'Compact'], [112, 'Dense'], [120, 'Standard'], [126, 'Balanced'], [134, 'Comfort'], [140, 'Large']], s.posterWidth, v => save({posterWidth: v})),
        choiceRow('Corners', [[0, 'Sharp'], [4, 'Subtle'], [8, 'Classic'], [12, 'Rounded'], [16, 'Pill']], s.posterRadius, v => save({posterRadius: v}))),
      h('div', {class: 'preview-row'}, ...['A', 'B', 'C'].map(t => h('div', {class: 'poster-card preview'}, h('div', {class: 'poster-art skeleton'}), h('span', {class: 'poster-title'}, 'Title ' + t), h('span', {class: 'poster-year'}, '2026')))),
    ];
  }

  homeLayout(page) {
    const s = this.app.settings;
    const entries = homeCatalogs(this.app.enabledAddons(), this.app.manifests);
    const hidden = new Set(s.hiddenRows || []);
    const save = patch => { this.app.saveSettings(patch); page.render(); this.app.screens.home?.load(); };
    return [
      group('Home',
        switchRow('Show hero', 'The large rotating banner at the top', s.hero !== false, v => save({hero: v})),
        switchRow('Show catalog type', 'Adds “- Movie” or “- Series” to row titles', s.showCatalogType !== false, v => save({showCatalogType: v}))),
      group('Rows', ...(entries.length ? entries.map(e => switchRow(e.title, e.addonName, !hidden.has(e.key), on => { on ? hidden.delete(e.key) : hidden.add(e.key); save({hiddenRows: [...hidden]}); })) : [h('p', {class: 'set-note'}, 'No catalogs yet. Add an add-on first.')])),
    ];
  }

  addons(page) {
    const app = this.app;
    const list = app.addons.list;
    // The list is redrawn in place, never the whole page, so the address field keeps what is typed.
    const heading = h('h2', {class: 'section-label'});
    const listSlot = h('div');
    const renderList = () => {
      heading.textContent = `Installed (${list.length})`;
      listSlot.replaceChildren(list.length ? h('div', {class: 'addon-list'}, ...list.map(card)) : emptyCard('No add-ons', 'Install one above. Cinemeta gives catalogs and details; stream add-ons give sources.'));
    };
    // Cards say Loading… until the add-ons are reloaded, then Active or why not; late answers redraw too.
    const changed = () => { app.addons.save(); const ready = app.reloadAddons(); renderList(); ready.then(renderList); app.screens.home?.load(); };
    page.off?.();
    page.off = app.onAddons(renderList);

    const input = h('input', {class: 'field', type: 'url', placeholder: 'Add-on URL', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Add-on URL'});
    const button = h('button', {class: 'btn primary', type: 'submit'}, 'Install');
    const status = h('p', {class: 'set-note', role: 'status'});
    const sameAddress = (stored, url) => { try { return normaliseManifestUrl(stored) === url; } catch { return stored === url; } };
    const already = url => list.find(a => sameAddress(a.url, url));
    let installing = false;
    const install = async () => {
      if (installing) return; // a second tap or Enter while checking
      let url;
      try { url = normaliseManifestUrl(input.value); } catch (e) { status.textContent = e.message; return; }
      if (already(url)) { status.textContent = `${already(url).name || 'That add-on'} is already installed.`; return; }
      installing = true;
      button.disabled = true;
      status.textContent = 'Checking…';
      let manifest;
      try {
        manifest = await fetchManifest(url);
        if (!manifest.id || !manifest.name || !manifest.resources.length) throw Error("That page isn't an add-on manifest.");
      } catch (e) { status.textContent = e.message || "Couldn't reach that add-on."; return; } finally { installing = false; button.disabled = false; }
      // Checked again after the wait: it may have been installed meanwhile.
      if (already(url)) { status.textContent = `${already(url).name || 'That add-on'} is already installed.`; return; }
      const done = text => { input.value = ''; status.textContent = ''; toast(text); changed(); };
      // The same add-on from another address (usually another configuration): Stremio keeps one per id, so offer to replace it.
      const twin = list.find(a => app.manifests.get(a.url)?.id === manifest.id);
      if (twin) {
        status.textContent = `${manifest.name} is already installed from another address.`;
        sheet(`Replace ${twin.name || manifest.name}?`, [
          {label: 'Replace', icon: 'replay', run: () => { if (!list.includes(twin) || already(url)) return; Object.assign(twin, {url, name: manifest.name, enabled: true}); done(`${manifest.name} replaced`); }},
          {label: 'Cancel'},
        ], {subtitle: 'It is installed from another address, perhaps with other settings. Replacing keeps its place in the list.'});
        return;
      }
      list.push({url, enabled: true, name: manifest.name});
      done(`${manifest.name} installed`);
    };
    // A form, so Enter on the keyboard installs too; the browser's URL check is off (it would refuse "host/path").
    const form = h('form', {class: 'install-row', novalidate: true, onsubmit: e => { e.preventDefault(); install(); }}, input, button);

    const card = (a, i) => {
      const manifest = app.manifests.get(a.url);
      const error = a.enabled !== false && !manifest ? app.unreachable.get(a.url) : null;
      const state = a.enabled === false ? 'Disabled' : manifest ? 'Active' : error ? "Couldn't load" : 'Loading…';
      const configurable = manifest?.behaviorHints?.configurable || manifest?.behaviorHints?.configurationRequired;
      const resources = (manifest?.resources || []).map(r => typeof r === 'string' ? r : r.name);
      return h('div', {class: 'addon-card'},
        h('div', {class: 'addon-top'}, manifest?.logo ? h('img', {class: 'addon-logo', src: manifest.logo, alt: '', referrerpolicy: 'no-referrer'}) : h('span', {class: 'addon-logo ph'}, (a.name || '?')[0]),
          h('div', {class: 'addon-name'}, h('b', {}, manifest?.name || a.name), h('small', {class: error ? 'addon-state failed' : 'addon-state'}, [manifest?.version && 'v' + manifest.version, state].filter(Boolean).join(' · '))),
          h('label', {class: 'switch'}, h('input', {type: 'checkbox', role: 'switch', checked: a.enabled !== false, 'aria-label': 'Enable ' + a.name, onchange: e => { a.enabled = e.target.checked; changed(); }}), h('i'))),
        error ? h('p', {class: 'addon-error'}, error.message || "Couldn't reach it.") : null,
        manifest?.description ? h('p', {class: 'addon-desc'}, manifest.description) : null,
        resources.length ? h('p', {class: 'addon-res'}, resources.join(' · ') + (manifest?.catalogs?.length ? ` · ${manifest.catalogs.length} catalogs` : '')) : null,
        h('div', {class: 'addon-actions'},
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; changed(); }}, h('span', {class: 'rot-up'}, icon('chevronRight', {size: 20}))),
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; changed(); }}, h('span', {class: 'rot-down'}, icon('chevronRight', {size: 20}))),
          error ? h('button', {class: 'chip', type: 'button', 'aria-label': 'Retry ' + a.name, onclick: () => { const ready = app.reloadAddons(); renderList(); ready.then(renderList); }}, 'Retry') : null,
          configurable ? h('button', {class: 'chip', type: 'button', onclick: () => open(a.url.replace(/manifest\.json$/, 'configure'), '_blank', 'noopener')}, 'Configure') : null,
          h('button', {class: 'chip danger', type: 'button', onclick: () => sheet(`Remove ${a.name}?`, [{label: 'Remove', icon: 'close', run: () => { list.splice(list.indexOf(a), 1); changed(); toast(`${a.name} removed`); }}, {label: 'Cancel'}])}, 'Remove')));
    };
    renderList();
    return [group('Install', h('div', {class: 'set-row column'}, form, status)), heading, listSlot];
  }

  playback(page) {
    const p = loadPrefs();
    const save = patch => { Object.assign(p, patch); savePrefs(p); if (this.app.player) Object.assign(this.app.player.prefs, patch); page.render(); };
    return [
      group('Player',
        switchRow('Touch gestures', 'Double tap to seek, swipe for seek, brightness and volume, hold for speed', p.gestures, v => save({gestures: v})),
        choiceRow('Hold speed', [[1.25, '1.25x'], [1.5, '1.5x'], [2, '2x'], [3, '3x']], p.holdSpeed, v => save({holdSpeed: v})),
        switchRow('Pause overlay', 'Show the title and story after 5 s paused', p.pauseOverlay, v => save({pauseOverlay: v})),
        choiceRow('Picture size', [['fit', 'Fit'], ['fill', 'Fill'], ['zoom', 'Zoom']], p.aspect, v => save({aspect: v})),
        choiceRow('Rotation', ORIENTATIONS, p.orientation, v => save({orientation: v})),
        switchRow('Picture-in-picture', 'Keep watching in a small window when you leave Astra, where Chrome allows it. The player’s top bar has a button for it too.', p.autoPip, v => save({autoPip: v}))),
      group('Subtitles',
        switchRow('OpenSubtitles', 'Also look for subtitles on OpenSubtitles, Stremio’s subtitle add-on, as well as your installed add-ons', this.app.settings.openSubtitles !== false, v => { this.app.saveSettings({openSubtitles: v}); page.render(); })),
      group('Languages',
        h('p', {class: 'set-note'}, `Audio: ${languageLabel(p.audioLanguage) || 'your phone’s language'} · Subtitles: ${languageLabel(p.subtitleLanguage) || 'off'}. Astra remembers what you pick in the player and shows subtitles in that language by itself.`),
        h('button', {class: 'set-row', type: 'button', onclick: () => save({audioLanguage: '', subtitleLanguage: ''})}, h('span', {class: 'set-text'}, h('b', {}, 'Forget my language choices')))),
      h('p', {class: 'set-note'}, 'Subtitle size, colour, background and position are set from the subtitles menu while watching.'),
    ];
  }

  data(page) {
    const app = this.app;
    const exportData = () => {
      const blob = new Blob([JSON.stringify({astra: 'backup/1', at: new Date().toISOString(), data: Object.fromEntries(BACKUP_KEYS.map(k => [k, app.store.get(k, null)]))}, null, 1)], {type: 'application/json'});
      const a = h('a', {href: URL.createObjectURL(blob), download: `astra-backup-${new Date().toISOString().slice(0, 10)}.json`});
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    // Restore and copy-again freeze storage before reloading, so nothing this window still holds is saved over them.
    const file = h('input', {type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
      const chosen = e.target.files[0];
      e.target.value = ''; // the same file can be chosen again
      if (!chosen) return;
      const text = await chosen.text().catch(() => null);
      if (text == null) { toast('That file could not be read.'); return; }
      const result = restoreBackup(app.store, text);
      if (!result.ok) { toast(result.message); return; }
      toast(`${result.message} Reloading…`);
      setTimeout(() => location.reload(), 1200);
    }});
    const copyAgain = () => { for (const k of ['imported', 'addons', 'library', 'progress']) app.store.remove(k); app.store.freeze(); location.reload(); };
    return [
      group('Backup',
        h('button', {class: 'set-row', type: 'button', onclick: exportData}, h('span', {class: 'set-text'}, h('b', {}, 'Export a backup'), h('small', {}, 'Add-ons, library, progress and settings as a file'))),
        h('button', {class: 'set-row', type: 'button', onclick: () => file.click()}, h('span', {class: 'set-text'}, h('b', {}, 'Restore from a backup'), h('small', {}, 'Replaces what is on this device'))), file),
      group('Clear',
        h('button', {class: 'set-row danger', type: 'button', onclick: () => sheet('Clear Continue Watching?', [{label: 'Clear', icon: 'close', run: () => { app.progress.clear(); toast('Continue Watching cleared'); }}, {label: 'Cancel'}])}, h('span', {class: 'set-text'}, h('b', {}, 'Clear Continue Watching'))),
        h('button', {class: 'set-row', type: 'button', onclick: () => sheet('Copy again from classic Astra?', [{label: 'Copy add-ons, library and progress', run: copyAgain}, {label: 'Cancel'}], {subtitle: 'Replaces what the new Astra has with what classic Astra has now.'})}, h('span', {class: 'set-text'}, h('b', {}, 'Copy again from classic Astra')))),
    ];
  }
}
