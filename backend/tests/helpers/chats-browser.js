// The Jarvis Chats app (frontend/chats) end to end in a phone-sized browser,
// against the real Worker and SQLite (synthetic accounts, no live network):
// the owner starts a chat, the scheduled task is fired because nobody is
// listening, Claude takes the message with its key, works, replies with
// markdown and a pull-request card, and writes its notebook; Muse answers
// through the Mast adapter; reload paints from the saved copy.

import assert from 'node:assert/strict';
import {createConversationFixture, openConversationPage, closeConversationHarness, assertBrowserContained, writeSyntheticEvidence, SITE} from './relay-conversation-browser-fixture.js';
import {hash, random} from '../../relay-common.js';

export async function runChatsScenario(t, browser) {
  const key = 'k'.repeat(48), museToken = random();
  const h = createConversationFixture(t, {env: {
    CLAUDE_CHAT_AGENT_KEY: key, CLAUDE_ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_T/fire', CLAUDE_ROUTINE_TOKEN: 'routine-token',
    RELAY_MAST_ENABLED: 'true', RELAY_MAST_TOKEN_SHA256: await hash(museToken),
  }});
  // The fixture blocks the network; only the routine fire passes, recorded.
  const fired = [], blocked = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.anthropic.com/')) { fired.push(JSON.parse(init.body)); return Response.json({claude_code_session_url: 'https://claude.ai/code/session_01Fired'}); }
    return blocked(url, init);
  };
  t.after(() => { globalThis.fetch = blocked; });
  const asClaude = async (op, args) => {
    const response = await h.fixture.request('/claude-chat/agent', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key}, body: JSON.stringify({op, args})});
    assert.equal(response.status, 200, `Claude ${op}`);
    return response.json();
  };
  const owner = await h.pair(await h.oauth());
  const phone = await openConversationPage(browser, h, {owner, clock: false, showDormant: false});
  const pages = [phone];
  try {
    // Long polls are kept short here so the test never waits on a parked request.
    phone.rule(({path, body}) => path === '/claude-chat/owner' && /"op":"changes"/.test(body || ''), async ({record}) => {
      const input = JSON.parse(record.body);
      input.args.wait = Math.min(input.args.wait || 0, 800);
      return h.fixture.request('/claude-chat/owner', {method: 'POST', headers: record.headers, body: JSON.stringify(input)});
    }, 1e9);
    const {page} = phone;
    await page.goto(SITE + '/chats/');
    await page.getByRole('heading', {name: 'Chats'}).waitFor();
    await page.getByRole('button', {name: /^Muse/}).waitFor();
    await page.locator('.status-card', {hasText: 'Asleep'}).waitFor();

    // A new chat: the first message creates the thread and wakes Claude.
    await page.getByRole('button', {name: 'New chat'}).click();
    const input = page.getByRole('textbox', {name: 'Message Claude'});
    await input.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message Claude', 'a fresh chat focuses the composer');
    await page.getByRole('button', {name: 'What do you remember about Jarvis?'}).waitFor();
    await input.fill('Can you fix the podcast search?');
    await page.getByRole('button', {name: 'Send'}).click();
    await page.locator('.msg.owner .state', {hasText: 'Sent'}).waitFor();
    await page.locator('.chat-sub', {hasText: 'Starting up'}).waitFor();
    assert.equal(fired.length, 1, 'nobody was listening: the scheduled task was fired once');
    assert.doesNotMatch(fired[0].text, /podcast/, 'only ids travel to Anthropic');
    assert.equal(await page.locator('.chat-title').textContent(), 'Can you fix the podcast search?', 'the first message names the chat');

    // Claude takes it, works on it, and replies.
    const taken = await asClaude('take', {wait: 0});
    assert.equal(taken.messages.length, 1);
    const {threadId, id: messageId} = taken.messages[0];
    await page.locator('.msg.owner .state', {hasText: 'Seen'}).waitFor();
    await asClaude('status', {state: 'working', threadId, note: 'Reading the search code'});
    await page.locator('.thinking', {hasText: 'Reading the search code'}).waitFor();
    // While Claude works here and the box is empty, the round button is Stop.
    await page.getByRole('button', {name: 'Stop Claude'}).waitFor();
    await asClaude('post', {id: crypto.randomUUID(), threadId, kind: 'progress', body: 'Running the podcast tests'});
    await page.locator('.work.live', {hasText: 'Running the podcast tests'}).waitFor();
    assert.equal(await page.locator('.thinking').isHidden(), true, 'the live work card takes over from "thinking"');
    await writeSyntheticEvidence(phone, 'chats-working');
    await page.getByRole('button', {name: 'Stop Claude'}).click();
    await page.locator('.work.live', {hasText: 'Stopping'}).waitFor();
    assert.equal((await asClaude('status', {state: 'working', threadId, note: 'Wrapping up'})).stop.threadId, threadId, 'Claude hears the stop');
    await asClaude('thread.update', {id: threadId, title: 'Podcast search fix', sessionUrl: 'https://claude.ai/code/session_01Fired'});
    await page.locator('.chat-title', {hasText: 'Podcast search fix'}).waitFor();
    await asClaude('post', {id: crypto.randomUUID(), threadId, replyTo: messageId, body: 'Found it: the query was **lower-cased twice**. [Details](javascript:alert(1)) <img src=x onerror=alert(2)>\n\n```js\nquery.toLowerCase()\n```\n\n- [x] Fixed\n- [ ] Merged'});
    const cardId = crypto.randomUUID(), pr = 'https://github.com/braydenparker000/Missionarytube-/pull/400';
    await asClaude('post', {id: cardId, threadId, kind: 'card', body: 'Fix podcast search', meta: {url: pr, title: 'Fix podcast search', state: 'checks', actions: ['Merge it', 'Not yet']}});
    await asClaude('status', {state: 'listening'});
    await page.locator('.md strong', {hasText: 'lower-cased twice'}).waitFor();
    await page.locator('.md-code code', {hasText: 'query.toLowerCase()'}).waitFor();
    await page.locator('.card a.card-main', {hasText: 'Missionarytube-#400'}).waitFor();
    assert.equal(await page.locator('.feed a[href^="javascript"], .feed img').count(), 0, 'markdown never makes script links or HTML');
    await page.locator('.md', {hasText: '<img src=x onerror=alert(2)>'}).waitFor();
    assert.equal(await page.locator('.card a.card-main').getAttribute('href'), pr);
    await page.locator('.pill', {hasText: 'Checks running'}).waitFor();
    await page.locator('.work:not(.live)', {hasText: 'Worked for'}).waitFor();
    await page.locator('.chat-sub', {hasText: 'Online'}).waitFor();
    assert.equal(await page.locator('.thinking').isHidden(), true, 'nothing pending once Claude has answered');
    assert.equal(await page.getByRole('button', {name: 'Send'}).isDisabled(), true, 'Stop turns back into Send');
    await writeSyntheticEvidence(phone, 'chats-claude-thread');

    // A card's button answers for the owner; Claude then moves the card along.
    await page.getByRole('button', {name: 'Merge it'}).click();
    await page.locator('.msg.owner', {hasText: 'Merge it'}).locator('.state', {hasText: 'Sent'}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Not yet'}).count(), 0, 'the decision is made: its buttons go');
    await asClaude('amend', {id: cardId, meta: {url: pr, title: 'Fix podcast search', state: 'merged'}});
    await page.locator('.pill', {hasText: 'Merged'}).waitFor();

    // A second message while Claude listens is not a second wake.
    await input.fill('Thanks!');
    await input.press('Control+Enter');
    await page.locator('.msg.owner', {hasText: 'Thanks!'}).waitFor();
    await page.locator('.msg.owner', {hasText: 'Thanks!'}).locator('.state', {hasText: 'Sent'}).waitFor();
    assert.equal(fired.length, 1, 'Claude is listening: no second fire');

    // Back (the Android back button) to the list, which shows the thread.
    const back = async () => { await page.goBack(); await page.locator('.page').waitFor({state: 'detached'}); };
    await back();
    await page.locator('.row', {hasText: 'Podcast search fix'}).waitFor();

    // A reply that arrives while the owner is away: unread on the list, a "New" divider in the chat.
    await asClaude('post', {id: crypto.randomUUID(), threadId, body: 'Merged. Anything else?'});
    await page.locator('.row.unread', {hasText: 'Podcast search fix'}).locator('.badge').waitFor();
    await writeSyntheticEvidence(phone, 'chats-list');
    await page.locator('.row', {hasText: 'Podcast search fix'}).click();
    await page.locator('.new-divider').waitFor();
    await back();
    await page.locator('.row:not(.unread)', {hasText: 'Podcast search fix'}).waitFor();

    // Search filters the list.
    const search = page.getByRole('searchbox', {name: 'Search chats'});
    await search.fill('podcast');
    await page.locator('.row', {hasText: 'Podcast search fix'}).waitFor();
    assert.equal(await page.getByRole('button', {name: /^Muse/}).count(), 0, 'Muse does not match');
    await search.fill('zzz');
    await page.getByText('No chats match').waitFor();
    await page.getByRole('button', {name: 'Clear search'}).click();
    await page.getByRole('button', {name: /^Muse/}).waitFor();

    // Muse through the Mast adapter.
    await page.getByRole('button', {name: /^Muse/}).click();
    const museInput = page.getByRole('textbox', {name: 'Message Muse'});
    await museInput.fill('Hi Muse');
    await page.getByRole('button', {name: 'Send'}).click();
    await page.locator('.msg.owner .state', {hasText: 'Sent'}).waitFor();
    const listed = await (await h.fixture.request('/relay/mast/messages?after=0', {headers: {Authorization: 'Bearer ' + museToken}})).json();
    const ownerEntry = listed.messages.find(m => m.body === 'Hi Muse');
    assert.ok(ownerEntry, 'Muse sees the message');
    const replied = await h.fixture.request('/relay/mast/reply', {method: 'POST', headers: {Authorization: 'Bearer ' + museToken, 'Content-Type': 'application/json'}, body: JSON.stringify({id: crypto.randomUUID(), reply_to: ownerEntry.id, body: 'Hello from Muse'})});
    assert.equal(replied.status, 201);
    await page.locator('.msg.reply', {hasText: 'Hello from Muse'}).waitFor({timeout: 15000});
    await back();

    // The notebook: Claude writes it; the owner reads and corrects it.
    await asClaude('notebook', {body: '# Owner\n- Prefers short answers'});
    await page.getByRole('button', {name: 'Notebook', exact: true}).click();
    await page.locator('.md li', {hasText: 'Prefers short answers'}).waitFor();
    await page.locator('.chat-top').getByRole('button', {name: 'Edit'}).click();
    await page.getByRole('textbox', {name: 'Notebook text'}).fill('# Owner\n- Prefers short answers\n- Uses Android Chrome');
    await page.locator('.chat-top').getByRole('button', {name: 'Save'}).click();
    await page.locator('.md li', {hasText: 'Uses Android Chrome'}).waitFor();
    assert.match((await asClaude('notebook', {})).notebook.body, /Uses Android Chrome/);
    await back();

    // The accent colour, chosen in Settings, is remembered.
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await page.getByRole('radio', {name: 'Mint'}).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'mint');
    await writeSyntheticEvidence(phone, 'chats-settings');
    await back();

    // Long-press a chat: rename it.
    const row = page.locator('.row', {hasText: 'Podcast search fix'});
    await row.click({button: 'right'});
    await page.getByRole('dialog').getByRole('button', {name: 'Rename'}).click();
    await page.getByRole('textbox', {name: 'Rename chat'}).fill('Podcasts');
    await page.getByRole('button', {name: 'Save'}).click();
    await page.locator('.row-title', {hasText: 'Podcasts'}).waitFor();

    // A reload paints from the saved copy, and stays live.
    await page.reload();
    await page.locator('.row-title', {hasText: 'Podcasts'}).waitFor();
    await page.locator('.row', {hasText: 'Podcasts'}).click();
    await page.locator('.md strong', {hasText: 'lower-cased twice'}).waitFor();
    await asClaude('post', {id: crypto.randomUUID(), threadId, body: 'Merged and deployed.'});
    await page.locator('.msg.reply', {hasText: 'Merged and deployed.'}).waitFor();

    // Nothing private lands outside this app's own keys, and the credential is the shared one.
    const stored = await page.evaluate(() => Object.keys(localStorage));
    assert.ok(stored.every(k => k.startsWith('chats.') || k === 'jarvis.relay.owner-session.v1'), 'only Chats keys and the shared sign-in: ' + stored);

    // Swipe a chat left to archive it; Undo brings it back.
    await back();
    const box = await page.locator('.row', {hasText: 'Podcasts'}).boundingBox();
    const y = box.y + box.height / 2;
    await phone.cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: box.x + box.width - 20, y}]});
    for (let step = 1; step <= 8; step++) await phone.cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: box.x + box.width - 20 - step * 35, y}]});
    await phone.cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.getByText('Chat archived').waitFor();
    await page.getByRole('button', {name: 'Archived (1)'}).waitFor();
    await page.getByRole('button', {name: 'Undo'}).click();
    await page.locator('.row', {hasText: 'Podcasts'}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.accent), 'mint', 'the accent survived the reload');

    // Sign out: the sign-in screen, and the credential is gone.
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await page.getByRole('button', {name: 'Sign out'}).click();
    await page.getByRole('heading', {name: 'Jarvis Chats'}).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('jarvis.relay.owner-session.v1')), null);

    assertBrowserContained(phone);
    const claudeRequests = phone.records.filter(r => r.path === '/claude-chat/owner' && r.method === 'POST');
    assert.ok(claudeRequests.length > 5);
    for (const r of claudeRequests) { assert.equal(r.headers.origin, SITE); assert.match(r.headers.authorization, /^Bearer [0-9a-f]{64}$/); }
  } finally {
    await closeConversationHarness(browser, h, pages);
  }
}
