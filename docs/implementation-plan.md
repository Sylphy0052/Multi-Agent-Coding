# Multi-Agent-Coding 実装計画書

Version: 1.0
Date: 2026-01-30
Base: [docs/feat-spec.md](docs/feat-spec.md) (Shogun準拠強化仕様書)

---

## 0. 現状分析サマリ

### 0.1 実装済みモジュール(コード作成完了, 統合未完了)

| モジュール | ファイル | 状態 |
|---|---|---|
| Event Bus | `backend/src/events/bus.ts`, `types.ts` | 冪等emit, 20イベント型定義済み |
| Task Watcher | `backend/src/watcher/task-watcher.ts` | chokidar `.done/.error` 監視済み |
| Pipeline Manager | `backend/src/orchestrator/pipeline.ts` | researcher/kobito/auditor テンプレ生成済み |
| Memory Provider | `backend/src/memory/provider.ts`, `local-md.ts` | Interface + LocalMd実装済み |
| Asset Store | `backend/src/assets/store.ts` | 保存/取得/メタデータ済み |
| Analysis Pipeline | `backend/src/assets/analyzer/pipeline.ts` | OCR -> findings -> context更新済み |
| OCR Extractor | `backend/src/assets/analyzer/ocr.ts` | Tesseract.js呼び出し済み(依存未追加) |
| Findings Extractor | `backend/src/assets/analyzer/findings-extractor.ts` | エラーパターン検出済み |
| Context Manager | `backend/src/context/context-manager.ts` | テンプレ生成/append更新/recompose済み |
| Skills Registry | `backend/src/skills/registry.ts` | MD解析/YAML frontmatter/phase選択済み |
| Routes (新規) | `backend/src/routes/assets.ts`, `memory.ts`, `skills.ts` | エンドポイント定義済み |
| Persona YAML | `config/personas/researcher.yaml`, `auditor.yaml` | サブロール定義済み |
| Prompt Builder | `backend/src/personas/prompt-builder.ts` | researcher/auditor用ビルダ追加済み |
| Shared Types | `shared/src/types.ts` | MemoryUpdate, Asset, GateResult, SkillCandidate追加済み |
| Validation | `shared/src/validation.ts` | Zodスキーマ追加済み |
| Skill Files | `skills/*.md` | 3スキル定義済み(ui-bug-triage, test-regression-minimal, repo-entrypoint-mapping) |
| Context Template | `templates/context_template.md` | テンプレートファイル作成済み |

### 0.2 未完了の統合ポイント(Gap一覧)

| # | Gap | 影響範囲 | 優先度 |
|---|---|---|---|
| G1 | `app.ts`に新規ルート(assets, memory, skills)が未登録 | APIアクセス不可 | P0 |
| G2 | `index.ts`に新規コンポーネントが未インスタンス化 | 全新機能が未起動 | P0 |
| G3 | `config/schema.ts`にmemory/skills設定セクション未追加 | 設定不可 | P0 |
| G4 | `@fastify/multipart`が`package.json`に未追加 | アセットアップロード不可 | P0 |
| G5 | `tesseract.js`が`package.json`に未追加 | OCR実行不可 | P0 |
| G6 | PipelineManagerがOrchestratorで未接続(Plannerに未渡し) | サブロール未稼働 | P0 |
| G7 | `handlePlanning()`がgenerateDefaultTemplatesを使用(generatePipelineTasksではない) | pipeline未利用 | P0 |
| G8 | prompt-builderにMemory/Context/Skills注入が未統合 | プロンプトに文脈未注入 | P0 |
| G9 | quality-gate.tsにAuditor verdict解析が未統合 | ゲーティング未稼働 | P0 |
| G10 | ContextManagerがジョブ作成時に自動呼び出しされない | context.md未生成 | P0 |
| G11 | `buildApp()`にAppDeps拡張(AssetStore, MemoryProvider等)が未反映 | DI不可 | P0 |
| G12 | multipart pluginのFastify登録が未実装 | ファイルアップロード不可 | P0 |

---

## 1. 実装フェーズと順序

feat-spec.md セクション9の推奨順序に従い, 依存関係を考慮して以下の順序で実装する。

```
Phase 1: 基盤整備(設定/依存/DI)
Phase 2: Event Bus + Pipeline統合
Phase 3: Context Manager統合
Phase 4: Memory統合
Phase 5: Screenshot/Asset統合
Phase 6: Skills統合
Phase 7: Roles/Gate統合
Phase 8: ビルド検証 + 結合テスト
```

---

## 2. タスク詳細

### Phase 1: 基盤整備(設定/依存/DI)

#### Task 1.1: npm依存追加

**目的**: 不足しているnpm依存を追加する

**変更ファイル**:
- `backend/package.json`

**作業内容**:
1. `tesseract.js` を dependencies に追加
2. `@fastify/multipart` を dependencies に追加

**受入条件**:
- `npm install` が成功する
- `import Tesseract from "tesseract.js"` がビルドエラーにならない
- `import multipart from "@fastify/multipart"` がビルドエラーにならない

---

#### Task 1.2: config/schema.ts にmemory/skills設定セクション追加

**目的**: memory, skills, templatesの設定をYAML/env経由で指定可能にする

**変更ファイル**:
- `backend/src/config/schema.ts`

**作業内容**:
```ts
// 追加するスキーマ
export const MemoryConfigSchema = z.object({
  directory: z.string().default("memory"),
});

export const SkillsConfigSchema = z.object({
  directory: z.string().default("skills"),
});

export const TemplatesConfigSchema = z.object({
  context_template: z.string().default("templates/context_template.md"),
});

// AppConfigSchemaに追加
memory: MemoryConfigSchema.default({}),
skills: SkillsConfigSchema.default({}),
templates: TemplatesConfigSchema.default({}),
```

**受入条件**:
- `loadConfig()` が memory, skills, templates 設定を返す
- デフォルト値が仕様通り

---

#### Task 1.3: app.ts の AppDeps拡張 + ルート登録

**目的**: 新規ルートをFastifyアプリに登録し, 必要な依存をDI可能にする

**変更ファイル**:
- `backend/src/app.ts`

**作業内容**:
1. AppDepsに `assetStore`, `memoryProvider`, `skillsRegistry` を追加
2. `@fastify/multipart` プラグインを登録
3. `registerAssetsRoutes`, `registerMemoryRoutes`, `registerSkillsRoutes` を呼び出し
4. 認証スキップパスに新規ルートを必要に応じて追加

**受入条件**:
- `POST /api/jobs/:jobId/assets` がmultipartファイル受付可能
- `GET /api/memory` が応答を返す
- `GET /api/skills` が応答を返す

---

#### Task 1.4: index.ts にコンポーネントインスタンス化とDI接続

**目的**: 新規コンポーネントを起動し, Orchestratorとappに渡す

**変更ファイル**:
- `backend/src/index.ts`

**作業内容**:
1. `AssetStore` インスタンス化 (stateDir)
2. `ContextManager` インスタンス化 (stateDir, templatePath)
3. `LocalMdMemoryProvider` インスタンス化 (memoryDir) + `initialize()`
4. `SkillsRegistry` インスタンス化 (skillsDir) + `loadAll()`
5. `AnalysisPipeline` インスタンス化 + `registerListeners()`
6. `PipelineManager` インスタンス化 (personas)
7. 上記をbuildApp()とOrchestrator constructorに渡す
8. shutdown時に適切にcleanup

**受入条件**:
- アプリケーション起動時にログで各コンポーネントの初期化が確認できる
- 起動エラーが発生しない

---

### Phase 2: Event Bus + Pipeline統合

#### Task 2.1: OrchestratorにPipelineManager接続

**目的**: PipelineManagerをPlanner経由で利用可能にし, サブロールタスク生成を有効化する

**変更ファイル**:
- `backend/src/orchestrator/orchestrator.ts`

**作業内容**:
1. OrchestratorConfig に `contextManager`, `memoryProvider`, `skillsRegistry` を追加(Optional)
2. constructor で `PipelineManager` を生成し `Planner` に渡す
3. `ContextManager`, `MemoryProvider`, `SkillsRegistry` を保持

**受入条件**:
- Planner.pipelineManager が non-null
- `generatePipelineTasks()` が researcher/auditor タスクを含むテンプレを返す

---

#### Task 2.2: handlePlanning()でPipelineタスク生成に切り替え

**目的**: spec/impl/testフェーズ開始時にresearcher/auditorを含むタスクを生成する

**変更ファイル**:
- `backend/src/orchestrator/orchestrator.ts`

**作業内容**:
1. `handlePlanning()` 内の `generateDefaultTemplates()` を `generatePipelineTasks()` に置き換え
2. PipelineManagerが無い場合はフォールバック(既存挙動維持)

**受入条件**:
- spec フェーズで researcher タスクが先頭に生成される
- 各フェーズで auditor タスクが末尾に生成される
- PipelineManager が無い場合は既存の挙動が維持される

---

#### Task 2.3: Planner.createTasks()でrole/assigneeを保持

**目的**: PipelineTaskTemplateのrole/assigneeをTask entityに反映する

**変更ファイル**:
- `backend/src/orchestrator/planner.ts`

**作業内容**:
1. `generatePipelineTasks()` でrole情報をconstraintsまたはTask.assigneeに埋め込む
2. createTasks() でassignee を PipelineTaskTemplate.assignee から取得するオーバーロードを追加

**受入条件**:
- 生成されたTaskのassigneeが `researcher`, `kobito-N`, `auditor` のいずれかに設定される

---

### Phase 3: Context Manager統合

#### Task 3.1: Job作成時にContextManager.generateInitialContext()を呼び出す

**目的**: ジョブ作成時に context.md を自動生成する

**変更ファイル**:
- `backend/src/orchestrator/orchestrator.ts` (handleReceived)
- もしくは `backend/src/routes/jobs.ts` (job作成エンドポイント)

**作業内容**:
1. `job:created` イベントハンドラ内で `contextManager.generateInitialContext(job)` を呼び出す
2. エラー時はログ出力のみ(context生成失敗はジョブを止めない)

**受入条件**:
- ジョブ作成後に `state_dir/jobs/{jobId}/context.md` が存在する
- テンプレートの変数が展開されている

---

#### Task 3.2: prompt-builderにContext注入

**目的**: 各ロールのプロンプトにcontext.mdを注入する

**変更ファイル**:
- `backend/src/personas/prompt-builder.ts`
- `backend/src/orchestrator/task-runner.ts` (context取得してprompt-builderに渡す)

**作業内容**:
1. `buildKobitoTaskPrompt()` に `contextMd` パラメータを追加(optional, 後方互換)
2. Context注入セクションを各prompt builder関数に追加
3. TaskRunnerがタスク実行前にContextManagerからcontext取得してpromptに含める

**受入条件**:
- 実行されるプロンプトにJob Contextセクションが含まれる
- context.mdが存在しない場合でもエラーにならない

---

### Phase 4: Memory統合

#### Task 4.1: prompt-builderにMemory注入

**目的**: 各フェーズのプロンプトにMemory(decisions, conventions, known_issues)を注入する

**変更ファイル**:
- `backend/src/personas/prompt-builder.ts`
- `backend/src/orchestrator/task-runner.ts`

**作業内容**:
1. TaskRunnerでタスク実行前に `memoryProvider.getContext()` を呼び出す
2. 取得したmemory contextをprompt-builderに渡す
3. buildKobitoTaskPrompt, buildResearcherPrompt, buildAuditorPromptにmemory sectionを追加

**受入条件**:
- Memory entriesが存在する場合, プロンプトに `## Memory Context` セクションが含まれる
- Memory が空の場合は "(no memory entries)" と表示される
- 注入量が MAX_CONTEXT_CHARS (6000文字) 以内に制限される

---

#### Task 4.2: memory.updatedイベントでContext更新

**目的**: Memory承認時にJob Contextのmemoryセクションを更新する

**変更ファイル**:
- `backend/src/orchestrator/orchestrator.ts` (イベントハンドラ追加)
- もしくは独立したイベントリスナ

**作業内容**:
1. `memory:updated` イベントをsubscribe
2. 該当jobIdのContext managerで memory セクションを更新

**受入条件**:
- Memory承認後にcontext.mdのMemoryセクションに追記される
- 追記にはeventIdと日時が記録される

---

### Phase 5: Screenshot/Asset統合

#### Task 5.1: multipartプラグイン登録確認

**目的**: Task 1.3で登録した@fastify/multipartが正しく動作することを確認

**変更ファイル**:
- (Task 1.3で実施済み。確認のみ)

**受入条件**:
- `request.file()` が利用可能
- multipart/form-dataでPNG/JPEGをアップロード可能

---

#### Task 5.2: OCR依存のランタイム確認

**目的**: tesseract.jsが正しくOCR実行できることを確認

**変更ファイル**:
- (依存追加はTask 1.1で実施済み)

**作業内容**:
1. tesseract.jsのimportが正しく解決されるか確認
2. 日本語/英語混在画像のOCRが動作するか確認(言語データ)

**受入条件**:
- `extractText(imagePath)` が文字列を返す
- tesseract.jsのworkerが正常に起動・終了する

---

#### Task 5.3: asset.analyzedイベント後のContext更新確認

**目的**: AnalysisPipelineが自動でcontext更新することの動作確認

**変更ファイル**:
- (既に`backend/src/assets/analyzer/pipeline.ts`で実装済み)

**受入条件**:
- 画像アップロード -> `asset:uploaded` -> OCR解析 -> `asset:analyzed` の流れが動作
- context.mdの `screenshots` セクションにOCR結果/findingsが追記される

---

### Phase 6: Skills統合

#### Task 6.1: prompt-builderにSkills注入

**目的**: フェーズ/条件に応じて選択されたSkillsをプロンプトに注入する

**変更ファイル**:
- `backend/src/personas/prompt-builder.ts`
- `backend/src/orchestrator/task-runner.ts`

**作業内容**:
1. TaskRunnerでタスク実行前に `skillsRegistry.select()` を呼び出す
2. 選択されたスキルのSteps/Output Contractをプロンプトに注入
3. 選択理由をContextに記録

**受入条件**:
- screenshotありの場合に `ui-bug-triage` スキルが注入される
- testフェーズで `test-regression-minimal` が注入される
- Skills注入後のプロンプトにSteps/Output Contractが含まれる

---

#### Task 6.2: skill.updatedイベントでContext更新

**目的**: スキル承認時にContextのskillsセクションを更新する

**変更ファイル**:
- イベントリスナの追加(OrchestratorまたはAnalysisPipeline相当)

**作業内容**:
1. `skill:updated` イベントをsubscribe
2. ContextManagerで skills セクションを更新

**受入条件**:
- スキル更新時にcontext.mdが更新される

---

### Phase 7: Roles/Gate統合

#### Task 7.1: quality-gate.tsにAuditor verdict解析を統合

**目的**: Auditorタスクの出力からPASS/FAILを解析し, ゲート判定に使用する

**変更ファイル**:
- `backend/src/orchestrator/quality-gate.ts`

**作業内容**:
1. Auditorタスクのレポートから `gate_verdict` フィールドを取得
2. verdictが "FAIL" の場合, `fix_instructions` を差戻しタスクに変換
3. 既存のQualityGate.check()をAuditor verdict対応に拡張

**受入条件**:
- Auditorが "PASS" を出した場合, quality gateがpassedを返す
- Auditorが "FAIL" を出した場合, quality gateがfailedを返し, issuesにFAIL理由が含まれる
- Auditorタスクが存在しない場合は既存ロジックにフォールバック

---

#### Task 7.2: FAIL時の差戻しタスク自動生成

**目的**: Auditor FAILの場合に修正タスクを自動生成する

**変更ファイル**:
- `backend/src/orchestrator/orchestrator.ts` (handleAggregating拡張)

**作業内容**:
1. quality gate FAIL時にAuditorの`fix_instructions`から修正タスクを生成
2. 最大差戻し回数を制限(2回)
3. 差戻し理由をTraceに記録

**受入条件**:
- FAIL時に具体的なfix instructionsを持つ修正タスクが生成される
- 差戻し回数が2回を超えた場合はジョブがFAILEDに遷移する
- TraceにGATE_FAILイベントが記録される

---

### Phase 8: ビルド検証 + 結合テスト

#### Task 8.1: TypeScriptビルド通過

**目的**: 全変更がビルドエラーなしでコンパイルされることを確認

**作業内容**:
1. `npm run build` を実行
2. 型エラーを修正

**受入条件**:
- `tsc` がエラー0で完了

---

#### Task 8.2: 既存テスト通過確認

**目的**: 既存のvitest テストが壊れていないことを確認

**作業内容**:
1. `npm test` を実行
2. 失敗テストを修正

**受入条件**:
- 全テストがPASS

---

#### Task 8.3: 結合動作確認

**目的**: エンドツーエンドの動作フローを確認

**確認項目**:
1. ジョブ作成 -> context.md生成
2. specフェーズ -> researcherタスク -> kobitoタスク -> auditorタスク(PASS/FAIL)
3. 画像アップロード -> OCR -> findings -> context更新
4. Memory propose -> approve -> context更新 -> 次ジョブで注入確認
5. Skills選択 -> プロンプト注入確認

---

## 3. 依存関係グラフ

```
Phase 1 (基盤)
  ├── Task 1.1 (npm deps)
  ├── Task 1.2 (config schema)
  ├── Task 1.3 (app.ts routes) ── depends on ── Task 1.1
  └── Task 1.4 (index.ts DI)  ── depends on ── Task 1.2, 1.3

Phase 2 (Pipeline) ── depends on ── Phase 1
  ├── Task 2.1 (Orchestrator + PipelineManager)
  ├── Task 2.2 (handlePlanning) ── depends on ── Task 2.1
  └── Task 2.3 (Planner role) ── depends on ── Task 2.2

Phase 3 (Context) ── depends on ── Phase 1
  ├── Task 3.1 (Job -> context.md)
  └── Task 3.2 (prompt + context) ── depends on ── Task 3.1

Phase 4 (Memory) ── depends on ── Phase 1, Phase 3
  ├── Task 4.1 (prompt + memory)
  └── Task 4.2 (memory event -> context)

Phase 5 (Screenshot) ── depends on ── Phase 1, Phase 3
  ├── Task 5.1 (multipart確認)
  ├── Task 5.2 (OCR確認) ── depends on ── Task 5.1
  └── Task 5.3 (asset.analyzed -> context) ── depends on ── Task 5.2

Phase 6 (Skills) ── depends on ── Phase 1, Phase 3
  ├── Task 6.1 (prompt + skills)
  └── Task 6.2 (skill event -> context)

Phase 7 (Gate) ── depends on ── Phase 2
  ├── Task 7.1 (quality-gate + auditor verdict)
  └── Task 7.2 (FAIL -> auto rework) ── depends on ── Task 7.1

Phase 8 (検証) ── depends on ── All above
  ├── Task 8.1 (build)
  ├── Task 8.2 (tests) ── depends on ── Task 8.1
  └── Task 8.3 (E2E) ── depends on ── Task 8.2
```

**並列実行可能な組合せ**:
- Phase 3, 4, 5, 6 は Phase 1 完了後に並列着手可能
- Phase 2 と Phase 3 は独立しており並列可能
- Phase 7 は Phase 2 完了が必須

---

## 4. リスクと対策

| リスク | 対策 |
|---|---|
| tesseract.jsのWSL2でのネイティブモジュール問題 | wasm版を使用(tesseract.js v5はpure JS/WASM) |
| OCR精度が低い(日本語混在) | `eng+jpn` 言語データを指定。MVP段階では英語のみでも可 |
| multipart uploadのファイルサイズ制限 | @fastify/multipart の limits設定 (10MB上限推奨) |
| プロンプト肥大化 | Context: 16000字, Memory: 6000字, Skills: 適用中のみ。各上限を厳守 |
| PipelineManagerの不在時のフォールバック | generatePipelineTasks() が pipelineManager null 時にデフォルトテンプレに委譲済み |
| Auditor出力のPASS/FAIL解析失敗 | 正規表現 + フォールバック(verdictが無い場合は既存ゲートロジック) |
| 差戻しループ | 最大差戻し回数を2回に制限。超過時はFAILED遷移 |

---

## 5. 実装順序の推奨(着手順)

1. **Task 1.1** -> **Task 1.2** -> **Task 1.3** -> **Task 1.4** (直列, 基盤は順序依存)
2. **Task 2.1** + **Task 3.1** (並列, 独立)
3. **Task 2.2** -> **Task 2.3** (直列)
4. **Task 3.2** (Context注入)
5. **Task 4.1** + **Task 5.1** + **Task 6.1** (並列, 各注入系は独立)
6. **Task 4.2** + **Task 5.2** + **Task 6.2** (並列, イベント系は独立)
7. **Task 5.3** (Screenshot E2E)
8. **Task 7.1** -> **Task 7.2** (直列, Gate系)
9. **Task 8.1** -> **Task 8.2** -> **Task 8.3** (直列, 検証)

---

## 6. 受入基準チェックリスト(feat-spec.md セクション4.3準拠)

### イベント駆動
- [ ] RUNNINGタスクの巡回チェックが無い(コード上で確認)
- [ ] `.done` 生成で即座に次タスクへ遷移する
- [ ] watch取りこぼし対策がある(起動時存在確認)

### Memory
- [ ] 1回目ジョブで作られたdecision/conventionが, 2回目ジョブのspecプロンプトに注入される
- [ ] Memory更新は "提案 -> 承認 -> 反映" の形で追跡できる

### Screenshot
- [ ] Web UIからpng/jpgをアップロードできる
- [ ] OCR結果がJob詳細に表示される
- [ ] OCR結果がspec/impl/testのプロンプトに注入される

### Contextテンプレ
- [ ] `context.md` が生成され, スクショ解析/メモリ更新イベントで追記される
- [ ] 生成されたcontextがプロンプトに含まれる

### Skills
- [ ] 少なくとも2つのスキルが定義され, 条件に応じて注入される
- [ ] スキルのOutput Contractがレポートに反映される

### Roles / Gate
- [ ] spec/impl/testの各フェーズ終端にAuditorのPASS/FAILが存在
- [ ] FAILの場合は差戻しタスクが自動で発行される
