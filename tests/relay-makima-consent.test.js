import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {MAKIMA_CONSENT_SCRIPT as script, MAKIMA_CONSENT_SCRIPT_HASH as hash} from '../backend/relay-makima-consent.js';
import {makimaOAuthPolicy} from '../backend/relay-makima-policy.js';
import {relayOAuthPolicy} from '../backend/relay-oauth-policy.js';

function fixture() {
  const node = value => ({value, disabled: false, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; }});
  const buttons = [node('allow'), node('deny')], form = node(), status = {hidden: true}, events = {};
  form.querySelectorAll = () => buttons;
  form.addEventListener = (name, fn) => { events[name] = fn; };
  vm.runInNewContext(script, {document: {querySelector: () => form, getElementById: () => status}, window: {addEventListener: (name, fn) => { events[name] = fn; }}});
  const submit = button => {
    const event = {submitter: button, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
    events.submit(event); return event;
  };
  return {buttons, form, status, events, submit};
}

test('Makima fixed consent script hash is exact and other OAuth policy remains script-free', () => {
  assert.equal(hash, 'sha256-' + createHash('sha256').update(script).digest('base64'));
  assert.equal(makimaOAuthPolicy.consentGuard.script, script);
  assert.equal(relayOAuthPolicy.consentGuard, undefined);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|localStorage|setTimeout|innerHTML/);
});

for (const [first, second] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
  test(`Makima guard preserves ${first ? 'Cancel' : 'Allow'} and blocks subsequent ${second ? 'Cancel' : 'Allow'}`, () => {
    const f = fixture(), original = f.buttons[first];
    const accepted = f.submit(original);
    assert.equal(accepted.defaultPrevented, false);
    assert.equal(accepted.submitter, original);
    assert.equal(f.submit(f.buttons[second]).defaultPrevented, true);
    assert.equal(f.form.attributes['aria-busy'], 'true');
    assert.equal(f.status.hidden, false);
    for (const button of f.buttons) {
      assert.equal(button.disabled, false);
      assert.equal(button.attributes['aria-disabled'], 'true');
    }
    // Handler-unit coverage; actual browser BFCache is a separate behavior.
    f.events.pageshow({persisted: true});
    assert.equal(f.form.attributes['aria-busy'], undefined);
    assert.equal(f.status.hidden, true);
    for (const button of f.buttons) assert.equal(button.attributes['aria-disabled'], undefined);
    assert.equal(f.submit(f.buttons[second]).defaultPrevented, false);
    assert.equal(f.submit(original).defaultPrevented, true);
  });
}
