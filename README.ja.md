# ProofScan（日本語）

> **Languages:** [English](README.md) | 日本語

MCPサーバースキャナー - JSON-RPC通信を記録し、ブラックボックスを可視化します。

## 概要

proofscanは、MCP（Model Context Protocol）サーバーとの通信を可視化するツールです。

- MCPサーバーへのstdio接続を確立
- すべてのJSON-RPCメッセージ（リクエスト、レスポンス、通知）を記録
- SQLiteに保存し、効率的なクエリと分析が可能
- mcp.so / Claude Desktop形式からの設定インポートに対応
- 直感的なCLIコマンドでデータを確認・探索

## インストール

```bash
npm install -g proofscan
```

またはインストールせずに実行：

```bash
npx proofscan --help
```

## クイックスタート

```bash
# 1. 設定を初期化
pfscan config init

# 2. MCPサーバーをインポート
echo '{"mcpServers":{"time":{"command":"uvx","args":["mcp-server-time"]}}}' \
  | pfscan connectors import --from mcpServers --stdin

# 3. スキャンして確認
pfscan scan start --id time   # スキャン実行
pfscan                        # 最近のイベントを表示
pfscan tree                   # 構造を表示
```

## Phase 3 コンセプト

### 設計思想：すべてを残す → 意味のあるものを残す

Phase 3では、「すべてのJSON-RPCを記録する」から「セキュリティ上意味のあるものを効率的に残す」へと進化します。

### 用語定義

| 日本語 | 英語 | 意味 |
|--------|------|------|
| **できること** | capability | サーバーが提供する機能（tools/list で取得） |
| **やったこと** | tool call | 実際に実行されたツール呼び出し（tools/call） |

### 操作カテゴリ

ツールの操作は以下のカテゴリに分類されます：

- **読み取り** - ファイルやデータの読み込み
- **書き込み** - ファイルやデータの変更
- **ネット接続** - 外部ネットワークへのアクセス
- **コマンド実行** - シェルコマンドの実行
- **その他操作** - 上記以外の操作

### CLIコマンド

#### pfscan summary

サマリー表示。**注意点**（セキュリティ上の懸念）も含めて表示します。

```bash
$ pfscan summary --session abc123

time (1 session)
├── できること: read_file, write_file, execute_command
├── やったこと: read_file (3回), write_file (1回)
└── 注意点: コマンド実行可能、書き込み操作あり
```

#### pfscan permissions

詳細なパーミッション情報を表示します。**注意点は表示しません**（詳細確認用のため）。

```bash
$ pfscan permissions --session abc123

time
├── 読み取り: read_file
├── 書き込み: write_file
├── コマンド実行: execute_command
└── その他操作: (なし)
```

### record dry-run

スキャン候補の記録をプレビューします。

```bash
# デフォルト: tools/call のみ候補化
$ pfscan record dry-run --session abc123

記録候補:
  [1] tools/call: read_file (2025-12-28 12:00:00)
  [2] tools/call: write_file (2025-12-28 12:00:05)

# --include-capabilities: tools/list も候補に追加
$ pfscan record dry-run --session abc123 --include-capabilities

記録候補:
  [0] tools/list (2025-12-28 11:59:55) ← 1回のみ
  [1] tools/call: read_file (2025-12-28 12:00:00)
  [2] tools/call: write_file (2025-12-28 12:00:05)
```

### セキュリティデフォルト

安全を優先した設計：

| 設定 | デフォルト | 説明 |
|------|-----------|------|
| input/output | `digest_only` | 生データではなくハッシュのみ保存 |
| canonicalize | `sha256` | 正規化後にSHA-256ハッシュ化 |

これにより、機密データの漏洩リスクを最小化しながら、操作の証跡を残すことができます。

## 主要コマンド

```
共通コマンド:
  view, v       最近のイベントタイムラインを表示（デフォルト）
  tree, t       connector → session → rpc の構造を表示
  explore, e    インタラクティブなデータブラウザ
  scan, s       新しいスキャンを実行
  status, st    システム状態を表示
  rpc           RPC呼び出しの詳細を表示

管理:
  archive, a    古いデータのアーカイブと削除
  config, c     設定管理
  connectors    コネクタ管理

ショートカット:
  v=view  t=tree  e=explore  s=scan  st=status  a=archive  c=config
```

## 設定ファイルの場所

OSごとの標準的な場所に保存されます：

- **Windows**: `%APPDATA%\proofscan\config.json`
- **macOS**: `~/Library/Application Support/proofscan/config.json`
- **Linux**: `~/.config/proofscan/config.json`

## グローバルオプション

```
-c, --config <path>  設定ファイルのパス
--json               JSON形式で出力
-v, --verbose        詳細出力
```

## ライセンス

MIT
