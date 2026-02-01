/**
 * Filter DSL v0.1 Types
 *
 * Single-line expression: `rpc.method == "tools/call" rpc.status == "ok"`
 * Conditions are space-separated (implicit AND).
 */

/** Supported comparison operators */
export type FilterOperator = '==' | '!=' | '~=' | '>' | '<';

/** Supported field paths */
export type FilterField =
  | 'session.id'
  | 'session.latency'
  | 'rpc.id'
  | 'rpc.method'
  | 'rpc.status'
  | 'rpc.latency'
  | 'tools.method'
  | 'tools.name'
  | 'event.kind'
  | 'event.type'
  | 'direction'
  | 'message.id'
  | 'message.role'
  | 'message.content'
  | 'message.timestamp';

/** Single condition in the filter expression */
export interface FilterCondition {
  field: FilterField;
  operator: FilterOperator;
  value: string | number;
}

/** Parsed filter AST (implicit AND of all conditions) */
export interface FilterAst {
  conditions: FilterCondition[];
}

/** Parser result with success/error status */
export type ParseResult =
  | { ok: true; ast: FilterAst }
  | { ok: false; error: string; position?: number };

/**
 * Evaluation context - the data record to evaluate.
 * Uses FilterField as keys for direct access in evaluator.
 */
export type FilterContext = Partial<Record<FilterField, string | number | null>>;
