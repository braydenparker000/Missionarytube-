# Claude in Jarvis Chats

The owner talks to Claude from Jarvis Chats (`/chats/`, on the Azure site),
and Claude answers in the same chat. Claude is a Claude Code session in the
cloud, on the owner's own Claude plan: there is no API key, no billing beyond
the plan, and no server to keep running.

## How it fits together

```
 phone: /chats/ (Azure static site)
   │  POST /claude-chat/owner  (owner device sign-in, as the rest of Jarvis)
   ▼
 Jarvis Worker (Cloudflare) ── Durable Object "claude-chat-v1"
   │   threads, messages, Claude's notebook, the listening lease
   │
   │  a Claude session is listening?   yes → it takes the message within a second
   │                                   no  → fire the "Jarvis Claude" scheduled task
   ▼
 Claude Code session (claude.ai cloud)
   └ node scripts/jarvis-claude/jc.mjs  →  POST /claude-chat/agent
```

- **Listening.** A session waits with `jc wait`, a long poll that renews a
  75-second lease. Messages sent meanwhile reach it at once. While it works,
  `jc status working` holds the lease for 15 minutes and shows the owner
  what it is doing.
- **Waking.** When no session holds the lease, a new message fires the
  scheduled task's API trigger. That starts a fresh session (about 10 to 30
  seconds), which reads its notebook and the waiting messages. The Worker
  fires at most once every 3 minutes, far under the trigger's limits.
- **Memory.** The notebook in the Worker is Claude's long-term memory. Every
  session reads it first and updates it. The owner can read and correct it
  in Chats.
- **Nothing is lost.** The phone keeps unsent messages in an outbox and
  resends them with the same id; a message a session took but never answered
  goes back in the queue after 15 minutes.
- **What Claude does** is set by `scripts/jarvis-claude/INSTRUCTIONS.md`.
  The scheduled task only points there, so changing it is a pull request.

Muse stays as it is (the Mast adapter); Chats shows it as a pinned
conversation, and the classic workspace stays reachable from Settings.

## One-time setup (owner)

1. **A key for Claude.** Make a random key of at least 32 characters (for
   example `openssl rand -hex 32`). Add it to the Worker `jarvis-hub-api` as
   the secret `CLAUDE_CHAT_AGENT_KEY` (Cloudflare dashboard → Workers →
   jarvis-hub-api → Settings → Variables and Secrets). Deploys keep it.
2. **The cloud environment.** In claude.ai/code, open the environment the
   scheduled task will use and add a **network secret** for the host
   `jarvis-hub-api.braydenparker999.workers.dev` with the header
   `Authorization: Bearer <the key>`. The session never sees the key; the
   proxy adds it on the way out.
3. **The scheduled task.** Create a scheduled task named "Jarvis Claude"
   in that environment, with the repository `braydenparker000/Missionarytube-`
   and this prompt, and no schedule:

   > You are Jarvis Claude. Read `scripts/jarvis-claude/INSTRUCTIONS.md` in
   > this repository (on main) and follow it exactly.

   Add an **API trigger** to it and copy the trigger's URL and token.
4. **Waking.** Add two more Worker secrets: `CLAUDE_ROUTINE_FIRE_URL` (the
   trigger URL, `https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`)
   and `CLAUDE_ROUTINE_TOKEN` (its token).
5. Deploy the Worker (the "Deploy verified music Worker" workflow) and
   publish the site, as usual. Open Chats, sign in, and say hello.

Without step 4, Chats still works whenever a Claude session is listening;
the status line then says "Waking is not set up yet".

## Keeping it safe

- Only the signed-in owner's devices can read or send Claude messages; the
  Worker checks each request. Claude's key only works on `/claude-chat/agent`.
- The fire request carries only a thread id and a message id, never message
  text. The trigger text is not treated as instructions.
- Keep the key, the trigger URL and its token out of chats, issues and the
  repository. If one leaks, replace it (a new key in both places, or a new
  API trigger) and redeploy.
- This uses Claude Code as documented: scheduled tasks with an API trigger,
  network secrets, and background waits. Keep it to yourself. Sharing your
  Claude with other people, or pulling Claude Code's own sign-in token out
  to power another app, is against the terms; Chats does neither.

## Costs

- Waiting itself costs nothing. A listening session wakes for one short
  turn about every 24 minutes (about 3¢ of usage at list prices in the
  test below) and stops after four idle hours.
- Cloudflare: the long polls keep one Durable Object awake while the app is
  open or a session is listening. Even awake all day, that is about 11,000
  GB-seconds of the free plan's 13,000 a day; in practice it is far less.
  Watch the Durable Objects usage graph after the first week.

## Tested: a session keeps listening

On 2026-10-24 a cloud session ran ten 25-minute background waits in a row
(03:41 to 07:52 UTC). Every wait ended on time, in the same process, with
no pause or restart of its machine, and the whole test used about 35¢ of
usage at list prices. So a listening session stays reachable for hours,
and Claude answers within seconds while it is up. If a session is ever
stopped anyway, its lease lapses within a minute and the next message
wakes a fresh one.

## Files

| Path | What |
|---|---|
| `frontend/chats/` | The Chats app (installable, works from a saved copy) |
| `backend/claude-chat.js` | The store, the lease, the wake, the routes |
| `scripts/jarvis-claude/jc.mjs` | The command Claude uses to talk to the Worker |
| `scripts/jarvis-claude/INSTRUCTIONS.md` | Claude's standing instructions |
| `backend/tests/claude-chat.test.js`, `backend/tests/chats-browser.test.js`, `scripts/jarvis-claude-jc.test.mjs`, `tests/chats-app.test.mjs` | Tests |
