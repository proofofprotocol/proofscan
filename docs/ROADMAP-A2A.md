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
| 2.3.1 | history 横断検索 | 📋 未着手 | - |
| 2.4 | Task DB記録 | 📋 未着手 | - |
| 2.5 | show に capabilities 追加 | 📋 未着手 | - |
| 3 | ストリーミング | 📋 未着手 | - |
| 4 | 認証 | 📋 未着手 | - |
| 5 | 高度な機能 | 📋 未着手 | - |

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

### 2.3.1 history 横断検索 📋
- [ ] connector level での全セッション横断検索
- [ ] `history --all --search <query>` オプション
- [ ] 検索結果にセッションID表示
- [ ] エラーメッセージで `--all` オプション案内

### 2.4 Task DB記録 📋
- [ ] Task イベントを EventLineDB に記録
- [ ] `a2a:task:created`, `a2a:task:completed` 等のイベント種別

### 2.5 show に capabilities 追加 📋
- [ ] `agent show` で Task 対応状況を表示
- [ ] `Capabilities: streaming: yes/no, tasks: yes/no`

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

### 3.1 SSE対応
- [ ] `message/stream` エンドポイント
- [ ] Server-Sent Events パース
- [ ] リアルタイム応答表示
- [ ] 部分メッセージ結合

### 3.2 UI対応
- [ ] ストリーミング中のプログレス表示
- [ ] Ctrl+C でストリーム中断

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

## 参考リンク

- [A2A Protocol Spec](https://google.github.io/A2A/)
- [A2A SDK (Python)](https://pypi.org/project/a2a-sdk/)
- [proofscan repo](https://github.com/proofofprotocol/proofscan)

---

*Last updated: 2026-02-01*
