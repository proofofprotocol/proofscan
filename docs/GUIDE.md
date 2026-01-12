# proofscan User Guide

Complete command reference for proofscan CLI. For interactive shell mode, see [Shell Mode Guide](SHELL.md).

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [View Commands](#view-commands)
- [Tree Command](#tree-command)
- [Explore Command](#explore-command)
- [Scan Commands](#scan-commands)
- [RPC Commands](#rpc-commands)
- [Status Command](#status-command)
- [Connector Management](#connector-management)
- [Session Management](#session-management)
- [Archive Commands](#archive-commands)
- [Secret Management](#secret-management)
- [Tool Commands](#tool-commands)
- [Plans Commands](#plans-commands)
- [Doctor Command](#doctor-command)
- [Summary and Permissions](#summary-and-permissions)
- [Events Export](#events-export)
- [Global Options](#global-options)

## Installation

```bash
# Global installation
npm install -g proofscan

# Or use without installing
npx proofscan --help

# Check version
pfscan --version
```

**Requirements:** Node.js v18+ (v20+ recommended)

## Configuration

### Initialize Configuration

```bash
pfscan config init
# Creates config file in OS-standard location
```

### Show Configuration Path

```bash
pfscan config path
# Linux: ~/.config/proofscan/config.json
# macOS: ~/Library/Application Support/proofscan/config.json
# Windows: %APPDATA%\proofscan\config.json
```

### Edit Configuration

```bash
pfscan config edit    # Opens in default editor
```

### Show Configuration

```bash
pfscan config show              # Human-readable
pfscan config show --json       # JSON format
```

### Configuration Structure

```json
{
  "version": 1,
  "connectors": [
    {
      "id": "time",
      "enabled": true,
      "transport": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-time"]
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

## View Commands

The `view` command displays a timeline of recent events.

### Basic Usage

```bash
pfscan view              # Show recent events (default: 20)
pfscan                   # Same as above (view is default command)
pfscan v                 # Short alias
```

### Options

```bash
pfscan view --limit 50               # Show 50 events
pfscan view --since 24h              # Events in last 24 hours
pfscan view --since 7d               # Events in last 7 days
pfscan view --errors                 # Show only errors
pfscan view --method tools           # Filter by method name
pfscan view --connector time         # Filter by connector
pfscan view --session abc123         # Filter by session (partial match)
pfscan view --fulltime               # Show full timestamp
pfscan view --with-sessions          # Include session start/end events
pfscan view --pairs                  # Show request/response pairs
pfscan view --json                   # Output as JSON
```

### Output Format

```
Time         Sym Dir St Method              Session      Extra
-------------------------------------------------------------------
21:01:58.743 → → ✓ initialize            f2442c... lat=269ms
21:01:59.018 ← ← ✓ initialize            f2442c...
21:01:59.025 • →   notifications/initi... f2442c...
21:01:59.037 → → ✓ tools/list            f2442c...
21:01:59.049 ← ← ✓ tools/list            f2442c... lat=12ms size=1.0KB
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

### Examples

```bash
# View last hour's events
pfscan view --since 1h --limit 100

# View only errors
pfscan view --errors --fulltime

# View specific connector's recent activity
pfscan view --connector time --limit 30

# Export to JSON
pfscan view --limit 1000 --json > events.json
```

## Tree Command

The `tree` command shows hierarchical connector → session → RPC structure.

### Basic Usage

```bash
pfscan tree              # Show all connectors
pfscan tree time         # Show specific connector
pfscan t                 # Short alias
```

### Options

```bash
pfscan tree --sessions 10           # Show 10 sessions per connector
pfscan tree --rpc 20                # Show 20 RPCs per session
pfscan tree --rpc-all               # Show all RPCs
pfscan tree --method init           # Filter by method name
pfscan tree --status ok             # Filter by status (ok, err, all)
pfscan tree --compact               # Compact output (no icons)
pfscan tree --since 24h             # Filter by time
pfscan tree --json                  # Output as JSON
```

### Output Format

```
└── 📦 time
    ├── 📋 f2442c9b... (2 rpcs, 8 events)
    │   ├── ↔️ ✓ tools/list (id=2, 12ms)
    │   └── ↔️ ✓ initialize (id=1, 269ms)
    └── 📋 3cf5a66e... (2 rpcs, 8 events)
        ├── ↔️ ✓ tools/list (id=2, 13ms)
        └── ↔️ ✓ initialize (id=1, 271ms)

1 connector(s), 2 session(s), 4 rpc(s)
```

### Examples

```bash
# Show detailed tree for specific connector
pfscan tree time --rpc-all

# Show only failed RPCs
pfscan tree --status err

# Compact view for scripting
pfscan tree --compact --json
```

## Explore Command

Interactive data browser with navigation.

### Basic Usage

```bash
pfscan explore                    # Start from connectors
pfscan explore --session abc123   # Jump to specific session
pfscan e                          # Short alias
```

### Navigation

- **Number**: Select item
- **b**: Go back
- **t**: Show tree view
- **p**: View request/response pair (in RPC view)
- **?**: Help
- **q**: Quit

### Example Session

```
═══════════════════════════════════════════════════════════════
  proofscan explore
═══════════════════════════════════════════════════════════════
  Path: connectors
───────────────────────────────────────────────────────────────

  Connectors:

    [1] time (3 sessions)
    [2] weather (1 session)

  > 1
```

## Scan Commands

Run scans against MCP servers.

### Start Scan

```bash
pfscan scan start --id <connector>     # Start scan
pfscan s start --id time               # Using alias
```

### Monitor Scan

```bash
pfscan monitor                         # Monitor in real-time
```

### Scan Options

```bash
pfscan scan start --id time --timeout 60    # Custom timeout (seconds)
```

## RPC Commands

View detailed RPC call information.

### List RPCs for a Session

```bash
pfscan rpc list --session <session-id>
pfscan rpc list --session f2442c         # Partial ID works
pfscan rpc list --session abc123 --limit 50
pfscan rpc list --session abc123 --fulltime
pfscan rpc list --session abc123 --json
```

**Output:**
```
Time         St RPC      Method                         Latency
----------------------------------------------------------------
21:01:59.037 ✓ 2        tools/list                     12ms
21:01:58.743 ✓ 1        initialize                     269ms

2 RPCs: 2 OK, 0 ERR, 0 pending
hint: Use `pfscan rpc show --session <ses> --id <rpc>` for details
```

### Show RPC Details

```bash
pfscan rpc show --session <session-id> --id <rpc-id>
pfscan rpc show --session f2442c --id 2
pfscan rpc show --session abc --id 1 --json
```

**Output:**
```
════════════════════════════════════════════════════════════
RPC: tools/list
════════════════════════════════════════════════════════════

Info:
  RPC ID:      2
  Session:     f2442c9b...
  Connector:   time
  Status:      OK

Timing:
  Request:     2026-01-04T12:01:59.037Z
  Response:    2026-01-04T12:01:59.049Z
  Latency:     12ms

Size:
  Request:     58B
  Response:    1.0KB

────────────────────────────────────────────────────────────
Request:
────────────────────────────────────────────────────────────
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}

────────────────────────────────────────────────────────────
Response:
────────────────────────────────────────────────────────────
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [...]
  }
}
```

## Status Command

Show database and system status.

```bash
pfscan status
pfscan st              # Short alias
```

**Output:**
```
proofscan Status
═════════════════════════════════════════════════════

Configuration:
  Config file:  ~/.config/proofscan/config.json
  Data dir:     ~/.config/proofscan

Database:
  events.db:    72.0KB
  proofs.db:    24.0KB
  Schema ver:   1
  Tables:       sessions, rpc_calls, events

Data Summary:
  Connectors:   3
  Sessions:     10
  RPC calls:    24
  Events:       96
  Latest:       2026-01-04T12:01:58.610Z
```

## Connector Management

### List Connectors

```bash
pfscan connectors list
pfscan connectors list --json
```

**Output:**
```
Connectors:
  time       ✓ enabled   stdio  npx -y @modelcontextprotocol/server-time
  weather    ✓ enabled   stdio  npx -y mcp-server-weather
  inscribe   ✗ disabled  stdio  npx -y @proofofprotocol/inscribe-mcp-server
```

### Show Connector Details

```bash
pfscan connectors show --id <connector>
pfscan connectors show --id time
pfscan connectors show --id time --json
```

### Add Connector

```bash
# stdio transport
pfscan connectors add --id myserver --stdio "npx -y mcp-server"

# With custom args
pfscan connectors add --id myserver --stdio "uvx mcp-server --port 3000"
```

### Enable/Disable Connector

```bash
pfscan connectors enable --id time
pfscan connectors disable --id time
```

### Remove Connector

```bash
pfscan connectors remove --id time
```

### Import Connectors

Import from Claude Desktop or mcp.so format:

```bash
# From file
pfscan connectors import --from mcpServers --file config.json

# From stdin
cat claude_desktop_config.json | pfscan connectors import --from mcpServers --stdin

# From specific JSON key
cat config.json | pfscan connectors import --from mcpServers --stdin --key mcpServers
```

**Input format:**
```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-time"]
    },
    "weather": {
      "command": "uvx",
      "args": ["mcp-server-weather"]
    }
  }
}
```

## Session Management

### List Sessions

```bash
pfscan sessions list                      # All sessions
pfscan sessions list --connector time     # Filter by connector
pfscan sessions list --last 10            # Last 10 sessions
pfscan sessions list --json
```

### Show Session Details

```bash
pfscan sessions show --id <session-id>
pfscan sessions show --id f2442c9b
pfscan sessions show --id abc --json       # Partial ID works
```

### Prune Sessions

```bash
pfscan sessions prune --before 2026-01-01    # Prune before date
pfscan sessions prune --keep-last 50         # Keep last N per connector
pfscan sessions prune --yes                  # Actually execute (otherwise dry run)
```

## Archive Commands

Manage data retention and cleanup.

### Show Archive Status

```bash
pfscan archive status
```

**Output:**
```
Archive Status
═══════════════════════════════════════════════════

Database Size:
  events.db:    1.2MB
  proofs.db:    128KB
  Total:        1.3MB

Retention Settings:
  Keep last:    50 sessions per connector
  Raw JSON:     7 days
  Max DB:       500MB

Current Data:
  Connectors:   3
  Sessions:     87 total
  Events:       1,243
  Oldest:       2025-12-15T10:23:45Z
```

### Show Archive Plan

```bash
pfscan archive plan
```

Shows what would be archived/pruned without actually doing it.

### Run Archive

```bash
pfscan archive run                # Dry run (show what would happen)
pfscan archive run --yes          # Actually execute
pfscan archive run --yes --vacuum # Execute and reclaim disk space
```

## Secret Management

Manage secrets for MCP servers (e.g., API keys, tokens).

### List Secrets

```bash
pfscan secrets list
pfscan secrets list --json
```

**Output:**
```
Secrets:
  OPENAI_API_KEY       (set)
  GITHUB_TOKEN         (set)
  DATABASE_URL         (not set)
```

### Set Secret

```bash
pfscan secrets set OPENAI_API_KEY              # Prompts for value
pfscan secrets set GITHUB_TOKEN --value "..."  # Set directly
```

### Edit Secrets

```bash
pfscan secrets edit          # Opens in editor
```

### Prune Unused Secrets

```bash
pfscan secrets prune         # Dry run
pfscan secrets prune --yes   # Actually remove
```

### Export/Import Secrets

```bash
# Export (encrypted or plain)
pfscan secrets export --file secrets.enc --password
pfscan secrets export --file secrets.json  # Plain JSON (use with caution)

# Import
pfscan secrets import --file secrets.enc --password
pfscan secrets import --file secrets.json
```

## Tool Commands

Execute MCP tools directly (see also [Shell Mode](SHELL.md) for @reference support).

### List Tools

```bash
pfscan tool ls <connector>
pfscan tool ls time
pfscan tool ls time --timeout 60
pfscan tool ls time --json
```

### Show Tool Schema

```bash
pfscan tool show <connector> <tool-name>
pfscan tool show time get_current_time
pfscan tool show time get_current_time --json
```

**Output:**
```
Tool: get_current_time
Description: Get the current time in a specific timezone

Required arguments:
  timezone    string    IANA timezone (e.g., America/New_York)

Optional arguments:
  format      string    Time format (iso, unix, human)
```

### Call Tool

```bash
# From command line
pfscan tool call <connector> <tool-name> --args '<json>'
pfscan tool call time get_current_time --args '{"timezone":"UTC"}'

# From file
pfscan tool call time get_current_time --args-file args.json

# From stdin
echo '{"timezone":"UTC"}' | pfscan tool call time get_current_time --stdin

# Dry run (don't actually call)
pfscan tool call time get_current_time --args '{"timezone":"UTC"}' --dry-run
```

**args.json example:**
```json
{
  "timezone": "America/New_York",
  "format": "iso"
}
```

## Plans Commands

Manage and run validation plans for MCP servers. Plans are YAML-defined validation scenarios that can be executed against connectors.

### List Plans

```bash
pfscan plans ls
pfscan plans list
```

**Output:**
```
Name           Source   Description                Created
----------------------------------------------------------------
basic-mcp      manual   Basic MCP validation       2026-01-04
full-scan      import   Full server scan           2026-01-03
```

### Show Plan Details

```bash
pfscan plans show <name>
pfscan plans show basic-mcp
pfscan plans show basic-mcp --raw     # Show raw YAML
pfscan plans show basic-mcp --json    # JSON output
```

### Add a Plan

```bash
# From file
pfscan plans add myplan --file plan.yaml

# From stdin
cat plan.yaml | pfscan plans add myplan --stdin
```

**Plan YAML format:**
```yaml
version: 1
name: basic-mcp-validation
description: Basic MCP server validation
steps:
  - mcp: initialize
  - mcp: tools/list
  - when: capabilities.resources
    mcp: resources/list
  - when: capabilities.prompts
    mcp: prompts/list
```

### Delete a Plan

```bash
pfscan plans delete <name>
pfscan plans delete myplan --force    # Also delete associated runs
```

### Import/Export Plans

```bash
# Import from file (supports multi-document YAML)
pfscan plans import --file plans.yaml

# Export a plan
pfscan plans export myplan --file myplan.yaml
pfscan plans export myplan --stdout   # Output to stdout
```

### Run a Plan

```bash
# Run against a connector
pfscan plans run <plan-name> --connector <connector-id>
pfscan plans run basic-mcp --connector time

# With options
pfscan plans run basic-mcp --connector time --timeout 60
pfscan plans run basic-mcp --connector time --out ./results
pfscan plans run basic-mcp --connector time --json

# Dry run (show steps without executing)
pfscan plans run basic-mcp --connector time --dry-run
```

**Output:**
```
Running plan 'basic-mcp' against connector 'time'...

Run ID: 01KE4ABCD1234
Status: completed
Duration: 523ms

Steps:
  1. [OK] initialize (269ms)
  2. [OK] tools/list (12ms)
  3. [SKIP] resources/list (when: capabilities.resources)
  4. [SKIP] prompts/list (when: capabilities.prompts)

Inventory:
  Capabilities: tools
  Tools: 2

Artifacts: ~/.config/proofscan/artifacts/01KE4ABCD1234
```

### List Runs

```bash
pfscan plans runs
pfscan plans runs --plan basic-mcp    # Filter by plan
pfscan plans runs --limit 50
```

### Show Run Details

```bash
pfscan plans run-show <run-id>
pfscan plans run-show 01KE4ABCD1234
pfscan plans run-show 01KE4 --json    # Partial ID works
```

### Run Artifacts

Each plan run creates artifacts in `~/.config/proofscan/artifacts/<run-id>/`:

```
meta.json          # Run metadata
plan.yaml          # Normalized plan definition
plan.original.yaml # Original YAML as submitted
run.log            # Human-readable execution log
results.json       # Step-by-step results
inventory.json     # Discovered capabilities/tools/resources/prompts
```

## Doctor Command

Diagnose and fix database issues.

### Run Diagnostics

```bash
pfscan doctor                # Diagnose only
pfscan doctor --fix          # Diagnose and fix issues
pfscan doctor --verbose      # Show detailed output
```

**Checks performed:**
- Database file integrity
- Schema version
- Index integrity
- Foreign key constraints
- Orphaned records
- Corrupted JSON data

## Summary and Permissions

### Session Summary

```bash
pfscan summary --session <session-id>
pfscan summary --session f2442c
pfscan summary --session abc --json
```

**Output:**
```
Session Summary
═══════════════════════════════════════════════════

Session:      f2442c9b
Connector:    time
Duration:     2.5s

Capabilities:
  ✓ tools
  ✓ resources
  ✗ prompts
  ✗ sampling

Tool Calls:
  get_current_time    3 calls
  get_timezone        1 call

Total:        4 tool calls
```

### Permission Statistics

```bash
pfscan permissions [connector]
pfscan permissions time
pfscan permissions --json
```

**Output:**
```
Permission Statistics
═══════════════════════════════════════════════════

Connector: time

By Category:
  read_only     4 calls  (100%)
  write_data    0 calls  (0%)
  network       0 calls  (0%)

By Tool:
  get_current_time    3 calls  read_only
  get_timezone        1 call   read_only
```

## Events Export

Export events to files for analysis.

### List Events

```bash
pfscan events list                        # Recent events
pfscan events list --limit 1000           # More events
pfscan events list --connector time       # Filter by connector
pfscan events list --session abc          # Filter by session
pfscan events list --since 24h            # Time filter
pfscan events list --json
```

### Export Events

```bash
pfscan events export --output events.jsonl              # JSON Lines format
pfscan events export --output events.json --format json # JSON array
pfscan events export --connector time --output time-events.jsonl
```

## Global Options

Available for all commands:

```bash
-c, --config <path>   # Path to config file
--json                # Output in JSON format
-v, --verbose         # Verbose output
-h, --help            # Display help
-V, --version         # Show version
```

### Examples

```bash
# Use custom config
pfscan -c ~/my-config.json status

# JSON output for scripting
pfscan view --limit 10 --json | jq '.[] | select(.status == "ERR")'

# Verbose mode
pfscan -v scan start --id time
```

## Common Workflows

### Initial Setup

```bash
# 1. Initialize
pfscan config init

# 2. Import MCP servers
cat claude_desktop_config.json | pfscan connectors import --from mcpServers --stdin

# 3. Verify
pfscan connectors list
pfscan status
```

### Daily Usage

```bash
# Start scan
pfscan scan start --id myserver

# View results
pfscan                              # Recent events
pfscan tree myserver                # Structure
pfscan rpc list --session abc123    # RPC details

# Test tools
pfscan tool ls myserver
pfscan tool call myserver mytool --args '{}'
```

### Maintenance

```bash
# Check status
pfscan status

# Clean old data
pfscan archive run --yes --vacuum

# Verify database
pfscan doctor --fix
```

### Data Analysis

```bash
# Export events for analysis
pfscan events export --output events.jsonl --since 7d

# Get statistics
pfscan summary --session abc
pfscan permissions myserver

# View detailed RPC
pfscan rpc show --session abc --id 1
```

## Tips and Tricks

### Partial IDs

Most commands accept partial session/connector IDs:

```bash
pfscan tree tim          # Matches "time"
pfscan up f24            # Matches "f2442c9b..."
```

### Command Aliases

Use short aliases for faster typing:

```bash
pfscan v        # view
pfscan t        # tree
pfscan e        # explore
pfscan s        # scan
pfscan st       # status
pfscan a        # archive
pfscan c        # config
```

### JSON Output for Scripting

```bash
# Extract specific fields with jq
pfscan view --json | jq '.[] | {time: .ts_ms, method: .label}'

# Count errors
pfscan view --errors --json | jq 'length'

# Get session IDs
pfscan tree --json | jq '.[].children[].id'
```

### Filtering Events

```bash
# Combine filters
pfscan view --connector time --method tools --since 24h

# Only errors with full timestamps
pfscan view --errors --fulltime --limit 100
```

## Troubleshooting

### Database Issues

```bash
# Check for problems
pfscan doctor

# Fix issues
pfscan doctor --fix

# Last resort: reinitialize (WARNING: loses data)
rm ~/.config/proofscan/events.db
pfscan config init
```

### Connector Problems

```bash
# Verify connector config
pfscan connectors show --id myserver

# Test manually
pfscan scan start --id myserver --timeout 60

# Check recent errors
pfscan view --connector myserver --errors
```

### Performance Issues

```bash
# Check database size
pfscan status

# Archive old data
pfscan archive run --yes --vacuum

# Adjust retention
pfscan config edit
# Set keep_last_sessions: 20
# Set raw_days: 3
```

---

**Next Steps:**
- **Interactive workflows:** See [Shell Mode Guide](SHELL.md)
- **Proxy setup:** See [Proxy Guide](PROXY.md)
- **Audit trails:** See [POPL Guide](POPL.md)
