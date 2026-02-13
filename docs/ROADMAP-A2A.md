# A2A Protocol Support Roadmap

proofscan の A2A (Agent-to-Agent) プロトコル対応ロードマップ。

## 進捗サマリー

| Phase | 名称 | 状態 | 完了日 |
|-------|------|------|--------|
| 1.1 | Agent Card & 登録 | ✅ 完了 | 2025-01-28 |
| 1.2 | send コマンド | ✅ 完了 | 2025-01-28 |
| 1.3 | セッション記録 | ✅ 完了 | 2026-01-30 |
| 2.1 | Task クライアント | ✅ 完了 | 2026-01-30 |
| 2.2 | Task CLI | ✅ 完了 | 2026-01-31 |
| 2.2.1 | glm-dice-agent Task対応 | ✅ 完了 | 2026-01-31 |
| 2.2.2 | task wait --follow | ✅ 完了 | 2026-01-31 |
| 2.3 | history コマンド | ✅ 完了 | 2026-02-01 |
| 2.3.1 | history 横断検索 | ✅ 完了 | 2026-02-01 |
| 2.3.2 | history UX改善 | ✅ 完了 | 2026-02-01 |
| 2.4 | Task DB記録 | ✅ 完了 | 2026-02-01 |
| 2.4.1 | history --task | ✅ 完了 | 2026-02-01 |
| 2.5 | show に capabilities 追加 | ✅ 完了 | 2026-02-01 |
| 3.1 | SSE クライアント | ✅ 完了 | 2026-02-03 |
| 3.2 | UI対応 | ✅ 完了 | 2026-02-03 |
| 4 | 認証 | 📋 未着手 | - |
| 5 | 高度な機能 | 📋 未着手 | - |
| 6.PR1 | MCP Apps基盤 | ✅ 完了 | 2026-02-06 |
| 6.PR2 | BridgeEnvelope + 監査ログ | ✅ 完了 | 2026-02-06 |
| 6.PR3 | proofscan_getEvents | ✅ 完了 | 2026-02-07 |
| 6.PR4 | trace-viewer MVP | ✅ 完了 | 2026-02-07 |
| 7.1 | tool list description表示 | 📋 未着手 | - |
| 7.2 | 事前バリデーション | ✅ 完了 | 2026-02-11 |
| 7.3 | バッチ呼び出し | ✅ 完了 | 2026-02-11 |
| 7.4 | 出力フォーマット制御 | ✅ 完了 | 2026-02-11 |
| 7.5 | proofscanスキル作成 | ✅ 完了 | 2026-02-11 |
| 7.6 | レジストリ検索（MCP/A2A） | ✅ 完了 | 2026-02-11 |
| 7.7 | リソース使用量表示 | ✅ 完了 | 2026-02-13 |
| 7.8 | doctor拡張（統合診断） | 📋 未着手 | - |
| 8 | Protocol Gateway | 🚀 次 | - |

---

## Phase 1: 基本機能

### 1.1 Agent Card & 登録 ✅
- [x] Agent Card 取得 (`/.well-known/agent-card.json`)
- [x] Agent Card キャッシュ (TTL対応)
- [x] `agent add/remove/list/scan` コマンド
- [x] `--allow-local` フラグ (開発用)
- [x] TAB補完にA2Aエージェント表示

**PR:** #82 (merged 2025-01-28)

### 1.2 send コマンド ✅
- [x] `send <message>` で A2A メッセージ送信
- [x] JSON-RPC 2.0 over HTTP
- [x] `message/send` メソッド対応
- [x] messageId 自動生成
- [x] レスポンス表示 (🤖 プレフィックス)
- [x] エラーハンドリング

**PR:** #82 (merged 2025-01-28)

### 1.3 セッション記録 ✅
- [x] A2A送受信をEventLineDBに記録
- [x] contextId による会話追跡
- [x] `ls` でA2Aセッション一覧表示
- [x] `show` でメッセージ履歴表示
- [x] MCPのRPC記録と同等の詳細度

**PR:** #84, #85, #86 (merged 2026-01-30)

**目標:**
```
proofscan:/glm-dice > ls
Session ID       Messages  Last Activity
-----------------------------------------
ctx_abc123...    5         2m ago
ctx_def456...    12        1h ago

proofscan:/glm-dice > cd ctx_abc
proofscan:/glm-dice/ctx_abc > ls
# Message    Role       Content (truncated)
1            user       roll a d20
2            assistant  🎲 I rolled a d20 and got: **15**
3            user       もう一回
4            assistant  🎲 I rolled a d20 and got: **7**
```

---

## Phase 2: タスク管理

### 2.1 Task クライアント ✅
- [x] Task 型定義 (id, status, messages, artifacts)
- [x] `tasks/get` でタスク取得
- [x] `tasks/list` でタスク一覧
- [x] `tasks/cancel` でキャンセル

**PR:** #85 (merged 2026-01-30)

### 2.2 Task CLI ✅
- [x] `task ls <agent>` — タスク一覧
- [x] `task get <agent> <taskId>` — タスク詳細
- [x] `task cancel <agent> <taskId>` — キャンセル
- [x] `task wait <agent> <taskId>` — 完了待機
- [x] psh context 対応 (`cd <agent>` 後は agent 省略可)
- [x] エラーメッセージ改善

**PR:** #86 (merged 2026-01-31)

### 2.2.2 task wait --follow ✅
- [x] `task wait --follow` でリアルタイム進捗表示
- [x] ポーリング間隔設定
- [x] 完了/失敗時の自動終了

**PR:** #87 (merged 2026-01-31)

### 2.3 history コマンド ✅
- [x] セッション内メッセージ履歴表示
- [x] `history` コマンド追加
- [x] メッセージ検索・フィルタ (`--search`, `--role`)
- [x] `-n <count>` で件数制限
- [x] `-h / --help` でUsage表示
- [x] DoS防止 (MAX_LIMIT = 10000)

**PR:** #90 (merged 2026-02-01)

### 2.3.1 history 横断検索 ✅
- [x] connector level での全セッション横断検索
- [x] コンテキスト駆動（`--all` 不要、位置で自動判定）
- [x] 検索結果にセッションID表示
- [x] `-s` ショートハンド追加
- [x] 不正オプション警告
- [x] 時系列順表示に統一

**PR:** #91 (merged 2026-02-01)

### 2.3.2 history UX改善 ✅
- [x] 補完/サジェスト対応（completer.ts）
- [x] `history | grep <text>` パイプライン対応
- [x] `history | less` ページャー対応
- [x] grepテキスト検索の自動変換
- [x] pager後のreadline競合修正

**PR:** #93 (merged 2026-02-01)

### 2.4 Task DB記録 ✅
- [x] task_events テーブル追加 (スキーマv7)
- [x] Task イベントを EventLineDB に記録
- [x] イベント種別: created, updated, completed, failed, canceled, wait_timeout, poll_error
- [x] CLI統合: task wait/cancel でイベント発火
- [x] Session解決: 既存イベント再利用 or 新規作成

**PR:** #94, #95 (merged 2026-02-01)

### 2.4.1 history --task ✅
- [x] `history --task` でタスク一覧サマリ
- [x] `history --task <id>` でタイムライン表示
- [x] カテゴリ正規化 (created/status/terminal/client_error)
- [x] 重複status除外
- [x] 補完対応 (--task)

**PR:** #96 (merged 2026-02-01)

### 2.5 show に capabilities 追加 ✅
- [x] `agent show` で Task 対応状況を表示
- [x] `Capabilities: streaming: yes/no, tasks: yes/no`

**PR:** #97 (merged 2026-02-01)

---

## Phase 2.2.1: glm-dice-agent Task対応 ✅

Phase 2.2 Task CLI の検証用に、glm-dice-agent に Task 管理機能を追加。

**場所:** `/mnt/s3vo/clawdbot/projects/glm-dice-agent`
**GitHub:** Shin-R2un/glm-dice-agent

### 最小実装 ✅
- [x] `tasks/list` エンドポイント（タスク一覧返却）
- [x] `tasks/get` エンドポイント（タスク詳細返却）
- [x] `tasks/cancel` エンドポイント（キャンセル処理）
- [x] Task 状態管理 (in-memory)
- [x] `message/send` でタスク作成

### 検証項目 ✅
- [x] `pfs task ls glm-dice` → タスク一覧表示
- [x] `pfs task get glm-dice <taskId>` → 詳細表示
- [x] `pfs task cancel glm-dice <taskId>` → キャンセル成功
- [x] `pfs task wait glm-dice <taskId>` → 完了待機

### 追加機能
- [x] 新構文: `roll d20`, `roll 3d6 c5 i3` (count/interval)

---

## Phase 3: ストリーミング

### 3.1 SSE対応 ✅
- [x] `message/stream` エンドポイント（クライアント実装済み）
- [x] Server-Sent Events パース
- [x] リアルタイム応答表示
- [x] Unit tests (22 tests)
- [ ] 部分メッセージ結合（統合テストで検証）

**PR:** #98 (merged 2026-02-03)

### 3.2 UI対応 ✅
- [x] ストリーミング中のプログレス表示 (ora spinner)
- [x] Ctrl+C でストリーム中断 (graceful abort)
- [x] 非TTY環境対応 (CI互換)
- [x] exit code 130 (SIGINT標準)

**PR:** #99 (merged 2026-02-03)

---

## Phase 4: 認証・セキュリティ

### 4.1 OAuth 2.0
- [ ] Authorization Code Flow
- [ ] Token リフレッシュ
- [ ] Scope 管理

### 4.2 API Key
- [ ] Bearer Token 対応
- [ ] secrets store 統合

### 4.3 Extended Agent Card
- [ ] 認証後の詳細情報取得
- [ ] 追加 skill/capability 表示

---

## Phase 5: 高度な機能

### 5.1 Artifacts
- [ ] ファイル送受信
- [ ] Base64 エンコード/デコード
- [ ] MIME type 対応

### 5.2 Push Notifications
- [ ] Webhook 受信
- [ ] プッシュ通知表示

### 5.3 Agent Discovery
- [ ] リモートエージェント探索
- [ ] Agent Directory 対応

---

## Phase 6: MCP Apps 対応 ✅

MCP Apps Extension (SEP-1865) への対応。インタラクティブUIでプロトコル解析体験を向上。

**設計書:** `/home/shin/vault/03_Projects/proofscan/3032 - proofscan Phase 6 - MCP Apps 設計書.md`
**完了日:** 2026-02-07

### 設計方針
- `_meta.ui.resourceUri` を基準形（SEP-1865準拠）
- Tool結果は3層: `content` / `structuredContent` / `_meta`
- sessionToken認証 + BridgeEnvelope（token隔離）
- 相関ID4種で完全追跡（Proof of Protocol）
- Host Profile で実装差を吸収

### PR分割

| PR | 内容 | マージ日 |
|----|------|----------|
| PR #100 | psh SSE streaming | 2026-02-05 |
| PR #101 | Apps基盤: resources, tools/list, ui/initialize, token検証 | 2026-02-06 |
| PR #102 | BridgeEnvelope + 相関ID + 監査ログ | 2026-02-06 |
| PR #103 | proofscan_getEvents (paging, 3層結果) | 2026-02-07 |
| PR #104 | trace-viewer MVP (windowed, 仮想スクロール) | 2026-02-07 |

### PR1: Apps基盤 ✅
- [x] `resources/list` に `ui://proofscan/trace-viewer` 追加
- [x] `mimeType: "text/html;profile=mcp-app"` 必須
- [x] `resources/read` で単一HTML（JS/CSS同梱）配信
- [x] `tools/list` に `proofscan_getEvents`（outputSchema + _meta.ui）
- [x] UI側 `ui/initialize` + sessionToken取得・検証

### PR2: BridgeEnvelope + 監査ログ ✅
- [x] `_bridge.sessionToken` 方式（UI→Host）
- [x] `sanitizeToolCall()` でServer転送前にstrip
- [x] 相関ID生成: ui_session_id, ui_rpc_id, correlation_id, tool_call_fingerprint
- [x] ui_* イベント種別でEventLineDB記録

### PR3: proofscan_getEvents ✅
- [x] EventLineDB → paging handler
- [x] 3層結果: content(テキスト), structuredContent(outputSchema準拠), _meta(UI専用)
- [x] _meta.fullEvents 制限: 200件, 10KB truncate, secret redact
- [x] cursor境界: `before` は指定event含まない

### PR4: trace-viewer MVP ✅
- [x] windowed render（初回50件、上スクロールで追加）
- [x] 仮想スクロール
- [x] notify両対応: `ui/notify` + `ui/notifications/*`
- [x] basic-host or Claude で表示確認

### 6.5 統計ダッシュボード（任意・後続）
- [ ] RPC呼び出し統計
- [ ] レイテンシグラフ
- [ ] エラー率表示

### 6.6 インタラクティブデバッグ（任意・後続）
- [ ] ブレークポイント設定
- [ ] リクエスト編集＆再送
- [ ] スキーマバリデーション表示

---

## Phase 7: AI UX改善

AIエージェントがproofscanを使いやすくするための改善。MCPエコシステムへのブリッジとしての価値を最大化。

### 背景
- AIがMCPサーバーを使う際、proofscanが最短ルート
- 現状は `--help` を見ながら手探りで使用
- 改善によりAI/人間両方のUXが向上

### 進捗サマリー

| Sub | 内容 | 状態 |
|-----|------|------|
| 7.1 | tool list description表示 | 📋 |
| 7.2 | 事前バリデーション | 📋 |
| 7.3 | バッチ呼び出し | 📋 |
| 7.4 | 出力フォーマット制御 | ✅ 完了 |
| 7.5 | proofscanスキル作成 | 📋 |
| 7.6 | レジストリ検索（MCP/A2A） | ✅ 完了 |

### 7.1 tool list description表示
- [ ] inputSchema.description を truncate して表示
- [ ] 50文字程度で切り詰め
- [ ] 日本語対応（文字幅考慮）

**現状:** Description列が空
**目標:**
```
Tool                   Req  Description
-----------------------------------------------
get_info               1    Get stock info for...
get_analyst_rec...     1    Analyst recommenda...
```

### 7.2 事前バリデーション
- [ ] `tool call` 前に inputSchema と照合
- [ ] 必須パラメータ欠落を事前検出
- [ ] 型チェック（string/number/boolean等）
- [ ] エラーメッセージに期待スキーマ表示

**目標:**
```bash
$ pfscan tool call yfinance get_info --args '{}'
Error: Missing required parameter 'ticker'
  Expected: { ticker: string }
  
  Run: pfscan tool show yfinance get_info for details
```

### 7.3 バッチ呼び出し
- [ ] `--batch` オプション追加
- [ ] 並列実行（Promise.all）
- [ ] 結果を配列で返却
- [ ] 個別エラーハンドリング

**目標:**
```bash
$ pfscan tool call yfinance get_info \
    --batch '[{"ticker":"9107.T"},{"ticker":"7148.T"}]'
[
  { "ticker": "9107.T", "result": {...} },
  { "ticker": "7148.T", "result": {...} }
]
```

### 7.4 出力フォーマット制御
- [ ] `--output json` (デフォルト、現行)
- [ ] `--output compact` (1行JSON)
- [ ] `--output table` (表形式)
- [ ] `--output value` (結果値のみ)

### 7.5 proofscanスキル作成
- [ ] SKILL.md 作成
- [ ] インストール手順
- [ ] コマンド一覧
- [ ] よくある使用パターン
- [ ] コネクタ追加手順
- [ ] ClawHub公開（任意）

**目標:** AIがSKILL.md読むだけでproofscanを使いこなせる

### 7.6 レジストリ検索（MCP/A2A） ✅
- [x] `pfscan registry search <query>` でローカルコネクタ検索
- [x] `pfscan registry list` で全コネクタ一覧（状態付き）
- [x] `--enabled/--disabled` フィルタ
- [x] `--json` 出力対応
- [x] キーワード検索（ID, type, command, URL）

**実装:** ローカルレジストリ方式（外部レジストリ未使用）
- 管理者が事前に信頼できるMCPサーバーを登録
- AIは登録済みコネクタからのみ選択可能
- `pfscan connectors enable/disable` で制御

**コマンド:**
```bash
# 検索
pfscan registry search "yfinance"
pfscan registry search "http"

# 一覧
pfscan registry list
pfscan registry list --enabled
pfscan registry list --disabled

# JSON出力
pfscan --json registry search "yfinance"
```

**PR:** `feature/phase7.6-registry` (pending merge)

### 7.7 リソース使用量表示 ✅
- [x] 有効コネクタの総ツール数表示
- [x] tools/list の推定トークン数/バイト数
- [x] 閾値超過時の警告
- [x] `pfscan status` に統合

**PR:** #112 (merged 2026-02-13)

**出力例:**
```bash
$ pfscan status

Connectors: 5 enabled / 8 total
Tools: 127 total
Estimated context: ~8,500 tokens

⚠️ Warning: Tool list exceeds 5,000 tokens
   Consider disabling unused connectors
```

**注意:** token数は概算（1 token ≒ 4 bytes）。表示時に `Estimated token count is approximate` の注記を含める。

### 7.8 doctor拡張（統合診断）
- [ ] 既存のDB診断を維持
- [ ] コネクタ診断（接続確認、応答時間）
- [ ] リソース診断（7.7と連携）
- [ ] レジストリ診断（7.6と連携）
- [ ] `--fix` でコネクタ再起動等も対応

**目標:**
```bash
$ pfscan doctor

Database:
  ✅ Schema version: 7 (current)
  ✅ No corruption detected

Connectors:
  ✅ yfinance: OK (ping 120ms)
  ⚠️ github: timeout (3000ms)
  
Resources:
  Enabled: 5 connectors, 127 tools
  Estimated context: ~8,500 tokens
  ⚠️ Consider disabling unused connectors

Registry:
  ✅ Smithery: reachable
  ✅ npm: reachable
```

**背景:** AIが「今の状態で何ができるか」を即座に把握できる統合診断。7.6/7.7の機能を統合し、ワンコマンドで全体像を確認。

**実装メモ:** Connector ping の timeout は定数化（`CONNECTOR_PING_TIMEOUT_MS = 3000`）。将来 `--timeout` オプションで上書き可能にする余地を残す。

---

## Phase 8: Protocol Gateway 🚀

proofscanをHTTP/SSEサーバーとして公開し、MCP + A2A両方のプロキシ（Protocol Gateway）として機能させる。

**設計書:** `/home/shin/vault/03_Projects/proofscan/3037 - proofscan Phase 8 - Protocol Gateway 設計書.md`

### 背景
- **現状:** stdio only → ローカルAI（exec権限あり）のみアクセス可能
- **課題:** Phase 7.6 の registry ホワイトリスト制限が実質無意味
- **目標:** リモートAIからアクセス可能にし、ホワイトリスト制御を実効化

### 核心設計
- **明示許可のみ (default deny)** — permissions に含まれない操作は即deny
- **完全シリアルモデル** — stdioコネクタの安全性を優先
- **相関ID完全追跡** — request_id, trace_id, client_id, target_id, decision
- **Latency分解** — latency_ms, queue_wait_ms, upstream_latency_ms
- **Token ハッシュ化** — 平文保存回避、ログには絶対出力しない
- **EventLineDB統合** — request_id を primary correlation key

### PR分割

| PR | 内容 | 依存 | 見積 |
|----|------|------|------|
| PR1 | HTTP基盤 + 共通基盤 (ULID, logger, limits) | - | 3h |
| PR2 | Bearer Token 認証 (ハッシュ化対応) | PR1 | 2h |
| PR3 | MCP プロキシ + キュー/timeout | PR1, PR2 | 4h |
| PR4 | A2A プロキシ | PR1, PR2 | 3h |
| PR5 | 監査ログ + EventLineDB (相関ID対応) | PR3, PR4 | 3h |
| PR6 | SSE + /events/stream | PR3 | 2h |
| **合計** | | | **17h** |

### エンドポイント
```
POST   /mcp/v1/message          MCP JSON-RPC (単発)
GET    /mcp/v1/sse              MCP SSE (ストリーミング)
POST   /a2a/v1/message/send     A2A message/send
POST   /a2a/v1/tasks/*          A2A task operations
GET    /events/stream           Gateway イベント購読
GET    /health                  ヘルスチェック
```

### セキュリティ
- TLS必須（本番環境）
- 127.0.0.1 bind + reverse proxy 経由
- Token rotation（移行期間サポート）
- hide_not_found: true（存在秘匿）
- Rate limiting フック（将来実装用）

---

## 参考リンク

- [A2A Protocol Spec](https://google.github.io/A2A/)
- [A2A SDK (Python)](https://pypi.org/project/a2a-sdk/)
- [proofscan repo](https://github.com/proofofprotocol/proofscan)
- [MCP Apps Extension (SEP-1865)](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps Blog Post](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
- [MCP HTTP Transport Spec](https://spec.modelcontextprotocol.io/specification/basic/transports/#http-with-sse)

---

*Last updated: 2026-02-13*
