# proofscan

> **Languages:** English | [日本語](README.ja.md)

MCP Server scanner - eliminate black boxes by capturing JSON-RPC from connection to tools/list.

**Version:** 0.10.14

## Overview

proofscan provides complete visibility into MCP (Model Context Protocol) server communication. It:

- 🔍 **Captures** all JSON-RPC messages (requests, responses, notifications)
- 💾 **Stores** events in SQLite for efficient querying and analysis
- 🌳 **Visualizes** connector → session → RPC hierarchies
- 🔧 **Tests** MCP tools directly from CLI
- 🎭 **Proxies** multiple MCP servers with unified tool namespace
- 📊 **Generates** public-safe audit trails (POPL)
- 🐚 **Interactive** shell mode with TAB completion

## Quick Links

- 📖 **[User Guide](docs/GUIDE.md)** - Complete CLI reference and examples
- 🐚 **[Shell Mode Guide](docs/SHELL.md)** - Interactive shell and @references
- 🎭 **[Proxy Guide](docs/PROXY.md)** - MCP proxy server documentation
- 📦 **[POPL Guide](docs/POPL.md)** - Public Observable Proof Ledger
- 🔧 **[API Documentation](docs/API.md)** - TypeScript API for developers

## Installation

```bash
# Global installation
npm install -g proofscan

# Or run without installing
npx proofscan --help
```

**Requirements:** Node.js v18+ (v20+ recommended)

## Quick Start

### 1. Initialize

```bash
pfscan config init        # Create configuration
pfscan config path        # Show config location
```

### 2. Add MCP Server

```bash
# From Claude Desktop / mcp.so format
echo '{"mcpServers":{"time":{"command":"npx","args":["-y","@modelcontextprotocol/server-time"]}}}' \
  | pfscan connectors import --from mcpServers --stdin

# Or add manually
pfscan connectors add --id time --stdio "npx -y @modelcontextprotocol/server-time"
```

### 3. Scan and View

```bash
pfscan scan start --id time   # Run scan
pfscan                        # View events (default command)
pfscan tree                   # Show structure
pfscan status                 # System status
```

## Key Features

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
$ pfscan shell
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

# In another terminal - use as unified MCP server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | pfscan proxy start --all

# Tools are namespaced: time__get_current_time, weather__get_forecast
```

### 🔧 Direct Tool Testing

```bash
# List tools
pfscan tool ls time

# Show tool schema
pfscan tool show time get_current_time

# Call tool
pfscan tool call time get_current_time --args '{}'
```

## Command Overview

```
Observe & Inspect:
  view, v       View recent events timeline (default)
  tree, t       Show connector → session → RPC structure
  rpc           View RPC call details (list, show)
  summary       Show session summary
  analyze       Analyze tool usage across sessions

Run & Capture:
  scan, s       Run a new scan
  proxy         MCP proxy server

Explore Interactively:
  shell         Interactive shell (REPL) with TAB completion

Work with MCP Tools:
  tool          MCP tool operations (ls, show, call)
  catalog       Search and inspect MCP servers from registry
  runners       Manage package runners (npx, uvx)

Manage Configuration & Data:
  connectors    Connector management
  config, c     Configuration management
  secrets       Secret management
  archive, a    Data retention and cleanup
  doctor        Diagnose and fix database issues

Proof & Ledger:
  popl          Public Observable Proof Ledger

Shortcuts:
  v=view  t=tree  s=scan  st=status  a=archive  c=config
```

## Documentation

### For Users

- **[User Guide](docs/GUIDE.md)** - Complete CLI command reference with examples
- **[Shell Mode](docs/SHELL.md)** - Interactive shell, @references, and advanced workflows
- **[Proxy Guide](docs/PROXY.md)** - MCP proxy server setup and usage
- **[POPL Guide](docs/POPL.md)** - Creating public audit trails

### For Developers

- **[API Documentation](docs/API.md)** - TypeScript API and EventLine model
- **[Architecture](docs/ARCHITECTURE.md)** - Internal design and database schema
- **[Contributing](CONTRIBUTING.md)** - Development setup and guidelines

## Configuration

Config location (OS-standard):
- **Windows**: `%APPDATA%\proofscan\config.json`
- **macOS**: `~/Library/Application Support/proofscan/config.json`
- **Linux**: `~/.config/proofscan/config.json`

Basic config structure:

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

See **[User Guide](docs/GUIDE.md#configuration)** for details.

## Data Storage

proofscan uses a 2-file SQLite structure:

```
~/.config/proofscan/
├── config.json
├── events.db          # Sessions, events, RPC calls (can be pruned)
├── proofs.db          # Immutable proof records (never pruned)
├── proxy-runtime-state.json  # Proxy state (if proxy used)
└── proxy-logs.jsonl   # Proxy logs (if proxy used)
```

## Global Options

```bash
-c, --config <path>  Path to config file
--json               Output in JSON format
-v, --verbose        Verbose output
-h, --help           Display help
-V, --version        Show version
```

## Examples

### Basic Workflow

```bash
# 1. Import MCP server
cat claude_desktop_config.json | pfscan connectors import --from mcpServers --stdin

# 2. Run scan
pfscan scan start --id myserver

# 3. View results
pfscan                         # Recent events
pfscan tree                    # Hierarchical view
pfscan rpc list --session abc  # RPC details
```

### Shell Mode Workflow

```bash
pfscan shell

# Navigate using cd command
proofscan> cd time
proofscan:/time > pwd
Context: connector=time

proofscan:/time > cd abc123
proofscan:/time/abc123 > pwd
Context: session=abc123 (connector=time)

# Save reference and use later
proofscan> ref add important @this
proofscan> tool call get_current_time --args '{}'
proofscan> popl @last --title "Production Test"
```

### Proxy Mode

```bash
# Terminal 1: Start proxy
pfscan -v proxy start --connectors server1,server2

# Terminal 2: Check status
pfscan proxy status
pfscan log --tail 20

# Use proxy with Claude Desktop
# Add to claude_desktop_config.json:
# {
#   "mcpServers": {
#     "proofscan-proxy": {
#       "command": "pfscan",
#       "args": ["proxy", "start", "--all"]
#     }
#   }
# }
```

## Development

```bash
git clone https://github.com/proofofprotocol/proofscan.git
cd proofscan
npm install
npm run build
npm test

# Run from source
node dist/cli.js --help
```

## Use Cases

- 🔍 **Debug MCP servers**: See exactly what's happening in JSON-RPC communication
- 📊 **Analyze tool usage**: Track which tools are called and how often
- 🎯 **Performance monitoring**: Measure RPC latency and identify bottlenecks
- 🔐 **Security auditing**: Review permission requests and data access
- 📝 **Documentation**: Generate public-safe logs for bug reports
- 🧪 **Testing**: Verify MCP server behavior and tool schemas
- 🎭 **Integration**: Use proxy mode to aggregate multiple MCP servers

## Related Projects

- **[Model Context Protocol](https://modelcontextprotocol.io)** - Official MCP specification
- **[MCP Servers](https://github.com/modelcontextprotocol/servers)** - Official server implementations
- **[@proofofprotocol/inscribe-mcp-server](https://github.com/proofofprotocol/inscribe-mcp-server)** - Blockchain-backed proof storage

## License

MIT

## Support

- 📖 **Documentation**: See [docs/](docs/) directory
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/proofofprotocol/proofscan/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/proofofprotocol/proofscan/discussions)

---

**Made with ❤️ by [Proof of Protocol](https://github.com/proofofprotocol)**
