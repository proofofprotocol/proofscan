# Proofscan Validation Playbook (Genspark)

## Purpose
This document defines how proofscan is validated in sandboxed environments
such as Genspark.

## Principles
- Evidence over explanation
- Logs over summaries
- Reproducibility over convenience

## Required Artifacts
- pfscan view --json -> events.json
- pfscan tree --json -> tree.json
- RUNLOG.md updated

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
6. commit + push

