# Multi-Agent-Coding

複数の Claude Code エージェントを協調させ, ソフトウェア開発タスクをオーケストレーションするシステム。

Web UI からプロンプトを投入すると, **UIちゃん**(受付) → **AIちゃん**(分解/統合) → **Kobito**(実作業ワーカー群) の3役がバックグラウンドで連携し, **仕様書作成 → 実装 → テスト** の3フェーズパイプラインを自動実行する。

## 主な特徴

- **Web UI** でジョブ投入, リアルタイムダッシュボード, フェーズ承認
- **3フェーズワークフロー** (spec → impl → test) と品質ゲート
- **キャラクター駆動のマルチエージェント** (ペルソナ設定で口調/判断基準を差し替え可能)
- **Git 統合** (main ← develop ← job ブランチ戦略, 承認後マージ, 監査トレース)
- **同時ジョブ管理** (リソース自動推定による max\_jobs 制御, キューイング)
- **tmux ベースの並列実行** (Claude Code CLI を多重起動)
- **ワンコマンド起動** (`./start.sh`)

## アーキテクチャ概要

```text
┌─────────────┐    HTTP/SSE    ┌──────────────────────┐    tmux send-keys    ┌─────────────────┐
│  Web UI     │ ◄────────────► │  API Server          │ ──────────────────► │  Claude Code    │
│  (React)    │                │  (Fastify)           │                     │  × N (Kobito)   │
│             │                │                      │                     │                 │
│  - 入力     │                │  Orchestrator Core   │                     │  tmux session   │
│  - ダッシュ │                │  - Scheduler         │                     │  per job        │
│  - 承認     │                │  - Planner (AIちゃん)│                     │                 │
└─────────────┘                │  - Aggregator        │                     └─────────────────┘
                               │  - QualityGate       │
                               │  - RetryManager      │
                               │                      │
                               │  State Store (YAML)  │
                               │  Git Operations      │
                               └──────────────────────┘
```

## 技術スタック

| レイヤー | 技術 |
| --- | --- |
| Runtime | Node.js >= 20, TypeScript 5.7, ES Modules |
| Backend | Fastify 5, pino, neverthrow, js-yaml, nanoid |
| Frontend | React 19, Vite 6, TanStack Query 5, TailwindCSS 3, React Router 7 |
| Shared | Zod (スキーマ検証), ドメイン型定義 |
| Infra | tmux (エージェント実行), Git (ブランチ/マージ), proper-lockfile (排他制御) |
| Test | Vitest 3 |

## 前提条件

- **Node.js** >= 20.0.0
- **npm** (Node.js に同梱)
- **tmux** (エージェント実行に必須)
- **git**
- **Claude CLI** (タスク実行に必要)

## セットアップ

```bash
# 1. リポジトリをクローン
git clone https://github.com/<your-org>/Multi-Agent-Coding.git
cd Multi-Agent-Coding

# 2. セットアップスクリプトを実行 (依存チェック + ビルド + .env 生成)
./scripts/setup.sh

# 3. 環境変数を編集
cp .env.example .env
# .env を開いて auth 情報などを設定
```

## 起動

### 本番モード

```bash
./start.sh
```

依存チェック → npm install → ビルド → 状態ディレクトリ初期化 → API サーバ起動 をワンコマンドで実行する。
起動後 `http://localhost:3000` でアクセス可能。

### 開発モード

```bash
./scripts/dev.sh
```

バックエンド (tsx watch) + フロントエンド (Vite HMR) を同時起動する。

- Backend: `http://localhost:3000/api`
- Frontend: `http://localhost:5173`

### ヘルスチェック

```bash
./scripts/health-check.sh
```

## プロジェクト構成

```text
.
├── backend/           # Fastify API サーバ + Orchestrator Core
│   └── src/
│       ├── app.ts             # サーバ初期化
│       ├── config/            # YAML 設定読み込み
│       ├── domain/            # ドメインモデル (Job, Task, Report, Trace)
│       ├── orchestrator/      # スケジューラ, プランナー, アグリゲータ, 品質ゲート
│       ├── tmux/              # tmux セッション/ペイン制御, Claude Code 実行
│       ├── store/             # ファイルベース状態ストア
│       ├── git/               # Git 操作 (ブランチ, マージ, ロック)
│       ├── routes/            # API エンドポイント
│       ├── personas/          # ペルソナ読み込み
│       ├── events/            # イベントバス
│       └── auth/              # Basic Auth ミドルウェア
├── frontend/          # React SPA
│   └── src/
│       ├── pages/             # InputPage, JobListPage, JobDetailPage
│       ├── components/        # PhaseCard, StatusBadge, TraceTimeline
│       ├── hooks/             # useJob, useSSE
│       └── api/               # HTTP クライアント, SSE
├── shared/            # 共有型定義 + Zod スキーマ
├── config/            # 設定ファイル
│   ├── default.yaml           # メイン設定
│   └── personas/              # キャラクタープロファイル (YAML)
├── scripts/           # ユーティリティスクリプト
├── docs/              # ドキュメント
│   └── spec.md                # システム仕様書
├── start.sh           # 本番起動スクリプト
├── package.json       # モノレポワークスペース設定
└── tsconfig.base.json # 共通 TypeScript 設定
```

## API エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| `POST` | `/jobs` | ジョブ作成 |
| `GET` | `/jobs` | ジョブ一覧 |
| `GET` | `/jobs/{id}` | ジョブ詳細 |
| `POST` | `/jobs/{id}/cancel` | ジョブキャンセル |
| `GET` | `/jobs/{id}/dashboard` | ダッシュボードデータ |
| `POST` | `/jobs/{id}/phases/{phase}/approve` | フェーズ承認 |
| `POST` | `/jobs/{id}/phases/{phase}/reject` | フェーズ差戻し |
| `GET` | `/api/events` | SSE (リアルタイム更新) |
| `GET` | `/api/health` | ヘルスチェック (認証不要) |

## 設定

メイン設定は `config/default.yaml`, 環境変数は `.env` で上書き可能。

主要な設定項目:

| 項目 | デフォルト | 説明 |
| --- | --- | --- |
| `server.port` | `3000` | API サーバポート |
| `auth.username` / `auth.password` | `admin` / `changeme` | Basic Auth 認証情報 |
| `orchestrator.max_jobs` | `auto` | 同時ジョブ数 (auto: リソース自動推定) |
| `claude.model` | `sonnet` | Claude モデル |
| `claude.max_budget_usd` | `5.0` | ジョブあたりの予算上限 (USD) |
| `claude.timeout_seconds` | `600` | タスクタイムアウト (秒) |
| `git.merge_policy` | `merge_commit` | マージ方式 (FF 無効) |

詳細は [.env.example](.env.example) および [config/default.yaml](config/default.yaml) を参照。

## ジョブ実行フロー

```text
Web入力 → Job作成 → AIちゃん(タスク分解) → Kobito群(並列実行)
    → AIちゃん(結果集約/品質ゲート) → 承認待ち → ユーザ承認
    → Git マージ (job→develop) → 次フェーズ or 完了
```

**状態遷移**:
`RECEIVED → PLANNING → DISPATCHED → RUNNING → AGGREGATING → WAITING_APPROVAL → APPROVED → COMMITTING → COMPLETED`

例外: `QUEUED` (max\_jobs 超過), `WAITING_RETRY` (一時障害), `FAILED` (恒久障害), `CANCELED`

## ペルソナシステム

| 役割 | キャラクター | 担当 |
| --- | --- | --- |
| **UIちゃん** | フレンドリーな受付 | ユーザ対話, 差分要約の表示, 承認サマリ |
| **AIちゃん** | しっかり者のオーケストレータ | タスク分解, ワーカー配布, 結果統合, 品質ゲート |
| **Kobito** | 勤勉なワーカー群 | Claude Code による実作業, 構造化レポート提出 |

ペルソナ定義は `config/personas/` 内の YAML ファイルで管理。

## 開発コマンド

```bash
# 全ワークスペースビルド
npm run build

# 全ワークスペーステスト
npm run test

# 全ワークスペースリント
npm run lint
```

## ロードマップ

- **MVP**: ワンコマンド起動, ファイルベース状態管理, 固定ロール, 承認フロー, 同時実行制御
- **v1**: 品質ゲート強化, 成果物パイプライン可視化, 再起動耐性
- **v2**: ロール設定変更, SQLite/Redis 移行, マルチユーザ/RBAC, スキル自動抽出

## ライセンス

TBD
