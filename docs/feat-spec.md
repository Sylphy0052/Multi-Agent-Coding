# Multi-Agent-Coding 改修仕様書＆実装計画書（Shogun準拠強化）

Version: 0.9  
Target: Multi-Agent-Coding（現状：Web UI + tmux/Claude Code CLI + spec/impl/test）を、Shogun思想（イベント駆動 / Memory MCP / スクショ運用 / Contextテンプレ / Skills体系 / サブロール）へ近づける  
前提: WSL2前提、tmux前提、Web UIあり

---

## 0. 目的と非目的

### 0.1 目的（What）

- **イベント駆動**（no polling）へ寄せ、タスク完了検知やジョブ進行をイベント中心に再設計する
- **Memory MCP相当**を導入し、セッション跨ぎの“決定・規約・既知不具合”を継続利用可能にする
- **スクリーンショット運用**（UIアップロード→解析→spec/impl/test反映）を実装する
- **Contextテンプレ**を導入し、ジョブ開始時に必須文脈を構造化して注入する
- **Skills体系**を導入し、品質ゲートを手順カプセルとして再利用・進化できるようにする
- **エージェント設計をShogunに近づける**：監査/品質専任、調査専任などのサブロール追加

### 0.2 非目的（What not）

- 外部SaaSのMCPサーバ実装や認証までを初回で必須にしない（まずはローカルMemory StoreでMVP → MCP差し替え可能にする）
- Web UIの全面刷新はしない（追加UIは最小に）
- 画像入力をClaude Code CLIに直接渡すことを前提にしない（CLI制約を吸収する：OCR/要約→プロンプト注入）

---

## 1. 現状整理（前提アーキテクチャ）

- Orchestrator: spec/impl/test を順に回す 3フェーズ
- tmux: Claude Code CLI複数起動をsend-keys/capture-paneで制御
- 状態管理: state_dir配下に job/task 状態や `.done` ファイルで完了判定（巡回チェックあり）
- Persona/Prompt: prompt-builder が各フェーズのプロンプトを生成
- Git ops: backend/src/git/ops.ts でブランチ/コミット

---

## 2. To-Beアーキテクチャ（Shogun準拠の中核設計）

### 2.1 イベント駆動（Event-driven）原則

- **定期巡回（polling）を原則撤廃**し、以下イベントで進行させる：
  - `task.done`（完了ファイル生成 or tmuxログ末尾シグナル）
  - `task.error`（クラッシュ/タイムアウト）
  - `asset.uploaded`（スクショ追加）
  - `memory.updated` / `skill.updated`
- 実装は Node の EventEmitter + fs.watch を基本にし、将来はキュー（BullMQ等）にも移行可能な形にする

### 2.2 Memory（MCP互換レイヤ）

- MVPはローカル永続：
  - `memory/decisions.md`
  - `memory/conventions.md`
  - `memory/known_issues.md`
  - `memory/glossary.md`（任意）
- **Memory Provider Interface**を定義し、将来MCPに差し替え可能にする：
  - `MemoryProvider.getContext(jobContext) -> string`
  - `MemoryProvider.applyUpdates(updates[])`
  - `MemoryProvider.search(query) -> snippets[]`（任意：将来）

### 2.3 スクリーンショット運用（UI Upload → Analyze → Inject）

- Web UIから画像をアップロードし、jobに紐付ける
- 画像解析は「**OCR（必須）** + **視覚要約（任意/将来）**」の二段階
- 解析結果は **Contextテンプレの“観測情報”** として spec/impl/test のプロンプトへ注入

### 2.4 Contextテンプレ

- Shogunの `context_template.md` 相当を導入し、以下を最低限含める：
  - 目的/背景、成功条件、制約、リポジトリ状況、実行コマンド、既知課題、スクショ解析結果、Memory抜粋、Skills適用
- Contextは「ジョブ開始時に固定」＋「イベントで追記（スクショ/決定事項）」の2系統

### 2.5 Skills体系

- `skills/` にスキルを定義（Markdown or YAML）
- Prompt Builder はジョブ種別・フェーズ・ファイル種別等から適用スキルを選び、プロンプトへ注入
- エージェントは実行後に `skill_candidate` / `skill_feedback` を生成し、AI統合役がスキル改善に反映（承認フローあり）

### 2.6 サブロール（監査/品質専任・調査専任）

- Shogun思想の「分業で非ブロッキング」を強化するため、最低2ロールを追加：
  - **Researcher（調査専任）**：仕様調査、根拠提示、関連コード探索、依存関係分析
  - **Auditor（監査/品質専任）**：diffレビュー、テスト戦略、セキュリティ/回帰リスク、規約整合性
- 既存の統合役（AIちゃん相当）と実行役（Kobito）に対し、成果物の品質ゲートを強制する

---

## 3. 機能仕様（Detailed Spec）

## 3.1 イベント駆動化

### 3.1.1 イベント一覧

| Event | Payload | 発火源 | 目的 |
|---|---|---|---|
| `task.started` | {jobId, taskId, phase, role} | TaskRunner | UI/ログ |
| `task.done` | {jobId, taskId, phase, role, artifacts} | fs.watch or tmux-signal | 次タスクへ |
| `task.error` | {jobId, taskId, error, stderrTail} | Runner | リトライ/停止 |
| `asset.uploaded` | {jobId, assetId, type} | Upload API | 解析キューへ |
| `asset.analyzed` | {jobId, assetId, ocrText, summary} | Analyzer | Context更新 |
| `memory.updated` | {jobId, updates[]} | Approver | 次フェーズへ反映 |
| `skill.updated` | {skillId, version} | Approver | 次ジョブへ反映 |

### 3.1.2 完了検知の方式（推奨）

- `.done` ファイルを作る方式は維持するが、**巡回を廃止**し `fs.watch` を導入する
- watch対象：
  - `state_dir/jobs/{jobId}/tasks/{taskId}.done`
  - `state_dir/jobs/{jobId}/tasks/{taskId}.error`

#### エッジケース

- `fs.watch` の取りこぼし対策：
  - 起動時に “存在チェック” を一度だけ行い、すでにdoneなら即emit
  - watch設定前後の競合を避けるため、タスク起動→watch登録→実行開始 の順序にする

### 3.1.3 タイムアウト/リトライ

- `task.timeout` を追加してもよい（P1）
- リトライポリシー（初期案）：
  - 解析タスク：最大2回
  - 実行タスク：最大1回（同じプロンプトでの無限リトライを避ける）

---

## 3.2 Memory（MCP相当）

### 3.2.1 データモデル

- `memory/*.md` をセクション分割し、追記可能にする
- 更新は「AI提案 → 承認 → 反映」のワークフロー

#### MemoryUpdate スキーマ（提案）

```json
{
  "type": "decision|convention|known_issue|glossary",
  "title": "短い見出し",
  "body": "追記内容（Markdown）",
  "rationale": "なぜ必要か",
  "confidence": 0.0,
  "sources": ["jobId:xxx taskId:yyy", "path:..."]
}
```

### 3.2.2 Prompt 注入ルール

- prompt-builder は毎フェーズで以下を注入：
  - `Memory Context (top N tokens)`：decisions/conventions/known_issuesから関連部分を抽出
- 抽出方式（MVP）：
  - 全文注入は避け、**直近更新＋キーワードマッチ**でスニペット化
  - 最大トークン上限を設定（例：1500 tokens）

### 3.2.3 MCP差し替えのためのインターフェース

```ts
interface MemoryProvider {
  getContext(input: { repoSummary: string; jobGoal: string; phase: string; keywords: string[] }): Promise<string>;
  applyUpdates(updates: MemoryUpdate[]): Promise<void>;
  search?(query: string): Promise<Array<{title: string; snippet: string}>>;
}
```

---

## 3.3 スクリーンショット（UI Upload → Analyze → Inject）

### 3.3.1 UI要件

- Job詳細画面に「Screenshots」セクション
  - 画像アップロード（複数可）
  - プレビュー、削除（P1）、タグ付け（任意）
- 画像は jobに紐付くアセットとして保存

### 3.3.2 Backend API（案）

- `POST /api/jobs/:jobId/assets` (multipart/form-data)
  - 受理後 `asset.uploaded` emit
- `GET /api/jobs/:jobId/assets`
- `GET /api/jobs/:jobId/assets/:assetId`
- `GET /api/jobs/:jobId/assets/:assetId/analysis`

### 3.3.3 保存設計

- `state_dir/jobs/{jobId}/assets/{assetId}.{ext}`
- `state_dir/jobs/{jobId}/assets/{assetId}.json`（メタ）

```json
{
  "assetId": "...",
  "type": "screenshot",
  "filename": "...png",
  "uploadedAt": "...",
  "analysis": {
    "status": "pending|done|error",
    "ocrText": "...",
    "summary": "...",
    "uiFindings": [
      {"severity":"high|med|low","title":"...","detail":"...","evidence":"..."}
    ]
  }
}
```

### 3.3.4 解析仕様（MVP）

- OCRは必須（Tesseract等ローカル）
- 解析結果（`uiFindings`）は次のテンプレに整形してContextへ挿入：
  - 画面上のエラー文言
  - 再現手順の推定（あれば）
  - 期待挙動 vs 実際挙動
  - 影響範囲仮説
- 画像の“視覚要約”はP1（将来）：
  - UI崩れの検出、重要領域の抽出など（外部モデル利用は別途検討）

### 3.3.5 spec/impl/test への反映ルール

- `asset.analyzed` 時に Job Context を更新し、次フェーズのプロンプト生成に必ず含める
- すでに走っているタスクへは「割り込み反映」をしない（MVPでは難易度高い）
  - 代替：次のタスク/次フェーズ開始時に必ず注入
  - P1：手動で「再実行」ボタン

---

## 3.4 Contextテンプレ

### 3.4.1 テンプレファイル構成（案）

- `templates/context_template.md`
- `templates/context_sections/*.md`（任意：分割）

### 3.4.2 Contextテンプレ（骨子）

```md
# Job Context
## Goal
- ...

## Success Criteria
- ...

## Constraints
- WSL2, tmux, Claude Code CLI
- ...

## Repo Snapshot
- Root structure:
- Entry points:
- Build/test commands:

## Memory Context
### Decisions
...
### Conventions
...
### Known Issues
...

## Screenshot Findings
- Asset: ...
  - OCR:
  - Findings:

## Skills Applied
- skill: ...

## Open Questions
- ...
```

### 3.4.3 生成・更新

- Job作成時：ユーザー入力 + repo summary + memory snippetで初期Context生成
- asset.analyzed / memory.updated / skill.updated：該当セクションを追記更新
- Contextは `state_dir/jobs/{jobId}/context.md` に保存

---

## 3.5 Skills体系

### 3.5.1 Skill定義フォーマット（MVP）

- `skills/{skillId}.md`（推奨）
- スキルは “いつ使うか / 入力 / 手順 / 出力契約 / 罠” を明記

```md
# skill: ui-bug-triage
## When to use
- UIスクリーンショットから不具合原因を推定する場合

## Inputs
- Screenshot Findings
- Error logs (if any)
- Recent commits

## Steps
1. ...
2. ...

## Output Contract
- Root cause hypothesis
- Minimal fix
- Regression tests

## Pitfalls
- ...
```

### 3.5.2 Skill選択ロジック

- ルールベース（MVP）：
  - job type: ui-bug / refactor / feature / test-fix
  - phase: spec/impl/test
  - asset: screenshot有無
- 将来：埋め込み検索（P2）

### 3.5.3 Skill改善フロー（承認制）

- 各タスク終了時、エージェントが `skill_candidate` をレポートに出す
- Auditorが候補をレビューし、承認されたものだけ `skills/` に反映
- 反映時に `skill.updated` emit

---

## 3.6 エージェント設計（サブロール追加）

### 3.6.1 ロール一覧（提案）

| Role | 目的 | 主成果物 | 走るタイミング |
|---|---|---|---|
| Orchestrator（統合） | フェーズ進行・統合判断 | Plan / Phase gate | 常時 |
| Implementer（実装） | コード変更・修正 | PR相当diff | impl |
| Tester（テスト） | テスト追加/修正 | test plan / tests | test |
| **Researcher（調査）** | 依存関係/既存実装探索 | findings, options | spec前後/詰まり時 |
| **Auditor（監査/品質）** | 品質/安全/規約/回帰 | review report, gate pass/fail | 各フェーズ出口 |

### 3.6.2 役割のゲーティング（Shogun寄せ）

- spec完了条件：Auditorが “Spec Gate: PASS”
- impl完了条件：Auditorが “Impl Gate: PASS”
- test完了条件：Auditorが “Test Gate: PASS”
- PASSしない場合：差戻しタスクを自動生成（イベント駆動）

### 3.6.3 Persona/Prompt分離

- `config/personas/` に Researcher / Auditor 追加
- それぞれのプロンプトに **Contextテンプレ + Memory + Skills + Screenshot Findings** を注入

---

## 4. 実装計画（Implementation Plan）

## 4.1 フェーズ分割（P0/P1/P2）

### P0（最短でShogun準拠の中核を成立）

1) Event Bus + fs.watch による `.done` 完了検知（polling撤廃）  
2) Memory Store（ローカル） + prompt注入 + 更新提案/承認（簡易）  
3) Screenshot Upload API + 保存 + OCR解析 + Context追記 + prompt注入  
4) Contextテンプレ導入（context.md生成/更新）  
5) Skills体系MVP（skills/読み込み + prompt注入）  
6) Researcher/Auditor サブロール追加 + ゲーティング（PASS/FAIL）

### P1（運用品質）

- スクショ削除/タグ/再解析
- 解析失敗時リトライ
- “再実行”ボタン（特定タスクの再投入）
- Memory/Skillsの差分レビューUI（承認をUIで）
- 視覚要約（OCR以外の所見）

### P2（高度化）

- Memory Provider を MCPサーバに差し替え
- Skills検索をembedding化
- Pipelineを可変化（spec/impl/test以外のステップを追加可能）

---

## 4.2 主要変更点（ファイル/モジュール案）

### 4.2.1 Event-driven化

- `backend/src/events/bus.ts`（新規）
  - EventEmitterラッパ、型付きイベント
- `backend/src/runners/task-runner.ts`（改修）
  - タスク起動前に watch 登録
- `backend/src/runners/fs-watch.ts`（新規）
  - `.done/.error` の監視とemit

### 4.2.2 Memory

- `backend/src/memory/provider.ts`（新規：interface）
- `backend/src/memory/local-md.ts`（新規：MVP実装）
- `backend/src/personas/prompt-builder.ts`（改修：Memory注入、関連抽出）
- `shared/types.ts`（改修：MemoryUpdate, Report拡張）

### 4.2.3 Screenshot

- `backend/src/routes/assets.ts`（新規 or 既存routesに追加）
- `backend/src/assets/store.ts`（新規：保存/取得）
- `backend/src/assets/analyzer/ocr.ts`（新規：OCR）
- `backend/src/assets/analyzer/pipeline.ts`（新規：解析ワークフロー）
- `frontend/src/components/JobAssets.tsx`（新規/改修：アップロードUI）
- `frontend/src/pages/JobDetail.tsx`（改修：assets表示）

### 4.2.4 Contextテンプレ

- `templates/context_template.md`（新規）
- `backend/src/context/context-manager.ts`（新規：生成/更新）
- `backend/src/personas/prompt-builder.ts`（改修：context.md注入）

### 4.2.5 Skills

- `skills/`（新規）
- `backend/src/skills/registry.ts`（新規：読み込み/選択）
- `backend/src/personas/prompt-builder.ts`（改修：skills注入）

### 4.2.6 Roles

- `config/personas/researcher.yaml`（新規）
- `config/personas/auditor.yaml`（新規）
- `backend/src/orchestrator/pipeline.ts`（改修：サブロールタスク生成、ゲーティング）

---

## 4.3 受け入れ基準（Acceptance Criteria）

### イベント駆動

- RUNNINGタスクの巡回チェックが無い（ログ上/コード上で確認）
- `.done` 生成で即座に次タスクへ遷移する
- watch取りこぼし対策がある（起動時存在確認）

### Memory

- 1回目ジョブで作られた decision/convention が、2回目ジョブの spec プロンプトに注入される
- Memory更新は “提案→承認→反映” の形で追跡できる（最低ログでもよい）

### Screenshot

- Web UIからpng/jpgをアップロードできる
- OCR結果がJob詳細に表示される
- OCR結果が spec/impl/test のプロンプトに注入される（ログで確認）

### Contextテンプレ

- `context.md` が生成され、スクショ解析/メモリ更新イベントで追記される
- 生成されたcontextがプロンプトに含まれる

### Skills

- 少なくとも2つのスキルが定義され、条件に応じて注入される
- スキルの出力契約（Output Contract）がレポートに反映される

### Roles / Gate

- spec/impl/test の各フェーズ終端に Auditor の PASS/FAIL が存在
- FAILの場合は差戻しタスクが自動で発行される

---

## 5. AI（エージェント）への指示書（運用プロンプト規約）

## 5.1 共通規約（全ロール共通）

- 入力として `context.md` を最優先に参照する
- `Memory Context` を“規約・決定事項として拘束力がある”扱いにする（矛盾があれば指摘）
- `Skills Applied` の `Steps` と `Output Contract` を満たす形で出力する
- 出力は、必ず以下のヘッダ構造を含む：
  - `## Findings`（観測・根拠）
  - `## Plan`（手順）
  - `## Changes`（変更点）
  - `## Risks`（回帰/安全）
  - `## Tests`（実行/追加テスト）
  - `## Memory/Skill Updates`（提案）

## 5.2 Researcher 指示（調査専任）

- 目的：既存コード/依存/設計パターンを早く把握し、選択肢と推奨案を提示
- 必須出力：
  - “現状把握（どこが責務か）”
  - “実装候補案（少なくとも2案）”
  - “推奨案と理由（速度/安全/保守）”
  - “変更影響範囲（ファイル/モジュール）”
  - Memory/Skill候補（あれば）

## 5.3 Auditor 指示（監査/品質専任）

- 目的：各フェーズの品質ゲートを判定し、回帰・規約逸脱・セキュリティリスクを抑止
- 必須出力：
  - Gate判定：`PASS` / `FAIL`
  - FAIL理由：具体（再現/影響/規約）
  - 修正指示：最小差分で直せる指示
  - テスト要件：何をどう確認するか
  - Memory/Skill更新提案（再発防止）

---

## 6. タスク分解（実装チケット例）

### Ticket P0-ED-01: Event Bus導入

- bus.ts 作成、型付きイベント定義
- TaskRunner/Orchestratorにemitを追加

### Ticket P0-ED-02: fs.watchでdone検知

- tasksディレクトリ監視
- 起動時done存在チェック
- done/errorでイベント発火→次へ

### Ticket P0-MEM-01: MemoryProvider(MVP)追加

- local-md provider実装
- decisions/conventions/known_issuesの読み書き

### Ticket P0-MEM-02: prompt-builderへMemory注入

- jobGoal/phase/keywordsで抽出
- 最大注入量制限

### Ticket P0-ASSET-01: Upload API + 保存

- multipart受け取り
- assetsメタ生成
- asset.uploaded emit

### Ticket P0-ASSET-02: OCR解析パイプライン

- analyzer/ocr.ts
- asset.analyzed emit
- Job UI表示

### Ticket P0-CTX-01: Contextテンプレ生成/更新

- context-manager 実装
- asset.analyzed / memory.updated / skill.updated で追記

### Ticket P0-SKILL-01: Skills registry

- skills/読み込み
- 選択ロジック
- prompt注入

### Ticket P0-ROLE-01: Researcher/Auditor persona追加

- config/personas追加
- pipelineへ差し込み

### Ticket P0-ROLE-02: Gate判定と差戻し自動生成

- Auditor出力からPASS/FAIL解析
- FAILなら修正タスクを自動生成

---

## 7. リスクと対策

### 7.1 OCR精度・ノイズ

- 対策：OCR生テキスト + 重要箇所抽出（正規表現で error/exception/failed を優先）
- 画像が英語/日本語混在の場合は言語設定を切替（WSL2でTesseractの言語データ追加）

### 7.2 fs.watchの不安定性

- 対策：起動時存在確認 + watchFile fallback（P1）
- 万一の復旧：手動「状態再スキャン」ボタン（P1）

### 7.3 プロンプト肥大化

- 対策：Memory/Skills/Contextの注入上限を設ける
- 重要度順にトリミング（Memoryは決定事項優先、Skillsは適用スキルのみ）

### 7.4 ゲーティングで停滞

- 対策：FAIL時の差戻しは “最小修正の明確指示” をAuditorに強制
- FAIL連鎖を防ぐため、最大差戻し回数を制限（例：2回）

---

## 8. Doneの定義（プロジェクト完了条件）

- P0のAcceptance Criteriaを全て満たす
- UIスクショ→OCR→spec/impl/test注入が実運用で機能する
- Auditorゲートで品質が一段上がる（テスト追加/回帰減）
- Memoryがジョブ跨ぎで再利用され、規約・決定が継続される

---

## 9. 次アクション（実装順の推奨）

1) Event Bus + fs.watch（進行の土台）
2) Contextテンプレ（注入の器）
3) Screenshot Upload + OCR（UI起点の価値）
4) Memory（再現性の核）
5) Skills（品質の仕組み化）
6) Roles/Gate（Shogunらしさの完成）

---

# 追加詳細指示書（Shogun準拠へ寄せるための実装・運用ディレクティブ）

Version: 1.0  
Scope: イベント駆動 / Memory MCP / スクリーンショット / Contextテンプレ / Skills体系 / サブロール（監査・調査）  
前提: WSL2 + tmux + Claude Code CLI + Web UI

---

## A. 共通設計ディレクティブ（Shogun “らしさ” の再現）

### A1. “将軍式” 進行モデルの再現

**狙い**：非ブロッキング・分業・統合判断の流れを、UI＋tmuxに最適化しつつ維持する。

- **統合役（Orchestrator / AI統合）**は「決定と差戻し」だけを行い、細作業（調査/実装/テスト/監査）は委譲する  
- **各ロールは“短いループ”で成果物を返す**（長時間走らせない）
  - Researcher: 5〜15分相当の調査単位（コード探索/依存解析）
  - Implementer: 小さな差分（1〜3ファイル、または限定範囲）を優先
  - Tester: 再現テスト→回帰テスト→追加テストの順
  - Auditor: チェックリスト評価→PASS/FAIL→最小差戻し指示
- **“次の一手”が常に明確**になるよう、各タスクの出力に “Next Action” を必須化する  
- **タスクの大規模化禁止**：一回のKobito実行で大量修正が起きる場合は、統合役が分割する（Shogunの足軽分割の踏襲）

### A2. “副作用最小” の原則（Shogunの安全運用）

- 自動コミットは最終段階のみ（またはユーザー明示時のみ）
- 変更は段階的に積み上げる：
  - spec確定 → impl最小変更 → test拡張 → refactor（必要時）
- 監査ロールは「スコープ逸脱」「不要変更」を最優先で止める

### A3. “外部依存を最小にして価値を出す” 戦略

- MCP・視覚モデル等の外部統合はP2に回し、P0/P1はローカルで成立させる
- ただし、**差し替え可能性（Provider Interface）**は必ず確保する

---

## B. イベント駆動（Event-driven）をShogunに寄せる追加指示

### B1. “no polling” を厳格化する

- 禁止：RUNNINGタスクを一定間隔で覗きに行く設計（done有無、tmux captureの巡回）
- 許可：**イベントトリガ**でのみ状態遷移する
  - fs.watch による `.done` / `.error`
  - tmuxの出力末尾に **完了シグナル文字列**を書き込み、その出現を単発captureで検知（※巡回ではなく、実行終了後の1回のみ）

### B2. イベントの冪等性（Shogun運用での事故防止）

- 同一イベントが複数回発火しても安全にする（重複done等）
  - Event handler は `jobId+taskId+eventType` の処理済みフラグを持つ
  - 既にDONEのtaskは再遷移させない

### B3. “起こす/寝かせる” 制御の導入（Shogun風）

- Shogunのtmux send-keysで“起こす”思想を再現するため、
  - Orchestratorは「次に走らせるtask」をイベントで決めるだけ
  - 実際の起動は Runner が「起動イベント」を受けて動く（Push型）
- UI操作（ユーザークリック）もイベントとして同列に扱う：
  - `user.request.rerun_task`
  - `user.request.apply_memory_update`
  - `user.request.approve_skill`

### B4. “Observability” をイベントで作る

- ログはタスク単位でイベント時に追加する（START/DONE/ERROR）
- UIはイベントストリームに追随する（WebSocket / SSE 推奨）
  - Pollingで更新しない（Shogunの哲学に合わせる）

---

## C. Memory MCP をShogunに寄せる追加指示

### C1. Memoryを “規約（拘束力）” と “メモ（参考）” に分離

Shogunの運用は「覚えたことが強い」。無秩序に記憶を増やすと破綻するため、格納先を分ける。

- **Hard Memory（拘束力あり）**
  - `decisions.md`：意思決定・方針（例：アーキ方針、採用ライブラリ、禁止事項）
  - `conventions.md`：コーディング規約/運用ルール
- **Soft Memory（参考）**
  - `known_issues.md`：既知不具合/回避策（古くなる）
  - `notes.md`：一時メモ（自動でexpire）

### C2. Memory更新は “提案→根拠→監査→承認→反映” の5段階

- Implementer/Tester/Researcher は **MemoryUpdate提案のみ**
- **Auditor が妥当性・再利用性・陳腐化リスクを評価**
- Orchestrator が承認（またはユーザー承認）
- 反映後に `memory.updated` を emit、次フェーズへ必ず注入

### C3. Memory注入は “最小・高密度” を守る（プロンプト肥大防止）

- 注入優先度：
  1) decisions（最新/関連）
  2) conventions（関連）
  3) known_issues（関連）
- 抽出ルール：
  - jobGoal/phase/キーワードでセクション単位に引く
  - “直近更新” をブースト
- 注入形式：
  - “引用ブロック＋ID付き” にして、後で参照しやすくする
  - 例：`[DEC-2026-01-30-01] ...`

### C4. MCP差し替えに備えた “Memory Contract” 固定

- Providerが変わっても、プロンプトに渡す形式（章立て、ID形式、更新スキーマ）は変えない
- 将来MCPで検索できるよう、MemoryUpdateには必ず `keywords[]` を持たせる（MVPでも保存）

---

## D. スクリーンショット（UIアップロード→解析→反映）をShogunに寄せる追加指示

### D1. Shogunの「最新スクショを見て」に相当する操作をUIで実現

- UIに **「最新N枚をContextへ反映」トグル**を用意
- “最新”の定義を固定：
  - `uploadedAt` 降順
  - N=3（デフォルト）を推奨、ジョブごとに変更可

### D2. 解析パイプラインを “再現性” 重視で設計

- OCR結果は必ず保存（後から再評価できる）
- 解析結果（Findings）はテンプレ化して **比較可能** にする：
  - `Screen ID`
  - `Observed`
  - `Expected`
  - `Error Text (raw)`
  - `Hypothesis`
  - `Suggested Next Checks`
- “視覚要約” はMVPでは「文章の定型化」に限定（モデル依存を増やさない）

### D3. “差分レビュー” を最初から用意（Shogun運用の強み）

- 同一ジョブで複数スクショが上がったら：
  - OCRの差分（diff）を生成してContextに追記
  - 例：「エラーメッセージが変化」「ボタン文言が変化」
- UI上で「2枚比較（Before/After）」をP1で実装（ROI高）

### D4. 解析の再実行・タグ付け（運用必須）

- OCR誤り、画面が暗い、解像度不足等の例外に備え：
  - `re-run analysis` ボタン
  - `tags: login, checkout, settings` 等
  - `severity` ラベル（user入力 or Auditor付与）

### D5. “spec/impl/test 反映” の厳格ルール

- specフェーズ：スクショ所見は **要件・再現手順・成功条件** に変換すること
- implフェーズ：スクショ所見は **修正箇所の候補と根拠** に変換すること（ログと併用）
- testフェーズ：スクショ所見は **回帰テストの観測点** に変換すること（UIテスト/スナップショット等）

---

## E. ContextテンプレをShogunに寄せる追加指示

### E1. “Contextは設計書であり契約” という扱いにする

- Contextテンプレは単なる説明ではなく、**タスクの契約**：
  - 成功条件、制約、入力、出力、検証手順が必須
- 各ロールは Context の該当セクションに従う義務がある（逸脱時はAuditorがFAIL）

### E2. Context更新は “差分追記” を原則（履歴が残る）

- 追記時は必ず「追記理由」と「イベントID」を残す
  - `Update: asset.analyzed#A-0003`
- 上書きは禁止（履歴が消えるとShogunの再現性が落ちる）

### E3. Context分割（Shogunのテンプレ運用に寄せる）

- `context.md` は合成ファイル
- 実体は sections として管理し、合成時に並べる：
  - `context/00_goal.md`
  - `context/10_repo.md`
  - `context/20_memory.md`
  - `context/30_screenshots.md`
  - `context/40_skills.md`
  - `context/90_open_questions.md`
- こうすると、イベントでセクション単位更新ができ、差分が追いやすい

### E4. Context→Prompt注入の固定順序

Shogunは“読み順”が重要。注入順序を固定して運用を安定させる。

1) Goal / Success Criteria
2) Constraints / Environment
3) Repo Snapshot / Commands
4) Memory Context（Hard→Soft）
5) Screenshots Findings（最新N枚＋差分）
6) Skills Applied（手順契約）
7) Open Questions / Risks

---

## F. Skills体系をShogunに寄せる追加指示

### F1. Skillsは “再現可能な作業手順の部品化”

- スキルは “プロンプトの美文” ではなく、**実行可能な手順**であること
- 1スキル = 1目的（過度に巨大化させない）
- “Output Contract” を必須にし、Auditorが満たしているか評価する

### F2. Skill-creator 導線を再現（Shogun準拠）

- タスク終了時、エージェントは次を必ず出力：
  - `SkillCandidate`（新規 or 改善提案）
  - `WhenToUse` / `Steps` / `Contract` / `Pitfalls`
- Auditorが採否を判定し、承認されたものだけ `skills/` に反映
- 反映時、skillに **バージョン** と **作成日** を付与（陳腐化管理）

### F3. Skillsの選択は “明示的” を優先

- 自動選択に加え、UIで「適用Skills」をユーザーが指定可能にする（Shogun運用に近い）
- 自動選択の説明責任：
  - 「なぜこのスキルを適用したか」をContextに記録

### F4. Skillsの寿命管理（重要）

- skillに `valid_until`（任意）や `review_due` を持たせる
- “古いスキルで事故る” のを防ぐため、Auditorが定期的に更新候補を提示できる仕組みを用意（P2）

---

## G. サブロール（Researcher/Auditor）をShogunに寄せる追加指示

### G1. Researcher（調査専任）の行動規範

- 目的は「実装を始める前に不確実性を潰す」
- やること（順序固定）：
  1) 入口特定（どこから起動しているか）
  2) 依存関係の地図化（主要モジュール）
  3) 変更候補の比較（2案以上）
  4) 推奨案（リスク/工数/保守）
- 出力は “実装指示として使える具体性” を持つ（ファイル名/関数名/責務）

### G2. Auditor（監査/品質専任）のゲートチェックリスト（必須）

- **Spec Gate**
  - 成功条件は検証可能か（テスト/観測点があるか）
  - スコープが固定されているか
  - スクショ所見が要件に落ちているか
  - Memory/Skillsと矛盾しないか
- **Impl Gate**
  - 不要変更が混じっていないか
  - 最小差分か（スコープ逸脱がない）
  - セキュリティ/設定/秘密情報の混入がない
  - 既存規約に沿うか
- **Test Gate**
  - 再現テストがあるか（不具合なら必須）
  - 回帰テストがあるか
  - CIで回るか、コストは妥当か
  - スクショ観測点がテストに反映されているか

### G3. 差戻し（FAIL）時のルール（Shogun運用の肝）

- FAILは“修正チケット”として具体に落とす（曖昧禁止）
- 差戻しは最小単位で行う（Implementerに1タスクで直せる粒度）
- FAIL連鎖を避けるため、Auditorは原因を分類して提示：
  - Spec不足 / 実装不足 / テスト不足 / スコープ逸脱 / 規約違反

---

## H. UI/UX をShogunに寄せる追加指示（最小変更で効く）

### H1. “One-click” 操作の追加（運用速度）

- `Upload Screenshot`（即Context反映）
- `Apply Suggested Memory Updates`（承認して反映）
- `Approve Skill Candidate`（承認してskillsへ反映）
- `Rerun Task`（spec/impl/testの特定タスク再実行）

### H2. “状態が見える” を強化

- Job Timeline をイベントで表示（START/DONE/ERROR/ASSET_ANALYZED/MEMORY_UPDATED）
- 各タスクの最終出力（要約）を一覧で俯瞰できるようにする（Shogunの俯瞰性）

---

## I. 実装時の具体的ガードレール（失敗しやすい点）

### I1. プロンプト肥大化の防止策（必須）

- Context/Memory/Skills/Screenshots を全部突っ込むと破綻する  
- 必ず上限と優先順位でトリムする：
  - Memory: 1500 tokens
  - Screenshots: 最新N枚＋差分、OCR rawは必要なら短縮
  - Skills: 適用中のものだけ、Stepsは番号付きで短く

### I2. OCRノイズ対策

- OCR raw と “重要行抽出” を分ける
- 重要行抽出の優先語：
  - `error|exception|failed|timeout|permission|denied|stack|trace|assert`
- 重要行が無い場合は raw の先頭/末尾を切り出す

### I3. Eventの取りこぼし対策

- watcher登録前にdoneができる競合を潰す
- 起動時に再スキャン（ワンショット）を必ず行う

### I4. Skills/Mem の陳腐化対策（MVPでも入れる）

- 更新に `confidence` と `review_due` を持たせる
- Auditorが “古い/怪しい” を指摘できるようにする

---

## J. 具体的な “Shogun準拠度” の評価指標（導入後に計測）

- Polling回数（0に近いこと）
- ジョブ跨ぎでMemory参照が行われた割合
- スクショがspec要件/テストに反映された割合
- Auditor FAIL率（高すぎ＝spec不足、低すぎ＝監査弱い）
- 変更diffの平均サイズ（小さく保つ）

---

## K. 追加で用意すべき初期Skills（Shogun的に効くセット）

MVPで最低以下を用意（Shogunの“型”を先に作る）。

1) `ui-bug-triage`（スクショ→再現→仮説→最小修正）
2) `event-driven-refactor`（polling撤廃、fs.watch冪等性）
3) `memory-update-governance`（提案→監査→承認）
4) `test-regression-minimal`（最小回帰テスト追加）
5) `repo-entrypoint-mapping`（Researcher向け：入口/責務地図）

---

## L. “完了判定（Definition of Done）” の追加（Shogunに寄せる）

- オーケストレーションはイベントストリームのみで進む（UIもSSE/WebSocketで更新）
- 新しいMemory/Skillが “承認→反映→次ジョブに効く” ことがデモできる
- スクショ2枚で差分がContextに入り、テスト観測点が増えることが確認できる
- AuditorがSpec/Impl/Test各ゲートでPASS/FAILを運用し、FAILが具体チケットに落ちる

---
