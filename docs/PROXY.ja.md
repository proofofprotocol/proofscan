# Proofscan Proxy ガイド

**Version:** 0.10.3  
**Phase:** 5.0+ Observability Layer  
**最終更新:** 2026-01-04

## 📚 目次

1. [概要](#概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [クイックスタート](#クイックスタート)
4. [Proxyコマンド](#proxyコマンド)
5. [Logコマンド](#logコマンド)
6. [ステート管理](#ステート管理)
7. [高度な使い方](#高度な使い方)
8. [トラブルシューティング](#トラブルシューティング)

---

## 概要

**Proofscan Proxy**は、複数のMCPサーバー（コネクタ）を単一のstdioベースMCPサーバーとして集約するプロキシサーバーです。

### 主な機能

- **🔀 ツール集約**: 複数のMCPサーバーのツールを統合
- **📡 リクエストルーティング**: `connectorId__toolName`形式でルーティング
- **🔍 完全な観測性**: リアルタイムステータスとログ
- **💾 永続化状態**: IPCベースのランタイム状態管理
- **📊 クライアント追跡**: 接続クライアントのセッション・ツール呼び出しを記録

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│            MCP Client (Claude, etc.)            │
└───────────────────┬─────────────────────────────┘
                    │ stdio
                    │
┌───────────────────▼─────────────────────────────┐
│          Proofscan MCP Proxy Server             │
│  ┌───────────────────────────────────────────┐  │
│  │       Tool Aggregator                     │  │
│  │  • connectorId__toolName 名前空間         │  │
│  │  • 重複排除                               │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │       Request Router                      │  │
│  │  • tools/call のルーティング              │  │
│  │  • エラーハンドリング                      │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │       Runtime State Manager               │  │
│  │  • IPC永続化 (runtime-state.json)        │  │
│  │  • Heartbeat (5秒ごと)                   │  │
│  │  • クライアント状態追跡                    │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │       Log Ring Buffer                     │  │
│  │  • 最大1000行のリングバッファ             │  │
│  │  • JSON Lines形式 (proxy-logs.jsonl)     │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────▼───┐   ┌───▼────┐   ┌──▼─────┐
    │ Echo   │   │ Time   │   │ Weather│
    │Connector│   │Connector│   │Connector│
    └────────┘   └────────┘   └────────┘
```

---

## クイックスタート

### 1. Proxyの起動

```bash
# すべての有効なコネクタを起動
pfscan proxy start --all

# 特定のコネクタのみ起動
pfscan proxy start --connectors echo,time

# タイムアウトを指定（デフォルト: 30秒）
pfscan proxy start --all --timeout 60
```

**出力例:**
```
Starting MCP proxy server...
Connector 'echo' ready (11 tools)
Connector 'time' ready (2 tools)
Proxy started with 2 connector(s)
```

### 2. Proxyステータスの確認

```bash
# 人間が読みやすい形式
pfscan proxy status

# JSON形式
pfscan proxy status --json
```

**出力例（人間が読みやすい形式）:**
```
Proxy Status
═══════════════════════════════════════

State:      RUNNING
Mode:       stdio
PID:        12345
Started:    2026-01-04 16:30:00
Uptime:     5m 23s
Heartbeat:  just now

Connectors:
  ● echo         11 tools
  ● time          2 tools

Clients:
  ● claude-desktop (active)
     Last seen: just now
     Sessions: 3
     Tool calls: 47

Logging:
  Level: INFO
  Buffered: 245/1000 lines
```

**JSON出力:**
```json
{
  "running": true,
  "version": 1,
  "proxy": {
    "state": "RUNNING",
    "mode": "stdio",
    "startedAt": "2026-01-04T16:30:00.000Z",
    "pid": 12345,
    "heartbeat": "2026-01-04T16:35:23.456Z"
  },
  "connectors": [
    {
      "id": "echo",
      "toolCount": 11,
      "healthy": true
    },
    {
      "id": "time",
      "toolCount": 2,
      "healthy": true
    }
  ],
  "clients": {
    "claude-desktop": {
      "name": "claude-desktop",
      "protocolVersion": "2024-11-05",
      "state": "active",
      "connectedAt": "2026-01-04T16:30:05.123Z",
      "lastSeen": "2026-01-04T16:35:20.789Z",
      "sessions": 3,
      "toolCalls": 47
    }
  },
  "logging": {
    "level": "INFO",
    "bufferedLines": 245,
    "maxLines": 1000
  }
}
```

### 3. ログの確認

```bash
# 最新50行を表示（デフォルト）
pfscan log

# 最新100行を表示
pfscan log --tail 100

# WARNレベル以上のみ表示
pfscan log --level WARN

# 色なしで表示
pfscan log --no-color
```

**出力例:**
```
2026-01-04 16:30:00.123 [INFO] Proxy started with 2 connector(s)
2026-01-04 16:30:05.456 [INFO] Client: claude-desktop (protocol=2024-11-05)
2026-01-04 16:30:10.789 [INFO] Request: tools/list
2026-01-04 16:30:10.890 [INFO] Listed 13 tool(s) from 2 connectors
2026-01-04 16:30:15.123 [INFO] Request: tools/call
2026-01-04 16:30:15.124 [INFO] tools/call name=echo__echo
2026-01-04 16:30:15.125 [INFO] Routing → connector=echo tool=echo
2026-01-04 16:30:15.234 [INFO] Result: success sessionId=abc123
```

---

## Proxyコマンド

### `proxy start`

MCPプロキシサーバーを起動します。

```bash
pfscan proxy start [options]

オプション:
  --connectors <ids>   起動するコネクタ（カンマ区切り）
  --all                すべての有効なコネクタを起動
  --timeout <sec>      起動タイムアウト（デフォルト: 30、最大: 300）
  -h, --help           ヘルプを表示
```

**制約:**
- `--connectors`と`--all`は排他的（どちらか一方のみ指定可能）
- 少なくとも1つのコネクタが必要
- タイムアウトは1〜300秒の範囲

**例:**
```bash
# すべての有効なコネクタで起動
pfscan proxy start --all

# 特定のコネクタのみ
pfscan proxy start --connectors echo,time,weather

# 詳細ログとタイムアウト設定
pfscan proxy start --all --timeout 60 --verbose
```

### `proxy status`

現在のプロキシランタイム状態を表示します。

```bash
pfscan proxy status [options]

オプション:
  --json               JSON形式で出力
  -h, --help           ヘルプを表示
```

**ステート値:**
- **RUNNING**: Proxyが実行中（最終heartbeatから30秒以内）
- **STALE**: Proxyが停止または応答なし（最終heartbeatから30秒超）
- **STOPPED**: Proxyが明示的に停止された

**コネクタヘルスインジケータ:**
- `● green`: 正常（ツールがロード済み）
- `○ gray`: 保留中（ツールロード中）
- `✕ red`: エラー（エラーメッセージ表示）

**クライアントステートアイコン:**
- `● green`: active（最近アクティブ）
- `○ gray`: idle（アイドル状態）
- `✕ red`: gone（切断済み）

---

## Logコマンド

### `log`

Proxyログを表示します。

```bash
pfscan log [options]

オプション:
  --tail <n>           表示行数（デフォルト: 50）
  --level <level>      最小ログレベルでフィルタ（INFO, WARN, ERROR）
  --no-color           色なしで表示
  -h, --help           ヘルプを表示
```

**ログレベル:**
- **INFO**: 通常の操作情報（デフォルト）
- **WARN**: 警告メッセージ
- **ERROR**: エラーメッセージ

**例:**
```bash
# 最新50行（デフォルト）
pfscan log

# 最新200行
pfscan log --tail 200

# エラーのみ表示
pfscan log --level ERROR

# 警告以上を色なしで表示
pfscan log --level WARN --no-color
```

**ログファイルの場所:**
- **パス**: `~/.config/proofscan/proxy-logs.jsonl`
- **形式**: JSON Lines（各行が独立したJSON）
- **最大行数**: 1000行（リングバッファ）

---

## ステート管理

### Runtime State ファイル

**場所:** `~/.config/proofscan/proxy-runtime-state.json`

**構造:**
```json
{
  "version": 1,
  "proxy": {
    "state": "RUNNING",
    "mode": "stdio",
    "startedAt": "2026-01-04T16:30:00.000Z",
    "pid": 12345,
    "heartbeat": "2026-01-04T16:35:23.456Z"
  },
  "connectors": [...],
  "clients": {...},
  "logging": {
    "level": "INFO",
    "bufferedLines": 245,
    "maxLines": 1000
  }
}
```

### Heartbeat メカニズム

- **間隔**: 5秒ごと
- **目的**: Proxyが生存していることを証明
- **Stale判定**: 最終heartbeatから30秒超で`STALE`とマーク

### クライアント状態遷移

```
          initialize
    ┌──────────────────┐
    │                  │
    ▼                  │
  active ──idle──> idle
    │                  │
    │   stdin close    │
    └──────────────────▼
                     gone
```

- **active**: 最近リクエストを送信
- **idle**: 一定時間アクティビティなし
- **gone**: stdin切断

---

## 高度な使い方

### JSON出力のパース

```bash
# 実行中のProxyのPIDを取得
PID=$(pfscan proxy status --json | jq -r '.proxy.pid')

# コネクタ数を取得
COUNT=$(pfscan proxy status --json | jq '.connectors | length')

# 正常なコネクタのみ抽出
pfscan proxy status --json | jq '.connectors[] | select(.healthy==true)'
```

### Proxyログの監視

```bash
# リアルタイムでログを監視
watch -n 2 "pfscan log --tail 20"

# エラーのみ監視
watch -n 5 "pfscan log --level ERROR --tail 10"
```

### ログのエクスポート

```bash
# JSON Lines形式のログファイルを直接読み取り
cat ~/.config/proofscan/proxy-logs.jsonl | jq '.'

# 特定のメッセージを検索
cat ~/.config/proofscan/proxy-logs.jsonl | jq 'select(.message | contains("tools/call"))'

# タイムスタンプ順にソート
cat ~/.config/proofscan/proxy-logs.jsonl | jq -s 'sort_by(.ts)'
```

### クライアント統計の分析

```bash
# すべてのクライアントのツール呼び出し数
pfscan proxy status --json | jq '.clients | to_entries[] | {name: .key, calls: .value.toolCalls}'

# 最もアクティブなクライアント
pfscan proxy status --json | jq '.clients | to_entries | max_by(.value.toolCalls)'
```

---

## トラブルシューティング

### 問題: `No state found (proxy may never have run)`

**原因:** Proxyがまだ起動されていないか、状態ファイルが削除された

**解決策:**
```bash
# Proxyを起動
pfscan proxy start --all

# 状態を確認
pfscan proxy status
```

### 問題: ステートが`STALE`のまま

**原因:** Proxyプロセスがクラッシュまたは異常終了した

**解決策:**
```bash
# プロセスが残っているか確認
ps aux | grep pfscan

# 残っている場合は強制終了
pkill -9 -f "pfscan proxy"

# 再起動
pfscan proxy start --all
```

### 問題: ログが見つからない

**原因:** Proxyがまだログを出力していない

**解決策:**
```bash
# Proxyを起動してアクティビティを生成
pfscan proxy start --all

# ツールを呼び出してログを生成
pfscan tool call echo echo --args '{"message":"test"}'

# ログを確認
pfscan log
```

### 問題: ログバッファがすぐに満杯になる

**原因:** `--verbose`モードで大量のログが出力されている

**解決策:**
```bash
# 通常モードで再起動
pfscan proxy start --all

# ログレベルを確認
pfscan proxy status --json | jq '.logging.level'
```

### 問題: コネクタが`pending`のまま

**原因:** コネクタの起動に失敗しているか、ツールリストの取得に時間がかかっている

**解決策:**
```bash
# Proxyログでエラーを確認
pfscan log --level ERROR

# コネクタを個別にテスト
pfscan scan start echo

# 設定を確認
pfscan config view
```

---

## パフォーマンスとスケーラビリティ

### リソース使用量

| 項目 | 典型値 | 最大値 |
|------|--------|--------|
| メモリ | 50-100 MB | 200 MB |
| CPU | 1-5% | 20% (起動時) |
| ディスクI/O | 最小限 | ログ書き込み時 |

### ログローテーション

現在の実装では、ログは**リングバッファ**形式で管理され、最大1000行で自動的に古いエントリが削除されます。

**今後の改善予定:**
- 日次ローテーション
- 圧縮アーカイブ
- 外部ログシステムへの転送

### スケーラビリティ

**テスト済み構成:**
- コネクタ数: 最大10個
- 同時クライアント: 最大5個
- ツール総数: 最大100個
- ツール呼び出し頻度: 毎秒10回

**制限:**
- stdio通信は本質的にシングルスレッド
- 大量のコネクタやツールは起動時間に影響

---

## 関連ドキュメント

- **[ユーザーガイド](./GUIDE.ja.md)** - 基本的な使い方
- **[Shellモードガイド](./SHELL.ja.md)** - 対話的REPL
- **[POPLガイド](./POPL.ja.md)** - 公開可能な証明レコード

---

## サポートとフィードバック

- **GitHub Issues**: [proofscan/issues](https://github.com/proofofprotocol/proofscan/issues)
- **License**: MIT
