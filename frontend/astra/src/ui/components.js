// Shared pieces: poster cards, the long-press lift menu, bottom sheets,
// toasts and skeleton rows.

import {h, haptic, reducedMotion} from './dom.js';
import {icon} from './icons.js';
import {pushLayer} from '../app/back-stack.js';

const LONG_PRESS_MS = 450;

/** Calls onLongPress after a still press; a normal tap still clicks. Returns a cleanup. */
export function longPress(el, onLongPress) {
  let timer = 0, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); start = null; };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    fired = false; start = {x: e.clientX, y: e.clientY};
    timer = setTimeout(() => { fired = true; haptic(12); onLongPress(e); }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (!fired) { fired = true; onLongPress(e); } });
}

export function image(src, alt = '', cls = '') {
  if (!src) return h('div', {class: 'img-fallback ' + cls});
  const img = h('img', {class: cls, src, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false'});
  img.addEventListener('error', () => img.replaceWith(h('div', {class: 'img-fallback ' + cls})), {once: true});
  img.addEventListener('load', () => img.classList.add('loaded'), {once: true});
  return img;
}

/**
 * A portrait poster card. `ctx` gives watched state and the menu actions:
 * {watched: (m) => bool, onOpen(m), menu(m) => [{label, icon, run, destructive}]}
 */
export function posterCard(m, ctx) {
  const watched = ctx.watched?.(m);
  const card = h('button', {class: 'poster-card', type: 'button', onclick: () => ctx.onOpen(m)},
    h('div', {class: 'poster-art'}, image(m.poster, '', 'poster-img'), watched ? h('span', {class: 'watched-badge', 'aria-label': 'Watched'}, icon('check', {size: 12})) : null),
    h('span', {class: 'poster-title'}, m.name || ''),
    h('span', {class: 'poster-year'}, String(m.releaseInfo || m.year || '').slice(0, 9)));
  card.setAttribute('aria-label', [m.name, String(m.releaseInfo || ''), watched ? 'watched' : ''].filter(Boolean).join(', '));
  if (ctx.menu) longPress(card, () => liftMenu(card.querySelector('.poster-art'), m.name, String(m.releaseInfo || ''), ctx.menu(m)));
  return card;
}

/** Nuvio's long-press menu: the poster lifts to the centre over a blurred app. */
export function liftMenu(source, title, subtitle, actions) {
  const rect = source.getBoundingClientRect();
  const art = source.cloneNode(true);
  art.classList.add('lift-art');
  const menu = h('div', {class: 'lift-menu', role: 'menu'}, ...actions.map((a, i) => h('button', {
    class: 'lift-item' + (a.destructive ? ' destructive' : ''), type: 'button', role: 'menuitem', style: {animationDelay: `${60 + i * 35}ms`},
    onclick: () => { close(); a.run(); },
  }, a.icon ? icon(a.icon, {size: 20}) : null, a.label)));
  const layer = h('div', {class: 'lift', onclick: e => { if (e.target === layer) close(); }},
    art, h('div', {class: 'lift-text'}, h('b', {}, title || ''), subtitle ? h('span', {}, subtitle) : null), menu);
  document.body.append(layer);
  const targetW = Math.min(innerWidth * 0.6, (innerHeight * 0.44) * (rect.width / rect.height));
  const targetH = targetW * (rect.height / rect.width);
  const tx = innerWidth / 2 - targetW / 2, ty = Math.max(24, innerHeight * 0.4 - targetH / 2 - 60);
  Object.assign(art.style, {left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px'});
  const move = reducedMotion() ? 0 : 300;
  requestAnimationFrame(() => {
    layer.classList.add('open');
    art.style.transition = `all ${move}ms cubic-bezier(.2,.9,.3,1.15)`;
    Object.assign(art.style, {left: tx + 'px', top: ty + 'px', width: targetW + 'px', height: targetH + 'px'});
    layer.style.setProperty('--menu-top', (ty + targetH + 16) + 'px');
  });
  const pop = pushLayer('lift', () => close(true));
  function close(fromBack = false) {
    if (!layer.isConnected) return;
    if (!fromBack) pop();
    layer.classList.remove('open');
    art.style.transition = `all ${Math.round(move * 0.7)}ms cubic-bezier(.4,0,.2,1)`;
    Object.assign(art.style, {left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px'});
    setTimeout(() => layer.remove(), move);
  }
  menu.querySelector('button')?.focus({preventScroll: true});
  return close;
}

/** A bottom sheet with a title and rows. Back closes it. */
export function sheet(title, rows, {subtitle = ''} = {}) {
  const body = h('div', {class: 'sheet-body', role: 'dialog', 'aria-label': title},
    h('div', {class: 'sheet-handle'}), h('h3', {}, title), subtitle ? h('p', {class: 'sheet-sub'}, subtitle) : null,
    ...rows.map(r => h('button', {class: 'sheet-row' + (r.selected ? ' selected' : ''), type: 'button', disabled: r.disabled, onclick: () => { close(); r.run?.(); }},
      r.icon ? icon(r.icon, {size: 22}) : null, h('span', {}, r.label, r.detail ? h('small', {}, r.detail) : null), r.selected ? icon('check', {size: 20}) : null)));
  const layer = h('div', {class: 'sheet', onclick: e => { if (e.target === layer) close(); }}, body);
  document.body.append(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  const pop = pushLayer('sheet', () => close(true));
  // Drag down to dismiss.
  let startY = null;
  body.addEventListener('pointerdown', e => { if (e.target.closest('.sheet-handle, h3')) { startY = e.clientY; body.setPointerCapture(e.pointerId); } });
  body.addEventListener('pointermove', e => { if (startY != null) body.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`; });
  body.addEventListener('pointerup', e => { if (startY == null) return; const dy = e.clientY - startY; startY = null; body.style.transform = ''; if (dy > 80) close(); });
  function close(fromBack = false) {
    if (!layer.isConnected) return;
    if (!fromBack) pop();
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 250);
  }
  return close;
}

let toastTimer = 0;
/** A short message at the top centre. */
export function toast(text, {action = null} = {}) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div', {class: 'toast', role: 'status', 'aria-live': 'polite'}); document.body.append(el); }
  el.replaceChildren(...[h('span', {}, text), action ? h('button', {type: 'button', onclick: () => { el.classList.remove('show'); action.run(); }}, action.label) : null].filter(Boolean));
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 4000 : 2500);
}

export function skeletonRow(count = 6, {title = true, landscape = false} = {}) {
  return h('section', {class: 'row skeleton-row', 'aria-hidden': 'true'},
    title ? h('div', {class: 'row-head'}, h('div', {class: 'skeleton skeleton-title'})) : null,
    h('div', {class: 'row-scroll'}, ...Array.from({length: count}, () => h('div', {class: landscape ? 'skeleton skeleton-landscape' : 'skeleton skeleton-poster'}))));
}

export function emptyCard(title, body, action = null) {
  return h('div', {class: 'state-card'}, h('h3', {}, title), h('p', {}, body), action ? h('button', {class: 'btn primary wide', type: 'button', onclick: action.run}, action.label) : null);
}
