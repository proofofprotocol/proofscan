# proofscan Architecture

Internal design documentation for proofscan developers and contributors.

## Overview

proofscan is a CLI tool and library for capturing, storing, and analyzing MCP (Model Context Protocol) server communication. It uses a modular architecture with clear separation between:

- **CLI Layer** - Command parsing and user interaction
- **Core Services** - Scanning, proxy, monitoring
- **Data Layer** - SQLite storage with EventLine model
- **Transport Layer** - stdio, HTTP, SSE communication

## Directory Structure

```
src/
├── cli.ts              # Main CLI entry point
├── cli-shell.ts        # Shell mode entry point
├── index.ts            # Library exports
├── analyzers/          # Analysis modules
├── commands/           # CLI command implementations
├── config/             # Configuration management
├── db/                 # Database layer
├── eventline/          # EventLine data model
├── filter/             # Query filters
├── help/               # Help text generation
├── html/               # HTML export templates
├── i18n/               # Internationalization
├── monitor/            # Web monitor server
├── plans/              # Validation plans
├── popl/               # Proof ledger
├── protocols/          # MCP protocol definitions
├── proxy/              # MCP proxy server
├── registry/           # MCP catalog registry
├── runners/            # Package runners (npx, uvx)
├── scanner/            # Core scanner
├── secrets/            # Secret management
├── shell/              # Interactive shell
├── tools/              # Tool utilities
├── transports/         # Transport implementations
├── types/              # TypeScript type definitions
└── utils/              # Shared utilities
```

## Data Model (EventLine)

proofscan uses the "EventLine" data model for structured storage of MCP communication.

### Database Schema

Two SQLite databases with distinct purposes:

#### events.db (Purgeable)

Session data that can be archived/pruned:

```sql
-- Sessions table
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,         -- ULID
  connector_id TEXT NOT NULL,
  started_at TEXT NOT NULL,    -- ISO 8601
  ended_at TEXT,
  exit_code INTEGER,
  exit_reason TEXT             -- 'success'|'error'|'timeout'|'unknown'
);

-- RPC calls (request-response pairs)
CREATE TABLE rpc_calls (
  id INTEGER NOT NULL,         -- JSON-RPC id
  session_id TEXT NOT NULL,
  method TEXT NOT NULL,
  request_at TEXT NOT NULL,
  response_at TEXT,
  latency_ms INTEGER,
  error_code INTEGER,
  error_message TEXT,
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Individual events
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  rpc_id INTEGER,
  direction TEXT NOT NULL,     -- 'client_to_server'|'server_to_client'
  kind TEXT NOT NULL,          -- 'request'|'response'|'notification'|'transport_event'
  method TEXT,
  raw_json TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes for common queries
CREATE INDEX idx_sessions_connector ON sessions(connector_id);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_rpc_session ON rpc_calls(session_id);
```

#### proofs.db (Immutable)

Proof records that should never be deleted:

```sql
-- Proofs table (POPL)
CREATE TABLE proofs (
  id TEXT PRIMARY KEY,         -- YYYYMMDD-sessionPrefix
  session_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  yaml_content TEXT NOT NULL
);

CREATE INDEX idx_proofs_session ON proofs(session_id);
```

### Entity Relationships

```
Connector (config)
    │
    └── Session (1:N)
            │
            ├── RpcCall (1:N)
            │       │
            │       └── Events (1:N, via rpc_id)
            │
            └── Events (1:N, standalone notifications/transport)
                    │
                    └── Proof (N:1 via session_id)
```

## Component Details

### Scanner

The scanner orchestrates MCP server communication:

```typescript
// src/scanner/index.ts
class Scanner {
  constructor(config: Config) {}
  
  async scan(connectorId: string, options?: ScanOptions): Promise<ScanResult> {
    // 1. Create session
    // 2. Start transport
    // 3. Send initialize request
    // 4. Receive capabilities
    // 5. Send tools/list
    // 6. Collect tool information
    // 7. Close transport
    // 8. Return results
  }
}
```

### Transport Layer

Transports handle the actual communication with MCP servers:

```typescript
// src/transports/stdio.ts
class StdioConnection {
  async start(): Promise<void>;
  async send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  async close(): Promise<void>;
}
```

Supported transports:
- **stdio** - Process spawning with stdin/stdout communication
- **http** - HTTP POST for JSON-RPC
- **sse** - Server-Sent Events for streaming

### Proxy Server

The MCP proxy aggregates multiple backends:

```typescript
// src/proxy/server.ts
class ProxyServer {
  constructor(config: Config, options: ProxyOptions) {}
  
  // Handles incoming JSON-RPC and routes to backends
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  
  // Tool namespace: connector_id__tool_name
  private namespaceTools(connectorId: string, tools: Tool[]): Tool[];
}
```

### Web Monitor

Real-time web dashboard for monitoring:

```typescript
// src/monitor/server.ts
class MonitorServer {
  constructor(eventsStore: EventsStore, proofsStore: ProofsStore) {}
  
  // Hono-based HTTP server
  start(port: number): Promise<void>;
  
  // API endpoints
  // GET /api/connectors
  // GET /api/sessions/:id
  // GET /api/rpc/:session/:id
  // GET /api/popl
  // GET /api/monitor/summary
}
```

### Shell Module

Interactive REPL with context awareness:

```typescript
// src/shell/index.ts
class Shell {
  // Context stack: connector → session
  context: ShellContext;
  
  // @references for saved objects
  references: Map<string, Reference>;
  
  // Tab completion
  complete(input: string): string[];
  
  // Execute command
  execute(command: string): Promise<void>;
}
```

### POPL (Proof Ledger)

Public Observable Proof Ledger for audit trails:

```typescript
// src/popl/index.ts
class PoplGenerator {
  // Generate YAML proof from session
  generate(sessionId: string, options: PoplOptions): string;
  
  // Sanitize sensitive data
  sanitize(content: string): string;
}
```

## Configuration Flow

```
User Input → ConfigManager → Validate → Load/Save
                 │
                 ├── resolveConfigPath()  # OS-specific paths
                 ├── parseConfig()        # JSON parsing
                 ├── validateConfig()     # Schema validation
                 └── save()               # Atomic write
```

## Command Flow

```
CLI Input → Commander → Command Handler → Service → Output
               │              │              │
               │              │              ├── EventsStore
               │              │              ├── ProofsStore
               │              │              └── ConfigManager
               │              │
               │              └── setOutputOptions() → JSON/human format
               │
               └── Global options: --config, --json, --verbose
```

## Error Handling Strategy

1. **User Errors** - Clear message with suggested fix
2. **Config Errors** - Validation errors with line numbers
3. **Network Errors** - Retry with timeout, clear failure message
4. **Database Errors** - Graceful degradation, doctor command for repair

## Testing Strategy

```bash
npm test          # Run all tests
npm test -- -t "scanner"  # Run specific tests
```

Test files are co-located with source:
- `src/commands/catalog.test.ts`
- `src/commands/record.test.ts`
- etc.

## Build & Distribution

```bash
npm run build     # TypeScript → dist/
npm run dev       # Watch mode
npm test          # Vitest tests
npm run lint      # ESLint
```

Entry points:
- `dist/cli.js` → `pfscan`, `proofscan`, `pfs`
- `dist/cli-shell.js` → `psh`
- `dist/index.js` → Library import

## Extension Points

### Adding a New Command

1. Create `src/commands/mycommand.ts`
2. Export `createMyCommand()` factory
3. Add to `src/commands/index.ts`
4. Register in `src/cli.ts`

### Adding a New Transport

1. Implement transport interface in `src/transports/`
2. Add type to `TransportType`
3. Register in scanner transport factory

### Adding Localization

1. Add strings to `src/i18n/locales/`
2. Use `t('key')` for translations
3. See `docs/i18n.md` for details

## Performance Considerations

- **SQLite WAL mode** for concurrent reads
- **Streaming** for large event exports
- **Pagination** for list operations
- **Indexes** on frequently queried columns

## Security Model

- **Secrets** stored encrypted with user-provided key
- **POPL sanitization** removes sensitive data by default
- **No network calls** except to configured MCP servers
- **Local-only** by default (proxy, monitor bind to localhost)

## See Also

- [API Documentation](./API.md) - Programmatic API
- [User Guide](./GUIDE.md) - CLI reference
- [Contributing](../CONTRIBUTING.md) - Development guidelines
