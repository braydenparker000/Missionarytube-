// Settings: Claude's live state and how replies work, typing, this phone's
// sign-in, and the way back to the classic Jarvis workspace.

import {h, ago} from '../dom.js';
import {icon} from '../icons.js';
import {claudeStatus, museStatus} from '../status.js';
import {prefs, setPref} from '../store.js';
import {auth} from '../api.js';

export class SettingsScreen {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.el = h('section', {class: 'screen page-screen', 'aria-label': 'Settings'});
    this.body = h('div', {class: 'page-body'});
    this.el.append(
      h('header', {class: 'chat-top'},
        h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')),
        h('h1', {class: 'page-title'}, 'Settings')),
      h('div', {class: 'page-scroll'}, this.body));
    for (const type of ['status', 'muse-state', 'connection']) this.store.addEventListener(type, () => this.render());
    this.render();
  }

  render() {
    const status = this.store.status;
    const s = claudeStatus(status, this.store.pending);
    const m = museStatus(this.store.museState);
    const session = status?.sessionUrl;
    const toggle = (label, detail, name) => {
      const input = h('input', {type: 'checkbox', role: 'switch', checked: !!prefs[name], onchange: e => { setPref(name, e.target.checked); this.app.applyPrefs(); }});
      return h('label', {class: 'setting'}, h('span', {}, h('strong', {}, label), h('span', {}, detail)), input);
    };
    this.body.replaceChildren(
      h('h2', {class: 'section-label'}, 'Claude'),
      h('div', {class: 'card info'},
        h('p', {class: 'tone-' + s.tone}, h('strong', {}, s.label), ' · ', s.detail),
        status?.lastSeen && h('p', {class: 'muted'}, `Last heard from ${ago(status.lastSeen)}`),
        status?.wake && h('p', {class: 'muted'}, `Last wake ${ago(status.wake.at)}: ${status.wake.ok ? 'started' : 'failed (' + (status.wake.error || 'unknown') + ')'}`),
        this.store.pending ? h('p', {class: 'muted'}, `${this.store.pending} message${this.store.pending === 1 ? '' : 's'} waiting for Claude`) : null,
        session && h('a', {class: 'btn small', href: session, target: '_blank', rel: 'noopener noreferrer'}, icon('open', {size: 18}), 'Open the session in Claude')),
      h('details', {class: 'card info explain'},
        h('summary', {}, 'How replies work'),
        h('p', {}, 'Claude runs as a Claude Code session in the cloud. While a session is online it answers within seconds. When none is, your message wakes a fresh one, which takes a few extra seconds to start.'),
        h('p', {}, 'Claude keeps what it learns in its notebook, so a new session picks up where the last one left off. Changes to Jarvis arrive as pull requests; nothing is merged without your say.')),
      h('h2', {class: 'section-label'}, 'Muse'),
      h('div', {class: 'card info'}, h('p', {class: 'tone-' + m.tone}, m.detail),
        h('a', {class: 'btn small', href: '/private/#mast'}, icon('open', {size: 18}), 'Classic Mast (files and tasks)')),
      h('h2', {class: 'section-label'}, 'Typing'),
      h('div', {class: 'card'},
        toggle('Enter sends', 'Otherwise Enter starts a new line; Ctrl+Enter always sends', 'enterSends'),
        toggle('Larger text', 'Bigger message text', 'largeText')),
      h('h2', {class: 'section-label'}, 'This phone'),
      h('div', {class: 'card info'},
        h('p', {}, auth.signedIn ? 'Signed in with your Jarvis owner account.' : 'Signed out.'),
        h('div', {class: 'row-actions'},
          auth.signedIn && h('button', {class: 'btn small danger', type: 'button', onclick: () => { auth.signOut(); }}, 'Sign out'),
          h('a', {class: 'btn small', href: '/private/'}, 'Classic workspace'),
          h('a', {class: 'btn small', href: '/'}, 'Jarvis home'))));
  }
}
