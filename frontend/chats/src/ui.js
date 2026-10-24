// Shared pieces: toast, action sheet, text prompt and long-press.

import {h, haptic} from './dom.js';
import {icon} from './icons.js';
import {pushLayer} from './back-stack.js';

let toastEl = null, toastTimer = 0;
export function toast(text, {action, ms = 3200} = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  toastEl = h('div', {class: 'toast', role: 'status'}, h('span', {}, text),
    action && h('button', {class: 'toast-action', type: 'button', onclick: () => { action.run(); toastEl?.remove(); }}, action.label));
  document.body.append(toastEl);
  toastTimer = setTimeout(() => { toastEl?.classList.add('gone'); const el = toastEl; setTimeout(() => el?.remove(), 250); }, ms);
}

/** A bottom sheet of actions. Returns a promise of the chosen action's id (or null). */
export function actionSheet(title, actions) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    let closeLayer = null, done = false;
    const finish = (value, fromBack = false) => {
      if (done) return;
      done = true;
      if (!fromBack) closeLayer?.();
      scrim.classList.add('gone');
      setTimeout(() => scrim.remove(), 220);
      opener?.focus?.({preventScroll: true});
      resolve(value);
    };
    const sheet = h('div', {class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title},
      h('div', {class: 'sheet-handle', 'aria-hidden': 'true'}),
      title && h('div', {class: 'sheet-title'}, title),
      actions.filter(Boolean).map(a => h('button', {class: 'sheet-item' + (a.danger ? ' danger' : ''), type: 'button', onclick: () => finish(a.id)}, icon(a.icon || 'more'), h('span', {}, a.label))));
    const scrim = h('div', {class: 'scrim', onclick: e => { if (e.target === scrim) finish(null); }}, sheet);
    scrim.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      if (e.key === 'Tab') trapFocus(e, sheet);
    });
    document.body.append(scrim);
    closeLayer = pushLayer('sheet', () => finish(null, true));
    sheet.querySelector('.sheet-item')?.focus();
  });
}

/** A small dialog with one text field. Resolves to the text, or null when cancelled. */
export function prompt(title, value = '', {label = 'Save', max = 120} = {}) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    let closeLayer = null, done = false;
    const field = h('input', {class: 'field', value, maxlength: String(max), 'aria-label': title, enterkeyhint: 'done'});
    const finish = (result, fromBack = false) => {
      if (done) return;
      done = true;
      if (!fromBack) closeLayer?.();
      scrim.remove();
      opener?.focus?.({preventScroll: true});
      resolve(result);
    };
    const form = h('form', {class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onsubmit: e => { e.preventDefault(); const v = field.value.trim(); if (v) finish(v); }},
      h('h2', {}, title), field,
      h('div', {class: 'dialog-actions'},
        h('button', {class: 'btn', type: 'button', onclick: () => finish(null)}, 'Cancel'),
        h('button', {class: 'btn primary', type: 'submit'}, label)));
    const scrim = h('div', {class: 'scrim center', onclick: e => { if (e.target === scrim) finish(null); }}, form);
    scrim.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } if (e.key === 'Tab') trapFocus(e, form); });
    document.body.append(scrim);
    closeLayer = pushLayer('dialog', () => finish(null, true));
    field.focus();
    field.select();
  });
}

function trapFocus(event, container) {
  const items = [...container.querySelectorAll('button, input, textarea, a[href], [tabindex="0"]')].filter(el => !el.disabled);
  if (!items.length) return;
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/** Calls `fn` on a long press (touch or mouse), a right click, or the context-menu key. */
export function onLongPress(el, fn) {
  let timer = 0, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); start = null; };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false;
    start = {x: e.clientX, y: e.clientY};
    timer = setTimeout(() => { fired = true; haptic(12); fn(e); }, 480);
  });
  el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, cancel);
  // A long press must not also count as a tap.
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); fn(e); });
  el.addEventListener('keydown', e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); fn(e); } });
}
