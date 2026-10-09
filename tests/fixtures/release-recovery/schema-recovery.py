"""Native SQLite fixtures; no provider, live database, or private data access."""
import json
import pathlib
import sqlite3
import tempfile
import sys

root = pathlib.Path(sys.argv[1]) if len(sys.argv) == 2 else pathlib.Path(__file__).parent
live = (root / "live-schema.sql").read_text()
candidate = (root / "candidate-schema.sql").read_text()
statements = [item.strip() for item in candidate.split(";") if item.strip()]


def seed(db):
    db.executescript(live)
    for i, stage in enumerate(["queued", "running", "waiting_for_owner", "completed"], 1):
        request = "synthetic-" + stage
        db.execute("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,?,?,?,?,?,?)",
                   (request, "user", "synthetic request", "2000-01-01T00:00:00Z", "owner-fixture", "device-fixture", "owner-password-session"))
        reply = None
        if stage == "completed":
            reply = "synthetic-immutable-reply"
            db.execute("INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,?,?,?,?,?,?,?)",
                       (reply, "reply", request, "synthetic immutable accepted reply", "2000-01-01T00:00:00Z", "owner-fixture", "device-fixture", "owner-password-session"))
        db.execute("""INSERT INTO relay_owner_jobs(seq,id,request_id,principal,device_id,title,action_kind,specified,stage,created_ms,updated_ms,result_reply_id,root_job_id,attempt,outcome,lease_run_id,lease_grant_id,lease_expires_ms)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (i, request, request, "owner-fixture", "device-fixture", "synthetic title", "read_only", 1, stage, 1, 2, reply, request, 1,
                    "known" if stage == "completed" else "not_started", "synthetic-run" if stage == "running" else None,
                    "synthetic-grant" if stage == "running" else None, 5 if stage == "running" else None))
    for sub in ["public-fixture", "owner-fixture"]:
        for seq, status in [(1, "pending"), (2, "failed"), (3, "delivered")]:
            db.execute("INSERT INTO relay_outbox VALUES(?,?,?,?,?,?,?)", (sub, seq, "synthetic payload", status, 6 if status == "failed" else 1, seq, "timeout" if status == "failed" else None))
    db.execute("INSERT INTO relay_delivery_receipts VALUES(3,123)")
    db.execute("INSERT INTO shared_entries(id,kind,body,created_at) VALUES('public-fixture','user','synthetic public message','2000-01-01T00:00:00Z')")
    db.execute("INSERT INTO shared_entries(id,kind,reply_to,body,created_at) VALUES('public-reply','reply','public-fixture','synthetic public reply','2000-01-01T00:00:00Z')")


def preserved_rows(db):
    names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence' ORDER BY name")]
    return {name: list(db.execute('SELECT * FROM "' + name + '" ORDER BY rowid')) for name in names}


interruptions = 0
with tempfile.TemporaryDirectory(prefix="jarvis-schema-recovery-") as directory:
    for stop in range(len(statements) + 1):
        path = pathlib.Path(directory) / (str(stop) + ".sqlite")
        db = sqlite3.connect(path, isolation_level=None)
        db.execute("PRAGMA foreign_keys=ON")
        seed(db)
        before = preserved_rows(db)
        for statement in statements[:stop]:
            db.execute(statement)
        db.close()  # Simulates interruption after any committed DDL statement.
        db = sqlite3.connect(path, isolation_level=None)
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript(candidate)
        db.executescript(candidate)  # Constructor/schema rerun must be idempotent.
        after = preserved_rows(db)
        assert all(after[name] == rows for name, rows in before.items())
        # The older code's schema/read shape is valid against additive tables
        # and indexes; this alone does not qualify an old Worker for production.
        db.executescript(live)
        assert list(db.execute("SELECT stage,lease_run_id,lease_grant_id,lease_expires_ms FROM relay_owner_jobs WHERE stage='running'")) == [("running", "synthetic-run", "synthetic-grant", 5)]
        assert db.execute("SELECT body FROM relay_owner_entries WHERE id='synthetic-immutable-reply'").fetchone()[0] == "synthetic immutable accepted reply"
        assert db.execute("SELECT count(*) FROM relay_outbox WHERE status IN ('pending','failed')").fetchone()[0] == 4
        assert list(db.execute("SELECT accepted_ms FROM relay_delivery_receipts WHERE event_seq=3")) == [(123,)]
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        interruptions += 1
        db.close()
    # SQLite backup is exercised locally and kept distinct from blob backup or
    # provider recovery. A later write demonstrates the restore loss window.
    original = sqlite3.connect(":memory:", isolation_level=None)
    seed(original)
    snapshot = sqlite3.connect(":memory:", isolation_level=None)
    original.backup(snapshot)
    original.execute("INSERT INTO shared_entries(id,kind,body,created_at) VALUES('after-snapshot','user','synthetic later request','2000-01-02T00:00:00Z')")
    restored = sqlite3.connect(":memory:", isolation_level=None)
    snapshot.backup(restored)
    assert original.execute("SELECT count(*) FROM shared_entries").fetchone()[0] == 3
    assert restored.execute("SELECT count(*) FROM shared_entries").fetchone()[0] == 2
    assert restored.execute("SELECT count(*) FROM relay_outbox WHERE status='delivered'").fetchone()[0] == 2
    # Existing accepted delivery/reply evidence must prevent replay. No new
    # claims, grants, retries, callbacks, schedule changes or message sends occur.
    assert restored.execute("SELECT accepted_ms FROM relay_delivery_receipts WHERE event_seq=3").fetchone()[0] == 123
print(json.dumps({"schema": 1, "ddlInterruptionPoints": interruptions, "pendingRowsPreserved": 4,
                  "runningLeasePreserved": True, "immutableReplyPreserved": True,
                  "sqliteRestoreLossWindowDemonstrated": True, "providerRestoreVerified": False}))
