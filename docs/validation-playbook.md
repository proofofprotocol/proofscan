# Proofscan Validation Playbook (Genspark)

## Purpose
This document defines how proofscan is validated in sandboxed environments
such as Genspark.

## Principles
- Evidence over explanation
- Logs over summaries
- Reproducibility over convenience

## Required Artifacts
Each validation session MUST produce the following artifacts
inside a session-specific directory under `validation/`:

- RUNLOG.md (command execution log)
- events.json (pfscan view --json)
- tree.json (pfscan tree --json)

Directory format:
validation/session-YYYY-MM-DD-<target>/

## Prohibited
- Simulated outputs
- Assumptions without logs
- Uncommitted results

## Standard Flow
1. Environment check
2. proofscan install
3. MCP server import
4. scan start
5. view/tree capture
6. move artifacts under validation/session-YYYY-MM-DD-<target>/
7. commit + push


