// Settings: grouped rows (Nuvio's layout), each opening a page.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {sheet, toast, emptyCard} from '../ui/components.js';
import {normaliseManifestUrl, getJson} from '../addons/client.js';
import {homeCatalogs} from '../app/content.js';
import {loadPrefs, savePrefs} from '../player/prefs.js';

const navRow = (iconName, title, detail, run) => h('button', {class: 'set-row nav', type: 'button', onclick: run},
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
        navRow('back', 'Classic Astra', 'The previous version, until this one replaces it', () => { location.href = '../media/'; })),
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
    const changed = () => { app.addons.save(); app.reloadAddons(); app.screens.home?.load(); page.render(); };
    const input = h('input', {class: 'field', type: 'url', placeholder: 'https://…/manifest.json or stremio://…', autocomplete: 'off', 'aria-label': 'Add-on address'});
    const status = h('p', {class: 'set-note', role: 'status'});
    const install = async () => {
      let url;
      try { url = normaliseManifestUrl(input.value); } catch (e) { status.textContent = e.message; return; }
      if (list.some(a => a.url === url)) { status.textContent = 'That add-on is already installed.'; return; }
      status.textContent = 'Checking…';
      try {
        const manifest = await getJson(url);
        if (!manifest?.id || !manifest.name || !Array.isArray(manifest.resources)) throw Error('That address is not a Stremio add-on.');
        list.push({url, enabled: true, name: manifest.name});
        input.value = '';
        toast(`${manifest.name} installed`);
        changed();
      } catch (e) { status.textContent = e.message || 'Could not reach that add-on.'; }
    };
    const card = (a, i) => {
      const manifest = app.manifests.get(a.url);
      const configurable = manifest?.behaviorHints?.configurable || manifest?.behaviorHints?.configurationRequired;
      const resources = (manifest?.resources || []).map(r => typeof r === 'string' ? r : r.name);
      return h('div', {class: 'addon-card'},
        h('div', {class: 'addon-top'}, manifest?.logo ? h('img', {class: 'addon-logo', src: manifest.logo, alt: '', referrerpolicy: 'no-referrer'}) : h('span', {class: 'addon-logo ph'}, (a.name || '?')[0]),
          h('div', {class: 'addon-name'}, h('b', {}, manifest?.name || a.name), h('small', {}, [manifest?.version && 'v' + manifest.version, a.enabled === false ? 'Disabled' : manifest ? 'Active' : 'Unavailable'].filter(Boolean).join(' · '))),
          h('label', {class: 'switch'}, h('input', {type: 'checkbox', role: 'switch', checked: a.enabled !== false, 'aria-label': 'Enable ' + a.name, onchange: e => { a.enabled = e.target.checked; changed(); }}), h('i'))),
        manifest?.description ? h('p', {class: 'addon-desc'}, manifest.description) : null,
        resources.length ? h('p', {class: 'addon-res'}, resources.join(' · ') + (manifest?.catalogs?.length ? ` · ${manifest.catalogs.length} catalogs` : '')) : null,
        h('div', {class: 'addon-actions'},
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; changed(); }}, h('span', {class: 'rot-up'}, icon('chevronRight', {size: 20}))),
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Move down', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; changed(); }}, h('span', {class: 'rot-down'}, icon('chevronRight', {size: 20}))),
          configurable ? h('button', {class: 'chip', type: 'button', onclick: () => open(a.url.replace(/manifest\.json$/, 'configure'), '_blank', 'noopener')}, 'Configure') : null,
          h('button', {class: 'chip danger', type: 'button', onclick: () => sheet(`Remove ${a.name}?`, [{label: 'Remove', icon: 'close', run: () => { list.splice(i, 1); changed(); toast(`${a.name} removed`); }}, {label: 'Cancel'}])}, 'Remove')));
    };
    return [
      group('Install', h('div', {class: 'set-row column'}, h('div', {class: 'install-row'}, input, h('button', {class: 'btn primary', type: 'button', onclick: install}, 'Install')), status)),
      h('h2', {class: 'section-label'}, `Installed (${list.length})`),
      list.length ? h('div', {class: 'addon-list'}, ...list.map(card)) : emptyCard('No add-ons', 'Install one above. Cinemeta gives catalogs and details; stream add-ons give sources.'),
    ];
  }

  playback(page) {
    const p = loadPrefs();
    const save = patch => { Object.assign(p, patch); savePrefs(p); if (this.app.player) Object.assign(this.app.player.prefs, patch); page.render(); };
    return [
      group('Player',
        switchRow('Touch gestures', 'Double tap to seek, swipe for seek, brightness and volume, hold for speed', p.gestures, v => save({gestures: v})),
        choiceRow('Hold speed', [[1.25, '1.25x'], [1.5, '1.5x'], [2, '2x'], [3, '3x']], p.holdSpeed, v => save({holdSpeed: v})),
        switchRow('Pause overlay', 'Show the title and story after 5 s paused', p.pauseOverlay, v => save({pauseOverlay: v})),
        choiceRow('Picture size', [['fit', 'Fit'], ['fill', 'Fill'], ['zoom', 'Zoom']], p.aspect, v => save({aspect: v}))),
      group('Languages',
        h('p', {class: 'set-note'}, `Audio: ${p.audioLanguage || 'your phone’s language'} · Subtitles: ${p.subtitleLanguage || 'off'}. Astra remembers what you pick in the player.`),
        h('button', {class: 'set-row', type: 'button', onclick: () => save({audioLanguage: '', subtitleLanguage: ''})}, h('span', {class: 'set-text'}, h('b', {}, 'Forget my language choices')))),
      h('p', {class: 'set-note'}, 'Subtitle size, colour, background and position are set from the subtitles menu while watching.'),
    ];
  }

  data(page) {
    const app = this.app;
    const keys = ['addons', 'library', 'progress', 'watched', 'settings', 'recentSearches'];
    const exportData = () => {
      const blob = new Blob([JSON.stringify({astra: 'backup/1', at: new Date().toISOString(), data: Object.fromEntries(keys.map(k => [k, app.store.get(k, null)]))}, null, 1)], {type: 'application/json'});
      const a = h('a', {href: URL.createObjectURL(blob), download: `astra-backup-${new Date().toISOString().slice(0, 10)}.json`});
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const file = h('input', {type: 'file', accept: 'application/json', hidden: true, onchange: async e => {
      try {
        const backup = JSON.parse(await e.target.files[0].text());
        if (backup?.astra !== 'backup/1') throw Error('Not an Astra backup.');
        for (const k of keys) if (backup.data?.[k] != null) app.store.set(k, backup.data[k]);
        toast('Restored. Reloading…');
        setTimeout(() => location.reload(), 800);
      } catch (err) { toast(err.message || 'That file could not be read.'); }
    }});
    return [
      group('Backup',
        h('button', {class: 'set-row', type: 'button', onclick: exportData}, h('span', {class: 'set-text'}, h('b', {}, 'Export a backup'), h('small', {}, 'Add-ons, library, progress and settings as a file'))),
        h('button', {class: 'set-row', type: 'button', onclick: () => file.click()}, h('span', {class: 'set-text'}, h('b', {}, 'Restore from a backup'), h('small', {}, 'Replaces what is on this device'))), file),
      group('Clear',
        h('button', {class: 'set-row danger', type: 'button', onclick: () => sheet('Clear Continue Watching?', [{label: 'Clear', icon: 'close', run: () => { app.progress.entries = {}; app.progress.flush(true); toast('Continue Watching cleared'); }}, {label: 'Cancel'}])}, h('span', {class: 'set-text'}, h('b', {}, 'Clear Continue Watching'))),
        h('button', {class: 'set-row', type: 'button', onclick: () => sheet('Copy again from classic Astra?', [{label: 'Copy add-ons, library and progress', run: () => { for (const k of ['imported', 'addons', 'library', 'progress']) app.store.set(k, null); location.reload(); }}, {label: 'Cancel'}], {subtitle: 'Replaces what the new Astra has with what classic Astra has now.'})}, h('span', {class: 'set-text'}, h('b', {}, 'Copy again from classic Astra')))),
    ];
  }
}
