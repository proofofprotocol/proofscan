# Phase 7: connector_id → target_id Migration Design

## Overview

Migrate all `connector_id` references to `target_id` to support the unified targets model (MCP connectors + A2A agents).

## Scope

- **274 occurrences** across **62 files**
- Breaking change with backward compatibility layer

## Migration Strategy

### Principles

1. **Backward Compatibility**: Existing code using `connector_id` should continue to work during migration
2. **Type Safety**: Use TypeScript to catch migration errors at compile time
3. **Incremental**: Migrate in phases, test each phase
4. **Data Preservation**: Existing sessions keep their `connector_id`, new ones use `target_id`

### File Categories by Impact

| Priority | Files | Occurrences | Category |
|----------|-------|-------------|----------|
| P0 | 7 files | 98 | Core DB/Types |
| P1 | 8 files | 52 | Commands |
| P2 | 10 files | 62 | Shell |
| P3 | 8 files | 35 | Monitor/API |
| P4 | 15 files | 27 | Tests |

### P0: Core DB/Types (Do First)

```
src/db/events-store.ts      (22) - Session queries, event storage
src/db/tool-analysis.ts     (17) - Tool analysis queries
src/eventline/store.ts      (14) - Eventline storage
src/db/schema.ts            (10) - Schema definitions
src/db/types.ts              (4) - Type definitions
src/db/proofs-store.ts       (3) - Proof storage
src/db/connection.ts         (2) - DB connection
```

### P1: Commands (After P0)

```
src/commands/analyze.ts     (12)
src/commands/view.ts         (7)
src/commands/rpc.ts          (6)
src/commands/connectors.ts   (5)
src/commands/scan.ts         (4)
src/commands/sessions.ts     (4)
src/commands/summary.ts      (4)
src/commands/archive.ts      (3)
```

### P2: Shell (After P1)

```
src/shell/router-commands.ts    (9)
src/shell/ref-resolver.ts       (6)
src/shell/repl.ts               (5)
src/shell/pager/renderer.ts     (5)
src/shell/selector.ts           (4)
src/shell/popl-commands.ts      (4)
src/shell/tool-commands.ts      (3)
src/shell/inscribe-commands.ts  (3)
src/shell/find-command.ts       (3)
src/shell/pipeline-types.ts     (2)
```

### P3: Monitor/API (After P2)

```
src/monitor/data/connectors.ts   (13)
src/monitor/routes/popl.ts        (5)
src/monitor/routes/connectors.ts  (5)
src/monitor/routes/api.ts         (3)
src/monitor/templates/components.ts (2)
src/monitor/templates/popl.ts      (2)
src/monitor/data/popl.ts           (2)
src/monitor/types.ts               (3)
```

### P4: Tests (After all)

```
src/html/templates.test.ts         (9)
src/db/connection.test.ts          (6)
src/monitor/data/connectors.test.ts (6)
src/commands/record.test.ts        (2)
... and other test files
```

## Implementation Details

### Step 1: Update Types (src/db/types.ts)

```typescript
// Add target_id to Session interface
export interface Session {
  session_id: string;
  connector_id: string;  // @deprecated - use target_id
  target_id: string | null;  // New unified ID
  // ... rest
}

// Add migration helper type
export type TargetId = string;
/** @deprecated Use TargetId */
export type ConnectorId = string;
```

### Step 2: Update DB Queries

For each query:
1. Add `target_id` to SELECT/INSERT
2. Use `COALESCE(target_id, connector_id)` for reads
3. Set both `connector_id` and `target_id` for writes (during transition)

Example:
```typescript
// Before
const sessions = db.prepare('SELECT * FROM sessions WHERE connector_id = ?').all(connectorId);

// After (transitional)
const sessions = db.prepare('SELECT * FROM sessions WHERE COALESCE(target_id, connector_id) = ?').all(targetId);

// After (final)
const sessions = db.prepare('SELECT * FROM sessions WHERE target_id = ?').all(targetId);
```

### Step 3: Update Function Signatures

```typescript
// Before
function getSessionsByConnector(connectorId: string): Session[]

// After (transitional - accept both)
function getSessionsByTarget(targetId: string): Session[]
/** @deprecated Use getSessionsByTarget */
function getSessionsByConnector(connectorId: string): Session[] {
  return getSessionsByTarget(connectorId);
}

// After (final)
function getSessionsByTarget(targetId: string): Session[]
```

### Step 4: Update CLI Commands

- `--connector` flag remains for MCP connectors
- Add `--target` as unified flag
- Internal logic uses `target_id`

## Branch Strategy

```
main
 └── feat/phase7-target-migration
      ├── phase7.1-types        (P0: types.ts, schema.ts)
      ├── phase7.2-db-stores    (P0: events-store, tool-analysis, etc.)
      ├── phase7.3-commands     (P1: all command files)
      ├── phase7.4-shell        (P2: all shell files)
      ├── phase7.5-monitor      (P3: monitor/API files)
      └── phase7.6-tests        (P4: test files)
```

## Testing Strategy

1. Run `npm run build` after each sub-phase
2. Run `npm test` after each sub-phase
3. Manual testing of key flows:
   - `pfscan connectors ls`
   - `pfscan agent ls`
   - `pfscan sessions`
   - `pfscan shell` navigation

## Rollback Plan

If issues found:
1. Revert to previous commit
2. Keep `connector_id` as primary, `target_id` as secondary
3. Revisit migration strategy

## Success Criteria

- [ ] All 274 occurrences migrated
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] MCP connectors still work
- [ ] A2A agents still work
- [ ] No runtime errors in CLI
