# 修正が必要な項目

## 優先度: 高

### 1. 404エラーの修正
現在404になっているリンク:
- `/docs/` へのリンク → ファイルが存在しない
- `/commands/interactive.html` → 存在しない
- `/commands/management.html` → 存在しない
- `/commands/plans.html` → 存在しない
- `/commands/a2a.html` → 存在しない  
- `/commands/diagnostics.html` → 存在しない

**対策**:
- 存在するページのみにリンク
- `/docs/` リンクを削除または GitHub docsへのリンクに変更

### 2. カテゴリ名の英語化
すべてのページで以下を変更:
- 「コマンドカテゴリ」→ "Command Categories"
- 「概要」→ "Overview"
- 「実行コマンド」→ "Execution"
- 「観測コマンド」→ "Observation"
- 「設定コマンド」→ "Configuration"
- 「カタログ」→ "Catalog"
- 「A2Aエージェント」→ "A2A Agent"
- 「POPL」→ "POPL"

### 3. 簡易修正版のサイドバー
存在するページのみをリンク:
```html
<div class="sidebar-category">Command Categories</div>
<a href="/commands/">Overview</a>
<a href="/commands/execution.html">⚡ Execution</a>
<a href="/commands/observation.html">📊 Observation</a>
<a href="/commands/config.html">🔧 Configuration</a>
<a href="/commands/catalog.html">📦 Catalog</a>
<a href="/commands/agent.html">🤖 A2A Agent</a>
<a href="/commands/popl.html">📊 POPL</a>

<div class="sidebar-category">Resources</div>
<a href="/examples/">Examples</a>
<a href="https://github.com/proofofprotocol/proofscan/tree/main/docs">Documentation</a>
```

## 優先度: 中

### 4. ヘッダーナビゲーションの修正
- "Docs" リンクを削除または GitHub docsに変更

## 実装済み
- commands/index.html のサイドバーを英語化 ✓
