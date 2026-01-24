# proofscan API Documentation

TypeScript API for programmatic use of proofscan.

## Installation

```bash
npm install proofscan
```

## Quick Start

```typescript
import { Scanner, ConfigManager, EventsStore } from 'proofscan';

// Load configuration
const configManager = new ConfigManager('/path/to/config.json');
const config = await configManager.load();

// Run a scan
const scanner = new Scanner(config);
const result = await scanner.scan('my-connector');

// Query events
const store = new EventsStore('/path/to/events.db');
const sessions = store.listSessions({ connectorId: 'my-connector', limit: 10 });
```

## Core Types

### Configuration Types

```typescript
import type { Config, Connector, Transport, RetentionConfig } from 'proofscan';

// Transport types
type TransportType = 'stdio' | 'http' | 'sse';

interface StdioTransport {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface HttpTransport {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

interface SseTransport {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

type Transport = StdioTransport | HttpTransport | SseTransport;

// Connector configuration
interface Connector {
  id: string;
  enabled: boolean;
  transport: Transport;
  plugins?: ConnectorPlugins;
}

// Main config structure
interface Config {
  version: number;
  connectors: Connector[];
  retention?: RetentionConfig;
}

interface RetentionConfig {
  keep_last_sessions?: number;
  raw_days?: number;
  max_db_mb?: number;
}
```

### Database Types (EventLine Model)

```typescript
import type { Session, RpcCall, Event, Proof } from 'proofscan';

// Exit reasons for sessions
type ExitReason = 'success' | 'error' | 'timeout' | 'unknown';

// Event direction
type EventDirection = 'client_to_server' | 'server_to_client';

// Event kinds
type EventKind = 'request' | 'response' | 'notification' | 'transport_event';

// Session record
interface Session {
  id: string;           // ULID
  connector_id: string;
  started_at: string;   // ISO 8601
  ended_at?: string;    // ISO 8601
  exit_code?: number;
  exit_reason?: ExitReason;
}

// RPC call record (request-response pair)
interface RpcCall {
  id: number;           // JSON-RPC id
  session_id: string;
  method: string;
  request_at: string;
  response_at?: string;
  latency_ms?: number;
  error_code?: number;
  error_message?: string;
}

// Individual event record
interface Event {
  id: number;
  session_id: string;
  rpc_id?: number;
  direction: EventDirection;
  kind: EventKind;
  method?: string;
  raw_json: string;
  logged_at: string;
}

// Proof record (POPL)
interface Proof {
  id: string;           // YYYYMMDD-sessionPrefix
  session_id: string;
  title?: string;
  description?: string;
  created_at: string;
  yaml_content: string;
}
```

## Classes

### ConfigManager

Manage proofscan configuration files.

```typescript
import { ConfigManager } from 'proofscan';

const configManager = new ConfigManager('/path/to/config.json');

// Load configuration
const config = await configManager.load();

// Save configuration
await configManager.save(config);

// Validate configuration
const isValid = configManager.validate(config);
```

### Scanner

Run scans against MCP servers.

```typescript
import { Scanner } from 'proofscan';

const scanner = new Scanner(config);

// Scan a specific connector
const result = await scanner.scan('connector-id', {
  timeout: 30000,  // 30 seconds
  verbose: true
});

// Result structure
interface ScanResult {
  success: boolean;
  sessionId: string;
  duration: number;
  tools?: Tool[];
  error?: string;
}
```

### EventsStore

Query the events database.

```typescript
import { EventsStore } from 'proofscan';

const store = new EventsStore('/path/to/events.db');

// List sessions
const sessions = store.listSessions({
  connectorId: 'my-connector',
  limit: 20,
  offset: 0
});

// Get session details
const session = store.getSession('session-id');

// List RPC calls
const rpcs = store.listRpcCalls('session-id');

// List events
const events = store.listEvents({
  sessionId: 'session-id',
  limit: 100
});

// Close database
store.close();
```

### ProofsStore

Query the proofs database (POPL).

```typescript
import { ProofsStore } from 'proofscan';

const store = new ProofsStore('/path/to/proofs.db');

// List proofs
const proofs = store.listProofs({ limit: 20 });

// Get proof by ID
const proof = store.getProof('20260124-abc123');

// Close database
store.close();
```

### StdioConnection

Low-level stdio transport for MCP communication.

```typescript
import { StdioConnection } from 'proofscan';

const conn = new StdioConnection({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-time']
});

// Start connection
await conn.start();

// Send JSON-RPC request
const response = await conn.send({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
});

// Close connection
await conn.close();
```

## Utility Functions

### Path Resolution

```typescript
import {
  resolveConfigPath,
  getDefaultConfigDir,
  getDefaultConfigPath,
  getEventsDir
} from 'proofscan';

// Get default config directory (OS-specific)
const configDir = getDefaultConfigDir();
// Linux: ~/.config/proofscan
// macOS: ~/Library/Application Support/proofscan
// Windows: %APPDATA%\proofscan

// Get default config file path
const configPath = getDefaultConfigPath();

// Get events directory
const eventsDir = getEventsDir(configDir);

// Resolve config path with optional override
const resolvedPath = resolveConfigPath({ configPath: '/custom/path.json' });
```

### File Operations

```typescript
import {
  atomicWriteFile,
  readFileSafe,
  fileExists,
  appendLine,
  readLastLines
} from 'proofscan';

// Atomic write (safe for concurrent access)
await atomicWriteFile('/path/to/file.json', JSON.stringify(data));

// Safe read (returns null if not found)
const content = await readFileSafe('/path/to/file.json');

// Check file existence
const exists = await fileExists('/path/to/file.json');

// Append line to file
await appendLine('/path/to/log.txt', 'New log entry');

// Read last N lines
const lastLines = await readLastLines('/path/to/log.txt', 10);
```

### Configuration Parsing

```typescript
import { parseConfig, validateConfig, parseMcpServers } from 'proofscan';

// Parse config from JSON string
const config = parseConfig(jsonString);

// Validate config object
const errors = validateConfig(config);
if (errors.length > 0) {
  console.error('Invalid config:', errors);
}

// Parse Claude Desktop mcpServers format
const connectors = parseMcpServers({
  time: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time']
  }
});
```

## Database Access

### Direct Database Connection

```typescript
import { getEventsDb, getProofsDb, closeAllDbs, getDbSizes } from 'proofscan';

// Get database instances
const eventsDb = getEventsDb('/path/to/config');
const proofsDb = getProofsDb('/path/to/config');

// Get database sizes
const sizes = getDbSizes('/path/to/config');
console.log(`Events: ${sizes.events} bytes, Proofs: ${sizes.proofs} bytes`);

// Close all databases
closeAllDbs();
```

## Default Values

```typescript
import { DEFAULT_CONFIG, DEFAULT_RETENTION } from 'proofscan';

// Default configuration
console.log(DEFAULT_CONFIG);
// { version: 1, connectors: [], retention: DEFAULT_RETENTION }

// Default retention settings
console.log(DEFAULT_RETENTION);
// { keep_last_sessions: 50, raw_days: 7, max_db_mb: 500 }
```

## JSON-RPC Types

```typescript
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage
} from 'proofscan';

// Request
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

// Response
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Notification (no id)
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// Union type
type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
```

## Error Handling

All async operations may throw errors. Wrap in try-catch:

```typescript
import { Scanner } from 'proofscan';

try {
  const scanner = new Scanner(config);
  const result = await scanner.scan('my-connector');
} catch (error) {
  if (error instanceof Error) {
    console.error('Scan failed:', error.message);
  }
}
```

## See Also

- [User Guide](./GUIDE.md) - CLI command reference
- [Architecture](./ARCHITECTURE.md) - Internal design
- [Shell Mode](./SHELL.md) - Interactive shell
