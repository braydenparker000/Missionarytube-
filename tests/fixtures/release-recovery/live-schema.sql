-- Synthetic recovery contract fixture: SQL definitions only.
-- Source braydenparker999/jarvis c4d62409a3b67e4e5dac88809c6a4a0290b6e39e
-- This is not a Cloudflare Durable Object backup/restore procedure.
-- backend/publications.js
CREATE TABLE IF NOT EXISTS imported_comments (comment_id INTEGER PRIMARY KEY, publication TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0, error TEXT);
-- backend/relay-events.js
CREATE TABLE IF NOT EXISTS relay_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
    message_id TEXT NOT NULL UNIQUE, occurred_at TEXT NOT NULL, created_ms INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relay_subscriptions (
    id TEXT PRIMARY KEY, principal TEXT NOT NULL, grant_id TEXT NOT NULL,
    name TEXT NOT NULL, arguments TEXT NOT NULL, callback TEXT NOT NULL,
    secret TEXT NOT NULL, previous_secret TEXT, rotate_until INTEGER,
    expires_ms INTEGER NOT NULL, ack_seq INTEGER NOT NULL, start_seq INTEGER NOT NULL,
    generation TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relay_outbox (
    subscription_id TEXT NOT NULL, event_seq INTEGER NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_ms INTEGER NOT NULL, last_error TEXT,
    PRIMARY KEY(subscription_id,event_seq));
CREATE INDEX IF NOT EXISTS relay_outbox_due ON relay_outbox(status,next_attempt_ms);
CREATE TABLE IF NOT EXISTS relay_delivery_receipts (event_seq INTEGER PRIMARY KEY,accepted_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_outbox_recoveries (
    subscription_id TEXT NOT NULL,event_seq INTEGER NOT NULL,recoveries INTEGER NOT NULL,last_recovery_ms INTEGER NOT NULL,
    PRIMARY KEY(subscription_id,event_seq));
CREATE TABLE IF NOT EXISTS relay_verified (identity TEXT PRIMARY KEY, verified_until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_activations (id TEXT PRIMARY KEY, revision TEXT NOT NULL, expires_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_event_meta (key TEXT PRIMARY KEY,value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_owner_event_bodies (event_id TEXT PRIMARY KEY,body TEXT NOT NULL);
-- backend/relay-oauth.js
CREATE TABLE IF NOT EXISTS relay_oauth (key TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_oauth (key TEXT PRIMARY KEY, category TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
-- backend/relay-owner-jobs.js
CREATE TABLE IF NOT EXISTS relay_owner_jobs (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
    principal TEXT NOT NULL, device_id TEXT NOT NULL,
    title TEXT NOT NULL, action_kind TEXT NOT NULL CHECK(action_kind IN ('unclassified','read_only','draft','consequential')),
    specified INTEGER NOT NULL DEFAULT 0 CHECK(specified IN (0,1)),
    stage TEXT NOT NULL CHECK(stage IN ('queued','running','waiting_for_owner','completed','failed','cancelled')),
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, finished_ms INTEGER,
    result_reply_id TEXT UNIQUE, parent_job_id TEXT UNIQUE, root_job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 5), cancel_requested_ms INTEGER,
    outcome TEXT NOT NULL CHECK(outcome IN ('not_started','known','unknown')),
    failure_code TEXT, failure_message TEXT,
    lease_run_id TEXT, lease_grant_id TEXT, lease_expires_ms INTEGER, acknowledged_ms INTEGER,
    CHECK(id=request_id), FOREIGN KEY(request_id) REFERENCES relay_owner_entries(id));
CREATE INDEX IF NOT EXISTS relay_owner_job_stage_seq ON relay_owner_jobs(stage,seq);
CREATE TABLE IF NOT EXISTS relay_owner_job_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, job_id TEXT NOT NULL,
    kind TEXT NOT NULL, summary TEXT NOT NULL, created_ms INTEGER NOT NULL,
    authentication_source TEXT NOT NULL, argument_json TEXT NOT NULL,
    writer_id TEXT NOT NULL, FOREIGN KEY(job_id) REFERENCES relay_owner_jobs(id));
CREATE INDEX IF NOT EXISTS relay_owner_job_event_order ON relay_owner_job_events(job_id,seq);
CREATE TABLE IF NOT EXISTS relay_owner_job_result_corrections (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version BETWEEN 2 AND 5),
    original_reply_id TEXT NOT NULL, body TEXT NOT NULL, correction_summary TEXT NOT NULL,
    created_ms INTEGER NOT NULL, UNIQUE(job_id,version),
    FOREIGN KEY(id) REFERENCES relay_owner_job_events(id), FOREIGN KEY(job_id) REFERENCES relay_owner_jobs(id),
    FOREIGN KEY(original_reply_id) REFERENCES relay_owner_entries(id));
-- backend/relay-owner-password.js
CREATE TABLE IF NOT EXISTS relay_owner_credentials (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), principal TEXT NOT NULL,
    username TEXT NOT NULL, algorithm TEXT NOT NULL,
    cost_n INTEGER NOT NULL, block_r INTEGER NOT NULL, parallel_p INTEGER NOT NULL,
    salt TEXT NOT NULL, verifier TEXT NOT NULL, version INTEGER NOT NULL,
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
    setup_device_id TEXT NOT NULL, updated_device_id TEXT NOT NULL,
    approval_grant_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relay_owner_credential_consents (
    device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK(purpose IN ('setup','change')),
    credential_version INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relay_owner_password_rates (
    identity TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
-- backend/relay-owner.js
CREATE TABLE IF NOT EXISTS relay_owner_pairings (
    request_id TEXT PRIMARY KEY, code TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL, approved_ms INTEGER, approval_grant_id TEXT);
CREATE TABLE IF NOT EXISTS relay_owner_sessions (
    device_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, principal TEXT NOT NULL,
    label TEXT NOT NULL, created_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL, revoked_ms INTEGER, approval_grant_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS relay_owner_session_expiry ON relay_owner_sessions(expires_ms);
CREATE TABLE IF NOT EXISTS relay_owner_session_audit (
    device_id TEXT PRIMARY KEY, authentication_source TEXT NOT NULL
      CHECK(authentication_source='owner-password-session'),
    credential_version INTEGER NOT NULL CHECK(credential_version>=1));
CREATE TABLE IF NOT EXISTS relay_owner_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('user','reply')), reply_to TEXT UNIQUE,
    body TEXT NOT NULL, created_at TEXT NOT NULL, principal TEXT NOT NULL,
    device_id TEXT NOT NULL, authentication_source TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS relay_owner_entry_kind_seq ON relay_owner_entries(kind,seq);
CREATE TABLE IF NOT EXISTS relay_owner_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relay_owner_pair_rates (identity TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
-- backend/shared.js
CREATE TABLE IF NOT EXISTS shared_entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('user','reply','briefing')),
    reply_to TEXT UNIQUE, title TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shared_kind_seq ON shared_entries(kind, seq);
CREATE TABLE IF NOT EXISTS shared_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shared_briefing_dates (date TEXT PRIMARY KEY, entry_id TEXT NOT NULL);
