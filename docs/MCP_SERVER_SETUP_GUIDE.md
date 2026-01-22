# MCP Server Setup Guide with Secrets

> **Version:** 0.10.55+  
> **Feature:** MCP Control Plane (PR#66)  
> **Date:** 2026-01-22

This guide explains how to add and configure MCP servers using proofscan, with a focus on servers that require API keys and environment variables.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start: Adding an MCP Server](#quick-start-adding-an-mcp-server)
4. [Working with Secrets](#working-with-secrets)
5. [Proxy Management](#proxy-management)
6. [Configure Mode (Interactive)](#configure-mode-interactive)
7. [Advanced Topics](#advanced-topics)
8. [Troubleshooting](#troubleshooting)

---

## Overview

Proofscan provides multiple ways to add and configure MCP servers:

- **Catalog Installation**: Search and install from the official MCP registry
- **Manual Connector Add**: Add servers directly with command-line options
- **Configure Mode** (PR#66): Interactive editing within the psh shell

This guide focuses on **secret management** for MCP servers that require API keys or sensitive configuration.

---

## Prerequisites

- **Node.js** 18.0.0 or later
- **Proofscan** 0.10.55 or later
- An MCP server that requires environment variables (e.g., API keys)

```bash
# Check your version
pfscan --version

# Should output: 0.10.55 or later
```

---

## Quick Start: Adding an MCP Server

### Step 1: Search for an MCP Server

Use the catalog to find servers that require API keys:

```bash
# Search for weather servers
pfscan catalog search weather

# View details of a specific server
pfscan catalog view io.github.overstarry/qweather-mcp
```

**Example Output:**
```
Name:        io.github.overstarry/qweather-mcp
Description: a qweather mcp server
Version:     1.0.12
Repository:  https://github.com/overstarry/qweather-mcp
Transport:   {"type":"stdio"}

Packages:
  - npm qweather-mcp@1.0.12
    Required: QWEATHER_API_BASE, QWEATHER_API_KEY

Install:
  pfscan cat install io.github.overstarry/qweather-mcp --source official
```

**Key Information:**
- ✅ **Required env variables**: `QWEATHER_API_KEY`, `QWEATHER_API_BASE`
- ✅ **Transport type**: `stdio` (command-line execution)
- ✅ **Install command**: provided for easy setup

### Step 2: Install the MCP Server

```bash
pfscan catalog install io.github.overstarry/qweather-mcp --source official
```

**Output:**
```
Warning: Installing unknown server: npm package without scope
✓ Connector 'qweather-mcp' added from io.github.overstarry/qweather-mcp (via npx)

Next steps:
  pfscan scan start --id qweather-mcp
```

### Step 3: Verify Installation

```bash
# List all connectors
pfscan connectors ls

# View the new connector
pfscan connectors show --id qweather-mcp
```

**Output:**
```json
{
  "id": "qweather-mcp",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "qweather-mcp@1.0.12"
    ]
  }
}
```

---

## Working with Secrets

### Overview

Proofscan provides secure secret storage for environment variables:

- **Auto-detection**: Values that look like secrets are automatically detected
- **Secure storage**: Secrets are stored in `secrets.db` with encryption (when available)
- **Reference system**: Secrets are referenced in config, not stored in plain text
- **Masking**: Secrets are masked (`***SECRET_REF***`) when viewing config

### Step 1: Set Secrets for Your Connector

```bash
# Set the API key
echo "your-actual-api-key-here" | pfscan secrets set qweather-mcp QWEATHER_API_KEY

# Set the API base URL
echo "https://devapi.qweather.com" | pfscan secrets set qweather-mcp QWEATHER_API_BASE
```

**Interactive Mode (Recommended):**
```bash
# Set secrets interactively (more secure)
pfscan secrets set qweather-mcp QWEATHER_API_KEY
# Prompt: Enter secret for qweather-mcp.QWEATHER_API_KEY:
# Type your key and press Enter

pfscan secrets set qweather-mcp QWEATHER_API_BASE
# Prompt: Enter secret for qweather-mcp.QWEATHER_API_BASE:
# Type the URL and press Enter
```

**Output:**
```
Warning: No secure encryption provider available. Secrets will be stored without encryption.

  Secret stored: plain:4bdcecf9-e470-4864-9c4a-e029d334b693
  Config updated: qweather-mcp.transport.env.QWEATHER_API_KEY
```

**Note:** On Linux, secrets are stored without encryption by default. On Windows, `dpapi` encryption is used. On macOS, Keychain integration is planned.

### Step 2: Verify Secret Storage

```bash
# List all secrets
pfscan secrets ls
```

**Output:**
```
Found 2 secret(s):

  KIND       CONNECTOR/NAMESPACE   KEY                        STATUS    PROVIDER  CREATED
  ─────────  ────────────────────  ─────────────────────────  ────────  ────────  ───────────────────
  connector  qweather-mcp          QWEATHER_API_BASE          OK        plain     2026-01-22T14:14:03
  connector  qweather-mcp          QWEATHER_API_KEY           OK        plain     2026-01-22T14:13:55
```

### Step 3: View Connector with Secrets

```bash
pfscan connectors show --id qweather-mcp
```

**Output:**
```
(2 secrets redacted)

{
  "id": "qweather-mcp",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "qweather-mcp@1.0.12"
    ],
    "env": {
      "QWEATHER_API_KEY": "***SECRET_REF***",
      "QWEATHER_API_BASE": "***SECRET_REF***"
    }
  }
}
```

**Key Points:**
- ✅ Secrets are **masked** in output
- ✅ Config references secrets by ID, not plain text
- ✅ Secrets are **resolved at runtime** when the connector starts

---

## Proxy Management

### Starting the Proxy

The proxy aggregates tools from multiple connectors and exposes them through a single MCP interface.

```bash
# Start proxy with specific connectors
pfscan proxy start --connectors qweather-mcp

# Or start with all enabled connectors
pfscan proxy start --all
```

**Note:** The proxy runs in the foreground and prints JSON-RPC messages. Run it in a separate terminal or use a process manager.

### Checking Proxy Status

```bash
# View proxy status via IPC
pfscan proxy status
```

**Output:**
```
Proxy Status
═══════════════════════════════════════════════════

State:        RUNNING
Mode:         stdio
PID:          14554
Started:      2026-01-22T14:14:40.015Z
Uptime:       5s
Heartbeat:    just now

Connectors:
  ● qweather-mcp: 9 tools

Clients:
  (none)

Logging:
  Level:      WARN
  Buffered:   11/1000 lines
```

**Key Information:**
- ✅ **State**: RUNNING (proxy is active)
- ✅ **Connectors**: Lists active connectors and tool counts
- ✅ **Clients**: Shows connected MCP clients
- ✅ **Logging**: Proxy logs are buffered in memory

### Viewing Proxy Logs

```bash
# View recent logs
pfscan log --tail 50

# Filter by log level
pfscan log --tail 100 --level INFO
```

**Example Output:**
```
[14:14:40.017] INFO  [aggregator] Preloading tools from all connectors...
[14:14:46.541] INFO  Listed 9 tool(s) from qweather-mcp (session=1db6583d)
[14:14:46.541] INFO  [aggregator] Preloaded 9 tool(s)

--- Showing last 13 of 13 entries ---
```

### Reloading the Proxy (PR#66 Feature)

**Note:** This feature is part of PR#66 (MCP Control Plane). It allows hot-reloading of connector configuration without restarting the proxy.

```bash
# Reload proxy configuration
pfscan proxy reload
```

**Expected Behavior:**
- Reads updated `config.json`
- Reloads all connectors
- Maintains existing MCP client connections

**Current Status (Testing):**
```
Error: Proxy is not running
Start the proxy with: pfscan proxy start --all
```

**Note:** IPC (Inter-Process Communication) socket may not be created in non-interactive environments. This feature works best in production deployments.

### Stopping the Proxy

```bash
# Gracefully stop the proxy
pfscan proxy stop
```

---

## Configure Mode (Interactive)

**Status:** Available in PR#66 (feature/mcp-control-plane-v01)

Configure mode provides an interactive editing experience within the `psh` shell, similar to Cisco IOS or Juniper Junos CLI.

### Entering Configure Mode

```bash
# Start psh shell
psh

# Enter configure mode
pfscan> configure terminal

# You are now in configure mode
(config)>
```

### Editing a Connector

```bash
# Edit an existing connector
(config)> edit connector qweather-mcp

# Or create a new connector
(config)> edit connector my-new-server

# You are now editing the connector
(config-connector:qweather-mcp)>
```

### Setting Configuration Values

```bash
# Enable/disable the connector
(config-connector:qweather-mcp)> set enabled true

# Set the command
(config-connector:qweather-mcp)> set command npx

# Set command arguments
(config-connector:qweather-mcp)> set args "-y" "qweather-mcp@1.0.12"

# Set environment variables (automatically detected as secrets)
(config-connector:qweather-mcp)> set env.QWEATHER_API_KEY "your-api-key"
(config-connector:qweather-mcp)> set env.QWEATHER_API_BASE "https://devapi.qweather.com"

# Force a value to be treated as a secret
(config-connector:qweather-mcp)> set env.API_KEY "secret-value" --secret
```

**Secret Auto-Detection:**
- ✅ Values matching patterns like `sk-*`, `api_*`, `*_key`, `*_token` are auto-detected
- ✅ Use `--secret` flag to force secret storage
- ✅ Secrets are masked in `show` output

### Viewing Configuration

```bash
# Show current connector configuration
(config-connector:qweather-mcp)> show

# Show changes (diff)
(config-connector:qweather-mcp)> show diff
```

**Example `show` Output:**
```json
{
  "id": "qweather-mcp",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "qweather-mcp@1.0.12"],
    "env": {
      "QWEATHER_API_KEY": "***SECRET***",
      "QWEATHER_API_BASE": "***SECRET***"
    }
  }
}
```

**Example `show diff` Output:**
```diff
+ env.QWEATHER_API_KEY: (secret)
+ env.QWEATHER_API_BASE: (secret)
```

### Committing Changes

```bash
# Preview changes without saving
(config-connector:qweather-mcp)> commit --dry-run

# Save changes and reload proxy
(config-connector:qweather-mcp)> commit

# Save changes without reloading proxy
(config-connector:qweather-mcp)> commit --no-reload
```

**Commit Process:**
1. Validates configuration
2. Stores pending secrets in `secrets.db`
3. Updates `config.json`
4. (Optional) Sends `reload` command to proxy via IPC

### Discarding Changes

```bash
# Discard all pending changes
(config-connector:qweather-mcp)> discard

# Exit edit session
(config-connector:qweather-mcp)> exit
```

### Exiting Configure Mode

```bash
# Exit configure mode (with dirty check)
(config)> exit

# If you have unsaved changes:
You have unsaved changes. Use "commit" to save or "discard" to abandon changes.

# Return to normal shell
pfscan>
```

---

## Advanced Topics

### Using Secrets from Catalog Servers

Many MCP servers in the catalog require API keys. Here's a complete workflow:

```bash
# 1. Search for servers that require API keys
pfscan catalog search github

# 2. View details
pfscan catalog view ai.smithery/smithery-ai-github

# Example output:
#   Required: GITHUB_PERSONAL_ACCESS_TOKEN

# 3. Install the server
pfscan catalog install ai.smithery/smithery-ai-github --source official

# 4. Set the required secret
pfscan secrets set github-server GITHUB_PERSONAL_ACCESS_TOKEN
# (Enter your GitHub PAT when prompted)

# 5. Start the proxy
pfscan proxy start --connectors github-server
```

### Importing/Exporting Secrets

```bash
# Export secrets to an encrypted bundle
pfscan secrets export --output ~/backup/secrets-2026-01-22.enc

# Import secrets from a bundle
pfscan secrets import ~/backup/secrets-2026-01-22.enc
```

**Use Cases:**
- Backup before config changes
- Team sharing (with secure transfer)
- Environment migration

### Managing Orphan Secrets

When you delete a connector, its secrets may remain in storage.

```bash
# Remove secrets not referenced by any connector
pfscan secrets prune

# Dry-run mode (show what would be deleted)
pfscan secrets prune --dry-run
```

### Interactive Secret Wizard

```bash
# Edit all missing/placeholder secrets for a connector
pfscan secrets edit qweather-mcp

# Or run wizard for all connectors
pfscan secrets edit
```

---

## Troubleshooting

### Secret Not Detected

**Problem:**
```bash
pfscan connectors show --id my-server
# Output shows plain text instead of ***SECRET_REF***
```

**Solution:**
```bash
# Force secret storage with --secret flag in Configure Mode
(config-connector:my-server)> set env.MY_VAR "value" --secret

# Or use secrets set command
pfscan secrets set my-server MY_VAR
```

### Connector Not Starting

**Problem:**
```
pfscan proxy start --connectors my-server
# Connector shows "pending" or "error" in status
```

**Diagnosis:**
```bash
# Check connector configuration
pfscan connectors show --id my-server

# Check logs
pfscan log --tail 100

# Verify secrets exist
pfscan secrets ls
```

**Common Issues:**
1. Missing required environment variables
2. Incorrect command or args
3. Secret not resolved at runtime
4. npm package not found

### IPC Reload Not Working

**Problem:**
```
pfscan proxy reload
# Error: Proxy is not running
```

**Causes:**
- Proxy not started with IPC support
- Socket file not created (non-interactive environment)
- Proxy running but IPC server failed to start

**Solution:**
```bash
# Check proxy status
pfscan proxy status

# Check for socket file
ls -la ~/.config/proofscan/*.sock

# Restart proxy
pfscan proxy stop
pfscan proxy start --all
```

### Secrets Not Encrypted

**Warning:**
```
Warning: No secure encryption provider available. Secrets will be stored without encryption.
```

**Explanation:**
- **Linux**: No native encryption provider (secrets stored in plain text in `secrets.db`)
- **Windows**: DPAPI encryption is used automatically
- **macOS**: Keychain support is planned

**Workaround:**
- Use file system encryption (e.g., LUKS, FileVault)
- Set restrictive permissions: `chmod 600 ~/.config/proofscan/secrets.db`
- Store `secrets.db` on encrypted volumes

---

## Summary

### Key Commands

| Task | Command |
|------|---------|
| Search MCP servers | `pfscan catalog search <query>` |
| Install MCP server | `pfscan catalog install <server-id> --source official` |
| Set secret | `pfscan secrets set <connector> <KEY>` |
| List secrets | `pfscan secrets ls` |
| Start proxy | `pfscan proxy start --connectors <id1>,<id2>` |
| Check proxy status | `pfscan proxy status` |
| View logs | `pfscan log --tail 50` |
| Reload proxy | `pfscan proxy reload` |
| Stop proxy | `pfscan proxy stop` |

### Configure Mode Commands

| Task | Command |
|------|---------|
| Enter configure mode | `configure terminal` |
| Edit connector | `edit connector <id>` |
| Set value | `set <path> <value> [--secret]` |
| Show config | `show` |
| Show diff | `show diff` |
| Commit changes | `commit [--dry-run] [--no-reload]` |
| Discard changes | `discard` |
| Exit | `exit` |

### Best Practices

1. **Always use secrets for API keys**: Don't store keys in plain text in config
2. **Use interactive mode**: Type secrets instead of piping them from command line
3. **Verify after changes**: Run `pfscan connectors show` to confirm configuration
4. **Check logs**: Use `pfscan log` to diagnose connector issues
5. **Backup secrets**: Use `pfscan secrets export` before major changes
6. **Prune regularly**: Remove orphan secrets with `pfscan secrets prune`

---

## Related Documentation

- [Proxy Guide](./PROXY.md) - MCP Proxy architecture and advanced usage
- [Shell Guide](./SHELL.md) - Interactive shell features and workflows
- [Secret Management](./GUIDE.md#secrets) - Detailed secret storage information

---

**Questions or Issues?**

- GitHub Issues: https://github.com/proofofprotocol/proofscan/issues
- Pull Request: https://github.com/proofofprotocol/proofscan/pull/66 (Configure Mode)

---

**Last Updated:** 2026-01-22  
**Version:** 0.10.55 (feature/mcp-control-plane-v01)
