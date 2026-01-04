# proofscan Shell Mode Guide

The interactive shell provides a powerful REPL (Read-Eval-Print Loop) for working with proofscan. It features TAB completion, command history, context management, and special @reference syntax.

## Table of Contents

- [Starting the Shell](#starting-the-shell)
- [Basic Commands](#basic-commands)
- [Context Management](#context-management)
- [@Reference System](#reference-system)
- [Router Commands](#router-commands)
- [Tool Commands](#tool-commands)
- [POPL Commands](#popl-commands)
- [Pipe Support](#pipe-support)
- [TAB Completion](#tab-completion)
- [Tips and Tricks](#tips-and-tricks)

## Starting the Shell

```bash
$ pfscan shell
proofscan>
```

The shell provides:
- ✅ **TAB completion** for commands, connectors, sessions, RPCs
- ✅ **Command history** (up/down arrows)
- ✅ **Context awareness** (remembers current connector/session)
- ✅ **@references** for easy data access
- ✅ **Pipe support** for command chaining

**Note:** Shell mode requires an interactive terminal (TTY). It cannot be used in scripts or pipes.

## Basic Commands

### Built-in Commands

| Command | Description |
|---------|-------------|
| `help` | Show available commands |
| `exit` | Exit the shell |
| `clear` | Clear the screen |
| `history` | Show command history |

### All CLI Commands Available

In shell mode, you can use any `pfscan` command without the `pfscan` prefix:

```bash
proofscan> view --limit 10
proofscan> tree
proofscan> status
proofscan> scan start --id time
```

**Blocked commands:** `shell` (already in shell mode)

## Context Management

The shell maintains a **context** that tracks:
- Current **connector**
- Current **session**

Context is displayed in the prompt and used by commands that accept @references.

### Router Commands (cd-style navigation)

| Command | Description | Example |
|---------|-------------|---------|
| `pwd` | Show current context | `pwd` |
| `pwd --json` | Show context as JSON | `pwd --json` |
| `cc <connector>` | Change connector | `cc time` |
| `cd <session>` | Navigate to session | `cd abc123` |
| `ls` | List items in current context | `ls` |
| `show` | Show details of current context | `show` |

#### Examples

```bash
# Show current context
proofscan> pwd
No context set

# Navigate to connector
proofscan> cc time
✓ Switched to connector: time

# Show context
proofscan> pwd
Context: connector=time

# Navigate to session (partial ID works)
proofscan> cd f2442c
✓ Switched to session: f2442c9b (connector=time)

# Show full context
proofscan> pwd
Context: session=f2442c9b (connector=time)

# List sessions in current connector
proofscan> ls
Sessions in connector 'time':
  [1] f2442c9b... (2 RPCs, 8 events) 2026-01-04 12:01
  [2] 3cf5a66e... (2 RPCs, 8 events) 2026-01-04 11:45
```

## @Reference System

The shell supports a powerful @reference syntax for accessing data without typing full IDs.

### Built-in References

| Reference | Description |
|-----------|-------------|
| `@this` | Current context (connector or session) |
| `@last` | Latest session or RPC |
| `@rpc:<id>` | Specific RPC by ID |
| `@session:<id>` | Specific session by ID (partial OK) |
| `@ref:<name>` | User-defined named reference |

### Using References

References can be used with most commands:

```bash
# View current session
proofscan> tree @this

# Create POPL entry for latest session
proofscan> popl @last

# Call tool with RPC reference
proofscan> tool call @rpc:2

# Show details of named reference
proofscan> ref @ref:mytask
```

## Router Commands

### pwd - Print Working Context

Show current context (connector and/or session).

```bash
# Simple output
proofscan> pwd
Context: session=f2442c9b (connector=time)

# JSON output
proofscan> pwd --json
{
  "connector": "time",
  "session": "f2442c9b"
}

# Pipe to save as reference
proofscan> pwd --json | ref add mycontext
✓ Reference 'mycontext' saved
```

### cd / cc - Change Context

Navigate between contexts (`cd` and `cc` are aliases).

```bash
# Navigate to root
proofscan> cd /
✓ Switched to root

# Navigate to connector
proofscan> cd time
✓ Switched to connector: time

# Navigate to session (from connector context)
proofscan> cd f2442c
✓ Switched to session: f2442c9b (connector=time)

# Direct path
proofscan> cd time/f2442c
✓ Switched to session: f2442c9b (connector=time)

# Go up one level (use .. command)
proofscan> ..
✓ Moved up to connector: time

# Go up with cd
proofscan> cd ..
✓ Moved up to connector: time

# Go back to previous location
proofscan> cd -
✓ Switched to previous location

# Jump to latest session
proofscan> cd @last
✓ Switched to latest session

# With TAB completion
proofscan> cd <TAB>
time    weather    filesystem

# From connector context
proofscan> cd time
proofscan> cd <TAB>
f2442c9b...    3cf5a66e...    7a1b3c5d...
```

### ls - List Items

List items in current context.

```bash
# In connector context: list sessions
proofscan> cc time
proofscan> ls
Sessions in connector 'time':
  [1] f2442c9b... (2 RPCs, 8 events) 2026-01-04 12:01
  [2] 3cf5a66e... (2 RPCs, 8 events) 2026-01-04 11:45

# In session context: list RPCs
proofscan> cd f2442c
proofscan> ls
RPCs in session 'f2442c9b':
  [1] initialize (id=1, 269ms)
  [2] tools/list (id=2, 12ms)

# No context: list connectors
proofscan> pwd
No context set
proofscan> ls
Connectors:
  [1] time (3 sessions)
  [2] weather (1 session)
```

### show - Show Details

Show details of current context.

```bash
# In connector context
proofscan> cc time
proofscan> show
Connector: time
Type: stdio
Command: npx -y @modelcontextprotocol/server-time
Sessions: 3
Enabled: yes

# In session context
proofscan> cd f2442c
proofscan> show
Session: f2442c9b
Connector: time
Started: 2026-01-04T12:01:58.610Z
Ended: 2026-01-04T12:02:01.150Z
Duration: 2540ms
RPCs: 2 (2 OK, 0 ERR)
Events: 8
```

## ref Commands

Manage user-defined references.

### ref add - Save Reference

Save current context or specific reference with a name.

```bash
# Save current context
proofscan> ref add mytask @this
✓ Reference 'mytask' saved (session: f2442c9b, connector: time)

# Save latest session
proofscan> ref add lastscan @last
✓ Reference 'lastscan' saved (session: 3cf5a66e)

# Save specific RPC
proofscan> ref add initcall @rpc:1
✓ Reference 'initcall' saved (rpc: 1, session: f2442c9b)

# Save from piped JSON
proofscan> pwd --json | ref add mycontext
✓ Reference 'mycontext' saved
```

**Valid reference names:**
- Alphanumeric, hyphens, underscores only: `[a-zA-Z0-9_-]+`
- Max 64 characters
- Cannot start with @
- Reserved names: `this`, `last`, `rpc`, `session`, `fav`, `ref`

### ref ls - List References

List all saved references.

```bash
proofscan> ref ls
Saved references:
  mytask      → session=f2442c9b, connector=time
  lastscan    → session=3cf5a66e, connector=time
  initcall    → rpc=1, session=f2442c9b
  mycontext   → session=f2442c9b, connector=time
```

### ref rm - Remove Reference

Remove a saved reference.

```bash
proofscan> ref rm mytask
✓ Reference 'mytask' removed

proofscan> ref rm nosuchref
✗ Reference not found: nosuchref
```

### ref @target - Resolve Reference

Display what a reference points to.

```bash
# Resolve @this
proofscan> ref @this
Reference: @this
Type: session
Session: f2442c9b
Connector: time

# Resolve @last
proofscan> ref @last
Reference: @last
Type: session
Session: 3cf5a66e (latest)
Connector: time

# Resolve named reference
proofscan> ref @ref:mytask
Reference: @ref:mytask
Type: session
Session: f2442c9b
Connector: time

# JSON output
proofscan> ref @this --json
{
  "type": "session",
  "sessionId": "f2442c9b",
  "connectorId": "time"
}
```

## Tool Commands

Execute MCP tools directly from the shell.

### tool ls - List Tools

```bash
# In connector context
proofscan> cc time
proofscan> tool ls
Found 2 tools:
  get_current_time    Get the current time in a specific timezone
  get_timezone        Get timezone information

# Explicit connector
proofscan> tool ls weather
Found 3 tools:
  get_forecast    Get weather forecast
  get_current     Get current weather
  get_alerts      Get weather alerts
```

### tool show - Show Tool Schema

```bash
proofscan> tool show time get_current_time
Tool: get_current_time
Description: Get the current time in a specific timezone

Required arguments:
  timezone    string    IANA timezone (e.g., America/New_York)

Optional arguments:
  format      string    Time format (iso, unix, human)
```

### tool call - Call Tool

```bash
# Simple call (no arguments)
proofscan> tool call time get_timezone --args '{}'
Result:
  timezone: America/New_York
  offset: -05:00
  dst: false

# With arguments
proofscan> tool call time get_current_time --args '{"timezone":"Asia/Tokyo"}'
Result:
  time: 2026-01-04T21:30:45+09:00
  timezone: Asia/Tokyo
  formatted: 21:30:45 JST

# From file
proofscan> tool call time get_current_time --args-file args.json

# From stdin
proofscan> echo '{"timezone":"UTC"}' | tool call time get_current_time --stdin

# Dry run (don't actually call)
proofscan> tool call time get_current_time --args '{"timezone":"UTC"}' --dry-run
Dry run - would send:
  Connector: time
  Tool: get_current_time
  Arguments: {"timezone":"UTC"}
```

## POPL Commands

Create public-safe audit trails from sessions.

### popl init - Initialize POPL Directory

```bash
proofscan> popl init
✓ POPL directory initialized at: /current/dir/.popl
```

### popl session - Create POPL Entry

Create a POPL entry from a session.

```bash
# From current context
proofscan> popl session @this
✓ POPL entry created: 20260104-f2442c9b
Files:
  .popl/entries/20260104-f2442c9b/POPL.yml
  .popl/entries/20260104-f2442c9b/status.json
  .popl/entries/20260104-f2442c9b/rpc.sanitized.jsonl

# From latest session
proofscan> popl @last
✓ POPL entry created: 20260104-3cf5a66e

# From named reference
proofscan> popl @ref:mytask --title "Production Test"
✓ POPL entry created: 20260104-f2442c9b
Title: Production Test

# Shortcut: omit 'session'
proofscan> popl @last
# Same as: popl session @last
```

**POPL sanitization:**
- File paths redacted
- Secrets removed
- RPC payloads hashed
- Safe for public sharing

### popl list - List Entries

```bash
proofscan> popl list
POPL entries:
  20260104-f2442c9b  Production Test      2026-01-04 12:05
  20260104-3cf5a66e  Debug Session        2026-01-04 11:50
  20260103-7a1b3c5d  Initial Scan         2026-01-03 18:30
```

### popl show - Show Entry Details

```bash
proofscan> popl show 20260104-f2442c9b
Entry: 20260104-f2442c9b
Title: Production Test
Created: 2026-01-04T12:05:30Z
Session: f2442c9b
Connector: time
RPCs: 2
Sanitized: yes
Files:
  POPL.yml
  status.json
  rpc.sanitized.jsonl
  validation-run.log
```

## Pipe Support

The shell supports piping data between commands.

### Basic Piping

```bash
# Pipe pwd output to ref
proofscan> pwd --json | ref add mycontext

# Pipe view output to ref
proofscan> view --limit 1 --json | ref add lastevent
```

### Supported Pipe Commands

| Left Side | Right Side | Description |
|-----------|------------|-------------|
| `pwd --json` | `ref add <name>` | Save context as reference |
| `view --json` | `ref add <name>` | Save event as reference |
| `rpc list --json` | `ref add <name>` | Save RPC list as reference |
| `rpc show --json` | `ref add <name>` | Save RPC details as reference |

## TAB Completion

The shell provides intelligent TAB completion for:

### Command Completion

```bash
proofscan> vi<TAB>
view

proofscan> co<TAB>
config    connectors
```

### Connector Completion

```bash
proofscan> cc <TAB>
time    weather    filesystem

proofscan> scan start --id <TAB>
time    weather    filesystem
```

### Session Completion

```bash
proofscan> cd <TAB>
f2442c9b    3cf5a66e    7a1b3c5d

proofscan> rpc list --session <TAB>
f2442c9b    3cf5a66e    7a1b3c5d
```

### RPC ID Completion

```bash
proofscan> rpc show --session f2442c --id <TAB>
1    2

proofscan> ref add mycall @rpc:<TAB>
1    2    3
```

### Reference Name Completion

```bash
proofscan> ref @ref:<TAB>
mytask    lastscan    initcall    mycontext

proofscan> ref rm <TAB>
mytask    lastscan    initcall    mycontext
```

## Tips and Tricks

### Quick Navigation

```bash
# Jump directly to session
proofscan> up abc<TAB>  # Completes to abc123...

# Use partial IDs
proofscan> cd f24       # Matches f2442c9b
```

### Context Shortcuts

```bash
# Save current work
proofscan> ref add wip @this

# Resume later
proofscan> ref @ref:wip
proofscan> cd @ref:wip
```

### POPL Workflow

```bash
# After scanning
proofscan> scan start --id time
proofscan> popl @last --title "Time Server Validation"

# Review and share
proofscan> popl list
proofscan> popl show <entry-id>
```

### Command History

```bash
# Press UP arrow to cycle through history
# Press CTRL+R to search history (if supported by terminal)
```

### Batch Operations

```bash
# Add multiple references
proofscan> cc time
proofscan> ref add time-ctx @this
proofscan> cd f2442c
proofscan> ref add time-session @this
proofscan> tool call get_current_time --args '{}'
proofscan> ref add time-call @last
```

### Error Recovery

If a command fails:
- Check context with `pwd`
- Verify connector exists: `cc <TAB>`
- Verify session exists: `up <TAB>`
- Check command syntax: `<command> --help`

### Performance Tips

- Use partial IDs to avoid typing full session IDs
- Use @references instead of copying/pasting IDs
- Use TAB completion extensively
- Save frequently used contexts as named references

## Limitations

- Shell requires interactive terminal (TTY)
- Cannot be used in scripts or non-interactive pipes
- Some commands (like `explore`) may not work well in shell mode
- Long-running commands block the shell (use `scan` in separate terminal)

## Shell-Only Features

These features are **only available in shell mode**, not in regular CLI:

✅ Context management (pwd, cc, up)
✅ @references (@this, @last, @ref:name)
✅ Router commands (ls, show)
✅ TAB completion for everything
✅ Command history
✅ Pipe support
✅ Named reference storage

Regular CLI commands work in both modes but don't have @reference support.

## Examples

### Complete Session Analysis

```bash
$ pfscan shell

# Navigate to connector
proofscan> cc time

# List sessions
proofscan> ls

# Select session
proofscan> cd f2442c

# Show details
proofscan> show

# View RPCs
proofscan> rpc list --session @this

# Create POPL entry
proofscan> popl @this --title "Time Server Analysis"

# Save reference for later
proofscan> ref add time-analysis @this
```

### Tool Testing Workflow

```bash
# Navigate and list tools
proofscan> cc weather
proofscan> tool ls

# Test tool
proofscan> tool show get_forecast
proofscan> tool call get_forecast --args '{"location":"Tokyo"}'

# Save for documentation
proofscan> ref add weather-test @last
proofscan> popl @ref:weather-test --title "Weather Tool Test"
```

---

**Next:** See [User Guide](GUIDE.md) for complete CLI reference or [POPL Guide](POPL.md) for audit trail creation.
