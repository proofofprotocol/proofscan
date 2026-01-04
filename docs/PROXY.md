# proofscan Proxy Guide

The MCP proxy aggregates multiple MCP servers into a single unified server with namespaced tools.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Proxy Commands](#proxy-commands)
- [Tool Namespace](#tool-namespace)
- [Use Cases](#use-cases)
- [Claude Desktop Integration](#claude-desktop-integration)
- [Monitoring](#monitoring)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)

## Overview

The proofscan proxy:
- 🎭 **Aggregates** multiple MCP servers into one
- 🏷️ **Namespaces** tools to avoid conflicts (e.g., `time__get_current_time`)
- 🔄 **Routes** tool calls to the correct backend
- 📊 **Records** all communication to events.db
- 🚦 **Handles** partial failures gracefully (if one backend fails, others still work)

### Architecture

```
┌─────────────────┐
│  Claude Desktop │
└────────┬────────┘
         │
         │ stdio (JSON-RPC)
         │
┌────────▼───────────────────────────────────┐
│         proofscan proxy                    │
│  - Aggregates tools from backends         │
│  - Routes calls by namespace               │
│  - Records all JSON-RPC                    │
└──┬─────────┬─────────┬─────────────────────┘
   │         │         │
   │ stdio   │ stdio   │ stdio
   │         │         │
┌──▼──────┐ ┌▼───────┐ ┌▼────────────┐
│  time   │ │ weather│ │  filesystem │
│ backend │ │backend │ │  backend    │
└─────────┘ └────────┘ └─────────────┘
```

## Quick Start

### 1. Start Proxy

```bash
# Start with specific connectors
pfscan proxy start --connectors time,weather

# Or start with all enabled connectors
pfscan proxy start --all

# With verbose logging
pfscan -v proxy start --all
```

### 2. In Another Terminal: Check Status

```bash
pfscan proxy status
```

**Output:**
```
Proxy Status
═══════════════════════════════════════════════════

State:        RUNNING
Mode:         stdio
PID:          12345
Started:      2026-01-04T12:00:00.000Z
Uptime:       5m 30s
Heartbeat:    just now

Connectors:
  ● time: 2 tools
  ● weather: 3 tools

Clients:
  ● claude-desktop (active)
      Last seen: 2s ago
      Sessions: 1, Tool calls: 5

Logging:
  Level:      INFO
  Buffered:   45/1000 lines
```

### 3. View Logs

```bash
pfscan log --tail 20
pfscan log --level WARN    # Only warnings/errors
```

**Output:**
```
[12:00:05.123] INFO  [server] Proxy started with 2 connector(s)
[12:00:07.456] INFO  Request: initialize
[12:00:07.457] INFO  [init] Client: claude-desktop (protocol=2024-11-05)
[12:00:09.234] INFO  Request: tools/list
[12:00:11.567] INFO  Listed 2 tool(s) from time (session=abc123)
[12:00:11.568] INFO  Listed 3 tool(s) from weather (session=def456)
[12:00:11.569] INFO  Returning 5 tool(s)
[12:00:15.890] INFO  Request: tools/call
[12:00:15.891] INFO  tools/call name=time__get_current_time
[12:00:15.892] INFO  Routing → connector=time tool=get_current_time
[12:00:16.123] INFO  Result: success sessionId=abc123
```

## Proxy Commands

### proxy start

Start the MCP proxy server.

```bash
# With specific connectors
pfscan proxy start --connectors time,weather,filesystem

# With all enabled connectors
pfscan proxy start --all

# Custom timeout (default: 30s)
pfscan proxy start --all --timeout 60

# Verbose mode
pfscan -v proxy start --all
```

**Options:**
- `--connectors <ids>`: Comma-separated connector IDs
- `--all`: Use all enabled connectors
- `--timeout <seconds>`: Backend call timeout (1-300 seconds)

**Note:** Proxy runs in foreground. Use `Ctrl+C` to stop gracefully.

### proxy status

Show runtime status of the proxy.

```bash
pfscan proxy status
pfscan proxy status --json
```

**Shows:**
- Proxy state (RUNNING / STALE / STOPPED)
- Process ID (PID)
- Uptime
- Heartbeat (last update time)
- Connected backends with tool counts
- Active clients with session/call stats
- Log buffer status

**Proxy States:**
- **RUNNING**: Proxy is actively running, heartbeat recent
- **STALE**: Proxy was running but heartbeat is old (>30s)
- **STOPPED**: Proxy cleanly shut down
- **No state found**: Proxy has never run

### log

View proxy logs from the ring buffer.

```bash
pfscan log                    # Last 50 lines (default)
pfscan log --tail 100         # Last 100 lines
pfscan log --level WARN       # Only WARN and ERROR
pfscan log --level ERROR      # Only ERROR
pfscan log --no-color         # Plain text (no ANSI colors)
```

**Log Format:**
```
[HH:MM:SS.mmm] LEVEL  [category] message
```

**Log Levels:**
- **INFO**: Normal operation (requests, responses, routing)
- **WARN**: Warnings (partial failures, retries)
- **ERROR**: Errors (backend failures, invalid requests)

## Tool Namespace

The proxy namespaces tools to avoid conflicts when multiple backends provide tools with the same name.

### Namespace Format

```
<connector-id>__<tool-name>
```

**Examples:**
- `time__get_current_time` (time connector, get_current_time tool)
- `weather__get_forecast` (weather connector, get_forecast tool)
- `filesystem__read_file` (filesystem connector, read_file tool)

### How It Works

1. **tools/list request:**
   - Proxy calls tools/list on all backends
   - Collects all tools
   - Prefixes each tool name with `<connector>__`
   - Returns unified list

2. **tools/call request:**
   - Client calls `connector__tool`
   - Proxy parses namespace: `connector__tool` → connector=`connector`, tool=`tool`
   - Routes to correct backend
   - Removes namespace prefix before sending to backend
   - Returns result

### Example: tools/list Response

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "time__get_current_time",
        "description": "Get the current time",
        "inputSchema": {...}
      },
      {
        "name": "time__get_timezone",
        "description": "Get timezone info",
        "inputSchema": {...}
      },
      {
        "name": "weather__get_forecast",
        "description": "Get weather forecast",
        "inputSchema": {...}
      }
    ]
  }
}
```

### Example: tools/call Request

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "time__get_current_time",
    "arguments": {"timezone": "UTC"}
  }
}
```

**Routing:**
1. Parse: `time__get_current_time` → connector=`time`, tool=`get_current_time`
2. Forward to `time` backend with tool name `get_current_time`
3. Return result

## Use Cases

### 1. Multiple MCP Servers with Claude Desktop

Instead of configuring each MCP server separately, use the proxy:

**Before (multiple entries):**
```json
{
  "mcpServers": {
    "time": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-time"]},
    "weather": {"command": "npx", "args": ["-y", "mcp-server-weather"]},
    "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"]}
  }
}
```

**After (single proxy):**
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

### 2. Tool Call Recording

All tool calls through the proxy are automatically recorded to events.db:

```bash
# After using proxy
pfscan view --connector time
pfscan tree time
pfscan rpc list --session abc123
```

### 3. Selective Backend Exposure

Control which backends are exposed:

```bash
# Only expose time and weather, not filesystem
pfscan proxy start --connectors time,weather
```

### 4. Backend Health Monitoring

```bash
# Check which backends are working
pfscan proxy status

# View backend errors
pfscan log --level WARN
```

### 5. Unified Tool Discovery

Instead of querying multiple servers, get all tools from one place:

```bash
# Client sends one tools/list request
# Proxy queries all backends in parallel
# Returns unified list with namespaced tools
```

## Claude Desktop Integration

### Configuration

Add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

**Or with specific connectors:**
```json
{
  "mcpServers": {
    "proofscan-proxy": {
      "command": "pfscan",
      "args": ["proxy", "start", "--connectors", "time,weather"]
    }
  }
}
```

### Restart Claude Desktop

After changing configuration:
1. Quit Claude Desktop completely
2. Restart Claude Desktop
3. Proxy will start automatically when Claude connects

### Verify Connection

```bash
# In another terminal
pfscan proxy status

# Should show:
# Clients:
#   ● claude-desktop (active)
```

## Monitoring

### Real-time Monitoring

**Terminal 1: Run Proxy**
```bash
pfscan -v proxy start --all
```

**Terminal 2: Monitor Status**
```bash
watch -n 2 pfscan proxy status
```

**Terminal 3: Tail Logs**
```bash
pfscan log --tail 20
# Or watch in real-time (if proxy outputs to stderr)
tail -f ~/.config/proofscan/proxy-logs.jsonl
```

### Check Backend Sessions

All backend calls are recorded as sessions:

```bash
# List sessions
pfscan sessions list

# Show session details
pfscan sessions show --id abc123

# View RPCs
pfscan rpc list --session abc123
```

### Performance Monitoring

```bash
# View latency of backend calls
pfscan view --connector time --limit 50

# Check for slow backends
pfscan view --method tools/list | grep -E "lat=[0-9]{4,}ms"

# View error rate
pfscan view --errors --connector weather
```

## Architecture

### Components

1. **MCP Server Interface**
   - Reads JSON-RPC from stdin
   - Writes JSON-RPC to stdout
   - Writes logs to stderr

2. **Tool Aggregator**
   - Calls tools/list on all backends in parallel
   - Collects and namespaces tools
   - Handles partial failures (Promise.allSettled)

3. **Request Router**
   - Parses namespace from tool calls
   - Routes to correct backend
   - Removes namespace before forwarding

4. **State Manager**
   - Tracks proxy state (PID, uptime, heartbeat)
   - Tracks client connections
   - Persists to `proxy-runtime-state.json`

5. **Logger**
   - Ring buffer (1000 lines max)
   - JSON Lines format
   - Persists to `proxy-logs.jsonl`

### Data Flow

```
1. Client → Proxy (stdin)
   {"jsonrpc":"2.0","id":1,"method":"initialize"}

2. Proxy → Client (stdout)
   {"jsonrpc":"2.0","id":1,"result":{...}}

3. Client → Proxy (stdin)
   {"jsonrpc":"2.0","id":2,"method":"tools/list"}

4. Proxy → Backend 1 (stdio)
   {"jsonrpc":"2.0","id":1,"method":"tools/list"}

5. Backend 1 → Proxy (stdio)
   {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}

6. Proxy → Backend 2 (stdio)
   [same as step 4]

7. Backend 2 → Proxy (stdio)
   [same as step 5]

8. Proxy aggregates and namespaces tools

9. Proxy → Client (stdout)
   {"jsonrpc":"2.0","id":2,"result":{"tools":[
     {"name":"backend1__tool1",...},
     {"name":"backend2__tool2",...}
   ]}}

10. All steps recorded to events.db
```

### File Locations

```
~/.config/proofscan/
├── config.json                 # Connector configuration
├── events.db                   # Recorded JSON-RPC
├── proxy-runtime-state.json    # Proxy state
└── proxy-logs.jsonl            # Proxy logs (ring buffer)
```

## Troubleshooting

### Proxy Won't Start

**Symptom:** Proxy exits immediately or shows error.

**Check:**
```bash
# Verify connectors exist and are enabled
pfscan connectors list

# Test connector manually
pfscan scan start --id time

# Check for conflicting processes
pfscan proxy status
# If shows RUNNING with stale PID, old process may be stuck
```

**Fix:**
```bash
# Enable disabled connectors
pfscan connectors enable --id time

# Kill stale proxy
kill <PID from proxy status>

# Restart
pfscan proxy start --all
```

### Backend Not Responding

**Symptom:** Some tools not appearing or calls failing.

**Check logs:**
```bash
pfscan log --level WARN
```

**Common issues:**
- Backend command not found (e.g., `uvx` not in PATH)
- Backend crashes on startup
- Timeout too short for slow backends

**Fix:**
```bash
# Increase timeout
pfscan proxy start --all --timeout 60

# Test backend directly
pfscan scan start --id problematic-backend

# Check backend command
pfscan connectors show --id problematic-backend
```

### Namespace Conflicts

**Symptom:** Tool names look wrong or have double underscores.

**Issue:** If a backend tool name contains `__`, it may confuse the parser.

**Example:**
- Backend has tool: `my__tool`
- Proxy creates: `connector__my__tool`
- Parser may misinterpret

**Fix:** Rename backend tools to avoid `__` in names.

### Claude Desktop Not Connecting

**Symptom:** Claude Desktop shows proxy as disconnected.

**Check:**
```bash
pfscan proxy status
# Should show client "claude-desktop"
```

**Fix:**
1. Verify config path is correct
2. Fully quit and restart Claude Desktop
3. Check Claude logs (if accessible)
4. Try simpler config (one connector only)

### High Memory Usage

**Symptom:** Proxy uses too much RAM.

**Cause:** Log ring buffer or many concurrent backends.

**Fix:**
```bash
# Ring buffer is limited to 1000 lines (safe)
# But each backend connection uses memory

# Reduce backends
pfscan proxy start --connectors time,weather
# Instead of --all
```

### Slow Tool Calls

**Symptom:** Tool calls take longer through proxy.

**Reason:** Proxy adds minimal overhead (<10ms), but:
- Namespace parsing: ~1ms
- Backend routing: ~1ms
- Event recording: ~5ms (async, shouldn't block)

**If slow:**
```bash
# Check backend latency
pfscan view --connector time --limit 50
# Look for high latency in direct calls

# Not a proxy issue if direct calls are also slow
```

## Performance Tips

### 1. Use Specific Connectors

```bash
# Faster startup
pfscan proxy start --connectors time,weather

# vs slower
pfscan proxy start --all
```

### 2. Increase Timeout for Slow Backends

```bash
pfscan proxy start --all --timeout 60
```

### 3. Monitor Backend Health

```bash
# Regular health checks
pfscan proxy status
pfscan log --level WARN
```

### 4. Restart Periodically

```bash
# Proxy accumulates state
# Restart daily or after heavy use
pkill -f "pfscan proxy"
pfscan proxy start --all
```

## Advanced Usage

### Scripting with Proxy

```bash
#!/bin/bash

# Start proxy in background
pfscan proxy start --all &
PROXY_PID=$!

# Wait for proxy to be ready
sleep 2

# Use proxy via stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' | nc localhost 3000

# Stop proxy
kill $PROXY_PID
```

### Custom Backend Selection

```bash
# Morning: use time and weather
pfscan proxy start --connectors time,weather

# Afternoon: add filesystem
pkill -f "pfscan proxy"
pfscan proxy start --connectors time,weather,filesystem
```

### Monitoring Script

```bash
#!/bin/bash
while true; do
  clear
  echo "=== Proxy Status ==="
  pfscan proxy status
  echo ""
  echo "=== Recent Logs ==="
  pfscan log --tail 10
  sleep 5
done
```

---

**Related:**
- [User Guide](GUIDE.md) - Complete CLI reference
- [Shell Mode](SHELL.md) - Interactive shell
- [POPL Guide](POPL.md) - Audit trails
