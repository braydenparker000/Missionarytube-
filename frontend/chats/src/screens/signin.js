// Sign-in with the Jarvis owner account. A phone already signed in on
// another Jarvis page skips this. When ten phones are signed in, one of
// them can be replaced here.

import {h, ago} from '../dom.js';
import {avatar} from '../ui.js';
import {auth, describe} from '../api.js';

export class SignInScreen {
  constructor(app) {
    this.app = app;
    this.el = h('section', {class: 'screen signin-screen', 'aria-label': 'Sign in'});
    this.user = h('input', {class: 'field', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, 'aria-label': 'Username', placeholder: 'Username'});
    this.pass = h('input', {class: 'field', name: 'password', type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Password', placeholder: 'Password', minlength: '16'});
    this.error = h('p', {class: 'form-error', role: 'alert'});
    this.button = h('button', {class: 'btn primary wide', type: 'submit'}, 'Sign in');
    this.devices = h('div', {class: 'devices'});
    this.el.append(h('form', {class: 'signin', onsubmit: e => { e.preventDefault(); this.submit(); }},
      h('div', {class: 'signin-avatars', 'aria-hidden': 'true'}, avatar('claude'), avatar('muse')),
      h('h1', {}, 'Jarvis Chats'),
      h('p', {class: 'muted'}, 'Claude and Muse, in one place. Sign in with your Jarvis owner account.'),
      this.user, this.pass, this.error, this.button, this.devices));
  }

  focus() { (this.user.value ? this.pass : this.user).focus(); }

  async submit(replaceDeviceId) {
    this.error.textContent = '';
    this.button.disabled = true;
    this.button.textContent = 'Signing in…';
    try {
      await auth.signIn(this.user.value.trim(), this.pass.value, {replaceDeviceId});
      this.pass.value = '';
      this.devices.replaceChildren();
    } catch (error) {
      if (error.kind === 'device_limit') this.offerReplace(error.detail || []);
      else this.error.textContent = describe(error);
    } finally {
      this.button.disabled = false;
      this.button.textContent = 'Sign in';
    }
  }

  offerReplace(devices) {
    this.error.textContent = 'Ten phones are already signed in. Replace one to sign in here.';
    this.devices.replaceChildren(...devices.map(d => h('button', {class: 'device', type: 'button', onclick: () => this.submit(d.id)},
      h('strong', {}, d.label || 'Device'), h('span', {}, `Last used ${ago(Date.parse(d.lastSeenAt))}`), h('span', {class: 'device-action'}, 'Replace'))));
  }
}
