/**
 * RefResolver - Unified reference resolution for shell (Phase 4.1)
 *
 * @ is the dereference operator - used only when resolving references.
 * References are first-class citizens that connect all shell operations.
 *
 * Built-in References:
 * - @this      : Current context (connector/session based on level)
 * - @last      : Latest session or RPC (context-dependent)
 * - @rpc:<id>  : Explicit RPC reference
 * - @session:<id> : Explicit session reference
 * - @fav:<name>   : Favorites (named references from DB)
 * - @ref:<name>   : User-defined references (Phase 4.2)
 */

import type { ShellContext, ProtoType } from './types.js';
import { getContextLevel, type ContextLevel } from './router-commands.js';

/**
 * Reference kind - what type of entity the reference points to
 * Note: 'popl' kind stores POPL entry ID - target format is 'popl/<entry_id>'
 * Note: 'plan' kind refers to validation plans by name
 * Note: 'run' kind refers to plan execution runs by ID
 */
export type RefKind = 'connector' | 'session' | 'rpc' | 'tool_call' | 'context' | 'popl' | 'plan' | 'run';

/**
 * RefStruct - The universal reference structure
 *
 * This is the core data structure that represents any reference in the system.
 * It can be serialized to JSON for pipe operations and stored in the database.
 */
export interface RefStruct {
  /** Reference kind */
  kind: RefKind;
  /** Connector ID (always present except for root context) */
  connector?: string;
  /** Session ID (present for session/rpc/tool_call refs) */
  session?: string;
  /** RPC ID (present for rpc refs) */
  rpc?: string;
  /** Protocol type (mcp/a2a/?) */
  proto?: ProtoType;
  /** Context level when captured */
  level?: ContextLevel;
  /** Timestamp when reference was created */
  captured_at?: string;
  /** Original reference string (e.g., "@this", "@rpc:abc123") */
  source?: string;
  /** Target path for popl kind (e.g., "popl/<entry_id>") - no local absolute paths */
  target?: string;
  /** POPL entry ID (for kind='popl') */
  entry_id?: string;
  /** Plan name (for kind='plan') */
  plan_name?: string;
  /** Run ID (for kind='run') */
  run_id?: string;
}

/**
 * Parsed reference from user input
 */
export interface ParsedRef {
  /** Reference type */
  type: 'this' | 'last' | 'rpc' | 'session' | 'fav' | 'ref' | 'popl' | 'plan' | 'run' | 'literal';
  /** Optional identifier (e.g., RPC ID, favorite name, POPL entry ID, plan name, run ID) */
  id?: string;
  /** Original input string */
  raw: string;
}

/**
 * Resolution result
 */
export interface ResolveResult {
  success: boolean;
  ref?: RefStruct;
  error?: string;
}

/**
 * Data provider interface for resolution
 * Allows RefResolver to query database without direct dependency
 */
export interface RefDataProvider {
  /** Get latest session for a connector (or globally if no connector) */
  getLatestSession(connectorId?: string): { session_id: string; connector_id: string } | null;
  /** Get latest RPC for a session */
  getLatestRpc(sessionId: string): { rpc_id: string; method: string } | null;
  /** Get RPC by ID */
  getRpcById(rpcId: string, sessionId?: string): { rpc_id: string; session_id: string; method: string } | null;
  /** Get session by ID or prefix */
  getSessionByPrefix(prefix: string, connectorId?: string): { session_id: string; connector_id: string } | null;
  /** Get user-defined ref by name */
  getUserRef(name: string): RefStruct | null;
  /** Get favorite by name */
  getFavorite(name: string): RefStruct | null;
  /** Get plan by name (optional - for @plan refs) */
  getPlan?(name: string): { name: string; digest_sha256: string } | null;
  /** Get run by ID (optional - for @run refs) */
  getRun?(runId: string): { run_id: string; plan_name: string | null; plan_digest: string } | null;
  /** Get latest run (optional - for @run:last) */
  getLatestRun?(): { run_id: string; plan_name: string | null; plan_digest: string } | null;
}

/**
 * Parse a reference string into structured form
 *
 * Supported formats:
 * - @this         -> { type: 'this' }
 * - @last         -> { type: 'last' }
 * - @rpc:abc123   -> { type: 'rpc', id: 'abc123' }
 * - @session:xyz  -> { type: 'session', id: 'xyz' }
 * - @fav:myname   -> { type: 'fav', id: 'myname' }
 * - @ref:myref    -> { type: 'ref', id: 'myref' }
 * - anything else -> { type: 'literal' }
 */
export function parseRef(input: string): ParsedRef {
  // Must start with @
  if (!input.startsWith('@')) {
    return { type: 'literal', raw: input };
  }

  const content = input.slice(1); // Remove @

  // Built-in refs without ID
  if (content === 'this') {
    return { type: 'this', raw: input };
  }
  if (content === 'last') {
    return { type: 'last', raw: input };
  }

  // Refs with ID (format: type:id)
  const colonIndex = content.indexOf(':');
  if (colonIndex === -1) {
    // Unknown ref type without colon - treat as literal
    return { type: 'literal', raw: input };
  }

  const refType = content.slice(0, colonIndex);
  const refId = content.slice(colonIndex + 1);

  if (!refId) {
    // Empty ID - invalid
    return { type: 'literal', raw: input };
  }

  switch (refType) {
    case 'rpc':
      return { type: 'rpc', id: refId, raw: input };
    case 'session':
      return { type: 'session', id: refId, raw: input };
    case 'fav':
      return { type: 'fav', id: refId, raw: input };
    case 'ref':
      return { type: 'ref', id: refId, raw: input };
    case 'popl':
      return { type: 'popl', id: refId, raw: input };
    case 'plan':
      return { type: 'plan', id: refId, raw: input };
    case 'run':
      return { type: 'run', id: refId, raw: input };
    default:
      // Unknown type - treat as literal
      return { type: 'literal', raw: input };
  }
}

/**
 * Check if a string is a reference
 */
export function isRef(input: string): boolean {
  const parsed = parseRef(input);
  return parsed.type !== 'literal';
}

/**
 * RefResolver - Central reference resolution service
 */
export class RefResolver {
  constructor(private dataProvider: RefDataProvider) {}

  /**
   * Resolve @this to current context
   */
  resolveThis(context: ShellContext): ResolveResult {
    const level = getContextLevel(context);

    if (level === 'root') {
      return {
        success: true,
        ref: {
          kind: 'context',
          level: 'root',
          captured_at: new Date().toISOString(),
          source: '@this',
        },
      };
    }

    if (level === 'connector' && context.connector) {
      return {
        success: true,
        ref: {
          kind: 'connector',
          connector: context.connector,
          proto: context.proto,
          level: 'connector',
          captured_at: new Date().toISOString(),
          source: '@this',
        },
      };
    }

    if (level === 'session' && context.connector && context.session) {
      return {
        success: true,
        ref: {
          kind: 'session',
          connector: context.connector,
          session: context.session,
          proto: context.proto,
          level: 'session',
          captured_at: new Date().toISOString(),
          source: '@this',
        },
      };
    }

    return {
      success: false,
      error: 'Cannot resolve @this: invalid context state',
    };
  }

  /**
   * Resolve @last to latest session or RPC
   */
  resolveLast(context: ShellContext): ResolveResult {
    const level = getContextLevel(context);

    // At session level: @last refers to latest RPC
    if (level === 'session' && context.session) {
      const latestRpc = this.dataProvider.getLatestRpc(context.session);
      if (latestRpc) {
        return {
          success: true,
          ref: {
            kind: 'rpc',
            connector: context.connector,
            session: context.session,
            rpc: latestRpc.rpc_id,
            proto: context.proto,
            level: 'session',
            captured_at: new Date().toISOString(),
            source: '@last',
          },
        };
      }
      return {
        success: false,
        error: 'No RPC calls in current session',
      };
    }

    // At connector level or root: @last refers to latest session
    const latestSession = this.dataProvider.getLatestSession(context.connector);
    if (latestSession) {
      return {
        success: true,
        ref: {
          kind: 'session',
          connector: latestSession.connector_id,
          session: latestSession.session_id,
          level: 'connector',
          captured_at: new Date().toISOString(),
          source: '@last',
        },
      };
    }

    return {
      success: false,
      error: context.connector
        ? `No sessions for connector: ${context.connector}`
        : 'No sessions found',
    };
  }

  /**
   * Resolve @rpc:<id> to specific RPC
   */
  resolveRpc(rpcId: string, context: ShellContext): ResolveResult {
    const rpc = this.dataProvider.getRpcById(rpcId, context.session);
    if (!rpc) {
      const hint = context.session
        ? `Use 'ls' to list RPCs in current session.`
        : `Navigate to a session first with 'cd'.`;
      return {
        success: false,
        error: `RPC not found: @rpc:${rpcId}. ${hint}`,
      };
    }

    return {
      success: true,
      ref: {
        kind: 'rpc',
        connector: context.connector,
        session: rpc.session_id,
        rpc: rpc.rpc_id,
        proto: context.proto,
        captured_at: new Date().toISOString(),
        source: `@rpc:${rpcId}`,
      },
    };
  }

  /**
   * Resolve @session:<id> to specific session
   */
  resolveSession(sessionId: string, context: ShellContext): ResolveResult {
    const session = this.dataProvider.getSessionByPrefix(sessionId, context.connector);
    if (!session) {
      const hint = context.connector
        ? `Use 'ls' to list sessions for ${context.connector}.`
        : `Use 'ls' at connector level to list sessions.`;
      return {
        success: false,
        error: `Session not found: @session:${sessionId}. ${hint}`,
      };
    }

    return {
      success: true,
      ref: {
        kind: 'session',
        connector: session.connector_id,
        session: session.session_id,
        captured_at: new Date().toISOString(),
        source: `@session:${sessionId}`,
      },
    };
  }

  /**
   * Resolve @fav:<name> to favorite
   */
  resolveFavorite(name: string): ResolveResult {
    const fav = this.dataProvider.getFavorite(name);
    if (!fav) {
      return {
        success: false,
        error: `Favorite not found: @fav:${name}. Favorites feature is not yet implemented.`,
      };
    }

    return {
      success: true,
      ref: {
        ...fav,
        source: `@fav:${name}`,
      },
    };
  }

  /**
   * Resolve @ref:<name> to user-defined reference
   */
  resolveUserRef(name: string): ResolveResult {
    const ref = this.dataProvider.getUserRef(name);
    if (!ref) {
      return {
        success: false,
        error: `Reference not found: @ref:${name}. Use 'ref ls' to list available references.`,
      };
    }

    return {
      success: true,
      ref: {
        ...ref,
        source: `@ref:${name}`,
      },
    };
  }

  /**
   * Resolve @popl:<id> to POPL entry reference
   * Note: This creates a RefStruct directly without DB lookup
   * The actual POPL entry existence check is done by the caller
   */
  resolvePopl(entryId: string): ResolveResult {
    if (!entryId) {
      return {
        success: false,
        error: 'POPL reference requires an entry ID',
      };
    }

    return {
      success: true,
      ref: {
        kind: 'popl',
        entry_id: entryId,
        target: `popl/${entryId}`,
        captured_at: new Date().toISOString(),
        source: `@popl:${entryId}`,
      },
    };
  }

  /**
   * Resolve @plan:<name> to validation plan reference
   */
  resolvePlan(planName: string): ResolveResult {
    if (!planName) {
      return {
        success: false,
        error: 'Plan reference requires a name',
      };
    }

    // Check if data provider has getPlan method
    if (!this.dataProvider.getPlan) {
      return {
        success: true,
        ref: {
          kind: 'plan',
          plan_name: planName,
          captured_at: new Date().toISOString(),
          source: `@plan:${planName}`,
        },
      };
    }

    const plan = this.dataProvider.getPlan(planName);
    if (!plan) {
      return {
        success: false,
        error: `Plan not found: @plan:${planName}. Use 'plans ls' to list available plans.`,
      };
    }

    return {
      success: true,
      ref: {
        kind: 'plan',
        plan_name: plan.name,
        captured_at: new Date().toISOString(),
        source: `@plan:${planName}`,
      },
    };
  }

  /**
   * Resolve @run:<id> or @run:last to plan run reference
   */
  resolveRun(runId: string): ResolveResult {
    if (!runId) {
      return {
        success: false,
        error: 'Run reference requires an ID or "last"',
      };
    }

    // Handle @run:last
    if (runId === 'last') {
      if (!this.dataProvider.getLatestRun) {
        return {
          success: false,
          error: 'Run resolution not available',
        };
      }

      const latestRun = this.dataProvider.getLatestRun();
      if (!latestRun) {
        return {
          success: false,
          error: 'No runs found. Use "plans run" to execute a plan first.',
        };
      }

      return {
        success: true,
        ref: {
          kind: 'run',
          run_id: latestRun.run_id,
          plan_name: latestRun.plan_name || undefined,
          captured_at: new Date().toISOString(),
          source: '@run:last',
        },
      };
    }

    // Check if data provider has getRun method
    if (!this.dataProvider.getRun) {
      return {
        success: true,
        ref: {
          kind: 'run',
          run_id: runId,
          captured_at: new Date().toISOString(),
          source: `@run:${runId}`,
        },
      };
    }

    const run = this.dataProvider.getRun(runId);
    if (!run) {
      return {
        success: false,
        error: `Run not found: @run:${runId}. Use 'plans runs' to list available runs.`,
      };
    }

    return {
      success: true,
      ref: {
        kind: 'run',
        run_id: run.run_id,
        plan_name: run.plan_name || undefined,
        captured_at: new Date().toISOString(),
        source: `@run:${runId}`,
      },
    };
  }

  /**
   * Resolve any reference string
   */
  resolve(input: string, context: ShellContext): ResolveResult {
    const parsed = parseRef(input);

    switch (parsed.type) {
      case 'this':
        return this.resolveThis(context);
      case 'last':
        return this.resolveLast(context);
      case 'rpc':
        if (!parsed.id) {
          return { success: false, error: 'RPC reference requires an ID' };
        }
        return this.resolveRpc(parsed.id, context);
      case 'session':
        if (!parsed.id) {
          return { success: false, error: 'Session reference requires an ID' };
        }
        return this.resolveSession(parsed.id, context);
      case 'fav':
        if (!parsed.id) {
          return { success: false, error: 'Favorite reference requires a name' };
        }
        return this.resolveFavorite(parsed.id);
      case 'ref':
        if (!parsed.id) {
          return { success: false, error: 'User reference requires a name' };
        }
        return this.resolveUserRef(parsed.id);
      case 'popl':
        if (!parsed.id) {
          return { success: false, error: 'POPL reference requires an entry ID' };
        }
        return this.resolvePopl(parsed.id);
      case 'plan':
        if (!parsed.id) {
          return { success: false, error: 'Plan reference requires a name' };
        }
        return this.resolvePlan(parsed.id);
      case 'run':
        if (!parsed.id) {
          return { success: false, error: 'Run reference requires an ID or "last"' };
        }
        return this.resolveRun(parsed.id);
      case 'literal':
        return {
          success: false,
          error: `Not a valid reference: ${input}`,
        };
    }
  }

  /**
   * Resolve multiple arguments, replacing refs with their resolved values
   * Returns the args with refs replaced by their target IDs
   */
  resolveArgs(args: string[], context: ShellContext): { resolved: string[]; errors: string[] } {
    const resolved: string[] = [];
    const errors: string[] = [];

    for (const arg of args) {
      if (!isRef(arg)) {
        resolved.push(arg);
        continue;
      }

      const result = this.resolve(arg, context);
      if (!result.success) {
        errors.push(result.error || `Failed to resolve: ${arg}`);
        resolved.push(arg); // Keep original on error
        continue;
      }

      // Replace with the most specific ID from the ref
      const ref = result.ref!;
      if (ref.entry_id) {
        // For popl refs, use entry_id
        resolved.push(ref.entry_id);
      } else if (ref.run_id) {
        // For run refs, use run_id
        resolved.push(ref.run_id);
      } else if (ref.plan_name) {
        // For plan refs, use plan_name
        resolved.push(ref.plan_name);
      } else if (ref.rpc) {
        resolved.push(ref.rpc);
      } else if (ref.session) {
        resolved.push(ref.session);
      } else if (ref.connector) {
        resolved.push(ref.connector);
      } else {
        resolved.push(arg); // Keep original for context refs
      }
    }

    return { resolved, errors };
  }
}

/**
 * Create a RefStruct from current shell context
 */
export function createRefFromContext(context: ShellContext): RefStruct {
  const level = getContextLevel(context);

  if (level === 'session' && context.connector && context.session) {
    return {
      kind: 'session',
      connector: context.connector,
      session: context.session,
      proto: context.proto,
      level: 'session',
      captured_at: new Date().toISOString(),
    };
  }

  if (level === 'connector' && context.connector) {
    return {
      kind: 'connector',
      connector: context.connector,
      proto: context.proto,
      level: 'connector',
      captured_at: new Date().toISOString(),
    };
  }

  return {
    kind: 'context',
    level: 'root',
    captured_at: new Date().toISOString(),
  };
}

/**
 * Serialize RefStruct to JSON string
 */
export function refToJson(ref: RefStruct): string {
  return JSON.stringify(ref, null, 2);
}

/**
 * Parse RefStruct from JSON string
 * Also supports popl-style JSON with target field
 */
export function refFromJson(json: string): RefStruct | null {
  try {
    const parsed = JSON.parse(json);

    // Check for popl-style JSON: { kind?: 'popl', target: 'popl/<id>', entry_id?: '<id>' }
    if (parsed.target && typeof parsed.target === 'string') {
      const targetMatch = parsed.target.match(/^popl\/(.+)$/);
      if (targetMatch) {
        const entryId = targetMatch[1];
        return {
          kind: 'popl',
          entry_id: parsed.entry_id || entryId,
          target: parsed.target,
          captured_at: parsed.captured_at || new Date().toISOString(),
        };
      }
    }

    // Validate required fields for standard refs
    const validKinds = ['connector', 'session', 'rpc', 'tool_call', 'context', 'popl', 'plan', 'run'];
    if (!parsed.kind || !validKinds.includes(parsed.kind)) {
      return null;
    }
    return parsed as RefStruct;
  } catch {
    return null;
  }
}

/**
 * Create a RefDataProvider from EventsStore
 * This adapts the EventsStore to the RefDataProvider interface
 */
export function createRefDataProvider(eventsStore: {
  getLatestSession(connectorId?: string): { session_id: string; connector_id: string } | null;
  getLatestRpc(sessionId: string): { rpc_id: string; method: string } | null;
  getRpcById(rpcId: string, sessionId?: string): { rpc_id: string; session_id: string; method: string } | null;
  getSessionByPrefix(prefix: string, connectorId?: string): { session_id: string; connector_id: string } | null;
  getUserRef(name: string): { kind: RefKind; connector: string | null; session: string | null; rpc: string | null; proto: string | null; level: string | null; captured_at: string; entry_id?: string | null; target?: string | null } | null;
}): RefDataProvider {
  return {
    getLatestSession: (connectorId?: string) => eventsStore.getLatestSession(connectorId),
    getLatestRpc: (sessionId: string) => eventsStore.getLatestRpc(sessionId),
    getRpcById: (rpcId: string, sessionId?: string) => eventsStore.getRpcById(rpcId, sessionId),
    getSessionByPrefix: (prefix: string, connectorId?: string) => eventsStore.getSessionByPrefix(prefix, connectorId),
    getUserRef: (name: string) => {
      const ref = eventsStore.getUserRef(name);
      if (!ref) return null;

      // For popl kind, include entry_id and target
      if (ref.kind === 'popl') {
        return {
          kind: ref.kind,
          entry_id: ref.entry_id || undefined,
          target: ref.target || undefined,
          captured_at: ref.captured_at,
        };
      }

      return {
        kind: ref.kind,
        connector: ref.connector || undefined,
        session: ref.session || undefined,
        rpc: ref.rpc || undefined,
        proto: ref.proto as ProtoType | undefined,
        level: ref.level as ContextLevel | undefined,
        captured_at: ref.captured_at,
      };
    },
    // Favorites not implemented yet - return null
    getFavorite: () => null,
  };
}
