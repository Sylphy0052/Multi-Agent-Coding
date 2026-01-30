#!/usr/bin/env python3
"""Rakuen Web UI - HTTP server bridging Web UI to tmux sessions.

Provides API endpoints for:
- Health check
- tmux session status and validation
- Pane log retrieval (all agents)
- Command sending (uichan only)
- Preset command listing

Binds to 127.0.0.1 with auto-incrementing port (8080-8099).
Uses only Python standard library modules.
"""

import http.server
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

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
# Minimal YAML parser (list-of-dicts subset only)
# ---------------------------------------------------------------------------


def parse_simple_yaml(text):
    """Parse a simple YAML list-of-dicts format.

    Handles entries like:
      - task_id: cmd_001
        timestamp: "2026-01-30T10:00:00"
        action: some text here

    Returns a list of dicts. Skips malformed lines.
    """
    if not text or not text.strip():
        return []

    items = []
    current = None

    for line in text.splitlines():
        stripped = line.rstrip()

        # Skip empty lines and comments
        if not stripped or stripped.startswith("#"):
            continue

        # New list item: starts with "- "
        if stripped.startswith("- "):
            if current is not None:
                items.append(current)
            current = {}
            # The rest of the line may contain a key: value
            rest = stripped[2:].strip()
            if rest:
                key, _, val = rest.partition(":")
                if _:
                    current[key.strip()] = _unquote_yaml(val.strip())
        elif current is not None and ":" in stripped:
            # Continuation key: value (indented)
            key, _, val = stripped.strip().partition(":")
            if _:
                current[key.strip()] = _unquote_yaml(val.strip())

    if current is not None:
        items.append(current)

    return items


def _unquote_yaml(val):
    """Remove surrounding quotes from a YAML value."""
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
        return val[1:-1]
    return val


# ---------------------------------------------------------------------------
# Globals (set in main)
# ---------------------------------------------------------------------------

RAKUEN_HOME = ""
REPO_ROOT = ""
WORKSPACE_DIR = ""
STATIC_DIR = ""


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

        # Sort by timestamp ascending; null timestamps go to end
        entries.sort(key=lambda e: (e["timestamp"] is None, e["timestamp"] or ""))

        self._send_json({"entries": entries})

    def _parse_yaml_entries(self, filepath, entry_type, from_agent, to_agent, entries):
        """Parse a YAML file and append activity entries."""
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                text = f.read()
        except (FileNotFoundError, UnicodeDecodeError):
            return

        items = parse_simple_yaml(text)
        for item in items:
            action = (
                item.get("action")
                or item.get("content")
                or item.get("message")
                or item.get("status")
                or ""
            )
            entries.append({
                "timestamp": item.get("timestamp") or item.get("time"),
                "from": from_agent,
                "from_label": AGENT_LABELS.get(from_agent, from_agent),
                "to": to_agent,
                "to_label": AGENT_LABELS.get(to_agent) if to_agent else None,
                "action": str(action),
                "task_id": item.get("task_id") or item.get("id"),
                "type": entry_type,
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
    global RAKUEN_HOME, REPO_ROOT, WORKSPACE_DIR, STATIC_DIR

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

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[RakuenWebUI] Shutting down...\n")
        server.shutdown()


if __name__ == "__main__":
    main()
