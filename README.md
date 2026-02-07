# proofscan

> **Languages:** English | [日本語](README.ja.md)

MCP Server scanner - eliminate black boxes by capturing JSON-RPC from connection to tools/list.

[![npm version](https://img.shields.io/npm/v/proofscan.svg)](https://www.npmjs.com/package/proofscan)
[![Node.js](https://img.shields.io/node/v/proofscan.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

proofscan provides complete visibility into MCP (Model Context Protocol) server communication. It operates in three modes:

- **CLI** – Run single commands to inspect, manage and analyze data
- **SHELL** – Explore connectors, sessions and RPCs interactively
- **PROXY** – Capture MCP traffic continuously as a proxy server

### Key Capabilities

| Feature | Description |
|---------|-------------|
| 🔍 **Capture** | All JSON-RPC messages (requests, responses, notifications) |
| 💾 **Store** | Events in SQLite for efficient querying and analysis |
| 🌳 **Visualize** | Connector → session → RPC hierarchies |
| 🔧 **Test** | MCP tools directly from CLI |
| 🎭 **Proxy** | Multiple MCP servers with unified tool namespace |
| 📊 **Generate** | Public-safe audit trails (POPL) |
| 🐚 **Interactive** | Shell mode with TAB completion |
| 📦 **Catalog** | Search and install MCP servers from registry |
| 📈 **Analyze** | Tool usage analysis across sessions |
| 📝 **Plans** | Validation plans for automated testing |
| 🖥️ **MCP Apps** | Interactive trace viewer UI in Claude Desktop |
| 🌍 **i18n** | Multi-language support (English, 日本語) |

## Quick Links

### For Users

- 📖 **[User Guide](docs/GUIDE.md)** ([日本語](docs/GUIDE.ja.md)) – Complete CLI reference
- 🐚 **[Shell Mode](docs/SHELL.md)** ([日本語](docs/SHELL.ja.md)) – Interactive shell and @references
- 🎭 **[Proxy Guide](docs/PROXY.md)** ([日本語](docs/PROXY.ja.md)) – MCP proxy server
- 📦 **[POPL Guide](docs/POPL.md)** ([日本語](docs/POPL.ja.md)) – Public Observable Proof Ledger
- 🔧 **[MCP Server Setup](docs/MCP_SERVER_SETUP_GUIDE.md)** ([日本語](docs/MCP_SERVER_SETUP_GUIDE.ja.md)) – Setting up MCP servers
- 🖥️ **[MCP Apps UI](docs/MCP_APPS.md)** ([日本語](docs/MCP_APPS.ja.md)) – Interactive trace viewer UI

### For Developers

- **[CONTRIBUTING.md](CONTRIBUTING.md)** – Development setup and guidelines

## Installation

### Global Installation (Recommended)

```bash
npm install -g proofscan
```

### Run without Installing

```bash
npx proofscan --help
```

### Available Commands

After installation, you can use any of these aliases:

| Command | Description |
|---------|-------------|
| `proofscan` | Full command name |
| `pfscan` | Short alias |
| `pfs` | Shortest alias |
| `psh` | Direct shell mode (equivalent to `pfscan shell`) |

**Requirements:** Node.js v18+ (v20+ recommended)

## Quick Start

### 1. Initialize Configuration

```bash
pfscan config init        # Create configuration
pfscan config path        # Show config location
```

### 2. Add an MCP Server

**Option A: Import from Claude Desktop config**

```bash
# Import from file
pfscan connectors import --from mcpServers --file ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Or from stdin
cat claude_desktop_config.json | pfscan connectors import --from mcpServers --stdin
```

**Option B: Add manually**

```bash
pfscan connectors add --id time --stdio "npx -y @modelcontextprotocol/server-time"
```

**Option C: Install from catalog**

```bash
pfscan catalog install @modelcontextprotocol/server-time --id time
```

### 3. Scan and View

```bash
pfscan scan start --id time   # Run scan
pfscan                        # View events (default command)
pfscan tree                   # Show structure
pfscan status                 # System status
```

## Core Features

### 📊 Event Timeline

```bash
$ pfscan view --limit 10
Time         Sym Dir St Method              Session      Extra
-------------------------------------------------------------------
21:01:58.743 → → ✓ initialize            f2442c... lat=269ms
21:01:59.018 ← ← ✓ initialize            f2442c...
21:01:59.025 • →   notifications/initi... f2442c...
21:01:59.037 → → ✓ tools/list            f2442c...
21:01:59.049 ← ← ✓ tools/list            f2442c... lat=12ms size=1.0KB

# Real-time monitoring
$ pfscan view -f --connector time

# Export to file
$ pfscan view --export events.csv
```

### 🌳 Hierarchical Tree

```bash
$ pfscan tree
└── 📦 time
    ├── 📋 f2442c9b... (2 rpcs, 8 events)
    │   ├── ↔️ ✓ tools/list (id=2, 12ms)
    │   └── ↔️ ✓ initialize (id=1, 269ms)
    └── 📋 3cf5a66e... (2 rpcs, 8 events)
        ├── ↔️ ✓ tools/list (id=2, 13ms)
        └── ↔️ ✓ initialize (id=1, 271ms)
```

### 🐚 Interactive Shell

```bash
$ psh
# Or: pfscan shell

proofscan> pwd
Context: session=f2442c9b (connector=time)

proofscan> tool ls
Found 2 tools: get_current_time, get_timezone

proofscan> ref add mytask @this
✓ Reference 'mytask' saved

proofscan> popl @last --title "Time Server Test"
✓ POPL entry created: 20260104-f2442c9b
```

### 🎭 MCP Proxy

```bash
# Start proxy with multiple backends
pfscan proxy start --connectors time,weather

# Tools are namespaced: time__get_current_time, weather__get_forecast
```

**Use with Claude Desktop:**

```json
{
  "mcpServers": {
    "proofscan-proxy": {
      "command": "pfscan",
      "args": ["proxy", "start", "--all"]
    }
  }
}
```

### 🔧 Direct Tool Testing

```bash
pfscan tool ls time                              # List tools
pfscan tool show time get_current_time           # Show tool schema
pfscan tool call time get_current_time --args '{}' # Call tool
```

### 📦 MCP Catalog

Discover and install MCP servers from the registry:

```bash
pfscan catalog search time                                    # Search
pfscan catalog view @modelcontextprotocol/server-time         # View details
pfscan catalog install @modelcontextprotocol/server-time --id time  # Install
pfscan catalog sources                                        # Manage sources
```

### 📈 Tool Usage Analysis

```bash
pfscan analyze                      # Analyze all tool usage
pfscan analyze --connector time     # Specific connector
pfscan analyze --verbose            # Detailed statistics
```

### 📝 Validation Plans

Create and run automated validation plans:

```bash
pfscan plans ls                    # List plans
pfscan plans add plan.yaml         # Add a plan
pfscan plans run --id myplan       # Execute plan
pfscan plans runs                  # View execution history
```

## Command Reference

```
Main Commands
  view (v)        View recent events timeline (default)
  tree (t)        Show connector → session → RPC structure
  rpc             Inspect RPC call details
  summary         Show session summary and capabilities
  analyze         Analyze tool usage across sessions
  scan (s)        Run a new scan against MCP servers
  proxy           Run MCP proxy server
  shell           Start interactive shell (REPL)
  tool            List, inspect and call MCP tools
  catalog (cat)   Search and inspect MCP servers from registry
  connectors      Manage MCP server connectors
  config (c)      Configuration management
  secrets         Secret management
  runners         Manage package runners (npx, uvx)
  archive (a)     Data retention and cleanup
  doctor          Diagnose and fix issues
  status (st)     Show database and system status
  popl            Public Observable Proof Ledger management

Ancillary Commands
  plans           Manage validation plans
  sessions        Manage scan sessions
  record          Record management commands
  log             View proxy logs
```

Run `pfscan help <command>` for details on any command.

## Configuration

Config file location (OS-standard):

| Platform | Path |
|----------|------|
| **Windows** | `%APPDATA%\proofscan\config.json` |
| **macOS** | `~/Library/Application Support/proofscan/config.json` |
| **Linux** | `~/.config/proofscan/config.json` |

Example configuration:

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

## Data Storage

```
~/.config/proofscan/
├── config.json                 # Configuration file
├── events.db                   # Sessions, events, RPC calls (prunable)
├── proofs.db                   # Immutable proof records (never pruned)
├── proxy-runtime-state.json    # Proxy state (if proxy used)
└── proxy-logs.jsonl            # Proxy logs (if proxy used)
```

## Global Options

```
-c, --config <path>  Path to config file
--json               Output in JSON format
-v, --verbose        Verbose output
-h, --help           Display help
-V, --version        Show version
```

## Use Cases

| Use Case | Description |
|----------|-------------|
| 🔍 **Debug** | See exactly what's happening in JSON-RPC communication |
| 📊 **Analyze** | Track which tools are called and how often |
| 🎯 **Performance** | Measure RPC latency and identify bottlenecks |
| 🔐 **Security** | Review permission requests and data access |
| 📝 **Documentation** | Generate public-safe logs for bug reports |
| 🧪 **Testing** | Verify MCP server behavior and tool schemas |
| 🎭 **Integration** | Aggregate multiple MCP servers via proxy |

## Related Projects

- **[Model Context Protocol](https://modelcontextprotocol.io)** – Official MCP specification
- **[MCP Servers](https://github.com/modelcontextprotocol/servers)** – Official server implementations

## License

MIT

## Support

- 📖 **Documentation**: See [docs/](docs/) directory
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/proofofprotocol/proofscan/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/proofofprotocol/proofscan/discussions)

---

**Made with ❤️ by [Proof of Protocol](https://github.com/proofofprotocol)**
