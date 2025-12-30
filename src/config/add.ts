/**
 * Config add - parse and normalize MCP server JSON from various sources
 *
 * Supports:
 * - Claude Desktop format: { "mcpServers": { "<id>": { "command": "...", ... } } }
 * - Single object: { "id": "...", "command": "...", ... }
 * - Array: [ { "id": "...", "command": "...", ... }, ... ]
 */

import type { Connector, StdioTransport } from '../types/index.js';
import { sanitizeSecrets } from '../utils/sanitize-secrets.js';

// ============================================================
// Types
// ============================================================

/** Parsed connector from JSON input */
export interface ParsedConnector {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Result of parsing JSON input */
export interface ParseResult {
  success: boolean;
  connectors: ParsedConnector[];
  errors: string[];
}

/** Result of add operation */
export interface AddResult {
  added: string[];
  updated: string[];
  skipped: string[];
  duplicates: string[];
  /** Phase 3.4: Number of secret references sanitized */
  secret_refs_sanitized: number;
}

// ============================================================
// JSON Parsing
// ============================================================

/**
 * Check if value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if value is a string array
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

/**
 * Check if value is a string-to-string object
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([k, v]) => typeof k === 'string' && typeof v === 'string'
  );
}

/**
 * Validate and extract connector from a single object
 */
function validateConnectorObject(
  obj: unknown,
  id?: string
): { connector: ParsedConnector | null; error: string | null } {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { connector: null, error: 'Expected an object' };
  }

  const record = obj as Record<string, unknown>;

  // Get id from object or provided parameter
  const connectorId = id ?? record.id;
  if (!isNonEmptyString(connectorId)) {
    return { connector: null, error: 'Missing or invalid "id" field' };
  }

  // Validate command
  if (!isNonEmptyString(record.command)) {
    return { connector: null, error: `Connector "${connectorId}": missing or invalid "command"` };
  }

  // Validate args if present
  if (record.args !== undefined && !isStringArray(record.args)) {
    return { connector: null, error: `Connector "${connectorId}": "args" must be an array of strings` };
  }

  // Validate env if present
  if (record.env !== undefined && !isStringRecord(record.env)) {
    return { connector: null, error: `Connector "${connectorId}": "env" must be an object with string values` };
  }

  return {
    connector: {
      id: connectorId,
      command: record.command,
      args: record.args as string[] | undefined,
      env: record.env as Record<string, string> | undefined,
    },
    error: null,
  };
}

/**
 * Parse Claude Desktop format: { "mcpServers": { "<id>": { ... } } }
 */
function parseClaudeDesktopFormat(obj: Record<string, unknown>): ParseResult {
  const mcpServers = obj.mcpServers;
  if (typeof mcpServers !== 'object' || mcpServers === null || Array.isArray(mcpServers)) {
    return { success: false, connectors: [], errors: ['Invalid mcpServers format'] };
  }

  const connectors: ParsedConnector[] = [];
  const errors: string[] = [];

  for (const [id, serverConfig] of Object.entries(mcpServers)) {
    const result = validateConnectorObject(serverConfig, id);
    if (result.connector) {
      connectors.push(result.connector);
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return { success: errors.length === 0, connectors, errors };
}

/**
 * Parse array format: [ { "id": "...", ... }, ... ]
 */
function parseArrayFormat(arr: unknown[]): ParseResult {
  const connectors: ParsedConnector[] = [];
  const errors: string[] = [];

  for (let i = 0; i < arr.length; i++) {
    const result = validateConnectorObject(arr[i]);
    if (result.connector) {
      connectors.push(result.connector);
    } else if (result.error) {
      errors.push(`[${i}]: ${result.error}`);
    }
  }

  return { success: errors.length === 0, connectors, errors };
}

/**
 * Parse and normalize JSON input to connector list
 */
export function parseConnectorJson(jsonString: string): ParseResult {
  // Try to parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { success: false, connectors: [], errors: [`Invalid JSON: ${message}`] };
  }

  // Case A: Claude Desktop format with mcpServers
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if ('mcpServers' in obj) {
      return parseClaudeDesktopFormat(obj);
    }

    // Case B: Single object with id and command
    if ('command' in obj) {
      const result = validateConnectorObject(obj);
      if (result.connector) {
        return { success: true, connectors: [result.connector], errors: [] };
      }
      return { success: false, connectors: [], errors: [result.error || 'Invalid connector'] };
    }

    return { success: false, connectors: [], errors: ['Unrecognized JSON format'] };
  }

  // Case C: Array format
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { success: false, connectors: [], errors: ['Empty array'] };
    }
    return parseArrayFormat(parsed);
  }

  return { success: false, connectors: [], errors: ['Expected object or array'] };
}

// ============================================================
// Connector Conversion
// ============================================================

/** Result of toConnector with secret sanitization */
export interface ToConnectorResult {
  connector: Connector;
  secretRefCount: number;
}

/**
 * Convert ParsedConnector to Connector type
 * Phase 3.4: Sanitizes secret references in env values
 *
 * @returns Connector with sanitized env and count of secret refs found
 */
export function toConnector(parsed: ParsedConnector): ToConnectorResult {
  let secretRefCount = 0;

  const transport: StdioTransport = {
    type: 'stdio',
    command: parsed.command,
  };

  if (parsed.args && parsed.args.length > 0) {
    transport.args = parsed.args;
  }

  if (parsed.env && Object.keys(parsed.env).length > 0) {
    // Sanitize secret references in env
    const sanitizeResult = sanitizeSecrets(parsed.env);
    transport.env = sanitizeResult.value as Record<string, string>;
    secretRefCount = sanitizeResult.count;
  }

  return {
    connector: {
      id: parsed.id,
      enabled: true,
      transport,
    },
    secretRefCount,
  };
}

// ============================================================
// Duplicate Detection
// ============================================================

/**
 * Check for duplicates between parsed connectors and existing ones
 */
export function findDuplicates(
  parsed: ParsedConnector[],
  existing: Connector[]
): string[] {
  const existingIds = new Set(existing.map(c => c.id));
  return parsed.filter(p => existingIds.has(p.id)).map(p => p.id);
}

/**
 * Check for duplicates within parsed connectors
 */
export function findInternalDuplicates(parsed: ParsedConnector[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const p of parsed) {
    if (seen.has(p.id)) {
      if (!duplicates.includes(p.id)) {
        duplicates.push(p.id);
      }
    } else {
      seen.add(p.id);
    }
  }

  return duplicates;
}
