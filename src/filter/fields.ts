/**
 * Filter Field Definitions
 *
 * Provides metadata for autocomplete and validation.
 * No DOM dependencies - can be reused in CLI/Ledger.
 */

import type { FilterField } from './types.js';

/** Field definition for autocomplete and validation */
export interface FieldDefinition {
  name: FilterField;
  description: string;
  type: 'string' | 'number';
  examples?: string[];
}

/** All supported filter fields with metadata */
export const FILTER_FIELDS: FieldDefinition[] = [
  {
    name: 'session.id',
    description: 'Session ID (ULID)',
    type: 'string',
  },
  {
    name: 'session.latency',
    description: 'Total session latency (ms)',
    type: 'number',
  },
  {
    name: 'rpc.id',
    description: 'RPC call ID',
    type: 'string',
  },
  {
    name: 'rpc.method',
    description: 'RPC method name',
    type: 'string',
    examples: ['initialize', 'tools/call', 'tools/list', 'resources/list', 'prompts/list'],
  },
  {
    name: 'rpc.status',
    description: 'RPC status',
    type: 'string',
    examples: ['ok', 'err', 'pending'],
  },
  {
    name: 'rpc.latency',
    description: 'RPC latency (ms)',
    type: 'number',
  },
  {
    name: 'tools.method',
    description: 'Tool method (alias of tools.name)',
    type: 'string',
  },
  {
    name: 'tools.name',
    description: 'Called tool name',
    type: 'string',
  },
  // A2A message fields
  {
    name: 'message.id',
    description: 'A2A message ID',
    type: 'string',
  },
  {
    name: 'message.role',
    description: 'Message role (user/assistant)',
    type: 'string',
    examples: ['user', 'assistant'],
  },
  {
    name: 'message.content',
    description: 'Message content text',
    type: 'string',
  },
  {
    name: 'message.timestamp',
    description: 'Message timestamp (ISO)',
    type: 'string',
  },
  {
    name: 'event.kind',
    description: 'Event kind',
    type: 'string',
    examples: ['request', 'response', 'notification', 'transport_event'],
  },
  {
    name: 'event.type',
    description: 'Transport event type',
    type: 'string',
    examples: ['connected', 'disconnected'],
  },
  {
    name: 'direction',
    description: 'Message direction',
    type: 'string',
    examples: ['req', 'res', 'trans'],
  },
];

/** Set of valid field names for fast lookup */
export const VALID_FIELDS: Set<string> = new Set(FILTER_FIELDS.map((f) => f.name));

/**
 * Suggest fields matching a prefix (for autocomplete)
 * @param prefix - The prefix to match (case-insensitive)
 * @returns Array of matching field definitions
 */
export function suggestFields(prefix: string): FieldDefinition[] {
  const lower = prefix.toLowerCase();
  return FILTER_FIELDS.filter((f) => f.name.startsWith(lower));
}

/**
 * Check if a field name is valid
 * @param field - Field name to check
 * @returns true if valid
 */
export function isValidField(field: string): field is FilterField {
  return VALID_FIELDS.has(field);
}
