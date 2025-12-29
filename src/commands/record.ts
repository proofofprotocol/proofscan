/**
 * Record command - Phase 3
 *
 * pfscan record dry-run [connector]
 *
 * Produces "inscribe candidates" from recorded RPCs without actually inscribing.
 * Default: select only tool calls (tools/call).
 * Security default: digest_only (do not emit raw input/output).
 */

import { Command } from 'commander';
import { createHash } from 'crypto';
import { ConfigManager } from '../config/index.js';
import { getEventsDb } from '../db/connection.js';
import { output, getOutputOptions } from '../utils/output.js';
import {
  resolveSession,
  isSessionError,
  formatSessionError,
} from '../utils/session-resolver.js';
import { shortenId } from '../eventline/types.js';
import { classifyTool, OperationCategory } from './summary.js';

// ============================================================
// Types
// ============================================================

/** Note attached to a candidate */
export interface CandidateNote {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

/** Source info for a candidate */
export interface CandidateSource {
  rpc_id: string;
  method: string;
  tool?: string;
}

/** Payload for tool_call candidate (digest_only mode) */
export interface ToolCallPayload {
  tool: string;
  result: 'success' | 'error';
  input_digest: string | null;
  output_digest: string | null;
}

/** Payload for capability_catalog candidate */
export interface CapabilityCatalogPayload {
  tool_count: number;
  tools: string[];
}

/** Timing info */
export interface CandidateTiming {
  started_at: string;
  duration_ms: number | null;
}

/** Single candidate */
export interface Candidate {
  id: string;
  type: 'tool_call' | 'capability_catalog';
  importance: number;
  category: OperationCategory;
  source: CandidateSource;
  payload: ToolCallPayload | CapabilityCatalogPayload;
  digests: {
    payload_digest: string;
  };
  notes: CandidateNote[];
  timing?: CandidateTiming;
}

/** Dry-run output structure */
export interface DryRunData {
  schema_version: string;
  options: {
    include_capabilities: boolean;
    redaction_mode: 'digest_only';
  };
  session: {
    id: string;
    connector_id: string;
    resolved_by: 'option' | 'latest' | 'current';
  };
  candidates: Candidate[];
  summary: {
    candidate_count: number;
    importance_max: number;
  };
}

// ============================================================
// Digest Computation
// ============================================================

/**
 * Canonicalize JSON: stable key ordering, no whitespace
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(item => canonicalizeJson(item));
    return '[' + items.join(',') + ']';
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const pairs = keys.map(key => {
      const k = JSON.stringify(key);
      const v = canonicalizeJson((value as Record<string, unknown>)[key]);
      return k + ':' + v;
    });
    return '{' + pairs.join(',') + '}';
  }

  return 'null';
}

/**
 * Compute SHA256 hex digest of canonicalized JSON
 */
export function computeDigest(value: unknown): string {
  const canonical = canonicalizeJson(value);
  return createHash('sha256').update(canonical).digest('hex');
}

// ============================================================
// Importance Scoring
// ============================================================

/**
 * Calculate importance score for a tool call
 * Base 80, adjust by category: exec +30, network +15, write +15, read +0, other +5
 * Error result +10
 */
export function calculateImportance(
  category: OperationCategory,
  isError: boolean
): number {
  const BASE = 80;
  const categoryBonus: Record<OperationCategory, number> = {
    exec: 30,
    network: 15,
    write: 15,
    read: 0,
    other: 5,
  };

  let score = BASE + categoryBonus[category];
  if (isError) {
    score += 10;
  }

  return score;
}

// ============================================================
// Data Extraction
// ============================================================

interface RpcRow {
  rpc_id: string;
  method: string;
  request_ts: string;
  response_ts: string | null;
}

interface EventRow {
  raw_json: string | null;
  kind: string;
}

interface ToolsCallParams {
  name?: string;
  arguments?: unknown;
}

interface ToolsCallResult {
  content?: unknown;
  isError?: boolean;
}

interface ToolsListResult {
  tools?: Array<{ name: string }>;
}

/**
 * Extract tool call candidates from session
 */
function extractToolCallCandidates(
  configDir: string,
  sessionId: string
): Candidate[] {
  const db = getEventsDb(configDir);
  const candidates: Candidate[] = [];

  // Find all tools/call RPCs
  const toolCalls = db.prepare(`
    SELECT rpc_id, method, request_ts, response_ts
    FROM rpc_calls
    WHERE session_id = ? AND method = 'tools/call'
    ORDER BY request_ts ASC
  `).all(sessionId) as RpcRow[];

  for (const rpc of toolCalls) {
    // Get request event
    const requestEvent = db.prepare(`
      SELECT raw_json, kind FROM events
      WHERE session_id = ? AND rpc_id = ? AND kind = 'request'
      LIMIT 1
    `).get(sessionId, rpc.rpc_id) as EventRow | undefined;

    // Get response event
    const responseEvent = db.prepare(`
      SELECT raw_json, kind FROM events
      WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
      LIMIT 1
    `).get(sessionId, rpc.rpc_id) as EventRow | undefined;

    // Parse request to get tool name and input
    let toolName = 'unknown';
    let inputValue: unknown = null;
    if (requestEvent?.raw_json) {
      try {
        const request = JSON.parse(requestEvent.raw_json);
        const params = request.params as ToolsCallParams | undefined;
        toolName = params?.name || 'unknown';
        inputValue = params?.arguments ?? null;
      } catch {
        // Ignore parse errors
      }
    }

    // Parse response to get output and error status
    let outputValue: unknown = null;
    let isError = false;
    if (responseEvent?.raw_json) {
      try {
        const response = JSON.parse(responseEvent.raw_json);
        if (response.error) {
          isError = true;
          outputValue = response.error;
        } else {
          const result = response.result as ToolsCallResult | undefined;
          isError = result?.isError ?? false;
          outputValue = result?.content ?? result ?? null;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Classify tool
    const category = classifyTool(toolName);

    // Calculate importance
    const importance = calculateImportance(category, isError);

    // Build payload with digests only
    const payload: ToolCallPayload = {
      tool: toolName,
      result: isError ? 'error' : 'success',
      input_digest: inputValue !== null ? computeDigest(inputValue) : null,
      output_digest: outputValue !== null ? computeDigest(outputValue) : null,
    };

    // Calculate payload digest
    const payloadDigest = computeDigest(payload);

    // Build timing
    const timing: CandidateTiming | undefined = rpc.request_ts ? {
      started_at: rpc.request_ts,
      duration_ms: rpc.response_ts
        ? new Date(rpc.response_ts).getTime() - new Date(rpc.request_ts).getTime()
        : null,
    } : undefined;

    // Build candidate
    const candidate: Candidate = {
      id: `tc-${rpc.rpc_id.slice(0, 8)}`,
      type: 'tool_call',
      importance,
      category,
      source: {
        rpc_id: rpc.rpc_id,
        method: rpc.method,
        tool: toolName,
      },
      payload,
      digests: {
        payload_digest: payloadDigest,
      },
      notes: [],
      timing,
    };

    candidates.push(candidate);
  }

  return candidates;
}

/**
 * Extract capability catalog candidate from session (first tools/list)
 */
function extractCapabilityCatalog(
  configDir: string,
  sessionId: string
): Candidate | null {
  const db = getEventsDb(configDir);

  // Find first tools/list RPC with a successful response
  const toolsList = db.prepare(`
    SELECT rc.rpc_id, rc.method, rc.request_ts, rc.response_ts
    FROM rpc_calls rc
    JOIN events e ON rc.session_id = e.session_id AND rc.rpc_id = e.rpc_id
    WHERE rc.session_id = ? AND rc.method = 'tools/list' AND e.kind = 'response'
    ORDER BY rc.request_ts ASC
    LIMIT 1
  `).get(sessionId) as RpcRow | undefined;

  if (!toolsList) {
    return null;
  }

  // Get response event
  const responseEvent = db.prepare(`
    SELECT raw_json FROM events
    WHERE session_id = ? AND rpc_id = ? AND kind = 'response'
    LIMIT 1
  `).get(sessionId, toolsList.rpc_id) as { raw_json: string | null } | undefined;

  if (!responseEvent?.raw_json) {
    return null;
  }

  let tools: string[] = [];
  try {
    const response = JSON.parse(responseEvent.raw_json);
    const result = response.result as ToolsListResult | undefined;
    if (result?.tools && Array.isArray(result.tools)) {
      tools = result.tools.map(t => t.name);
    }
  } catch {
    return null;
  }

  // Build payload
  const payload: CapabilityCatalogPayload = {
    tool_count: tools.length,
    tools,
  };

  // Calculate payload digest
  const payloadDigest = computeDigest(payload);

  // Timing
  const timing: CandidateTiming | undefined = toolsList.request_ts ? {
    started_at: toolsList.request_ts,
    duration_ms: toolsList.response_ts
      ? new Date(toolsList.response_ts).getTime() - new Date(toolsList.request_ts).getTime()
      : null,
  } : undefined;

  const candidate: Candidate = {
    id: `cap-${toolsList.rpc_id.slice(0, 8)}`,
    type: 'capability_catalog',
    importance: 50, // Lower importance for catalog
    category: 'other',
    source: {
      rpc_id: toolsList.rpc_id,
      method: toolsList.method,
    },
    payload,
    digests: {
      payload_digest: payloadDigest,
    },
    notes: [],
    timing,
  };

  return candidate;
}

// ============================================================
// Dry-Run Generation
// ============================================================

/**
 * Generate dry-run data for a session
 */
function generateDryRun(
  configDir: string,
  sessionId: string,
  connectorId: string,
  resolvedBy: 'option' | 'latest' | 'current',
  includeCapabilities: boolean
): DryRunData {
  const candidates: Candidate[] = [];

  // Add capability catalog if requested
  if (includeCapabilities) {
    const catalog = extractCapabilityCatalog(configDir, sessionId);
    if (catalog) {
      candidates.push(catalog);
    }
  }

  // Add tool call candidates
  const toolCalls = extractToolCallCandidates(configDir, sessionId);
  candidates.push(...toolCalls);

  // Calculate summary
  const importanceMax = candidates.length > 0
    ? Math.max(...candidates.map(c => c.importance))
    : 0;

  return {
    schema_version: 'phase3.record_dry_run.v1',
    options: {
      include_capabilities: includeCapabilities,
      redaction_mode: 'digest_only',
    },
    session: {
      id: sessionId,
      connector_id: connectorId,
      resolved_by: resolvedBy,
    },
    candidates,
    summary: {
      candidate_count: candidates.length,
      importance_max: importanceMax,
    },
  };
}

// ============================================================
// Rendering
// ============================================================

/** Japanese type labels */
const TYPE_LABELS: Record<string, string> = {
  tool_call: 'やったこと（tool call）',
  capability_catalog: '能力一覧（capability catalog）',
};

/** Japanese category labels */
const CATEGORY_LABELS: Record<OperationCategory, string> = {
  read: '読取',
  write: '書込',
  network: '通信',
  exec: '実行',
  other: 'その他',
};

/**
 * Render dry-run to terminal
 */
function renderDryRun(data: DryRunData): void {
  console.log(`dry-run: ${data.session.connector_id} (session: ${shortenId(data.session.id, 8)}...)`);
  console.log(`redaction: ${data.options.redaction_mode}`);
  console.log();

  if (data.candidates.length === 0) {
    console.log('候補なし（No candidates）');
    return;
  }

  console.log(`候補数: ${data.summary.candidate_count}`);
  console.log();

  for (const candidate of data.candidates) {
    const typeLabel = TYPE_LABELS[candidate.type] || candidate.type;
    const catLabel = CATEGORY_LABELS[candidate.category];
    const rpcShort = shortenId(candidate.source.rpc_id, 8);

    if (candidate.type === 'tool_call') {
      const payload = candidate.payload as ToolCallPayload;
      const resultMark = payload.result === 'error' ? '✗' : '✓';
      console.log(
        `  [${candidate.importance}] ${typeLabel} ${payload.tool} (${catLabel}) ${resultMark} rpc:${rpcShort}`
      );
    } else if (candidate.type === 'capability_catalog') {
      const payload = candidate.payload as CapabilityCatalogPayload;
      console.log(
        `  [${candidate.importance}] ${typeLabel} ${payload.tool_count}ツール rpc:${rpcShort}`
      );
    }
  }

  console.log();
  console.log(`importance_max: ${data.summary.importance_max}`);
}

// ============================================================
// Command
// ============================================================

export function createRecordCommand(getConfigPath: () => string): Command {
  const cmd = new Command('record')
    .description('Record management commands');

  // dry-run subcommand
  const dryRunCmd = new Command('dry-run')
    .description('Preview inscribe candidates without inscribing')
    .addHelpText('after', `
Examples:
  pfscan record dry-run time              # Preview for 'time' connector
  pfscan record dry-run --session abc123  # Preview for specific session
  pfscan record dry-run --include-capabilities  # Include tools/list snapshot
`)
    .argument('[connector]', 'Connector ID (uses latest session for connector)')
    .option('--session <id>', 'Session ID (partial match supported)')
    .option('--latest', 'Use the latest session')
    .option('--connector <id>', 'Filter by connector (with --latest)')
    .option('--id <id>', 'Alias for --connector')
    .option('--include-capabilities', 'Include tools/list capability snapshot')
    .action(async (connectorArg: string | undefined, options) => {
      try {
        const manager = new ConfigManager(getConfigPath());
        const configDir = manager.getConfigDir();

        // Resolve connector from positional arg, --connector, or --id
        const connectorId = connectorArg || options.connector || options.id;

        // Resolve session
        const result = resolveSession({
          sessionId: options.session,
          latest: options.latest || !!connectorId,
          connectorId,
          configDir,
        });

        if (isSessionError(result)) {
          console.error(formatSessionError(result));
          process.exit(1);
        }

        // Generate dry-run
        const dryRun = generateDryRun(
          configDir,
          result.sessionId,
          result.connectorId,
          result.resolvedBy,
          options.includeCapabilities || false
        );

        if (getOutputOptions().json) {
          output(dryRun);
          return;
        }

        renderDryRun(dryRun);

      } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) {
          console.log('No data yet. Run a scan first:');
          console.log('  pfscan scan start --id <connector>');
          return;
        }
        throw error;
      }
    });

  cmd.addCommand(dryRunCmd);

  return cmd;
}
