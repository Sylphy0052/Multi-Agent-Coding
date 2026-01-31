# Rakuen - Multi-Agent tmux Orchestration with Web UI

WSL上で `rakuen-web` コマンドを実行するだけで, 階層型マルチエージェント tmux 環境と Web UI を起動するシステム.
Claude Code + tmux を使った並列開発基盤.

## 概要

```text
ご主人様(人間)
  |
  v  [Web UI: 送信]
UI-CHAN (ういちゃん)   ... tmux session: rakuen:0.0   プロジェクト統括
  |
  v  [YAML + send-keys]
AI-CHAN (あいちゃん)   ... tmux session: multiagent:0.0   タスク管理・分配
  |
  v  [YAML + send-keys]
KOBITO 1-8 (小人)     ... tmux session: multiagent:0.1 - 0.8   実働部隊
```

- Web UI からログ閲覧(全エージェント) + コマンド送信(ういちゃんのみ)
- 2秒ポーリングによる自動更新
- 作業リポジトリを汚さない(全資産は `~/rakuen/` に集約)
- イベント駆動通信(YAML + tmux send-keys, エージェント間ポーリング禁止)

## 必要環境

- **WSL2** (Ubuntu等)
- **tmux**
- **Python 3.10+**
- **bash**
- **Claude Code CLI** (`claude` コマンド)

## セットアップ

```bash
# 1. リポジトリをクローン
git clone <repo-url>
cd Multi-Agent-Codingv2

# 2. デプロイ
bash rakuen/setup.sh

# 3. シェル再読み込み(PATH反映)
source ~/.bashrc
```

`setup.sh` は以下を実行します:

- `rakuen/` を `/home/$USER/rakuen/` にコピー
- `bin/rakuen-web`, `bin/rakuen-launch`, `bin/rakuen-agent-start` に実行権限を付与
- Python venv を作成
- PATH に `/home/$USER/rakuen/bin` を追加(`.bashrc`)

## 使い方

```bash
# 任意の作業ディレクトリで実行
cd ~/your-project
rakuen-web
```

ブラウザで `http://127.0.0.1:8080` を開くと Web UI が表示されます.

### オプション

| オプション | 説明 |
| ----------- | ------ |
| `--port <N>` | 開始ポートを指定(デフォルト: 8080) |
| `--strict` | 整合性検証に失敗した場合, 起動を中止 |
| `--help` | ヘルプを表示 |

### ポート競合時

8080 が使用中の場合, 8081, 8082, ... と自動インクリメントします(上限: 8099).

## アーキテクチャ

### エージェント階層

| 役割 | 名前 | tmux target | 責務 |
| ------ | ------ | ------------- | ------ |
| プロジェクト統括 | UI-CHAN (ういちゃん) | `rakuen:0.0` | 全体指揮. Web UIから送信可能 |
| タスク管理 | AI-CHAN (あいちゃん) | `multiagent:0.0` | タスク分解/配分. 閲覧のみ |
| 実働部隊 | KOBITO 1-8 (小人) | `multiagent:0.1-0.8` | 実行担当. 閲覧のみ |

### 通信プロトコル

- **上→下の指示**: YAML ファイルに内容を書き, tmux send-keys で相手を起こす
- **下→上の報告**: dashboard.md 更新のみ(send-keys 禁止 = 割り込み防止)
- **ポーリング禁止**: API代金節約のため, エージェント間ポーリングは行わない

### 通信ファイル(ワークスペース内)

| ファイル | 方向 | 用途 |
| --------- | ------ | ------ |
| `queue/uichan_to_aichan.yaml` | UI-CHAN → AI-CHAN | 指示伝達 |
| `queue/tasks/kobito{N}.yaml` | AI-CHAN → KOBITO | 個別タスク割当 |
| `queue/reports/kobito{N}_report.yaml` | KOBITO → AI-CHAN | 完了報告 |
| `dashboard.md` | AI-CHAN → 人間 | 進捗ダッシュボード |

### 環境変数

| 変数 | 用途 | 例 |
| ------ | ------ | ----- |
| `RAKUEN_HOME` | 共有リソースのルート | `~/rakuen/` |
| `RAKUEN_WORKSPACE` | 作業リポジトリ固有のワークスペース | `~/rakuen/workspaces/MyApp/` |
| `RAKUEN_REPO_ROOT` | 作業対象リポジトリのパス | `/home/user/projects/MyApp` |
| `RAKUEN_ROLE` | エージェントの役割 | `uichan`, `aichan`, `kobito1` |

## Web UI

```text
+------------------------------------------------------+
| [Status Bar] tmux: OK | Validation: OK | Port: 8080  |
+----------+-------------------------------------------+
| [Agents] | [Log Area]                                |
| > UI-chan |                                           |
|   AI-chan |   (選択エージェントのログ表示)                |
|   Kobi-1 |                                           |
|   ...    |                                           |
|   Kobi-8 |                                           |
+----------+-------------------------------------------+
| [Preset Buttons]  [Input Field]  [Send]              |
+------------------------------------------------------+
```

- **エージェントセレクタ**: ういちゃん(金)/あいちゃん(赤)/小人1-8(青) を切替
- **ログ表示**: 選択エージェントの最新300行をポーリング表示
- **送信**: ういちゃんへのみコマンド送信可能(あいちゃん/小人選択時は無効)
- **プリセット**: 定型コマンドをワンクリック送信
- **自動更新**: ON/OFF切替(デフォルトON, 2秒間隔)

## API

| Method | Path | 概要 |
| -------- | ------ | ------ |
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/status` | tmux状態 + 整合性検証結果 |
| GET | `/api/pane?agent=<name>&lines=<N>` | ログ取得(lines: 50-1000, default 300) |
| POST | `/api/send` | ういちゃんへコマンド送信(`{"text": "..."}`, 最大8KB) |
| GET | `/api/presets` | プリセット定義取得 |

## ディレクトリ構成

### ソースリポジトリ

```text
Multi-Agent-Codingv2/
├── rakuen/                    # ソース実装(デプロイ元)
├── sanko/                     # 参考実装(multi-agent-shogun)
├── docs/                      # 仕様書・設計ドキュメント
└── .codex_tasks/              # AI タスク実行記録
```

### デプロイ先: 共有リソース(`~/rakuen/`)

```text
~/rakuen/
├── bin/
│   ├── rakuen-web              # エントリポイント
│   ├── rakuen-launch           # tmux構築(冪等)
│   └── rakuen-agent-start      # エージェント起動
├── webui/
│   ├── app.py                  # HTTPサーバ(Python標準ライブラリのみ)
│   └── static/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── config/
│   ├── agents.json             # pane定義(セッション/タイトル/環境変数/コマンド)
│   ├── presets.json            # プリセットボタン定義
│   ├── settings.yaml           # 言語・ログ・スキル設定
│   └── projects.yaml           # プロジェクト管理
├── instructions/               # エージェント指示書
│   ├── uichan.md
│   ├── aichan.md
│   └── kobito.md
├── templates/                  # テンプレート
│   └── context_template.md
├── skills/                     # ローカルスキル
├── CLAUDE.md                   # システム構成ドキュメント
├── .venv/                      # Python仮想環境
└── logs/                       # 実行ログ
```

### デプロイ先: ワークスペース(`~/rakuen/workspaces/<repo>/`)

リポジトリごとに独立したワークスペースが作成されます:

```text
~/rakuen/workspaces/<repo>/
├── config/
│   ├── settings.yaml           # 言語設定等
│   └── projects.yaml           # プロジェクト一覧
├── context/                    # プロジェクトコンテキスト
├── memory/                     # メモリ(global_context.md等)
├── queue/
│   ├── uichan_to_aichan.yaml   # UI-CHAN → AI-CHAN 指示
│   ├── tasks/kobito{N}.yaml    # AI-CHAN → KOBITO 割当(各小人専用)
│   └── reports/kobito{N}_report.yaml  # KOBITO → AI-CHAN 報告
├── status/master_status.yaml   # 全体進捗
├── logs/                       # ログ
└── dashboard.md                # 人間用ダッシュボード
```

## カスタマイズ

### エージェント起動コマンド

`~/rakuen/config/agents.json` を編集して各 pane の `command` を設定:

```json
{
  "sessions": {
    "rakuen": {
      "window": 0,
      "panes": {
        "0": {
          "name": "uichan",
          "title": "UI-CHAN",
          "env": {
            "RAKUEN_ROLE": "uichan",
            "RAKUEN_REPO_ROOT": "${REPO_ROOT}",
            "RAKUEN_WORKSPACE": "${WORKSPACE_DIR}"
          },
          "instructions": "${RAKUEN_HOME}/instructions/uichan.md",
          "command": "claude --model opus --dangerously-skip-permissions",
          "initial_prompt": "セッション開始。..."
        }
      }
    }
  }
}
```

`${REPO_ROOT}`, `${WORKSPACE_DIR}`, `${RAKUEN_HOME}` は実行時に自動展開されます.

### プリセットボタン

`~/rakuen/config/presets.json` を編集:

```json
{
  "presets": [
    {"id": "status", "label": "Status Report", "text": "Report current status of all agents and tasks."},
    {"id": "dashboard", "label": "Update Dashboard", "text": "Update dashboard.md with the latest state of all tasks."},
    {"id": "continue", "label": "Continue", "text": "Continue working on the current task."},
    {"id": "stop", "label": "Stop", "text": "Stop current work and report the current state."}
  ]
}
```

### 言語設定

`~/rakuen/config/settings.yaml` で言語を設定:

```yaml
language: ja  # ja, en, es, zh, ko, fr, de 等
```

- `ja`: キャラクター口調の日本語のみ
- `ja` 以外: キャラクター口調 + ユーザー言語の翻訳を括弧で併記

## 設計上の特徴

- **外部依存ゼロ**: Python標準ライブラリのみ使用(pip install 不要)
- **リポジトリ非汚染**: 作業リポジトリにファイルを生成しない
- **ワークスペース分離**: リポジトリごとに独立したワークスペース(`~/rakuen/workspaces/<repo>/`)
- **冪等性**: 既存tmuxセッションがあれば再利用(破壊しない)
- **整合性検証**: pane title/環境変数をagents.json定義と照合
- **イベント駆動**: YAML + send-keys による非ポーリング通信
- **非ブロッキング**: UI-CHANは指示後即座に次の入力を受付可能
- **割り込み防止**: 下→上の報告はファイル更新のみ(send-keys禁止)
- **WSL限定**: 起動時にWSL環境を判定

## ドキュメント

- [仕様書](docs/specv1.md)
- [実装計画書](docs/implementation-plan-v1.md)
- [起動ガイド](docs/sanko-startup-guide.md)
- [UI リデザイン仕様](docs/ui-redesign-spec.md)

## ライセンス

MIT
