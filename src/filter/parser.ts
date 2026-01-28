/**
 * Filter DSL v0.1 Parser
 *
 * Grammar:
 *   filter     = condition ( condition )*
 *   condition  = field operator value
 *   field      = identifier ( '.' identifier )?
 *   operator   = '==' | '!=' | '~=' | '>' | '<'
 *   value      = string_literal | number_literal
 *
 * String literals: "value" or 'value'
 * Numbers: 123 or 123.45 or -123
 *
 * No DOM dependencies - can be reused in CLI/Ledger.
 */

import type { FilterAst, FilterCondition, FilterField, FilterOperator, ParseResult } from './types.js';
import { isValidField } from './fields.js';

/** Valid operators in order of length (longest first for matching) */
const OPERATORS: FilterOperator[] = ['==', '!=', '~=', '>', '<'];

/**
 * Parse a filter expression into an AST
 * @param input - The filter expression (optionally prefixed with "filter:")
 * @returns ParseResult with AST or error
 */
export function parseFilter(input: string): ParseResult {
  // Strip optional "filter:" prefix for copy/paste compatibility
  let trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith('filter:')) {
    trimmed = trimmed.slice(7).trim();
  }

  // Empty filter matches everything
  if (!trimmed) {
    return { ok: true, ast: { conditions: [] } };
  }

  const conditions: FilterCondition[] = [];
  let pos = 0;

  while (pos < trimmed.length) {
    // Skip whitespace
    pos = skipWhitespace(trimmed, pos);
    if (pos >= trimmed.length) break;

    // Parse field
    const fieldResult = parseField(trimmed, pos);
    if (!fieldResult.ok) {
      return { ok: false, error: fieldResult.error, position: fieldResult.position };
    }
    pos = fieldResult.pos;

    // Skip whitespace
    pos = skipWhitespace(trimmed, pos);

    // Parse operator
    const opResult = parseOperator(trimmed, pos);
    if (!opResult.ok) {
      return { ok: false, error: opResult.error, position: opResult.position };
    }
    pos = opResult.pos;

    // Skip whitespace
    pos = skipWhitespace(trimmed, pos);

    // Parse value
    const valResult = parseValue(trimmed, pos);
    if (!valResult.ok) {
      return { ok: false, error: valResult.error, position: valResult.position };
    }
    pos = valResult.pos;

    conditions.push({
      field: fieldResult.field,
      operator: opResult.operator,
      value: valResult.value,
    });
  }

  return { ok: true, ast: { conditions } };
}

/** Skip whitespace characters */
function skipWhitespace(input: string, pos: number): number {
  while (pos < input.length && /\s/.test(input[pos])) {
    pos++;
  }
  return pos;
}

/** Parse a field name (e.g., "rpc.method") */
function parseField(
  input: string,
  pos: number
): { ok: true; field: FilterField; pos: number } | { ok: false; error: string; position: number } {
  const start = pos;

  // Read identifier characters (letters, digits, dots, underscores)
  while (pos < input.length && /[a-zA-Z0-9_.]/.test(input[pos])) {
    pos++;
  }

  if (pos === start) {
    return { ok: false, error: `Expected field name at char ${start + 1}`, position: start };
  }

  const field = input.slice(start, pos);

  if (!isValidField(field)) {
    return { ok: false, error: `Unknown field '${field}' at char ${start + 1}`, position: start };
  }

  return { ok: true, field, pos };
}

/** Parse an operator (==, !=, ~=, >, <) */
function parseOperator(
  input: string,
  pos: number
): { ok: true; operator: FilterOperator; pos: number } | { ok: false; error: string; position: number } {
  for (const op of OPERATORS) {
    if (input.slice(pos, pos + op.length) === op) {
      return { ok: true, operator: op, pos: pos + op.length };
    }
  }

  return {
    ok: false,
    error: `Expected operator (==, !=, ~=, >, <) at char ${pos + 1}`,
    position: pos,
  };
}

/** Parse a value (string literal or number) */
function parseValue(
  input: string,
  pos: number
): { ok: true; value: string | number; pos: number } | { ok: false; error: string; position: number } {
  if (pos >= input.length) {
    return { ok: false, error: `Expected value at char ${pos + 1}`, position: pos };
  }

  const char = input[pos];

  // String literal with double quotes
  if (char === '"') {
    return parseStringLiteral(input, pos, '"');
  }

  // String literal with single quotes
  if (char === "'") {
    return parseStringLiteral(input, pos, "'");
  }

  // Number (including negative)
  if (/[0-9-]/.test(char)) {
    return parseNumber(input, pos);
  }

  // Unquoted identifier (for convenience)
  if (/[a-zA-Z_]/.test(char)) {
    return parseUnquotedValue(input, pos);
  }

  return { ok: false, error: `Unexpected character '${char}' at char ${pos + 1}`, position: pos };
}

/** Parse a quoted string literal */
function parseStringLiteral(
  input: string,
  pos: number,
  quote: '"' | "'"
): { ok: true; value: string; pos: number } | { ok: false; error: string; position: number } {
  const start = pos;
  pos++; // Skip opening quote

  let value = '';
  while (pos < input.length) {
    const char = input[pos];

    if (char === quote) {
      return { ok: true, value, pos: pos + 1 };
    }

    if (char === '\\' && pos + 1 < input.length) {
      // Handle escape sequences
      const next = input[pos + 1];
      if (next === quote || next === '\\') {
        value += next;
        pos += 2;
        continue;
      }
    }

    value += char;
    pos++;
  }

  return { ok: false, error: `Unterminated string starting at char ${start + 1}`, position: start };
}

/** Parse a number (integer or decimal) */
function parseNumber(
  input: string,
  pos: number
): { ok: true; value: number; pos: number } | { ok: false; error: string; position: number } {
  const start = pos;

  // Optional negative sign
  if (input[pos] === '-') {
    pos++;
  }

  // Must have at least one digit
  if (pos >= input.length || !/[0-9]/.test(input[pos])) {
    return { ok: false, error: `Expected number at char ${start + 1}`, position: start };
  }

  // Integer part
  while (pos < input.length && /[0-9]/.test(input[pos])) {
    pos++;
  }

  // Optional decimal part
  if (pos < input.length && input[pos] === '.') {
    pos++;
    while (pos < input.length && /[0-9]/.test(input[pos])) {
      pos++;
    }
  }

  const numStr = input.slice(start, pos);
  const value = Number(numStr);

  if (isNaN(value)) {
    return { ok: false, error: `Invalid number '${numStr}' at char ${start + 1}`, position: start };
  }

  return { ok: true, value, pos };
}

/** Parse an unquoted value (for convenience, e.g., ok instead of "ok") */
function parseUnquotedValue(
  input: string,
  pos: number
): { ok: true; value: string; pos: number } | { ok: false; error: string; position: number } {
  const start = pos;

  while (pos < input.length && /[a-zA-Z0-9_/-]/.test(input[pos])) {
    pos++;
  }

  if (pos === start) {
    return { ok: false, error: `Expected value at char ${start + 1}`, position: start };
  }

  return { ok: true, value: input.slice(start, pos), pos };
}
