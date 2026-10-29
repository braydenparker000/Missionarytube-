// /export/: this phone's app data for the Thunderhead, as one file the owner carries over
// (Thunderhead MIGRATION.md §5.3). It reads only; nothing leaves the phone but the download.
import {collect, countLines} from './phone-data.js';

const list = document.querySelector('#counts'), button = document.querySelector('#download'), note = document.querySelector('#note');
const label = /Android/.test(navigator.userAgent) ? 'Android phone' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'This device';
let data = null;
try {
  data = await collect(label);
  list.replaceChildren(...countLines(data.counts).map(text => Object.assign(document.createElement('li'), {textContent: text})));
  button.disabled = false;
} catch (error) {
  list.replaceChildren();
  note.textContent = `Couldn't read this phone's app data: ${error?.message || error}`;
}
button.addEventListener('click', () => {
  if (!data) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: `thunderhead-phone-export-${data.exported_at.slice(0, 10)}.json`});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  note.textContent = 'Saved. Now open it on the Thunderhead: Settings → Account → Bring data from the old site.';
});
