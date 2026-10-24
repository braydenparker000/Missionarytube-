import test from 'node:test';
import {launchQualifiedBrowser} from './helpers/relay-conversation-browser-fixture.js';
import {runChatsScenario} from './helpers/chats-browser.js';

test('Jarvis Chats on a phone: a new chat wakes Claude, who works, replies with markdown and a PR card, and keeps a notebook; Muse answers; reload paints from the saved copy', {timeout: 120000}, async t => {
  const browser = await launchQualifiedBrowser(t);
  if (!browser) return;
  await runChatsScenario(t, browser);
});
