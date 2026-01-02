# Proofscan Validation Run Log

## Session: Session 3 - npx MCP success case
**Date**: 2026-01-02
**Environment**: Genspark Sandbox
**Purpose**: Capture successful MCP JSON-RPC traffic using npx-based MCP server

v20.19.6
10.8.2
{"mcpServers":{"echo":{"command":"npx","args":["-y","@modelcontextprotocol/server-everything"]}}}
✓ Imported 1 connector(s): echo
Scanning connector: echo...
✓ Scan successful!
  Connector: echo
  Session: e697c7cb-eacc-403d-b428-6d40b7ab396b
  Tools found: 11
  Tool names: echo, add, longRunningOperation, printEnv, sampleLLM, getTinyImage, annotatedMessage, getResourceReference, getResourceLinks, structuredContent, zip
  Events: 11 recorded

## Artifacts
total 24
-rw-r--r-- 1 user user   693 Jan  2 13:26 RUNLOG.md
-rw-r--r-- 1 user user 14124 Jan  2 13:25 events.json
-rw-r--r-- 1 user user  2024 Jan  2 13:25 tree.json
