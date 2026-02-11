/**
 * Japanese locale
 *
 * Structure must mirror en.ts. Missing keys will fall back to English.
 */

import type { LocaleMessages } from './en.js';

export const ja: LocaleMessages = {
  // Common labels
  common: {
    yes: 'はい',
    no: 'いいえ',
    none: '(なし)',
    error: 'エラー',
    warning: '警告',
    hint: 'ヒント',
    times: '{count} 回',
    items: '{count} 件',
    total: '合計',
    ok: 'OK',
    err: 'ERR',
    pending: '待機中',
  },

  // Operation categories
  category: {
    read: '読み取り',
    write: '書き込み',
    network: 'ネット接続',
    exec: 'コマンド実行',
    other: 'その他',
  },

  // analyze command output
  analyze: {
    title: 'proofscan 分析',
    titleConnector: 'proofscan 分析: {connector}',
    titleSession: 'proofscan セッション分析',
    period: '期間: {from} ~ {to}',
    periodWithSessions: '期間: {from} ~ {to} ({count} セッション)',
    overview: '概要',
    connectors: 'コネクタ',
    sessions: 'セッション',
    rpcCalls: 'RPC呼び出し',
    byConnector: 'コネクタ別',
    methods: 'メソッド',
    toolsCalled: 'ツール呼び出し（全セッション）',
    availableTools: '利用可能なツール（最新のtools/listより）',
    toolUsage: 'ツール使用状況（{count} セッション）',
    byCategory: 'カテゴリ別',
    calls: '{count} 回',
    call: '{count} 回',
    section: {
      header: '【{label}】',
    },
    permission: {
      label: '許可',
      allowed: 'あり',
      denied: 'なし',
    },
    usage: {
      label: '使用',
      count: '{count} 回',
    },
    total: '{allowed} ツール許可, {count} 回使用',
    notAllowed: '(未許可)',
    noData: 'データがありません。',
    noSessions: 'セッションがありません。',
    noTools: 'ツールがありません。',
  },

  // summary command output
  summary: {
    title: 'セッションサマリ',
    section: {
      capability: 'できること（capability）',
      toolCall: 'やったこと（tool call）',
      notes: '注意点',
    },
    capability: {
      count: '{count} 種類',
    },
    toolCall: {
      count: '{count} 回',
    },
    notes: {
      execCalled: 'コマンド実行が行われました',
      execCapable: 'コマンド実行可能なツールがあります',
      writeCalled: '書き込み操作が行われました',
      networkCalled: '外部ネットワーク接続が行われました',
      noSensitive: '重要な操作（書き込み・ネット接続・コマンド実行）は実行されていません',
    },
  },

  // record command output
  record: {
    type: {
      toolCall: 'やったこと（tool call）',
      capabilityCatalog: '能力一覧（capability catalog）',
    },
    noCandidates: '候補なし',
    candidateCount: '候補数: {count}',
    tools: '{count} ツール',
  },

  // status command output
  status: {
    title: 'proofscan ステータス',
    configuration: '設定',
    database: 'データベース',
    dataSummary: 'データサマリ',
    connectors: 'コネクタ',
    quickCommands: 'クイックコマンド',
    noDataYet: 'データがありません。初期化してスキャンを実行してください:',
  },

  // doctor command output
  doctor: {
    title: 'proofscan ドクター',
    paths: 'パス',
    config: '設定',
    dataDir: 'データディレクトリ',
    eventsDb: 'events.db',
    proofsDb: 'proofs.db',
    eventsDatabase: 'イベントデータベース',
    exists: '存在',
    readable: '読み取り可能',
    version: 'バージョン',
    tables: 'テーブル',
    missingTables: '欠落テーブル',
    missingColumns: '欠落カラム',
    allPresent: '必要なテーブルとカラムはすべて存在しています',
    noFixesNeeded: '修正は不要です。',
    runWithFix: '修復を試みるには --fix を付けて実行してください:',
    dbNotExist: 'データベースがまだ存在しません。スキャンを実行して作成してください:',
    tryBackup: 'バックアップを取って再作成してください:',
  },

  // view command output
  view: {
    noEvents: 'イベントがありません。',
    noEventsHint: 'ヒント: まずスキャンを実行してください: pfscan scan start --id <connector>',
    noPairs: 'RPCペアがありません。',
    pairsHint: '(詳細: pfscan rpc show --session <ses> --id <rpc>)',
    pairsSummary: '{total} ペア: {ok} OK, {err} ERR, {pending} 待機中',
    noExportEvents: 'エクスポートするイベントがありません。',
    exportSuccess: '{count} イベントを {file} にエクスポートしました ({format})',
    followHeader: 'イベント{info} (監視中, Ctrl+C で停止):',
    followStopped: '監視を停止しました。',
  },

  // scan command output
  scan: {
    scanning: 'コネクタをスキャン中: {id}...',
    scanningDryRun: '[ドライラン] コネクタをスキャン中: {id}...',
    scanComplete: 'スキャン完了',
    scanFailed: 'スキャン失敗: {error}',
    nextSteps: '次のステップ:',
  },

  // connectors command output
  connectors: {
    noConnectors: 'コネクタが設定されていません。',
    headerId: 'ID',
    headerEnabled: '有効',
    headerType: 'タイプ',
    headerCommand: 'コマンド/URL',
    added: 'コネクタ \'{id}\' を追加しました。',
    enabled: 'コネクタ \'{id}\' を有効にしました。',
    disabled: 'コネクタ \'{id}\' を無効にしました。',
    deleted: 'コネクタ \'{id}\' を削除しました。',
    imported: '{count} 件のコネクタをインポートしました。',
  },

  // sessions command output
  sessions: {
    noSessions: 'セッションがありません。',
  },

  // tree command output
  tree: {
    noData: 'データがありません。',
    noDataHint: 'ヒント: まずスキャンを実行してください: pfscan scan start --id <connector>',
    summary: '{connectors} コネクタ, {sessions} セッション, {rpcs} RPC',
  },

  // rpc command output
  rpc: {
    noRpcs: 'RPC呼び出しがありません。',
  },

  // archive command output
  archive: {
    title: 'アーカイブ状況 & 計画',
    database: 'データベース',
    currentData: '現在のデータ',
    retentionSettings: '保持設定',
    cleanupPlan: 'クリーンアップ計画',
    sessionsToDelete: '削除予定セッション',
    rawToClear: 'クリア予定 raw_json',
    estimatedSavings: '推定削減量',
    runCommand: '実行するには "pfscan archive run --yes" を使用してください。',
  },

  // secrets command output
  secrets: {
    noSecrets: 'シークレットが保存されていません。',
  },

  // catalog command output
  catalog: {
    noResults: 'サーバーが見つかりません。',
    searchResults: '{count} 件のサーバーが見つかりました',
  },

  // runners command output
  runners: {
    title: 'パッケージランナー',
    available: '利用可能',
    notAvailable: '利用不可',
    noRunners: 'ランナーがありません。npm (npx用) または uv (uvx用) をインストールしてください。',
    runnersAvailable: '{count} 件のランナーが利用可能です。',
    diagnostics: 'ランナー診断',
    runnersReady: '{available}/{total} ランナーが準備完了',
    toInstall: 'インストールするには:',
  },

  // plans command output
  plans: {
    noPlans: 'プランがありません。',
    noRuns: '実行履歴がありません。',
    planAdded: 'プラン \'{name}\' を追加しました (digest: {digest}...)',
    planDeleted: 'プラン \'{name}\' を削除しました',
    planNotFound: 'プランが見つかりません: {name}',
    runNotFound: '実行履歴が見つかりません: {id}',
    connectorNotFound: 'コネクタが見つかりません: {id}',
    invalidPlanName: '無効なプラン名です。小文字、数字、ハイフン、アンダースコアのみ使用できます。',
    planExists: 'プラン \'{name}\' は既に存在します。置き換えるには先に \'plans delete\' を実行してください。',
    runWarning: '警告: プラン \'{name}\' には関連する実行履歴があります。',
    useForce: '強制削除するには --force を使用してください (実行履歴はダイジェストで参照を保持します)。',
    running: 'プラン \'{name}\' をコネクタ \'{connector}\' で実行中...',
    runId: '実行ID: {id}',
    status: 'ステータス: {status}',
    duration: '実行時間: {ms}ms',
    steps: 'ステップ:',
    inventory: 'インベントリ:',
    capabilities: 'ケイパビリティ: {list}',
    tools: 'ツール: {count}',
    resources: 'リソース: {count}',
    prompts: 'プロンプト: {count}',
    artifacts: '成果物: {path}',
    imported: '{count} 件のプランをインポートしました: {names}',
    exported: 'プラン \'{name}\' を {file} にエクスポートしました',
    dryRun: {
      plan: 'プラン: {name}',
      connector: 'コネクタ: {id}',
      steps: 'ステップ ({count}):',
    },
  },

  // html export output
  html: {
    exporting: 'HTMLレポートをエクスポート中...',
    exported: '{path} にエクスポートしました',
    opening: 'ブラウザで開いています...',
    redactedNote: '一部の値がマスクされています',
    truncatedPayload: 'ペイロード切り詰め（{size}バイト、先頭4096文字を表示）',
    spillFileWritten: 'フルペイロードを {file} に出力しました',
    connectorExporting: 'コネクタHTMLレポートをエクスポート中 ({count} セッション)...',
    connectorExported: 'コネクタを {path} にエクスポートしました',
    paginationNote: '{total} 中 {from}-{to} を表示',
  },

  // Error messages
  errors: {
    connectorIdRequired: 'コネクタIDが必要です。',
    connectorNotFound: 'コネクタが見つかりません: {id}',
    sessionNotFound: 'セッションが見つかりません: {id}',
    noSessionSpecified: 'セッションが指定されていません。',
    invalidPath: '無効なパス: {path}',
    pathEscapes: 'エクスポートパスがカレントディレクトリ外を指しています。',
    useAbsolutePath: '絶対パスまたはカレントディレクトリ内のパスを使用してください。',
    parentDirNotExist: '親ディレクトリが存在しません: {path}',
    fileOverwrite: 'ファイル \'{file}\' は既に存在します。上書きします...',
    shellRequiresTty: 'シェルは対話型ターミナル（TTY）が必要です',
    shellNonInteractive: 'シェルコマンドは非対話モードでは使用できません。',
    outputRedirected: '出力がリダイレクトされています。個別のコマンドを使用してください。',
    clipboardEmpty: 'クリップボードが空です',
    clipboardReadFailed: 'クリップボードの読み取りに失敗しました: {error}',
    invalidJson: '無効なJSON: {error}',
    noConnectorInClipboard: 'クリップボードにコネクタ定義が見つかりません',
    multipleConnectorsInClipboard: '複数のコネクタが見つかりました ({count} 件)。代わりに \'connectors import --clip\' を使用してください。',
    unsupportedTransport: 'サポートされていないトランスポートタイプ: {type}。stdio のみサポートされています。',
    unsafeChars: 'コマンドに安全でない文字が含まれています: {chars}',
    reviewClipboard: 'クリップボードの内容を確認してから追加してください。',
    unsafeArgsChars: '引数に安全でない文字が含まれています: {chars}',
    invalidEmbedMaxBytes: '無効な embed-max-bytes 値: {value}。正の数を指定してください。',
    createDirFailed: 'ディレクトリの作成に失敗しました {path}: {error}',
    writeFileFailed: 'ファイルの書き込みに失敗しました {path}: {error}',
    openBrowserFailed: 'ブラウザを開けませんでした。手動で開いてください: {path}',
  },

  // Hints and guidance
  hints: {
    tryOneOf: '以下のいずれかを試してください:',
    usage: '使用方法:',
    examples: '例:',
    toListConnectors: '利用可能なコネクタを一覧表示するには:',
    useInsteadOf: '代わりに個別のコマンドを使用してください:',
    troubleshooting: 'トラブルシューティング:',
  },

  // registry command output
  registry: {
    searchTitle: 'レジストリ検索:',
    listTitle: '登録済みコネクタ:',
    noConnectors: 'コネクタが見つかりません。',
    noResults: '一致するコネクタがありません',
    enabled: '有効',
    disabled: '無効',
    type: 'タイプ',
    found: '結果:',
    connectors: '件',
    tipSearch: 'ヒント: 別の検索語を試してください',
    tipEnable: 'ヒント: pfscan connectors enable --id <connector> で有効化',
    tipDisable: 'ヒント: pfscan connectors disable --id <connector> で無効化',
    conflictingFlags: '--enabled と --disabled は同時に使用できません',
  },
};
