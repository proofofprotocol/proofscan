/**
 * POPL Artifacts Generator (Phase 6.0)
 *
 * Generates sanitized artifacts for POPL entries:
 * - status.json: Safe summary of session/connector state
 * - logs.sanitized.jsonl: Sanitized proxy logs
 * - rpc.sanitized.jsonl: Sanitized RPC events
 * - validation-run.log: Validation/generation log
 */

import { EventLineStore } from '../eventline/store.js';
import { EventsStore } from '../db/events-store.js';
import { getEventsDb } from '../db/connection.js';
import type { SessionWithStats, RpcCall, Event } from '../db/types.js';
import {
  sanitize,
  sanitizeRpcEvent,
  sanitizeLogLine,
  hashFileContent,
  SANITIZER_RULESET_VERSION,
} from './sanitizer.js';
import type { PoplArtifact, PoplCaptureSummary } from './types.js';

/**
 * Session status (safe for public disclosure)
 */
export interface SessionStatus {
  session_id: string;
  connector_id: string;
  started_at: string;
  ended_at: string | null;
  exit_reason: string | null;
  rpc_count: number;
  event_count: number;
  duration_ms: number | null;
  actor_kind: string | null;
}

/**
 * Status.json structure (safe for public disclosure)
 */
export interface StatusJson {
  generated_at: string;
  sanitizer_version: number;
  session: SessionStatus;
  summary: PoplCaptureSummary;
  rpc_methods: string[];
}

/**
 * Artifact generation result
 */
export interface ArtifactResult {
  /** Artifact metadata */
  artifact: PoplArtifact;
  /** File content */
  content: string;
}

/**
 * All artifacts for an entry
 */
export interface GeneratedArtifacts {
  status: ArtifactResult;
  logs?: ArtifactResult;
  rpc: ArtifactResult;
  validation: ArtifactResult;
}

/**
 * Calculate latency percentiles from RPC calls
 */
function calculateLatencyPercentiles(
  rpcs: RpcCall[]
): { p50?: number; p95?: number } {
  const latencies: number[] = [];

  for (const rpc of rpcs) {
    if (rpc.request_ts && rpc.response_ts) {
      const reqTs = new Date(rpc.request_ts).getTime();
      const resTs = new Date(rpc.response_ts).getTime();
      const latency = resTs - reqTs;
      if (latency >= 0) {
        latencies.push(latency);
      }
    }
  }

  if (latencies.length === 0) {
    return {};
  }

  // Sort for percentile calculation
  latencies.sort((a, b) => a - b);

  const p50Index = Math.floor(latencies.length * 0.5);
  const p95Index = Math.floor(latencies.length * 0.95);

  return {
    p50: latencies[p50Index],
    p95: latencies[Math.min(p95Index, latencies.length - 1)],
  };
}

/**
 * Generate status.json artifact
 */
export function generateStatusArtifact(
  session: SessionWithStats,
  rpcs: RpcCall[],
  events: Event[]
): ArtifactResult {
  // Calculate duration
  let durationMs: number | null = null;
  if (session.ended_at) {
    const startMs = new Date(session.started_at).getTime();
    const endMs = new Date(session.ended_at).getTime();
    durationMs = endMs - startMs;
  }

  // Calculate error count
  const errorCount = rpcs.filter((r) => r.success === 0).length;

  // Calculate latency percentiles
  const { p50, p95 } = calculateLatencyPercentiles(rpcs);

  // Get unique RPC methods
  const rpcMethods = [...new Set(rpcs.map((r) => r.method))].sort();

  const status: StatusJson = {
    generated_at: new Date().toISOString(),
    sanitizer_version: SANITIZER_RULESET_VERSION,
    session: {
      session_id: session.session_id,
      connector_id: session.connector_id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      exit_reason: session.exit_reason,
      rpc_count: rpcs.length,
      event_count: events.length,
      duration_ms: durationMs,
      actor_kind: session.actor_kind,
    },
    summary: {
      rpc_total: rpcs.length,
      errors: errorCount,
      latency_ms_p50: p50,
      latency_ms_p95: p95,
    },
    rpc_methods: rpcMethods,
  };

  const content = JSON.stringify(status, null, 2);
  const sha256 = hashFileContent(content);

  return {
    artifact: {
      name: 'status.json',
      path: 'status.json',
      sha256,
    },
    content,
  };
}

/**
 * Generate rpc.sanitized.jsonl artifact
 */
export function generateRpcArtifact(
  sessionId: string,
  configDir: string
): ArtifactResult {
  const db = getEventsDb(configDir);

  // Get all events for this session
  const events = db
    .prepare(
      `
    SELECT * FROM events
    WHERE session_id = ?
    ORDER BY ts ASC
  `
    )
    .all(sessionId) as Event[];

  // Sanitize each event and write as JSONL
  const lines: string[] = [];
  for (const event of events) {
    const sanitized = sanitizeRpcEvent(event);
    lines.push(JSON.stringify(sanitized));
  }

  const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
  const sha256 = hashFileContent(content);

  return {
    artifact: {
      name: 'rpc.sanitized.jsonl',
      path: 'rpc.sanitized.jsonl',
      sha256,
    },
    content,
  };
}

/**
 * Generate logs.sanitized.jsonl artifact (if proxy logs exist)
 */
export function generateLogsArtifact(
  logsPath: string | null,
  sessionStarted: string,
  sessionEnded: string | null
): ArtifactResult | null {
  // For now, return null - proxy logs are separate from session data
  // This will be implemented when we have access to proxy logs for the session window
  return null;
}

/**
 * Generate validation-run.log artifact
 */
export function generateValidationArtifact(
  sessionId: string,
  steps: string[]
): ArtifactResult {
  const lines: string[] = [
    `# POPL Entry Validation Log`,
    `# Generated: ${new Date().toISOString()}`,
    `# Session: ${sessionId}`,
    `# Sanitizer Version: ${SANITIZER_RULESET_VERSION}`,
    ``,
    `## Steps`,
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    ``,
    `## Result`,
    `Entry generated successfully.`,
  ];

  const content = lines.join('\n') + '\n';
  const sha256 = hashFileContent(content);

  return {
    artifact: {
      name: 'validation-run.log',
      path: 'validation-run.log',
      sha256,
    },
    content,
  };
}

/**
 * Generate all artifacts for a session POPL entry
 */
export async function generateSessionArtifacts(
  sessionId: string,
  configDir: string
): Promise<{
  artifacts: GeneratedArtifacts;
  session: SessionWithStats;
  summary: PoplCaptureSummary;
}> {
  const validationSteps: string[] = [];

  // Get session data
  validationSteps.push(`Loading session ${sessionId}`);
  const eventsStore = new EventsStore(configDir);
  const session = eventsStore.getSession(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  validationSteps.push(`Found session for connector: ${session.connector_id}`);

  // Get RPC calls
  const rpcs = eventsStore.getRpcCallsBySession(sessionId);
  validationSteps.push(`Found ${rpcs.length} RPC calls`);

  // Get events
  const db = getEventsDb(configDir);
  const events = db
    .prepare(`SELECT * FROM events WHERE session_id = ?`)
    .all(sessionId) as Event[];
  validationSteps.push(`Found ${events.length} events`);

  // Generate status.json
  validationSteps.push('Generating status.json');
  const statusResult = generateStatusArtifact(
    session as SessionWithStats,
    rpcs,
    events
  );

  // Generate rpc.sanitized.jsonl
  validationSteps.push('Generating rpc.sanitized.jsonl');
  const rpcResult = generateRpcArtifact(sessionId, configDir);

  // Generate validation log
  validationSteps.push('Generating validation-run.log');
  const validationResult = generateValidationArtifact(sessionId, validationSteps);

  // Calculate summary for POPL.yml
  const errorCount = rpcs.filter((r) => r.success === 0).length;
  const { p50, p95 } = calculateLatencyPercentiles(rpcs);

  const summary: PoplCaptureSummary = {
    rpc_total: rpcs.length,
    errors: errorCount,
    latency_ms_p50: p50,
    latency_ms_p95: p95,
  };

  return {
    artifacts: {
      status: statusResult,
      rpc: rpcResult,
      validation: validationResult,
    },
    session: session as SessionWithStats,
    summary,
  };
}
