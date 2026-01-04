# POPL ガイド - Public Observable Proof Ledger

**Version:** 0.10.3  
**最終更新:** 2026-01-04

## 📚 目次

1. [POPLとは](#poplとは)
2. [アーキテクチャ](#アーキテクチャ)
3. [クイックスタート](#クイックスタート)
4. [コマンドリファレンス](#コマンドリファレンス)
5. [サニタイゼーション](#サニタイゼーション)
6. [信頼レベル](#信頼レベル)
7. [ワークフロー例](#ワークフロー例)
8. [トラブルシューティング](#トラブルシューティング)

---

## POPLとは

**POPL (Public Observable Proof Ledger)** は、MCPサーバーとの通信を**公開可能な形式**で記録するための証明システムです。プライバシーとセキュリティを保護しながら、AIツールの動作を透明化します。

### 主な特徴

- **🔒 自動サニタイゼーション**: パス、シークレット、RPCペイロードを安全化
- **📊 構造化エントリ**: セッション、ツール、RPCの階層構造
- **🔐 信頼レベル管理**: L0〜L4の段階的信頼モデル
- **💾 独立データベース**: イベントDBとは別の`proofs.db`に保存
- **🌐 共有可能**: 公開・共有が安全な形式

### なぜPOPLが必要か？

1. **透明性**: AIツールの挙動を第三者が検証可能
2. **再現性**: 実行内容を正確に再現可能
3. **信頼構築**: セキュリティ監査やコンプライアンス対応
4. **デバッグ**: 問題の原因を安全に共有

---

## アーキテクチャ

### データフロー

```
┌─────────────────────────────────────┐
│   Raw MCP Events (events.db)       │
│   • 完全なJSON-RPC通信              │
│   • パス、シークレット含む           │
│   • 内部使用のみ                    │
└──────────────┬──────────────────────┘
               │ Sanitize
               ▼
┌─────────────────────────────────────┐
│   POPL Entries (proofs.db)         │
│   • パス: [REDACTED]                │
│   • シークレット: [SECRET]          │
│   • RPCペイロード: SHA-256ハッシュ  │
│   • 公開可能                        │
└─────────────────────────────────────┘
```

### POPLエントリの構造

```yaml
session:
  id: session_abc123
  connector: time
  started_at: 2026-01-04T16:30:00.000Z
  ended_at: 2026-01-04T16:35:00.000Z
  trust_level: L2_SANITIZED
  
  tools:
    - name: get_current_time
      calls: 5
      
  rpc_calls:
    - rpc_id: rpc_01234567890
      method: tools/call
      tool: get_current_time
      timestamp: 2026-01-04T16:30:10.123Z
      status: OK
      latency_ms: 45
      request_hash: sha256:abcd1234...
      response_hash: sha256:ef567890...
      sanitization:
        redacted_fields: ["/path/to/file"]
        hashed_payloads: true
```

---

## クイックスタート

### 1. POPLの初期化

```bash
# POPL設定を初期化
pfscan popl init

# 設定を確認
pfscan popl config
```

### 2. セッションエントリの作成

```bash
# 最新のセッションからPOPLエントリを生成
pfscan popl session

# 特定のセッションを指定
pfscan popl session --session abc123

# 信頼レベルを指定
pfscan popl session --trust-level L3
```

### 3. POPLエントリの一覧表示

```bash
# すべてのPOPLエントリを表示
pfscan popl list

# 別名を使用
pfscan popl ls

# JSON形式で出力
pfscan popl list --json
```

### 4. POPLエントリの詳細表示

```bash
# エントリの完全な詳細を表示
pfscan popl show <entry-id>

# JSON形式で出力
pfscan popl show <entry-id> --json
```

---

## コマンドリファレンス

### `popl init`

POPL設定を初期化します。

```bash
pfscan popl init [options]

オプション:
  --force              既存の設定を上書き
  -h, --help           ヘルプを表示
```

**実行内容:**
- `proofs.db`データベースを作成
- デフォルトのサニタイゼーションルールを設定
- 信頼レベルポリシーを初期化

### `popl session`

セッションからPOPLエントリを生成します。

```bash
pfscan popl session [options]

オプション:
  --session <id>       セッションIDを指定（デフォルト: 最新）
  --trust-level <L>    信頼レベルを指定（L0〜L4、デフォルト: L2）
  --include-raw        生のペイロードを含める（非推奨）
  --json               JSON形式で出力
  -h, --help           ヘルプを表示
```

**例:**
```bash
# 最新セッションから作成（デフォルト: L2）
pfscan popl session

# 特定セッションでL3信頼レベル
pfscan popl session --session abc123 --trust-level L3

# JSON形式で出力
pfscan popl session --json
```

### `popl list` (別名: `ls`)

POPLエントリの一覧を表示します。

```bash
pfscan popl list [options]

オプション:
  --limit <n>          表示件数（デフォルト: 30）
  --connector <id>     特定コネクタのみ表示
  --trust-level <L>    特定の信頼レベルのみ表示
  --json               JSON形式で出力
  -h, --help           ヘルプを表示
```

**出力例:**
```
POPL Entries
════════════════════════════════════════════════════════════

entry_001  session_abc123  time         L2_SANITIZED  2026-01-04 16:30:00
entry_002  session_def456  weather      L3_VERIFIED   2026-01-04 17:00:00
entry_003  session_ghi789  calendar     L2_SANITIZED  2026-01-04 17:30:00
```

### `popl show`

POPLエントリの詳細を表示します。

```bash
pfscan popl show <entry-id> [options]

オプション:
  --json               JSON形式で出力
  --export <path>      ファイルにエクスポート
  -h, --help           ヘルプを表示
```

**例:**
```bash
# 詳細表示
pfscan popl show entry_001

# JSON形式で表示
pfscan popl show entry_001 --json

# ファイルにエクスポート
pfscan popl show entry_001 --export ./popl-entry-001.json
```

### `popl config`

POPL設定を表示します。

```bash
pfscan popl config [options]

オプション:
  --json               JSON形式で出力
  -h, --help           ヘルプを表示
```

**設定項目:**
- サニタイゼーションルール
- 信頼レベルポリシー
- デフォルト信頼レベル
- エクスポート設定

---

## サニタイゼーション

### サニタイゼーションルール

POPLエントリ生成時に以下のルールが自動適用されます。

#### 1. パスのリダクション

**対象:**
- ファイルパス
- ディレクトリパス
- URL（ローカルファイルスキーム）

**処理:**
```
Before: /Users/john/Documents/secret-project/data.txt
After:  [REDACTED]/data.txt

Before: C:\Users\John\AppData\Local\config.json
After:  [REDACTED]\config.json

Before: file:///home/user/.ssh/id_rsa
After:  [REDACTED]/id_rsa
```

#### 2. シークレットのリダクション

**対象:**
- APIキー
- パスワード
- トークン
- 認証情報

**検出パターン:**
- `api_key`, `apiKey`, `API_KEY`
- `password`, `passwd`, `pwd`
- `token`, `bearer`, `auth`
- `secret`, `credential`

**処理:**
```json
Before: {"api_key": "sk-proj-abc123def456"}
After:  {"api_key": "[SECRET]"}

Before: {"password": "my_password_123"}
After:  {"password": "[SECRET]"}
```

#### 3. RPCペイロードのハッシュ化

**対象:**
- リクエストJSON
- レスポンスJSON

**処理:**
```
Request:  {"tool": "echo", "args": {"message": "hello"}}
Hash:     sha256:a1b2c3d4e5f6...

Response: {"content": [{"type": "text", "text": "hello"}]}
Hash:     sha256:f6e5d4c3b2a1...
```

**保持する情報:**
- メソッド名
- ツール名
- ステータス（OK/ERR）
- レイテンシ
- サイズ（バイト）

---

## 信頼レベル

POPLは5段階の信頼レベルをサポートします。

### L0: RAW（非推奨）

- **特徴**: 生のイベントデータをそのまま記録
- **用途**: 内部デバッグのみ
- **リスク**: ⚠️ パス、シークレット、完全なペイロードを含む
- **公開**: 🚫 絶対に公開しない

```bash
# L0エントリを作成（非推奨）
pfscan popl session --trust-level L0 --include-raw
```

### L1: MINIMAL_REDACT

- **特徴**: 基本的なパスとシークレットのみリダクション
- **用途**: 社内共有、限定的な外部共有
- **リスク**: ⚠️ 一部のメタデータが残る
- **公開**: ⚠️ 注意して共有

```bash
pfscan popl session --trust-level L1
```

### L2: SANITIZED（デフォルト）

- **特徴**: 完全なサニタイゼーション（パス、シークレット、ペイロードハッシュ）
- **用途**: 一般的な共有、レポート
- **リスク**: ✅ 安全に公開可能
- **公開**: ✅ 推奨

```bash
pfscan popl session --trust-level L2
```

### L3: VERIFIED

- **特徴**: L2 + 追加の検証とメタデータ
- **用途**: 監査、コンプライアンス、公式レポート
- **リスク**: ✅ 高い信頼性
- **公開**: ✅ 強く推奨

```bash
pfscan popl session --trust-level L3
```

### L4: CERTIFIED

- **特徴**: L3 + デジタル署名、タイムスタンプ
- **用途**: 法的証拠、公式証明
- **リスク**: ✅ 最高の信頼性
- **公開**: ✅ 完全に安全

```bash
pfscan popl session --trust-level L4
```

**注意:** L4は現在実装中です。

---

## ワークフロー例

### 例1: セッションをPOPL化して共有

```bash
# 1. スキャンを実行
pfscan scan start time

# 2. セッションを確認
pfscan sessions ls

# 3. POPLエントリを作成（L2: SANITIZED）
pfscan popl session --session abc123

# 4. エントリを確認
pfscan popl show entry_001

# 5. エクスポート
pfscan popl show entry_001 --export ./time-session-proof.json

# 6. 共有（安全）
# time-session-proof.json を共有
```

### 例2: 複数セッションをバッチ処理

```bash
# すべてのセッションをL3で処理
for session in $(pfscan sessions ls --json | jq -r '.[].id'); do
  pfscan popl session --session $session --trust-level L3
done

# POPLエントリを確認
pfscan popl list
```

### 例3: 監査レポートの生成

```bash
# 特定コネクタのすべてのPOPLエントリを取得
pfscan popl list --connector time --json > time-audit.json

# 統計情報を抽出
jq '[.[] | {
  session: .session.id,
  tool_count: (.session.tools | length),
  rpc_count: (.session.rpc_calls | length),
  trust_level: .session.trust_level
}]' time-audit.json
```

### 例4: Shellモードとの連携

```bash
# Shellモードでセッションを作成してPOPL化
pfscan shell

# Shell内で
> scan time
> popl @last   # 最新セッションをPOPL化
> pwd          # 現在のセッションIDを確認
> popl @this   # 現在のセッションをPOPL化
```

---

## トラブルシューティング

### 問題: `POPL not initialized`

**原因:** POPLデータベースが作成されていない

**解決策:**
```bash
pfscan popl init
```

### 問題: `Session not found`

**原因:** 指定したセッションIDが存在しない

**解決策:**
```bash
# セッション一覧を確認
pfscan sessions ls

# 正しいセッションIDを使用
pfscan popl session --session <correct-id>
```

### 問題: サニタイゼーションが不完全

**原因:** カスタムフィールドやパターンが検出されていない

**解決策:**
```bash
# 設定を確認
pfscan popl config

# より高い信頼レベルを使用
pfscan popl session --trust-level L3

# エントリを手動で確認
pfscan popl show <entry-id> --json | jq '.session.rpc_calls[] | select(.sanitization)'
```

### 問題: POPLエントリが作成されない

**原因:** セッションにRPCコールが含まれていない

**解決策:**
```bash
# セッションの詳細を確認
pfscan tree --session <session-id>

# RPCコールがあるセッションを選択
pfscan sessions ls --json | jq '.[] | select(.event_count > 2)'
```

---

## ベストプラクティス

### 1. デフォルトでL2を使用

日常的な使用では、L2 (SANITIZED) が推奨です。

```bash
pfscan popl session  # デフォルトはL2
```

### 2. 監査にはL3以上を使用

公式レポートやコンプライアンス対応にはL3以上を使用します。

```bash
pfscan popl session --trust-level L3
```

### 3. L0は絶対に共有しない

L0エントリには機密情報が含まれるため、外部共有は禁止です。

### 4. POPLエントリを定期的にエクスポート

```bash
# 日次エクスポート
pfscan popl list --json > popl-export-$(date +%Y%m%d).json
```

### 5. Shellモードで@参照を活用

```bash
# Shell内で
> scan time
> popl @last     # 最新セッションをPOPL化
> ref add time-proof @last  # 参照として保存
```

---

## 関連ドキュメント

- **[ユーザーガイド](./GUIDE.ja.md)** - 基本的な使い方
- **[Shellモードガイド](./SHELL.ja.md)** - 対話的REPL
- **[Proxyガイド](./PROXY.ja.md)** - MCP Proxyサーバー

---

## サポートとフィードバック

- **GitHub Issues**: [proofscan/issues](https://github.com/proofofprotocol/proofscan/issues)
- **License**: MIT
