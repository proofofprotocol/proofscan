# MCPサーバ追加設定ガイド（Secret管理）

> **バージョン:** 0.10.55+  
> **機能:** MCP Control Plane (PR#66)  
> **日付:** 2026-01-22

このガイドでは、proofscanを使用してMCPサーバを追加・設定する方法を、特にAPIキーや環境変数が必要なサーバに焦点を当てて説明します。

---

## 目次

1. [概要](#概要)
2. [前提条件](#前提条件)
3. [クイックスタート: MCPサーバの追加](#クイックスタート-mcpサーバの追加)
4. [Secretの管理](#secretの管理)
5. [Proxyの管理](#proxyの管理)
6. [Configure Mode（対話型編集）](#configure-mode対話型編集)
7. [高度なトピック](#高度なトピック)
8. [トラブルシューティング](#トラブルシューティング)

---

## 概要

ProofscanはMCPサーバを追加・設定するための複数の方法を提供します：

- **カタログインストール**: 公式MCPレジストリから検索・インストール
- **手動コネクタ追加**: コマンドラインオプションで直接追加
- **Configure Mode** (PR#66): pshシェル内での対話型編集

このガイドでは、APIキーや機密設定が必要なMCPサーバの**Secret管理**に焦点を当てます。

---

## 前提条件

- **Node.js** 18.0.0以降
- **Proofscan** 0.10.55以降
- 環境変数（APIキーなど）を必要とするMCPサーバ

```bash
# バージョン確認
pfscan --version

# 出力例: 0.10.55以降であることを確認
```

---

## クイックスタート: MCPサーバの追加

### ステップ1: MCPサーバを検索

カタログを使用して、APIキーが必要なサーバを検索します：

```bash
# 天気情報サーバを検索
pfscan catalog search weather

# 特定のサーバの詳細を表示
pfscan catalog view io.github.overstarry/qweather-mcp
```

**出力例:**
```
Name:        io.github.overstarry/qweather-mcp
Description: a qweather mcp server
Version:     1.0.12
Repository:  https://github.com/overstarry/qweather-mcp
Transport:   {"type":"stdio"}

Packages:
  - npm qweather-mcp@1.0.12
    Required: QWEATHER_API_BASE, QWEATHER_API_KEY

Install:
  pfscan cat install io.github.overstarry/qweather-mcp --source official
```

**重要情報:**
- ✅ **必須環境変数**: `QWEATHER_API_KEY`, `QWEATHER_API_BASE`
- ✅ **トランスポートタイプ**: `stdio`（コマンドライン実行）
- ✅ **インストールコマンド**: 簡単セットアップ用のコマンドが提供されます

### ステップ2: MCPサーバをインストール

```bash
pfscan catalog install io.github.overstarry/qweather-mcp --source official
```

**出力:**
```
Warning: Installing unknown server: npm package without scope
✓ Connector 'qweather-mcp' added from io.github.overstarry/qweather-mcp (via npx)

Next steps:
  pfscan scan start --id qweather-mcp
```

### ステップ3: インストールを確認

```bash
# 全コネクタをリスト表示
pfscan connectors ls

# 新しいコネクタを表示
pfscan connectors show --id qweather-mcp
```

**出力:**
```json
{
  "id": "qweather-mcp",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "qweather-mcp@1.0.12"
    ]
  }
}
```

---

## Secretの管理

### 概要

Proofs canは環境変数のための安全なSecret保存機能を提供します：

- **自動検出**: Secretらしい値を自動的に検出
- **安全な保存**: Secretは`secrets.db`に暗号化して保存（利用可能な場合）
- **参照システム**: Configでは平文ではなくSecret IDを参照
- **マスキング**: Config表示時にSecretはマスク表示（`***SECRET_REF***`）

### ステップ1: コネクタのSecretを設定

```bash
# API keyを設定
echo "your-actual-api-key-here" | pfscan secrets set qweather-mcp QWEATHER_API_KEY

# API base URLを設定
echo "https://devapi.qweather.com" | pfscan secrets set qweather-mcp QWEATHER_API_BASE
```

**対話モード（推奨）:**
```bash
# Secretを対話的に設定（より安全）
pfscan secrets set qweather-mcp QWEATHER_API_KEY
# プロンプト: Enter secret for qweather-mcp.QWEATHER_API_KEY:
# キーを入力してEnterを押す

pfscan secrets set qweather-mcp QWEATHER_API_BASE
# プロンプト: Enter secret for qweather-mcp.QWEATHER_API_BASE:
# URLを入力してEnterを押す
```

**出力:**
```
Warning: No secure encryption provider available. Secrets will be stored without encryption.

  Secret stored: plain:4bdcecf9-e470-4864-9c4a-e029d334b693
  Config updated: qweather-mcp.transport.env.QWEATHER_API_KEY
```

**注意:** Linuxでは、Secretはデフォルトで暗号化なしで保存されます。Windowsでは`dpapi`暗号化が使用されます。macOSでは、Keychain統合が計画されています。

### ステップ2: Secret保存を確認

```bash
# 全Secretをリスト表示
pfscan secrets ls
```

**出力:**
```
Found 2 secret(s):

  KIND       CONNECTOR/NAMESPACE   KEY                        STATUS    PROVIDER  CREATED
  ─────────  ────────────────────  ─────────────────────────  ────────  ────────  ───────────────────
  connector  qweather-mcp          QWEATHER_API_BASE          OK        plain     2026-01-22T14:14:03
  connector  qweather-mcp          QWEATHER_API_KEY           OK        plain     2026-01-22T14:13:55
```

### ステップ3: Secretを含むコネクタを表示

```bash
pfscan connectors show --id qweather-mcp
```

**出力:**
```
(2 secrets redacted)

{
  "id": "qweather-mcp",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "qweather-mcp@1.0.12"
    ],
    "env": {
      "QWEATHER_API_KEY": "***SECRET_REF***",
      "QWEATHER_API_BASE": "***SECRET_REF***"
    }
  }
}
```

**重要ポイント:**
- ✅ Secretは出力で**マスク**されます
- ✅ ConfigはIDでSecretを参照し、平文は保存しません
- ✅ Secretはコネクタ起動時に**実行時に解決**されます

---

## Proxyの管理

### Proxyの起動

Proxyは複数のコネクタからツールを集約し、単一のMCPインターフェースを通じて公開します。

```bash
# 特定のコネクタでProxyを起動
pfscan proxy start --connectors qweather-mcp

# または有効な全コネクタで起動
pfscan proxy start --all
```

**注意:** ProxyはフォアグラウンドでJSON-RPCメッセージを出力します。別のターミナルで実行するか、プロセスマネージャを使用してください。

### Proxy Statusの確認

```bash
# IPC経由でProxy statusを表示
pfscan proxy status
```

**出力:**
```
Proxy Status
═══════════════════════════════════════════════════

State:        RUNNING
Mode:         stdio
PID:          14554
Started:      2026-01-22T14:14:40.015Z
Uptime:       5s
Heartbeat:    just now

Connectors:
  ● qweather-mcp: 9 tools

Clients:
  (none)

Logging:
  Level:      WARN
  Buffered:   11/1000 lines
```

**重要情報:**
- ✅ **State**: RUNNING（Proxyが稼働中）
- ✅ **Connectors**: アクティブなコネクタとツール数をリスト表示
- ✅ **Clients**: 接続されているMCPクライアントを表示
- ✅ **Logging**: Proxyログはメモリにバッファされます

### Proxyログの表示

```bash
# 最近のログを表示
pfscan log --tail 50

# ログレベルでフィルタ
pfscan log --tail 100 --level INFO
```

**出力例:**
```
[14:14:40.017] INFO  [aggregator] Preloading tools from all connectors...
[14:14:46.541] INFO  Listed 9 tool(s) from qweather-mcp (session=1db6583d)
[14:14:46.541] INFO  [aggregator] Preloaded 9 tool(s)

--- Showing last 13 of 13 entries ---
```

### Proxyのリロード（PR#66機能）

**注意:** この機能はPR#66（MCP Control Plane）の一部です。Proxyを再起動せずにコネクタ設定をホットリロードできます。

```bash
# Proxy設定をリロード
pfscan proxy reload
```

**期待される動作:**
- 更新された`config.json`を読み込む
- 全コネクタをリロード
- 既存のMCPクライアント接続を維持

**現在のステータス（テスト中）:**
```
Error: Proxy is not running
Start the proxy with: pfscan proxy start --all
```

**注意:** IPC（プロセス間通信）ソケットは非対話環境では作成されない場合があります。この機能は本番環境デプロイで最も効果を発揮します。

### Proxyの停止

```bash
# Proxyを正常停止
pfscan proxy stop
```

---

## Configure Mode（対話型編集）

**ステータス:** PR#66で利用可能（feature/mcp-control-plane-v01）

Configure Modeは、Cisco IOSやJuniper Junos CLIに似た、`psh`シェル内での対話型編集体験を提供します。

### Configure Modeへの入り方

```bash
# pshシェルを起動
psh

# Configure modeに入る
pfscan> configure terminal

# Configure modeに入りました
(config)>
```

### コネクタの編集

```bash
# 既存のコネクタを編集
(config)> edit connector qweather-mcp

# または新しいコネクタを作成
(config)> edit connector my-new-server

# コネクタの編集中
(config-connector:qweather-mcp)>
```

### 設定値の設定

```bash
# コネクタを有効/無効にする
(config-connector:qweather-mcp)> set enabled true

# コマンドを設定
(config-connector:qweather-mcp)> set command npx

# コマンド引数を設定
(config-connector:qweather-mcp)> set args "-y" "qweather-mcp@1.0.12"

# 環境変数を設定（自動的にSecretとして検出）
(config-connector:qweather-mcp)> set env.QWEATHER_API_KEY "your-api-key"
(config-connector:qweather-mcp)> set env.QWEATHER_API_BASE "https://devapi.qweather.com"

# 値を強制的にSecretとして扱う
(config-connector:qweather-mcp)> set env.API_KEY "secret-value" --secret
```

**Secret自動検出:**
- ✅ `sk-*`, `api_*`, `*_key`, `*_token`などのパターンに一致する値は自動検出
- ✅ `--secret`フラグでSecret保存を強制
- ✅ Secretは`show`出力でマスクされます

### 設定の表示

```bash
# 現在のコネクタ設定を表示
(config-connector:qweather-mcp)> show

# 変更点を表示（差分）
(config-connector:qweather-mcp)> show diff
```

**`show`出力例:**
```json
{
  "id": "qweather-mcp",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "qweather-mcp@1.0.12"],
    "env": {
      "QWEATHER_API_KEY": "***SECRET***",
      "QWEATHER_API_BASE": "***SECRET***"
    }
  }
}
```

**`show diff`出力例:**
```diff
+ env.QWEATHER_API_KEY: (secret)
+ env.QWEATHER_API_BASE: (secret)
```

### 変更のコミット

```bash
# 保存せずに変更をプレビュー
(config-connector:qweather-mcp)> commit --dry-run

# 変更を保存してProxyをリロード
(config-connector:qweather-mcp)> commit

# Proxyをリロードせずに変更を保存
(config-connector:qweather-mcp)> commit --no-reload
```

**コミットプロセス:**
1. 設定を検証
2. 保留中のSecretを`secrets.db`に保存
3. `config.json`を更新
4. （オプション）IPC経由でProxyに`reload`コマンドを送信

### 変更の破棄

```bash
# 保留中の変更をすべて破棄
(config-connector:qweather-mcp)> discard

# 編集セッションを終了
(config-connector:qweather-mcp)> exit
```

### Configure Modeの終了

```bash
# Configure modeを終了（dirty check付き）
(config)> exit

# 未保存の変更がある場合:
You have unsaved changes. Use "commit" to save or "discard" to abandon changes.

# 通常のシェルに戻る
pfscan>
```

---

## 高度なトピック

### カタログサーバからのSecret使用

カタログ内の多くのMCPサーバはAPIキーを必要とします。完全なワークフローを以下に示します：

```bash
# 1. APIキーが必要なサーバを検索
pfscan catalog search github

# 2. 詳細を表示
pfscan catalog view ai.smithery/smithery-ai-github

# 出力例:
#   Required: GITHUB_PERSONAL_ACCESS_TOKEN

# 3. サーバをインストール
pfscan catalog install ai.smithery/smithery-ai-github --source official

# 4. 必要なSecretを設定
pfscan secrets set github-server GITHUB_PERSONAL_ACCESS_TOKEN
# （プロンプトが表示されたらGitHub PATを入力）

# 5. Proxyを起動
pfscan proxy start --connectors github-server
```

### Secretのインポート/エクスポート

```bash
# Secretを暗号化されたバンドルにエクスポート
pfscan secrets export --output ~/backup/secrets-2026-01-22.enc

# バンドルからSecretをインポート
pfscan secrets import ~/backup/secrets-2026-01-22.enc
```

**ユースケース:**
- 設定変更前のバックアップ
- チーム共有（安全な転送を伴う）
- 環境移行

### 孤立したSecretの管理

コネクタを削除しても、そのSecretはストレージに残る場合があります。

```bash
# どのコネクタからも参照されていないSecretを削除
pfscan secrets prune

# ドライランモード（削除予定のものを表示）
pfscan secrets prune --dry-run
```

### 対話型Secretウィザード

```bash
# コネクタの不足/プレースホルダSecretをすべて編集
pfscan secrets edit qweather-mcp

# またはすべてのコネクタのウィザードを実行
pfscan secrets edit
```

---

## トラブルシューティング

### Secretが検出されない

**問題:**
```bash
pfscan connectors show --id my-server
# 出力が***SECRET_REF***ではなく平文を表示
```

**解決策:**
```bash
# Configure Modeで--secretフラグを使用して強制的にSecret保存
(config-connector:my-server)> set env.MY_VAR "value" --secret

# またはsecrets setコマンドを使用
pfscan secrets set my-server MY_VAR
```

### コネクタが起動しない

**問題:**
```
pfscan proxy start --connectors my-server
# statusでコネクタが"pending"または"error"を表示
```

**診断:**
```bash
# コネクタ設定を確認
pfscan connectors show --id my-server

# ログを確認
pfscan log --tail 100

# Secretが存在することを確認
pfscan secrets ls
```

**一般的な問題:**
1. 必須環境変数の欠落
2. 誤ったcommandまたはargs
3. 実行時にSecretが解決されない
4. npmパッケージが見つからない

### IPCリロードが動作しない

**問題:**
```
pfscan proxy reload
# Error: Proxy is not running
```

**原因:**
- ProxyがIPCサポート付きで起動されていない
- ソケットファイルが作成されていない（非対話環境）
- Proxyは実行中だがIPCサーバの起動に失敗

**解決策:**
```bash
# Proxy statusを確認
pfscan proxy status

# ソケットファイルを確認
ls -la ~/.config/proofscan/*.sock

# Proxyを再起動
pfscan proxy stop
pfscan proxy start --all
```

### Secretが暗号化されない

**警告:**
```
Warning: No secure encryption provider available. Secrets will be stored without encryption.
```

**説明:**
- **Linux**: ネイティブ暗号化プロバイダーなし（Secretは`secrets.db`に平文で保存）
- **Windows**: DPAPI暗号化が自動的に使用されます
- **macOS**: Keychainサポートが計画中

**回避策:**
- ファイルシステム暗号化を使用（例: LUKS, FileVault）
- 制限的なパーミッションを設定: `chmod 600 ~/.config/proofscan/secrets.db`
- 暗号化ボリュームに`secrets.db`を保存

---

## まとめ

### 主要コマンド

| タスク | コマンド |
|------|---------|
| MCPサーバを検索 | `pfscan catalog search <query>` |
| MCPサーバをインストール | `pfscan catalog install <server-id> --source official` |
| Secretを設定 | `pfscan secrets set <connector> <KEY>` |
| Secretをリスト表示 | `pfscan secrets ls` |
| Proxyを起動 | `pfscan proxy start --connectors <id1>,<id2>` |
| Proxy statusを確認 | `pfscan proxy status` |
| ログを表示 | `pfscan log --tail 50` |
| Proxyをリロード | `pfscan proxy reload` |
| Proxyを停止 | `pfscan proxy stop` |

### Configure Modeコマンド

| タスク | コマンド |
|------|---------|
| Configure modeに入る | `configure terminal` |
| コネクタを編集 | `edit connector <id>` |
| 値を設定 | `set <path> <value> [--secret]` |
| 設定を表示 | `show` |
| 差分を表示 | `show diff` |
| 変更をコミット | `commit [--dry-run] [--no-reload]` |
| 変更を破棄 | `discard` |
| 終了 | `exit` |

### ベストプラクティス

1. **APIキーには常にSecretを使用**: Configに平文でキーを保存しない
2. **対話モードを使用**: コマンドラインからパイプするのではなく、Secretを入力
3. **変更後に確認**: `pfscan connectors show`を実行して設定を確認
4. **ログを確認**: `pfscan log`を使用してコネクタの問題を診断
5. **Secretをバックアップ**: 大きな変更前に`pfscan secrets export`を使用
6. **定期的にプルーン**: `pfscan secrets prune`で孤立したSecretを削除

---

## 関連ドキュメント

- [Proxyガイド](./PROXY.ja.md) - MCP Proxyアーキテクチャと高度な使用法
- [Shellガイド](./SHELL.ja.md) - 対話型シェル機能とワークフロー
- [Secret管理](./GUIDE.ja.md#secrets) - 詳細なSecret保存情報

---

**質問や問題がありますか？**

- GitHub Issues: https://github.com/proofofprotocol/proofscan/issues
- Pull Request: https://github.com/proofofprotocol/proofscan/pull/66（Configure Mode）

---

**最終更新:** 2026-01-22  
**バージョン:** 0.10.55（feature/mcp-control-plane-v01）
