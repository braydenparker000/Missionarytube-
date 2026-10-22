// Music import (technical necessity): a browser page cannot scan device
// storage, so the reference's Music Folders selection becomes a file/folder
// picker. Shown on first run when the library is empty, and on request
// (bus_gui cmd_library_import). Titles use the reference's strings.

export function installImport(ctx, root) {
  const res = ctx.res, theme = ctx.theme;
  const str = (name, fallback) => res.stringByName?.(name, theme) ?? fallback;
  const panel = document.createElement('div');
  panel.className = 'cp-import';
  panel.hidden = true;
  const title = document.createElement('div');
  title.className = 'cp-import-title';
  title.textContent = str('pref_select_folders', 'Music Folders');
  const msg = document.createElement('div');
  msg.className = 'cp-import-msg';
  msg.textContent = str('music_folders_selection', 'Music folders selection');
  const row = document.createElement('div');
  row.className = 'cp-import-row';
  const mk = (label, dir) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.className = 'cp-file';
    if (dir) input.webkitdirectory = true;
    else input.accept = 'audio/*,.flac,.opus,.ogg,.m4a,.lrc';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cp-import-btn';
    b.textContent = label;
    b.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;
      row.hidden = true;
      const added = await ctx.library.importFiles(files, (n, total) => { msg.textContent = `${n} / ${total}`; });
      msg.textContent = str('music_folders_found_d', 'Found: %d').replace('%d', String(added));
      row.hidden = false;
      if (ctx.library.tracks.length) {
        panel.hidden = true;
        ctx.player.setQueue(ctx.library.tracks, 0);
      }
    });
    row.append(b, input);
  };
  mk('Folder', true);
  mk('Files', false);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cp-import-btn cp-import-close';
  close.textContent = str('close', 'Close');
  close.addEventListener('click', () => { panel.hidden = true; });
  panel.append(title, msg, row, close);
  root.appendChild(panel);
  ctx.bus.subscribe('bus_gui', m => { if (m === 'cmd_library_import') panel.hidden = false; });
  return {show: () => { panel.hidden = false; }, hide: () => { panel.hidden = true; }};
}
