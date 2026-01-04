# Proofscan ユーザーガイド

**Version:** 0.10.3  
**最終更新:** 2026-01-04

## 📚 目次

1. [はじめに](#はじめに)
2. [インストールとセットアップ](#インストールとセットアップ)
3. [基本的なワークフロー](#基本的なワークフロー)
4. [コマンドリファレンス](#コマンドリファレンス)
5. [高度な使い方](#高度な使い方)
6. [トラブルシューティング](#トラブルシューティング)

---

## はじめに

**Proofscan**は、MCPサーバーのJSON-RPC通信を可視化・記録するスキャナーツールです。「ブラックボックス」を排除し、AIツールの挙動を完全に透明化します。

### 主な機能

- **📡 リアルタイム監視**: MCP通信をstdio経由でキャプチャ
- **💾 完全な記録**: すべてのJSON-RPCメッセージをSQLiteに保存
- **🔍 多彩な可視化**: タイムライン、ツリー、対話的ブラウザ
- **🛡️ POPL統合**: 公開可能な証明レコードを生成
- **🎯 ツール操作**: MCP toolsの直接呼び出しが可能

---

## インストールとセットアップ

### 要件

- **Node.js**: v18.0.0以上
- **OS**: Linux、macOS、Windows

### グローバルインストール

```bash
npm install -g proofscan
```

### 初期化

```bash
# 設定ファイルとデータディレクトリを作成
pfscan config init

# コネクタ(MCPサーバー)をインポート
echo '{"mcpServers":{"time":{"command":"uvx","args":["mcp-server-time"]}}}' \
  | pfscan connectors import --from mcpServers --stdin

# 設定を確認
pfscan config view
pfscan connectors ls
```

### ディレクトリ構造

```
~/.config/proofscan/
├── config.json          # 設定ファイル
├── events.db            # イベントデータベース
├── proofs.db            # POPL証明データベース
├── proxy-runtime-state.json  # Proxy状態
└── proxy-logs.jsonl     # Proxyログ
```

---

## 基本的なワークフロー

### 1. スキャンの開始

```bash
# コネクタIDを指定してスキャン開始
pfscan scan start time

# 複数のコネクタを同時にスキャン
pfscan scan start time,weather,calendar
```

### 2. イベントの確認

```bash
# タイムライン表示（デフォルト：最新30件）
pfscan view

# 最新100件を表示
pfscan view --limit 100

# リクエスト・レスポンスをペアで表示
pfscan view --pairs

# 特定セッションのみ表示
pfscan view --session abc123
```

### 3. ツリー構造の確認

```bash
# すべてのコネクタ、セッション、RPCを階層表示
pfscan tree

# 特定コネクタのみ表示
pfscan tree --connector time
```

### 4. RPCの詳細表示

```bash
# RPCの一覧
pfscan rpc --session abc123

# RPC詳細（リクエスト・レスポンスJSON）
pfscan rpc --id rpc_01234567890
```

### 5. システムステータス

```bash
# データベースサイズ、イベント数など
pfscan status
```

---

## コマンドリファレンス

### 📊 可視化コマンド

#### `view` (別名: `v`)
イベントのタイムライン表示

```bash
pfscan view [options]

オプション:
  --limit <n>        表示件数（デフォルト: 30）
  --session <id>     特定セッションのみ表示
  --connector <id>   特定コネクタのみ表示
  --pairs            リクエスト・レスポンスをペアで表示
  --json             JSON形式で出力
```

**出力例:**
```
16:32:45.123  →  initialize         time/abc123              -    1.2ms   512B
16:32:45.456  ←  initialize         time/abc123             OK    0.0ms   1KB
16:32:46.000  →  tools/list         time/abc123              -    0.8ms   128B
16:32:46.100  ←  tools/list         time/abc123             OK    0.0ms   4KB
```

#### `tree` (別名: `t`)
階層構造で表示

```bash
pfscan tree [options]

オプション:
  --connector <id>   特定コネクタのみ表示
  --session <id>     特定セッションのみ表示
  --json             JSON形式で出力
```

**出力例:**
```
📦 time
└─ 🔗 session_abc123 (2026-01-04 16:32:45)
   ├─ → initialize (OK, 1.2ms)
   ├─ → tools/list (OK, 0.8ms)
   └─ → tools/call [get_current_time] (OK, 45ms)
```

#### `explore` (別名: `e`)
対話的データブラウザ（TUI）

```bash
pfscan explore
```

- **矢印キー**: ナビゲーション
- **Enter**: 詳細表示
- **q**: 終了

---

### 🔍 スキャンコマンド

#### `scan start`
MCPサーバーとの通信を開始

```bash
pfscan scan start <connector-id> [options]

オプション:
  --timeout <sec>    タイムアウト秒数（デフォルト: 30）
  --verbose          詳細ログを出力
```

**例:**
```bash
# シンプルなスキャン
pfscan scan start time

# 複数コネクタ
pfscan scan start time,weather

# タイムアウトを60秒に設定
pfscan scan start time --timeout 60
```

---

### 🛠️ コネクタ管理

#### `connectors ls`
登録済みコネクタの一覧表示

```bash
pfscan connectors ls [options]

オプション:
  --json             JSON形式で出力
  --verbose          詳細情報を表示
```

#### `connectors import`
MCPサーバー設定をインポート

```bash
# Claude Desktop設定からインポート
pfscan connectors import --from claude

# 標準入力からインポート
echo '{"mcpServers":{...}}' | pfscan connectors import --from mcpServers --stdin

# ファイルからインポート
pfscan connectors import --from file --path ./servers.json
```

#### `connectors enable/disable`
コネクタの有効/無効を切り替え

```bash
pfscan connectors enable time
pfscan connectors disable weather
```

#### `connectors rm`
コネクタを削除

```bash
pfscan connectors rm time
```

---

### 🧰 ツール操作

#### `tool ls`
コネクタが提供するツールの一覧表示

```bash
pfscan tool ls <connector-id> [options]

オプション:
  --json             JSON形式で出力
```

**出力例:**
```
Tools from 'time' connector:
  • get_current_time    - Get the current time in ISO 8601 format
  • get_timezone_info   - Get timezone information for a location
```

#### `tool call`
ツールを直接呼び出し

```bash
pfscan tool call <connector-id> <tool-name> [options]

オプション:
  --args <json>      JSON形式の引数
  --json             JSON形式で出力
```

**例:**
```bash
# 引数なしで呼び出し
pfscan tool call time get_current_time

# JSON引数を指定
pfscan tool call weather get_forecast --args '{"location":"Tokyo"}'
```

---

### 📦 データ管理

#### `archive plan`
アーカイブ対象を確認（dry-run）

```bash
pfscan archive plan [options]

オプション:
  --json             JSON形式で出力
```

**出力例:**
```
Archive Plan (dry-run):
  Sessions to archive: 15
  Events to remove: 3,421
  Estimated space reclaimed: 2.4 MB
```

#### `archive run`
実際にアーカイブを実行

```bash
# ドライラン
pfscan archive run

# 実行（確認あり）
pfscan archive run --yes

# 実行後にVACUUMを実行
pfscan archive run --yes --vacuum
```

#### `archive policy`
アーカイブポリシーを表示

```bash
pfscan archive policy
```

**デフォルトポリシー:**
- 最新50セッションを保持
- 生JSONは7日間保持
- データベース最大サイズ: 500 MB

---

### 🔐 セキュリティとシークレット

#### `secrets ls`
登録済みシークレットの一覧表示

```bash
pfscan secrets ls
```

#### `secrets add`
シークレットを追加

```bash
pfscan secrets add <key> <value>

# 例
pfscan secrets add OPENAI_API_KEY sk-proj-...
```

#### `secrets rm`
シークレットを削除

```bash
pfscan secrets rm OPENAI_API_KEY
```

---

### 🏥 診断とメンテナンス

#### `doctor`
システムの健全性チェック

```bash
pfscan doctor [options]

オプション:
  --fix              自動修復を試みる
  --json             JSON形式で出力
```

**チェック項目:**
- 設定ファイルの存在と整合性
- データベースファイルの健全性
- コネクタの設定検証
- ディスク容量の確認

---

## 高度な使い方

### JSON出力モード

すべてのコマンドは`--json`オプションでJSON形式の出力が可能です。

```bash
# コネクタ一覧をJSON形式で取得
pfscan connectors ls --json | jq '.connectors[] | select(.enabled==true)'

# ステータスをJSON形式で取得
pfscan status --json | jq '.database.events.size'
```

### パイプライン処理

```bash
# イベント数が多いセッションを抽出
pfscan sessions ls --json | jq '.[] | select(.event_count > 100)'

# エラーが発生したRPCを抽出
pfscan view --json --limit 1000 | jq '.[] | select(.status=="ERR")'
```

### 継続的モニタリング

```bash
# 新規イベントをリアルタイムで監視
watch -n 2 "pfscan view --limit 10"

# Proxyステータスを監視
watch -n 5 "pfscan proxy status"
```

### カスタム設定ファイル

```bash
# 別の設定ファイルを使用
pfscan -c ./custom-config.json view
```

---

## トラブルシューティング

### 問題: `connectors: command not found`

**原因:** グローバルインストールが正しく行われていない

**解決策:**
```bash
# npmのグローバルパスを確認
npm config get prefix

# パスが通っているか確認
echo $PATH

# 再インストール
npm install -g proofscan
```

### 問題: `Database locked`

**原因:** 複数のproofscanインスタンスが同時に実行されている

**解決策:**
```bash
# すべてのproofscanプロセスを終了
pkill -f pfscan

# 再度実行
pfscan view
```

### 問題: `Connector failed to start`

**原因:** MCPサーバーのコマンドが見つからない、または実行できない

**解決策:**
```bash
# コネクタの設定を確認
pfscan config view

# MCPサーバーを手動で実行してテスト
uvx mcp-server-time

# doctorコマンドで診断
pfscan doctor --fix
```

### 問題: ログが大量に出力される

**原因:** `--verbose`モードが有効になっている

**解決策:**
```bash
# 通常モードで実行
pfscan view

# 環境変数を確認
echo $PFSCAN_VERBOSE
```

### 問題: データベースサイズが大きくなりすぎた

**解決策:**
```bash
# アーカイブを実行
pfscan archive run --yes --vacuum

# ポリシーを確認
pfscan archive policy
```

---

## 関連ドキュメント

- **[Shellモードガイド](./SHELL.ja.md)** - 対話的REPLとワークフロー
- **[Proxyガイド](./PROXY.ja.md)** - MCP Proxyサーバーの使い方
- **[POPLガイド](./POPL.ja.md)** - 公開可能な証明レコードの生成

---

## サポートとフィードバック

- **GitHub Issues**: [proofscan/issues](https://github.com/proofofprotocol/proofscan/issues)
- **License**: MIT
