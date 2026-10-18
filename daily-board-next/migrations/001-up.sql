-- REVIEW ONLY. Execute inside the existing shared Durable Object transaction,
-- after sharedSchema. Never run against a separate D1 database.
CREATE TABLE IF NOT EXISTS daily_board_reports (
  entry_id TEXT PRIMARY KEY REFERENCES shared_entries(id),
  payload TEXT NOT NULL CHECK(length(payload) <= 20000)
);
