#!/usr/bin/env python3
"""Rakuen Web UI - HTTP server bridging Web UI to tmux sessions.

Provides API endpoints for:
- Health check
- tmux session status and validation
- Pane log retrieval (all agents)
- Command sending (uichan only)
- Preset command listing

Binds to 127.0.0.1 with auto-incrementing port (8080-8099).
Requires: PyYAML
"""

import datetime
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

import yaml

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_MAP = {
    "uichan": "rakuen:0.0",
    "aichan": "multiagent:0.0",
    "kobito1": "multiagent:0.1",
    "kobito2": "multiagent:0.2",
    "kobito3": "multiagent:0.3",
    "kobito4": "multiagent:0.4",
    "kobito5": "multiagent:0.5",
    "kobito6": "multiagent:0.6",
    "kobito7": "multiagent:0.7",
    "kobito8": "multiagent:0.8",
}

DEFAULT_LINES = 300
MIN_LINES = 50
MAX_LINES = 1000
MAX_SEND_BYTES = 8192  # 8KB

BIND_HOST = "127.0.0.1"
PORT_RANGE_START = 8080
PORT_RANGE_END = 8099

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

AGENT_LABELS = {
    "user": "User",
    "uichan": "UI-chan",
    "aichan": "AI-chan",
    "kobito1": "Kobito 1",
    "kobito2": "Kobito 2",
    "kobito3": "Kobito 3",
    "kobito4": "Kobito 4",
    "kobito5": "Kobito 5",
    "kobito6": "Kobito 6",
    "kobito7": "Kobito 7",
    "kobito8": "Kobito 8",
}

# ---------------------------------------------------------------------------
# YAML parsing helpers (PyYAML-based)
# ---------------------------------------------------------------------------

# Short key -> full key mapping for token-reduced YAML
_SHORT_KEY_MAP = {
    "ts": "timestamp",
    "cmd": "command",
    "wid": "worker_id",
    "desc": "description",
    "sc": "skill_candidate",
    "st": "status",
}


def _normalize_keys(item):
    """Apply short-key to full-key mapping on a dict.

    Short keys take priority; full keys serve as fallback.
    """
    if not isinstance(item, dict):
        return item
    result = {}
    for k, v in item.items():
        full_key = _SHORT_KEY_MAP.get(k, k)
        if full_key not in result:
            result[full_key] = v
    return result


def _extract_yaml_items(text):
    """Parse YAML text and return a flat list of dicts.

    Handles three structures written by agents:
      1. List-of-dicts under a key:  queue:\\n  - id: ...
      2. Single dict under a key:    task:\\n  task_id: ...
      3. Flat dict (no nesting):     worker_id: ...\\ntask_id: ...

    Returns a list of dicts with short keys normalized to full keys.
    """
    if not text or not text.strip():
        return []

    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        return []

    if data is None:
        return []

    items = []

    if isinstance(data, list):
        # Top-level list
        for item in data:
            if isinstance(item, dict):
                items.append(_normalize_keys(item))
    elif isinstance(data, dict):
        if len(data) == 1:
            # Single top-level key: unwrap container (queue: [...], task: {...})
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
            # Multiple top-level keys: flat dict
            items.append(_normalize_keys(data))

    return items


def _extract_md_section(text, heading_keyword):
    """Extract body text under a ## heading containing *heading_keyword*.

    Returns the text between the matched heading and the next ## heading,
    or empty string if not found / body is empty.
    """
    lines = text.splitlines()
    capturing = False
    body_lines = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## "):
            if capturing:
                break  # reached next section
            if heading_keyword in stripped:
                capturing = True
                continue  # skip the heading line itself
        elif capturing:
            body_lines.append(stripped)

    return "\n".join(body_lines).strip()


# ---------------------------------------------------------------------------
# Watchdog constants
# ---------------------------------------------------------------------------

DEAD_COMMANDS = {"bash", "zsh", "sh", ""}
WATCHDOG_INTERVAL = 30          # seconds between health checks
WATCHDOG_INITIAL_DELAY = 120    # seconds to wait after startup
MAX_RESTARTS_PER_WINDOW = 3     # max restarts per agent within window
CIRCUIT_BREAKER_WINDOW = 600    # 10 minutes sliding window
CIRCUIT_BREAKER_COOLDOWN = 300  # 5 minutes cooldown after trip

# ---------------------------------------------------------------------------
# Globals (set in main)
# ---------------------------------------------------------------------------

RAKUEN_HOME = ""
REPO_ROOT = ""
WORKSPACE_DIR = ""
STATIC_DIR = ""

# Watchdog state
_restart_state = {}             # {agent: {"attempts": [ts], "tripped_at": None|ts}}
_restart_lock = threading.Lock()
_agent_restart_locks = {}       # {agent: Lock} prevents concurrent restart of same agent
_last_health = {}               # cached health check results
_last_health_lock = threading.Lock()
_watchdog_enabled = True
_LOG_FILE = None


# ---------------------------------------------------------------------------
# Watchdog: logging, circuit breaker, health check, restart
# ---------------------------------------------------------------------------


def _log(level, message):
    """Log a message to stderr and optionally to a log file."""
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {message}"
    sys.stderr.write(line + "\n")
    if _LOG_FILE:
        try:
            with open(_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


def _can_restart(agent_name):
    """Check if agent restart is allowed by the circuit breaker.

    Returns (allowed: bool, reason: str).
    """
    with _restart_lock:
        state = _restart_state.setdefault(
            agent_name, {"attempts": [], "tripped_at": None}
        )
        now = time.time()

        # If tripped, check cooldown
        if state["tripped_at"] is not None:
            elapsed = now - state["tripped_at"]
            if elapsed < CIRCUIT_BREAKER_COOLDOWN:
                remaining = int(CIRCUIT_BREAKER_COOLDOWN - elapsed)
                return False, f"Circuit breaker tripped. Cooldown: {remaining}s remaining."
            # Cooldown expired: reset
            state["tripped_at"] = None
            state["attempts"] = []

        # Prune old attempts outside the window
        cutoff = now - CIRCUIT_BREAKER_WINDOW
        state["attempts"] = [t for t in state["attempts"] if t > cutoff]

        if len(state["attempts"]) >= MAX_RESTARTS_PER_WINDOW:
            state["tripped_at"] = now
            return False, (
                f"Circuit breaker tripped: {MAX_RESTARTS_PER_WINDOW} restarts"
                f" in {CIRCUIT_BREAKER_WINDOW}s."
            )

        return True, ""


def _record_restart(agent_name):
    """Record a restart attempt for the circuit breaker."""
    with _restart_lock:
        state = _restart_state.setdefault(
            agent_name, {"attempts": [], "tripped_at": None}
        )
        state["attempts"].append(time.time())


def _get_agent_lock(agent_name):
    """Get or create a per-agent restart lock."""
    with _restart_lock:
        if agent_name not in _agent_restart_locks:
            _agent_restart_locks[agent_name] = threading.Lock()
        return _agent_restart_locks[agent_name]


def _check_agent_health(agent_name):
    """Check health of a single agent via tmux.

    Returns {"status": "alive"|"dead"|"session_missing", "command": "..."}.
    """
    target = AGENT_MAP.get(agent_name)
    if not target:
        return {"status": "unknown", "command": ""}
    try:
        result = subprocess.run(
            ["tmux", "display-message", "-t", target, "-p", "#{pane_current_command}"],
            capture_output=True, text=True, timeout=5,
        )
        cmd = result.stdout.strip()
        if result.returncode != 0 or not cmd:
            return {"status": "session_missing", "command": ""}
        if cmd in DEAD_COMMANDS:
            return {"status": "dead", "command": cmd}
        return {"status": "alive", "command": cmd}
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return {"status": "session_missing", "command": ""}


def _check_all_health():
    """Check health of all agents. Returns {agent_name: {status, command}}."""
    result = {}
    for agent_name in AGENT_MAP:
        result[agent_name] = _check_agent_health(agent_name)
    return result


def _restart_agent(agent_name):
    """Restart a single agent via rakuen-launch --restart-agent.

    Returns {"ok": bool, "message": str}.
    """
    # Per-agent lock to prevent concurrent restarts
    agent_lock = _get_agent_lock(agent_name)
    if not agent_lock.acquire(blocking=False):
        return {"ok": False, "message": f"Agent '{agent_name}' restart already in progress."}

    try:
        # Circuit breaker check
        allowed, reason = _can_restart(agent_name)
        if not allowed:
            return {"ok": False, "message": reason}

        # Record attempt
        _record_restart(agent_name)

        launch_script = os.path.join(RAKUEN_HOME, "bin", "rakuen-launch")
        try:
            result = subprocess.run(
                [launch_script, REPO_ROOT, "--restart-agent", agent_name],
                capture_output=True, text=True, timeout=180,
            )
            if result.returncode == 0:
                try:
                    data = json.loads(result.stdout.strip())
                    if data.get("restarted"):
                        _log("INFO", f"Agent '{agent_name}' restarted successfully.")
                        return {"ok": True, "message": f"Agent '{agent_name}' restarted."}
                except json.JSONDecodeError:
                    pass
                return {"ok": True, "message": f"Agent '{agent_name}' restart completed (exit 0)."}
            else:
                msg = result.stderr.strip() or result.stdout.strip() or "Unknown error"
                _log("ERROR", f"Agent '{agent_name}' restart failed: {msg}")
                return {"ok": False, "message": msg}
        except subprocess.TimeoutExpired:
            _log("ERROR", f"Agent '{agent_name}' restart timed out (180s).")
            return {"ok": False, "message": "Restart timed out (180s)."}
        except FileNotFoundError:
            return {"ok": False, "message": "rakuen-launch script not found."}
    finally:
        agent_lock.release()


def _watchdog_loop():
    """Background watchdog loop. Checks agent health and triggers restarts."""
    global _last_health

    _log("INFO", f"Watchdog: waiting {WATCHDOG_INITIAL_DELAY}s for initial setup...")
    time.sleep(WATCHDOG_INITIAL_DELAY)
    _log("INFO", "Watchdog: starting health monitoring.")

    while _watchdog_enabled:
        try:
            health = _check_all_health()

            with _last_health_lock:
                _last_health = health

            for agent_name, info in health.items():
                if info["status"] == "dead":
                    _log(
                        "WARN",
                        f"Watchdog: agent '{agent_name}' is dead"
                        f" (command: {info['command']}). Attempting restart...",
                    )
                    result = _restart_agent(agent_name)
                    _log(
                        "INFO" if result["ok"] else "ERROR",
                        f"Watchdog: restart of '{agent_name}': {result['message']}",
                    )
                elif info["status"] == "session_missing":
                    _log(
                        "ERROR",
                        f"Watchdog: tmux session for '{agent_name}' is missing."
                        " Cannot auto-restart.",
                    )
        except Exception as e:
            _log("ERROR", f"Watchdog: unexpected error: {e}")

        time.sleep(WATCHDOG_INTERVAL)


def _start_watchdog():
    """Start the watchdog daemon thread."""
    thread = threading.Thread(target=_watchdog_loop, daemon=True, name="watchdog")
    thread.start()
    _log("INFO", "Watchdog thread started.")


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

class RakuenHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for the Rakuen Web UI."""

    server_version = "RakuenWebUI/1.0"

    def do_GET(self):
        """Route GET requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._handle_health()
        elif path == "/api/status":
            self._handle_status()
        elif path == "/api/pane":
            self._handle_pane(parsed.query)
        elif path == "/api/presets":
            self._handle_presets()
        elif path == "/api/activity":
            self._handle_activity()
        elif path == "/api/panes":
            self._handle_panes(parsed.query)
        elif path == "/api/dashboard":
            self._handle_dashboard()
        elif path == "/api/agents/health":
            self._handle_agents_health()
        elif path == "/" or path == "/index.html":
            self._serve_static("index.html")
        elif path.startswith("/static/"):
            # Strip /static/ prefix
            file_path = path[len("/static/"):]
            self._serve_static(file_path)
        else:
            self._send_error(404, "Not found")

    def do_POST(self):
        """Route POST requests."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/send":
            self._handle_send()
        elif path == "/api/send-escape":
            self._handle_send_escape()
        elif path == "/api/restart":
            self._handle_restart()
        else:
            self._send_error(404, "Not found")

    # -- API handlers -------------------------------------------------------

    def _handle_health(self):
        """GET /api/health -> {"ok": true}"""
        self._send_json({"ok": True})

    def _handle_status(self):
        """GET /api/status -> tmux status + validation result."""
        try:
            launch_script = os.path.join(RAKUEN_HOME, "bin", "rakuen-launch")
            result = subprocess.run(
                [launch_script, REPO_ROOT, "--verify-only"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            # Parse the JSON output from rakuen-launch
            if result.stdout.strip():
                status = json.loads(result.stdout.strip())
            else:
                status = {
                    "valid": False,
                    "errors": ["rakuen-launch produced no output"],
                    "sessions": {"rakuen": {"exists": False}, "multiagent": {"exists": False}},
                    "pane_meta": {},
                }
        except subprocess.TimeoutExpired:
            status = {
                "valid": False,
                "errors": ["rakuen-launch timed out"],
                "sessions": {"rakuen": {"exists": False}, "multiagent": {"exists": False}},
                "pane_meta": {},
            }
        except (json.JSONDecodeError, FileNotFoundError) as e:
            status = {
                "valid": False,
                "errors": [f"Error running rakuen-launch: {e}"],
                "sessions": {"rakuen": {"exists": False}, "multiagent": {"exists": False}},
                "pane_meta": {},
            }

        self._send_json(status)

    def _handle_pane(self, query_string):
        """GET /api/pane?agent=<name>&lines=<N> -> pane log text."""
        params = urllib.parse.parse_qs(query_string)

        # Validate agent parameter
        agent = params.get("agent", [None])[0]
        if not agent or agent not in AGENT_MAP:
            self._send_error(
                400,
                f"Invalid agent. Must be one of: {', '.join(sorted(AGENT_MAP.keys()))}",
            )
            return

        # Parse and clamp lines parameter
        try:
            lines = int(params.get("lines", [str(DEFAULT_LINES)])[0])
        except (ValueError, IndexError):
            lines = DEFAULT_LINES
        lines = max(MIN_LINES, min(MAX_LINES, lines))

        # Get tmux target
        target = AGENT_MAP[agent]

        # Capture pane content
        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", target, "-p", "-S", f"-{lines}"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            text = result.stdout
        except subprocess.TimeoutExpired:
            text = "[ERROR: tmux capture-pane timed out]"
        except FileNotFoundError:
            text = "[ERROR: tmux not found]"

        self._send_json({"agent": agent, "lines": lines, "text": text})

    def _handle_send(self):
        """POST /api/send -> send text to rakuen:0.0."""
        # Read body with size limit
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > MAX_SEND_BYTES:
            self._send_error(413, f"Request body too large. Maximum: {MAX_SEND_BYTES} bytes")
            return

        if content_length == 0:
            self._send_error(400, "Empty request body")
            return

        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_error(400, "Invalid JSON")
            return

        text = data.get("text", "").strip()
        if not text:
            self._send_error(400, "Empty text")
            return

        if len(text.encode("utf-8")) > MAX_SEND_BYTES:
            self._send_error(413, f"Text too large. Maximum: {MAX_SEND_BYTES} bytes")
            return

        # Send to uichan (always rakuen:0.0)
        # Use 2-bash-call pattern: text first, then Enter separately
        try:
            subprocess.run(
                ["tmux", "send-keys", "-t", "rakuen:0.0", "--", text],
                check=True,
                timeout=5,
            )
            time.sleep(1)
            subprocess.run(
                ["tmux", "send-keys", "-t", "rakuen:0.0", "Enter"],
                check=True,
                timeout=5,
            )
            self._send_json({"ok": True})
        except subprocess.CalledProcessError as e:
            self._send_error(500, f"tmux send-keys failed: {e}")
        except subprocess.TimeoutExpired:
            self._send_error(500, "tmux send-keys timed out")
        except FileNotFoundError:
            self._send_error(500, "tmux not found")

    def _handle_send_escape(self):
        """POST /api/send-escape -> send Escape key to rakuen:0.0."""
        try:
            subprocess.run(
                ["tmux", "send-keys", "-t", "rakuen:0.0", "Escape"],
                check=True,
                timeout=5,
            )
            self._send_json({"ok": True})
        except subprocess.CalledProcessError as e:
            self._send_error(500, f"tmux send-keys failed: {e}")
        except subprocess.TimeoutExpired:
            self._send_error(500, "tmux send-keys timed out")
        except FileNotFoundError:
            self._send_error(500, "tmux not found")

    def _handle_presets(self):
        """GET /api/presets -> preset definitions from presets.json."""
        presets_path = os.path.join(RAKUEN_HOME, "config", "presets.json")
        try:
            with open(presets_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._send_json(data)
        except FileNotFoundError:
            self._send_json({"presets": []})
        except json.JSONDecodeError:
            self._send_json({"presets": [], "error": "Invalid presets.json"})

    def _handle_activity(self):
        """GET /api/activity -> activity timeline entries from YAML files."""
        entries = []

        # 0. User -> UI-chan inputs
        self._parse_yaml_entries(
            os.path.join(WORKSPACE_DIR, "queue", "user_to_uichan.yaml"),
            entry_type="user_input",
            from_agent="user",
            to_agent="uichan",
            entries=entries,
        )

        # 1. UI-chan -> AI-chan commands
        self._parse_yaml_entries(
            os.path.join(WORKSPACE_DIR, "queue", "uichan_to_aichan.yaml"),
            entry_type="command",
            from_agent="uichan",
            to_agent="aichan",
            entries=entries,
        )

        # 2. AI-chan -> Kobito N task assignments
        for n in range(1, 9):
            self._parse_yaml_entries(
                os.path.join(WORKSPACE_DIR, "queue", "tasks", f"kobito{n}.yaml"),
                entry_type="assignment",
                from_agent="aichan",
                to_agent=f"kobito{n}",
                entries=entries,
            )

        # 3. Kobito N reports
        for n in range(1, 9):
            self._parse_yaml_entries(
                os.path.join(WORKSPACE_DIR, "queue", "reports", f"kobito{n}_report.yaml"),
                entry_type="report",
                from_agent=f"kobito{n}",
                to_agent=None,
                entries=entries,
            )

        # 4. Dashboard attention items (要対応 / 伺い事項)
        self._parse_dashboard_attention(entries)

        # 5. AI-chan activity log
        self._parse_yaml_entries(
            os.path.join(WORKSPACE_DIR, "queue", "activity", "aichan.yaml"),
            entry_type="progress",
            from_agent="aichan",
            to_agent=None,
            entries=entries,
        )

        # 6. Kobito N activity logs
        for n in range(1, 9):
            self._parse_yaml_entries(
                os.path.join(
                    WORKSPACE_DIR, "queue", "activity", f"kobito{n}.yaml",
                ),
                entry_type="progress",
                from_agent=f"kobito{n}",
                to_agent=None,
                entries=entries,
            )

        # Sort by timestamp ascending; null timestamps go to end
        entries.sort(key=lambda e: (
            e["timestamp"] is None,
            e["timestamp"] or "",
        ))

        self._send_json({"entries": entries})

    def _parse_yaml_entries(self, filepath, entry_type, from_agent, to_agent, entries):
        """Parse a YAML file and append activity entries."""
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                text = f.read()
        except (FileNotFoundError, UnicodeDecodeError):
            return

        items = _extract_yaml_items(text)
        for item in items:
            # Skip idle / empty entries
            task_id = item.get("task_id") or item.get("id")
            status = item.get("status", "")
            if isinstance(status, bool):
                status = str(status)
            if status == "idle" and not task_id:
                continue
            if not task_id or str(task_id) == "null":
                continue

            action = ""
            for _k in ("command", "description", "action", "summary",
                        "content", "message", "status"):
                _v = item.get(_k, "")
                if _v and str(_v) != "null":
                    action = _v
                    break
            entries.append({
                "timestamp": (
                    item.get("timestamp") or item.get("time")
                ),
                "from": from_agent,
                "from_label": AGENT_LABELS.get(
                    from_agent, from_agent
                ),
                "to": to_agent,
                "to_label": (
                    AGENT_LABELS.get(to_agent) if to_agent
                    else None
                ),
                "action": str(action),
                "task_id": str(task_id),
                "type": entry_type,
                "status": str(status),
            })

    def _parse_dashboard_attention(self, entries):
        """Parse dashboard.md for attention / inquiry sections."""
        path = os.path.join(WORKSPACE_DIR, "dashboard.md")
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except (FileNotFoundError, UnicodeDecodeError):
            return

        for section in ("要対応", "伺い事項"):
            content = _extract_md_section(text, section)
            if content and content.strip() != "なし":
                entries.append({
                    "timestamp": None,
                    "from": "system",
                    "from_label": "System",
                    "to": None,
                    "to_label": None,
                    "action": content.strip(),
                    "task_id": None,
                    "type": "attention",
                    "status": "attention",
                    "section": section,
                })

    def _handle_panes(self, query_string):
        """GET /api/panes -> all 10 pane outputs."""
        params = urllib.parse.parse_qs(query_string)

        try:
            lines = int(params.get("lines", [str(DEFAULT_LINES)])[0])
        except (ValueError, IndexError):
            lines = DEFAULT_LINES
        lines = max(MIN_LINES, min(MAX_LINES, lines))

        panes = {}
        for agent, target in AGENT_MAP.items():
            try:
                result = subprocess.run(
                    ["tmux", "capture-pane", "-t", target, "-p", "-S", f"-{lines}"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                text = result.stdout
            except subprocess.TimeoutExpired:
                text = "[ERROR: tmux capture-pane timed out]"
            except FileNotFoundError:
                text = "[ERROR: tmux not found]"

            panes[agent] = {"agent": agent, "lines": lines, "text": text}

        self._send_json({"panes": panes})

    def _handle_dashboard(self):
        """GET /api/dashboard -> dashboard.md content."""
        dashboard_path = os.path.join(WORKSPACE_DIR, "dashboard.md")
        try:
            with open(dashboard_path, "r", encoding="utf-8") as f:
                content = f.read()
        except (FileNotFoundError, UnicodeDecodeError):
            content = ""

        self._send_json({"content": content})

    def _handle_agents_health(self):
        """GET /api/agents/health -> per-agent health + circuit breaker status."""
        with _last_health_lock:
            health = dict(_last_health)

        # If no cached data yet, fetch live
        if not health:
            health = _check_all_health()

        result = {}
        for agent_name in AGENT_MAP:
            agent_health = health.get(agent_name, {"status": "unknown", "command": ""})
            allowed, reason = _can_restart(agent_name)
            result[agent_name] = {
                "status": agent_health["status"],
                "command": agent_health.get("command", ""),
                "restart_allowed": allowed,
                "circuit_breaker_reason": reason if not allowed else "",
                "label": AGENT_LABELS.get(agent_name, agent_name),
            }

        self._send_json({"agents": result, "watchdog_active": _watchdog_enabled})

    def _handle_restart(self):
        """POST /api/restart -> restart a specific agent."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0 or content_length > 1024:
            self._send_error(400, "Invalid request body")
            return

        body = self.rfile.read(content_length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._send_error(400, "Invalid JSON")
            return

        agent_name = data.get("agent", "").strip()
        if not agent_name or agent_name not in AGENT_MAP:
            self._send_error(
                400,
                f"Invalid agent. Must be one of: {', '.join(sorted(AGENT_MAP.keys()))}",
            )
            return

        _log("INFO", f"Manual restart requested for agent '{agent_name}'.")

        # Run restart in a thread to avoid blocking the HTTP response for 180s
        def do_restart():
            result = _restart_agent(agent_name)
            _log(
                "INFO" if result["ok"] else "ERROR",
                f"Manual restart of '{agent_name}': {result['message']}",
            )

        # Check circuit breaker first to give immediate feedback
        allowed, reason = _can_restart(agent_name)
        if not allowed:
            self._send_json({"ok": False, "message": reason}, status=503)
            return

        # Check if restart already in progress
        agent_lock = _get_agent_lock(agent_name)
        if not agent_lock.acquire(blocking=False):
            self._send_json(
                {"ok": False, "message": f"Agent '{agent_name}' restart already in progress."},
                status=409,
            )
            return
        agent_lock.release()

        threading.Thread(target=do_restart, daemon=True).start()
        self._send_json({"ok": True, "message": f"Restart initiated for agent '{agent_name}'."})

    # -- Static file serving ------------------------------------------------

    def _serve_static(self, file_path):
        """Serve a static file from STATIC_DIR."""
        # Security: prevent path traversal
        safe_path = Path(STATIC_DIR) / file_path
        try:
            safe_path = safe_path.resolve()
            if not str(safe_path).startswith(str(Path(STATIC_DIR).resolve())):
                self._send_error(403, "Forbidden")
                return
        except (ValueError, OSError):
            self._send_error(400, "Invalid path")
            return

        if not safe_path.is_file():
            self._send_error(404, "File not found")
            return

        # Determine content type
        suffix = safe_path.suffix.lower()
        content_type = MIME_TYPES.get(suffix, "application/octet-stream")

        try:
            with open(safe_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except OSError:
            self._send_error(500, "Failed to read file")

    # -- Response helpers ---------------------------------------------------

    def _send_json(self, data, status=200):
        """Send a JSON response."""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        """Send a JSON error response."""
        self._send_json({"error": message}, status=status)

    def log_message(self, format, *args):
        """Override to prefix log messages."""
        sys.stderr.write(f"[RakuenWebUI] {args[0]} {args[1]} {args[2]}\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global RAKUEN_HOME, REPO_ROOT, WORKSPACE_DIR, STATIC_DIR, _LOG_FILE

    RAKUEN_HOME = os.environ.get(
        "RAKUEN_HOME",
        f"/home/{os.environ.get('USER', 'unknown')}/rakuen",
    )
    REPO_ROOT = os.environ.get("REPO_ROOT", os.getcwd())
    WORKSPACE_DIR = os.environ.get(
        "WORKSPACE_DIR",
        os.path.join(
            RAKUEN_HOME, "workspaces", os.path.basename(REPO_ROOT)
        ),
    )
    STATIC_DIR = os.path.join(RAKUEN_HOME, "webui", "static")

    # Setup watchdog log file
    log_dir = os.path.join(WORKSPACE_DIR, "logs")
    os.makedirs(log_dir, exist_ok=True)
    _LOG_FILE = os.path.join(log_dir, "watchdog.log")

    # Determine starting port
    port_start = int(os.environ.get("PORT_START", str(PORT_RANGE_START)))

    # Try ports in range
    server = None
    actual_port = None

    for port in range(port_start, PORT_RANGE_END + 1):
        try:
            server = http.server.HTTPServer((BIND_HOST, port), RakuenHandler)
            actual_port = port
            break
        except OSError:
            sys.stderr.write(f"[RakuenWebUI] Port {port} in use, trying next...\n")
            continue

    if server is None:
        sys.stderr.write(f"ERROR: No available port in {port_start}-{PORT_RANGE_END}\n")
        sys.exit(1)

    sys.stderr.write(f"\n")
    sys.stderr.write(f"  Rakuen Web UI\n")
    sys.stderr.write(f"  URL: http://{BIND_HOST}:{actual_port}\n")
    sys.stderr.write(f"  RAKUEN_HOME:   {RAKUEN_HOME}\n")
    sys.stderr.write(f"  WORKSPACE_DIR: {WORKSPACE_DIR}\n")
    sys.stderr.write(f"  REPO_ROOT:     {REPO_ROOT}\n")
    sys.stderr.write(f"  Press Ctrl+C to stop.\n")
    sys.stderr.write(f"\n")

    # Start watchdog thread
    _start_watchdog()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[RakuenWebUI] Shutting down...\n")
        server.shutdown()


if __name__ == "__main__":
    main()
