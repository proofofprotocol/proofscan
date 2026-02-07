# Phase 6 MCP Apps - PR実装プロンプト集

各PRをGLMサブエージェントに投げる際のコピペ用プロンプト。

---

## PR1: Apps基盤（resources, tools/list, ui/initialize）

**目的:** UIが表示できる"最小成功ルート"を通す（データ取得はモックでも可）

### 実装範囲

- `resources/list` に `ui://proofscan/trace-viewer` を追加
  - `mimeType: "text/html;profile=mcp-app"` 必須
- `resources/read` で trace-viewer の **単一HTML（JS/CSS同梱）** を返す
- `tools/list` に `proofscan_getEvents` を追加（PR1では handler はスタブOK）
  - `outputSchema` 宣言必須
  - `_meta.ui.resourceUri`
  - `_meta.outputSchemaVersion = "1"`
- UI側：`ui/initialize` を送って token 取得 → 以降 token 検証（token不一致は無視）

### 受け入れ条件（AC）

- [ ] `resources/list` が上記 mimeType を返す
- [ ] `resources/read` が単一HTMLを返し、UI上で "Connected" 表示まで行く
- [ ] `tools/list` が outputSchema と `_meta.ui.resourceUri` を返す
- [ ] UIが token を受け取り、token無し/不一致メッセージをrejectする

### 禁止

- `type:"resource"` を tool結果で返さない
- 外部JS/CSS（CDN等）を使わない
- `extensions` 前提で分岐しない（best-effort扱い）

### 成果物

- 変更ファイル一覧
- 手動確認ログ（どの手順で何が見えたか）

---

## PR2: BridgeEnvelope + 相関ID + 監査ログ

**目的:** token隔離と追跡可能性の土台を作る（最重要セキュリティPR）

### 実装範囲

- UI→Host の `tools/call` params に `_bridge.sessionToken` を許容
- `sanitizeToolCall()` を実装し、Server転送前に必ず `_bridge` をstrip
  - strip前のtokenは **監査ログだけに残す**
- 相関ID4種（`ui_session_id`/`ui_rpc_id`/`correlation_id`/`tool_call_fingerprint`）生成
- `ui_*` イベント種別で EventLineDB に記録

### AC

- [ ] unit test: `_bridge` が server転送payloadに存在しない
- [ ] 監査ログに token が残る（ただし secret redact 方針に従う）
- [ ] `correlation_id` が request→result→delivered で一貫

---

## PR3: proofscan_getEvents（paging tool）

**目的:** UIが "windowed/paginated" で取りに行ける契約を完成させる

### 実装範囲

- `proofscan_getEvents` handler 実装
- Tool結果は **3層（content / structuredContent / _meta）**
- `_meta.fullEvents` 制限（200件、payload 10KB truncate、secret redact）
- cursor境界：`before` は **指定eventを含まない**（older only）

### AC

- [ ] `structuredContent` が `outputSchema` に一致（テストで検証）
- [ ] idempotent insert できる前提の安定したpaging

---

## PR4: trace-viewer MVP

**目的:** "見える" を仕上げる（通知差吸収込み）

### 実装範囲

- windowed render（初回50件、上スクロールで追加取得）
- 仮想スクロール
- notify両対応：`ui/notify` と `ui/notifications/*` をUI側で受ける
- 「ダミーイベント1件」表示確認

### AC

- [ ] basic-host / Claude のどちらかで表示確認
- [ ] 追加読み込みでイベントが崩れない

---

## GLM実装ルール（全PRに適用）

```
- このPRのスコープ外は一切触らない（気づいても別Issue/別PRに切る）
- 変更したファイル一覧 + 手動確認ログ + ACチェック結果をPR本文に必ず書く
- セキュリティ仕様（token strip / redact / size limit）は「テストで証明」する
```
