# Proofscan Validation Run Log

## Session: First Official Validation
**Date**: 2026-01-02  
**Environment**: Genspark Sandbox  
**Purpose**: Verify sandbox environment and install proofscan

---

## 1. Environment Verification

### Check Working Directory
```bash
$ cd /home/user/webapp && pwd
/home/user/webapp
```

### Check Node.js Version
```bash
$ cd /home/user/webapp && node --version
v20.19.6
```

### Check npm Version
```bash
$ cd /home/user/webapp && npm --version
10.8.2
```

---

## 2. Proofscan Installation

### Initial Global Install Attempt (Failed)
```bash
$ cd /home/user/webapp && npm install -g proofscan
npm error code EACCES
npm error syscall mkdir
npm error path /usr/lib/node_modules/proofscan
npm error errno -13
npm error Error: EACCES: permission denied, mkdir '/usr/lib/node_modules/proofscan'
npm error     at async mkdir (node:internal/fs/promises:858:10)
npm error     at async /usr/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/reify.js:624:20
npm error     at async Promise.allSettled (index 0)
npm error     at async [reifyPackages] (/usr/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/reify.js:325:11)
npm error     at async Arborist.reify (/usr/lib/node_modules/npm/node_modules/@npmcli/arborist/lib/arborist/reify.js:142:5)
npm error     at async Install.exec (/usr/lib/node_modules/npm/lib/commands/install.js:150:5)
npm error     at async Npm.exec (/usr/lib/node_modules/npm/lib/npm.js:207:9)
npm error     at async module.exports (/usr/lib/node_modules/npm/lib/cli/entry.js:74:5) {
npm error   errno: -13,
npm error   code: 'EACCES',
npm error   syscall: 'mkdir',
npm error   path: '/usr/lib/node_modules/proofscan'
npm error }
npm error
npm error The operation was rejected by your operating system.
npm error It is likely you do not have the permissions to access this file as the current user
npm error
npm error If you believe this might be a permissions issue, please double-check the
npm error permissions of the file and its containing directories, or try running
npm error the command again as root/Administrator.
npm error A complete log of this run can be found in: /opt/npm-cache/_logs/2026-01-02T12_24_00_324Z-debug-0.log
```
**Exit Code**: 1

### Global Install with Sudo (Success)
```bash
$ cd /home/user/webapp && sudo npm install -g proofscan

added 41 packages in 2s

10 packages are looking for funding
  run `npm fund` for details
```
**Exit Code**: 0

---

## 3. Installation Verification

### Check Proofscan Version
```bash
$ cd /home/user/webapp && pfscan --version
0.9.1
```
**Exit Code**: 0

---

## Summary
- **Node.js Version**: v20.19.6
- **npm Version**: 10.8.2
- **Proofscan Version**: 0.9.1
- **Installation Method**: sudo npm install -g proofscan
- **Status**: ✅ SUCCESS

---

## Notes
- Initial global install failed due to permissions (EACCES error)
- Successfully installed using sudo
- proofscan CLI is operational and accessible via `pfscan` command
- Credits: 10000 -> 9964 (Session 1 baseline cost)

---

## Session: MCP Time Server Scan (Evidence Export)
**Date**: 2026-01-02  
**Environment**: Genspark Sandbox  
**Purpose**: Import MCP time server config, run scan, and export evidence artifacts

---

## 1. Confirm Proofscan Installation

### Check Proofscan Version
```bash
$ cd /home/user/webapp && pfscan --version
0.9.1
```
**Exit Code**: 0

---

## 2. Import MCP Server Configuration

### Import Time Server Config via stdin
```bash
$ cd /home/user/webapp && echo '{"mcpServers":{"time":{"command":"uvx","args":["mcp-server-time"]}}}' | pfscan connectors import --from mcpServers --stdin
✓ Imported 1 connector(s): time
```
**Exit Code**: 0

---

## 3. Run Scan

### Start Scan for Time Connector
```bash
$ cd /home/user/webapp && pfscan scan start --id time
Scanning connector: time...
✗ Scan failed!
  Connector: time
  Session: a83f1a79-4ddc-4bd6-9079-954715de1e3c
  Error: spawn uvx ENOENT
  Events: 3 recorded
```
**Exit Code**: 1

---

## 4. Export Evidence Artifacts

### Export Events to JSON
```bash
$ cd /home/user/webapp && pfscan view --json --limit 200 > events.json
```
**Exit Code**: 0

### Export Tree to JSON
```bash
$ cd /home/user/webapp && pfscan tree --json > tree.json
```
**Exit Code**: 0

### Verify Exported Files
```bash
$ cd /home/user/webapp && ls -lh events.json tree.json
-rw-r--r-- 1 user user 963 Jan  2 12:43 events.json
-rw-r--r-- 1 user user 598 Jan  2 12:43 tree.json
```
**Exit Code**: 0

---

## Evidence Artifacts Content

### events.json
```json
[
  {
    "ts_ms": 1767357788745,
    "kind": "notify",
    "direction": "→",
    "label": "[transport]",
    "connector_id": "time",
    "session_id": "a83f1a79-4ddc-4bd6-9079-954715de1e3c",
    "status": "-",
    "size_bytes": 69,
    "raw_json": "{\"type\":\"connect_attempt\",\"command\":\"uvx\",\"args\":[\"mcp-server-time\"]}"
  },
  {
    "ts_ms": 1767357788754,
    "kind": "notify",
    "direction": "←",
    "label": "[transport]",
    "connector_id": "time",
    "session_id": "a83f1a79-4ddc-4bd6-9079-954715de1e3c",
    "status": "-",
    "size_bytes": 45,
    "raw_json": "{\"type\":\"error\",\"message\":\"spawn uvx ENOENT\"}"
  },
  {
    "ts_ms": 1767357788756,
    "kind": "notify",
    "direction": "→",
    "label": "response",
    "connector_id": "time",
    "session_id": "a83f1a79-4ddc-4bd6-9079-954715de1e3c",
    "status": "ERR",
    "size_bytes": 48,
    "raw_json": "{\"type\":\"scan_error\",\"error\":\"spawn uvx ENOENT\"}"
  }
]
```

### tree.json
```json
[
  {
    "type": "connector",
    "id": "time",
    "label": "time",
    "meta": {
      "session_count": 1
    },
    "children": [
      {
        "type": "session",
        "id": "a83f1a79-4ddc-4bd6-9079-954715de1e3c",
        "label": "a83f1a79... (0 rpcs, 3 events)",
        "meta": {
          "connector_id": "time",
          "started_at": "2026-01-02T12:43:08.722Z",
          "ended_at": "2026-01-02T12:43:08.757Z",
          "exit_reason": "error",
          "duration_ms": 35,
          "rpc_count": 0,
          "event_count": 3
        },
        "children": []
      }
    ]
  }
]
```

---

## Summary
- **Proofscan Version**: 0.9.1
- **Connector Imported**: time (uvx mcp-server-time)
- **Session ID**: a83f1a79-4ddc-4bd6-9079-954715de1e3c
- **Scan Status**: ❌ FAILED (spawn uvx ENOENT)
- **Events Recorded**: 3
- **Duration**: 35ms
- **Artifacts Exported**: events.json (963 bytes), tree.json (598 bytes)

---

## Notes
- Scan failed because `uvx` command is not available in the sandbox environment
- Despite the failure, proofscan successfully recorded 3 events:
  1. Connect attempt (transport notification)
  2. Error notification (spawn uvx ENOENT)
  3. Scan error response
- Evidence artifacts were successfully exported as JSON
- This validates proofscan's error handling and event recording capabilities
