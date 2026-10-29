# The one-time export for the Thunderhead

The Thunderhead (`braydenparker000/thunderhead`) replaces Jarvis. Its import pulls this Worker's
data once, through a read-only export route, and stores it in its own private bucket. This Worker
never gets that bucket, and the export writes nothing anywhere. The full plan is the Thunderhead's
`docs/engineering/MIGRATION.md` §3; the owner approved this deploy ("Deploy the old Worker once
more to turn on its logs and add a read-only export. It changes no data.").

## The routes

Both take `POST` with `Authorization: Bearer <CLAUDE_CHAT_AGENT_KEY>`, the agent key the Chats
route already uses ([jarvis-claude.md](jarvis-claude.md)). No new secret and no new binding.

| Route | Body | Answer |
|---|---|---|
| `/ops/export/tables` | `{instance}` | `{instance, tables: [{table, rows, columns, never_export, virtual}], rows_written}` |
| `/ops/export/step` | `{run_id, instance, table, cursor}` | One part: gzip JSONL of at most 2,000 rows after `cursor` by `rowid`, with headers `X-Rows`, `X-Next-Cursor` (empty at the end), `X-Sha256` and `X-Rows-Written` |

- `instance` is one of the named Durable Objects the migration inventories (`claude-chat-v1`,
  `music-catalog-v1`, `jarvis-shared-v2`, `jarvis-makima-v1`, and the legacy
  `jarvis-coordination-v2`, `public-coordination-v2`, `jarvis-publication-v1`); any other is 404.
- The sign-in, OAuth and token-diagnostic tables are never exported: they are listed with their
  row counts only, and a part of one is refused with 403.
- BLOB values travel as `{"$b64": "…"}`. A table without a `rowid` is refused with 422.
- Every answer says how many rows its own statements wrote, from the SQL cursors themselves. It is
  always 0; the Thunderhead's driver stops at once if it is not.
- The code is `backend/export.js`. The Worker answers both paths before any other route, and the
  Hub answers its internal half before any other path, so nothing on the way writes.

## The deploy

The same deploy turns on Workers logs (`observability.enabled: true` in `backend/wrangler.jsonc`),
which the migration uses as evidence. It changes no schema, so a rollback to the version before
it (`wrangler rollback`) is safe, and the data is the same either way.

## Tests

- `backend/tests/export.test.js`: the routes through the Worker's own `fetch` over in-memory
  SQLite: parts round-trip, secret tables refused, key and body checks, and every statement a
  read.
- `backend/tests/export-workerd.test.js`: the same in a local workerd (Miniflare) over real
  Durable Object SQLite, seeded through a test-only Hub subclass, with workerd's own cursors
  reporting 0 rows written.
