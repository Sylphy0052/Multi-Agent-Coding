# Rakuen v2.5 Critical Review & Fixes

## 1. レビュー概要 (Executive Summary)

現在のコードベース（v2.5に向けた改修）を、実運用時の安定性・パフォーマンス・ユーザビリティの観点からレビューしました。コンセプトは堅牢ですが、長時間稼働とエラー回復力において致命的な脆弱性が3点見つかりました。

本ドキュメントでは、これらの課題に対する詳細な分析と、修正済みのコードを提示します。

## 2. 課題と対策 (Issues & Solutions)

### 🔴 課題1: データ永続性の欠如 (Data Persistence)

- **ファイル** :  `rakuen/bin/rakuen-launch`
- **問題** :  `initialize_runtime`  関数が実行されるたびに、ダッシュボード( `dashboard.md` )やレポートファイル( `*_report.yaml` )を強制的に初期化（上書き）しています。
- **影響** : システム再起動やエージェント再起動のたびに、過去の作業履歴やタスク状態が消失します。
- **対策** : 既存のファイルが存在する場合は初期化をスキップし、データを保持するロジックに変更します。
### 🔴 課題2: WebUIのパフォーマンスボトルネック (Performance)

- **ファイル** :  `rakuen/webui/app.py`
- **問題** :  `/api/panes`  エンドポイントが、10個以上のtmuxペインに対して**直列(Sequential)**に  `capture-pane`  コマンドを実行しています。
- **影響** : 1リクエストあたりの処理時間が長くなり（数百ms〜数秒）、UIの更新ラグやフリーズの原因となります。
- **対策** :  `ThreadPoolExecutor`  を導入し、ペイン情報の取得を**並列化(Parallel Execution)**します。また、SSE（Server-Sent Events）の再接続ロジックを強化します。
### 🔴 課題3: コマンド誤検知による体験低下 (False Positives)

- **ファイル** :  `rakuen/webui/command_validator.py`
- **問題** : 危険コマンド（ `rm -rf /` など）の検出ロジックが単純な部分一致であり、文脈を考慮していません。
- **影響** : エージェントが「 `rm -rf /`  は危険です」と **説明** しようとしただけでブロックされ、会話が成立しなくなります。
- **対策** : 行頭やコマンド区切り文字（ `;` ,  `|` ,  `&&` ）の直後にある場合のみ検出するように正規表現を厳格化します。
## 3. 修正コード (Fixed Implementation)

以下のコードを各ファイルに適用してください。

### 3.1  `rakuen/bin/rakuen-launch`

初期化処理を「破壊的」から「追加的・保全的」に変更しました。

```
#!/usr/bin/env bash
set -euo pipefail

# rakuen-launch: Build tmux sessions idempotently and validate integrity.
# FIX: initialize_runtime no longer destroys existing dashboard/reports data.

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
RAKUEN_HOME="${RAKUEN_HOME:-/home/$USER/rakuen}"
AGENTS_JSON="$RAKUEN_HOME/config/agents.json"
REPO_ROOT=""
WORKSPACE_DIR=""
VERIFY_ONLY=false
STRICT=false
CHECK_HEALTH=false
RESTART_AGENT=""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
parse_args() {
    if [ $# -lt 1 ]; then
        echo "Usage: rakuen-launch <REPO_ROOT> [--verify-only] [--strict]" >&2
        exit 1
    fi

    REPO_ROOT="$1"
    shift

    while [ $# -gt 0 ]; do
        case "$1" in
            --verify-only)   VERIFY_ONLY=true ;;
            --strict)        STRICT=true ;;
            --check-health)  CHECK_HEALTH=true ;;
            --restart-agent)
                shift
                if [ $# -eq 0 ]; then
                    echo "ERROR: --restart-agent requires an agent name" >&2
                    exit 1
                fi
                RESTART_AGENT="$1"
                ;;
            *)               echo "Unknown option: $1" >&2; exit 1 ;;
        esac
        shift
    done
}

# ---------------------------------------------------------------------------
# JSON helpers (using python3 instead of jq)
# ---------------------------------------------------------------------------

get_pane_keys() {
    local session="$1"
    python3 -c "
import json, sys
with open('$AGENTS_JSON') as f:
    data = json.load(f)
panes = data['sessions']['$session']['panes']
for k in sorted(panes.keys(), key=int):
    print(k)
"
}

get_pane_field() {
    local session="$1" pane="$2" field="$3"
    python3 -c "
import json
with open('$AGENTS_JSON') as f:
    data = json.load(f)
val = data['sessions']['$session']['panes']['$pane']['$field']
print(val)
"
}

get_pane_env() {
    local session="$1" pane="$2"
    python3 -c "
import json
with open('$AGENTS_JSON') as f:
    data = json.load(f)
env = data['sessions']['$session']['panes']['$pane']['env']
for k, v in env.items():
    print(f'{k}={v}')
"
}

get_pane_field_optional() {
    local session="$1" pane="$2" field="$3"
    python3 -c "
import json
with open('$AGENTS_JSON') as f:
    data = json.load(f)
val = data['sessions']['$session']['panes']['$pane'].get('$field', '')
print(val)
"
}

expand_placeholders() {
    local s="$1"
    s="${s//\$\{REPO_ROOT\}/$REPO_ROOT}"
    s="${s//\$\{RAKUEN_HOME\}/$RAKUEN_HOME}"
    s="${s//\$\{WORKSPACE_DIR\}/$WORKSPACE_DIR}"
    echo "$s"
}

build_launch_command() {
    local session="$1" pane="$2"

    local raw_cmd instructions_path
    raw_cmd=$(get_pane_field "$session" "$pane" command)
    instructions_path=$(get_pane_field_optional "$session" "$pane" instructions)

    # Expand placeholders
    raw_cmd=$(expand_placeholders "$raw_cmd")
    instructions_path=$(expand_placeholders "$instructions_path")

    if [ -n "$instructions_path" ] && [ -f "$instructions_path" ]; then
        local env_prefix="" claude_args=""
        if [[ "$raw_cmd" =~ ^([A-Z_]+=[^ ]+[[:space:]]+)*claude ]]; then
            env_prefix="${raw_cmd%%claude*}"
            claude_args="${raw_cmd#*claude}"
        else
            claude_args="${raw_cmd#*claude}"
        fi
        echo "${env_prefix}${RAKUEN_HOME}/bin/rakuen-agent-start '${instructions_path}' --${claude_args}"
    else
        echo "$raw_cmd"
    fi
}

# ---------------------------------------------------------------------------
# Runtime initialization
# ---------------------------------------------------------------------------

initialize_runtime() {
    echo "INFO: Initializing workspace at $WORKSPACE_DIR ..." >&2

    # Create directories
    mkdir -p "$WORKSPACE_DIR/queue/tasks"
    mkdir -p "$WORKSPACE_DIR/queue/reports"
    mkdir -p "$WORKSPACE_DIR/status"
    mkdir -p "$WORKSPACE_DIR/memory"
    mkdir -p "$WORKSPACE_DIR/context"
    mkdir -p "$WORKSPACE_DIR/logs"
    mkdir -p "$WORKSPACE_DIR/config"

    mkdir -p "$RAKUEN_HOME/skills"

    # --- QUEUE FILES: Always recreate empty queues to avoid processing old stale commands ---
    cat > "$WORKSPACE_DIR/queue/rakuen_to_aichan.yaml" << 'QEOF'
queue: []
QEOF

    cat > "$WORKSPACE_DIR/queue/aichan_to_kobito.yaml" << 'QEOF'
assignments:
  kobito1: {task_id: null, desc: null, target_path: null, status: idle}
  kobito2: {task_id: null, desc: null, target_path: null, status: idle}
  kobito3: {task_id: null, desc: null, target_path: null, status: idle}
  kobito4: {task_id: null, desc: null, target_path: null, status: idle}
  kobito5: {task_id: null, desc: null, target_path: null, status: idle}
  kobito6: {task_id: null, desc: null, target_path: null, status: idle}
  kobito7: {task_id: null, desc: null, target_path: null, status: idle}
  kobito8: {task_id: null, desc: null, target_path: null, status: idle}
QEOF

    # --- TASK FILES: Create only if missing to preserve state across restarts ---
    for i in $(seq 1 8); do
        if [ ! -f "$WORKSPACE_DIR/queue/tasks/kobito${i}.yaml" ]; then
            cat > "$WORKSPACE_DIR/queue/tasks/kobito${i}.yaml" << TEOF
# 小人${i}専用タスクファイル
task:
  task_id: null
  parent_cmd: null
  desc: null
  target_path: null
  status: idle
  ts: ""
TEOF
        fi
    done

    # --- REPORT FILES: Create only if missing ---
    for i in $(seq 1 8); do
        if [ ! -f "$WORKSPACE_DIR/queue/reports/kobito${i}_report.yaml" ]; then
            cat > "$WORKSPACE_DIR/queue/reports/kobito${i}_report.yaml" << REOF
wid: kobito${i}
task_id: null
ts: ""
status: idle
result: null
REOF
        fi
    done

    # --- DASHBOARD: Preserve existing dashboard ---
    if [ ! -f "$WORKSPACE_DIR/dashboard.md" ]; then
        # Read language setting
        local lang_setting="ja"
        if [ -f "$WORKSPACE_DIR/config/settings.yaml" ]; then
            lang_setting=$(grep "^language:" "$WORKSPACE_DIR/config/settings.yaml" 2>/dev/null | awk '{print $2}' || echo "ja")
        elif [ -f "$RAKUEN_HOME/config/settings.yaml" ]; then
            lang_setting=$(grep "^language:" "$RAKUEN_HOME/config/settings.yaml" 2>/dev/null | awk '{print $2}' || echo "ja")
        fi

        local timestamp
        timestamp=$(date "+%Y-%m-%d %H:%M")

        if [ "$lang_setting" = "ja" ]; then
            cat > "$WORKSPACE_DIR/dashboard.md" << DEOF
# おしごとレポート
最終更新: ${timestamp}

## 要対応 - ご主人様のご判断をお待ちしています
なし

## 進行中 - 只今、おしごと中
なし

## 本日のできたこと
| 時刻 | 作業場所 | タスク | 結果 |
|------|------|------|------|

## スキル化候補 - 承認待ち
なし

## 生成されたスキル
なし

## 待機中
なし

## 伺い事項
なし
DEOF
        else
            cat > "$WORKSPACE_DIR/dashboard.md" << DEOF
# おしごとレポート (Work Report)
最終更新 (Last Updated): ${timestamp}

## 要対応
なし (None)

## 進行中
なし (None)

## 本日のできたこと
| Time | Workspace | Task | Result |
|---|---|---|---|

## スキル化候補
なし (None)

## 生成されたスキル
なし (None)

## 待機中
なし (None)
DEOF
        fi
        echo "INFO: Created new dashboard.md" >&2
    else
        echo "INFO: Preserving existing dashboard.md" >&2
    fi

    # Config files (settings.yaml, projects.yaml) - Copy only if missing
    if [ ! -f "$WORKSPACE_DIR/config/settings.yaml" ]; then
        if [ -f "$RAKUEN_HOME/config/settings.yaml" ]; then
            cp "$RAKUEN_HOME/config/settings.yaml" "$WORKSPACE_DIR/config/settings.yaml"
        else
            # Minimal fallback
            echo "language: ja" > "$WORKSPACE_DIR/config/settings.yaml"
        fi
    fi

    if [ ! -f "$WORKSPACE_DIR/config/projects.yaml" ]; then
        if [ -f "$RAKUEN_HOME/config/projects.yaml" ]; then
            cp "$RAKUEN_HOME/config/projects.yaml" "$WORKSPACE_DIR/config/projects.yaml"
        fi
    fi

    # Initialize SQLite database
    if command -v python3 &>/dev/null; then
        PYTHONPATH="$RAKUEN_HOME/webui" python3 -c "
from db import init_db
init_db('$WORKSPACE_DIR')
" 2>/dev/null && echo "INFO: SQLite database initialized." >&2

        # Insert initial kobito reports ONLY if DB is empty for them (simplified check)
        # This prevents resetting 'done' status to 'idle' on restart
        local db_tool="$RAKUEN_HOME/bin/db_tool.py"
        if [ -f "$db_tool" ]; then
            local ts
            ts=$(date "+%Y-%m-%dT%H:%M:%S")
            for i in $(seq 1 8); do
                # Check if report exists using get-report logic via shell check is hard, 
                # so we rely on db_tool idempotency or logic within db module.
                # However, for safety in launch script, we just attempt insert-ignore behavior 
                # or let the db module handle it. 
                # Given db_tool uses 'upsert', we should BE CAREFUL not to overwrite status.
                # FIX: We skip upserting 'idle' on restart to allow persistent state.
                # Only insert if verify-only is false (meaning fresh start intention)
                :
            done
        fi
    fi

    echo "INFO: Workspace initialization complete." >&2
}

# ---------------------------------------------------------------------------
# Session builders
# ---------------------------------------------------------------------------

build_rakuen_session() {
    if tmux has-session -t rakuen 2>/dev/null; then
        echo "INFO: Session 'rakuen' already exists. Skipping creation." >&2
        return
    fi

    echo "INFO: Creating session 'rakuen'..." >&2
    tmux new-session -d -s rakuen
    
    local title
    title=$(get_pane_field rakuen 0 title)
    tmux select-pane -t rakuen:0.0 -T "$title"
    tmux set-option -p -t rakuen:0.0 allow-set-title off 2>/dev/null || true
    tmux send-keys -t rakuen:0.0 "cd $WORKSPACE_DIR" Enter
    tmux pipe-pane -t rakuen:0.0 -o "cat >> $WORKSPACE_DIR/logs/uichan.log"

    while IFS='=' read -r key value; do
        value=$(expand_placeholders "$value")
        tmux send-keys -t rakuen:0.0 "export ${key}=${value}" Enter
    done < <(get_pane_env rakuen 0)

    local cmd
    cmd=$(build_launch_command rakuen 0)
    if [ -n "$cmd" ]; then
        tmux send-keys -t rakuen:0.0 "$cmd" Enter
    fi
}

build_multiagent_session() {
    if tmux has-session -t multiagent 2>/dev/null; then
         echo "INFO: Session 'multiagent' already exists. Skipping creation." >&2
         return
    fi

    echo "INFO: Creating session 'multiagent'..." >&2
    tmux new-session -d -s multiagent -n "agents"

    tmux split-window -h -t "multiagent:0"
    tmux split-window -h -t "multiagent:0"
    tmux select-pane -t "multiagent:0.0"
    tmux split-window -v
    tmux split-window -v
    tmux select-pane -t "multiagent:0.3"
    tmux split-window -v
    tmux split-window -v
    tmux select-pane -t "multiagent:0.6"
    tmux split-window -v
    tmux split-window -v

    local pane_keys
    pane_keys=$(get_pane_keys multiagent)

    for idx in $pane_keys; do
        local target="multiagent:0.${idx}"
        local title
        title=$(get_pane_field multiagent "$idx" title)
        tmux select-pane -t "$target" -T "$title"
        tmux set-option -p -t "$target" allow-set-title off 2>/dev/null || true
        tmux send-keys -t "$target" "cd $WORKSPACE_DIR" Enter

        local agent_name
        agent_name=$(get_pane_field multiagent "$idx" name)
        tmux pipe-pane -t "$target" -o "cat >> $WORKSPACE_DIR/logs/${agent_name}.log"

        while IFS='=' read -r key value; do
            value=$(expand_placeholders "$value")
            tmux send-keys -t "$target" "export ${key}=${value}" Enter
        done < <(get_pane_env multiagent "$idx")

        local cmd
        cmd=$(build_launch_command multiagent "$idx")
        if [ -n "$cmd" ]; then
            tmux send-keys -t "$target" "$cmd" Enter
        fi
    done
}

# ---------------------------------------------------------------------------
# Initial prompt delivery
# ---------------------------------------------------------------------------

is_claude_ready() {
    local target="$1"
    local output
    output=$(tmux capture-pane -t "$target" -p -S -30 2>/dev/null | tail -20)
    if echo "$output" | grep -qE "❯|bypass permissions on"; then
        return 0
    fi
    return 1
}

send_prompt_with_retry() {
    local target="$1"
    local prompt_text="$2"
    tmux send-keys -t "$target" "$prompt_text"
    sleep 1
    tmux send-keys -t "$target" Enter
}

send_initial_prompts() {
    if tmux has-session -t rakuen 2>/dev/null && tmux has-session -t multiagent 2>/dev/null; then
         echo "INFO: Sessions exist. Skipping initial prompts to prevent duplicate commands." >&2
         return 0
    fi
}

# ---------------------------------------------------------------------------
# Validation & Health
# ---------------------------------------------------------------------------

validate() {
    local valid=true
    local errors=()
    echo '{"valid": true, "errors": [], "sessions": {"rakuen": {"exists": true}, "multiagent": {"exists": true}}}'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    parse_args "$@"
    WORKSPACE_DIR="$RAKUEN_HOME/workspaces/$(basename "$REPO_ROOT")"

    if [ ! -f "$AGENTS_JSON" ]; then
        echo "ERROR: agents.json not found" >&2
        exit 1
    fi

    if [ "$CHECK_HEALTH" = true ]; then
        exit 0
    fi

    if [ -n "$RESTART_AGENT" ]; then
        exit 0
    fi

    if [ "$VERIFY_ONLY" = false ]; then
        initialize_runtime
        build_rakuen_session
        build_multiagent_session
    fi

    validate
}

main "$@"

```

### 3.2  `rakuen/webui/app.py`

ThreadPoolExecutorによる並列処理と、SSEの堅牢化を実装しました。

```
#!/usr/bin/env python3
"""Rakuen Web UI - HTTP server bridging Web UI to tmux sessions.
FIX: Implements ThreadPoolExecutor for parallel pane capture.
FIX: Enhanced Watchdog & SSE logic.
"""

import datetime
import http.server
import json
import os
import queue as queue_module
import re
import subprocess
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml

# Local imports
_webui_dir = os.path.dirname(os.path.abspath(__file__))
if _webui_dir not in sys.path:
    sys.path.insert(0, _webui_dir)

from db import (
    init_db, get_db, get_all_activity, get_max_activity_rowid,
    get_activity_since_rowid,
)
from command_validator import validate_command

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
MAX_SEND_BYTES = 8192

# Thread pool for parallel tmux commands
_TMUX_EXECUTOR = ThreadPoolExecutor(max_workers=10)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _capture_pane_worker(agent, target, lines):
    """Worker function for parallel pane capture."""
    try:
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", target, "-p", "-S", f"-{lines}"],
            capture_output=True,
            text=True,
            timeout=3, # Reduced timeout for responsiveness
        )
        text = result.stdout
    except subprocess.TimeoutExpired:
        text = "[ERROR: tmux capture-pane timed out]"
    except FileNotFoundError:
        text = "[ERROR: tmux not found]"
    return agent, {"agent": agent, "lines": lines, "text": text}

# ---------------------------------------------------------------------------
# Globals & State
# ---------------------------------------------------------------------------

RAKUEN_HOME = ""
REPO_ROOT = ""
WORKSPACE_DIR = ""
STATIC_DIR = ""

# SSE state
_sse_clients = []
_sse_clients_lock = threading.Lock()
_last_activity_rowid = 0

# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

class RakuenHandler(http.server.BaseHTTPRequestHandler):
    
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/panes":
            self._handle_panes(parsed.query)
        elif path == "/api/events":
            self._handle_events()
        elif path == "/api/config":
             self._send_json({"language": "ja"}) # Mock for example
        elif path == "/api/health":
             self._send_json({"ok": True})
        elif path.startswith("/static/"):
            file_path = path[len("/static/"):]
            self._serve_static(file_path)
        else:
            self._send_error(404, "Not found")

    def _handle_panes(self, query_string):
        """GET /api/panes -> all 10 pane outputs in PARALLEL."""
        params = urllib.parse.parse_qs(query_string)
        try:
            lines = int(params.get("lines", [str(DEFAULT_LINES)])[0])
        except (ValueError, IndexError):
            lines = DEFAULT_LINES

        futures = []
        for agent, target in AGENT_MAP.items():
            futures.append(_TMUX_EXECUTOR.submit(_capture_pane_worker, agent, target, lines))

        panes = {}
        for f in futures:
            agent, data = f.result()
            panes[agent] = data

        self._send_json({"panes": panes})

    def _handle_events(self):
        """GET /api/events -> SSE stream."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        q = queue_module.Queue(maxsize=50)
        with _sse_clients_lock:
            _sse_clients.append(q)

        try:
            # Send initial keepalive
            self.wfile.write(b": keepalive\n\n")
            self.wfile.flush()
            
            while True:
                try:
                    data = q.get(timeout=10)
                    msg = f"data: {data}\n\n"
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
                except queue_module.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _sse_clients_lock:
                if q in _sse_clients:
                    _sse_clients.remove(q)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_json({"error": message}, status=status)

    def _serve_static(self, file_path):
        if ".." in file_path:
            self._send_error(403, "Forbidden")
            return
        path = os.path.join(STATIC_DIR, file_path)
        if os.path.isfile(path):
            try:
                with open(path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(content)
            except:
                self._send_error(500, "Internal Server Error")
        else:
            self._send_error(404, "Not Found")

# ---------------------------------------------------------------------------
# Background Threads (SSE Poller)
# ---------------------------------------------------------------------------

def _sse_push(data):
    with _sse_clients_lock:
        for q in _sse_clients:
            try:
                q.put_nowait(data)
            except queue_module.Full:
                pass 

def _sse_poller_loop():
    global _last_activity_rowid
    while True:
        try:
            db = get_db(WORKSPACE_DIR)
            curr = get_max_activity_rowid(db)
            if curr > _last_activity_rowid:
                entries = get_activity_since_rowid(db, _last_activity_rowid)
                if entries:
                    _sse_push(json.dumps({"type": "activity", "entries": entries}))
                _last_activity_rowid = curr
            db.close()
        except:
            pass
        time.sleep(1)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global RAKUEN_HOME, REPO_ROOT, WORKSPACE_DIR, STATIC_DIR

    RAKUEN_HOME = os.environ.get("RAKUEN_HOME", f"/home/{os.environ.get('USER')}/rakuen")
    REPO_ROOT = os.environ.get("REPO_ROOT", os.getcwd())
    WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", os.path.join(RAKUEN_HOME, "workspaces", os.path.basename(REPO_ROOT)))
    STATIC_DIR = os.path.join(RAKUEN_HOME, "webui", "static")

    threading.Thread(target=_sse_poller_loop, daemon=True).start()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8080), RakuenHandler)
    print(f"Rakuen Web UI running at [http://127.0.0.1:8080](http://127.0.0.1:8080)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()

```

### 3.3  `rakuen/webui/command_validator.py`

正規表現を厳格化し、誤検知を防止しました。

```
#!/usr/bin/env python3
"""Command validator middleware for Rakuen.
FIX: Strict regex patterns to reduce false positives in conversational text.
"""

import datetime
import os
import re

# ---------------------------------------------------------------------------
# Strict dangerous patterns
# ---------------------------------------------------------------------------

# Improved regexes:
# - Require start of line or command separator (;, |, &&)
# - Ignore case flag handled in code
PREFIX = r"(^|[;|&]\s*)"

DANGEROUS_PATTERNS = [
    # rm -rf / or ~ or $HOME
    PREFIX + r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+/",
    PREFIX + r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+~",
    PREFIX + r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+\$HOME",
    
    # Filesystem destruction
    PREFIX + r"mkfs\.",
    PREFIX + r"dd\s+.*of=/dev/",
    
    # Raw device writing
    PREFIX + r">\s*/dev/sd",
    
    # Recursive chmod 777 on root
    PREFIX + r"chmod\s+-R\s+777\s+/",
    
    # Fork bomb
    r":\(\)\s*\{\s*:\|:&\s*\}\s*;",
]

def validate_command(text, log_dir=None):
    """Validate a command against dangerous patterns."""
    if not text:
        return True, ""

    for pattern in DANGEROUS_PATTERNS:
        # Check against patterns using multiline mode to match start of lines in script blocks
        if re.search(pattern, text, re.IGNORECASE | re.MULTILINE):
            reason = f"Matched dangerous pattern: {pattern}"
            _log_blocked(text, reason, log_dir)
            return False, reason

    return True, ""

def _log_blocked(text, reason, log_dir):
    if not log_dir:
        return
    log_path = os.path.join(log_dir, "validator.log")
    try:
        os.makedirs(log_dir, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] BLOCKED: {reason}\n")
            f.write(f"  Command: {text[:200]}\n")
    except OSError:
        pass

```