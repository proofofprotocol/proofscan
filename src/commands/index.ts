// Existing commands
export * from './config.js';
export * from './connectors.js';
export * from './scan.js';
export * from './sessions.js';
export * from './archive.js';

// Phase 2.1 new commands (view now includes monitor/events functionality)
export * from './view.js';
export * from './tree.js';
export * from './status.js';

// Phase 2.2 new commands
export * from './rpc.js';

// Phase 3 new commands
export * from './summary.js';
export * from './record.js';
export * from './doctor.js';

// Command consolidation: analyze replaces permissions
export * from './analyze.js';

// Phase 4: Shell REPL
export * from './shell.js';

// Phase 3.6: Secrets management
export * from './secrets.js';

// Phase 4.4: Tool CLI commands
export * from './tool.js';

// Phase 5.0: MCP Proxy
export * from './proxy.js';

// Phase 5.0+: Log viewing
export * from './log.js';

// Phase 6.0: POPL (Public Observable Proof Ledger)
export * from './popl.js';

// Phase 7.0: Catalog (MCP Registry)
export * from './catalog.js';

// Phase 7.x: Package Runners
export * from './runners.js';
