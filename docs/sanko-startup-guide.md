# sanko (multi-agent-rakuen) 起動から指示投入までの完全ガイド

本ドキュメントは, sanko内の multi-agent-rakuen システムを起動し, Claude Codeで指示を出すまでの全フローをまとめたものである。

---

## 目次

1. [システム概要](#1-システム概要)
2. [Phase 0: 初回セットアップ](#2-phase-0-初回セットアップ1回だけ)
3. [Phase 1: 毎日の起動](#3-phase-1-毎日の起動)
4. [Phase 2: ういちゃんセッションに接続](#4-phase-2-ういちゃんセッションに接続)
5. [Phase 3: ユーザーがういちゃんに指示を入力](#5-phase-3-ユーザーがういちゃんに指示を入力)
6. [Phase 4-7: エージェント間の自動処理フロー](#6-phase-4-7-エージェント間の自動処理フロー)
7. [Phase 8: 結果の確認](#7-phase-8-結果の確認)
8. [全体フロー図](#8-全体フロー図)
9. [重要な設計原則](#9-重要な設計原則)
10. [コマンドリファレンス](#10-コマンドリファレンス)

---

## 1. システム概要

multi-agent-rakuen は, 美少女チームをモデルにした Claude Code マルチエージェントシステムである。

### エージェント構成(計10体)

| 役職 | 人数 | 役割 | tmuxセッション |
|------|------|------|----------------|
| ういちゃん(UI-chan) | 1 | プロジェクト統括, ユーザーとの窓口 | `rakuen` |
| あいちゃん(AI-chan) | 1 | タスク分解・小人への割当・進捗管理 | `multiagent:0.0` |
| 小人(Kobito) | 8 | 実作業(コーディング, ドキュメント等) | `multiagent:0.1` - `0.8` |

### 通信方式

- **ファイルベース**: YAMLファイルで指示・報告を受け渡し
- **イベント駆動**: `tmux send-keys` で相手を起こす(ポーリング禁止)
- **単方向報告**: dashboard.md はあいちゃんのみが更新

---

## 2. Phase 0: 初回セットアップ(1回だけ)

```bash
cd sanko/multi-agent-rakuen-main
chmod +x *.sh
./first_setup.sh
```

### first_setup.sh が行うこと

1. OS判定(WSL2 / Linux / Mac)
2. tmux のインストール確認
3. Node.js v20+ のインストール確認(nvm経由)
4. Claude Code CLI のインストール(`npm install -g @anthropic-ai/claude-code`)
5. ディレクトリ構造の作成(`queue/`, `config/`, `status/` 等)
6. 設定ファイルの初期化(`config/settings.yaml`, `config/projects.yaml`)
7. 小人用タスク/レポートファイルの生成
8. シェルエイリアスの追加(`css`, `csm`, `csst`)

### MCP サーバー登録(推奨)

```bash
# Memory MCP(クロスセッション記憶, 強く推奨)
claude mcp add memory -e MEMORY_FILE_PATH="$PWD/memory/rakuen_memory.jsonl" \
  -- npx -y @modelcontextprotocol/server-memory

# GitHub(PR/Issue管理)
claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=your_pat \
  -- npx -y @modelcontextprotocol/server-github

# 登録確認
claude mcp list
```

### プロジェクト設定

`config/projects.yaml` に対象プロジェクトを登録:

```yaml
projects:
  - id: my_project
    name: "My Project"
    path: "/path/to/project"
    priority: high
    status: active
current_project: my_project
```

---

## 3. Phase 1: 毎日の起動

```bash
./shutsujin_departure.sh              # 通常起動
./shutsujin_departure.sh -t           # Windows Terminal タブ付き
./shutsujin_departure.sh -s           # セッション作成のみ(Claude未起動)
./shutsujin_departure.sh -h           # ヘルプ表示
```

### スクリプトが実行する処理

| Step | 処理内容 |
|------|----------|
| 1 | 既存tmuxセッション(`rakuen`, `multiagent`)をkill |
| 2 | キューファイル・レポートファイルをidle状態に初期化 |
| 3 | `dashboard.md` を空の状態で再生成 |
| 4 | tmux `multiagent` セッション作成(3x3 = 9ペイン) |
| 5 | tmux `rakuen` セッション作成(1ペイン) |
| 6 | 全10ペインで `claude --dangerously-skip-permissions` を実行 |
| 7 | 各エージェントに指示書を送信(`uichan.md` / `aichan.md` / `kobito.md`) |

### 起動後のtmux構成

```
【rakuen セッション】              【multiagent セッション】(3x3)
┌───────────────────┐     ┌──────────┬──────────┬──────────┐
│                   │     │  aichan  │ kobito3  │ kobito6  │
│  ういちゃん (UI-CHAN)│     │(あいちゃん)│ (小人3)  │ (小人6)  │
│  ← ここに指示を入力 │     ├──────────┼──────────┼──────────┤
│                   │     │ kobito1  │ kobito4  │ kobito7  │
│                   │     │ (小人1)  │ (小人4)  │ (小人7)  │
└───────────────────┘     ├──────────┼──────────┼──────────┤
                          │ kobito2  │ kobito5  │ kobito8  │
                          │ (小人2)  │ (小人5)  │ (小人8)  │
                          └──────────┴──────────┴──────────┘
```

---

## 4. Phase 2: ういちゃんセッションに接続

```bash
tmux attach-session -t rakuen
# エイリアス: css
```

Claude Codeのプロンプトが表示されている状態になる。

---

## 5. Phase 3: ユーザーがういちゃんに指示を入力

ういちゃんのClaude Codeプロンプトに自然言語で指示を入力する。

### 指示の例

```
「認証機能を実装せよ」
「READMEを日本語に翻訳せよ」
「テストカバレッジを80%以上にせよ」
```

### 注意点

- 「何をやるか(command)」を指示する。「誰がやるか(assign_to)」はあいちゃんが判断する
- ういちゃんは指示をあいちゃんに渡したら即座に終了するため, 続けて次の指示を出せる

---

## 6. Phase 4-7: エージェント間の自動処理フロー

ユーザーが指示を入力した後, 以下のフローが自動で実行される。

### Phase 4: ういちゃんの処理

```
1. queue/uichan_to_aichan.yaml にYAMLで指示を書き込む

   queue:
     - id: cmd_001
       timestamp: "2026-01-30T10:00:00"
       command: "認証機能を実装せよ"
       project: my_project
       priority: high
       status: pending

2. tmux send-keys であいちゃん(aichan)を起こす
   【Bash 1回目】メッセージ送信
   【Bash 2回目】Enter送信

3. 即座に処理終了 → ユーザーは次の指示を入力可能
```

### Phase 5: あいちゃんの処理

```
1. queue/uichan_to_aichan.yaml を読む
2. dashboard.md の「進行中」セクションを更新
3. 指示をサブタスクに分解
4. 各小人の専用ファイルにタスクを書き込む

   queue/tasks/kobito1.yaml ← サブタスクA
   queue/tasks/kobito2.yaml ← サブタスクB
   queue/tasks/kobito3.yaml ← サブタスクC

5. tmux send-keys で各小人を起こす
6. 処理終了 → プロンプト待ちに戻る
```

### Phase 6: 小人の実行(並列)

各小人が独立・並列で以下を実行:

```
1. 自分専用の queue/tasks/kobito{N}.yaml を読む
2. コンテキスト(CLAUDE.md, プロジェクトファイル)を読み込む
3. ペルソナを選択(エンジニア, ライター等)
4. タスクを実行(コード書き, ドキュメント作成等)
5. queue/reports/kobito{N}_report.yaml に結果を書く

   worker_id: kobito1
   task_id: subtask_001
   status: done
   result:
     summary: "認証モジュール完了"
     files_modified:
       - "src/auth/module.ts"
   skill_candidate:
     found: false

6. tmux send-keys であいちゃんに完了報告
```

### Phase 7: あいちゃんが結果を集約

```
1. 小人の send-keys で起こされる
2. queue/reports/kobito*_report.yaml を全スキャン
3. dashboard.md を更新
   - 完了タスクを「進行中」→「できたこと」に移動
   - ご主人様の判断が必要な事項を「要対応」に記載
4. 処理終了
```

---

## 7. Phase 8: 結果の確認

### 方法1: dashboard.md を直接確認

```bash
cat dashboard.md
```

dashboard.md の構成:

| セクション | 内容 |
|-----------|------|
| 要対応 | ユーザーの判断が必要な事項 |
| 進行中 | 現在実行中のタスク |
| できたこと | 完了したタスクの一覧 |
| スキル化候補 | 再利用可能パターンの提案 |

### 方法2: ういちゃんに聞く

```
(rakuenセッションで)「進捗を報告せよ」
```

### 方法3: multiagentセッションで直接確認

```bash
tmux attach-session -t multiagent
# エイリアス: csm
```

---

## 8. 全体フロー図

```
  ユーザー(ご主人様)
      │
      │ 自然言語で指示入力
      ▼
  ┌──────────┐ queue/uichan_to_aichan.yaml ┌──────────┐
  │ういちゃん │ ──────────────────────────→  │あいちゃん │
  │ (UI-chan) │  + tmux send-keys           │ (AI-chan) │
  └──────────┘                              └────┬─────┘
      │                                         │ queue/tasks/kobito{N}.yaml
      │ 即座に終了                                │ + tmux send-keys
      │ (次の指示入力可能)                         ▼
      │                          ┌──┬──┬──┬──┬──┬──┬──┬──┐
      │                          │1 │2 │3 │4 │5 │6 │7 │8 │ ← 並列実行
      │                          └──┴──┴──┴──┴──┴──┴──┴──┘
      │                                        │
      │                                        │ queue/reports/kobito{N}_report.yaml
      │                                        │ + tmux send-keys
      │                                        ▼
      │                                   ┌──────────┐
      │                                   │あいちゃん │ → dashboard.md 更新
      │                                   └──────────┘
      │
      │ dashboard.md を確認
      ▼
  結果確認 → 次の指示
```

### 通信プロトコル詳細

| ファイル | 方向 | 内容 |
|---------|------|------|
| `queue/uichan_to_aichan.yaml` | ういちゃん → あいちゃん | コマンドキュー |
| `queue/tasks/kobito{N}.yaml` | あいちゃん → 小人N | 個別タスク割当 |
| `queue/reports/kobito{N}_report.yaml` | 小人N → あいちゃん | 完了報告 |
| `dashboard.md` | あいちゃん → ユーザー | 進捗・結果の集約 |
| `memory/rakuen_memory.jsonl` | 全エージェント | クロスセッション記憶 |

---

## 9. 重要な設計原則

### 非ブロッキング

ういちゃんは指示をあいちゃんに渡したら即座に終了する。ユーザーは結果を待たずに次の指示を出せる。

```
ご主人様: 指示 → ういちゃん: YAML書く → send-keys → 即終了
                                  ↓
                            ご主人様: 次の入力可能
                                  ↓
                      あいちゃん・小人: バックグラウンドで作業
                                  ↓
                      dashboard.md 更新で報告
```

### イベント駆動

ポーリング(待機ループ)は禁止。各エージェントは `tmux send-keys` で相手を起こす。API利用料の無駄遣いを防止する。

### tmux send-keys の2回分割ルール

メッセージとEnterは必ず2回のBash呼び出しに分ける:

```bash
# 1回目: メッセージ送信
tmux send-keys -t multiagent:0.0 'メッセージ内容'

# 2回目: Enter送信
tmux send-keys -t multiagent:0.0 Enter
```

1回で `'メッセージ' Enter` と書くのは禁止(正しく解釈されない)。

### 単一責任(dashboard.md)

dashboard.md を更新するのはあいちゃんのみ。ういちゃんも小人も更新しない。これにより:

- 書き込み競合を防止
- 情報の集約点を一元化
- 正確な状況反映を保証

### 競合防止(RACE-001)

複数の小人が同一ファイルに書き込むことは禁止。各小人は専用のタスクファイル・レポートファイルのみ使用する。

---

## 10. コマンドリファレンス

### 起動・接続

| コマンド | エイリアス | 説明 |
|---------|----------|------|
| `./shutsujin_departure.sh` | `csst` | 全エージェント起動 |
| `tmux attach-session -t rakuen` | `css` | ういちゃんセッションに接続 |
| `tmux attach-session -t multiagent` | `csm` | あいちゃん・小人セッションに接続 |

### tmux操作

| 操作 | キー |
|------|------|
| セッション一覧 | `tmux ls` |
| ペイン切り替え | `Ctrl+b` → 矢印キー |
| デタッチ(切断) | `Ctrl+b` → `d` |
| ペイン番号表示 | `Ctrl+b` → `q` |

### 状況確認

| コマンド | 説明 |
|---------|------|
| `cat dashboard.md` | 進捗ダッシュボードを表示 |
| `cat queue/uichan_to_aichan.yaml` | ういちゃん→あいちゃんのコマンドキューを確認 |
| `cat queue/tasks/kobito1.yaml` | 小人1のタスクを確認 |
| `cat queue/reports/kobito1_report.yaml` | 小人1の報告を確認 |
