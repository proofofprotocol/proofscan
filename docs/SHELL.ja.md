# proofscan シェルモードガイド

対話型シェルは、proofscan を操作するための強力な REPL (Read-Eval-Print Loop) を提供します。TAB 補完、コマンド履歴、コンテキスト管理、そして特別な @参照構文を備えています。

## 目次

- [シェルの起動](#シェルの起動)
- [基本コマンド](#基本コマンド)
- [コンテキスト管理](#コンテキスト管理)
- [@参照システム](#参照システム)
- [ルーターコマンド](#ルーターコマンド)
- [ツールコマンド](#ツールコマンド)
- [POPL コマンド](#popl-コマンド)
- [パイプサポート](#パイプサポート)
- [TAB 補完](#tab-補完)
- [ヒントとコツ](#ヒントとコツ)

## シェルの起動

```bash
$ pfscan shell
proofscan>
```

シェルが提供する機能:
- ✅ **TAB 補完** コマンド、コネクタ、セッション、RPC 用
- ✅ **コマンド履歴** (上下矢印キー)
- ✅ **コンテキスト認識** (現在のコネクタ/セッションを記憶)
- ✅ **@参照** 簡単なデータアクセス
- ✅ **パイプサポート** コマンド連鎖用

**注意:** シェルモードは対話型ターミナル (TTY) が必要です。スクリプトやパイプでは使用できません。

## 基本コマンド

### 組み込みコマンド

| コマンド | 説明 |
|---------|------|
| `help` | 利用可能なコマンドを表示 |
| `exit` | シェルを終了 |
| `clear` | 画面をクリア |
| `history` | コマンド履歴を表示 |

### すべての CLI コマンドが利用可能

シェルモードでは、`pfscan` プレフィックスなしで任意の `pfscan` コマンドを使用できます:

```bash
proofscan> view --limit 10
proofscan> tree
proofscan> status
proofscan> scan start --id time
```

**ブロックされるコマンド:** `shell` (すでにシェルモード内のため)

## コンテキスト管理

シェルは以下を追跡する**コンテキスト**を維持します:
- 現在の**コネクタ**
- 現在の**セッション**

コンテキストはプロンプトに表示され、@参照を受け付けるコマンドで使用されます。

### ルーターコマンド (cd スタイルのナビゲーション)

| コマンド | 説明 | 例 |
|---------|------|-----|
| `pwd` | 現在のコンテキストを表示 | `pwd` |
| `pwd --json` | コンテキストを JSON で表示 | `pwd --json` |
| `cc <connector>` | コネクタを変更 | `cc time` |
| `up <session>` | セッションに移動 | `up abc123` |
| `ls` | 現在のコンテキストの項目を一覧表示 | `ls` |
| `show` | 現在のコンテキストの詳細を表示 | `show` |

#### 例

```bash
# 現在のコンテキストを表示
proofscan> pwd
No context set

# コネクタに移動
proofscan> cc time
✓ Switched to connector: time

# コンテキストを表示
proofscan> pwd
Context: connector=time

# セッションに移動 (部分 ID でも可)
proofscan> up f2442c
✓ Switched to session: f2442c9b (connector=time)

# 完全なコンテキストを表示
proofscan> pwd
Context: session=f2442c9b (connector=time)

# 現在のコネクタのセッションを一覧表示
proofscan> ls
Sessions in connector 'time':
  [1] f2442c9b... (2 RPCs, 8 events) 2026-01-04 12:01
  [2] 3cf5a66e... (2 RPCs, 8 events) 2026-01-04 11:45
```

## @参照システム

シェルは、完全な ID を入力せずにデータにアクセスするための強力な @参照構文をサポートしています。

### 組み込み参照

| 参照 | 説明 |
|------|------|
| `@this` | 現在のコンテキスト (コネクタまたはセッション) |
| `@last` | 最新のセッションまたは RPC |
| `@rpc:<id>` | ID による特定の RPC |
| `@session:<id>` | セッション ID による特定のセッション (部分 ID 可) |
| `@ref:<name>` | ユーザー定義の名前付き参照 |

### 参照の使用

参照はほとんどのコマンドで使用できます:

```bash
# 現在のセッションを表示
proofscan> tree @this

# 最新セッションの POPL エントリを作成
proofscan> popl @last

# RPC 参照でツールを呼び出し
proofscan> tool call @rpc:2

# 名前付き参照の詳細を表示
proofscan> ref @ref:mytask
```

## ルーターコマンド

### pwd - 現在のコンテキストを表示

現在のコンテキスト (コネクタおよび/またはセッション) を表示します。

```bash
# シンプルな出力
proofscan> pwd
Context: session=f2442c9b (connector=time)

# JSON 出力
proofscan> pwd --json
{
  "connector": "time",
  "session": "f2442c9b"
}

# パイプで参照として保存
proofscan> pwd --json | ref add mycontext
✓ Reference 'mycontext' saved
```

### cc - コネクタを変更

コネクタに移動します。

```bash
proofscan> cc time
✓ Switched to connector: time

# TAB 補完付き
proofscan> cc <TAB>
time    weather    filesystem
```

### up - セッションに移動

セッションに移動します (部分 ID サポート)。

```bash
proofscan> up f2442c
✓ Switched to session: f2442c9b (connector=time)

# コネクタコンテキストから
proofscan> cc time
proofscan> up <TAB>
f2442c9b...    3cf5a66e...    7a1b3c5d...

# 部分マッチをサポート
proofscan> up f24
✓ Switched to session: f2442c9b
```

### ls - 項目を一覧表示

現在のコンテキストの項目を一覧表示します。

```bash
# コネクタコンテキスト内: セッションを一覧表示
proofscan> cc time
proofscan> ls
Sessions in connector 'time':
  [1] f2442c9b... (2 RPCs, 8 events) 2026-01-04 12:01
  [2] 3cf5a66e... (2 RPCs, 8 events) 2026-01-04 11:45

# セッションコンテキスト内: RPC を一覧表示
proofscan> up f2442c
proofscan> ls
RPCs in session 'f2442c9b':
  [1] initialize (id=1, 269ms)
  [2] tools/list (id=2, 12ms)

# コンテキストなし: コネクタを一覧表示
proofscan> pwd
No context set
proofscan> ls
Connectors:
  [1] time (3 sessions)
  [2] weather (1 session)
```

### show - 詳細を表示

現在のコンテキストの詳細を表示します。

```bash
# コネクタコンテキスト内
proofscan> cc time
proofscan> show
Connector: time
Type: stdio
Command: npx -y @modelcontextprotocol/server-time
Sessions: 3
Enabled: yes

# セッションコンテキスト内
proofscan> up f2442c
proofscan> show
Session: f2442c9b
Connector: time
Started: 2026-01-04T12:01:58.610Z
Ended: 2026-01-04T12:02:01.150Z
Duration: 2540ms
RPCs: 2 (2 OK, 0 ERR)
Events: 8
```

## ref コマンド

ユーザー定義の参照を管理します。

### ref add - 参照を保存

現在のコンテキストまたは特定の参照を名前で保存します。

```bash
# 現在のコンテキストを保存
proofscan> ref add mytask @this
✓ Reference 'mytask' saved (session: f2442c9b, connector: time)

# 最新セッションを保存
proofscan> ref add lastscan @last
✓ Reference 'lastscan' saved (session: 3cf5a66e)

# 特定の RPC を保存
proofscan> ref add initcall @rpc:1
✓ Reference 'initcall' saved (rpc: 1, session: f2442c9b)

# パイプされた JSON から保存
proofscan> pwd --json | ref add mycontext
✓ Reference 'mycontext' saved
```

**有効な参照名:**
- 英数字、ハイフン、アンダースコアのみ: `[a-zA-Z0-9_-]+`
- 最大 64 文字
- @ で始めることはできない
- 予約名: `this`, `last`, `rpc`, `session`, `fav`, `ref`

### ref ls - 参照を一覧表示

保存されたすべての参照を一覧表示します。

```bash
proofscan> ref ls
Saved references:
  mytask      → session=f2442c9b, connector=time
  lastscan    → session=3cf5a66e, connector=time
  initcall    → rpc=1, session=f2442c9b
  mycontext   → session=f2442c9b, connector=time
```

### ref rm - 参照を削除

保存された参照を削除します。

```bash
proofscan> ref rm mytask
✓ Reference 'mytask' removed

proofscan> ref rm nosuchref
✗ Reference not found: nosuchref
```

### ref @target - 参照を解決

参照が指す内容を表示します。

```bash
# @this を解決
proofscan> ref @this
Reference: @this
Type: session
Session: f2442c9b
Connector: time

# @last を解決
proofscan> ref @last
Reference: @last
Type: session
Session: 3cf5a66e (latest)
Connector: time

# 名前付き参照を解決
proofscan> ref @ref:mytask
Reference: @ref:mytask
Type: session
Session: f2442c9b
Connector: time

# JSON 出力
proofscan> ref @this --json
{
  "type": "session",
  "sessionId": "f2442c9b",
  "connectorId": "time"
}
```

## ツールコマンド

シェルから直接 MCP ツールを実行します。

### tool ls - ツール一覧

```bash
# コネクタコンテキスト内
proofscan> cc time
proofscan> tool ls
Found 2 tools:
  get_current_time    特定のタイムゾーンの現在時刻を取得
  get_timezone        タイムゾーン情報を取得

# 明示的なコネクタ
proofscan> tool ls weather
Found 3 tools:
  get_forecast    天気予報を取得
  get_current     現在の天気を取得
  get_alerts      気象警報を取得
```

### tool show - ツールスキーマ表示

```bash
proofscan> tool show time get_current_time
Tool: get_current_time
Description: 特定のタイムゾーンの現在時刻を取得

Required arguments:
  timezone    string    IANA タイムゾーン (例: America/New_York)

Optional arguments:
  format      string    時刻フォーマット (iso, unix, human)
```

### tool call - ツール実行

```bash
# シンプルな呼び出し (引数なし)
proofscan> tool call time get_timezone --args '{}'
Result:
  timezone: America/New_York
  offset: -05:00
  dst: false

# 引数付き
proofscan> tool call time get_current_time --args '{"timezone":"Asia/Tokyo"}'
Result:
  time: 2026-01-04T21:30:45+09:00
  timezone: Asia/Tokyo
  formatted: 21:30:45 JST

# ファイルから
proofscan> tool call time get_current_time --args-file args.json

# 標準入力から
proofscan> echo '{"timezone":"UTC"}' | tool call time get_current_time --stdin

# ドライラン (実際には呼び出さない)
proofscan> tool call time get_current_time --args '{"timezone":"UTC"}' --dry-run
Dry run - would send:
  Connector: time
  Tool: get_current_time
  Arguments: {"timezone":"UTC"}
```

## POPL コマンド

セッションから公開可能な監査証跡を作成します。

### popl init - POPL ディレクトリの初期化

```bash
proofscan> popl init
✓ POPL directory initialized at: /current/dir/.popl
```

### popl session - POPL エントリの作成

セッションから POPL エントリを作成します。

```bash
# 現在のコンテキストから
proofscan> popl session @this
✓ POPL entry created: 20260104-f2442c9b
Files:
  .popl/entries/20260104-f2442c9b/POPL.yml
  .popl/entries/20260104-f2442c9b/status.json
  .popl/entries/20260104-f2442c9b/rpc.sanitized.jsonl

# 最新セッションから
proofscan> popl @last
✓ POPL entry created: 20260104-3cf5a66e

# 名前付き参照から
proofscan> popl @ref:mytask --title "本番環境テスト"
✓ POPL entry created: 20260104-f2442c9b
Title: 本番環境テスト

# ショートカット: 'session' を省略
proofscan> popl @last
# 同等: popl session @last
```

**POPL サニタイゼーション:**
- ファイルパスが編集
- シークレットが削除
- RPC ペイロードがハッシュ化
- 公開共有に安全

### popl list - エントリ一覧

```bash
proofscan> popl list
POPL entries:
  20260104-f2442c9b  本番環境テスト          2026-01-04 12:05
  20260104-3cf5a66e  デバッグセッション      2026-01-04 11:50
  20260103-7a1b3c5d  初回スキャン            2026-01-03 18:30
```

### popl show - エントリ詳細表示

```bash
proofscan> popl show 20260104-f2442c9b
Entry: 20260104-f2442c9b
Title: 本番環境テスト
Created: 2026-01-04T12:05:30Z
Session: f2442c9b
Connector: time
RPCs: 2
Sanitized: yes
Files:
  POPL.yml
  status.json
  rpc.sanitized.jsonl
  validation-run.log
```

## パイプサポート

シェルはコマンド間のデータパイプをサポートします。

### 基本的なパイプ

```bash
# pwd 出力を ref にパイプ
proofscan> pwd --json | ref add mycontext

# view 出力を ref にパイプ
proofscan> view --limit 1 --json | ref add lastevent
```

### サポートされるパイプコマンド

| 左側 | 右側 | 説明 |
|------|------|------|
| `pwd --json` | `ref add <name>` | コンテキストを参照として保存 |
| `view --json` | `ref add <name>` | イベントを参照として保存 |
| `rpc list --json` | `ref add <name>` | RPC リストを参照として保存 |
| `rpc show --json` | `ref add <name>` | RPC 詳細を参照として保存 |

## TAB 補完

シェルは以下のインテリジェントな TAB 補完を提供します:

### コマンド補完

```bash
proofscan> vi<TAB>
view

proofscan> co<TAB>
config    connectors
```

### コネクタ補完

```bash
proofscan> cc <TAB>
time    weather    filesystem

proofscan> scan start --id <TAB>
time    weather    filesystem
```

### セッション補完

```bash
proofscan> up <TAB>
f2442c9b    3cf5a66e    7a1b3c5d

proofscan> rpc list --session <TAB>
f2442c9b    3cf5a66e    7a1b3c5d
```

### RPC ID 補完

```bash
proofscan> rpc show --session f2442c --id <TAB>
1    2

proofscan> ref add mycall @rpc:<TAB>
1    2    3
```

### 参照名補完

```bash
proofscan> ref @ref:<TAB>
mytask    lastscan    initcall    mycontext

proofscan> ref rm <TAB>
mytask    lastscan    initcall    mycontext
```

## ヒントとコツ

### クイックナビゲーション

```bash
# セッションに直接ジャンプ
proofscan> up abc<TAB>  # abc123... に補完

# 部分 ID を使用
proofscan> up f24       # f2442c9b にマッチ
```

### コンテキストショートカット

```bash
# 現在の作業を保存
proofscan> ref add wip @this

# 後で再開
proofscan> ref @ref:wip
proofscan> up @ref:wip
```

### POPL ワークフロー

```bash
# スキャン後
proofscan> scan start --id time
proofscan> popl @last --title "タイムサーバー検証"

# レビューと共有
proofscan> popl list
proofscan> popl show <entry-id>
```

### コマンド履歴

```bash
# UP 矢印キーで履歴を循環
# CTRL+R で履歴を検索 (ターミナルがサポートしている場合)
```

### バッチ操作

```bash
# 複数の参照を追加
proofscan> cc time
proofscan> ref add time-ctx @this
proofscan> up f2442c
proofscan> ref add time-session @this
proofscan> tool call get_current_time --args '{}'
proofscan> ref add time-call @last
```

### エラー回復

コマンドが失敗した場合:
- `pwd` でコンテキストを確認
- コネクタの存在を確認: `cc <TAB>`
- セッションの存在を確認: `up <TAB>`
- コマンド構文を確認: `<command> --help`

### パフォーマンスのヒント

- 完全なセッション ID を入力する代わりに部分 ID を使用
- ID をコピー/ペーストする代わりに @参照を使用
- TAB 補完を積極的に使用
- 頻繁に使用するコンテキストを名前付き参照として保存

## 制限事項

- シェルは対話型ターミナル (TTY) が必要
- スクリプトや非対話型パイプでは使用不可
- 一部のコマンド (`explore` など) はシェルモードでうまく動作しない場合がある
- 長時間実行コマンドはシェルをブロックする (別ターミナルで `scan` を使用)

## シェル専用機能

これらの機能は**シェルモードでのみ利用可能**で、通常の CLI では利用できません:

✅ コンテキスト管理 (pwd, cc, up)
✅ @参照 (@this, @last, @ref:name)
✅ ルーターコマンド (ls, show)
✅ すべてに対する TAB 補完
✅ コマンド履歴
✅ パイプサポート
✅ 名前付き参照ストレージ

通常の CLI コマンドは両方のモードで動作しますが、@参照サポートはありません。

## 例

### 完全なセッション分析

```bash
$ pfscan shell

# コネクタに移動
proofscan> cc time

# セッション一覧
proofscan> ls

# セッション選択
proofscan> up f2442c

# 詳細表示
proofscan> show

# RPC を表示
proofscan> rpc list --session @this

# POPL エントリ作成
proofscan> popl @this --title "タイムサーバー分析"

# 後で使用するため参照を保存
proofscan> ref add time-analysis @this
```

### ツールテストワークフロー

```bash
# ナビゲートしてツールを一覧表示
proofscan> cc weather
proofscan> tool ls

# ツールをテスト
proofscan> tool show get_forecast
proofscan> tool call get_forecast --args '{"location":"Tokyo"}'

# ドキュメント用に保存
proofscan> ref add weather-test @last
proofscan> popl @ref:weather-test --title "天気ツールテスト"
```

---

**次へ:** 完全な CLI リファレンスは [ユーザーガイド](GUIDE.ja.md) を、監査証跡の作成は [POPL ガイド](POPL.ja.md) を参照してください。
