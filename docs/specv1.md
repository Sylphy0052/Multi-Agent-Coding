## 0. 確定要件(ユーザー回答の反映)

* **起動方式**: B-1(`shutsujin_departure.sh` には依存しない)。`/home/<user>/rakuen` 側の起動スクリプトで tmux を構築。
* **起動入口**: PATH 上の `rakuen-web` を、任意の作業ディレクトリ(例: `~/p1/repo`)で実行。
* **repo 非汚染**: venv/設定/ログ/プロンプト等は `/home/<user>/rakuen` に集約。repo 内に新規ファイル生成はしない。
* **repo root 決定**: `git rev-parse --show-toplevel` を常に優先(失敗時のみ `pwd`)。
* **Web UI**:

  * ログ: 最新 N 行のスナップショットで十分。
  * 送信: **ういちゃんへの送信のみ許可**(あいちゃん/小人は閲覧のみ)。
  * 入力: 自由入力 + preset ボタン選択の両方。
  * 自動更新: **ON(デフォルト)**。
* **port**: `8080` 固定開始。競合時は **インクリメント**して空きポートに bind。
* **既存 tmux がある場合**: 破壊せず **(a) 既存利用**。
* **整合性検証**: `multiagent` の **各 pane のタイトル/環境変数まで検証**。

---

## 1. 目的

WSL 上で `rakuen-web` を実行するだけで、以下を実現する:

1. tmux セッション `rakuen` / `multiagent` を B-1方式で構築(または既存利用)
2. `127.0.0.1:<port>` に Web UI を起動
3. Web UI から

   * ういちゃん/あいちゃん/小人1..8 のログ閲覧
   * **ういちゃんへの送信のみ**(自由入力 + preset)
4. プロンプト・設定・実行コマンドは `/home/<user>/rakuen` に集約し、作業repoを汚さない

---

## 2. 非目的(スコープ外)

* 認証・外部公開・マルチユーザ
* WebSocket/SSE によるストリーミング(ポーリングのみ)
* tmux 以外でのプロセス監視/復旧(systemd等)
* エージェントのプロンプト内容最適化(配置と起動の枠組みのみ)

---

## 3. 対応環境・制約

### 3.1 必須

* WSL2(Ubuntu等)
* `tmux`, `bash`
* `python3`(推奨 3.10+)

### 3.2 WSL限定

* 起動時に以下をチェックし、満たさなければ即終了:

  * `/proc/version` に `microsoft` を含む、または `WSL_INTEROP` が存在

### 3.3 ネットワーク

* bind: `127.0.0.1` 固定
* port: `8080` から開始、競合時は `8081..` とインクリメント(上限例: `8099`)

---

## 4. ディレクトリ/構成(repo 非汚染)

### 4.1 運用資産ディレクトリ(固定)

`/home/<user>/rakuen/`

```
/home/<user>/rakuen/
  bin/
    rakuen-web            # PATH入口(WSL判定/ repo root決定/ 起動)
    rakuen-launch         # B-1: tmux構築(冪等・検証込み)
  webui/
    app.py                # HTTPサーバ(tmuxブリッジ)
    requirements.txt
    static/
      index.html
      app.js
      style.css
  config/
    agents.json           # paneごとの起動コマンド定義(必須)
    presets.json          # 定型ボタン定義(任意)
  prompts/                # システムプロンプト等(任意、運用側に集約)
  .venv/                  # python venv
  logs/                   # ログ(任意)
```

### 4.2 作業repo(可変)

* 例: `~/p1/repo`
* **新規ファイル生成なし**(`rakuen-web` 実行のみ)

---

## 5. tmux 構築仕様(B-1)

### 5.1 セッション名と pane mapping(固定・不変)

| 論理名 | tmux target      | 備考       |
| --- | ---------------- | -------- |
| ういちゃん  | `rakuen:0.0`     | 送信先は常にここ |
| あいちゃん  | `multiagent:0.0` | 閲覧のみ     |
| 小人1 | `multiagent:0.1` | 閲覧のみ     |
| …   | …                | …        |
| 小人8 | `multiagent:0.8` | 閲覧のみ     |

### 5.2 冪等性

* `tmux has-session -t rakuen` が true の場合: **既存利用**(再作成しない)
* `tmux has-session -t multiagent` が true の場合: **既存利用**
* ただし **検証は必ず実施**(失敗なら UI で警告を出す、または起動を止める方針を選べる)

### 5.3 起動コマンド定義(agents.json)

* `/home/<user>/rakuen/config/agents.json` に pane ごとの起動コマンドと期待メタ情報を定義する。
* repo 非汚染要件の中核: プロンプトや実行コマンドは運用側に集約。

#### 5.3.1 agents.json(仕様)

例(概念。実際は環境に合わせて記述):

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
            "RAKUEN_REPO_ROOT": "${REPO_ROOT}"
          },
          "command": "claude -p \"$(cat /home/<user>/rakuen/prompts/uichan.md)\""
        }
      }
    },
    "multiagent": {
      "window": 0,
      "panes": {
        "0": {"name":"aichan", "title":"AI-CHAN", "env":{"RAKUEN_ROLE":"aichan"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/aichan.md)\""},
        "1": {"name":"kobito1", "title":"KOBI-1", "env":{"RAKUEN_ROLE":"kobito1"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito1.md)\""},
        "2": {"name":"kobito2", "title":"KOBI-2", "env":{"RAKUEN_ROLE":"kobito2"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito2.md)\""},
        "3": {"name":"kobito3", "title":"KOBI-3", "env":{"RAKUEN_ROLE":"kobito3"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito3.md)\""},
        "4": {"name":"kobito4", "title":"KOBI-4", "env":{"RAKUEN_ROLE":"kobito4"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito4.md)\""},
        "5": {"name":"kobito5", "title":"KOBI-5", "env":{"RAKUEN_ROLE":"kobito5"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito5.md)\""},
        "6": {"name":"kobito6", "title":"KOBI-6", "env":{"RAKUEN_ROLE":"kobito6"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito6.md)\""},
        "7": {"name":"kobito7", "title":"KOBI-7", "env":{"RAKUEN_ROLE":"kobito7"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito7.md)\""},
        "8": {"name":"kobito8", "title":"KOBI-8", "env":{"RAKUEN_ROLE":"kobito8"}, "command":"claude -p \"$(cat /home/<user>/rakuen/prompts/kobito8.md)\""}
      }
    }
  }
}
```

* `${REPO_ROOT}` は `rakuen-launch` が展開する。
* `title` は tmux pane title に設定する(後述の検証で使用)。
* `env` は pane の起動前に `export KEY=VALUE` で設定してから command を実行する。

### 5.4 tmux レイアウト生成(安定性要件)

* `multiagent` は **9 panes** を必ず生成。
* pane index が **0..8** であることを最終チェック。
* `send-keys` 宛先は常に明示: `tmux send-keys -t multiagent:0.<idx> ...`

> split の順序は実装依存でも良いが、最終的に pane index が 0..8 で揃っていることを必須要件とする。

---

## 6. 整合性検証仕様(タイトル/環境変数まで)

> **運用方針**: 安定最優先(pane index の確定を最優先)。表示は Web UI で確認できるため、tmux レイアウトの見た目は二の次とする。

> **失敗時方針**: 検証に失敗しても **Web UI の起動は続行**し、`/api/status` と UI 上で警告を表示する(デフォルト strict ではない)。

### 6.1 検証対象

* セッション存在: `rakuen`, `multiagent`
* `multiagent` pane 数: 9
* 各 pane の **タイトル**(`#{pane_title}`)が `agents.json` の `title` と一致
* 各 pane の **環境変数** が期待通り

### 6.2 tmux から取得するメタ情報

* pane index: `#{pane_index}`
* pane title: `#{pane_title}`
* pane id: `#{pane_id}`(必要なら)

例:

* `tmux list-panes -t multiagent:0 -F '#{pane_index}|#{pane_title}|#{pane_id}'`

### 6.0 必須 env キー(デフォルト)

* `RAKUEN_ROLE`: 必須(`uichan` / `aichan` / `kobitoN`)
* `RAKUEN_REPO_ROOT`: 必須(repo root のトレーサビリティ向上。将来のマルチrepo namespacing 検討にも有益)

### 6.3 環境変数検証の方法(仕様)

* 各 pane に対して、**非破壊・短命**な方法で env を取得する。

推奨方式(実装指針):

* `tmux send-keys -t <pane> 'printf "__ENV__%s\n" "$RAKUEN_ROLE"' Enter`
* 直後に `capture-pane` を取り、末尾のマーカー行から値を抽出

制約:

* env 検証は「pane の出力を汚す」ので、マーカーを含めて UI 側に見える。
* これを嫌う場合は、`tmux display-message -p` では pane env は取れないため、
  代替案として「起動時に title へ env のハッシュを埋め込む」「pane 内で periodic に状態を出力する」等が必要。

本仕様では、**検証の強度を優先**し、上記マーカー方式を採用する。

### 6.4 検証結果の扱い

* `rakuen-launch` 実行時:

  * 既存セッションがあっても検証を走らせる
  * 検証失敗時:

    * WebUI は起動してよいが、`/api/status` に `valid:false` と `errors:[...]` を返し、UI に警告表示
    * (オプション)`--strict` なら失敗終了

---

## 7. Web UI 仕様

### 7.1 機能

* ログ閲覧: ういちゃん/あいちゃん/小人1..8 の最新 N 行
* 送信: ういちゃんへのみ

  * 自由入力
  * preset ボタン(config/presets.json)
* 自動更新: ON(デフォルト)

  * ポーリング間隔: 2秒(固定)

### 7.2 画面構成(最小)

* 上部: 状態(tmux有無、検証結果、ポート)
* 左: 閲覧対象セレクタ(uichan/aichan/kobito1..8)
* 右: ログ(`<pre>`)
* 下: 入力欄 + 送信ボタン + presets

---

## 8. API 仕様

| Method | Path           | 概要            | Request                   | Response                                                                          |
| ------ | -------------- | ------------- | ------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/health`  | 稼働確認          | -                         | `{ok:true}`                                                                       |
| GET    | `/api/status`  | tmux状態 + 検証結果 | -                         | `{rakuen:true, multiagent:true, valid:true/false, errors:[...], pane_meta:{...}}` |
| GET    | `/api/pane`    | ログ取得          | `?agent=uichan&lines=300` | `{agent, lines, text}`                                                            |
| POST   | `/api/send`    | ういちゃんへ送信(固定)     | `{text:"..."}`            | `{ok:true}`                                                                       |
| GET    | `/api/presets` | preset定義      | -                         | `{presets:[{id,label,text},...]}`                                                 |

### 8.1 agent allowlist

* `uichan`, `aichan`, `kobito1..kobito8`
* `agent -> tmux target`:

  * `uichan -> rakuen:0.0`
  * `aichan -> multiagent:0.0`
  * `kobitoN -> multiagent:0.N`

### 8.2 lines 制約

* `50..1000` に clamp
* default `300`

### 8.3 send 制約

* `target` は受け取らない(必ず `rakuen:0.0`)
* `text` 最大 8KB

---

## 9. ポート自動インクリメント仕様

* 初期: 8080
* bind失敗時: 8081, 8082, ...
* 上限: 8099(超えたらエラー)
* 成功時: `http://127.0.0.1:<port>` を出力

---

## 10. 受け入れ基準

* [ ] WSL 以外で起動しない
* [ ] `~/p1/repo` で `rakuen-web` を叩くだけで UI が起動
* [ ] repo に新規ファイルを生成しない(全て `/home/<user>/rakuen`)
* [ ] ういちゃん/あいちゃん/小人のログが閲覧できる(スナップショット)
* [ ] 送信はういちゃんのみ(自由入力 + presets)
* [ ] ポート競合時に自動でインクリメント
* [ ] 既存 tmux セッションがあれば破壊しない
* [ ] 各 pane の title と env が `agents.json` 定義と一致することを検証し、結果を UI に表示

---

## 11. 既知の制約・注意(設計上の要点)

* env 検証は pane にコマンドを注入してログに痕跡が残る(強度優先)。
* pane index のズレは致命的。`rakuen-launch` は pane index 0..8 を必ず確定させる。
* WebUI は 127.0.0.1 のみ。外部公開は想定しない。
