/**
 * Where Command for psh Shell
 *
 * Filters pipeline rows using Filter DSL v0.1.
 * Reuses parser and evaluator from src/filter/.
 */

import { parseFilter } from '../filter/parser.js';
import { evaluateFilter } from '../filter/evaluator.js';
import type { PipelineValue, RpcRow, SessionRow } from './pipeline-types.js';
import { rpcRowToFilterContext, sessionRowToFilterContext } from './filter-mappers.js';

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

  // Get appropriate mapper for row type
  const mapper =
    rowType === 'rpc'
      ? rpcRowToFilterContext
      : rowType === 'session'
        ? sessionRowToFilterContext
        : null;

  if (!mapper) {
    return { ok: false, error: `Unsupported row type: ${rowType}` };
  }

  // Filter rows with proper type handling
  const filtered = rows.filter((row) => {
    // Use conditional mapper call instead of intersection type cast
    const ctx = rowType === 'rpc'
      ? rpcRowToFilterContext(row as RpcRow)
      : sessionRowToFilterContext(row as SessionRow);
    return evaluateFilter(parseResult.ast, ctx);
  });

  return {
    ok: true,
    result: { kind: 'rows', rows: filtered, rowType },
    stats: { matched: filtered.length, total: rows.length },
  };
}
