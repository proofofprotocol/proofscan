# proofscan

> **言語:** [English](README.md) | 日本語

MCP サーバースキャナー - JSON-RPC 通信を可視化してブラックボックスを排除

**バージョン:** 0.10.3

## 概要

proofscan は MCP (Model Context Protocol) サーバー通信の完全な可視性を提供します:

- 🔍 **キャプチャ** 全ての JSON-RPC メッセージ（リクエスト、レスポンス、通知）
- 💾 **保存** SQLite による効率的なクエリと分析
- 🌳 **可視化** コネクタ → セッション → RPC の階層構造
- 🔧 **テスト** CLI から直接 MCP ツールを実行
- 🎭 **プロキシ** 複数の MCP サーバーを統合した名前空間で提供
- 📊 **生成** 公開可能な監査証跡（POPL）
- 🐚 **対話型** TAB 補完付きシェルモード

## クイックリンク

- 📖 **[ユーザーガイド](docs/GUIDE.ja.md)** - 完全な CLI リファレンスと例
- 🐚 **[シェルモードガイド](docs/SHELL.ja.md)** - 対話型シェルと @参照
- 🎭 **[プロキシガイド](docs/PROXY.ja.md)** - MCP プロキシサーバードキュメント
- 📦 **[POPL ガイド](docs/POPL.ja.md)** - 公開可能証明台帳
- 🔧 **[API ドキュメント](docs/API.ja.md)** - 開発者向け TypeScript API

## インストール

```bash
# グローバルインストール
npm install -g proofscan

# またはインストールせずに実行
npx proofscan --help
```

**要件:** Node.js v18+ (v20+ 推奨)

## クイックスタート

### 1. 初期化

```bash
pfscan config init        # 設定を作成
pfscan config path        # 設定ファイルの場所を表示
```

### 2. MCP サーバーを追加

```bash
# Claude Desktop / mcp.so 形式から
echo '{"mcpServers":{"time":{"command":"npx","args":["-y","@modelcontextprotocol/server-time"]}}}' \
  | pfscan connectors import --from mcpServers --stdin

# または手動で追加
pfscan connectors add --id time --stdio "npx -y @modelcontextprotocol/server-time"
```

### 3. スキャンと表示

```bash
pfscan scan start --id time   # スキャン実行
pfscan                        # イベント表示（デフォルトコマンド）
pfscan tree                   # 構造表示
pfscan status                 # システムステータス
```

## 主な機能

### 📊 イベントタイムライン

```bash
$ pfscan view --limit 10
Time         Sym Dir St Method              Session      Extra
-------------------------------------------------------------------
21:01:58.743 → → ✓ initialize            f2442c... lat=269ms
21:01:59.018 ← ← ✓ initialize            f2442c...
21:01:59.025 • →   notifications/initi... f2442c...
21:01:59.037 → → ✓ tools/list            f2442c...
21:01:59.049 ← ← ✓ tools/list            f2442c... lat=12ms size=1.0KB
```

### 🌳 階層ツリー

```bash
$ pfscan tree
└── 📦 time
    ├── 📋 f2442c9b... (2 rpcs, 8 events)
    │   ├── ↔️ ✓ tools/list (id=2, 12ms)
    │   └── ↔️ ✓ initialize (id=1, 269ms)
    └── 📋 3cf5a66e... (2 rpcs, 8 events)
        ├── ↔️ ✓ tools/list (id=2, 13ms)
        └── ↔️ ✓ initialize (id=1, 271ms)
```

### 🐚 対話型シェル

```bash
$ pfscan shell
proofscan> pwd
Context: session=f2442c9b (connector=time)

proofscan> tool ls
Found 2 tools: get_current_time, get_timezone

proofscan> ref add mytask @this
✓ Reference 'mytask' saved

proofscan> popl @last --title "タイムサーバーテスト"
✓ POPL entry created: 20260104-f2442c9b
```

### 🎭 MCP プロキシ

```bash
# 複数のバックエンドでプロキシを起動
pfscan proxy start --connectors time,weather

# 別ターミナルで - 統合 MCP サーバーとして使用
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | pfscan proxy start --all

# ツールは名前空間化: time__get_current_time, weather__get_forecast
```

### 🔧 直接ツールテスト

```bash
# ツール一覧
pfscan tool ls time

# ツールスキーマ表示
pfscan tool show time get_current_time

# ツール実行
pfscan tool call time get_current_time --args '{}'
```

## コマンド概要

```
一般コマンド:
  view, v       最近のイベントタイムライン表示（デフォルト）
  tree, t       コネクタ → セッション → RPC 構造表示
  explore, e    対話的データブラウザ
  scan, s       新規スキャン実行
  status, st    システムステータス表示
  shell         対話型シェル（REPL）TAB 補完付き
  rpc           RPC 呼び出し詳細表示（list, show）
  summary       セッションサマリ表示
  permissions   カテゴリ別権限統計表示
  tool          MCP ツール操作（ls, show, call）

管理:
  archive, a    古いデータのアーカイブと削減
  config, c     設定管理
  connectors    コネクタ管理
  secrets       シークレット管理
  doctor        データベース診断と修復
  popl          公開可能証明台帳

高度な機能:
  proxy         MCP プロキシサーバー操作
  log           プロキシログ表示
  monitor       スキャンイベント監視
  sessions      セッション管理
  events        イベントエクスポート

ショートカット:
  v=view  t=tree  e=explore  s=scan  st=status  a=archive  c=config
```

## ドキュメント

### ユーザー向け

- **[ユーザーガイド](docs/GUIDE.ja.md)** - 完全な CLI コマンドリファレンスと例
- **[シェルモード](docs/SHELL.ja.md)** - 対話型シェル、@参照、高度なワークフロー
- **[プロキシガイド](docs/PROXY.ja.md)** - MCP プロキシサーバーのセットアップと使用方法
- **[POPL ガイド](docs/POPL.ja.md)** - 公開監査証跡の作成

### 開発者向け

- **[API ドキュメント](docs/API.ja.md)** - TypeScript API と EventLine モデル
- **[アーキテクチャ](docs/ARCHITECTURE.ja.md)** - 内部設計とデータベーススキーマ
- **[コントリビューション](CONTRIBUTING.md)** - 開発環境のセットアップとガイドライン

## 設定

設定ファイルの場所（OS 標準）:
- **Windows**: `%APPDATA%\proofscan\config.json`
- **macOS**: `~/Library/Application Support/proofscan/config.json`
- **Linux**: `~/.config/proofscan/config.json`

基本的な設定構造:

```json
{
  "version": 1,
  "connectors": [
    {
      "id": "time",
      "enabled": true,
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-time"]
      }
    }
  ],
  "retention": {
    "keep_last_sessions": 50,
    "raw_days": 7,
    "max_db_mb": 500
  }
}
```

詳細は **[ユーザーガイド](docs/GUIDE.ja.md#設定)** を参照してください。

## データストレージ

proofscan は 2 ファイル構成の SQLite を使用:

```
~/.config/proofscan/
├── config.json
├── events.db          # セッション、イベント、RPC 呼び出し（削減可能）
├── proofs.db          # 不変の証明記録（削減不可）
├── proxy-runtime-state.json  # プロキシ状態（プロキシ使用時）
└── proxy-logs.jsonl   # プロキシログ（プロキシ使用時）
```

## グローバルオプション

```bash
-c, --config <path>  設定ファイルパス
--json               JSON 形式で出力
-v, --verbose        詳細出力
-h, --help           ヘルプ表示
-V, --version        バージョン表示
```

## 使用例

### 基本ワークフロー

```bash
# 1. MCP サーバーをインポート
cat claude_desktop_config.json | pfscan connectors import --from mcpServers --stdin

# 2. スキャン実行
pfscan scan start --id myserver

# 3. 結果表示
pfscan                         # 最近のイベント
pfscan tree                    # 階層表示
pfscan rpc list --session abc  # RPC 詳細
```

### シェルモードワークフロー

```bash
pfscan shell

# セッションに移動
proofscan> cc time
proofscan> pwd
Context: connector=time

proofscan> up abc123
Context: session=abc123 (connector=time)

# 参照を保存して後で使用
proofscan> ref add important @this
proofscan> tool call get_current_time --args '{}'
proofscan> popl @last --title "本番環境テスト"
```

### プロキシモード

```bash
# ターミナル 1: プロキシ起動
pfscan -v proxy start --connectors server1,server2

# ターミナル 2: ステータス確認
pfscan proxy status
pfscan log --tail 20

# Claude Desktop でプロキシを使用
# claude_desktop_config.json に追加:
# {
#   "mcpServers": {
#     "proofscan-proxy": {
#       "command": "pfscan",
#       "args": ["proxy", "start", "--all"]
#     }
#   }
# }
```

## 開発

```bash
git clone https://github.com/proofofprotocol/proofscan.git
cd proofscan
npm install
npm run build
npm test

# ソースから実行
node dist/cli.js --help
```

## ユースケース

- 🔍 **MCP サーバーのデバッグ**: JSON-RPC 通信で何が起きているかを正確に把握
- 📊 **ツール使用状況の分析**: どのツールがどのくらい呼ばれているかを追跡
- 🎯 **パフォーマンス監視**: RPC レイテンシを測定しボトルネックを特定
- 🔐 **セキュリティ監査**: 権限リクエストとデータアクセスをレビュー
- 📝 **ドキュメント作成**: バグレポート用の公開可能なログを生成
- 🧪 **テスト**: MCP サーバーの動作とツールスキーマを検証
- 🎭 **統合**: プロキシモードで複数の MCP サーバーを集約

## 関連プロジェクト

- **[Model Context Protocol](https://modelcontextprotocol.io)** - 公式 MCP 仕様
- **[MCP Servers](https://github.com/modelcontextprotocol/servers)** - 公式サーバー実装
- **[@proofofprotocol/inscribe-mcp-server](https://github.com/proofofprotocol/inscribe-mcp-server)** - ブロックチェーンベースの証明ストレージ

## ライセンス

MIT

## サポート

- 📖 **ドキュメント**: [docs/](docs/) ディレクトリを参照
- 🐛 **バグレポート**: [GitHub Issues](https://github.com/proofofprotocol/proofscan/issues)
- 💬 **ディスカッション**: [GitHub Discussions](https://github.com/proofofprotocol/proofscan/discussions)

---

**❤️ を込めて [Proof of Protocol](https://github.com/proofofprotocol) が作成**
