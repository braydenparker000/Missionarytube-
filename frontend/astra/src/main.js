// Astra's entry point.

import {App} from './app/app.js';
import {HomeScreen} from './screens/home.js';
import {SearchScreen} from './screens/search.js';
import {LibraryScreen} from './screens/library.js';
import {SettingsScreen} from './screens/settings.js';
import {DetailsScreen} from './screens/details.js';
import {StreamsScreen} from './screens/streams.js';
import {CatalogScreen} from './screens/catalog.js';
import {toast} from './ui/components.js';

const app = new App(document.getElementById('app'), {
  home: HomeScreen, search: SearchScreen, library: LibraryScreen, settings: SettingsScreen,
  details: DetailsScreen, streams: StreamsScreen, catalog: CatalogScreen,
});
window.astra = app;
app.start();

// The launch screen stays until Home has something to show, at most 5 s.
const launch = document.getElementById('launch');
const done = () => { if (!launch.isConnected) return; launch.classList.add('gone'); setTimeout(() => launch.remove(), 400); };
const home = app.views.home;
new MutationObserver((_, observer) => { if (home.querySelector('.hero-slide, .row .poster-card, .state-card')) { observer.disconnect(); done(); } }).observe(home, {childList: true, subtree: true});
setTimeout(done, 5000);

// Over https only; tests switch it on for a local server with localStorage astra.dev.sw = 1.
const workerAllowed = location.protocol === 'https:' || (() => { try { return localStorage.getItem('astra.dev.sw') === '1'; } catch { return false; } })();
if ('serviceWorker' in navigator && workerAllowed) {
  // Save what this visit loaded, so the next one opens from the saved copy.
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(registration => {
    const base = new URL('./', location.href).href;
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(base))];
    registration.active?.postMessage({type: 'astra-precache', urls});
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'astra-updated') toast('Astra has been updated', {action: {label: 'Reload', run: () => location.reload()}});
  });
}
