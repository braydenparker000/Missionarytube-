// Astra's entry point.

import {App} from './app/app.js';
import {HomeScreen} from './screens/home.js';
import {SearchScreen} from './screens/search.js';
import {LibraryScreen} from './screens/library.js';
import {SettingsScreen} from './screens/settings.js';
import {DetailsScreen} from './screens/details.js';
import {StreamsScreen} from './screens/streams.js';
import {CatalogScreen} from './screens/catalog.js';

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

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
