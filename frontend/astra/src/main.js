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
import {showRecovery} from './app/recovery.js';

const root = document.getElementById('app');
let app = null;
try {
  app = new App(root, {
    home: HomeScreen, search: SearchScreen, library: LibraryScreen, settings: SettingsScreen,
    details: DetailsScreen, streams: StreamsScreen, catalog: CatalogScreen,
  });
  window.astra = app;
  app.start();
} catch (error) {
  // Never leave the launch screen spinning: offer to export or reset what is saved.
  console.error(error);
  app = null;
  showRecovery(root, error);
}

// The launch screen gives way as soon as Home draws anything, its placeholders
// included: the app's own skeleton says "loading" better than a spinner.
const launch = document.getElementById('launch');
const done = () => { if (!launch.isConnected) return; launch.classList.add('gone'); setTimeout(() => launch.remove(), 250); };
if (app) {
  const home = app.views.home, drawn = () => home.querySelector('.hero, .row, .state-card');
  if (drawn()) requestAnimationFrame(done);
  else new MutationObserver((_, observer) => { if (drawn()) { observer.disconnect(); done(); } }).observe(home, {childList: true, subtree: true});
  setTimeout(done, 5000);
} else done();

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
