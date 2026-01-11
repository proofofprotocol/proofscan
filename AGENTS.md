# AGENTS.md

AI coding agents向けのproofscanリポジトリ作業ガイド。

## プロジェクト概要

**proofscan** はMCP (Model Context Protocol) サーバースキャナー。JSON-RPC通信をキャプチャして、MCPサーバーの挙動を可視化するTypeScript CLIツール。

- **言語**: TypeScript (ESM)
- **CLI**: Commander.js
- **DB**: better-sqlite3
- **テスト**: Vitest

## ビルド・テスト

```bash
npm run build          # TypeScriptコンパイル
npm test               # 全テスト実行 (vitest)
npm test -- src/db/    # 特定ディレクトリのテスト
npm run dev            # watchモード
npm run lint           # ESLintチェック
```

**重要**: PR作成前に必ず `npm test` と `npm run build` を実行すること。

## アーキテクチャ

### 3つの実行モード

1. **CLIモード** - 単発コマンド (`pfscan view`, `pfscan tree`)
2. **Shellモード** - インタラクティブREPL (`pfscan shell`)
3. **Proxyモード** - 複数MCPサーバーを集約 (`pfscan proxy start`)

### コア構成

```
src/
├── cli.ts                 # エントリポイント (Commander.js)
├── commands/              # コマンド実装
│   ├── catalog.ts         # MCPレジストリ検索 (最大ファイル)
│   ├── proxy.ts           # Proxyサーバー
│   └── shell.ts           # インタラクティブシェル
├── db/                    # SQLiteデータベース層 (better-sqlite3)
│   ├── events-store.ts    # セッション・イベント・RPC (prunable)
│   └── proofs-store.ts    # 不変の証明レコード (never pruned)
├── shell/                 # シェル実装
│   ├── repl.ts            # REPLループ
│   └── completer.ts       # TAB補完
├── proxy/                 # MCPプロキシサーバー
│   └── tool-aggregator.ts # 名前空間ツール集約
├── i18n/                  # 国際化 (EN/JA)
│   └── locales/           # en.ts が source of truth
└── *.test.ts              # テストファイル（同じディレクトリに配置）
```

### データベース設計

設定ディレクトリに2つのSQLiteデータベース：
- **events.db** - セッション、イベント、RPCコール（`archive`で削除可能）
- **proofs.db** - 不変のPOPLレコード（削除不可）

## i18n (国際化)

### 目的
翻訳ではなく、**文字列管理の統一**が目的。

### 使い方

```typescript
import { t, getCategoryLabel } from '../i18n/index.js';

console.log(t('analyze.title'));
console.log(t('common.times', { count: 5 }));  // パラメータ補間
console.log(getCategoryLabel('read'));
```

### キー命名規約

```
common.*     共通ラベル（yes, no, none, error, hint）
category.*   操作カテゴリ（read, write, network, exec, other）
analyze.*    analyze コマンド出力
errors.*     ユーザー向けエラー
hints.*      ヒント/ガイダンス
[command].*  各コマンド出力（view, scan, tree, rpc, etc.）
```

### i18n対象/非対象

| 対象 | 非対象 |
|------|--------|
| コマンド出力ラベル | `.description()` ヘルプテキスト |
| カテゴリラベル | CLI usage examples |
| エラーメッセージ | ログメッセージ（デバッグ用） |

### snake_case → camelCase 変換

DBやJSONのキーがsnake_caseの場合、i18nキーはcamelCaseに変換：
```typescript
const camelKey = type.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
return t(`record.type.${camelKey}`);
```

## CI/CD (GitHub Actions)

- **release.yml**: `v*` タグプッシュで npm に自動パブリッシュ (OIDC認証)
- **claude-code-review.yml**: PR作成時にClaudeによる自動レビュー
- **claude.yml**: `@claude` メンションでIssue/PR対応

## コミット・PR

### コミットメッセージ形式
```
<type>: <description>

Co-Authored-By: Claude <noreply@anthropic.com>
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

### バージョンリリース
```bash
npm version patch  # または minor, major
git push && git push --tags
```

## 主要パターン

### ツール名前空間 (Proxyモード)

複数MCPサーバー集約時、ツールはコネクタIDでプレフィックス：
- `time` の `get_current_time` → `time__get_current_time`

### シェルコンテキストナビゲーション

- `cd time` - コネクタに移動
- `cd abc123` - セッションに移動
- `@this`, `@last` - 現在/最後のコンテキスト参照
- `ref add name @this` - 名前付き参照を保存

## ドキュメント

- [README.md](README.md) - プロジェクト概要
- [docs/i18n.md](docs/i18n.md) - i18n詳細ドキュメント
- [docs/GUIDE.md](docs/GUIDE.md) - CLIコマンドリファレンス
- [docs/SHELL.md](docs/SHELL.md) - Shellモードガイド
- [docs/PROXY.md](docs/PROXY.md) - Proxyモードガイド
