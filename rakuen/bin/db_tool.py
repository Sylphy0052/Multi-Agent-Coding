#!/usr/bin/env python3
"""Rakuen DB Tool - CLI for agent database operations.

Provides subcommands for agents to read/write the Rakuen SQLite database
via Bash. Output is YAML-formatted for easy consumption by LLM agents.

Usage:
    db_tool.py upsert-task --task-id ID --wid WID --desc DESC --status STATUS
    db_tool.py upsert-report --wid WID --task-id ID --status STATUS --result TEXT
    db_tool.py add-activity --agent NAME --action TEXT --status STATUS
    db_tool.py get-task --wid WID
    db_tool.py get-report --wid WID
    db_tool.py kv-set --key KEY --value VALUE
    db_tool.py kv-get --key KEY
"""

import argparse
import datetime
import os
import sys

# Resolve db.py from rakuen/webui/
_script_dir = os.path.dirname(os.path.abspath(__file__))
_webui_dir = os.path.join(os.path.dirname(_script_dir), "webui")
if _webui_dir not in sys.path:
    sys.path.insert(0, _webui_dir)

try:
    import yaml
except ImportError:
    yaml = None

from db import (
    get_db,
    init_db,
    upsert_task,
    upsert_report,
    insert_activity,
    get_tasks_by_worker,
    get_report_by_worker,
    kv_get,
    kv_set,
)


def _get_workspace():
    """Resolve workspace directory from environment."""
    ws = os.environ.get("RAKUEN_WORKSPACE")
    if not ws:
        print("Error: RAKUEN_WORKSPACE environment variable not set.",
              file=sys.stderr)
        sys.exit(1)
    return ws


def _now_iso():
    """Return current time in ISO8601 format."""
    return datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _output_yaml(data):
    """Output data in YAML format."""
    if yaml:
        print(yaml.dump(data, default_flow_style=False, allow_unicode=True),
              end="")
    else:
        # Fallback: simple YAML-like output without PyYAML
        if isinstance(data, list):
            for item in data:
                print("---")
                _print_dict(item)
        elif isinstance(data, dict):
            _print_dict(data)
        else:
            print(data)


def _print_dict(d):
    """Print a dict in simple YAML format."""
    for k, v in d.items():
        if v is None:
            print(f"{k}: null")
        elif isinstance(v, str) and ("\n" in v or ":" in v):
            print(f"{k}: |")
            for line in v.splitlines():
                print(f"  {line}")
        else:
            print(f"{k}: {v}")


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def cmd_upsert_task(args):
    """Handle upsert-task subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        entry = {
            "task_id": args.task_id,
            "wid": args.wid,
            "desc": args.desc,
            "status": args.status or "assigned",
            "ts": args.ts or _now_iso(),
        }
        if args.parent_cmd:
            entry["parent_cmd"] = args.parent_cmd
        if args.target_path:
            entry["target_path"] = args.target_path
        upsert_task(db, entry)
        _output_yaml({"ok": True, "task_id": entry["task_id"]})
    finally:
        db.close()


def cmd_upsert_report(args):
    """Handle upsert-report subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        entry = {
            "wid": args.wid,
            "task_id": args.task_id or "",
            "status": args.status or "idle",
            "ts": args.ts or _now_iso(),
        }
        if args.result:
            entry["result"] = args.result
        if args.sc:
            entry["sc"] = args.sc
        upsert_report(db, entry)
        _output_yaml({"ok": True, "wid": entry["wid"]})
    finally:
        db.close()


def cmd_add_activity(args):
    """Handle add-activity subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        entry = {
            "agent": args.agent,
            "action": args.action,
            "ts": args.ts or _now_iso(),
        }
        if args.status:
            entry["status"] = args.status
        if args.task_id:
            entry["task_id"] = args.task_id
        insert_activity(db, entry)
        _output_yaml({"ok": True, "agent": entry["agent"]})
    finally:
        db.close()


def cmd_get_task(args):
    """Handle get-task subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        tasks = get_tasks_by_worker(db, args.wid)
        if tasks:
            _output_yaml(tasks if len(tasks) > 1 else tasks[0])
        else:
            _output_yaml({"status": "idle", "wid": args.wid,
                          "task_id": "null"})
    finally:
        db.close()


def cmd_get_report(args):
    """Handle get-report subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        report = get_report_by_worker(db, args.wid)
        if report:
            _output_yaml(report)
        else:
            _output_yaml({"status": "idle", "wid": args.wid,
                          "task_id": "null"})
    finally:
        db.close()


def cmd_kv_set(args):
    """Handle kv-set subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        kv_set(db, args.key, args.value)
        _output_yaml({"ok": True, "key": args.key})
    finally:
        db.close()


def cmd_kv_get(args):
    """Handle kv-get subcommand."""
    ws = _get_workspace()
    init_db(ws)
    db = get_db(ws)
    try:
        value = kv_get(db, args.key)
        _output_yaml({"key": args.key, "value": value})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser():
    """Build the argument parser with all subcommands."""
    parser = argparse.ArgumentParser(
        prog="db_tool.py",
        description="Rakuen DB Tool - CLI for agent database operations",
    )
    sub = parser.add_subparsers(dest="command", help="Available subcommands")

    # upsert-task
    p = sub.add_parser("upsert-task", help="Insert or update a task")
    p.add_argument("--task-id", required=True, help="Task ID")
    p.add_argument("--wid", required=True, help="Worker ID (kobito1-8)")
    p.add_argument("--desc", default="", help="Task description")
    p.add_argument("--status", default="assigned", help="Task status")
    p.add_argument("--parent-cmd", default=None, help="Parent command ID")
    p.add_argument("--target-path", default=None, help="Target file path")
    p.add_argument("--ts", default=None, help="Timestamp (ISO8601)")
    p.set_defaults(func=cmd_upsert_task)

    # upsert-report
    p = sub.add_parser("upsert-report", help="Insert or update a report")
    p.add_argument("--wid", required=True, help="Worker ID (kobito1-8)")
    p.add_argument("--task-id", default="", help="Task ID")
    p.add_argument("--status", default="idle", help="Report status")
    p.add_argument("--result", default=None, help="Result text")
    p.add_argument("--sc", default=None, help="Skill candidate")
    p.add_argument("--ts", default=None, help="Timestamp (ISO8601)")
    p.set_defaults(func=cmd_upsert_report)

    # add-activity
    p = sub.add_parser("add-activity", help="Add an activity log entry")
    p.add_argument("--agent", required=True, help="Agent name")
    p.add_argument("--action", required=True, help="Action description")
    p.add_argument("--status", default=None, help="Status")
    p.add_argument("--task-id", default=None, help="Related task ID")
    p.add_argument("--ts", default=None, help="Timestamp (ISO8601)")
    p.set_defaults(func=cmd_add_activity)

    # get-task
    p = sub.add_parser("get-task", help="Get tasks for a worker")
    p.add_argument("--wid", required=True, help="Worker ID (kobito1-8)")
    p.set_defaults(func=cmd_get_task)

    # get-report
    p = sub.add_parser("get-report", help="Get latest report for a worker")
    p.add_argument("--wid", required=True, help="Worker ID (kobito1-8)")
    p.set_defaults(func=cmd_get_report)

    # kv-set
    p = sub.add_parser("kv-set", help="Set a key-value pair")
    p.add_argument("--key", required=True, help="Key name")
    p.add_argument("--value", required=True, help="Value")
    p.set_defaults(func=cmd_kv_set)

    # kv-get
    p = sub.add_parser("kv-get", help="Get a value by key")
    p.add_argument("--key", required=True, help="Key name")
    p.set_defaults(func=cmd_kv_get)

    return parser


def main():
    """Entry point."""
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    try:
        args.func(args)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
