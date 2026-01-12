/**
 * English locale (source of truth)
 *
 * This is the primary locale file. All keys should be defined here first.
 * Other locales (ja.ts) should mirror this structure.
 */

export const en = {
  // Common labels
  common: {
    yes: 'Yes',
    no: 'No',
    none: '(none)',
    error: 'Error',
    warning: 'Warning',
    hint: 'hint',
    times: '{count} times',
    items: '{count} items',
    total: 'Total',
    ok: 'OK',
    err: 'ERR',
    pending: 'pending',
  },

  // Operation categories (used by analyze, summary, record)
  category: {
    read: 'Read',
    write: 'Write',
    network: 'Network',
    exec: 'Exec',
    other: 'Other',
  },

  // analyze command output
  analyze: {
    title: 'proofscan Analysis',
    titleConnector: 'proofscan Analysis: {connector}',
    titleSession: 'proofscan Session Analysis',
    period: 'Period: {from} ~ {to}',
    periodWithSessions: 'Period: {from} ~ {to} ({count} sessions)',
    overview: 'Overview',
    connectors: 'Connectors',
    sessions: 'Sessions',
    rpcCalls: 'RPC calls',
    byConnector: 'By Connector',
    methods: 'Methods',
    toolsCalled: 'Tools Called (across all sessions)',
    availableTools: 'Available Tools (from latest tools/list)',
    toolUsage: 'Tool Usage (across {count} sessions)',
    byCategory: 'By Category',
    calls: '{count} calls',
    call: '{count} call',
    section: {
      header: '[{label}]',
    },
    permission: {
      label: 'Permission',
      allowed: 'Allowed',
      denied: 'Denied',
    },
    usage: {
      label: 'Usage',
      count: '{count} times',
    },
    total: '{allowed} tools allowed, {count} calls',
    notAllowed: '(not allowed)',
    noData: 'No data found.',
    noSessions: 'No sessions found.',
    noTools: 'No tools found.',
  },

  // summary command output
  summary: {
    title: 'Session Summary',
    section: {
      capability: 'Capabilities',
      toolCall: 'Tool Calls',
      notes: 'Notes',
    },
    capability: {
      count: '{count} types',
    },
    toolCall: {
      count: '{count} calls',
    },
    notes: {
      execCalled: 'Command execution was performed',
      execCapable: 'Command execution tools are available',
      writeCalled: 'Write operations were performed',
      networkCalled: 'External network connections were made',
      noSensitive: 'No sensitive operations (write/network/exec) were performed',
    },
  },

  // record command output
  record: {
    type: {
      toolCall: 'Tool Call',
      capabilityCatalog: 'Capability Catalog',
    },
    noCandidates: 'No candidates',
    candidateCount: 'Candidates: {count}',
    tools: '{count} tools',
  },

  // status command output
  status: {
    title: 'proofscan Status',
    configuration: 'Configuration',
    database: 'Database',
    dataSummary: 'Data Summary',
    connectors: 'Connectors',
    quickCommands: 'Quick Commands',
    noDataYet: 'No data yet. Initialize and run a scan:',
  },

  // doctor command output
  doctor: {
    title: 'proofscan Doctor',
    paths: 'Paths',
    config: 'Config',
    dataDir: 'Data dir',
    eventsDb: 'events.db',
    proofsDb: 'proofs.db',
    eventsDatabase: 'Events Database',
    exists: 'Exists',
    readable: 'Readable',
    version: 'Version',
    tables: 'Tables',
    missingTables: 'Missing Tables',
    missingColumns: 'Missing Columns',
    allPresent: 'All required tables and columns present',
    noFixesNeeded: 'No fixes needed.',
    runWithFix: 'Run with --fix to attempt repair:',
    dbNotExist: 'Database does not exist yet. Run a scan to create it:',
    tryBackup: 'Try backing up and recreating:',
  },

  // view command output
  view: {
    noEvents: 'No events found.',
    noEventsHint: 'hint: Run a scan first: pfscan scan start --id <connector>',
    noPairs: 'No RPC pairs found.',
    pairsHint: '(use: pfscan rpc show --session <ses> --id <rpc> for details)',
    pairsSummary: '{total} pairs: {ok} OK, {err} ERR, {pending} pending',
    noExportEvents: 'No events to export.',
    exportSuccess: 'Exported {count} events to {file} ({format})',
    followHeader: 'Events{info} (following, Ctrl+C to stop):',
    followStopped: 'Stopped following.',
    tableHeader: 'Time         Sym Dir St Method                         Connector    Session      Extra',
  },

  // scan command output
  scan: {
    scanning: 'Scanning connector: {id}...',
    scanningDryRun: '[DRY RUN] Scanning connector: {id}...',
    scanComplete: 'Scan complete',
    scanFailed: 'Scan failed: {error}',
    nextSteps: 'Next steps:',
  },

  // connectors command output
  connectors: {
    noConnectors: 'No connectors configured.',
    headerId: 'ID',
    headerEnabled: 'Enabled',
    headerType: 'Type',
    headerCommand: 'Command/URL',
    added: 'Connector \'{id}\' added successfully.',
    enabled: 'Connector \'{id}\' enabled.',
    disabled: 'Connector \'{id}\' disabled.',
    deleted: 'Connector \'{id}\' deleted.',
    imported: 'Imported {count} connector(s).',
  },

  // sessions command output
  sessions: {
    noSessions: 'No sessions found.',
  },

  // tree command output
  tree: {
    noData: 'No data found.',
    noDataHint: 'hint: Run a scan first: pfscan scan start --id <connector>',
    summary: '{connectors} connector(s), {sessions} session(s), {rpcs} rpc(s)',
  },

  // rpc command output
  rpc: {
    noRpcs: 'No RPC calls found.',
  },

  // archive command output
  archive: {
    title: 'Archive Status & Plan',
    database: 'Database',
    currentData: 'Current Data',
    retentionSettings: 'Retention Settings',
    cleanupPlan: 'Cleanup Plan',
    sessionsToDelete: 'Sessions to delete',
    rawToClear: 'raw_json to clear',
    estimatedSavings: 'Estimated savings',
    runCommand: 'Run "pfscan archive run --yes" to execute.',
  },

  // secrets command output
  secrets: {
    noSecrets: 'No secrets stored.',
  },

  // catalog command output
  catalog: {
    noResults: 'No servers found.',
    searchResults: 'Found {count} server(s)',
  },

  // runners command output
  runners: {
    title: 'Package Runners',
    available: 'available',
    notAvailable: 'not available',
    noRunners: 'No runners available. Install npm (for npx) or uv (for uvx).',
    runnersAvailable: '{count} runner(s) available.',
    diagnostics: 'Runner Diagnostics',
    runnersReady: '{available}/{total} runner(s) ready',
    toInstall: 'To install:',
  },

  // plans command output
  plans: {
    noPlans: 'No plans found.',
    noRuns: 'No runs found.',
    planAdded: 'Plan \'{name}\' added (digest: {digest}...)',
    planDeleted: 'Plan \'{name}\' deleted',
    planNotFound: 'Plan not found: {name}',
    runNotFound: 'Run not found: {id}',
    connectorNotFound: 'Connector not found: {id}',
    invalidPlanName: 'Invalid plan name. Use lowercase letters, numbers, hyphens, and underscores only.',
    planExists: 'Plan \'{name}\' already exists. Use \'plans delete\' first to replace.',
    runWarning: 'Warning: Plan \'{name}\' has associated runs.',
    useForce: 'Use --force to delete anyway (runs will keep reference by digest).',
    running: 'Running plan \'{name}\' against connector \'{connector}\'...',
    runId: 'Run ID: {id}',
    status: 'Status: {status}',
    duration: 'Duration: {ms}ms',
    steps: 'Steps:',
    inventory: 'Inventory:',
    capabilities: 'Capabilities: {list}',
    tools: 'Tools: {count}',
    resources: 'Resources: {count}',
    prompts: 'Prompts: {count}',
    artifacts: 'Artifacts: {path}',
    imported: 'Imported {count} plan(s): {names}',
    exported: 'Plan \'{name}\' exported to {file}',
    dryRun: {
      plan: 'Plan: {name}',
      connector: 'Connector: {id}',
      steps: 'Steps ({count}):',
    },
  },

  // Error messages
  errors: {
    connectorIdRequired: 'Connector ID is required.',
    connectorNotFound: 'Connector not found: {id}',
    sessionNotFound: 'Session not found: {id}',
    noSessionSpecified: 'No session specified or resolved.',
    invalidPath: 'Invalid path: {path}',
    pathEscapes: 'Export path escapes current directory.',
    useAbsolutePath: 'Use an absolute path or a path within the current directory.',
    parentDirNotExist: 'Parent directory does not exist: {path}',
    fileOverwrite: 'File \'{file}\' already exists. Overwriting...',
    shellRequiresTty: 'Shell requires an interactive terminal (TTY)',
    shellNonInteractive: 'The shell command cannot be used in non-interactive mode.',
    outputRedirected: 'Output is being redirected. Use individual commands instead.',
    clipboardEmpty: 'Clipboard is empty',
    clipboardReadFailed: 'Failed to read clipboard: {error}',
    invalidJson: 'Invalid JSON: {error}',
    noConnectorInClipboard: 'No connector definition found in clipboard',
    multipleConnectorsInClipboard: 'Multiple connectors found ({count}). Use \'connectors import --clip\' instead.',
    unsupportedTransport: 'Unsupported transport type: {type}. Only stdio is supported.',
    unsafeChars: 'Command contains potentially unsafe characters: {chars}',
    reviewClipboard: 'Please review the clipboard content before adding.',
    unsafeArgsChars: 'Arguments contain potentially unsafe characters: {chars}',
  },

  // Hints and guidance
  hints: {
    tryOneOf: 'Try one of:',
    usage: 'Usage:',
    examples: 'Examples:',
    toListConnectors: 'To list available connectors:',
    useInsteadOf: 'Use individual commands instead, e.g:',
    troubleshooting: 'Troubleshooting:',
  },
} as const;

/**
 * Deep string type - allows nested objects with string values
 * Used for locale messages where translations have different string values
 */
export type DeepStringRecord = {
  [key: string]: string | string[] | DeepStringRecord;
};

/**
 * LocaleMessages type for use by translation files
 * More permissive than typeof en to allow different string values in translations
 */
export type LocaleMessages = DeepStringRecord;
