import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createInterceptionCancellationTracker} from './helpers/browser-interception-cancellation.js';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness,
  assertBrowserContained, deferred, SITE, WORKER, MUSE_URL} from './helpers/relay-conversation-browser-fixture.js';

const stale = command => new Error(`cdpSession.send: Protocol error (${command}): Invalid InterceptionId.`);
const request = {networkId: 'synthetic-read-1', request: {method: 'GET'}};
const proof = {requestId: request.networkId, canceled: true, errorText: 'net::ERR_ABORTED'};

test('stale CDP reads require exact matching cancellation proof before or just after the error', async () => {
  for (const command of ['Fetch.fulfillRequest', 'Fetch.failRequest']) {
    const cdp = new EventEmitter(), confirm = createInterceptionCancellationTracker(cdp);
    cdp.emit('Network.loadingFailed', proof);
    assert.deepEqual(await confirm({event: request, error: stale(command), command, validated: true}), proof);
    const late = {...request, networkId: 'synthetic-late-read'};
    const pending = confirm({event: late, error: stale(command), command, validated: true});
    const lateProof = {...proof, requestId: late.networkId};
    cdp.emit('Network.loadingFailed', lateProof);
    assert.deepEqual(await pending, lateProof);
  }
});

test('cancellation bookkeeping never accepts unknown, unmatched, uncanceled or invalid fixture failures', async () => {
  const cdp = new EventEmitter(), confirm = createInterceptionCancellationTracker(cdp, {timeoutMs: 5});
  cdp.emit('Network.loadingFailed', proof);
  const command = 'Fetch.fulfillRequest', error = stale(command), valid = {event: request, error, command, validated: true};
  const rejected = [
    {...valid, validated: false},
    {...valid, event: {request: {method: 'GET'}}},
    {...valid, event: {...request, networkId: ''}},
    {...valid, event: {...request, networkId: 'different-read'}},
    {...valid, event: {...request, request: {method: 'POST'}}},
    {...valid, command: 'Fetch.continueRequest'},
    {...valid, error: stale('Fetch.failRequest')},
    {...valid, error: new Error('fixture origin/path/response validation failed')},
    {...valid, error: new Error('cdpSession.send: Protocol error (Fetch.fulfillRequest): Access denied.')},
    {...valid, error: new Error(error.message + ' unrelated failure')},
  ];
  for (const input of rejected) assert.equal(await confirm(input), null);
  const uncanceled = {...request, networkId: 'uncanceled-read'};
  cdp.emit('Network.loadingFailed', {requestId: uncanceled.networkId, canceled: false, errorText: 'net::ERR_FAILED'});
  assert.equal(await confirm({...valid, event: uncanceled}), null);
  const missing = {...request, networkId: 'missing-event'};
  assert.equal(await confirm({...valid, event: missing}), null, 'A short bounded wait must still reject absent proof');
  cdp.emit('Network.loadingFailed', {...proof, requestId: 'different-request'});
  assert.equal(await confirm({...valid, event: {...request, networkId: 'never-matched'}}), null);
});

test('genuine navigation cancels a held synthetic read without hiding browser or containment errors', {timeout: 30000}, async t => {
  const browser = await launchQualifiedBrowser(t); if (!browser) return;
  const harness = createConversationFixture(t), pages = [];
  t.after(() => closeConversationHarness(browser, harness, pages));
  const phone = await openConversationPage(browser, harness); pages.push(phone);
  const cancellation = deferred(); let target;
  phone.cdp.on('Fetch.requestPaused', event => {
    if (!target && event.request.url.startsWith(WORKER + '/shared/changes')) target = event;
  });
  phone.cdp.on('Network.loadingFailed', event => {
    if (target && event.requestId === target.networkId) cancellation.resolve(event);
  });
  const held = phone.hold(record => record.method === 'GET' && record.path === '/shared/changes');
  await phone.page.goto(MUSE_URL); const record = await held.entered;
  assert.ok(target?.networkId); assert.equal(target.request.url, record.url);
  await phone.page.locator('#relay-menu-button').click();
  await phone.page.getByRole('link', {name: 'Jarvis home', exact: true}).click();
  await phone.page.waitForURL(SITE + '/');
  const failed = await cancellation.promise;
  assert.equal(failed.requestId, target.networkId); assert.equal(failed.canceled, true); assert.equal(failed.errorText, 'net::ERR_ABORTED');
  held.release(); await Promise.all([...phone.pending]);
  assert.equal(record.cancelledByBrowser, true);
  assert.deepEqual(record.cancellation, {requestId: target.networkId, canceled: true, errorText: 'net::ERR_ABORTED'});
  assert.equal(phone.records.filter(request => request.method === 'POST').length, 0, 'Navigation cancellation never sends a message');
  assertBrowserContained(phone);
});
