# Phase 2.1 CLI UX Improvements

## Issue Fixed: Root Help Discoverability

### Problem
Running `pfscan --help` previously showed `pfscan view` help instead of the root help with all commands:

```
$ pfscan --help
Usage: pfscan view [options]  # Wrong! Should show all commands
```

### Solution
Modified `cli.ts` to detect `--help` and `-h` flags before inserting the default `view` command.

### Current Behavior

#### `pfscan --help` (Root Help)
```
proofscan - MCP Server scanner
Eliminate black boxes by capturing JSON-RPC communication.

Common Commands:
  view, v       View recent events timeline (default)
  tree, t       Show connector -> session -> rpc structure
  explore, e    Interactive data browser
  scan, s       Run a new scan
  status, st    Show system status

Management:
  archive, a    Archive and prune old data
  config, c     Configuration management
  connectors    Connector management

Shortcuts:
  v=view  t=tree  e=explore  s=scan  st=status  a=archive  c=config

Examples:
  pfscan                      # View recent events (default)
  pfscan view --limit 50      # View last 50 events
  pfscan view --pairs         # View request/response pairs
  pfscan tree                 # Show structure overview
  pfscan scan start --id mcp  # Start scanning connector 'mcp'
  pfscan status               # Show system status

Usage: pfscan [options] [command]

MCP Server scanner - eliminate black boxes by capturing JSON-RPC

Options:
  -V, --version               output the version number
  -c, --config <path>         Path to config file
  --json                      Output in JSON format
  -v, --verbose               Verbose output
  -h, --help                  display help for command

Commands:
  view [options]              View recent events timeline (default command)
  v [options]                 Alias for view
  tree [options] [connector]  Show hierarchical view
  t [options] [connector]     Alias for tree
  explore [options]           Interactive exploration
  e [options]                 Alias for explore
  status                      Show database and system status
  st                          Alias for status
  scan                        Scan MCP servers
  s                           Alias for scan
  archive                     Manage data retention and cleanup
  a                           Alias for archive
  config                      Manage proofscan configuration
  c                           Alias for config
  connectors                  Manage MCP server connectors
  sessions                    Manage scan sessions
  monitor                     Monitor scan events
  events                      List and export events
  help [command]              display help for command
```

#### `pfscan view --help` (Command-specific Help)
```
Usage: pfscan view [options]

View recent events timeline (default command)

Options:
  -n, --limit <n>       Number of events to show (default: 20)
  --pairs               Show request/response pairs
  --connector <id>      Filter by connector
  --session <id>        Filter by session
  --method <name>       Filter by method name
  --since <time>        Show events since (e.g., "1h", "30m", "2024-01-01")
  -h, --help            display help for command
```

#### `pfscan` (No Arguments - Default Command)
Runs `pfscan view` as before:
```
$ pfscan
No events found.

hint: Run a scan first: pfscan scan start --id <connector>
```

## Implementation Details

### Code Changes (`src/cli.ts`)

Added `hasHelpFlag()` function:
```typescript
function hasHelpFlag(): boolean {
  return process.argv.includes('--help') || process.argv.includes('-h');
}
```

Modified default command insertion:
```typescript
// Before
if (!hasSubcommand()) {
  process.argv.splice(2, 0, 'view');
}

// After
if (!hasSubcommand() && !hasHelpFlag()) {
  process.argv.splice(2, 0, 'view');
}
```

Added Examples section to HELP_HEADER.

## Test Matrix

| Command | Expected Result | Status |
|---------|-----------------|--------|
| `pfscan --help` | Shows root help with all commands | OK |
| `pfscan -h` | Shows root help with all commands | OK |
| `pfscan` | Runs view command (default) | OK |
| `pfscan view --help` | Shows view command help | OK |
| `pfscan scan --help` | Shows scan command help | OK |
