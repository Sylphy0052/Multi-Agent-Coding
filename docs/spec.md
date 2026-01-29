## 0. 前提とゴール

### 0.1 ゴール（ユーザー要件の再定義）

* **Web UI**でユーザがプロンプトを投入 → **指示受け取り** → **オーケストレーション** → **エージェント群（Claude Code × N）**へ分配し成果物を回収する。
* **Web UI**で進捗/成果物/ログ/矛盾を確認できる（ダッシュボード）。
* エージェント実行は **バックグラウンドで tmux 上に Claude Code を多重起動**して行う。
* **UIちゃん/AIちゃん/Kobito** のキャラクター性（人格/口調/役割定義）を差し替え可能。
* `sh` 実行で **API サーバ / tmux / エージェント**が立ち上がり、ユーザは **Webで入力と確認だけ**行う。
* 主な利用フローは **仕様書作成 → 実装 → テスト**（成果物の型と品質ゲートをこの3段階に最適化する）。
* 役職（AIちゃん/Kobitoの職能ロール）は **当面は固定**とし、将来は **設定変更で差し替え可能**な設計にする（プロファイル/設定ファイルによる切替）。

### 0.2 非ゴール（スコープ外）

* 複数ユーザー同時利用の完全なマルチテナント（将来拡張として扱う）。
* Claude Code 自体の内部改造（CLIを外部制御する範囲に留める）。
* 強制的な長期メモリ学習（ファイルベースのメモリ/知識注入は扱うがモデル学習は扱わない）。

---

## 1. システム概要

### 1.1 全体像（論理アーキテクチャ）

* **Web Frontend**

  * プロンプト入力、実行開始、実行履歴、ダッシュボード閲覧
* **API Server（Orchestrator API）**

  * 受付（prompt）→ job 生成 → キュー投入 → 状態管理 → ダッシュボード更新
* **Orchestrator Core（AIちゃん Engine）**

  * タスク分解、ワーカー割当、結果集約、品質ゲート、矛盾検出
* **Agent Runtime（tmux + Claude Code）**

  * tmux セッションに **AIちゃん（管理）** と **Kobito（ワーカー N）** を配置
  * `tmux send-keys` により指示投入
* **State Store（永続/再起動耐性）**

  * まずは **ファイル（YAML/JSON/MD）**ベース
  * 将来的に SQLite/Redis へ差し替え可能な抽象化

### 1.2 主要コンセプト

* **Job / Task / Report / Artifact / Trace**

  * Job：ユーザの1リクエスト単位（IDを付与）
  * Task：Jobを分解した単位（ワーカーへ配布）
  * Report：Task結果（Kobito → AIちゃん）
  * Artifact：Repoに保存される成果物（Markdown）
  * Trace：オーケストレーションの実行トレース（監査ログ）
* **角色（Role）**

  * **UIちゃん**：Webユーザとの対話・受領・委譲（UI上の人格、可愛い女の子の助手）
  * **AIちゃん**：分解/配布/集約/品質ゲート（しっかりもの、忙しそう）
  * **Kobito**：実作業（小さい女の子のワーカー群）

---

## 2. 機能要件（FR）

> 承認（Approve）の推奨運用：**フェーズ単位（spec/impl/test/summary）**でユーザ承認。Webは全文ではなく、AIちゃんが生成した **差分要約**を **UIちゃんがWeb向けに短く要約して表示**し、対象ファイルパスを提示する。詳細確認はユーザが repo の Markdown を直接参照する。
>
> UIちゃん要約の表示項目（推奨・固定）：
>
> * **変更点（3〜7箇条）**：何が追加/変更/削除されたか
> * **影響範囲**：どのモジュール/ファイル/仕様節に波及するか
> * **未確実性・要確認（最大3点）**：仮定、検証不足、追加で確認すべき点
> * **リスク（最大3点）**：安全性/互換性/運用/コスト等、承認前に把握すべき注意点
> * **承認判断のポイント**：このフェーズでOKとする条件（受入基準の要約）

### FR-01 Webプロンプト投入

* Webフォームからプロンプトを入力し、実行を開始できる。
* 入力は以下を含む：

  * repo_root（**最初に入力**。Claude Code / tmux は **このディレクトリを作業ルート（cwd）**として起動する）
  * prompt 本文
  * 目的種別（**仕様書作成 → 実装 → テスト**を主フローとして最適化）
  * 制約（時間/コスト/出典必須など）
  * 並列度（N：ワーカー数）
  * キャラクタープリセット（**UIちゃん/AIちゃん/Kobito** のセット。MVPは固定）

### FR-02 Orchestrator API 受付〜Job生成

* API は prompt を受け取り、job_id を発行し、初期状態を作成する。
* job の状態遷移（例）：

  * RECEIVED → PLANNING → DISPATCHED → RUNNING → AGGREGATING → **WAITING_APPROVAL** → (APPROVED) → COMMITTING → COMPLETED
  * 例外：FAILED / CANCELED
* **承認ゲート（ユーザ承認＝C）**：

  * spec/impl/test の各フェーズは、AIちゃんが「フェーズ完了候補」を生成しても **即コミットしない**。
  * Web UI 上でユーザが「承認」した場合にのみ、develop へのマージ/コミット（FR-06）を実行する。

### FR-03 タスク分解と配布（AIちゃん）

* AIちゃんは prompt を読み、Task を生成し、ワーカー（Kobito）に割り当てる。
* **デフォルト（固定ロール）**：MVPでは職能ロールを固定し、運用で安定させる。

  * 例：仕様化担当／実装担当／テスト設計担当／反証・レビュー担当（具体は後述）
* **将来（設定変更）**：role assignment を設定ファイルで差し替え可能にする。
* 割当ルール：

  * 職能ロール（固定職）に応じた配布
  * 高優先度タスクの先行
  * 冗長性（同一テーマの二重調査）オプション
* **フロー最適化**：タスク分解は「仕様→実装→テスト」の成果物連鎖を前提にする。

  * 仕様タスク：要求/非機能/受入基準/曖昧点の洗い出し
  * 実装タスク：構成/差分設計/コード生成/レビュー観点
  * テストタスク：テスト戦略/ケース設計/エッジケース/自動化観点

### FR-04 tmux上での多重Claude Code起動

* `sh` 実行により tmux セッションを作成し、AIちゃん/Kobito の pane を生成する。
* 各 pane で `claude`（Claude Code CLI）を起動し、指示は `tmux send-keys` によって投入する。
* 非対話モード・権限設定（例：dangerously-skip-permissions）を構成で制御できる。

### FR-05 Webダッシュボード

* Webで以下を確認できる（**成果物本文はRepo側のMarkdownに保存し、Webは進捗と実行トレース中心**）：

  * Job一覧と状態
  * Job詳細（タスク一覧、進捗、担当ワーカー、ログ、成果物パス）
  * **オーケストレーション実行トレース**（誰が・いつ・何を指示し・どの経路で動いたか）

    * UIちゃん→AIちゃんの委譲内容
    * AIちゃん→Kobitoのタスク割当
    * 主要イベント（DISPATCH/START/REPORT/AGGREGATE/COMMIT/COMPLETE）
  * 統合結果（AIちゃんの最終レポート要約）
  * 矛盾・リスク・追加アクション
* Web上で表示する情報の粒度：

  * **表示**：状態、差分要約、成果物パス、実行履歴（Trace）
  * **非表示（原則）**：生成物の全文（Markdownはrepo保存を正とする）
  * **クリック導線要件なし**：Webからrepoファイルを開くリンク提供は必須としない（パス表示で十分）

### FR-06 成果物の回収と統合

* Kobito は report を規定スキーマで提出し、AIちゃんが統合する。
* AIちゃんは品質ゲートを通して最終成果物を生成：

  * 重複排除
  * 矛盾検出と解消（or 未解決として明示）
  * 不確実性・検証不足の明記
  * 出典（URLやファイル参照）を可能な範囲で付与
* **Repo保存（Markdown）と自動コミット（main←develop←job）**：

  * 仕様/実装/テストの成果物は **repo内の固定パス**に Markdown として保存する。
  * Git運用は **main（安定） ← develop（統合作業） ← job（作業ブランチ）** の階層とする。
  * Orchestrator は job 開始時に `jobs/{job_id}` ブランチを **develop から作成**し、作業は原則 job ブランチに集約する。
  * **フェーズ完了時**（spec/impl/test）に AIちゃんは「フェーズ成果物（候補）」を生成し、状態を **WAITING_APPROVAL** に遷移する。
  * ユーザが Web で **承認（Approve）**した場合にのみ、以下を実行して **develop に履歴を残す**：

    * job ブランチの変更を **develop にマージ**（推奨：**merge commit 固定**。複数ジョブ同時運用時の監査性と追跡性を優先し、FFはデフォルト無効）
    * `docs/jobs/{job_id}/(spec|impl|test).md`（または summary.md）の更新を develop 上で `git add/commit`
  * main への反映（develop→main マージ）は **本システムでは自動化しない**（人手の承認ステップ）。
  * commit は Trace に記録し、Web には commit の要約（コミットメッセージ、変更ファイル、ハッシュ）を表示する。

### FR-07 キャラクター性（人格/役割）の差し替え

* 人格（口調/価値観/判断基準）をプリセットとして管理し、将来的に Web UI から切り替え可能。
* MVPでは **UIちゃん/AIちゃん/Kobito** を固定し、後続で設定変更に拡張する。
* プリセットは以下を含む：

  * 口調/価値観/判断基準
  * 禁止事項
  * 委譲ポリシー（分解粒度、品質ゲートの厳しさ）
  * UI上のアバター/表示名

### FR-08 ワンコマンド起動

* `./start.sh`（仮）実行で以下が起動する：

  * APIサーバ
  * tmux セッション（AIちゃん + Kobito）
  * 状態ストア初期化
  * Web フロント配信（同一プロセス or 別プロセス）

---

## 3. 非機能要件（NFR）

### 3.0 同時実行制御（必須）

* 同時に処理できる job 数（**max_jobs**）を設定可能にする。
* **デフォルトは自動推定**：起動時に環境（CPUコア数/メモリ/過去の安定稼働値）から推定し、保守的に上限を設定する。

  * **利用可能メモリは予約量差し引き（後者）**：OSのfreeをそのまま使わず、Claude Code/tmux/Orchestratorが消費する見込み（予約量）を差し引いた `effective_available_mem_gb` を用いる。
  * **mem_reservation_gb は見積もり（係数モデル）**：

    * `mem_reservation_gb = base_gb + (agents_per_job * gb_per_agent) + (max_jobs * gb_per_job_overhead)`
    * 推奨初期値（MVP）：`base_gb=2`, `gb_per_agent=0.8`, `gb_per_job_overhead=1.0`
    * `agents_per_job = 1（AIちゃん） + N（Kobito）` を基本とし、UIちゃん/サーバ類のオーバーヘッドは base_gb に含める
  * 目的：過大な並列起動による OOM/スワップ地獄を避ける（保守的に見積もる）
  * 推定例（MVPの単純規則）：

    * `effective_available_mem_gb = max(0, os_free_mem_gb - mem_reservation_gb)`
    * `max_jobs = clamp(1, floor(effective_available_mem_gb / 6), floor(cpu_cores / 4))`
    * ただし `max_jobs <= 4` を上限（WSL2/単一ホスト前提の安全策）
  * 失敗率やリトライ頻度が閾値を超えた場合は **自動で max_jobs を下げる**（将来v1）。
* max_jobs を超える job は **QUEUED** とし、空きが出たら順次 RUNNING に遷移する。
* job ごとに tmux セッション・state を分離し、`develop` へのマージ/コミットは排他制御（lock）する。

### 3.1 可用性・再起動耐性

* Orchestrator 再起動後も Job 状態を復元できる（最低限：RUNNINGの再検知、ログの継続）。
* tmux セッションが落ちた場合の復旧手順を用意：

  * 自動再起動（オプション）
  * 手動復旧（推奨：まずは手動を仕様化）

### 3.2 セキュリティ

* Web UI へのアクセス制御（最低限：Basic Auth / IP制限）。
* プロンプト/ログの機密性（保存期間、マスキング）。
* `dangerously-skip-permissions` の利用は設定で切替。

### 3.3 コスト最適化

* ポーリング禁止（イベント駆動・差分更新）。
* 役割分担による無駄な推論削減。
* タスクの最大並列数・タイムアウト。

### 3.4 観測性

* job_id / task_id を全ログに付与。
* 主要メトリクス：

  * 平均完了時間、失敗率、再試行回数、同時実行数

---

## 4. データモデル（推奨：最初はファイル、将来DB）

> 方針：**成果物（仕様/実装/テスト）はRepoにMarkdownとして保存**し、Webは進捗とオーケストレーションの指示・実行まとめ（トレース）を表示する。

### 4.1 Job（例：job.json）

* job_id: string
* created_at: datetime
* status: enum
* user_prompt: string
* mode: enum (spec_impl_test)
* parallelism: int
* persona_set_id: string（UIちゃん/AIちゃん/Kobito のセット。MVPは固定）
* repo_root: string（**Webで最初に入力**。Claude Code はこのパスをルートとして起動する）
* artifacts: object（**固定配置規約**）

  * spec_md_path: string = `docs/jobs/{job_id}/spec.md`
  * impl_md_path: string = `docs/jobs/{job_id}/impl.md`
  * test_md_path: string = `docs/jobs/{job_id}/test.md`
  * final_summary_md_path: string = `docs/jobs/{job_id}/summary.md`（任意）
* git: object（**main←develop←job**）

  * main_branch: string = `main`
  * develop_branch: string = `develop`
  * job_branch: string = `jobs/{job_id}`
  * merge_policy: enum = `merge_commit`（MVP推奨）
  * last_commit_hash: string?
  * last_merge_hash: string?

### 4.2 Task（例：task.yaml）

* task_id: string
* job_id: string
* assignee: enum (ai-chan/kobito1..N)
* phase: enum (spec/impl/test)
* objective: string
* inputs: list
* constraints: list
* acceptance_criteria: list
* status: enum

### 4.3 Report（例：report.yaml）

* task_id
* job_id
* phase (spec/impl/test)
* summary
* findings[] (claim, evidence, confidence)
* risks[]
* contradictions[]
* next_actions[]
* artifact_updates[]

  * path: string（更新したMarkdown等）
  * change_summary: string（更新内容の要約）
* skill_candidate (found/description/reason)

### 4.4 Orchestration Trace（例：trace.jsonl / trace.yaml）

* trace は「どのように動いたか」を再現可能にするための監査ログ。
* 形式（最小）：

  * timestamp
  * job_id
  * actor: enum (web/ui-chan/ai-chan/kobitoN/system/git)
  * event_type: enum (RECEIVED/DELEGATED/DISPATCHED/STARTED/REPORTED/AGGREGATED/COMMITTED/COMPLETED/FAILED)
  * payload_summary: string（Web表示用の要約）
  * refs: {task_id?, artifact_path?, tmux_session?, pane?, commit_hash?}
* **Traceの永続**：append-only（jsonl推奨）。Webはこれを整形表示する。

---

## 5. 実行フロー（シーケンス）

### 5.1 ユーザ実行

1. Webで repo_root と prompt を投入
2. API が job 作成
3. AIちゃんがタスク分解
4. tmux send-keys で各 Kobito へ投入
5. Kobito が report を生成
6. AIちゃんが統合し、spec/impl/test の成果物（候補）を生成
7. Webダッシュボードに反映（状態：WAITING_APPROVAL）
8. ユーザがフェーズを承認すると、Orchestrator が job→develop をマージし、develop へコミット
9. 全フェーズ完了後、summary を生成し同様に承認→コミット

### 5.2 tmux制御方針

* pane ID の安定参照（セッション名 + ウィンドウ + pane index）
* send-keys は「文字列→Enter」を分離（実装上の事故回避）

---

## 6. コンポーネント設計（実装指針）

### 6.1 start.sh（起動スクリプト）

* 依存確認（tmux, node/python, claude CLI）
* state ディレクトリ初期化
* tmux セッション作成とエージェント起動
* API サーバ起動
* Web フロント起動

### 6.2 API（例）

* POST /jobs
* GET /jobs
* GET /jobs/{id}
* POST /jobs/{id}/cancel
* GET /jobs/{id}/dashboard
* **POST /jobs/{id}/phases/{phase}/approve**（phase: spec|impl|test|summary）

  * 承認後に COMMITTING を起動し、git merge/commit を実行
* **POST /jobs/{id}/phases/{phase}/reject**（任意）

  * 差戻し理由を保存し、AIちゃんが改善タスクを再生成

### 6.3 Web UI（最小）

* / : 入力フォーム
* /jobs : 実行履歴
* /jobs/{id} : 詳細 + ダッシュボード

---

## 7. キャラクタープロファイル仕様（人格/役割セット）

* **UIちゃん**：可愛い女の子、助手（ユーザ受付・委譲）
* **AIちゃん**：しっかりものの女の子、忙しそう（分解・配布・統合）
* **Kobito**：小さい女の子（実作業ワーカー群）

### 7.1 profile 定義（例：profiles/personas/*.yaml）

* persona_set_id
* ui_chan

  * display_name
  * tone_style
  * decision_policy
  * forbidden_actions
  * delegation_policy
* ai_chan

  * display_name
  * tone_style
  * quality_gates
  * forbidden_actions
  * distribution_policy
* kobito

  * display_name_prefix（例：Kobito-1）
  * tone_style
  * report_schema_version
  * forbidden_actions

### 7.2 適用ポイント

* Web UI 上の表示（発話・ラベル・状態）
* UIちゃんのメッセージ生成（UI応答）
* AIちゃんのタスク分解・品質ゲート（統合結果の型）
* Kobitoのレポート形式（artifact_updates の必須化など）

---

## 8. エッジケースと対策

* tmux pane が崩壊・番号がずれる → pane の検出/再割当
* claude CLI がプロンプトを受理しない → 再送/再起動
* report が壊れる（途中書き込み）→ tmp→mv の atomic write
* 長文プロンプト → 分割投入 or コンテキストファイル化
* **同時実行（必須）**：job ごとに tmux セッションと state ディレクトリを分離

  * 例：tmux session = `job-{job_id}`、state = `state/jobs/{job_id}/...`
* **max_jobs 超過**：QUEUED に積み、スケジューラが空きを検知して起動
* **git 競合（develop）**：複数ジョブが同時に develop へマージ/コミットしないように **排他ロック**

  * 例：`repo_root/.orchestrator/locks/develop.lock` を flock で取得
  * 競合・ロック取得失敗時は FAILED ではなく **WAITING_RETRY** とし、ユーザに再試行/手動対応を提示
* **自動リトライ（要件）**：WAITING_RETRY からの再試行は Orchestrator が自動で行う（**developロック/競合に限らず、ネットワーク一時断・git失敗・claude応答不良など一時障害は同一枠で扱う**）

  * **推奨：恒久障害の即FAILED判定（おすすめ）**

    * 例：認証/権限エラー（git認証失敗、repo_root不正、書込不可）、設定不備、依存コマンド未インストール、ブランチ不在、構文エラーなどは **即FAILED**
    * 一時障害（ネットワーク一時断、lock取得失敗、リモート一時不通、claude一時応答不良等）は **WAITING_RETRY**
    * 判定は `error_class`（TRANSIENT / PERMANENT）として Trace に記録する（Web表示は UIちゃん要約）
  * 最大回数：**10回**
  * バックオフ：段階的に待ち時間を伸ばす（上限10分）

    * 例：`10s → 30s → 60s → 120s → 240s → 480s → 600s → 600s ...`（以降は600s固定）
  * 最大回数超過で FAILED に遷移し、Webに「原因」「最後のエラー」「次アクション」を提示
* **承認待ちの滞留**：一定時間でリマインド（オプション）

---

## 9. 実装ロードマップ（MVP→拡張）

### MVP（1〜2スプリント）

* start.sh + tmux 起動
* APIで job 管理（ファイル保存）
* Web入力/ダッシュボード表示
* **固定ロール**でのAIちゃん分解（仕様→実装→テストの3段階に最適化したテンプレ）
* report スキーマの最小整備（spec/impl/test の成果物リンクが追えること）
* **承認（Approve）フロー**（推奨：フェーズ単位の承認 + 差分要約の提示）
* **同時実行上限**（max_jobs）とキューイング（後述）

### v1

* 品質ゲート強化（矛盾検出/不確実性/重複排除）
* 仕様→実装→テストの**成果物パイプライン**（specドラフト→実装差分→テストケース）をダッシュボードで可視化
* 再起動耐性/ログ整備

### v2

* ロールを設定変更で差し替え（profiles / config による職能定義）
* DB化（SQLite）
* マルチユーザ/認可
* スキル自動抽出→登録

---

## 10. 未確定事項（決めると設計が確定する）

* Web公開範囲（ローカル限定か、社内LANか）
* Claude Code 実行権限（dangerously-skip-permissions の扱い）
* 生成物の機密性（Web表示とrepo保存のマスキング/アクセス制御）

### 10.1 決定済み（確定要件）

* repo_root は **Webで最初に入力**し、Claude Code / tmux は **repo_root を作業ルート**として起動する。
* 成果物配置：`docs/jobs/{job_id}/(spec|impl|test|summary).md`
* Webは「進捗 + オーケストレーションの指示・実行トレース（Trace）+ 成果物パス + commit要約」のみ表示し、repoファイルへのクリック導線は必須としない。

  * 承認時の差分要約は **AIちゃんが生成し、UIちゃんがWeb向けに短く要約**して表示する。詳細はユーザが repo のファイルを確認する。
* Git運用：**main ← develop ← job**

  * フェーズ完了時（spec/impl/test/summary）に **ユーザ承認（Approve）**が必要（承認後にマージ/コミット）。
  * マージ方式は **merge commit 固定（推奨）**。FFはデフォルト無効。
  * develop→main は自動化しない（人手承認）。
* **同時実行は必須**：job ごとに tmux セッション・state を分離し、develop へのマージ/コミットは排他制御する。
* max_jobs は **デフォルト自動推定**（保守的）。設定で上書き可能。
