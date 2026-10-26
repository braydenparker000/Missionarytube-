// Layers that Android Back closes (sheets, search), and the bottom sheet.
// Each open layer owns one history entry, so Back pops the top layer first
// and never leaves a stale entry behind.
import {icon} from './icons.js';

const stack = [];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

addEventListener('popstate', () => {
  const here = history.state?.mmLayer;
  while (stack.length && stack.at(-1).id !== here) {
    const layer = stack.pop();
    layer.close();
    layer.popped();
  }
});

/** Opens a layer. Returns dismiss(), which resolves once its history entry is gone. */
export function pushLayer(close) {
  const id = Math.random().toString(36).slice(2);
  let popped;
  const gone = new Promise(resolve => { popped = resolve; });
  history.pushState({...history.state, mmLayer:id}, '');
  stack.push({id, close, popped});
  return () => {
    const index = stack.findIndex(layer => layer.id === id);
    if (index < 0) return gone;
    if (history.state?.mmLayer === id) history.back();
    else { stack.splice(index, 1); close(); popped(); }
    return gone;
  };
}

export const layerOpen = () => stack.length > 0;

/**
 * A bottom sheet of actions, or of custom content. Items: {label, icon, action,
 * checked, detail, danger}. The sheet closes before an item's action runs, so
 * actions may navigate.
 */
export function openSheet({title = '', subtitle = '', items = [], content = null, className = ''}) {
  const returnFocus = document.activeElement;
  const layer = document.createElement('div');
  layer.className = 'sheet-layer ' + className;
  layer.innerHTML = `<div class="sheet-scrim"></div><div class="sheet" role="dialog" aria-modal="true"${title ? ' aria-labelledby="sheet-title"' : ' aria-label="Options"'}>` +
    `<div class="sheet-grip" aria-hidden="true"></div>` +
    (title ? `<header class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</header>` : '') +
    `<div class="sheet-body">${items.map((item, i) => `<button type="button" class="sheet-item${item.danger ? ' danger' : ''}" data-index="${i}"${item.checked !== undefined ? ` role="menuitemradio" aria-checked="${!!item.checked}"` : ''}>` +
      `${item.icon ? icon(item.icon) : '<span class="i"></span>'}<span class="sheet-label">${esc(item.label)}${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</span>${item.checked ? icon('check') : ''}</button>`).join('')}</div></div>`;
  const sheet = layer.querySelector('.sheet');
  if (content) layer.querySelector('.sheet-body').append(content);
  document.body.append(layer);
  requestAnimationFrame(() => layer.classList.add('open'));

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    layer.classList.remove('open');
    layer.classList.add('closing');
    const done = () => { layer.remove(); returnFocus?.focus?.({preventScroll:true}); };
    if (reduced()) done(); else setTimeout(done, 240);
  };
  const dismiss = pushLayer(finish);

  layer.querySelector('.sheet-scrim').addEventListener('click', () => dismiss());
  layer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      const focusable = [...sheet.querySelectorAll('button, a[href], input, select, textarea')].filter(el => !el.disabled);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  for (const button of layer.querySelectorAll('.sheet-item')) {
    button.addEventListener('click', async () => {
      const item = items[Number(button.dataset.index)];
      await dismiss();
      item.action?.();
    });
  }

  // Drag the sheet down to dismiss it.
  let start = null;
  sheet.addEventListener('pointerdown', event => {
    if (event.button > 0 || layer.querySelector('.sheet-body').scrollTop > 0 || event.target.closest('input, select, textarea')) return;
    start = {y:event.clientY, t:performance.now(), id:event.pointerId, dragging:false};
  });
  sheet.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y;
    if (!start.dragging && dy > 8) { start.dragging = true; sheet.setPointerCapture(event.pointerId); sheet.classList.add('dragging'); }
    if (start.dragging) sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
  });
  const release = event => {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y, speed = dy / Math.max(1, performance.now() - start.t);
    const dragged = start.dragging;
    start = null;
    sheet.classList.remove('dragging');
    if (!dragged) return;
    if (dy > sheet.offsetHeight * 0.3 || speed > 0.7) dismiss();
    else sheet.style.transform = '';
  };
  sheet.addEventListener('pointerup', release);
  sheet.addEventListener('pointercancel', release);

  requestAnimationFrame(() => (sheet.querySelector('.sheet-item, input, button') || sheet).focus({preventScroll:true}));
  return {dismiss, el:sheet};
}
