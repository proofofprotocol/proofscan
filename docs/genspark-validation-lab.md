# Genspark Validation Lab

This document describes how Genspark sandbox is used as a validation execution environment for proofscan.

## Overview

- **proofscan** uses Genspark sandbox as an isolated environment for MCP server validation sessions
- Sandbox instances are **ephemeral** (destroyed after use), so all artifacts must be committed to GitHub
- The validation procedure is documented in [validation-playbook.md](./validation-playbook.md)

## Artifact Storage

Validation session artifacts are stored under:

```
validation/session-YYYY-MM-DD-<target>/
```

Each session directory contains:
- `RUNLOG.md` - Human-readable execution log
- `events.json` - Raw JSON-RPC events captured by proofscan
- `tree.json` - Connector/session/RPC tree structure

## Purpose

The goal is to **observe and record MCP server communication** to:
1. Verify protocol compliance
2. Capture evidence of tool calls and responses
3. Document failure cases for debugging

## Session Log

| Date | Target | Status | Notes |
|------|--------|--------|-------|
| 2026-01-02 | mcp-server-time | Failed | uvx ENOENT - validation artifacts at `validation/session-2026-01-02-time/` |

## Workflow

1. Launch Genspark sandbox
2. Clone proofscan repository
3. Follow [validation-playbook.md](./validation-playbook.md)
4. Export artifacts (RUNLOG.md, events.json, tree.json)
5. Commit and push to GitHub before sandbox is destroyed
