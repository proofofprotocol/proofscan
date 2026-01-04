# proofscan POPL Guide

Public Observable Proof Ledger (POPL) - Create public-safe audit trails from MCP sessions.

## Table of Contents

- [What is POPL?](#what-is-popl)
- [Getting Started](#getting-started)
- [Creating POPL Entries](#creating-popl-entries)
- [Entry Structure](#entry-structure)
- [Sanitization](#sanitization)
- [Trust Levels](#trust-levels)
- [Use Cases](#use-cases)
- [Shell Mode Support](#shell-mode-support)
- [Best Practices](#best-practices)

## What is POPL?

POPL (Public Observable Proof Ledger) generates **public-safe audit trails** from MCP sessions. All sensitive data (paths, secrets, PII) is automatically sanitized.

### Key Features

- 🔒 **Automatic Sanitization**: Removes secrets, paths, PII
- 📊 **Session Metadata**: Preserves session structure, timing, status
- 🔐 **Content Hashing**: RPC payloads replaced with SHA-256 hashes
- 📝 **Reproducible**: Includes generation log
- 🌐 **Public-Safe**: Safe to share publicly or in bug reports

### Why POPL?

- **Bug Reports**: Include execution evidence without exposing secrets
- **Auditing**: Track tool usage and permissions
- **Documentation**: Generate reproducible examples
- **Compliance**: Create audit trails for regulated environments
- **Debugging**: Share session details with support without security risks

## Getting Started

### 1. Initialize POPL Directory

```bash
cd /path/to/project
pfscan popl init
```

This creates:
```
.popl/
├── README.md               # POPL documentation
└── entries/                # POPL entries stored here
```

### 2. Run a Scan

```bash
pfscan scan start --id time
```

### 3. Create POPL Entry

```bash
# Get session ID from recent scans
pfscan tree

# Create entry
pfscan popl session --session <session-id>

# Or with title
pfscan popl session --session abc123 --title "Time Server Test"
```

## Creating POPL Entries

### CLI Mode

```bash
# Basic usage
pfscan popl session --session <session-id>

# With title
pfscan popl session --session abc123 --title "Production Test"

# With description
pfscan popl session --session abc123 \
  --title "Weather API Integration" \
  --description "Testing weather forecast tool"
```

**Note:** CLI requires explicit session ID. Use [Shell Mode](#shell-mode-support) for @references.

### Options

```bash
--session <id>          # Session ID (required, partial ID works)
--title <title>         # Entry title
--description <text>    # Entry description
```

### Output

```
✓ POPL entry created: 20260104-abc123

Entry location:
  .popl/entries/20260104-abc123/

Files created:
  POPL.yml              # Entry metadata
  status.json           # Session summary
  rpc.sanitized.jsonl   # Sanitized RPC events
  validation-run.log    # Generation log
```

## Entry Structure

Each POPL entry is a directory with structured files:

```
.popl/entries/20260104-abc123/
├── POPL.yml              # Entry metadata
├── status.json           # Session summary (public-safe)
├── rpc.sanitized.jsonl   # Sanitized RPC events
└── validation-run.log    # Generation log
```

### POPL.yml

Entry metadata and evidence summary.

```yaml
version: 1
entry_id: 20260104-abc123
entry_type: session
created_at: '2026-01-04T12:00:00Z'

# Session metadata
session:
  id: abc123...
  connector_id: time
  started_at: '2026-01-04T11:55:00Z'
  ended_at: '2026-01-04T11:55:05Z'
  duration_ms: 5000
  exit_reason: normal

# Summary
summary:
  rpc_count: 2
  event_count: 8
  tool_calls: 1
  errors: 0

# Artifacts with hashes
artifacts:
  - name: status.json
    sha256: abc123...
    size_bytes: 1234
  - name: rpc.sanitized.jsonl
    sha256: def456...
    size_bytes: 5678

# Trust information
trust:
  level: 0
  label: recorded
  verified_by: null
  attestation: null

# Sanitization applied
sanitization:
  ruleset_version: 1
  secrets_redacted: true
  paths_redacted: true
  payloads_hashed: true
```

### status.json

Session summary (safe for public sharing).

```json
{
  "session_id": "abc123...",
  "connector_id": "time",
  "started_at": "2026-01-04T11:55:00Z",
  "ended_at": "2026-01-04T11:55:05Z",
  "duration_ms": 5000,
  "exit_reason": "normal",
  "rpc_summary": {
    "total": 2,
    "ok": 2,
    "error": 0,
    "pending": 0
  },
  "tool_calls": [
    {
      "tool_name": "get_current_time",
      "status": "ok",
      "timestamp": "2026-01-04T11:55:03Z"
    }
  ],
  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false
  }
}
```

### rpc.sanitized.jsonl

Sanitized RPC events (JSON Lines format).

```jsonl
{"ts":"2026-01-04T11:55:01.123Z","type":"req","method":"initialize","rpc_id":1,"args_hash":"sha256:abc..."}
{"ts":"2026-01-04T11:55:01.456Z","type":"res","method":"initialize","rpc_id":1,"result_hash":"sha256:def...","status":"ok"}
{"ts":"2026-01-04T11:55:03.789Z","type":"req","method":"tools/call","rpc_id":2,"tool":"get_current_time","args_hash":"sha256:ghi..."}
{"ts":"2026-01-04T11:55:03.890Z","type":"res","method":"tools/call","rpc_id":2,"result_hash":"sha256:jkl...","status":"ok"}
```

**Fields:**
- `ts`: Timestamp
- `type`: req (request) or res (response)
- `method`: RPC method
- `rpc_id`: RPC identifier
- `args_hash`: SHA-256 hash of arguments (not raw arguments)
- `result_hash`: SHA-256 hash of result (not raw result)
- `status`: ok or error

### validation-run.log

Generation log showing the sanitization process.

```
=== POPL Entry Generation ===
Date: 2026-01-04T12:00:00Z
Session: abc123...
Connector: time

Step 1: Load session data
  ✓ Loaded 2 RPCs
  ✓ Loaded 8 events

Step 2: Sanitize data
  ✓ Redacted 0 secrets
  ✓ Redacted 3 file paths
  ✓ Hashed 2 RPC payloads

Step 3: Generate artifacts
  ✓ Created POPL.yml
  ✓ Created status.json
  ✓ Created rpc.sanitized.jsonl

Step 4: Calculate hashes
  ✓ status.json: sha256:abc...
  ✓ rpc.sanitized.jsonl: sha256:def...

=== Generation Complete ===
Entry ID: 20260104-abc123
Location: .popl/entries/20260104-abc123/
```

## Sanitization

POPL applies automatic sanitization to protect sensitive data.

### Ruleset v1

Current sanitization rules:

#### 1. Secrets (REDACTED)

- API keys: `OPENAI_API_KEY`, `GITHUB_TOKEN`, etc.
- Tokens: JWT, Bearer tokens
- Passwords: Any field containing "password", "passwd", "pwd"
- Auth headers: `Authorization`, `X-API-Key`, etc.

**Example:**
```json
// Before
{"headers": {"Authorization": "Bearer sk-abc123..."}}

// After
{"headers": {"Authorization": "[REDACTED]"}}
```

#### 2. File Paths (REDACTED)

- Absolute paths: `/home/user/...`, `C:\Users\...`
- Home directory: `~/.config/...`
- Temp directories: `/tmp/...`, `/var/tmp/...`

**Example:**
```json
// Before
{"file": "/home/user/projects/secret/data.json"}

// After
{"file": "[REDACTED_PATH]"}
```

#### 3. RPC Payloads (HASHED)

- Request arguments: Replaced with SHA-256 hash
- Response results: Replaced with SHA-256 hash

**Example:**
```jsonl
// Before
{"method":"tools/call","args":{"timezone":"UTC"}}

// After
{"method":"tools/call","args_hash":"sha256:abc123..."}
```

**Why hash instead of redact?**
- Preserves data structure (you can see there were arguments)
- Allows verification (same input = same hash)
- Prevents exposure of actual values

#### 4. Metadata Preserved

- Timestamps (exact timing)
- Method names
- Session IDs
- RPC IDs
- Status codes (ok/error)
- Latency
- Connector IDs

## Trust Levels

POPL entries have trust levels indicating verification status.

| Level | Label | Description | Verification |
|-------|-------|-------------|--------------|
| 0 | Recorded | Self-reported, no verification | None |
| 1 | Verified | Signature verified | Cryptographic signature |
| 2 | Attested | Third-party attestation | Independent party |
| 3 | Certified | Formal certification | Certification authority |

### Level 0: Recorded (Default)

- Generated by proofscan
- No external verification
- Trust based on generator

**Use when:**
- Personal documentation
- Internal bug reports
- Development logs

### Level 1: Verified (Future)

- Entry signed with private key
- Signature verifiable with public key
- Proves entry created by key holder

**Use when:**
- Public bug reports
- Open source contributions
- Sharing with untrusted parties

### Level 2: Attested (Future)

- Third party verifies entry
- Attestation signed by attestor
- Proves independent review

**Use when:**
- Compliance requirements
- Auditing
- Legal evidence

### Level 3: Certified (Future)

- Formal certification authority
- Meets specific standards
- Official documentation

**Use when:**
- Regulatory compliance
- Safety-critical systems
- Financial auditing

**Note:** Levels 1-3 are planned features. Currently all entries are Level 0.

## Use Cases

### 1. Bug Reports

**Scenario:** MCP server crashes or behaves unexpectedly.

```bash
# Reproduce bug
pfscan scan start --id problematic-server

# Create POPL entry
pfscan popl session --session <session> --title "Server Crash on tools/list"

# Share .popl/entries/20260104-xyz/ with maintainers
```

**Benefits:**
- No secrets exposed
- Complete execution trace
- Reproducible evidence

### 2. API Documentation

**Scenario:** Document how your MCP server works.

```bash
# Run typical workflows
pfscan scan start --id myserver

# Create entries for each workflow
pfscan popl session --session abc --title "User Registration Flow"
pfscan popl session --session def --title "Data Query Flow"

# Include in documentation repository
git add .popl/entries/
git commit -m "docs: add execution examples"
```

### 3. Compliance Auditing

**Scenario:** Demonstrate proper tool usage for compliance.

```bash
# Run compliance test
pfscan scan start --id production-server

# Create audit entry
pfscan popl session --session <session> \
  --title "Q1 2026 Compliance Check" \
  --description "Verified data access permissions"

# Archive for compliance records
tar czf compliance-q1-2026.tar.gz .popl/entries/20260104-*
```

### 4. Performance Analysis

**Scenario:** Analyze tool latency and identify bottlenecks.

```bash
# Run performance test
pfscan scan start --id api-server

# Create entry
pfscan popl session --session <session> --title "Performance Baseline"

# Analyze rpc.sanitized.jsonl for latency
jq -r 'select(.type=="res") | "\(.method) \(.latency_ms)ms"' \
  .popl/entries/*/rpc.sanitized.jsonl
```

### 5. Integration Testing

**Scenario:** Share test results with integration partners.

```bash
# Run integration test
pfscan scan start --id partner-api

# Create shareable entry
pfscan popl session --session <session> \
  --title "Integration Test Results" \
  --description "Partner API v2 integration"

# Share with partner (no secrets exposed)
zip -r integration-test.zip .popl/entries/20260104-*/
```

## Shell Mode Support

In [Shell Mode](SHELL.md), POPL commands support @references:

```bash
pfscan shell

# Create entry from current context
proofscan> popl @this

# Create entry from latest session
proofscan> popl @last

# Create entry from named reference
proofscan> ref add important @this
proofscan> popl @ref:important --title "Important Test"

# Shortcut: omit 'session'
proofscan> popl @last
# Same as: popl session @last
```

See [Shell Mode Guide](SHELL.md#popl-commands) for details.

## Best Practices

### 1. Descriptive Titles

```bash
# Good
pfscan popl session --session abc --title "OAuth Flow: Token Refresh Error"

# Bad
pfscan popl session --session abc --title "Test"
```

### 2. Include Context

```bash
pfscan popl session --session abc \
  --title "Weather API: Timeout on get_forecast" \
  --description "London location, 5s timeout, 3 retries"
```

### 3. Organize by Date

POPL automatically prefixes entries with date (YYYYMMDD-sessionid), making it easy to organize:

```bash
ls -la .popl/entries/
20260103-abc123/
20260104-def456/
20260104-ghi789/
```

### 4. Archive Old Entries

```bash
# Archive entries older than 30 days
find .popl/entries/ -name "202512*" -type d | \
  tar czf popl-archive-2025-12.tar.gz -T -

# Remove archived entries
rm -rf .popl/entries/202512*
```

### 5. Verify Hashes

```bash
# Verify artifact integrity
cd .popl/entries/20260104-abc123/
sha256sum -c <<EOF
abc123... status.json
def456... rpc.sanitized.jsonl
EOF
```

### 6. Version Control

```bash
# Add POPL entries to git
git add .popl/
git commit -m "docs: add execution examples"

# .gitignore sensitive configs
echo "config.json" >> .gitignore
echo "secrets.json" >> .gitignore
```

### 7. Review Before Sharing

Even with sanitization, review entries before sharing:

```bash
# Check for custom sensitive fields
grep -ri "password\|secret\|key" .popl/entries/20260104-abc123/

# Review POPL.yml
cat .popl/entries/20260104-abc123/POPL.yml

# Check status.json for unexpected data
cat .popl/entries/20260104-abc123/status.json
```

## Commands Reference

### popl init

```bash
pfscan popl init        # Initialize .popl/ in current directory
```

### popl session

```bash
pfscan popl session --session <id>                          # Basic
pfscan popl session --session abc --title "My Test"         # With title
pfscan popl session --session abc --title "..." --description "..."
```

### popl list

```bash
pfscan popl list        # List all entries
pfscan popl ls          # Alias
```

**Output:**
```
POPL entries in .popl/entries/:
  20260104-abc123  Production Test       2026-01-04 12:00
  20260103-def456  Integration Test      2026-01-03 15:30
  20260102-ghi789  Initial Setup         2026-01-02 09:00
```

### popl show

```bash
pfscan popl show <entry-id>
pfscan popl show 20260104-abc123
```

**Output:**
```
POPL Entry: 20260104-abc123
═══════════════════════════════════════════════════

Title:        Production Test
Created:      2026-01-04T12:00:00Z
Session:      abc123...
Connector:    time

Summary:
  RPCs:       2 (2 OK, 0 ERR)
  Events:     8
  Duration:   5.0s

Trust:
  Level:      0 (Recorded)
  Verified:   No

Files:
  POPL.yml              1.2KB  sha256:abc...
  status.json           850B   sha256:def...
  rpc.sanitized.jsonl   2.3KB  sha256:ghi...
  validation-run.log    1.5KB
```

## Troubleshooting

### No .popl Directory

**Error:** `POPL directory not found`

**Fix:**
```bash
pfscan popl init
```

### Session Not Found

**Error:** `Session not found: abc123`

**Fix:**
```bash
# Verify session exists
pfscan tree

# Use correct session ID
pfscan popl session --session <correct-id>
```

### Sensitive Data in Entry

**Issue:** Entry contains data you don't want to share.

**Fix:**
1. Review sanitization rules (may need to extend)
2. Manually edit entry files before sharing
3. Report issue if sanitization missed something

### Entry Already Exists

**Error:** `Entry already exists: 20260104-abc123`

**Fix:**
```bash
# Remove old entry
rm -rf .popl/entries/20260104-abc123/

# Regenerate
pfscan popl session --session abc123
```

---

**Related:**
- [User Guide](GUIDE.md) - Complete CLI reference
- [Shell Mode](SHELL.md) - @reference support for POPL
- [Proxy Guide](PROXY.md) - Recording proxy sessions
