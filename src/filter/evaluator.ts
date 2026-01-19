/**
 * Filter DSL v0.1 Evaluator
 *
 * Evaluates parsed FilterAst against a FilterContext record.
 * All conditions are ANDed together.
 *
 * No DOM dependencies - can be reused in CLI/Ledger.
 */

import type { FilterAst, FilterCondition, FilterContext } from './types.js';

/**
 * Evaluate a filter AST against a context record
 * @param ast - Parsed filter AST
 * @param ctx - Context record to evaluate
 * @returns true if record matches all conditions (implicit AND)
 */
export function evaluateFilter(ast: FilterAst, ctx: FilterContext): boolean {
  // Empty filter matches everything
  if (ast.conditions.length === 0) {
    return true;
  }

  // All conditions must match (implicit AND)
  return ast.conditions.every((cond) => evaluateCondition(cond, ctx));
}

/**
 * Evaluate a single condition against a context
 */
function evaluateCondition(cond: FilterCondition, ctx: FilterContext): boolean {
  const val = ctx[cond.field];

  // null/undefined handling:
  // - != returns true (field doesn't equal anything if it doesn't exist)
  // - all other operators return false
  if (val === null || val === undefined) {
    return cond.operator === '!=';
  }

  switch (cond.operator) {
    case '==':
      return compareEqual(val, cond.value);
    case '!=':
      return !compareEqual(val, cond.value);
    case '~=':
      return compareSubstring(val, cond.value);
    case '>':
      return compareNumeric(val, cond.value, (a, b) => a > b);
    case '<':
      return compareNumeric(val, cond.value, (a, b) => a < b);
    default:
      return false;
  }
}

/**
 * Case-insensitive equality comparison
 */
function compareEqual(fieldValue: string | number, condValue: string | number): boolean {
  return String(fieldValue).toLowerCase() === String(condValue).toLowerCase();
}

/**
 * Case-insensitive substring match
 */
function compareSubstring(fieldValue: string | number, condValue: string | number): boolean {
  return String(fieldValue).toLowerCase().includes(String(condValue).toLowerCase());
}

/**
 * Numeric comparison with NaN guard
 * Returns false if either value is not a valid number
 */
function compareNumeric(
  fieldValue: string | number,
  condValue: string | number,
  compareFn: (a: number, b: number) => boolean
): boolean {
  const numField = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
  const numCond = typeof condValue === 'number' ? condValue : Number(condValue);

  if (isNaN(numField) || isNaN(numCond)) {
    return false;
  }

  return compareFn(numField, numCond);
}
