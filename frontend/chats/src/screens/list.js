// The first screen, read like an instrument panel: Claude's status line, then
// the desk (what Claude is doing now, and what waits on you: a pull request
// to decide on, a question), Muse pinned, then Claude's chats grouped by when
// they last moved. Swipe a chat left to archive it (Undo in the toast), or
// long-press (right-click) for Rename, Archive and Open in Claude.

import {h, when, haptic} from '../dom.js';
import {icon} from '../icons.js';
import {onLongPress, toast} from '../ui.js';
import {plain} from '../markdown.js';
import {claudeStatus, museStatus, sigClass, CARD_STATES} from '../status.js';
import {MUSE} from '../store.js';

const DAY = 86_400_000;
const SWIPE_ARCHIVE = 0.38; // of the row's width
const OPEN_CARD = ['open', 'checks', 'passed', 'failed'];

export class ListScreen {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.showArchived = false;
    this.query = '';
    this.el = h('section', {class: 'screen list-screen', 'aria-label': 'Chats'});
    this.statusEl = h('button', {class: 'status-line', type: 'button', onclick: () => app.open('settings')});
    this.rows = h('ul', {class: 'rows', role: 'list'});
    this.banner = h('div', {class: 'banner', role: 'status', hidden: true});
    this.searchInput = h('input', {type: 'search', placeholder: 'Search chats', 'aria-label': 'Search chats', enterkeyhint: 'search', autocomplete: 'off',
      oninput: () => { this.query = this.searchInput.value.trim().toLowerCase(); this.clear.hidden = !this.query; this.render(); }});
    this.clear = h('button', {class: 'icon-btn clear', type: 'button', hidden: true, 'aria-label': 'Clear search', onclick: () => { this.searchInput.value = ''; this.query = ''; this.clear.hidden = true; this.render(); this.searchInput.focus(); }}, icon('close', {size: 18}));
    this.el.append(
      h('header', {class: 'top'},
        h('h1', {class: 'wordmark'}, 'JARVIS'),
        h('div', {class: 'top-actions'},
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Notebook', title: 'Notebook', onclick: () => app.open('notebook')}, icon('notebook')),
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => app.open('settings')}, icon('settings')))),
      this.statusEl,
      h('div', {class: 'search'}, icon('search', {size: 18}), this.searchInput, this.clear),
      this.banner,
      h('div', {class: 'list-scroll'}, this.rows),
      h('button', {class: 'fab', type: 'button', onclick: () => app.newChat()}, icon('compose'), h('span', {}, 'New chat')));
    for (const type of ['threads', 'status', 'muse-state', 'connection']) this.store.addEventListener(type, () => this.render());
    this.timer = setInterval(() => this.renderStatus(), 30_000); // "last seen 5 min ago" ages
    this.render();
  }

  render() {
    this.renderBanner();
    this.renderStatus();
    const store = this.store;
    const q = this.query;
    const matches = (...texts) => !q || texts.some(t => (t || '').toLowerCase().includes(q));
    const items = [];
    const threads = store.threadList({archived: this.showArchived}).filter(t => matches(t.title, t.last?.body));
    if (!this.showArchived && !q) items.push(...this.desk(threads));
    if (!this.showArchived) {
      const museLast = store.museLast();
      if (matches('Muse', museLast?.body)) items.push(this.groupLabel('Pinned'), this.museRow());
    }
    if (!store.synced && !threads.length && !store.threads.size) items.push(...[0, 1, 2].map(() => this.skeletonRow()));
    const groups = new Map();
    for (const t of threads) {
      const label = this.showArchived ? 'Archived' : groupOf(t.updatedAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(t);
    }
    for (const [label, list] of groups) items.push(this.groupLabel(label, list.length), ...list.map(t => this.threadRow(t)));
    if (q && !items.length) items.push(h('li', {class: 'empty'}, h('p', {class: 'empty-title'}, 'No chats match'), h('p', {}, `Nothing found for “${this.searchInput.value.trim()}”.`)));
    else if (!threads.length && !this.showArchived && store.synced && !q) items.push(h('li', {class: 'empty'},
      h('p', {class: 'empty-title'}, 'Talk to Claude'),
      h('p', {}, 'Ask a question or hand over a job on Jarvis. Claude remembers what matters in its notebook, and opens pull requests for you to approve.')));
    const archivedCount = store.threadList({archived: true}).length;
    if (!q && (this.showArchived || archivedCount)) items.push(h('li', {class: 'archived-toggle'},
      h('button', {class: 'link-btn', type: 'button', onclick: () => { this.showArchived = !this.showArchived; this.render(); }},
        this.showArchived ? 'Back to chats' : `Archived (${archivedCount})`)));
    this.rows.replaceChildren(...items);
    const unread = store.totalUnread();
    document.title = unread ? `(${unread}) Chats` : 'Chats';
    try { unread ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.(); } catch {}
  }

  renderBanner() {
    const c = this.store.connection;
    const text = c === 'offline' ? 'Offline · showing saved chats' : c === 'retrying' ? 'Reconnecting…' : '';
    this.banner.hidden = !text;
    this.banner.textContent = text;
  }

  renderStatus() {
    const s = claudeStatus(this.store.status, this.store.pending);
    this.statusEl.className = 'status-line tone-' + s.tone;
    this.statusEl.setAttribute('aria-label', `Claude: ${s.label}. ${s.detail}. Open settings`);
    this.statusEl.replaceChildren(h('span', {class: sigClass(s.tone), 'aria-hidden': 'true'}),
      h('b', {}, s.label === 'Claude' ? 'Claude' : `Claude · ${s.label}`),
      // While Claude works on a chat, the desk below says on what.
      h('span', {class: 'detail'}, s.threadId && this.store.threads.has(s.threadId) && !this.showArchived ? '' : s.detail));
  }

  groupLabel(text, count) {
    return h('li', {class: 'group-label', role: 'presentation'}, h('span', {}, text), count ? h('span', {}, String(count).padStart(2, '0')) : null);
  }

  /** Now (Claude's live work) and Waiting on you (open pull requests, questions). */
  desk(threads) {
    const s = claudeStatus(this.store.status, this.store.pending);
    const busy = s.threadId && (s.label === 'Working' || s.label === 'Stopping') ? this.store.threads.get(s.threadId) : null;
    const items = [];
    if (busy) items.push(this.groupLabel('Now'), h('li', {class: 'desk'}, this.deskItem(busy, 'sig live pulse', s.detail, true)));
    const waiting = threads.filter(t => t.id !== busy?.id && needsYou(t));
    if (waiting.length) {
      items.push(this.groupLabel('Waiting on you', waiting.length));
      for (const t of waiting) {
        const c = t.card;
        const asks = c?.actions?.length > 0;
        const isCard = c && (OPEN_CARD.includes(c.state) || asks);
        const pr = isCard && /\/pull\/(\d+)/.exec(c.url || '');
        const label = isCard ? [pr ? 'PR #' + pr[1] : 'Result', CARD_STATES[c.state], asks && c.actions[0] + '?'].filter(Boolean).join(' · ') : 'Question';
        const live = !isCard || asks || c.state === 'failed';
        items.push(h('li', {class: 'desk'}, this.deskItem(t, 'sig' + (isCard && c.state === 'checks' ? ' live pulse' : live ? ' live' : ' on'), label, live)));
      }
    }
    return items;
  }

  deskItem(t, sig, label, live) {
    return h('button', {class: 'desk-item', type: 'button', onclick: () => this.app.openChat(t.id), 'aria-label': `${t.title}. ${label}`},
      h('span', {class: sig, 'aria-hidden': 'true'}),
      h('strong', {}, t.title),
      h('span', {class: 'label' + (live ? ' live' : '')}, label),
      h('span', {class: 'go', 'aria-hidden': 'true'}, icon('next', {size: 18})));
  }

  museRow() {
    const last = this.store.museLast();
    const s = museStatus(this.store.museState);
    return this.row({
      key: MUSE, title: 'Muse',
      preview: last ? (last.role === 'owner' ? 'You: ' : '') + plain(last.body, 90) : s.detail,
      at: last?.at, unread: this.store.unread(MUSE),
    });
  }

  threadRow(t) {
    const s = claudeStatus(this.store.status, this.store.pending);
    const working = s.threadId === t.id && (s.label === 'Working' || s.label === 'Stopping');
    const queued = this.store.outbox.some(o => o.threadId === t.id);
    const state = t.card?.state;
    return this.row({
      key: t.id, title: t.title, archived: !!t.archived, tag: state && t.card.url ? `PR · ${CARD_STATES[state]?.replace('Checks ', '') || state}` : null,
      preview: working ? s.detail + '…' : t.last ? (t.last.role === 'owner' ? 'You: ' : '') + (plain(t.last.body, 90) || 'Attachment') : 'No messages yet',
      at: t.updatedAt, unread: this.store.unread(t.id), working, queued,
    });
  }

  skeletonRow() {
    return h('li', {class: 'skel-row', 'aria-hidden': 'true'}, h('span', {class: 'skel line short'}), h('span', {class: 'skel line'}));
  }

  row({key, tag, title, preview, at, unread, working, queued, archived}) {
    const button = h('button', {class: 'row' + (key === MUSE ? ' muse' : '') + (unread ? ' unread' : ''), type: 'button', onclick: () => this.app.openChat(key),
      'aria-label': `${title}${unread ? `, ${unread} unread` : ''}${working ? ', Claude is working' : ''}. ${preview}`},
      h('span', {class: 'row-top'},
        h('span', {class: 'row-title'}, title),
        tag && h('span', {class: 'row-tag label'}, tag),
        h('span', {class: 'row-time'}, when(at))),
      h('span', {class: 'row-bottom'},
        queued && icon('clock', {size: 16}),
        working && h('span', {class: 'sig live pulse', 'aria-hidden': 'true'}),
        h('span', {class: 'row-preview' + (working ? ' working' : '')}, preview),
        unread ? h('span', {class: 'badge', 'aria-hidden': 'true'}, String(unread).padStart(2, '0')) : null));
    if (key === MUSE) return h('li', {}, button);
    onLongPress(button, () => this.app.chatMenu(key));
    const under = h('div', {class: 'row-under', 'aria-hidden': 'true'}, icon(archived ? 'unarchive' : 'archive', {size: 20}), archived ? 'Unarchive' : 'Archive');
    this.swipeToArchive(button, under, key, archived);
    return h('li', {class: 'row-wrap'}, under, button);
  }

  /** Drag a row left; past ~40% of its width it archives (or unarchives) on release. */
  swipeToArchive(row, under, key, archived) {
    let start = null, dx = 0, swiping = false;
    row.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.button !== 0) return;
      start = {x: e.clientX, y: e.clientY}; dx = 0; swiping = false;
    });
    row.addEventListener('pointermove', e => {
      if (!start) return;
      const mx = e.clientX - start.x, my = e.clientY - start.y;
      if (!swiping) {
        if (Math.abs(my) > 10) { start = null; return; } // a scroll
        if (mx < -12 && Math.abs(mx) > Math.abs(my) * 1.5) { swiping = true; row.setPointerCapture?.(e.pointerId); row.classList.remove('settling'); }
        else return;
      }
      dx = Math.min(0, mx);
      row.style.transform = `translateX(${dx}px)`;
      const ready = -dx > row.offsetWidth * SWIPE_ARCHIVE;
      if (ready !== under.classList.contains('ready')) { under.classList.toggle('ready', ready); if (ready) haptic(10); }
    });
    const end = () => {
      if (!start) return;
      start = null;
      if (!swiping) return;
      const done = -dx > row.offsetWidth * SWIPE_ARCHIVE;
      row.classList.add('settling');
      // A swipe is not a tap: swallow the click it may produce, but only just after it.
      const swallow = e => { e.stopImmediatePropagation(); e.preventDefault(); };
      row.addEventListener('click', swallow, {capture: true, once: true});
      setTimeout(() => row.removeEventListener('click', swallow, {capture: true}), 350);
      if (!done) { row.style.transform = ''; under.classList.remove('ready'); return; }
      row.style.transform = `translateX(-100%)`;
      setTimeout(() => this.archive(key, !archived), 200);
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', () => { start = null; if (swiping) { row.classList.add('settling'); row.style.transform = ''; under.classList.remove('ready'); } });
  }

  async archive(key, archive) {
    try {
      await this.store.updateThread(key, {archived: archive});
      toast(archive ? 'Chat archived' : 'Chat restored', {action: {label: 'Undo', run: () => this.store.updateThread(key, {archived: !archive})}});
    } catch { toast('Could not change that chat'); this.render(); }
  }
}

/** Claude spoke last, with an open pull request, a decision to make, or a question. */
function needsYou(t) {
  if (t.last?.role !== 'claude') return false;
  const c = t.card;
  if (c && !['merged', 'closed'].includes(c.state) && (OPEN_CARD.includes(c.state) || c.actions?.length)) return true;
  return t.last?.role === 'claude' && t.last.kind === 'question';
}

function groupOf(ms, now = Date.now()) {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (!ms || ms >= start) return 'Today';
  if (ms >= start - DAY) return 'Yesterday';
  if (ms >= start - 7 * DAY) return 'Previous 7 days';
  return 'Older';
}
