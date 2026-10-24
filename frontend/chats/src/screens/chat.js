// One conversation: a Claude thread, or Muse.
//
// Claude's replies read like a document: full-width markdown, no bubble. The
// owner's messages are bubbles with their delivery state (Sending → Sent →
// Seen, or Not sent with Retry). While Claude works, its steps gather in one
// live work card; pull requests and other results are cards whose state
// Claude keeps current, with buttons when it needs a decision. The composer
// grows with the text, and its send button becomes Stop while Claude works
// on this chat. Opening a chat with unread replies shows a "New" divider.

import {h, when, haptic, reducedMotion} from '../dom.js';
import {icon} from '../icons.js';
import {avatar, actionSheet, toast, onLongPress} from '../ui.js';
import {renderMarkdown, inline, shortUrl} from '../markdown.js';
import {claudeStatus, museStatus} from '../status.js';
import {MUSE, drafts, prefs} from '../store.js';
import {muse as museApi, describe} from '../api.js';

const SUGGESTIONS = ['What do you remember about Jarvis?', 'What should we build next?', 'Check the site for anything broken'];
const NEAR_BOTTOM = 120;
const PR_STATES = {open: 'Open', checks: 'Checks running', passed: 'Checks passed', failed: 'Checks failed', merged: 'Merged', closed: 'Closed'};

export class ChatScreen {
  constructor(app, key) {
    this.app = app;
    this.store = app.store;
    this.key = key;
    this.isMuse = key === MUSE;
    this.rendered = new Map(); // message id -> {sig, el}
    // Replies newer than the last visit are "new"; the divider stays put while the chat is open.
    this.readFrom = this.store.read[key] || 0;
    this.firstRender = true;

    this.el = h('section', {class: 'screen chat-screen', 'aria-label': 'Conversation'});
    this.titleEl = h('span', {class: 'chat-title'});
    this.subEl = h('span', {class: 'chat-sub', 'aria-live': 'polite'});
    this.feed = h('div', {class: 'feed', role: 'log', 'aria-label': 'Messages', 'aria-live': 'polite', 'aria-relevant': 'additions'});
    this.older = h('div', {class: 'older', 'aria-hidden': 'true'});
    this.thinkingNote = h('span', {class: 'shimmer-text'});
    this.thinking = h('div', {class: 'thinking', hidden: true, role: 'status'}, h('span', {class: 'spark'}, icon('spark', {size: 18})), this.thinkingNote);
    this.scroller = h('div', {class: 'chat-scroll'}, this.older, this.feed, this.thinking);
    this.jump = h('button', {class: 'jump', type: 'button', hidden: true, onclick: () => this.toBottom(true)}, icon('down', {size: 16}), h('span', {}, 'New messages'));
    const name = this.isMuse ? 'Message Muse' : 'Message Claude';
    this.input = h('textarea', {class: 'composer-input', rows: '1', placeholder: name, 'aria-label': name, enterkeyhint: prefs.enterSends ? 'send' : 'enter', maxlength: this.isMuse ? '4000' : '20000'});
    this.sendBtn = h('button', {class: 'send', type: 'submit', 'aria-label': 'Send', disabled: true}, icon('arrowUp', {size: 22}));
    this.composer = h('form', {class: 'composer', onsubmit: e => { e.preventDefault(); this.primary(); }},
      h('div', {class: 'composer-card'}, this.input, this.sendBtn));
    this.el.append(
      h('header', {class: 'chat-top'},
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')),
        avatar(this.isMuse ? 'muse' : 'claude'),
        h('button', {class: 'chat-heading', type: 'button', onclick: () => this.menu(), 'aria-label': 'Conversation options'}, this.titleEl, this.subEl),
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'More options', onclick: () => this.menu()}, icon('more'))),
      this.scroller, this.jump, this.composer);

    this.input.value = drafts.get(key);
    this.input.addEventListener('input', () => { this.resize(); this.renderSend(); clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => drafts.set(key, this.input.value), 300); });
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (prefs.enterSends || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); }
    });
    // The keyboard opening shrinks the page (interactive-widget=resizes-content); keep the latest message in view.
    this.input.addEventListener('focus', () => { if (this.stick) setTimeout(() => this.toBottom(), 250); });
    this.scroller.addEventListener('scroll', () => this.onScroll(), {passive: true});
    this.listeners = [
      ['messages', e => { if (e.detail === key) this.render(); }],
      ['status', () => this.renderHeader()],
      ['threads', () => this.renderHeader()],
      ['muse-state', () => this.renderHeader()],
    ];
    for (const [type, fn] of this.listeners) this.store.addEventListener(type, fn);
    this.olderObserver = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) this.loadOlder(); }, {root: this.scroller, rootMargin: '400px 0px 0px 0px'});
    this.olderObserver.observe(this.older);
    this.resizeObserver = new ResizeObserver(() => { if (this.stick) this.toBottom(); });
    this.resizeObserver.observe(this.feed);
    this.stick = true;
    this.renderHeader();
    this.render();
    if (!this.isMuse) this.store.loadThread(key);
    else this.store.museNow?.();
    requestAnimationFrame(() => this.resize());
  }

  destroy() {
    for (const [type, fn] of this.listeners) this.store.removeEventListener(type, fn);
    this.olderObserver.disconnect();
    this.resizeObserver.disconnect();
    drafts.set(this.key, this.input.value);
    if (!this.isMuse) this.store.discardIfEmpty(this.key);
  }

  get thread() { return this.isMuse ? null : this.store.threads.get(this.key); }
  get list() { return this.isMuse ? this.store.museMessages : this.store.thread(this.key); }
  get claudeHere() {
    const s = claudeStatus(this.store.status, this.store.pending);
    return {s, here: !this.isMuse && s.threadId === this.key && (s.label === 'Working' || s.label === 'Stopping')};
  }

  renderHeader() {
    if (this.isMuse) {
      const s = museStatus(this.store.museState);
      this.titleEl.textContent = 'Muse';
      this.subEl.textContent = s.detail;
      this.subEl.className = 'chat-sub tone-' + s.tone;
      this.renderSend();
      return;
    }
    this.titleEl.textContent = this.thread?.title || 'New chat';
    const {s, here} = this.claudeHere;
    this.subEl.textContent = s.tone === 'busy' && s.threadId && !here ? `Busy in another chat · ${s.detail}` : `${s.label} · ${s.detail}`;
    this.subEl.className = 'chat-sub tone-' + s.tone;
    // "Thinking": Claude has the message but no work card yet, or a fresh session is starting for it.
    const list = this.list;
    const waiting = list.some(m => m.role === 'owner' && !m.answered && !m.local) && !this.store.outbox.some(o => o.threadId === this.key);
    const lastIsWork = list.at(-1)?.kind === 'progress';
    const show = (here && !lastIsWork) || (!here && waiting && (s.label === 'Starting up' || s.label === 'Waking' || (s.tone === 'online' && list.at(-1)?.role === 'owner')));
    const wasHidden = this.thinking.hidden;
    this.thinking.hidden = !show;
    this.thinkingNote.textContent = here ? s.detail : s.label === 'Online' ? 'Reading your message…' : s.label === 'Starting up' ? 'Starting up…' : s.detail;
    if (show && wasHidden && this.stick) this.toBottom();
    // The live work card follows the status note too.
    if (here !== this.lastHere || s.detail !== this.lastDetail) { this.lastHere = here; this.lastDetail = s.detail; if (lastIsWork) this.render(); }
    this.renderSend();
  }

  /** The round button: send when there is text; Stop while Claude works here and the box is empty. */
  renderSend() {
    const text = !!this.input.value.trim();
    const {s, here} = this.claudeHere;
    const stop = here && !text;
    this.sendBtn.classList.toggle('stop', stop);
    this.sendBtn.disabled = stop ? !!s.stopping : !text;
    const label = stop ? (s.stopping ? 'Stopping' : 'Stop Claude') : 'Send';
    if (this.sendBtn.getAttribute('aria-label') !== label) {
      this.sendBtn.setAttribute('aria-label', label);
      this.sendBtn.replaceChildren(icon(stop ? 'stop' : 'arrowUp', {size: 22}));
    }
  }

  primary() {
    if (this.sendBtn.classList.contains('stop')) this.stop();
    else this.send();
  }

  async stop() {
    haptic(14);
    this.sendBtn.disabled = true;
    try {
      const stopped = await this.store.stop(this.key);
      toast(stopped ? 'Asked Claude to stop. It will finish the current step.' : 'Claude has already finished.');
    } catch (error) { toast(describe(error)); }
    this.renderSend();
  }

  render() {
    const list = this.list;
    const atBottom = this.stick;
    const fromBottom = this.scroller.scrollHeight - this.scroller.scrollTop;
    const {s, here} = this.claudeHere;
    const nodes = [];
    let lastDay = '', group = null, divided = false;
    const lastOwner = list.findLastIndex(m => m.role === 'owner');
    for (const [i, m] of list.entries()) {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDay) { nodes.push(h('div', {class: 'day', role: 'separator'}, dayLabel(m.createdAt))); lastDay = day; group = null; }
      if (!divided && this.readFrom && m.role !== 'owner' && (m.seq || 0) > this.readFrom) {
        nodes.push(this.divider = h('div', {class: 'new-divider', role: 'separator'}, 'New'));
        divided = true;
      }
      if (m.kind === 'progress') {
        if (!group) { group = {steps: []}; nodes.push(group); }
        group.steps.push(m);
        continue;
      }
      group = null;
      nodes.push(this.message(m, i > lastOwner));
    }
    const els = nodes.map((n, i) => n.steps ? this.work(n.steps, here && i === nodes.length - 1, s) : n);
    if (!list.length) els.push(this.store.threads.get(this.key)?.local || this.isMuse || list.loaded ? this.empty() : this.skeleton());
    this.feed.replaceChildren(...els);

    if (this.firstRender && list.length) {
      this.firstRender = false;
      if (this.divider?.isConnected) { this.stick = false; this.divider.scrollIntoView({block: 'start'}); }
      else this.toBottom();
    } else if (atBottom) this.toBottom();
    else this.scroller.scrollTop = this.scroller.scrollHeight - fromBottom;
    this.renderHeader();
    if (this.stick && document.visibilityState === 'visible') this.store.markRead(this.key);
    else if (!this.stick && list.at(-1)?.role !== 'owner') this.jump.hidden = false;
  }

  /** A message element, reused while it has not changed (markdown is drawn once). */
  message(m, afterLastOwner) {
    const actionable = afterLastOwner && !this.isMuse;
    const sig = [m.body, m.kind, m.local, m.failed, m.delivered, m.answered, m.seq, actionable, JSON.stringify(m.meta || null), (m.attachments || []).length].join('|');
    const cached = this.rendered.get(m.id);
    if (cached?.sig === sig) return cached.el;
    const el = m.role === 'owner' ? this.ownerMessage(m) : this.replyMessage(m, actionable);
    this.rendered.set(m.id, {sig, el});
    return el;
  }

  ownerMessage(m) {
    const bubble = h('div', {class: 'bubble'});
    m.body.split('\n').forEach((line, i) => { if (i) bubble.append(h('br')); inline(bubble, line); });
    const state = m.failed ? h('span', {class: 'state failed'}, icon('alert', {size: 14}), 'Not sent')
      : m.local ? h('span', {class: 'state'}, icon('clock', {size: 14}), 'Sending')
      : this.isMuse ? h('span', {class: 'state'}, icon('check', {size: 14}), 'Sent')
      : m.delivered || m.answered ? h('span', {class: 'state seen'}, icon('seen', {size: 14}), 'Seen')
      : h('span', {class: 'state'}, icon('check', {size: 14}), 'Sent');
    const el = h('div', {class: 'msg owner' + (m.failed ? ' failed' : ''), tabindex: '0'}, bubble,
      this.attachments(m),
      h('div', {class: 'meta'}, h('time', {}, when(m.createdAt)), ' · ', state,
        m.failed && h('button', {class: 'link-btn', type: 'button', onclick: () => this.store.retry(m.id)}, 'Retry')));
    onLongPress(el, () => this.messageMenu(m));
    return el;
  }

  replyMessage(m, actionable) {
    if (m.kind === 'card') return this.card(m, actionable);
    const options = actionable && m.kind === 'question' && Array.isArray(m.meta?.options) ? m.meta.options.slice(0, 6) : [];
    const el = h('div', {class: `msg reply kind-${m.kind || 'text'}`, tabindex: '0'},
      m.kind === 'question' && h('div', {class: 'tag'}, 'Question'),
      m.kind === 'error' && h('div', {class: 'tag danger'}, 'Problem'),
      renderMarkdown(m.body, {onCopy: () => haptic()}),
      this.attachments(m),
      options.length > 0 && h('div', {class: 'quick'}, options.map((o, i) => this.replyButton(String(o), i === 0))),
      h('div', {class: 'meta'}, h('time', {}, when(m.createdAt)),
        h('button', {class: 'icon-btn copy-btn', type: 'button', 'aria-label': 'Copy reply', onclick: () => this.copy(m.body)}, icon('copy', {size: 16}))));
    onLongPress(el, () => this.messageMenu(m));
    return el;
  }

  replyButton(text, primary) {
    return h('button', {class: 'chip' + (primary ? ' primary' : ''), type: 'button', onclick: () => { this.input.value = text; this.send(); }}, text);
  }

  /** A pull request (or other result): link, state pill, and buttons when Claude asks for a decision. */
  card(m, actionable) {
    const meta = m.meta || {};
    const url = typeof meta.url === 'string' && /^https:\/\//.test(meta.url) ? meta.url : null;
    const pr = url && /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url);
    const state = typeof meta.state === 'string' ? meta.state.toLowerCase() : null;
    const title = meta.title || m.body.split('\n')[0];
    const detail = [meta.detail || (meta.title && m.body !== meta.title ? m.body : ''), url && shortUrl(url)].filter(Boolean).join(' · ');
    const inner = [
      h('span', {class: 'card-icon'}, icon(pr ? 'pr' : 'link', {size: 20})),
      h('span', {class: 'card-text'}, h('strong', {}, title), detail && h('span', {}, detail)),
      state && h('span', {class: 'pill ' + state}, PR_STATES[state] || state),
    ];
    const actions = actionable && Array.isArray(meta.actions) && !['merged', 'closed'].includes(state) ? meta.actions.slice(0, 3) : [];
    const el = h('div', {class: 'card', tabindex: '-1'},
      url ? h('a', {class: 'card-main', href: url, target: '_blank', rel: 'noopener noreferrer'}, inner) : h('div', {class: 'card-main'}, inner),
      actions.length > 0 && h('div', {class: 'card-actions'}, actions.map((a, i) => this.replyButton(String(a), i === 0))));
    onLongPress(el, () => this.messageMenu(m));
    return el;
  }

  attachments(m) {
    if (!m.attachments?.length) return null;
    return h('div', {class: 'files'}, m.attachments.map(a => h('button', {class: 'chip file', type: 'button', onclick: () => this.openFile(m, a)}, icon('link', {size: 16}), a.name || 'File')));
  }
  async openFile(m, a) {
    try {
      const blob = await museApi.file(m.id, a.id);
      const url = URL.createObjectURL(blob);
      const link = h('a', {href: url, download: a.name || 'file', rel: 'noopener'});
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast(describe(error)); }
  }

  /** Claude's steps as one card: live (spinner, current step) while it works here, a summary after. */
  work(steps, live, s) {
    const first = steps[0].createdAt, last = steps.at(-1).createdAt;
    // While live, the newer of the last step and Claude's status note says what is happening now.
    const status = this.store.status;
    const noteIsNewer = live && status?.note && (status.lastSeen || 0) > last;
    const now = noteIsNewer ? status.note : steps.at(-1).body;
    const took = Math.max(1, Math.round(((live ? Date.now() : last) - first) / 60_000));
    const details = h('details', {class: 'work' + (live ? ' live' : '')},
      h('summary', {}, live ? h('span', {class: 'spinner', 'aria-hidden': 'true'}) : h('span', {class: 'done-mark', 'aria-hidden': 'true'}, icon('check', {size: 12})),
        h('span', {class: 'work-head'},
          h('span', {class: 'work-title'}, live ? (s.stopping ? 'Stopping…' : 'Working') : `Worked for ${took} min`),
          h('span', {class: 'work-now'}, now.split('\n')[0])),
        h('span', {class: 'work-count'}, `${steps.length} step${steps.length === 1 ? '' : 's'}`),
        h('span', {class: 'chev'}, icon('chevron', {size: 18}))),
      h('ol', {}, steps.map(st => h('li', {}, st.body, h('time', {}, when(st.createdAt))))));
    if (this.openWork?.has(steps[0].id)) details.open = true;
    details.addEventListener('toggle', () => { (this.openWork ??= new Set())[details.open ? 'add' : 'delete'](steps[0].id); });
    return details;
  }

  skeleton() {
    return h('div', {class: 'skel-reply', 'aria-label': 'Loading messages'},
      h('span', {class: 'skel bubble-skel'}),
      h('span', {class: 'skel line'}), h('span', {class: 'skel line'}), h('span', {class: 'skel line short'}));
  }

  empty() {
    if (this.isMuse) return h('div', {class: 'chat-empty'}, avatar('muse'), h('p', {class: 'empty-title'}, 'Muse'), h('p', {}, 'Your private conversation with Muse. Muse replies when it next checks in.'));
    return h('div', {class: 'chat-empty'}, avatar('claude'),
      h('p', {class: 'empty-title'}, 'What can I do for you?'),
      h('p', {}, 'Ask anything, or hand over a job on Jarvis. Changes come back as pull requests for you to approve.'),
      h('div', {class: 'quick'}, SUGGESTIONS.map(text => h('button', {class: 'chip', type: 'button', onclick: () => { this.input.value = text; this.send(); }}, text))));
  }

  send() {
    const text = this.input.value.trim();
    if (!text) return;
    haptic();
    this.store.send(this.isMuse ? MUSE : 'claude', this.key, text);
    this.input.value = '';
    drafts.set(this.key, '');
    this.resize();
    this.renderSend();
    this.toBottom(true);
  }

  async copy(text) {
    try { await navigator.clipboard.writeText(text); haptic(); toast('Copied'); } catch { toast('Copy failed'); }
  }

  resize() {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 168) + 'px';
  }

  onScroll() {
    const s = this.scroller;
    this.stick = s.scrollHeight - s.scrollTop - s.clientHeight < NEAR_BOTTOM;
    if (this.stick) { this.jump.hidden = true; if (document.visibilityState === 'visible') this.store.markRead(this.key); }
  }
  toBottom(smooth = false) {
    this.stick = true;
    this.jump.hidden = true;
    this.scroller.scrollTo({top: this.scroller.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto'});
  }

  async loadOlder() {
    if (this.isMuse || this.loadingOlder || this.store.more.get(this.key) !== true) return;
    this.loadingOlder = true;
    try { await this.store.loadOlder(this.key); } catch {} finally { this.loadingOlder = false; }
  }

  async messageMenu(m) {
    const actions = [
      {id: 'copy', label: 'Copy text', icon: 'copy'},
      m.meta?.url && {id: 'open', label: 'Open link', icon: 'open'},
      m.failed && {id: 'retry', label: 'Send again', icon: 'retry'},
      (m.failed || m.local) && {id: 'discard', label: 'Delete (not sent)', icon: 'trash', danger: true},
    ];
    const choice = await actionSheet(null, actions);
    if (choice === 'copy') this.copy(m.body);
    if (choice === 'open') open(m.meta.url, '_blank', 'noopener');
    if (choice === 'retry') this.store.retry(m.id);
    if (choice === 'discard') this.store.discard(m.id);
  }

  async menu() {
    if (this.isMuse) {
      const choice = await actionSheet('Muse', [{id: 'classic', label: 'Open classic Mast (files and tasks)', icon: 'open'}]);
      if (choice === 'classic') location.href = '/private/#mast';
      return;
    }
    this.app.chatMenu(this.key);
  }
}

function dayLabel(ms) {
  const d = new Date(ms), today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= start) return 'Today';
  if (ms >= start - 86_400_000) return 'Yesterday';
  return d.toLocaleDateString([], {weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? {year: 'numeric'} : {})});
}
