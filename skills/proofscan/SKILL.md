---
name: proofscan
version: 0.11.1
min_proofscan_version: 0.11.0
updated: 2026-02-11
---

# proofscan Skill

AIがMCPエコシステムにアクセスするためのCLIブリッジ。

## 概要

proofscanは**MCP (Model Context Protocol)** サーバーへのCLIブリッジ。
AIエージェントがMCPツールを呼び出し、結果を取得できる。

**主な用途:**
- 外部データ取得（株価、天気、ファイル検索など）
- MCPサーバーのツール実行
- A2Aエージェント連携
- 全通信の監査・証跡記録

## クイックスタート

### 1. コネクタ確認

```bash
# 登録済みコネクタ一覧
pfscan connectors list
```

### 2. ツール一覧

```bash
# コネクタのツール一覧
pfscan tool list <connector>

# 例: yfinanceのツール
pfscan tool list yfinance
```

### 3. ツール詳細

```bash
# ツールのスキーマと説明を確認
pfscan tool show <connector> <tool>

# 例
pfscan tool show yfinance get_info
```

### 4. ツール呼び出し

```bash
# 基本形
pfscan tool call <connector> <tool> --args '<json>'

# 例: 株価取得
pfscan tool call yfinance get_info --args '{"ticker":"9107.T"}'

# 出力フォーマット指定
pfscan tool call yfinance get_info --args '{"ticker":"9107.T"}' --output compact
```

## 出力フォーマット

`--output` オプションで出力形式を制御:

| フォーマット | 用途 |
|-------------|------|
| `json` | デフォルト、整形JSON |
| `compact` | 1行JSON（パイプ向け） |
| `table` | 表形式（配列結果向け） |
| `value` | 結果値のみ（ラッパーなし） |

```bash
# 結果値のみ抽出
pfscan tool call time get_current_time --output value
```

## バッチ実行

複数引数セットを並列実行:

```bash
pfscan tool call yfinance get_info \
  --batch '[{"ticker":"9107.T"},{"ticker":"7148.T"},{"ticker":"4631.T"}]'
```

**出力形式:**
```json
[
  {"args":{"ticker":"9107.T"},"result":{...},"ok":true},
  {"args":{"ticker":"7148.T"},"result":{...},"ok":true}
]
```

## コネクタ管理

### コネクタ追加

```bash
# npmパッケージ
pfscan connectors add --name <name> --command "npx <package>"

# 例: yfinance
pfscan connectors add --name yfinance --command "uvx mcp-server-yfinance"
```

### 有効化/無効化

```bash
pfscan connectors enable --id <connector>
pfscan connectors disable --id <connector>
```

## A2A連携

A2A (Agent-to-Agent) プロトコルでエージェント間通信:

### エージェント登録

```bash
pfscan targets add --url <agent-url>
```

### エージェント呼び出し

```bash
pfscan a2a send --target <agent-id> --message "タスク内容"
```

## MCP Apps

UI対応MCPサーバーからリソースを取得:

```bash
# リソース一覧
pfscan resource list <connector>

# リソース取得
pfscan resource get <connector> <uri>
```

## よくあるパターン

### 株価情報取得

```bash
# 単一銘柄
pfscan tool call yfinance get_info --args '{"ticker":"9107.T"}' --output value

# 複数銘柄（バッチ）
pfscan tool call yfinance get_info \
  --batch '[{"ticker":"9107.T"},{"ticker":"7148.T"}]' \
  --output compact
```

### 現在時刻取得

```bash
pfscan tool call time get_current_time --output value
```

### ファイル検索（everything）

```bash
pfscan tool call everything search --args '{"query":"*.pdf"}'
```

## バリデーション

ツール呼び出し前に引数を検証:

```bash
# 自動検証（デフォルト）
pfscan tool call yfinance get_info --args '{}'
# → Error: Missing required parameter 'ticker'

# 検証スキップ
pfscan tool call yfinance get_info --args '{}' --skip-validation
```

## トラブルシューティング

### コネクタが見つからない

```bash
# 登録済み確認
pfscan connectors list

# コネクタ追加
pfscan connectors add --name <name> --command "<command>"
```

### ツールがタイムアウト

```bash
# タイムアウト延長
pfscan tool call <connector> <tool> --args '<json>' --timeout 60
```

### 引数エラー

```bash
# スキーマ確認
pfscan tool show <connector> <tool>

# 必須パラメータを確認して再実行
```

## 補足: 人間向け機能

以下はターミナルで人間が監視するための機能:

```bash
# SSEストリーミング監視
psh monitor

# イベントログ確認
pfscan events list --limit 10
```

---

**リポジトリ:** https://github.com/proofofprotocol/proofscan
**インストール:** `npm install -g proofscan`
