// The first screen: Muse pinned on top, then Claude's chats, newest first.
// Long-press (or right-click) a chat for Rename, Archive and Open in Claude.

import {h, when} from '../dom.js';
import {icon} from '../icons.js';
import {avatar, onLongPress} from '../ui.js';
import {plain} from '../markdown.js';
import {claudeStatus, museStatus} from '../status.js';
import {MUSE} from '../store.js';

export class ListScreen {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.showArchived = false;
    this.el = h('section', {class: 'screen list-screen', 'aria-label': 'Chats'});
    this.statusEl = h('button', {class: 'status-card', type: 'button', onclick: () => app.open('settings')});
    this.rows = h('ul', {class: 'rows', role: 'list'});
    this.banner = h('div', {class: 'banner', role: 'status', hidden: true});
    this.el.append(
      h('header', {class: 'top'},
        h('h1', {}, 'Chats'),
        h('div', {class: 'top-actions'},
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Notebook', title: 'Notebook', onclick: () => app.open('notebook')}, icon('notebook')),
          h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => app.open('settings')}, icon('settings')))),
      this.banner,
      h('div', {class: 'list-scroll'}, this.statusEl, this.rows),
      h('button', {class: 'fab', type: 'button', onclick: () => app.newChat()}, icon('compose'), h('span', {}, 'New chat')));
    for (const type of ['threads', 'status', 'muse-state', 'connection']) this.store.addEventListener(type, () => this.render());
    this.timer = setInterval(() => this.renderStatus(), 30_000); // "last seen 5 min ago" ages
    this.render();
  }

  render() {
    this.renderBanner();
    this.renderStatus();
    const store = this.store;
    const items = [];
    if (!this.showArchived) items.push(this.museRow());
    const threads = store.threadList({archived: this.showArchived});
    for (const t of threads) items.push(this.threadRow(t));
    if (!threads.length && !this.showArchived) items.push(h('li', {class: 'empty'},
      h('p', {class: 'empty-title'}, 'Talk to Claude'),
      h('p', {}, 'Ask a question or hand over a job on Jarvis. Claude remembers what matters in its notebook, and can open pull requests for you to merge.')));
    const archivedCount = store.threadList({archived: true}).length;
    if (this.showArchived || archivedCount) items.push(h('li', {class: 'archived-toggle'},
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
    const working = s.threadId && this.store.threads.get(s.threadId);
    this.statusEl.className = 'status-card tone-' + s.tone;
    this.statusEl.setAttribute('aria-label', `Claude: ${s.label}. ${s.detail}. Open settings`);
    this.statusEl.replaceChildren(avatar('claude'),
      h('span', {class: 'status-text'}, h('strong', {}, 'Claude · ', s.label), h('span', {}, working ? `${s.detail} · ${working.title}` : s.detail)),
      h('span', {class: 'dot', 'aria-hidden': 'true'}));
  }

  museRow() {
    const last = this.store.museLast();
    const s = museStatus(this.store.museState);
    return this.row({
      key: MUSE, who: 'muse', title: 'Muse', pinned: true,
      preview: last ? (last.role === 'owner' ? 'You: ' : '') + plain(last.body, 90) : s.detail,
      at: last?.at, unread: this.store.unread(MUSE),
    });
  }

  threadRow(t) {
    const s = claudeStatus(this.store.status, this.store.pending);
    const queued = this.store.outbox.some(o => o.threadId === t.id);
    return this.row({
      key: t.id, who: 'claude', title: t.title,
      preview: s.threadId === t.id ? s.detail + '…' : t.last ? (t.last.role === 'owner' ? 'You: ' : '') + plain(t.last.body, 90) : 'No messages yet',
      at: t.updatedAt, unread: this.store.unread(t.id), working: s.threadId === t.id, queued,
    });
  }

  row({key, who, title, preview, at, unread, pinned, working, queued}) {
    const button = h('button', {class: 'row' + (unread ? ' unread' : ''), type: 'button', onclick: () => this.app.openChat(key),
      'aria-label': `${title}${unread ? `, ${unread} unread` : ''}${working ? ', Claude is working' : ''}. ${preview}`},
      avatar(who),
      h('span', {class: 'row-main'},
        h('span', {class: 'row-top'}, h('span', {class: 'row-title'}, title), pinned && h('span', {class: 'pin', title: 'Pinned'}, 'Pinned'), h('span', {class: 'row-time'}, when(at))),
        h('span', {class: 'row-bottom'},
          working && h('span', {class: 'typing small', 'aria-hidden': 'true'}, h('i'), h('i'), h('i')),
          queued && icon('clock', {size: 16}),
          h('span', {class: 'row-preview'}, preview),
          unread ? h('span', {class: 'badge'}, String(unread)) : null)));
    if (key !== MUSE) onLongPress(button, () => this.app.chatMenu(key));
    return h('li', {}, button);
  }
}
