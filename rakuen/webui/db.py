#!/usr/bin/env python3
"""Rakuen SQLite database module.

Provides schema initialization and CRUD operations for the Rakuen system.
Uses WAL mode for concurrent read/write access by multiple agents.
"""

import datetime
import os
import sqlite3
import uuid


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS user_inputs (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    command TEXT NOT NULL,
    project TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    command TEXT NOT NULL,
    project TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    parent_cmd TEXT,
    wid TEXT NOT NULL,
    desc TEXT,
    target_path TEXT,
    status TEXT DEFAULT 'idle',
    ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
    wid TEXT NOT NULL,
    task_id TEXT,
    ts TEXT,
    status TEXT DEFAULT 'idle',
    result TEXT,
    sc TEXT,
    PRIMARY KEY (wid, task_id)
);

CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT,
    task_id TEXT
);

CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent);
CREATE INDEX IF NOT EXISTS idx_tasks_wid ON tasks(wid);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_reports_wid ON reports(wid);
"""


# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

def get_db(workspace_dir):
    """Return a sqlite3.Connection to the workspace database.

    Enables WAL mode and sets busy_timeout to 5000ms for
    concurrent access by multiple agents.
    """
    db_path = os.path.join(workspace_dir, "rakuen.db")
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db(workspace_dir):
    """Initialize all tables in the workspace database.

    Idempotent: uses CREATE TABLE IF NOT EXISTS for every table.
    """
    os.makedirs(workspace_dir, exist_ok=True)
    conn = get_db(workspace_dir)
    try:
        conn.executescript(_SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()


def reset_db(workspace_dir):
    """Drop all tables and recreate them.

    WARNING: This destroys all data. Use only for testing or full reset.
    """
    conn = get_db(workspace_dir)
    try:
        for table in ("user_inputs", "commands", "tasks", "reports",
                       "activity", "kv_store"):
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        conn.executescript(_SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _gen_id(prefix=""):
    """Generate a unique ID with optional prefix."""
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def _now_iso():
    """Return current time in ISO8601 format."""
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def upsert_user_input(db, entry):
    """Insert or update a user input entry."""
    db.execute(
        """INSERT OR REPLACE INTO user_inputs
           (id, ts, command, project, priority, status)
           VALUES (:id, :ts, :command, :project, :priority, :status)""",
        {
            "id": entry.get("id", _gen_id("ui_")),
            "ts": entry.get("ts", _now_iso()),
            "command": entry.get("command", ""),
            "project": entry.get("project"),
            "priority": entry.get("priority", "medium"),
            "status": entry.get("status", "pending"),
        },
    )
    db.commit()


def upsert_command(db, entry):
    """Insert or update a command entry."""
    db.execute(
        """INSERT OR REPLACE INTO commands
           (id, ts, command, project, priority, status)
           VALUES (:id, :ts, :command, :project, :priority, :status)""",
        {
            "id": entry.get("id", _gen_id("cmd_")),
            "ts": entry.get("ts", _now_iso()),
            "command": entry.get("command", ""),
            "project": entry.get("project"),
            "priority": entry.get("priority", "medium"),
            "status": entry.get("status", "pending"),
        },
    )
    db.commit()


def upsert_task(db, entry):
    """Insert or update a task assignment entry."""
    db.execute(
        """INSERT OR REPLACE INTO tasks
           (task_id, parent_cmd, wid, desc, target_path, status, ts)
           VALUES (:task_id, :parent_cmd, :wid, :desc,
                   :target_path, :status, :ts)""",
        {
            "task_id": entry.get("task_id", _gen_id("task_")),
            "parent_cmd": entry.get("parent_cmd"),
            "wid": entry.get("wid", ""),
            "desc": entry.get("desc"),
            "target_path": entry.get("target_path"),
            "status": entry.get("status", "idle"),
            "ts": entry.get("ts", _now_iso()),
        },
    )
    db.commit()


def upsert_report(db, entry):
    """Insert or update a kobito report entry."""
    db.execute(
        """INSERT OR REPLACE INTO reports
           (wid, task_id, ts, status, result, sc)
           VALUES (:wid, :task_id, :ts, :status, :result, :sc)""",
        {
            "wid": entry.get("wid", ""),
            "task_id": entry.get("task_id", ""),
            "ts": entry.get("ts", _now_iso()),
            "status": entry.get("status", "idle"),
            "result": entry.get("result"),
            "sc": entry.get("sc"),
        },
    )
    db.commit()


def insert_activity(db, entry):
    """Insert an activity log entry."""
    db.execute(
        """INSERT OR REPLACE INTO activity
           (id, agent, ts, action, status, task_id)
           VALUES (:id, :agent, :ts, :action, :status, :task_id)""",
        {
            "id": entry.get("id", _gen_id("act_")),
            "agent": entry.get("agent", ""),
            "ts": entry.get("ts", _now_iso()),
            "action": entry.get("action", ""),
            "status": entry.get("status"),
            "task_id": entry.get("task_id"),
        },
    )
    db.commit()


def get_all_activity(db, since=None):
    """Return all activity entries, optionally filtered by timestamp.

    If since is provided, only entries with ts > since are returned.
    Results are ordered by ts ascending.
    """
    if since:
        rows = db.execute(
            "SELECT * FROM activity WHERE ts > ? ORDER BY ts ASC",
            (since,),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM activity ORDER BY ts ASC"
        ).fetchall()
    return [dict(row) for row in rows]


def get_all_tasks(db):
    """Return all task entries ordered by timestamp ascending."""
    rows = db.execute(
        "SELECT * FROM tasks ORDER BY ts ASC"
    ).fetchall()
    return [dict(row) for row in rows]


def get_all_reports(db):
    """Return all report entries ordered by timestamp ascending."""
    rows = db.execute(
        "SELECT * FROM reports ORDER BY ts ASC"
    ).fetchall()
    return [dict(row) for row in rows]


def get_all_user_inputs(db):
    """Return all user input entries ordered by timestamp ascending."""
    rows = db.execute(
        "SELECT * FROM user_inputs ORDER BY ts ASC"
    ).fetchall()
    return [dict(row) for row in rows]


def get_all_commands(db):
    """Return all command entries ordered by timestamp ascending."""
    rows = db.execute(
        "SELECT * FROM commands ORDER BY ts ASC"
    ).fetchall()
    return [dict(row) for row in rows]


def get_tasks_by_worker(db, wid):
    """Return all tasks assigned to a specific worker."""
    rows = db.execute(
        "SELECT * FROM tasks WHERE wid = ? ORDER BY ts ASC",
        (wid,),
    ).fetchall()
    return [dict(row) for row in rows]


def get_report_by_worker(db, wid):
    """Return the latest report for a specific worker."""
    row = db.execute(
        "SELECT * FROM reports WHERE wid = ? ORDER BY ts DESC LIMIT 1",
        (wid,),
    ).fetchone()
    return dict(row) if row else None


def get_max_activity_rowid(db):
    """Return the maximum rowid in the activity table."""
    row = db.execute("SELECT MAX(rowid) as max_id FROM activity").fetchone()
    return row["max_id"] if row and row["max_id"] else 0


def get_activity_since_rowid(db, rowid):
    """Return activity entries with rowid greater than the given value."""
    rows = db.execute(
        "SELECT *, rowid FROM activity WHERE rowid > ? ORDER BY ts ASC",
        (rowid,),
    ).fetchall()
    return [dict(row) for row in rows]


def kv_get(db, key):
    """Get a value from the key-value store."""
    row = db.execute(
        "SELECT value FROM kv_store WHERE key = ?", (key,)
    ).fetchone()
    return row["value"] if row else None


def kv_set(db, key, value):
    """Set a value in the key-value store."""
    db.execute(
        """INSERT OR REPLACE INTO kv_store (key, value, updated_at)
           VALUES (?, ?, ?)""",
        (key, value, _now_iso()),
    )
    db.commit()
