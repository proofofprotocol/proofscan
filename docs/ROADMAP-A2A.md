# A2A Protocol Support Roadmap

proofscan の A2A (Agent-to-Agent) プロトコル対応ロードマップ。

## 進捗サマリー

| Phase | 名称 | 状態 | 完了日 |
|-------|------|------|--------|
| 1.1 | Agent Card & 登録 | ✅ 完了 | 2025-01-28 |
| 1.2 | send コマンド | ✅ 完了 | 2025-01-28 |
| 1.3 | セッション記録 | ✅ 完了 | 2026-01-30 |
| 2 | タスク管理 | ⏳ 未着手 | - |
| 3 | ストリーミング | ⏳ 未着手 | - |
| 4 | 認証 | ⏳ 未着手 | - |
| 5 | 高度な機能 | ⏳ 未着手 | - |

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

### 2.1 Task 状態追跡
- [ ] Task オブジェクト対応 (id, status, messages, artifacts)
- [ ] 状態遷移追跡 (submitted → working → completed/failed/input-required)
- [ ] `tasks/get` でタスク取得
- [ ] `tasks/cancel` でキャンセル

### 2.2 長時間タスク
- [ ] ポーリングによる状態確認
- [ ] タイムアウト設定
- [ ] バックグラウンドタスク管理

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

*Last updated: 2026-01-30*
