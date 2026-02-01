# fix-spec-v1 実装計画書

> **Version**: 1.0.0
> **作成日**: 2026-02-01
> **元仕様**: docs/fix-spec-v1.md (Rakuen System 統合仕様書 v2.5)

## 現状サマリ

| Phase | 進捗 | 概要 |
|-------|------|------|
| Phase 1 | 約80% | PyYAML移行, 短縮キー, pipe-pane, 並列化指示 は済。残3件 |
| Phase 2 | 0% | SQLite + SSE 全て未着手 |
| Phase 3 | 0% | Command Validator + Auto Watchdog 全て未着手 |

### 設計判断メモ

- **format.js の短縮キー対応は不要**: app.py の `_normalize_keys()` がAPIレスポンス生成前に短縮キー→フルキーに変換済み。フロントエンドは常にフルキー(`timestamp`, `command` 等)を受け取るため、format.js の改修は不要
- **`st`(status)キーの短縮は見送り**: 仕様書でも「視認性のため維持も検討」と記載。現行の instructions/YAML テンプレートでは `status` をそのまま使用しており、app.py アダプターは `st` → `status` の変換にも対応済み

---

## Phase 1: 基盤強化と最適化(残タスク)

### Task 1.1: CLAUDE.md にプロトコル規定を追加

- **対象ファイル**: [rakuen/CLAUDE.md](rakuen/CLAUDE.md)
- **依存**: なし
- **内容**: 仕様書 Section 1.1 で定義された3つの「憲法」規定を追加

#### 受入条件

1. CLAUDE.md の先頭(概要セクションの直後)に以下の3規定が記載されている:
   - `Protocol: 2-Step Send-Keys` - tmux send-keys の2ステップ分割ルール + 禁止例
   - `Format: ISO8601 Time` - `date "+%Y-%m-%dT%H:%M:%S"` の強制 + 理由
   - `Style: Directive Style` - です/ます調排除、例外(Examples)のペルソナ維持
2. 既存の通信プロトコルセクションと矛盾しない

#### 実装方針

- `## 概要` の直下に `## コア・プロトコル` セクションを新設
- 仕様書 Section 1.1 の内容をそのまま転記(Directive Style で記述)

---

### Task 1.2: Instructions を Directive Style に統一

- **対象ファイル**: [rakuen/instructions/uichan.md](rakuen/instructions/uichan.md), [rakuen/instructions/aichan.md](rakuen/instructions/aichan.md), [rakuen/instructions/kobito.md](rakuen/instructions/kobito.md)
- **依存**: Task 1.1(CLAUDE.md に Style 規定が入った後)
- **内容**: 地の文の「です/ます」調を Directive Style(指示書的記述)に変換

#### 受入条件

1. 地の文(ルール説明, 制約記述, 手順説明)に「です」「ます」「ください」「ましょう」が含まれない
2. 出力例(Examples)セクション内のペルソナ(口調)はそのまま維持
3. YAML front matter 内は変更しない
4. 意味の変更がない(表現の変換のみ)

#### 実装方針

- 対象パターン: `〜する。` `〜せよ。` `〜すること。` `〜禁止。` のような簡潔な命令形/体言止めに変換
- 例: 「報告してください」→「報告せよ」, 「使用します」→「使用する」, 「してはいけません」→「禁止」
- uichan.md は特にペルソナ的表現(「〜だよ」「〜してね」)が多いため、**ルール記述部分のみ**を変換対象とする

---

### Task 1.3: uichan.md の短縮キー未対応箇所を修正

- **対象ファイル**: [rakuen/instructions/uichan.md](rakuen/instructions/uichan.md)
- **依存**: なし
- **内容**: 前回調査で uichan.md の YAML 例示に旧キー(`timestamp:`, `command:`)が混在していることを確認。短縮キーに統一

#### 受入条件

1. uichan.md 内の YAML 例示で `timestamp` → `ts`, `command` → `cmd` に置換されている
2. 既存の動作に影響しない(app.py アダプターが両方に対応済みのため)

---

## Phase 2: アーキテクチャ刷新(SQLite + SSE)

### 概要

現行の YAML ファイルベースキューを SQLite に移行し、ポーリングを SSE に置き換える。

**現行のボトルネック**:
- `/api/activity` が毎回 20+ YAML ファイルを読み込み・パース(5秒ごと)
- ファイル排他制御なし(エージェントの同時書き込みで破損リスク)
- リアルタイム性なし(最大5秒遅延)

**移行後のデータフロー**:
```
[現行] Agent → Write YAML → Backend reads files → JSON → Frontend polls
[移行後] Agent → db_tool.py → SQLite → Backend detects change → SSE → Frontend
```

---

### Task 2.1: SQLite スキーマ設計とDBモジュール作成

- **対象ファイル(新規)**: `rakuen/webui/db.py`
- **依存**: なし
- **内容**: SQLite データベースのスキーマ定義と基本操作モジュールを作成

#### スキーマ設計

```sql
-- ユーザー入力 (user → uichan)
CREATE TABLE user_inputs (
    id TEXT PRIMARY KEY,            -- cmd_XXX
    ts TEXT NOT NULL,               -- ISO8601
    command TEXT NOT NULL,
    project TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending'
);

-- 指示 (uichan → aichan)
CREATE TABLE commands (
    id TEXT PRIMARY KEY,            -- cmd_XXX
    ts TEXT NOT NULL,
    command TEXT NOT NULL,
    project TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending'
);

-- タスク割当 (aichan → kobito)
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,       -- subtask_XXX
    parent_cmd TEXT,                -- FK: commands.id
    wid TEXT NOT NULL,              -- kobito1-8
    desc TEXT,
    target_path TEXT,
    status TEXT DEFAULT 'idle',
    ts TEXT NOT NULL
);

-- 報告 (kobito → aichan)
CREATE TABLE reports (
    wid TEXT NOT NULL,              -- kobito1-8
    task_id TEXT,
    ts TEXT,
    status TEXT DEFAULT 'idle',
    result TEXT,
    sc TEXT,                        -- skill_candidate
    PRIMARY KEY (wid, task_id)
);

-- アクティビティログ (全エージェント)
CREATE TABLE activity (
    id TEXT PRIMARY KEY,            -- act_XXX
    agent TEXT NOT NULL,            -- uichan, aichan, kobito1-8
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT,
    task_id TEXT
);

-- KVストア (汎用メタデータ)
CREATE TABLE kv_store (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
);

-- インデックス
CREATE INDEX idx_activity_ts ON activity(ts);
CREATE INDEX idx_activity_agent ON activity(agent);
CREATE INDEX idx_tasks_wid ON tasks(wid);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_reports_wid ON reports(wid);
```

#### db.py のインターフェース

```python
# 公開API
def get_db(workspace_dir: str) -> Connection
def init_db(workspace_dir: str) -> None      # テーブル作成
def reset_db(workspace_dir: str) -> None     # 全テーブルクリア

# CRUD (各テーブル共通パターン)
def upsert_user_input(db, entry: dict) -> None
def upsert_command(db, entry: dict) -> None
def upsert_task(db, entry: dict) -> None
def upsert_report(db, entry: dict) -> None
def insert_activity(db, entry: dict) -> None
def get_all_activity(db, since: str = None) -> list[dict]
def get_tasks_by_worker(db, wid: str) -> list[dict]
def get_report_by_worker(db, wid: str) -> dict | None
def kv_get(db, key: str) -> str | None
def kv_set(db, key: str, value: str) -> None
```

#### 受入条件

1. `rakuen/webui/db.py` が存在し、上記スキーマでテーブルを作成できる
2. `init_db()` は冪等(既にテーブルがあれば何もしない: `CREATE TABLE IF NOT EXISTS`)
3. SQLite の WAL モード有効化(`PRAGMA journal_mode=WAL`)で並行読み書きに対応
4. 全関数にdocstring付き
5. 標準ライブラリ `sqlite3` のみ使用(外部依存なし)

---

### Task 2.2: db_tool.py(エージェント用DBツール)作成

- **対象ファイル(新規)**: `rakuen/bin/db_tool.py`
- **依存**: Task 2.1(db.py)
- **内容**: エージェント(Bash経由)がSQLiteを操作するためのCLIツール

#### インターフェース設計

```bash
# タスク書き込み (aichan → kobito)
db_tool.py upsert-task --task-id subtask_001 --wid kobito1 \
  --desc "Implement login API" --status assigned

# レポート書き込み (kobito → aichan)
db_tool.py upsert-report --wid kobito3 --task-id subtask_001 \
  --status done --result "Implemented and tested"

# アクティビティ追加
db_tool.py add-activity --agent aichan --action "Assigned 3 tasks" --status working

# タスク読み取り (kobito が自分のタスクを確認)
db_tool.py get-task --wid kobito1
# → YAML形式で出力(エージェントが読みやすいように)

# レポート読み取り (aichan が報告を確認)
db_tool.py get-report --wid kobito1
# → YAML形式で出力

# KVストア
db_tool.py kv-set --key dashboard_hash --value "abc123"
db_tool.py kv-get --key dashboard_hash
```

#### 受入条件

1. `rakuen/bin/db_tool.py` が存在し、`chmod +x` で直接実行可能
2. `$RAKUEN_WORKSPACE` 環境変数から DB パスを解決(`$RAKUEN_WORKSPACE/rakuen.db`)
3. 出力は YAML 形式(エージェントが yaml.safe_load で読み取り可能)
4. エラー時は stderr に出力し、exit code 1 で終了
5. `--help` でサブコマンド一覧を表示

---

### Task 2.3: app.py を SQLite 読み取りに移行

- **対象ファイル**: [rakuen/webui/app.py](rakuen/webui/app.py)
- **依存**: Task 2.1(db.py)
- **内容**: `/api/activity` 等のエンドポイントを YAML ファイル読み取りから SQLite クエリに変更

#### 変更対象

1. **`/api/activity`** (メイン変更):
   - 現行: 20+ YAML ファイルをパース → エントリ統合 → ソート
   - 移行後: `SELECT * FROM activity ORDER BY ts DESC` + tasks/reports テーブル結合
   - `since` パラメータ対応: `WHERE ts > ?` で差分取得
2. **`/api/dashboard`**:
   - 変更なし(dashboard.md はファイルのまま維持 - 人間が直接編集するため)
3. **Watchdog**:
   - ヘルスチェック結果を kv_store に記録(オプション)

#### 受入条件

1. `/api/activity` が SQLite から読み取り、現行と同じ JSON レスポンス形式を返す
2. `since` クエリパラメータで差分取得が可能
3. YAML パース関連のコード(`_extract_yaml_items`, `_parse_yaml_entries`)は残す(Phase 2 移行期間中の互換用)
4. 起動時に `init_db()` を呼び出してテーブルを自動作成

---

### Task 2.4: SSE エンドポイント実装

- **対象ファイル**: [rakuen/webui/app.py](rakuen/webui/app.py)
- **依存**: Task 2.3(SQLite 読み取り)
- **内容**: `/api/events` SSE エンドポイントを追加

#### 設計

```
GET /api/events
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type": "activity", "entries": [...]}

data: {"type": "agent_health", "data": {...}}

data: {"type": "dashboard", "hash": "abc123"}
```

#### 変更通知の検知方式

SQLite には組み込みの変更通知がないため、以下の方式を採用:

- **ポーリング方式(Backend内部)**: 専用スレッドが 1 秒間隔で `SELECT MAX(rowid) FROM activity` を実行し、前回値と比較。変更があれば SSE クライアントに push
- kv_store の `last_activity_rowid` で前回の最大 rowid を管理
- dashboard.md はファイルの mtime を監視

#### 受入条件

1. `GET /api/events` が SSE ストリームを返す
2. activity テーブルに新規行が追加されると 1-2 秒以内にイベントが配信される
3. 複数クライアント接続に対応(各クライアントが独立したストリームを受信)
4. クライアント切断時にサーバーリソースがリークしない
5. `Last-Event-ID` ヘッダーによる再接続時の差分取得に対応

---

### Task 2.5: フロントエンドを SSE リスナーに移行

- **対象ファイル**: [rakuen/webui/static/js/api.js](rakuen/webui/static/js/api.js), [rakuen/webui/static/js/app.js](rakuen/webui/static/js/app.js)
- **依存**: Task 2.4(SSE エンドポイント)
- **内容**: `setInterval` ポーリングを `EventSource` に置き換え

#### 変更内容

**api.js**:
```javascript
// 新規追加
export function connectSSE(onMessage, onError) {
    const es = new EventSource("/api/events");
    es.onmessage = (e) => onMessage(JSON.parse(e.data));
    es.onerror = (e) => onError(e);
    return es;
}
```

**app.js**:
```javascript
// 現行: setInterval(fetchAndUpdateActiveTab, 5000)
// 移行後: EventSource による受信

let eventSource = null;

function initSSE() {
    eventSource = connectSSE(
        (data) => {
            if (data.type === "activity") {
                state.set("activityEntries", data.entries);
            } else if (data.type === "agent_health") {
                state.set("agentHealth", data.data);
            }
        },
        (err) => {
            // 自動再接続(EventSource のデフォルト動作)
            console.warn("SSE disconnected, reconnecting...");
        }
    );
}
```

#### フォールバック

- SSE 接続失敗時は従来のポーリングにフォールバック
- Settings に「リアルタイム更新 / ポーリング」切り替えオプションを追加

#### 受入条件

1. SSE 接続中はポーリング `setInterval` が停止している
2. アクティビティタイムラインがリアルタイム(1-2秒以内)で更新される
3. SSE 切断時に自動再接続し、差分データを取得する
4. ブラウザを閉じて再度開いても正常に動作する

---

### Task 2.6: Launcher の DB 初期化対応

- **対象ファイル**: [rakuen/bin/rakuen-launch](rakuen/bin/rakuen-launch)
- **依存**: Task 2.1(db.py), Task 2.2(db_tool.py)
- **内容**: `initialize_runtime` で SQLite DB の初期化を追加

#### 変更内容

1. `initialize_runtime` 内で `python3 -c "from db import init_db; init_db('$WORKSPACE_DIR')"` を呼び出し
2. kobito の初期状態を db_tool.py 経由で投入:
   ```bash
   db_tool.py upsert-report --wid kobito1 --status idle --ts ""
   ```
3. YAML キューファイルの初期化は**残す**(移行期間中の互換性のため)

#### 受入条件

1. `rakuen-launch` 実行後に `$WORKSPACE_DIR/rakuen.db` が存在する
2. 全テーブルが作成されている
3. kobito1-8 の初期レポート(status: idle)が reports テーブルに入っている
4. 既存の YAML 初期化ロジックは削除しない

---

### Task 2.7: Instructions の DB ツール対応

- **対象ファイル**: [rakuen/instructions/aichan.md](rakuen/instructions/aichan.md), [rakuen/instructions/kobito.md](rakuen/instructions/kobito.md)
- **依存**: Task 2.2(db_tool.py)
- **内容**: エージェントの指示書に db_tool.py の使用方法を追記

#### 変更内容

- aichan.md: タスク割当を `db_tool.py upsert-task` で行う手順を追加
- kobito.md: レポート提出を `db_tool.py upsert-report` で行う手順を追加
- 旧方式(YAML 直接書き込み)の記述は削除

#### 受入条件

1. aichan.md にタスク割当の db_tool.py コマンド例が記載されている
2. kobito.md にレポート提出の db_tool.py コマンド例が記載されている
3. YAML 直接書き込みの手順が残っていない

---

### Task 2.8: YAML → SQLite マイグレーションスクリプト

- **対象ファイル(新規)**: `rakuen/bin/migrate_yaml_to_db.py`
- **依存**: Task 2.1(db.py)
- **内容**: 既存の YAML キューデータを SQLite に移行するワンショットスクリプト

#### 受入条件

1. `queue/*.yaml`, `queue/tasks/*.yaml`, `queue/reports/*.yaml`, `queue/activity/*.yaml` を読み込み、対応テーブルに INSERT
2. 冪等実行可能(同じ id の再投入はスキップ: `INSERT OR IGNORE`)
3. 移行結果のサマリ(件数)を stdout に出力
4. 移行元ファイルは削除しない(手動確認後に削除する運用)

---

## Phase 3: 安全性と自律性

### Task 3.1: Command Validator ミドルウェア

- **対象ファイル(新規)**: `rakuen/webui/command_validator.py`
- **対象ファイル(変更)**: [rakuen/webui/app.py](rakuen/webui/app.py)
- **依存**: なし(Phase 2 と並行可能)
- **内容**: 危険なコマンドをフックして遮断するミドルウェア

#### 遮断対象コマンド(ブラックリスト)

```python
DANGEROUS_PATTERNS = [
    r"rm\s+(-rf?|--recursive)\s+/",      # rm -rf /
    r"rm\s+(-rf?|--recursive)\s+~",       # rm -rf ~
    r"rm\s+(-rf?|--recursive)\s+\$HOME",  # rm -rf $HOME
    r"mkfs\.",                              # mkfs.*
    r"dd\s+.*of=/dev/",                     # dd of=/dev/*
    r">\s*/dev/sd",                          # > /dev/sd*
    r"chmod\s+-R\s+777\s+/",               # chmod -R 777 /
    r":(){ :\|:& };:",                      # fork bomb
]
```

#### 適用箇所

- `POST /api/send` のリクエストボディ(text)を検証
- db_tool.py 経由のコマンド(command フィールド)を検証

#### 受入条件

1. ブラックリストに一致するコマンドが `POST /api/send` で送信された場合、HTTP 400 を返す
2. 遮断時にログ(`logs/validator.log`)に記録する
3. 正常なコマンドは遅延なく通過する
4. ブラックリストは設定ファイルで拡張可能

---

### Task 3.2: Auto Watchdog 強化(自律介入)

- **対象ファイル**: [rakuen/webui/app.py](rakuen/webui/app.py)(Watchdog セクション)
- **依存**: なし(Phase 2 と並行可能)
- **内容**: エージェントの異常状態を自動検知し、自律的に介入

#### 検知パターン

| パターン | 検知方法 | 介入アクション |
|----------|----------|---------------|
| 無限ループ | 同一出力が 3 回以上連続 | Ctrl+C 送信 |
| エラー応答繰り返し | "Error", "failed" が 5 回以上連続 | プロセス再起動 |
| 無応答 | 最終出力から 10 分以上経過 | Ctrl+C → 再起動 |
| ディスク逼迫 | DB サイズ > 100MB | アラート(dashboard.md に記載) |

#### 受入条件

1. Watchdog スレッドが上記パターンを検知できる
2. 検知時に適切なアクション(Ctrl+C 送信 or 再起動)を実行する
3. 介入ログが `logs/watchdog.log` に記録される
4. 誤検知を防ぐため、各パターンにクールダウン(5分)を設ける
5. 既存のサーキットブレーカー(3回/10分)と整合する

---

## 依存関係グラフ

```
Phase 1 (並行実行可能)
  Task 1.1  ─→  Task 1.2
  Task 1.3  (独立)

Phase 2 (順序あり)
  Task 2.1 ─┬→ Task 2.2 ─→ Task 2.6 (Launcher)
             │              └→ Task 2.7 (Instructions)
             └→ Task 2.3 ─→ Task 2.4 ─→ Task 2.5 (Frontend SSE)
  Task 2.8 ─── Task 2.1 に依存(移行スクリプト)

Phase 3 (Phase 1/2 と並行可能)
  Task 3.1 (独立)
  Task 3.2 (独立)
```

## 実装順序(推奨)

| 順序 | タスク | 理由 |
|------|--------|------|
| 1 | Task 1.1 | 他タスクの前提。CLAUDE.md に憲法を定義 |
| 2 | Task 1.2, 1.3 | Phase 1 完了。並行実行可能 |
| 3 | Task 2.1 | Phase 2 の全タスクの前提 |
| 4 | Task 2.2 | エージェント側のDB操作手段を確保 |
| 5 | Task 2.3 | Backend の読み取り経路を SQLite に切り替え |
| 6 | Task 2.4 | SSE エンドポイント追加 |
| 7 | Task 2.5 | Frontend を SSE リスナーに移行 |
| 8 | Task 2.6 | Launcher が DB を初期化 |
| 9 | Task 2.7 | Instructions を DB ツール対応に更新 |
| 10 | Task 2.8 | 既存データの移行スクリプト |
| 11 | Task 3.1, 3.2 | Phase 3。Phase 2 と並行可能 |

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| SQLite の並行書き込み | エージェント同時実行でロック競合 | WAL モード有効化 + リトライ(busy_timeout=5000) |
| 移行期間中の二重データソース | YAML と SQLite の不整合 | Task 2.3 で YAML フォールバックを残す |
| SSE 接続数上限 | ブラウザ制限(同一ドメイン6接続) | SSE は 1 接続に統合、イベントタイプで分離 |
| db_tool.py のパス解決 | エージェントが PATH を見つけられない | `$RAKUEN_HOME/bin/db_tool.py` を絶対パスで指定 |
| Watchdog 誤検知 | 正常なエージェントを再起動してしまう | クールダウン + サーキットブレーカー |
