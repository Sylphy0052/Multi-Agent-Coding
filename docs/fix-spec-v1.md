# **Rakuen System 統合仕様書 v2.5 (Detailed Edition)**

## **(Optimization, Parallelization & Stability)**

**バージョン**: 2.5.0

**作成日**: 2026-02-01

**適用対象**: rakuen/, bin/, config/, instructions/, webui/

**概要**: コンテキスト効率の最適化(v2.2)、エージェント並列稼働の最大化(Aggressive Parallelization)、およびシステム信頼性の向上(v2.4)を統合し、具体的な実装要件を定義したマスター仕様書。

## **1\. コア・アーキテクチャ方針 (Core Principles)**

### **1.1 「憲法」による統制 (Context Optimization)**

rakuen/CLAUDE.md をシステムの「憲法」とし、全エージェントの行動を以下のルールで縛る。自然言語による曖昧な指示を排除し、プロトコルとして定義する。

* **Protocol: 2-Step Send-Keys**  
  * tmux send-keys は必ず「メッセージ送信」と「Enter送信」の2ステップに分割する。  
  * **禁止**: tmux send-keys \-t target "msg" Enter (1行書き)  
  * **理由**: 1行で書くと、メッセージ入力中にEnterが処理され、指示が途切れる事故を防ぐため。  
* **Format: ISO8601 Time**  
  * 日時は必ず date "+%Y-%m-%dT%H:%M:%S" (例: 2026-02-01T12:00:00) を使用する。  
  * **理由**: 言語依存（"2月1日"など）を排除し、ログ解析を容易にするため。  
* **Style: Directive Style**  
  * instructions/\*.md は「です・ます」調や情緒的な表現を排除する。  
  * 設定ファイル的な記述（Directive）に統一し、トークン消費を最小化する。  
  * **例外**: 出力例（Examples）にはペルソナ（口調）を含め、キャラクター性を維持する。

### **1.2 積極的並列化 (Aggressive Parallelization)**

AI-CHANの評価指標を「スループット（単位時間あたりの成果物数）」に設定する。

* **Idle is Loss (アイドルは損失)**: 小人が待機している時間を「リソースの損失」と定義する。  
* **Micro-Tasking (超細分化)**: タスクは以下の粒度で強制的に分解する。  
  * **ファイル単位**: 5ファイル作成 → 5タスク  
  * **機能レイヤー単位**: DB定義 / API実装 / UI実装 → 3タスク  
  * **工程単位**: 実装 / テストコード作成 → 2タスク  
* **Load Balancing (均等分散)**:  
  * 「小人1から順に使う」思考を撤廃。  
  * ID:1〜8のリソースをランダムまたはラウンドロビンで均等に使用する。

## **2\. データスキーマ詳細 (Data Schema)**

### **2.1 YAMLキー短縮マップ (Token Reduction)**

LLMのトークン削減と通信速度向上のため、通信用YAMLファイルのキーを短縮する。

**注意**: これに伴い、YAMLを読み書きする全コンポーネントの改修が必須となる。

| 項目 | 旧キー | 新キー | 影響するファイル・箇所 |
| :---- | :---- | :---- | :---- |
| 日時 | timestamp | **ts** | app.py (解析ロジック), webui/js/utils/format.js |
| 詳細 | description | **desc** | rakuen-launch (初期化tpl), kobito.md (例示) |
| 指示 | command | **cmd** | uichan.md, app.py, uichan\_to\_aichan.yaml |
| 作業者 | worker\_id | **wid** | app.py, kobito.md, reports/\*.yaml |
| スキル | skill\_candidate | **sc** | kobito.md, aichan.md |
| 状態 | status | **st** | app.py (オプション、視認性のため維持も検討) |

### **2.2 ライブラリ刷新**

信頼性向上のため、正規表現による簡易パースを廃止する。

* **PyYAML導入**: app.py およびツール類で import yaml を使用。  
* **依存管理**: rakuen/webui/requirements.txt に PyYAML を追加。

## **3\. コンポーネント別変更仕様 (Component Specs)**

### **3.1 Backend (rakuen/webui/app.py)**

* **YAML解析ロジック変更**:  
  * \_parse\_yaml\_entries 関数を改修し、新キー (ts, cmd, wid 等) を読み取ってフロントエンド用キー (timestamp 等) にマッピングして返すアダプター層を実装する。  
  * parse\_simple\_yaml (自作関数) を廃止し、yaml.safe\_load に置き換える。

### **3.2 Launcher (rakuen/bin/rakuen-launch)**

* **初期化テンプレート更新**: initialize\_runtime 関数内で生成する queue/tasks/kobito{N}.yaml 等の初期状態を、新キー仕様（ts, desc）に書き換える。  
* **ログ常時記録 (Pipe Pane)**:  
  * tmuxセッション作成時に pipe-pane を設定し、ブラウザを閉じていてもログが残るようにする。  
  * コマンド例: tmux pipe-pane \-t multiagent:0.0 \-o 'cat \>\> $WORKSPACE\_DIR/logs/aichan.log'

### **3.3 Instructions (rakuen/instructions/)**

* **aichan.md (AI-CHAN)**:  
  * 並列化セクションを大幅強化。「3ファイル以上の変更は、必ず3人以上の小人に分散せよ」といった具体的数値目標を記述。  
  * 「思考プロセス例」を追加：悪い例（直列思考）と良い例（並列思考）を対比させる。  
* **kobito.md (KOBITO)**:  
  * 報告フォーマットの例示を新キー (wid, ts, sc) に変更。  
  * 「自分専用ファイル以外読み書き禁止」ルールを再徹底。

### **3.4 Config (rakuen/config/agents.json)**

* **起動プロンプト圧縮**:  
  * 冗長な指示を削除し、「\[System\] Read CLAUDE.md & instructions immediately.」形式に統一する。

## **4\. 実装ロードマップ (Implementation Roadmap)**

### **Phase 1: 基盤強化と最適化 (1-2週間) \- Immediate Action**

このフェーズはシステムの安定性と効率を飛躍的に高めるため、最優先で実行する。

1. **Dependencies**: requirements.txt に PyYAML を追加し、インストール。  
2. **Code Fix (Backend)**:  
   * app.py のYAMLパース処理を PyYAML 化。  
   * 短縮キー (ts, cmd) を解釈するロジックを実装。  
3. **Code Fix (Launcher)**:  
   * rakuen-launch の初期化テンプレートを修正。  
   * tmux pipe-pane によるログ保存を実装。  
4. **Instruction Rewrite**: 全エージェントの指示書を Directive Style & 並列化仕様に書き換え。  
5. **Clean Boot**: 旧フォーマットのYAMLファイルが残っているとエラーになるため、初回は \--clean オプション相当の手動削除を行って起動する。

### **Phase 2: アーキテクチャ刷新 (2-4週間)**

ファイルベース通信の限界（排他制御、速度）を突破する。

1. **SQLite移行**:  
   * queue/\*.yaml を廃止し、rakuen.db (SQLite) に移行。  
   * テーブル設計: tasks, logs, kv\_store。  
   * PythonスクリプトによるDB操作ツール (db\_tool.py) をエージェントに提供。  
2. **SSE (Server-Sent Events) 導入**:  
   * app.py に /api/events エンドポイントを追加。  
   * Web UI (app.js) をポーリングからイベントリスナー方式に変更し、リアルタイム更新を実現。

### **Phase 3: 安全性と自律性 (1ヶ月〜)**

AIの暴走や停止を防ぐ安全装置を実装する。

1. **Command Validator**:  
   * rm \-rf / や重要な設定ファイルの削除など、危険なコマンドをフックして遮断するミドルウェア層。  
2. **Auto Watchdog (自律介入)**:  
   * エージェントが無限ループやエラー応答を繰り返す場合、UI-CHANが自動的に Ctrl+C を送信したり、プロセスを再起動する自律機能を実装。

## **5\. 移行・デプロイ手順 (Migration Guide)**

本バージョン (v2.5) はデータ形式に変更があるため、以下の手順で慎重に移行すること。

### **5.1 準備**

\# 1\. 依存ライブラリの更新  
pip install PyYAML  
\# または  
pip install \-r rakuen/webui/requirements.txt

### **5.2 適用と起動**

**注意**: 旧バージョンのキューファイル (queue/\*.yaml) との互換性はありません。

\# 1\. 旧プロセスの停止  
tmux kill-session \-t rakuen  
tmux kill-session \-t multiagent

\# 2\. 旧データのクリーンアップ (必須)  
\# ワークスペース内のキューファイルを削除してリセットする  
rm \~/rakuen/workspaces/\<project\>/queue/\*.yaml  
rm \~/rakuen/workspaces/\<project\>/queue/tasks/\*.yaml  
rm \~/rakuen/workspaces/\<project\>/queue/reports/\*.yaml

\# 3\. 新バージョンのデプロイ  
./rakuen/setup.sh \--force

\# 4\. 起動  
rakuen-web

## **6\. 期待されるKPI (Key Performance Indicators)**

本仕様の適用により、以下の数値目標達成を目指す。

* **タスク完了速度**: 複数ファイル生成タスクにおいて、直列処理比で **300%** 向上。  
* **コスト効率**: トークン消費量（入力/出力）を **20%** 削減。  
* **稼働安定性**: YAMLパースエラーによる停止頻度を **0件** にする。  
* **リソース稼働率**: 小人（Kobito 1-8）の平均稼働率を **50%以上** に引き上げる（現状は特定個体に集中）。
