# MCP Apps UI Guide

> **Version:** 0.10.63+  
> **Feature:** MCP Apps Extension (Phase 6)  
> **Date:** 2026-02-08

This guide explains how to use proofscan's interactive UI features through MCP Apps.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Available UIs](#available-uis)
4. [Usage](#usage)
5. [Security Model](#security-model)
6. [Troubleshooting](#troubleshooting)

---

## Overview

MCP Apps is an extension to the Model Context Protocol (SEP-1865) that enables MCP servers to provide interactive UIs within host applications like Claude Desktop.

proofscan leverages MCP Apps to provide:
- **Visual Protocol Trace Viewer** — See MCP/A2A events in a timeline
- **Real-time Updates** — Watch events as they happen via notifications
- **Pagination** — Browse through large event histories

### How It Works

```
┌────────────────────────────────────────┐
│ Claude Desktop (Host)                  │
│  ┌──────────────────────────────────┐  │
│  │ Sandboxed iframe                 │  │
│  │  ┌────────────────────────────┐  │  │
│  │  │ proofscan Trace Viewer     │  │  │
│  │  │  - Event timeline          │  │  │
│  │  │  - Pagination              │  │  │
│  │  │  - Real-time updates       │  │  │
│  │  └────────────────────────────┘  │  │
│  └──────────────────────────────────┘  │
│            ↕ postMessage               │
│  ┌──────────────────────────────────┐  │
│  │ MCP Client                       │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
              ↕ MCP JSON-RPC
┌────────────────────────────────────────┐
│ proofscan MCP Server                   │
│  - UI Resources (trace-viewer)         │
│  - Tools (proofscan_getEvents)         │
│  - EventLineDB                         │
└────────────────────────────────────────┘
```

---

## Prerequisites

- **proofscan** 0.10.63 or later
- **Claude Desktop** with MCP Apps support (2025-11-21 protocol version)
- An active proxy session capturing events

```bash
# Check your version
pfscan --version
# Should output: 0.10.63 or later
```

---

## Available UIs

### Trace Viewer

**Resource URI:** `ui://proofscan/trace-viewer`

An interactive timeline of protocol events (requests, responses, notifications).

**Features:**
- Color-coded event cards (request vs response)
- Timestamp and duration display
- Expandable JSON payloads
- Scroll-to-top pagination for history
- Real-time updates via notifications

---

## Usage

### Step 1: Start the Proxy

First, start proofscan in proxy mode to capture events:

```bash
# Start proxy with your MCP servers
pfscan proxy start

# Or add a connector and scan
pfscan connector add my-server --command "npx my-mcp-server"
pfscan scan start --id my-server
```

### Step 2: Configure Claude Desktop

Add proofscan to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "proofscan": {
      "command": "npx",
      "args": ["proofscan", "server"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Step 3: Use the Trace Viewer

In Claude Desktop, ask Claude to show protocol events:

> "Show me the recent protocol events"

Claude will call the `proofscan_getEvents` tool, which:
1. Returns a text summary for the conversation
2. Opens the Trace Viewer UI in a panel
3. Displays events with full detail

### Step 4: Interact with the UI

- **Scroll up** — Load older events (pagination)
- **Click events** — Expand to see full JSON payload
- **Watch in real-time** — New events appear automatically

---

## Security Model

proofscan implements a robust security model for MCP Apps:

### Token Isolation

- Session tokens are used to authenticate postMessage communication
- Tokens are **never sent to the MCP server** (stripped by host layer)
- Logged for audit purposes only (BridgeEnvelope pattern)

### Correlation IDs

Every UI interaction is traceable with 4 correlation IDs:

| ID | Purpose |
|----|---------|
| `ui_session_id` | UI session (one per iframe instance) |
| `ui_rpc_id` | RPC call from UI |
| `correlation_id` | Logical operation ID |
| `tool_call_fingerprint` | Hash of tool call parameters |

### Content Security

- UI runs in a **sandboxed iframe** (opaque origin)
- CSP restricts script and style sources
- HTML escaping prevents XSS

---

## Troubleshooting

### UI doesn't appear

1. **Check proofscan version** — Must be 0.10.63+
2. **Check Claude Desktop version** — Must support MCP Apps (2025-11-21+)
3. **Verify server is running** — `pfscan server` should be active

### No events shown

1. **Check for active sessions** — Run `pfscan session ls` to see sessions
2. **Verify proxy is capturing** — Events should appear in `pfscan events ls`
3. **Check sessionId** — The Trace Viewer uses a default `test-session` ID

### Events not updating in real-time

1. **Check notification support** — Host must support MCP notifications
2. **Verify connection status** — Look at the status indicator in the UI header

### "Failed to load events" error

1. **Check database** — Ensure proofscan database is accessible
2. **Check permissions** — Verify read access to the data directory

---

## Related Documentation

- **[Proxy Guide](PROXY.md)** — Setting up MCP proxy
- **[Shell Mode](SHELL.md)** — Interactive shell for exploring events
- **[API Reference](API.md)** — Programmatic access to events

---

## Appendix: Tool Reference

### proofscan_getEvents

Retrieves protocol events with pagination support.

**Input Schema:**
```json
{
  "sessionId": "string (required)",
  "limit": "number (default: 50)",
  "before": "string (event ID for pagination)"
}
```

**Output:**
- `content` — Text summary for conversation
- `structuredContent` — Full event data for UI
- `_meta.cursors` — Pagination cursors

**Example:**
```json
{
  "content": [
    { "type": "text", "text": "Found 50 events..." }
  ],
  "structuredContent": {
    "events": [...],
    "_meta": {
      "cursors": { "before": "evt_123", "after": "evt_173" }
    }
  }
}
```
