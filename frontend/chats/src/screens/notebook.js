// Claude's notebook: what it remembers about the owner and Jarvis. Claude
// reads it at the start of every session and keeps it current; the owner
// can read and correct it here. Saving is refused if Claude changed it
// meanwhile, so neither side overwrites the other unseen.

import {h, ago} from '../dom.js';
import {icon} from '../icons.js';
import {toast} from '../ui.js';
import {renderMarkdown} from '../markdown.js';
import {describe} from '../api.js';

export class NotebookScreen {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.note = null;
    this.editing = false;
    this.el = h('section', {class: 'screen page-screen', 'aria-label': 'Notebook'});
    this.body = h('div', {class: 'page-body'});
    this.action = h('button', {class: 'btn small', type: 'button', onclick: () => this.toggle(), disabled: true}, 'Edit');
    this.el.append(
      h('header', {class: 'chat-top'},
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')),
        h('h1', {class: 'page-title'}, 'Notebook'), this.action),
      h('div', {class: 'page-scroll'}, this.body));
    this.store.addEventListener('notebook', () => { if (!this.editing) this.load(); });
    this.load();
  }

  async load() {
    if (!this.note) this.body.replaceChildren(h('p', {class: 'muted'}, 'Opening the notebook…'));
    try {
      this.note = (await this.store.notebook()).notebook;
      this.action.disabled = false;
      this.show();
    } catch (error) {
      this.body.replaceChildren(h('p', {class: 'muted'}, describe(error)), h('button', {class: 'btn', type: 'button', onclick: () => this.load()}, 'Try again'));
    }
  }

  show() {
    const n = this.note;
    this.editing = false;
    this.action.textContent = 'Edit';
    this.body.replaceChildren(
      h('p', {class: 'muted intro'}, 'What Claude remembers about you and Jarvis. Claude reads this at the start of every session and keeps it up to date. Correct anything here.'),
      n.body ? renderMarkdown(n.body) : h('p', {class: 'muted'}, 'Empty so far. Claude fills it in as you talk.'),
      n.updatedAt && h('p', {class: 'muted small'}, `Version ${n.version} · updated ${ago(n.updatedAt)} by ${n.by === 'owner' ? 'you' : 'Claude'}`));
  }

  toggle() {
    if (this.editing) return this.save();
    this.editing = true;
    this.action.textContent = 'Save';
    this.area = h('textarea', {class: 'field notebook-edit', 'aria-label': 'Notebook text', spellcheck: 'true'});
    this.area.value = this.note.body;
    this.body.replaceChildren(this.area, h('div', {class: 'row-actions'}, h('button', {class: 'btn', type: 'button', onclick: () => this.show()}, 'Cancel')));
    this.area.focus();
  }

  async save() {
    this.action.disabled = true;
    try {
      this.note = (await this.store.saveNotebook(this.area.value, this.note.version)).notebook;
      toast('Notebook saved');
      this.show();
    } catch (error) {
      toast(error.kind === 'conflict' ? 'Claude changed the notebook meanwhile. Your text is still here; reopen to compare.' : describe(error));
    } finally { this.action.disabled = false; }
  }
}
