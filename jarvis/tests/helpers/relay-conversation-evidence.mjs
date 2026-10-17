import {mock} from 'node:test';
import {resolve} from 'node:path';
import {createConversationFixture, launchQualifiedBrowser, openConversationPage, closeConversationHarness,
  writeSyntheticEvidence, assertBrowserContained, SITE, RELAY_URL, MUSE_URL} from './relay-conversation-browser-fixture.js';
import {RELAY_OWNER_INBOX} from '../../backend/relay-common.js';
import {MUSE_PREFIX} from '../../public/assets/channels.js';

// Manual evidence capture, using only fictional content and routed SQLite data.
// Set RELAY_QA_PUBLIC_ROOT to an immutable baseline public/ snapshot for a before
// capture. This script never changes implementation, configuration or deployment.
const t = {mock, skip: message => { throw Error(message); }};
const browser = await launchQualifiedBrowser(t);
const h = createConversationFixture(t), pages = [];
const phase = process.env.RELAY_QA_PHASE || 'current';
const root = process.env.RELAY_QA_PUBLIC_ROOT && resolve(process.env.RELAY_QA_PUBLIC_ROOT);
try {
  const oauth = await h.oauth(), owner = await h.pair(oauth, 'Fictional QA phone');
  const id = crypto.randomUUID();
  await h.phone('/messages', {id, body: 'Can you help plan a quiet weekend at home?\nI would like time for music, a walk, and a little reading.'}, owner.device_token);
  await h.rpc(oauth, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: id,
    body: 'Start with a short walk on Saturday morning. Leave the afternoon open for music and reading.\n\nKeep Sunday simple: one small task, then plenty of rest.'});
  for (const body of ['Fictional public note: What should I read this weekend?', MUSE_PREFIX + 'Fictional Muse prompt: Write a short scene about a rainy window.']) {
    await h.fixture.request('/shared/messages', {method: 'POST', headers: {Origin: SITE, 'Content-Type': 'application/json'}, body: JSON.stringify({id: crypto.randomUUID(), body})});
  }
  for (const size of [{width: 360, height: 800}, {width: 390, height: 844}, {width: 412, height: 915}, {width: 1280, height: 900, mobile: false}]) {
    for (const channel of ['owner', 'public', 'muse']) {
      const phone = await openConversationPage(browser, h, {...size, ...(root ? {root} : {}), ...(channel === 'owner' ? {owner} : {})});
      pages.push(phone);
      await phone.page.goto(channel === 'muse' ? MUSE_URL : RELAY_URL);
      const input = phone.page.locator(channel === 'owner' ? '#relay-owner-message-text' : channel === 'muse' ? '#prompt' : '#message-text');
      await input.waitFor();
      await input.fill(channel === 'owner' ? 'Fictional unsent private draft' : channel === 'muse' ? 'Fictional unsent Muse draft' : 'Fictional unsent public draft');
      const geometry = await phone.page.evaluate(() => ({
        viewport: {width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height}, documentWidth: document.documentElement.scrollWidth,
        controls: [...document.querySelectorAll('button, .topbar a, input, textarea')].filter(node => {
          const rect = node.getBoundingClientRect(); return rect.width && rect.height && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden]');
        }).map(node => { const rect = node.getBoundingClientRect(); return {name: node.getAttribute('aria-label') || node.textContent.trim() || node.id,
          id: node.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, disabled: !!node.disabled}; }),
      }));
      await writeSyntheticEvidence(phone, `${phase}-${channel}-${size.width}x${size.height}`, geometry);
      assertBrowserContained(phone);
    }
  }
} finally {
  await closeConversationHarness(browser, h, pages);
  mock.restoreAll();
}
