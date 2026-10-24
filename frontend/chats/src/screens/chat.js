// One conversation: a Claude thread, or Muse.
//
// Claude's replies are drawn as markdown across the width; the owner's are
// bubbles with their delivery state (Sending → Sent → Seen, or Not sent with
// Retry). Claude's progress notes fold into one "steps" line that shows the
// latest step while it works. Questions can carry quick replies; cards link
// pull requests and other results.

import {h, when, haptic} from '../dom.js';
import {icon} from '../icons.js';
import {avatar, actionSheet, toast, onLongPress} from '../ui.js';
import {renderMarkdown, inline, shortUrl} from '../markdown.js';
import {claudeStatus, museStatus} from '../status.js';
import {MUSE, drafts, prefs} from '../store.js';
import {muse as museApi, describe} from '../api.js';

const SUGGESTIONS = ['What do you remember about Jarvis?', 'What should we build next?', 'Check the site for anything broken'];
const NEAR_BOTTOM = 96;

export class ChatScreen {
  constructor(app, key) {
    this.app = app;
    this.store = app.store;
    this.key = key;
    this.isMuse = key === MUSE;
    this.rendered = new Map(); // message id -> {sig, el}
    this.el = h('section', {class: 'screen chat-screen', 'aria-label': 'Conversation'});
    this.titleEl = h('span', {class: 'chat-title'});
    this.subEl = h('span', {class: 'chat-sub', 'aria-live': 'polite'});
    this.feed = h('div', {class: 'feed', role: 'log', 'aria-label': 'Messages', 'aria-live': 'polite', 'aria-relevant': 'additions'});
    this.older = h('div', {class: 'older', 'aria-hidden': 'true'});
    this.typing = h('div', {class: 'typing-row', hidden: true}, h('span', {class: 'typing', 'aria-hidden': 'true'}, h('i'), h('i'), h('i')), h('span', {class: 'typing-note'}));
    this.scroller = h('div', {class: 'chat-scroll'}, this.older, this.feed, this.typing);
    this.jump = h('button', {class: 'jump', type: 'button', hidden: true, 'aria-label': 'Jump to the latest message', onclick: () => this.toBottom(true)}, icon('down'));
    this.input = h('textarea', {class: 'composer-input', rows: '1', placeholder: this.isMuse ? 'Message Muse' : 'Message Claude', 'aria-label': this.isMuse ? 'Message Muse' : 'Message Claude', enterkeyhint: prefs.enterSends ? 'send' : 'enter', maxlength: this.isMuse ? '4000' : '20000'});
    this.sendBtn = h('button', {class: 'send', type: 'submit', 'aria-label': 'Send', disabled: true}, icon('send'));
    this.composer = h('form', {class: 'composer', onsubmit: e => { e.preventDefault(); this.send(); }}, this.input, this.sendBtn);
    this.el.append(
      h('header', {class: 'chat-top'},
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')),
        avatar(this.isMuse ? 'muse' : 'claude'),
        h('button', {class: 'chat-heading', type: 'button', onclick: () => this.menu(), 'aria-label': 'Conversation options'}, this.titleEl, this.subEl),
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'More options', onclick: () => this.menu()}, icon('more'))),
      this.scroller, this.jump, this.composer);

    this.input.value = drafts.get(key);
    this.input.addEventListener('input', () => { this.resize(); this.sendBtn.disabled = !this.input.value.trim(); clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => drafts.set(key, this.input.value), 300); });
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (prefs.enterSends || e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); }
    });
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
    this.sendBtn.disabled = !this.input.value.trim();
    this.renderHeader();
    this.render();
    if (!this.isMuse) this.store.loadThread(key);
    else this.store.museNow?.();
    requestAnimationFrame(() => { this.resize(); this.toBottom(); });
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

  renderHeader() {
    if (this.isMuse) {
      const s = museStatus(this.store.museState);
      this.titleEl.textContent = 'Muse';
      this.subEl.textContent = s.detail;
      this.subEl.className = 'chat-sub tone-' + s.tone;
      return;
    }
    const t = this.thread;
    this.titleEl.textContent = t?.title || 'New chat';
    const s = claudeStatus(this.store.status, this.store.pending);
    const here = s.threadId === this.key;
    this.subEl.textContent = s.tone === 'busy' && s.threadId && !here ? `Busy in another chat · ${s.detail}` : `${s.label} · ${s.detail}`;
    this.subEl.className = 'chat-sub tone-' + s.tone;
    // The typing row: Claude is working on this thread, or a fresh session is starting for it.
    const waiting = this.list.some(m => m.role === 'owner' && !m.answered && !m.local) && !this.store.outbox.some(o => o.threadId === this.key);
    const show = here || (waiting && (s.label === 'Starting up' || s.label === 'Waking' || (s.tone === 'online' && this.list.at(-1)?.role === 'owner')));
    const wasHidden = this.typing.hidden;
    this.typing.hidden = !show;
    this.typing.querySelector('.typing-note').textContent = here ? s.detail : s.label === 'Online' ? 'Claude is reading…' : s.detail;
    if (show && wasHidden && this.stick) this.toBottom();
  }

  render() {
    const list = this.list;
    const atBottom = this.stick;
    const fromBottom = this.scroller.scrollHeight - this.scroller.scrollTop;
    const nodes = [];
    let lastDay = '', group = null;
    const lastQuestion = [...list].reverse().find(m => m.role !== 'owner' && m.kind !== 'progress');
    const lastIsQuestion = lastQuestion?.kind === 'question' && list.at(-1) === lastQuestion;
    for (const m of list) {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDay) { nodes.push(h('div', {class: 'day', role: 'separator'}, dayLabel(m.createdAt))); lastDay = day; group = null; }
      if (m.kind === 'progress') {
        if (!group) { group = {steps: []}; nodes.push(group); }
        group.steps.push(m);
        continue;
      }
      group = null;
      nodes.push(this.message(m, m === lastQuestion && lastIsQuestion));
    }
    const s = claudeStatus(this.store.status, this.store.pending);
    const els = nodes.map((n, i) => n.steps ? this.steps(n.steps, i === nodes.length - 1 && s.threadId === this.key) : n);
    if (!list.length) els.push(this.empty());
    this.feed.replaceChildren(...els);
    if (atBottom) this.toBottom();
    else this.scroller.scrollTop = this.scroller.scrollHeight - fromBottom;
    this.renderHeader();
    if (atBottom && document.visibilityState === 'visible') this.store.markRead(this.key);
    else if (!atBottom && list.at(-1)?.role !== 'owner') this.jump.hidden = false;
  }

  /** A message element, reused while it has not changed (markdown is drawn once). */
  message(m, quickReplies) {
    const sig = [m.body, m.kind, m.local, m.failed, m.delivered, m.answered, m.seq, quickReplies, JSON.stringify(m.meta || null), (m.attachments || []).length].join('|');
    const cached = this.rendered.get(m.id);
    if (cached?.sig === sig) return cached.el;
    const el = m.role === 'owner' ? this.ownerMessage(m) : this.replyMessage(m, quickReplies);
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

  replyMessage(m, quickReplies) {
    const body = m.kind === 'card' ? this.card(m) : renderMarkdown(m.body, {onCopy: () => haptic()});
    const el = h('div', {class: `msg reply kind-${m.kind || 'text'}`, tabindex: '0'},
      m.kind === 'question' && h('div', {class: 'tag'}, 'Question'),
      m.kind === 'error' && h('div', {class: 'tag danger'}, 'Problem'),
      body,
      this.attachments(m),
      quickReplies && Array.isArray(m.meta?.options) && h('div', {class: 'quick'}, m.meta.options.slice(0, 6).map(option =>
        h('button', {class: 'chip', type: 'button', onclick: () => { this.input.value = String(option); this.send(); }}, String(option)))),
      h('div', {class: 'meta'}, h('time', {}, when(m.createdAt))));
    onLongPress(el, () => this.messageMenu(m));
    return el;
  }

  card(m) {
    const meta = m.meta || {};
    const url = typeof meta.url === 'string' && /^https:\/\//.test(meta.url) ? meta.url : null;
    const pr = url && /github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url);
    const inner = [
      h('span', {class: 'card-icon'}, icon(pr ? 'pr' : 'link')),
      h('span', {class: 'card-text'},
        h('strong', {}, meta.title || m.body.split('\n')[0]),
        h('span', {}, [meta.detail || (meta.title && m.body !== meta.title ? m.body : ''), url && shortUrl(url)].filter(Boolean).join(' · '))),
      meta.state && h('span', {class: 'card-state state-' + String(meta.state).toLowerCase()}, String(meta.state)),
    ];
    return url ? h('a', {class: 'card', href: url, target: '_blank', rel: 'noopener noreferrer'}, inner) : h('div', {class: 'card'}, inner);
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

  steps(steps, live) {
    const latest = steps.at(-1);
    const details = h('details', {class: 'steps' + (live ? ' live' : '')},
      h('summary', {}, live ? h('span', {class: 'spinner', 'aria-hidden': 'true'}) : icon('check', {size: 16}),
        h('span', {class: 'steps-latest'}, latest.body.split('\n')[0]),
        steps.length > 1 && h('span', {class: 'steps-count'}, `${steps.length} steps`)),
      h('ol', {}, steps.map(s => h('li', {}, h('time', {}, when(s.createdAt)), ' ', s.body))));
    return details;
  }

  empty() {
    if (this.isMuse) return h('div', {class: 'chat-empty'}, avatar('muse'), h('p', {}, 'Your private conversation with Muse. Muse replies when it next checks in.'));
    return h('div', {class: 'chat-empty'}, avatar('claude'),
      h('p', {class: 'empty-title'}, 'What can I do for you?'),
      h('p', {}, 'I can answer questions, look into problems and change Jarvis itself. Changes come as pull requests for you to approve.'),
      h('div', {class: 'quick'}, SUGGESTIONS.map(text => h('button', {class: 'chip', type: 'button', onclick: () => { this.input.value = text; this.send(); }}, text))));
  }

  send() {
    const text = this.input.value.trim();
    if (!text) return;
    haptic();
    this.store.send(this.isMuse ? MUSE : 'claude', this.key, text);
    this.input.value = '';
    drafts.set(this.key, '');
    this.sendBtn.disabled = true;
    this.resize();
    this.toBottom(true);
  }

  resize() {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 160) + 'px';
  }

  onScroll() {
    const s = this.scroller;
    this.stick = s.scrollHeight - s.scrollTop - s.clientHeight < NEAR_BOTTOM;
    if (this.stick) { this.jump.hidden = true; if (document.visibilityState === 'visible') this.store.markRead(this.key); }
  }
  toBottom(smooth = false) {
    this.stick = true;
    this.jump.hidden = true;
    this.scroller.scrollTo({top: this.scroller.scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'});
  }

  async loadOlder() {
    if (this.isMuse || this.loadingOlder || this.store.more.get(this.key) !== true) return;
    this.loadingOlder = true;
    try { await this.store.loadOlder(this.key); } catch {} finally { this.loadingOlder = false; }
  }

  async messageMenu(m) {
    const actions = [
      {id: 'copy', label: 'Copy text', icon: 'copy'},
      m.failed && {id: 'retry', label: 'Send again', icon: 'retry'},
      (m.failed || m.local) && {id: 'discard', label: 'Delete (not sent)', icon: 'trash', danger: true},
    ];
    const choice = await actionSheet(null, actions);
    if (choice === 'copy') { try { await navigator.clipboard.writeText(m.body); toast('Copied'); } catch { toast('Copy failed'); } }
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
