/**
 * ProofComm Resident Document Types
 * Phase 9.0: Type definitions for document agent system
 */

import type { A2AMessage } from '../../db/types.js';

/**
 * Document content structure returned from file reading
 */
export interface DocumentContent {
  /** Raw text content of the document */
  text: string;
  /** Content hash (SHA-256) */
  hash: string;
  /** File size in bytes */
  size: number;
  /** MIME type (if detected) */
  mimeType?: string;
  /** Last modified timestamp (ISO8601) */
  modifiedAt: string;
}

/**
 * Document context for responder
 */
export interface DocumentContext {
  /** Document ID */
  docId: string;
  /** Document name */
  name: string;
  /** Document content */
  content: DocumentContent;
  /** Memory state */
  memory?: DocumentMemoryState;
}

/**
 * Document memory state
 */
export interface DocumentMemoryState {
  /** Summary of previous conversations */
  conversationSummary?: string;
  /** Key facts extracted from conversations */
  facts?: string[];
  /** Last interaction timestamp */
  lastInteractionAt?: string;
  /** Interaction count */
  interactionCount?: number;
  /** Custom fields */
  [key: string]: unknown;
}

/**
 * Message part types (matching A2A protocol)
 */
export interface TextPart {
  text: string;
}

export interface DataPart {
  data: string;
  mimeType: string;
}

export type MessagePart = TextPart | DataPart;

/**
 * Document message (incoming)
 */
export interface DocumentMessage {
  /** Sender agent ID or URL */
  from: string;
  /** Message parts */
  parts: MessagePart[];
  /** Message ID (optional) */
  messageId?: string;
  /** Message metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Document response (outgoing)
 */
export interface DocumentResponse {
  /** Response parts */
  parts: MessagePart[];
  /** Whether memory was updated */
  memoryUpdated: boolean;
  /** Updated memory (if changed) */
  updatedMemory?: DocumentMemoryState;
}

/**
 * Document registration request
 */
export interface RegisterDocumentRequest {
  /** Path to the document file */
  documentPath: string;
  /** Document name (optional, defaults to filename) */
  name?: string;
  /** Initial config (optional) */
  config?: DocumentRegistrationConfig;
}

/**
 * Document registration config
 */
export interface DocumentRegistrationConfig {
  /** Schema version */
  schemaVersion: number;
  /** Document description */
  description?: string;
  /** Auto-update hash on file change */
  autoUpdateHash?: boolean;
}

/**
 * Document registration result
 */
export interface RegisterDocumentResult {
  /** Generated document ID */
  docId: string;
  /** Target ID (same as docId for unified identification) */
  targetId: string;
  /** Document name */
  name: string;
  /** Document path */
  documentPath: string;
  /** Content hash */
  documentHash: string;
}

/**
 * Document info (for listing/status)
 */
export interface DocumentInfo {
  /** Document ID */
  docId: string;
  /** Document name */
  name: string;
  /** Document path */
  documentPath: string;
  /** Content hash */
  documentHash?: string;
  /** Has memory */
  hasMemory: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt?: string;
  /** Config */
  config?: DocumentRegistrationConfig;
}

/**
 * Type guard: check if part is TextPart
 */
export function isTextPart(part: MessagePart): part is TextPart {
  return 'text' in part && typeof part.text === 'string';
}

/**
 * Type guard: check if part is DataPart
 */
export function isDataPart(part: MessagePart): part is DataPart {
  return 'data' in part && 'mimeType' in part;
}

/**
 * Extract text from message parts
 */
export function extractText(parts: MessagePart[]): string {
  return parts
    .filter(isTextPart)
    .map(p => p.text)
    .join(' ');
}

/**
 * Convert A2AMessage to DocumentMessage
 */
export function a2aToDocumentMessage(
  a2aMessage: A2AMessage,
  from: string
): DocumentMessage {
  return {
    from,
    parts: a2aMessage.parts as MessagePart[],
    messageId: a2aMessage.messageId,
    metadata: a2aMessage.metadata,
  };
}

/**
 * Convert DocumentResponse to A2AMessage parts
 */
export function documentResponseToA2AParts(
  response: DocumentResponse
): Array<{ text: string } | { data: string; mimeType: string }> {
  return response.parts.map(part => {
    if (isTextPart(part)) {
      return { text: part.text };
    }
    return { data: part.data, mimeType: part.mimeType };
  });
}
