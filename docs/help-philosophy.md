# pfscan Help System Design

This document describes the help system design philosophy for pfscan CLI.

## Design Principles

### 3-Layer Model (Execution Modes)

pfscan operates in three distinct modes:

| Mode | Description |
|------|-------------|
| **CLI** | Run single commands to inspect, manage and analyze data |
| **SHELL** | Explore connectors, sessions and RPCs interactively |
| **PROXY** | Capture MCP traffic continuously as a proxy server |

### 4-Quadrant Help Model

The help system follows a 2x2 matrix:

|         | Guide (What can I do?) | Inventory (What exists?) |
|---------|------------------------|--------------------------|
| **Intent (User goals)** | `pfscan help` | `pfscan help <command>` |
| **Mechanism (System reference)** | Reserved for `help concepts` | `pfscan help -a` |

## Help Output Patterns

### 1. `pfscan help` - Intent × Guide

Shows use-case focused overview:
- Explains the 3 execution modes
- Groups commands by user intent (Observe, Capture, Explore, etc.)
- No aliases displayed
- Provides navigation hints

### 2. `pfscan help <command>` - Intent × Full

Shows Commander's standard help for a specific command:
- Full usage syntax
- All options with descriptions
- Examples (if provided via `.addHelpText()`)

### 3. `pfscan help -a` / `--all` - Mechanism × Inventory

Shows git-style complete reference:
- Main commands / Ancillary commands sections
- Alphabetical order within sections
- Aliases in parentheses: `view (v)`
- Subcommands expanded with indentation
- Descriptions for each entry

### 4. `pfscan help concepts` - Mechanism × Guide (Reserved)

Future: Explain core concepts like MCP, POPL, refs, etc.

## Implementation Details

### File Structure

```
src/help/
├── categories.ts   # Command category definitions
├── index.ts        # Help generation functions
└── help.test.ts    # Tests
```

### Key Design Decisions

1. **Single source of truth**: All command categorization is defined in `categories.ts`

2. **Separate data from presentation**: Categories define structure, generators format output

3. **Unified subcommand naming**: `ls` is the main command, `list` is an alias (following Unix convention)

4. **No double help display**: Custom help replaces Commander's default help entirely

5. **Alphabetical ordering in inventory**: Makes commands easy to find in long lists

## Subcommand Naming Convention

All list-type subcommands follow this pattern:

| Main | Alias |
|------|-------|
| `ls` | `list` |

This applies to: `config`, `connectors`, `secrets`, `rpc`, `tool`, `popl`

## Adding New Commands

When adding a new command:

1. Add to `GUIDE_CATEGORIES` in `categories.ts` (use-case category)
2. Add to `MAIN_COMMANDS` or `ANCILLARY_COMMANDS` (alphabetically)
3. Include subcommands if applicable
4. Add to `KNOWN_COMMANDS` in `cli.ts`
5. Run tests: `npm test -- src/help/help.test.ts`
