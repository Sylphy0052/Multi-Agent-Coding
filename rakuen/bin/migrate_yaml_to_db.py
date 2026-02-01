#!/usr/bin/env python3
"""Migrate YAML queue files to SQLite database.

Reads existing YAML queue files from $RAKUEN_WORKSPACE/queue/ and inserts
them into the SQLite database. Uses INSERT OR IGNORE for idempotency.
Source YAML files are NOT deleted.

Usage:
    RAKUEN_WORKSPACE=/path/to/workspace python3 migrate_yaml_to_db.py
"""

import os
import sys

# Resolve db.py from rakuen/webui/
_script_dir = os.path.dirname(os.path.abspath(__file__))
_webui_dir = os.path.join(os.path.dirname(_script_dir), "webui")
if _webui_dir not in sys.path:
    sys.path.insert(0, _webui_dir)

import yaml

from db import (
    get_db,
    init_db,
    upsert_user_input,
    upsert_command,
    upsert_task,
    upsert_report,
    insert_activity,
)


# Short key -> full key mapping (same as app.py)
_SHORT_KEY_MAP = {
    "ts": "timestamp",
    "cmd": "command",
    "wid": "worker_id",
    "desc": "description",
    "sc": "skill_candidate",
    "st": "status",
}


def _normalize_keys(item):
    """Apply short-key to full-key mapping on a dict."""
    if not isinstance(item, dict):
        return item
    result = {}
    for k, v in item.items():
        full_key = _SHORT_KEY_MAP.get(k, k)
        if full_key not in result:
            result[full_key] = v
    return result


def _parse_yaml_file(filepath):
    """Parse a YAML file and return a flat list of dicts."""
    if not os.path.isfile(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except (yaml.YAMLError, OSError):
        return []
    if data is None:
        return []

    items = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                items.append(_normalize_keys(item))
    elif isinstance(data, dict):
        if len(data) == 1:
            value = next(iter(data.values()))
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        items.append(_normalize_keys(item))
            elif isinstance(value, dict):
                items.append(_normalize_keys(value))
            else:
                items.append(_normalize_keys(data))
        else:
            items.append(_normalize_keys(data))
    return items


def _migrate_user_inputs(db, queue_dir):
    """Migrate user_to_uichan.yaml to user_inputs table."""
    count = 0
    filepath = os.path.join(queue_dir, "user_to_uichan.yaml")
    for item in _parse_yaml_file(filepath):
        entry = {
            "id": item.get("id", ""),
            "ts": item.get("timestamp", ""),
            "command": item.get("command", ""),
            "project": item.get("project"),
            "priority": item.get("priority", "medium"),
            "status": item.get("status", "pending"),
        }
        if entry["id"] and entry["ts"]:
            upsert_user_input(db, entry)
            count += 1
    return count


def _migrate_commands(db, queue_dir):
    """Migrate uichan_to_aichan.yaml to commands table."""
    count = 0
    filepath = os.path.join(queue_dir, "uichan_to_aichan.yaml")
    for item in _parse_yaml_file(filepath):
        entry = {
            "id": item.get("id", ""),
            "ts": item.get("timestamp", ""),
            "command": item.get("command", ""),
            "project": item.get("project"),
            "priority": item.get("priority", "medium"),
            "status": item.get("status", "pending"),
        }
        if entry["id"] and entry["ts"]:
            upsert_command(db, entry)
            count += 1
    return count


def _migrate_tasks(db, queue_dir):
    """Migrate tasks/kobito*.yaml to tasks table."""
    count = 0
    tasks_dir = os.path.join(queue_dir, "tasks")
    if not os.path.isdir(tasks_dir):
        return 0
    for fname in sorted(os.listdir(tasks_dir)):
        if not fname.endswith(".yaml"):
            continue
        filepath = os.path.join(tasks_dir, fname)
        # Extract worker id from filename (e.g. kobito1.yaml -> kobito1)
        wid = fname.replace(".yaml", "")
        for item in _parse_yaml_file(filepath):
            entry = {
                "task_id": item.get("task_id", ""),
                "parent_cmd": item.get("parent_cmd"),
                "wid": item.get("worker_id", wid),
                "desc": item.get("description", ""),
                "target_path": item.get("target_path"),
                "status": item.get("status", "idle"),
                "ts": item.get("timestamp", ""),
            }
            if entry["task_id"]:
                upsert_task(db, entry)
                count += 1
    return count


def _migrate_reports(db, queue_dir):
    """Migrate reports/kobito*_report.yaml to reports table."""
    count = 0
    reports_dir = os.path.join(queue_dir, "reports")
    if not os.path.isdir(reports_dir):
        return 0
    for fname in sorted(os.listdir(reports_dir)):
        if not fname.endswith(".yaml"):
            continue
        filepath = os.path.join(reports_dir, fname)
        for item in _parse_yaml_file(filepath):
            entry = {
                "wid": item.get("worker_id", ""),
                "task_id": item.get("task_id", ""),
                "ts": item.get("timestamp", ""),
                "status": item.get("status", "idle"),
                "result": item.get("result"),
                "sc": item.get("skill_candidate"),
            }
            if entry["wid"]:
                upsert_report(db, entry)
                count += 1
    return count


def _migrate_activity(db, queue_dir):
    """Migrate activity/*.yaml to activity table."""
    count = 0
    activity_dir = os.path.join(queue_dir, "activity")
    if not os.path.isdir(activity_dir):
        return 0
    for fname in sorted(os.listdir(activity_dir)):
        if not fname.endswith(".yaml"):
            continue
        filepath = os.path.join(activity_dir, fname)
        agent = fname.replace(".yaml", "")
        for item in _parse_yaml_file(filepath):
            entry = {
                "id": item.get("id", ""),
                "agent": item.get("agent", agent),
                "ts": item.get("timestamp", ""),
                "action": item.get("action", ""),
                "status": item.get("status"),
                "task_id": item.get("task_id"),
            }
            if entry["id"] and entry["ts"]:
                insert_activity(db, entry)
                count += 1
    return count


def main():
    """Run the migration."""
    workspace = os.environ.get("RAKUEN_WORKSPACE")
    if not workspace:
        print("Error: RAKUEN_WORKSPACE environment variable not set.",
              file=sys.stderr)
        sys.exit(1)

    queue_dir = os.path.join(workspace, "queue")
    if not os.path.isdir(queue_dir):
        print(f"Warning: Queue directory not found: {queue_dir}",
              file=sys.stderr)
        sys.exit(0)

    # Initialize DB
    init_db(workspace)
    db = get_db(workspace)

    try:
        counts = {
            "user_inputs": _migrate_user_inputs(db, queue_dir),
            "commands": _migrate_commands(db, queue_dir),
            "tasks": _migrate_tasks(db, queue_dir),
            "reports": _migrate_reports(db, queue_dir),
            "activity": _migrate_activity(db, queue_dir),
        }
    finally:
        db.close()

    # Print summary
    total = sum(counts.values())
    print(f"Migration complete. Total: {total} entries.")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
