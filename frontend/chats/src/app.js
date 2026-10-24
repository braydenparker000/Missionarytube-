// The app shell: the chat list underneath, and one page at a time on top
// (a conversation, the notebook or settings), sliding in from the side.
// Android back closes the top page. /chats/#muse and /chats/#t=<id> open a
// conversation directly.

import {pushLayer, startBackStack} from './back-stack.js';
import {Store, MUSE, prefs} from './store.js';
import {auth, describe} from './api.js';
import {actionSheet, prompt, toast} from './ui.js';
import {ListScreen} from './screens/list.js';
import {ChatScreen} from './screens/chat.js';
import {NotebookScreen} from './screens/notebook.js';
import {SettingsScreen} from './screens/settings.js';
import {SignInScreen} from './screens/signin.js';

export class App {
  constructor(root) {
    this.root = root;
    this.store = new Store();
    this.pages = []; // [{screen, close}]
    this.list = new ListScreen(this);
    this.signin = new SignInScreen(this);
    this.root.append(this.list.el, this.signin.el);
    this.applyPrefs();
    auth.onChange(() => this.renderAuth());
  }

  start() {
    startBackStack();
    this.renderAuth();
    this.store.start();
    const hash = location.hash;
    if (hash === '#muse' || hash === '#mast') this.openChat(MUSE);
    else if (/^#t=[0-9a-f-]{36}$/.test(hash)) this.openChat(hash.slice(3));
    if (hash) history.replaceState(history.state, '', location.pathname);
  }

  renderAuth() {
    const signedIn = auth.signedIn;
    this.signin.el.hidden = signedIn;
    this.list.el.inert = !signedIn;
    for (const p of this.pages) p.screen.el.inert = !signedIn;
    if (!signedIn) requestAnimationFrame(() => this.signin.focus());
  }

  applyPrefs() { document.documentElement.classList.toggle('large-text', !!prefs.largeText); }

  /** Opens a page on top. Each page is one back-stack entry. */
  push(screen) {
    const page = {screen};
    screen.el.classList.add('page', 'entering');
    this.root.append(screen.el);
    for (const p of this.pages) p.screen.el.inert = true;
    this.list.el.inert = true;
    requestAnimationFrame(() => requestAnimationFrame(() => screen.el.classList.remove('entering')));
    page.close = pushLayer('page', () => this.pop(page, true));
    this.pages.push(page);
    return page;
  }

  pop(page = this.pages.at(-1), fromBack = false) {
    if (!page) return;
    const i = this.pages.indexOf(page);
    if (i < 0) return;
    this.pages.splice(i, 1);
    if (!fromBack) page.close();
    page.screen.destroy?.();
    const el = page.screen.el;
    el.classList.add('leaving');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    setTimeout(() => el.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
    const top = this.pages.at(-1);
    if (top) top.screen.el.inert = false; else this.list.el.inert = !auth.signedIn;
    // Focus returns to where the page was opened from.
    (top?.screen.el.querySelector('.composer-input') || this.lastFocus)?.focus?.({preventScroll: true});
  }

  back() { this.pop(); }

  openChat(key) {
    const top = this.pages.at(-1)?.screen;
    if (top instanceof ChatScreen && top.key === key) return;
    this.lastFocus = document.activeElement;
    const screen = new ChatScreen(this, key);
    this.push(screen);
    this.store.openKey = key;
    const close = this.pages.at(-1).close;
    this.pages.at(-1).close = () => { if (this.store.openKey === key) this.store.openKey = null; close(); };
    // Focus the composer on a fresh chat; elsewhere leave the keyboard down.
    if (key !== MUSE && !this.store.thread(key).length) requestAnimationFrame(() => screen.input.focus());
  }

  newChat() {
    const thread = this.store.newThread();
    this.openChat(thread.id);
  }

  open(name) {
    this.lastFocus = document.activeElement;
    this.push(name === 'notebook' ? new NotebookScreen(this) : new SettingsScreen(this));
  }

  async chatMenu(id) {
    const t = this.store.threads.get(id);
    if (!t) return;
    const choice = await actionSheet(t.title, [
      {id: 'rename', label: 'Rename', icon: 'rename'},
      t.sessionUrl && {id: 'session', label: 'Open the session in Claude', icon: 'open'},
      {id: 'notebook', label: 'Notebook', icon: 'notebook'},
      {id: 'archive', label: t.archived ? 'Unarchive' : 'Archive', icon: t.archived ? 'unarchive' : 'archive'},
    ]);
    try {
      if (choice === 'rename') {
        const title = await prompt('Rename chat', t.title);
        if (title) await this.store.updateThread(id, {title});
      }
      if (choice === 'session') open(t.sessionUrl, '_blank', 'noopener');
      if (choice === 'notebook') this.open('notebook');
      if (choice === 'archive') {
        const archiving = !t.archived;
        await this.store.updateThread(id, {archived: archiving});
        if (!archiving) return;
        const top = this.pages.at(-1)?.screen;
        if (top instanceof ChatScreen && top.key === id) this.pop();
        toast('Chat archived', {action: {label: 'Undo', run: () => this.store.updateThread(id, {archived: false})}});
      }
    } catch (error) { toast(describe(error)); }
  }
}

