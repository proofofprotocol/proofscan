# proofscan

MCP Server scanner - eliminate black boxes by capturing JSON-RPC from connection to tools/list.

## Overview

proofscan provides visibility into MCP (Model Context Protocol) server communication. It:

- Connects to MCP servers via stdio transport
- Captures all JSON-RPC messages (requests, responses, notifications)
- Stores events in SQLite for efficient querying and analysis
- Supports importing server configurations from mcp.so / Claude Desktop format
- Provides intuitive CLI commands for viewing and exploring data

## Installation

```bash
npm install -g proofscan
```

Or run without installing:

```bash
npx proofscan --help
```

## CLI Commands (v0.3.0)

The CLI is available as both `pfscan` (short) and `proofscan` (full).

### Command Structure (git-style)

```
Common Commands:
  view, v       View recent events timeline (default)
  tree, t       Show connector → session → rpc structure
  explore, e    Interactive data browser
  scan, s       Run a new scan
  status, st    Show system status

Management:
  archive, a    Archive and prune old data
  config, c     Configuration management
  connectors    Connector management

Shortcuts:
  v=view  t=tree  e=explore  s=scan  st=status  a=archive  c=config
```

**Note:** Running `pfscan` without arguments is equivalent to `pfscan view`.

## Quickstart

### 1. Initialize Configuration

```bash
pfscan config init
pfscan config path   # Show config location
```

### 2. Import MCP Server

```bash
# From mcp.so / Claude Desktop format
echo '{"mcpServers":{"time":{"command":"uvx","args":["mcp-server-time"]}}}' \
  | pfscan connectors import --from mcpServers --stdin
```

### 3. Scan and View

```bash
pfscan scan start --id time   # Run scan
pfscan                        # View recent events (same as pfscan view)
pfscan tree                   # Show structure
pfscan status                 # Show system status
```

## View Command (Phase 2.1)

The `view` command displays a timeline of recent events with millisecond precision.

```bash
$ pfscan view --limit 10
Time         Sym Dir St Method                         Session      Extra
-------------------------------------------------------------------------
21:01:58.743 → → ✓ initialize                     ses=f2442c... lat=269ms size=183B
21:01:59.018 ← ← ✓ initialize                     ses=f2442c...
21:01:59.025 • →   notifications/initialized      ses=f2442c...
21:01:59.037 → → ✓ tools/list                     ses=f2442c...
21:01:59.049 ← ← ✓ tools/list                     ses=f2442c... lat=12ms size=1.0KB
```

### View Options

```bash
pfscan view --limit 50           # Show 50 events
pfscan view --since 24h          # Events in last 24 hours
pfscan view --since 7d           # Events in last 7 days
pfscan view --errors             # Show only errors
pfscan view --method tools       # Filter by method name
pfscan view --connector time     # Filter by connector
pfscan view --session abc123     # Filter by session (partial match)
pfscan view --fulltime           # Show full timestamp (YYYY-MM-DD HH:MM:SS.mmm)
pfscan view --with-sessions      # Include session start/end events
pfscan view --json               # Output as JSON (EventLine array)
```

### Event Symbols

| Symbol | Meaning |
|--------|---------|
| ▶ | Session start |
| ■ | Session end |
| → | Request (Client → Server) |
| ← | Response (Server → Client) |
| • | Notification |
| ✖ | Error |

## Tree Command (Phase 2.1)

The `tree` command shows a hierarchical view of connector → session → rpc.

```bash
$ pfscan tree
└── 📦 time
    ├── 📋 f2442c9b... (2 rpcs, 8 events)
    │   ├── ↔️ ✓ tools/list (id=2, 12ms)
    │   └── ↔️ ✓ initialize (id=1, 269ms)
    └── 📋 3cf5a66e... (2 rpcs, 8 events)
        ├── ↔️ ✓ tools/list (id=2, 13ms)
        └── ↔️ ✓ initialize (id=1, 271ms)

1 connector(s), 2 session(s), 4 rpc(s)
```

### Tree Options

```bash
pfscan tree time              # Show specific connector
pfscan tree --sessions 10     # Show 10 sessions per connector
pfscan tree --rpc 20          # Show 20 RPCs per session
pfscan tree --rpc-all         # Show all RPCs
pfscan tree --method init     # Filter by method name
pfscan tree --status ok       # Filter by status (ok, err, all)
pfscan tree --compact         # Compact output (no icons)
pfscan tree --since 24h       # Filter by time
pfscan tree --json            # Output as JSON (TreeNode array)
```

## Explore Command (Phase 2.1)

The `explore` command provides interactive navigation through data.

```bash
$ pfscan explore
═══════════════════════════════════════════════════════════════
  proofscan explore
═══════════════════════════════════════════════════════════════
  Path: connectors
───────────────────────────────────────────────────────────────

  Connectors:

    [1] time (3 sessions)

  > 1
```

### Explore Navigation

- **Number**: Select item
- **b**: Go back
- **t**: Show tree view
- **?**: Help
- **q**: Quit
- **p**: View request/response pair (in RPC view)

```bash
pfscan explore                    # Start from connectors
pfscan explore --session abc123   # Jump to specific session
```

## Status Command (Phase 2.1)

The `status` command shows database and system status.

```bash
$ pfscan status
proofscan Status
═════════════════════════════════════════════════════

Configuration:
  Config file:  /home/user/.config/proofscan/config.json
  Data dir:     /home/user/.config/proofscan

Database:
  events.db:    72.0KB
  proofs.db:    24.0KB
  Schema ver:   1
  Tables:       sessions, rpc_calls, events

Data Summary:
  Connectors:   1
  Sessions:     3
  RPC calls:    6
  Events:       24
  Latest:       2025-12-28T12:01:58.610Z
```

## Global Options

```
-c, --config <path>  Path to config file
--json               Output in JSON format
-v, --verbose        Verbose output
```

## Config File Format

Config is stored in the OS-standard location:

- **Windows**: `%APPDATA%\proofscan\config.json`
- **macOS**: `~/Library/Application Support/proofscan/config.json`
- **Linux**: `~/.config/proofscan/config.json`

```json
{
  "version": 1,
  "connectors": [
    {
      "id": "time",
      "enabled": true,
      "transport": {
        "type": "stdio",
        "command": "uvx",
        "args": ["mcp-server-time"]
      }
    }
  ],
  "retention": {
    "keep_last_sessions": 50,
    "raw_days": 7,
    "max_db_mb": 500
  }
}
```

### Retention Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `keep_last_sessions` | 50 | Keep last N sessions per connector |
| `raw_days` | 7 | Clear raw JSON after N days |
| `max_db_mb` | 500 | Target database size limit |

## Data Storage

proofscan uses a 2-file SQLite structure:

```
~/.config/proofscan/
├── config.json
├── events.db     # Sessions, events, RPC calls (can be pruned)
└── proofs.db     # Immutable proof records (never pruned)
```

### EventLine Model (Phase 2.1)

Internally, all events are normalized to the `EventLine` format:

```typescript
interface EventLine {
  ts_ms: number;           // Timestamp (epoch ms)
  kind: 'session_start' | 'session_end' | 'req' | 'res' | 'notify' | 'error';
  direction?: '→' | '←';  // → = Client→Server, ← = Server→Client
  label: string;           // Method name or event type
  connector_id?: string;
  session_id?: string;
  rpc_id?: string | number;
  status: 'OK' | 'ERR' | '-';
  latency_ms?: number;
  size_bytes?: number;
  raw_json?: string;
  meta?: Record<string, unknown>;
}
```

This normalized model allows the schema to evolve without breaking the CLI.

## Archive Command

Archive and prune old data based on retention settings.

```bash
pfscan archive status               # Show database status
pfscan archive plan                 # Show what would be archived
pfscan archive run                  # Dry run
pfscan archive run --yes            # Actually execute
pfscan archive run --yes --vacuum   # Execute and reclaim space
```

## JSON Output

All commands support `--json` for machine-readable output:

```bash
$ pfscan view --json --limit 3
[
  {
    "ts_ms": 1766923317974,
    "kind": "req",
    "direction": "→",
    "label": "tools/list",
    "connector_id": "time",
    "session_id": "3cf5a66e-...",
    "rpc_id": "2",
    "status": "OK",
    "size_bytes": 58
  },
  ...
]

$ pfscan tree --json
[
  {
    "type": "connector",
    "id": "time",
    "label": "time",
    "meta": { "session_count": 3 },
    "children": [...]
  }
]
```

## Connector Management

```bash
pfscan connectors list                        # List all
pfscan connectors show --id <id>              # Show details
pfscan connectors add --id <id> --stdio "cmd" # Add connector
pfscan connectors enable --id <id>            # Enable
pfscan connectors disable --id <id>           # Disable
pfscan connectors remove --id <id>            # Remove

# Import from mcpServers format
pfscan connectors import --from mcpServers --stdin
pfscan connectors import --from mcpServers --file <path>
```

## Session Management

```bash
pfscan sessions list [--connector <id>] [--last <N>]
pfscan sessions show --id <session_id>
pfscan sessions prune [--before <date>] [--keep-last <N>] [--yes]
```

## Development

```bash
npm install         # Install dependencies
npm run build       # Build TypeScript
npm run dev         # Watch mode
npm test            # Run tests
```

## License

MIT
