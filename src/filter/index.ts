/**
 * Filter DSL v0.1
 *
 * Public API for filter parsing and evaluation.
 * No DOM dependencies - can be reused in CLI/Ledger.
 */

// Types
export type {
  FilterAst,
  FilterCondition,
  FilterContext,
  FilterField,
  FilterOperator,
  ParseResult,
} from './types.js';

// Field definitions (for autocomplete)
export type { FieldDefinition } from './fields.js';
export { FILTER_FIELDS, VALID_FIELDS, isValidField, suggestFields } from './fields.js';

// Parser
export { parseFilter } from './parser.js';

// Evaluator
export { evaluateFilter } from './evaluator.js';
