import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage,
  conversationMenu, closeConversationHarness, assertBrowserContained,
  assertNoPrivatePersistence, SITE, RELAY_URL} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../shared.js';

async function journey(t, {privateView = false, direct = false} = {}) {
  const browser = await launchQualifiedBrowser(t); if (!browser) return;
  const h = createConversationFixture(t), pages = [];
  t.after(() => closeConversationHarness(browser, h, pages));
  let owner;
  if (privateView) owner = await h.pair(await h.oauth(), 'Fictional menu navigation phone');
  const phone = await openConversationPage(browser, h, {owner, clock: false});
  pages.push(phone);
  const page = phone.page;
  if (direct) await page.goto(RELAY_URL);
  else {
    await page.goto(SITE + '/');
    // Public Relay remains a secondary route; this suite isolates its own Back stack.
    await page.goto(RELAY_URL);
  }
  await page.locator(privateView ? '#relay-owner-message-text' : '#message-text').waitFor();
  return {h, phone, page, owner};
}
async function openMenu(page, trigger = '#relay-menu-button') {
  await page.locator(trigger).click();
  await page.locator('dialog.relay-navigation-sheet[open]').waitFor();
  await page.locator('dialog.relay-navigation-sheet[open]').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));
}
async function closed(page) {
  await page.locator('dialog.app-sheet').waitFor({state: 'detached'});
}
async function historySnapshot(phone) {
  return phone.cdp.send('Page.getNavigationHistory');
}
async function assertHome(page) {
  await page.waitForURL(SITE + '/');
  await page.locator('body.launcher-page #app-directory').waitFor();
}
async function assertRelay(page) {
  await page.waitForURL(RELAY_URL);
  await page.locator('body.relay-page #relay-menu-button').waitFor();
}

test('Relay Back closes the menu without remounting, losing the draft, reading position or accepted reply', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {h, phone, page} = j;
  let question;
  for (let i = 0; i < 24; i++) {
    question = crypto.randomUUID();
    assert.equal(sharedStore(h.ctx, '/internal/shared/message', {id: question, body: 'Fictional navigation question ' + i + '.\n'.repeat(3)}).status, 201);
  }
  const reply = crypto.randomUUID();
  assert.equal(sharedStore(h.ctx, '/internal/shared/reply', {id: reply, replyTo: question, body: 'Fictional accepted immutable answer.'}).status, 201);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.locator('#messages [data-message-id="' + reply + '"]').waitFor();
  await page.locator('#message-text').fill('Fictional unsent public draft.');
  const before = await page.evaluate(() => {
    window.menuTestPanel = document.querySelector('#messages');
    menuTestPanel.scrollTop = Math.floor(menuTestPanel.scrollHeight / 3);
    return {scroll: menuTestPanel.scrollTop, text: menuTestPanel.textContent};
  });
  const writes = phone.records.filter(r => r.method === 'POST').length;
  await openMenu(page);
  await page.goBack();
  await closed(page);
  assert.equal(page.url(), RELAY_URL);
  assert.equal(await page.locator('#message-text').inputValue(), 'Fictional unsent public draft.');
  assert.deepEqual(await page.evaluate(() => ({same: menuTestPanel === document.querySelector('#messages'), scroll: menuTestPanel.scrollTop, text: menuTestPanel.textContent})), {same: true, ...before});
  assert.equal(await page.evaluate(() => document.activeElement.id), 'relay-menu-button');
  assert.equal(await page.locator('#messages [data-message-id="' + reply + '"]').count(), 1);
  assert.equal(phone.records.filter(r => r.method === 'POST').length, writes, 'Navigation cannot send or change messages');
  await page.goBack(); await assertHome(page);
  assertBrowserContained(phone);
});

test('Close, Escape, backdrop and repeated openings retire one menu entry before normal Back', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {phone, page} = j, base = await historySnapshot(phone);
  for (const how of ['close', 'escape', 'backdrop', 'close', 'escape', 'close']) {
    await openMenu(page, '#relay-menu-button');
    const open = await historySnapshot(phone);
    assert.equal(open.currentIndex, base.currentIndex + 1);
    assert.equal(open.entries.length, base.entries.length + 1, 'Reopening replaces the stale Forward entry');
    if (how === 'close') await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
    else if (how === 'escape') await page.keyboard.press('Escape');
    else {
      const bounds = await page.getByRole('dialog').boundingBox();
      assert.ok(bounds && bounds.x===0 && bounds.width < page.viewportSize().width - 1, 'The side panel leaves a real backdrop target');
      await page.mouse.click(page.viewportSize().width-1, 20);
    }
    await closed(page);
    assert.equal((await historySnapshot(phone)).currentIndex, base.currentIndex);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'relay-menu-button');
  }
  await page.goBack(); await assertHome(page);
  assertBrowserContained(phone);
});

test('reload with an open menu and Forward after dismissal never trap Back or restore stale actions', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {phone, page} = j;
  await openMenu(page); await page.reload(); await assertRelay(page);
  assert.equal(await page.locator('dialog.app-sheet[open]').count(), 0);
  await page.goBack(); await assertHome(page);
  await page.goForward(); await assertRelay(page);
  await page.goForward(); await assertRelay(page);
  assert.equal(await page.locator('dialog.app-sheet[open]').count(), 0);
  const stale = await historySnapshot(phone);
  await openMenu(page);
  assert.equal((await historySnapshot(phone)).entries.length, stale.entries.length, 'A stale Forward entry is reused');
  await page.goBack(); await closed(page);
  await page.goForward(); await assertRelay(page);
  assert.equal(await page.locator('dialog.app-sheet[open]').count(), 0);
  await page.goBack(); await assertHome(page);
  assertBrowserContained(phone);
});

test('menu destinations wait for history closure, retain private drafts and preserve the public boundary', {timeout: 120000}, async t => {
  const j = await journey(t, {privateView: true}); if (!j) return;
  const {phone, page} = j;
  const writes = phone.records.filter(r => r.method === 'POST').length;
  const privateDraft = 'PRIVATE-MENU-DRAFT-4927';
  await page.locator('#relay-owner-message-text').fill(privateDraft);
  await openMenu(page); await page.goBack(); await closed(page);
  assert.equal(await page.locator('#relay-owner-message-text').inputValue(), privateDraft);
  assert.equal(await page.locator('body').getAttribute('data-conversation-mode'), 'owner');
  await openMenu(page);
  await page.getByRole('dialog').getByRole('button', {name: 'Chats', exact: true}).click();
  await page.getByRole('dialog').getByRole('button', {name: 'Public', exact: true}).click();
  await closed(page); await page.locator('#message-text').waitFor();
  assert.equal(page.url(), RELAY_URL);
  assert.equal(await page.locator('body').textContent().then(text => text.includes(privateDraft)), false);
  await conversationMenu(page, 'Owner chat');
  await page.locator('#relay-owner-message-text').waitFor();
  assert.equal(await page.locator('#relay-owner-message-text').inputValue(), privateDraft);
  await openMenu(page); await page.getByRole('dialog').getByRole('button', {name: 'Tasks', exact: true}).click();
  await page.locator('#relay-owner-current-work').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'relay-menu-button');
  assert.equal(await page.locator('dialog.app-sheet[open]').count(), 0);
  assert.equal(phone.records.filter(r => r.method === 'POST').length, writes, 'Menu navigation never submits owner messages or jobs');
  await assertNoPrivatePersistence(page, [privateDraft], {draft: privateDraft});
  await page.goBack();await page.locator('#relay-owner-message-text').waitFor();assert.equal(await page.locator('#relay-owner-message-text').inputValue(),privateDraft);await page.goBack(); await assertHome(page);
  assertBrowserContained(phone);
});

test('a newer Home destination wins over a pending menu action and has no leftover menu Back step', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {phone, page} = j;
  await openMenu(page);
  // Both intentions happen before the asynchronous history traversal. This is
  // deterministic ordering coverage, with the real browser history untouched.
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog.relay-navigation-sheet');
    [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === 'Saved').click();
    dialog.querySelector('a[data-route="home"]').click();
  });
  await assertHome(page); await closed(page);
  assert.equal(await page.locator('body').getAttribute('data-conversation-mode'), 'public');
  await page.goBack(); await assertRelay(page);
  assert.equal(await page.locator('dialog.app-sheet[open]').count(), 0);
  await page.goBack(); await assertHome(page);
  assertBrowserContained(phone);
});

test('fresh direct Relay URLs and a Home link from the open menu do not duplicate history', {timeout: 120000}, async t => {
  const j = await journey(t, {direct: true}); if (!j) return;
  const {phone, page} = j, base = await historySnapshot(phone);
  await openMenu(page); await page.keyboard.press('Escape'); await closed(page);
  assert.equal((await historySnapshot(phone)).currentIndex, base.currentIndex);
  assert.equal(await page.locator('body').getAttribute('data-conversation-mode'), 'public');
  await openMenu(page); await page.getByRole('dialog').getByRole('link', {name: 'Jarvis home', exact: true}).click();
  await assertHome(page); await closed(page);
  const home = await historySnapshot(phone);
  assert.equal(home.currentIndex, base.currentIndex + 1);
  assert.equal(home.entries.length, base.entries.length + 1);
  await page.goBack(); await assertRelay(page);
  assert.equal(await page.locator('dialog.app-sheet[open]').count(), 0);
  assertBrowserContained(phone);
});

test('a newer composer focus after popstate survives the queued native close event', {timeout: 120000}, async t => {
  const j = await journey(t); if (!j) return;
  const {phone, page} = j;
  await openMenu(page);
  await page.evaluate(() => {
    addEventListener('popstate', () => document.querySelector('#message-text').focus({preventScroll: true}), {once: true});
    history.back();
  });
  await closed(page);
  assert.equal(page.url(), RELAY_URL);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'message-text');
  await page.goBack(); await assertHome(page);
  assertBrowserContained(phone);
});
