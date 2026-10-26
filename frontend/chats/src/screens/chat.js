// One conversation: a Claude thread, or Muse.
//
// The owner's messages sit in bubbles on the right with their time and
// delivery state (Sending → Sent → Seen, or Not sent with Retry). Claude's
// (and Muse's) turns start with an avatar and name; replies are full-width
// markdown that rise in as they arrive. While Claude works, its steps gather
// in a task card: done steps ticked, the current one live with a timer, then
// folded into a summary. Pull requests and other results are cards whose
// state Claude keeps current, with buttons when it needs a decision. The
// composer grows with the text, and its send button becomes Stop while Claude works on this chat. Opening
// a chat with unread replies shows a "New" divider.

import {h, when, haptic, reducedMotion} from '../dom.js';
import {icon} from '../icons.js';
import {actionSheet, toast, onLongPress} from '../ui.js';
import {renderMarkdown, inline, shortUrl} from '../markdown.js';
import {claudeStatus, museStatus, sigClass, CARD_STATES} from '../status.js';
import {MUSE, drafts, prefs} from '../store.js';
import {muse as museApi, chatFiles, describe, FILE_MAX} from '../api.js';
import {pushLayer} from '../back-stack.js';

const SUGGESTIONS = [['notebook', 'What do you remember about Jarvis?'], ['compose', 'What should we build next?'], ['search', 'Check the site for anything broken']];
const NEAR_BOTTOM = 120;

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
    this.printedTo = Infinity; // replies after this sequence print in (set after the first render)

    this.el = h('section', {class: 'screen chat-screen', 'aria-label': 'Conversation'});
    this.titleEl = h('span', {class: 'chat-title'});
    this.subEl = h('span', {class: 'chat-sub', 'aria-live': 'polite'});
    this.feed = h('div', {class: 'feed', role: 'log', 'aria-label': 'Messages', 'aria-live': 'polite', 'aria-relevant': 'additions'});
    this.older = h('div', {class: 'older', 'aria-hidden': 'true'});
    this.thinkingNote = h('span');
    this.thinking = h('div', {class: 'thinking', hidden: true, role: 'status'}, avatar(this.isMuse ? 'muse' : 'claude'),
      h('span', {class: 'dots', 'aria-hidden': 'true'}, h('i'), h('i'), h('i')), this.thinkingNote);
    this.scroller = h('div', {class: 'chat-scroll'}, this.older, this.feed, this.thinking);
    this.jump = h('button', {class: 'jump', type: 'button', hidden: true, onclick: () => this.toBottom(true)}, icon('down', {size: 16}), h('span', {}, 'New messages'));
    const name = this.isMuse ? 'Message Muse' : 'Message Claude';
    this.input = h('textarea', {class: 'composer-input', rows: '1', placeholder: name, 'aria-label': name, enterkeyhint: prefs.enterSends ? 'send' : 'enter', maxlength: this.isMuse ? '4000' : '20000'});
    this.sendBtn = h('button', {class: 'send', type: 'submit', 'aria-label': 'Send', disabled: true}, icon('arrowUp', {size: 22}));
    // Attachments (Claude chats): chosen files upload at once and wait in the tray until sent.
    this.pending = [];
    this.tray = h('div', {class: 'attach-tray', hidden: true, 'aria-label': 'Attachments'});
    this.fileInput = h('input', {type: 'file', multiple: true, hidden: true, onchange: () => { this.addFiles([...this.fileInput.files]); this.fileInput.value = ''; }});
    const attach = !this.isMuse && h('button', {class: 'icon-btn attach-btn', type: 'button', 'aria-label': 'Attach a photo or file', title: 'Attach', onclick: () => this.fileInput.click()}, icon('attach', {size: 22}));
    // Replying to a message: swipe it right (or long-press → Reply); the bar shows what the next message answers.
    this.quoteText = h('span', {class: 'quote-text'});
    this.quoteBar = h('div', {class: 'quote-bar', hidden: true}, icon('reply', {size: 18}), this.quoteText,
      h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Cancel reply', onclick: () => this.setQuote(null)}, icon('close', {size: 18})));
    this.composer = h('form', {class: 'composer', onsubmit: e => { e.preventDefault(); this.primary(); }},
      this.quoteBar, this.tray, this.fileInput, h('div', {class: 'composer-card' + (attach ? ' with-attach' : '')}, attach, this.input, this.sendBtn));
    this.el.append(
      h('header', {class: 'chat-top'},
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')),
        this.headAvatar = avatar(this.isMuse ? 'muse' : 'claude'),
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
    clearInterval(this.clock);
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
      this.setSub(s.tone, s.detail);
      this.renderSend();
      return;
    }
    this.titleEl.textContent = this.thread?.title || 'New chat';
    const {s, here} = this.claudeHere;
    this.setSub(s.tone, s.tone === 'busy' && s.threadId && !here ? `Busy in another chat · ${s.detail}` : `${s.label} · ${s.detail}`);
    // "Thinking": Claude has the message but no work card yet, or a fresh session is starting for it.
    const list = this.list;
    const waiting = list.some(m => m.role === 'owner' && !m.answered && !m.local) && !this.store.outbox.some(o => o.threadId === this.key);
    const lastIsWork = list.at(-1)?.kind === 'progress';
    const show = (here && !lastIsWork) || (!here && waiting && (s.label === 'Starting up' || s.label === 'Waking' || (s.tone === 'online' && list.at(-1)?.role === 'owner')));
    const wasHidden = this.thinking.hidden;
    this.thinking.hidden = !show;
    this.thinkingNote.textContent = here ? s.detail : s.label === 'Online' ? 'Reading your message' : s.label === 'Starting up' ? 'Starting up' : s.detail;
    if (show && wasHidden && this.stick) this.toBottom();
    // The live work card follows the status note too.
    if (here !== this.lastHere || s.detail !== this.lastDetail) { this.lastHere = here; this.lastDetail = s.detail; if (lastIsWork) this.render(); }
    this.renderSend();
  }

  setSub(tone, text) {
    if (this.subEl.dataset.text === tone + text) return;
    this.subEl.dataset.text = tone + text;
    this.subEl.className = 'chat-sub tone-' + tone;
    this.headAvatar.classList.toggle('busy', tone === 'busy');
    this.subEl.replaceChildren(h('span', {class: sigClass(tone), 'aria-hidden': 'true'}), h('span', {}, text));
  }

  /** The send button: send when there is text; Stop while Claude works here and the box is empty. */
  renderSend() {
    const text = !!this.input.value.trim(), files = this.pending.some(p => p.file), uploading = this.pending.some(p => p.status === 'uploading');
    const {s, here} = this.claudeHere;
    const stop = here && !text && !files;
    this.sendBtn.classList.toggle('stop', stop);
    this.sendBtn.disabled = stop ? !!s.stopping : uploading || this.pending.some(p => p.status === 'failed') || !(text || files);
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
    let lastDay = '', group = null, divided = false, speaker = null;
    const lastOwner = list.findLastIndex(m => m.role === 'owner');
    let ownerBefore = null; // the owner message just before this one, so replies to an earlier one can link back
    for (const [i, m] of list.entries()) {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDay) { nodes.push(h('div', {class: 'day', role: 'separator'}, dayLabel(m.createdAt))); lastDay = day; group = null; speaker = null; }
      if (!divided && this.readFrom && m.role !== 'owner' && (m.seq || 0) > this.readFrom) {
        nodes.push(this.divider = h('div', {class: 'new-divider', role: 'separator'}, 'New'));
        divided = true; speaker = null;
      }
      const who = m.role === 'owner' ? 'owner' : this.isMuse ? 'muse' : 'claude';
      if (who !== speaker) { if (who !== 'owner') nodes.push(this.turnHead(who, m)); speaker = who; group = null; }
      if (m.kind === 'progress') {
        if (!group) { group = {steps: []}; nodes.push(group); }
        group.steps.push(m);
        continue;
      }
      group = null;
      nodes.push(this.message(m, i > lastOwner, m.role !== 'owner' && m.replyTo && m.replyTo !== ownerBefore ? list.find(o => o.id === m.replyTo) : null));
      if (m.role === 'owner') ownerBefore = m.id;
    }
    const els = nodes.map((n, i) => n.steps ? this.work(n.steps, here && i === nodes.length - 1, s) : n);
    if (!list.length) els.push(this.store.threads.get(this.key)?.local || this.isMuse || list.loaded ? this.empty() : this.skeleton());
    this.feed.replaceChildren(...els);
    this.tick();
    const newest = Math.max(0, ...list.map(m => m.seq || 0));
    if (list.length && (this.printedTo === Infinity || newest > this.printedTo)) this.printedTo = newest;

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

  /** The start of a Claude or Muse turn: avatar, name and time. */
  turnHead(who, m) {
    return h('div', {class: 'turn-head ' + who, 'aria-hidden': 'true'}, avatar(who), h('span', {class: 'who'}, who === 'muse' ? 'Muse' : 'Claude'), h('time', {}, clock(m.createdAt)));
  }

  /** A message element, reused while it has not changed (markdown is drawn once). */
  message(m, afterLastOwner, answers = null) {
    const actionable = afterLastOwner && !this.isMuse;
    const sig = [m.body, m.kind, m.local, m.failed, m.delivered, m.answered, m.seq, actionable, JSON.stringify(m.meta || null), (m.attachments || []).length, answers?.id].join('|');
    const cached = this.rendered.get(m.id);
    if (cached?.sig === sig) return cached.el;
    const el = m.role === 'owner' ? this.ownerMessage(m) : this.replyMessage(m, actionable, answers);
    el.dataset.id = m.id;
    this.swipeToReply(el, m);
    // A reply that arrives while the chat is open prints in, once.
    if (!cached && m.role !== 'owner' && (m.seq || 0) > this.printedTo) {
      if (!reducedMotion()) el.classList.add('fresh');
      if (document.visibilityState === 'visible') haptic(8);
    }
    if (!cached && m.role === 'owner' && m.local && !reducedMotion()) el.classList.add('sent');
    this.rendered.set(m.id, {sig, el});
    return el;
  }

  ownerMessage(m) {
    const bubble = h('div', {class: 'bubble'});
    // A reply made by swiping starts with the quoted line ("> …"), shown as a quote.
    const lines = m.body.split('\n'), quoted = [];
    while (lines[0]?.startsWith('> ')) quoted.push(lines.shift().slice(2));
    if (quoted.length) { while (lines[0] === '') lines.shift(); bubble.append(h('span', {class: 'bubble-quote'}, quoted.join(' '))); }
    lines.forEach((line, i) => { if (i) bubble.append(h('br')); inline(bubble, line); });
    const state = m.failed ? h('span', {class: 'state failed'}, icon('alert', {size: 14}), 'Not sent')
      : m.local ? h('span', {class: 'state'}, icon('clock', {size: 14}), 'Sending')
      : this.isMuse ? h('span', {class: 'state'}, icon('check', {size: 14}), 'Sent')
      : m.delivered || m.answered ? h('span', {class: 'state seen'}, icon('seen', {size: 14}), 'Seen')
      : h('span', {class: 'state'}, icon('check', {size: 14}), 'Sent');
    const el = h('div', {class: 'msg owner' + (m.failed ? ' failed' : ''), tabindex: '0'}, m.body ? bubble : null,
      this.attachments(m),
      h('div', {class: 'meta'}, h('time', {}, clock(m.createdAt)), state,
        m.failed && h('button', {class: 'link-btn', type: 'button', onclick: () => this.store.retry(m.id)}, 'Retry')));
    onLongPress(el, () => this.messageMenu(m));
    return el;
  }

  replyMessage(m, actionable, answers) {
    if (m.kind === 'card') return this.card(m, actionable);
    const options = actionable && m.kind === 'question' && Array.isArray(m.meta?.options) ? m.meta.options.slice(0, 6) : [];
    const el = h('div', {class: `msg reply kind-${m.kind || 'text'}`, tabindex: '0'},
      answers && h('button', {class: 'reply-link', type: 'button', 'aria-label': 'Show the message this answers', onclick: () => this.reveal(answers.id)},
        icon('reply', {size: 14}), h('span', {}, plainLine(answers.body))),
      m.kind === 'question' && h('div', {class: 'tag'}, 'Question'),
      m.kind === 'error' && h('div', {class: 'tag danger'}, 'Problem'),
      m.body ? renderMarkdown(m.body, {onCopy: () => haptic()}) : null,
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
    const detail = meta.detail || (meta.title && m.body !== meta.title ? m.body : '');
    const ref = pr ? (([, repo, n]) => `PR #${n} · ${repo}`)(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url)) : url ? shortUrl(url) : 'Result';
    const inner = [
      h('span', {class: 'card-kicker'}, h('span', {class: 'ref'}, ref), state && h('span', {class: 'pill ' + state}, CARD_STATES[state] || state)),
      h('span', {class: 'card-title'}, title),
      detail && h('span', {class: 'card-detail'}, detail),
      checksBar(meta.progress, state),
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
    if (this.isMuse) return h('div', {class: 'files'}, m.attachments.map(a => h('button', {class: 'chip file', type: 'button', onclick: () => this.openFile(m, a)}, icon('link', {size: 16}), a.name || 'File')));
    const photos = m.attachments.filter(isPhoto), others = m.attachments.filter(a => !isPhoto(a));
    return h('div', {class: 'attachments'},
      photos.length > 0 && h('div', {class: 'shots' + (photos.length === 1 ? ' one' : '')}, photos.map(a => this.shot(a))),
      others.length > 0 && h('div', {class: 'files'}, others.map(a => h('button', {class: 'chip file', type: 'button', 'aria-label': `Save ${a.name}`, onclick: () => this.saveFile(a)},
        icon('download', {size: 16}), h('span', {class: 'file-name'}, a.name), h('span', {class: 'file-size'}, sizeLabel(a.size))))));
  }
  /** A photo in a message: loaded with the sign-in, opens full screen. */
  shot(a) {
    const img = h('img', {alt: a.name, decoding: 'async'});
    const button = h('button', {class: 'shot', type: 'button', 'aria-label': `Open ${a.name}`, onclick: () => this.view(a)}, img);
    fileURL(a.id).then(url => { img.src = url; }, () => button.classList.add('broken'));
    return button;
  }
  async view(a) {
    let url;
    try { url = await fileURL(a.id); } catch (error) { toast(describe(error)); return; }
    const opener = document.activeElement;
    let close = null;
    const done = (fromBack = false) => { if (!fromBack) close?.(); viewer.remove(); opener?.focus?.({preventScroll: true}); };
    const viewer = h('div', {class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': a.name, onclick: e => { if (e.target === viewer || e.target.tagName === 'IMG') done(); }},
      h('img', {src: url, alt: a.name}),
      h('div', {class: 'viewer-bar'},
        h('span', {class: 'viewer-name'}, a.name),
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Save', onclick: () => this.saveFile(a)}, icon('download')),
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => done()}, icon('close'))));
    viewer.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
    document.body.append(viewer);
    close = pushLayer('viewer', () => done(true));
    viewer.querySelector('[aria-label="Close"]').focus();
  }
  async saveFile(a) {
    try {
      const url = await fileURL(a.id);
      const link = h('a', {href: url, download: a.name || 'file', rel: 'noopener'});
      document.body.append(link); link.click(); link.remove();
    } catch (error) { toast(describe(error)); }
  }

  /** Files chosen for the next message: each uploads at once; the tray shows them until sent. */
  addFiles(files) {
    for (const file of files) {
      if (this.pending.length >= 10) { toast('Up to 10 attachments per message'); break; }
      if (file.size > FILE_MAX) { toast(`${file.name} is over 15 MB`); continue; }
      if (!file.size) continue;
      const item = {file, key: Math.random().toString(36).slice(2), status: 'uploading', preview: isPhoto(file) ? URL.createObjectURL(file) : null, meta: null};
      this.pending.push(item);
      this.upload(item);
    }
    this.renderTray();
  }
  async upload(item) {
    item.status = 'uploading'; this.renderTray();
    try { item.meta = await chatFiles.upload(item.file); item.status = 'ready'; }
    catch (error) { item.status = 'failed'; item.error = describe(error); }
    if (this.pending.includes(item)) this.renderTray();
  }
  removePending(item) {
    this.pending = this.pending.filter(p => p !== item);
    if (item.preview) URL.revokeObjectURL(item.preview);
    this.renderTray();
  }
  renderTray() {
    this.tray.hidden = !this.pending.length;
    this.tray.replaceChildren(...this.pending.map(item => h('div', {class: 'attach-chip ' + item.status, title: item.error || item.file.name},
      item.preview ? h('img', {src: item.preview, alt: ''}) : h('span', {class: 'attach-icon', 'aria-hidden': 'true'}, icon('attach', {size: 18})),
      h('span', {class: 'attach-name'}, item.file.name),
      item.status === 'uploading' && h('span', {class: 'attach-state', 'aria-label': 'Uploading'}, h('span', {class: 'cursor'})),
      item.status === 'failed' && h('button', {class: 'link-btn', type: 'button', onclick: () => this.upload(item)}, 'Retry'),
      h('button', {class: 'icon-btn attach-remove', type: 'button', 'aria-label': `Remove ${item.file.name}`, onclick: () => this.removePending(item)}, icon('close', {size: 16})))));
    this.renderSend();
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

  /** Claude's steps as a task card: done steps ticked, the current one live with a timer; folded into a summary once done. */
  work(steps, live, s) {
    const first = steps[0].createdAt, last = steps.at(-1).createdAt;
    // While live, the newer of the last step and Claude's status note says what is happening now.
    const status = this.store.status;
    const noteIsNewer = live && status?.note && status.note !== steps.at(-1).body && (status.lastSeen || 0) > last;
    const now = live ? (noteIsNewer ? status.note : steps.at(-1).body).split('\n')[0] : null;
    const done = live && !noteIsNewer ? steps.slice(0, -1) : steps;
    const took = Math.max(1, Math.round(((live ? Date.now() : last) - first) / 60_000));
    const count = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
    const tick = icon('check', {size: 12});
    // Only a new card rises in, and only a newly finished step pops its tick; redraws stay still.
    const seen = this.seenSteps ??= new Set(), quiet = this.firstRender;
    const fresh = id => { const was = seen.has(id); seen.add(id); return !was && !quiet ? ' fresh' : ''; };
    const cardFresh = fresh('card:' + steps[0].id);
    const list = h('ol', {class: 'steps'},
      done.map(st => h('li', {class: 'done' + fresh(st.id)}, h('span', {class: 'mark', 'aria-hidden': 'true'}, tick.cloneNode(true)), h('span', {class: 'step-text'}, st.body.split('\n')[0]), h('time', {}, clock(st.createdAt)))),
      live && h('li', {class: 'now', 'aria-current': 'step'}, h('span', {class: 'mark', 'aria-hidden': 'true'}), h('span', {class: 'step-text'}, now, h('span', {class: 'step-bar', 'aria-hidden': 'true'}, h('i')))));
    if (live) {
      return h('div', {class: 'work live' + cardFresh, role: 'group', 'aria-label': 'Claude is working'},
        h('div', {class: 'work-head'}, h('span', {class: 'work-title'}, s.stopping ? 'Stopping' : 'Working'),
          h('time', {class: 'work-timer', dataset: {from: String(first)}}, elapsed(Date.now() - first))),
        list);
    }
    const details = h('details', {},
      h('summary', {}, h('span', {class: 'mark done', 'aria-hidden': 'true'}, tick),
        h('span', {class: 'work-title'}, `Worked for ${took} min · ${count}`),
        h('span', {class: 'chev'}, icon('chevron', {size: 18}))),
      list);
    if (this.openWork?.has(steps[0].id)) details.open = true;
    details.addEventListener('toggle', () => { (this.openWork ??= new Set())[details.open ? 'add' : 'delete'](steps[0].id); });
    return h('div', {class: 'work' + cardFresh}, details);
  }
  /** The live task card's timer runs while one is on screen. */
  tick() {
    clearInterval(this.clock);
    const timer = this.feed.querySelector('.work-timer');
    if (!timer) return;
    this.clock = setInterval(() => {
      if (!timer.isConnected) { clearInterval(this.clock); return; }
      timer.textContent = elapsed(Date.now() - Number(timer.dataset.from));
    }, 1000);
  }

  skeleton() {
    return h('div', {class: 'skel-reply', 'aria-label': 'Loading messages'},
      h('span', {class: 'skel bubble-skel'}),
      h('span', {class: 'skel-head'}, h('span', {class: 'skel dot'}), h('span', {class: 'skel line short'})),
      h('span', {class: 'skel line'}), h('span', {class: 'skel line'}), h('span', {class: 'skel line short'}));
  }

  empty() {
    if (this.isMuse) return h('div', {class: 'chat-empty'}, h('p', {class: 'empty-title'}, 'Muse'), h('p', {}, 'Your private conversation with Muse. Muse replies when it next checks in.'));
    return h('div', {class: 'chat-empty'},
      h('span', {class: 'avatar claude hero', 'aria-hidden': 'true'}, h('span', {}, 'C')),
      h('p', {class: 'empty-title'}, greeting()),
      h('p', {}, 'Ask anything, or hand over a job on Jarvis. Changes come back as pull requests for you to approve.'),
      h('div', {class: 'prompts'}, SUGGESTIONS.map(([glyph, text]) => h('button', {type: 'button', onclick: () => { this.input.value = text; this.send(); }},
        h('span', {class: 'prompt-icon', 'aria-hidden': 'true'}, icon(glyph, {size: 18})), h('span', {}, text)))));
  }

  send() {
    const text = this.input.value.trim();
    if (this.pending.some(p => p.status !== 'ready')) return;
    const attachments = this.pending.map(p => p.meta);
    if (!text && !attachments.length) return;
    haptic();
    const body = this.quote && text ? `> ${this.quote}\n\n${text}` : text;
    this.setQuote(null);
    this.store.send(this.isMuse ? MUSE : 'claude', this.key, body, attachments);
    for (const p of this.pending) if (p.preview) URL.revokeObjectURL(p.preview);
    this.pending = [];
    this.renderTray();
    this.input.value = '';
    drafts.set(this.key, '');
    this.resize();
    this.renderSend();
    this.toBottom(true);
  }

  /** Reply to a message: its first line goes above the composer, and into the message as a quote. */
  setQuote(m) {
    this.quote = m ? plainLine(m.body) : null;
    this.quoteBar.hidden = !this.quote;
    this.quoteText.textContent = this.quote ? `${m.role === 'owner' ? 'You' : this.isMuse ? 'Muse' : 'Claude'}: ${this.quote}` : '';
    if (m) { haptic(10); this.input.focus(); }
  }

  /** Drag a message right to reply to it; it springs back on release. */
  swipeToReply(el, m) {
    if (m.local || m.failed) return;
    let start = null, dx = 0, dragging = false;
    const reset = () => { el.style.transform = ''; el.classList.remove('dragging'); el.style.removeProperty('--pull'); start = null; dragging = false; };
    el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && e.button === 0 && !e.target.closest('a, button, pre, .md-table')) start = {x: e.clientX, y: e.clientY}; });
    el.addEventListener('pointermove', e => {
      if (!start) return;
      const mx = e.clientX - start.x, my = e.clientY - start.y;
      if (!dragging) {
        if (Math.abs(my) > 10 || mx < -10) { start = null; return; }
        if (mx < 14) return;
        dragging = true; el.classList.add('dragging');
      }
      dx = Math.max(0, Math.min(90, mx));
      el.style.transform = `translateX(${dx * 0.8}px)`;
      el.style.setProperty('--pull', String(Math.min(1, dx / 64)));
    });
    el.addEventListener('pointerup', () => { if (dragging && dx >= 64) this.setQuote(m); reset(); });
    el.addEventListener('pointercancel', reset);
  }

  /** Scroll to a message and flash it. */
  reveal(id) {
    const target = this.feed.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!target) return;
    target.scrollIntoView({block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth'});
    target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
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
      !m.local && !m.failed && {id: 'reply', label: 'Reply', icon: 'reply'},
      {id: 'copy', label: 'Copy text', icon: 'copy'},
      m.meta?.url && {id: 'open', label: 'Open link', icon: 'open'},
      m.failed && {id: 'retry', label: 'Send again', icon: 'retry'},
      (m.failed || m.local) && {id: 'discard', label: 'Delete (not sent)', icon: 'trash', danger: true},
    ];
    const choice = await actionSheet(null, actions);
    if (choice === 'reply') this.setQuote(m);
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

/** A card's CI progress ({done, total, failed}) while its checks run: a bar and "7 of 12 checks". */
function checksBar(progress, state) {
  const total = Number(progress?.total) || 0, done = Math.min(total, Number(progress?.done) || 0), failed = Number(progress?.failed) || 0;
  if (!total || !['checks', 'failed', 'passed'].includes(state)) return null;
  const label = failed ? `${failed} of ${total} checks failed` : done === total ? `${total} of ${total} checks passed` : `${done} of ${total} checks done`;
  const fill = h('i');
  fill.style.width = Math.round(done / total * 100) + '%'; // CSSOM: the page's CSP allows no style attributes
  return h('span', {class: 'card-checks' + (failed ? ' bad' : done === total ? ' ok' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': label},
    h('span', {class: 'checks-track'}, fill), h('span', {class: 'checks-label'}, label));
}

/** A message's first line as plain text, short enough for a quote. */
function plainLine(body) {
  const line = (body || '').split('\n').find(l => l.trim() && !l.startsWith('> ')) || '';
  const text = line.replace(/[*_`#>]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  return text.length > 90 ? text.slice(0, 89) + '…' : text;
}

/** Good morning / afternoon / evening, for a new chat. */
function greeting(hour = new Date().getHours()) {
  return hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** A round avatar: Claude's gradient ring, or Muse's iris. */
function avatar(who) {
  return h('span', {class: 'avatar ' + who, 'aria-hidden': 'true'}, h('span', {}, who === 'muse' ? 'M' : 'C'));
}

/** 4:07 or 1:02:07: how long a task has run. */
function elapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 1000)), hrs = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = String(t % 60).padStart(2, '0');
  return hrs ? `${hrs}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** 14:05: the time of day, for turn heads and the work log. */
function clock(ms) {
  return ms ? new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
}

function dayLabel(ms) {
  const d = new Date(ms), today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= start) return 'Today';
  if (ms >= start - 86_400_000) return 'Yesterday';
  return d.toLocaleDateString([], {weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? {year: 'numeric'} : {})});
}

const isPhoto = a => /^image\/(png|jpe?g|gif|webp|avif|heic|heif|bmp)$/i.test(a.type || '');
function sizeLabel(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
// Attachments read with the sign-in become object URLs, once per file for the page's life.
const fileURLs = new Map();
function fileURL(id) {
  if (!fileURLs.has(id)) fileURLs.set(id, chatFiles.get(id).then(blob => URL.createObjectURL(blob), error => { fileURLs.delete(id); throw error; }));
  return fileURLs.get(id);
}
