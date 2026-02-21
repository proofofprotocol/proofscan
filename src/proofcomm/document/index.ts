/**
 * ProofComm Document Module
 * Phase 9.0: Resident document agent system
 *
 * Exports all document-related functionality for ProofComm.
 */

// Types
export {
  type DocumentContent,
  type DocumentContext,
  type DocumentMemoryState,
  type TextPart,
  type DataPart,
  type MessagePart,
  type DocumentMessage,
  type DocumentResponse,
  type RegisterDocumentRequest,
  type RegisterDocumentResult,
  type DocumentRegistrationConfig,
  type DocumentInfo,
  isTextPart,
  isDataPart,
  extractText,
  a2aToDocumentMessage,
  documentResponseToA2AParts,
} from './types.js';

// Store (file operations)
export {
  DocumentStoreError,
  type ReadDocumentOptions,
  computeHash,
  detectMimeType,
  fileExists,
  readDocument,
  hasDocumentChanged,
  getDocumentName,
  validateDocumentPath,
} from './store.js';

// Memory management
export { DocumentMemoryManager } from './memory.js';

// Responder
export { DocumentResponder, type ResponderOptions } from './responder.js';
