// Jarvis Chats' entry point.

import {App} from './app.js';
import {toast} from './ui.js';

const app = new App(document.getElementById('app'));
window.chats = app;
app.start();
document.getElementById('launch')?.remove();

// Over https only; tests switch it on for a local server with localStorage chats.dev.sw = 1.
const workerAllowed = location.protocol === 'https:' || (() => { try { return localStorage.getItem('chats.dev.sw') === '1'; } catch { return false; } })();
if ('serviceWorker' in navigator && workerAllowed) {
  // Save what this visit loaded, so the next one opens from the saved copy, offline too.
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(registration => {
    const base = new URL('./', location.href).href;
    const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(base))];
    registration.active?.postMessage({type: 'chats-precache', urls});
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'chats-updated') toast('Chats has been updated', {action: {label: 'Reload', run: () => location.reload()}, ms: 10_000});
  });
}
