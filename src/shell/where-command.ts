/**
 * Where Command for psh Shell
 *
 * Filters pipeline rows using Filter DSL v0.1.
 * Reuses parser and evaluator from src/filter/.
 */

import { parseFilter } from '../filter/parser.js';
import { evaluateFilter } from '../filter/evaluator.js';
import type { FilterAst } from '../filter/types.js';
import type { PipelineValue, RpcRow, SessionRow, A2AMessageRow, RowType } from './pipeline-types.js';
import { rpcRowToFilterContext, sessionRowToFilterContext, a2aMessageRowToFilterContext } from './filter-mappers.js';

/** Fields that only apply to RPC rows */
const RPC_ONLY_FIELDS = ['rpc.id', 'rpc.method', 'rpc.status', 'rpc.latency', 'tools.name', 'tools.method'];

/** Fields that only apply to Session rows */
const SESSION_ONLY_FIELDS = ['session.latency'];

/** Fields that only apply to A2A message rows */
const A2A_MESSAGE_ONLY_FIELDS = ['message.id', 'message.role', 'message.content', 'message.timestamp'];

/**
 * Check if filter uses fields incompatible with the row type
 * Returns warning message if incompatible, null if OK
 */
function checkFieldCompatibility(ast: FilterAst, rowType: RowType): string | null {
  const usedFields = ast.conditions.map(c => c.field);

  if (rowType === 'session') {
    const rpcFields = usedFields.filter(f => RPC_ONLY_FIELDS.includes(f));
    if (rpcFields.length > 0) {
      return `Field '${rpcFields[0]}' is only available at session level (cd into a session first)`;
    }
  }

  if (rowType === 'rpc') {
    const sessionFields = usedFields.filter(f => SESSION_ONLY_FIELDS.includes(f));
    if (sessionFields.length > 0) {
      return `Field '${sessionFields[0]}' is only available at connector level`;
    }
  }

  if (rowType === 'a2a-message') {
    const rpcFields = usedFields.filter(f => RPC_ONLY_FIELDS.includes(f));
    const sessionFields = usedFields.filter(f => SESSION_ONLY_FIELDS.includes(f));
    if (rpcFields.length > 0) {
      return `Field '${rpcFields[0]}' is not available for A2A messages. Use message.* fields.`;
    }
    if (sessionFields.length > 0) {
      return `Field '${sessionFields[0]}' is not available for A2A messages. Use message.* fields.`;
    }
  }

  return null;
}

/**
 * Result of applying where filter
 */
export type WhereResult =
  | { ok: true; result: PipelineValue; stats: { matched: number; total: number } }
  | { ok: false; error: string; position?: number };

/**
 * Normalize filter expression (strip "filter:" prefix for copy/paste compatibility)
 */
function normalizeExpr(expr: string): string {
  let trimmed = expr.trim();
  if (trimmed.toLowerCase().startsWith('filter:')) {
    trimmed = trimmed.slice(7).trim();
  }
  return trimmed;
}

/**
 * Apply where filter to pipeline input
 *
 * @param input - Pipeline value (rows or text)
 * @param expr - Filter expression (e.g., 'rpc.method == "tools/call"')
 * @returns Filtered result or error
 */
export function applyWhere(input: PipelineValue, expr: string): WhereResult {
  const normalized = normalizeExpr(expr);

  // Empty expression → pass all through
  if (!normalized) {
    const total = input.kind === 'rows' ? input.rows.length : 0;
    return { ok: true, result: input, stats: { matched: total, total } };
  }

  // Parse the filter expression
  const parseResult = parseFilter(normalized);
  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error, position: parseResult.position };
  }

  // Text input not supported
  if (input.kind === 'text') {
    return { ok: false, error: 'where expects rows; got text. Try `ls` first.' };
  }

  const { rows, rowType } = input;

  // Check for field/rowType compatibility
  const compatError = checkFieldCompatibility(parseResult.ast, rowType);
  if (compatError) {
    return { ok: false, error: compatError };
  }

  // Get appropriate mapper for row type
  const mapper =
    rowType === 'rpc'
      ? rpcRowToFilterContext
      : rowType === 'session'
        ? sessionRowToFilterContext
        : rowType === 'a2a-message'
          ? a2aMessageRowToFilterContext
          : null;

  if (!mapper) {
    return { ok: false, error: `Unsupported row type: ${rowType}` };
  }

  // Filter rows with proper type handling
  const filtered = rows.filter((row) => {
    // Use conditional mapper call instead of intersection type cast
    const ctx = rowType === 'rpc'
      ? rpcRowToFilterContext(row as RpcRow)
      : rowType === 'session'
        ? sessionRowToFilterContext(row as SessionRow)
        : a2aMessageRowToFilterContext(row as A2AMessageRow);
    return evaluateFilter(parseResult.ast, ctx);
  });

  return {
    ok: true,
    result: { kind: 'rows', rows: filtered, rowType },
    stats: { matched: filtered.length, total: rows.length },
  };
}
