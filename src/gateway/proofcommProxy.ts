/**
 * ProofComm Proxy handler
 * Phase 9.0: ProofComm Management Endpoints
 *
 * Provides management endpoints for ProofComm features:
 * - Document registration and management
 * - Document memory access
 *
 * Note: Actual document conversations go through /a2a/v1/* via doc/ routing
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import type { AuthInfo } from './authMiddleware.js';
import { DocumentsStore, type DocumentConfig } from '../db/documents-store.js';
import { TargetsStore } from '../db/targets-store.js';
import {
  validateDocumentPath,
  getDocumentName,
  readDocument,
  DocumentStoreError,
} from '../proofcomm/document/index.js';
import {
  validateTargetIdForRegistration,
  buildDocumentRoute,
} from '../proofcomm/routing.js';
import { emitDocumentEvent } from '../proofcomm/events.js';
import type { AuditLogger } from './audit.js';

/**
 * Document registration request body
 */
interface RegisterDocumentBody {
  /** Path to the document file */
  document_path: string;
  /** Document name (optional, defaults to filename) */
  name?: string;
  /** Document description (optional) */
  description?: string;
}

/**
 * Document memory update request body
 */
interface UpdateMemoryBody {
  /** Memory update (merged with existing) */
  memory: {
    facts?: string[];
    conversationSummary?: string;
    [key: string]: unknown;
  };
}

/**
 * ProofComm Proxy options
 */
export interface ProofCommProxyOptions {
  /** Config directory path */
  configDir: string;
  /** Audit logger */
  auditLogger: AuditLogger;
  /**
   * Allowed root directory for document paths.
   * If specified, document registration will only accept paths within this directory.
   * This is a security measure to prevent access to arbitrary filesystem locations.
   */
  allowedDocumentRoot?: string;
}

/**
 * Authentication preHandler for ProofComm routes
 * Centralizes auth check to avoid duplication across all endpoints
 */
async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = request.auth as AuthInfo | undefined;
  if (!auth) {
    return reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }
}

/**
 * Register ProofComm routes on a Fastify instance
 */
export function registerProofCommRoutes(
  fastify: FastifyInstance,
  options: ProofCommProxyOptions
): void {
  const documentsStore = new DocumentsStore(options.configDir);
  const targetsStore = new TargetsStore(options.configDir);

  // POST /proofcomm/documents/register - Register a new document
  fastify.post<{
    Body: RegisterDocumentBody;
  }>('/proofcomm/documents/register', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const auth = request.auth as AuthInfo;

    const { document_path, name, description } = request.body;

    // Validate document path (with optional root restriction for security)
    const pathValidation = validateDocumentPath(document_path, {
      allowedRoot: options.allowedDocumentRoot,
    });
    if (!pathValidation.valid) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PATH',
          message: pathValidation.error || 'Invalid document path',
        },
      });
    }

    // Check if document already registered for this path
    const existing = documentsStore.getByPath(document_path);
    if (existing) {
      return reply.code(409).send({
        error: {
          code: 'ALREADY_EXISTS',
          message: `Document already registered at path: ${document_path}`,
          doc_id: existing.docId,
        },
      });
    }

    // Read document to get hash
    let docContent;
    try {
      docContent = await readDocument(document_path);
    } catch (err) {
      if (err instanceof DocumentStoreError) {
        return reply.code(400).send({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }
      throw err;
    }

    // Determine document name
    const docName = name || getDocumentName(document_path);

    // Create document record
    const docConfig: DocumentConfig = {
      schemaVersion: 1,
      description,
    };

    // Generate document ID first (shared between both tables)
    const docId = ulid();

    // Register in targets table FIRST for atomicity.
    // If this fails, no orphaned resident_documents row is created.
    // Type: 'agent', Protocol: 'a2a', with document_type in config
    targetsStore.add(
      {
        type: 'agent',
        protocol: 'a2a',
        name: docName,
        enabled: true,
        config: {
          schema_version: 1,
          url: `internal://document/${docId}`,
          document_type: 'resident',
        },
      },
      { id: docId }
    );

    // Now add to resident_documents (uses same docId)
    const doc = documentsStore.add({
      name: docName,
      documentPath: document_path,
      documentHash: docContent.hash,
      config: docConfig,
    }, docId);

    // Emit document activated event
    emitDocumentEvent(options.auditLogger, 'activated', {
      doc_target_id: doc.docId,
      doc_path: document_path,
    }, {
      requestId: request.requestId,
      traceId: request.headers['x-trace-id'] as string | undefined,
      clientId: auth.client_id,
    });

    return reply.code(201).send({
      doc_id: doc.docId,
      target_id: doc.docId,
      name: doc.name,
      document_path: doc.documentPath,
      document_hash: doc.documentHash,
      route: buildDocumentRoute(doc.docId),
    });
  });

  // GET /proofcomm/documents - List all documents
  fastify.get('/proofcomm/documents', {
    preHandler: requireAuth,
  }, async (_request, reply) => {
    const docs = documentsStore.list();

    return reply.send({
      documents: docs.map(doc => ({
        doc_id: doc.docId,
        name: doc.name,
        document_path: doc.documentPath,
        document_hash: doc.documentHash,
        has_memory: !!doc.memory,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
        route: buildDocumentRoute(doc.docId),
      })),
      count: docs.length,
    });
  });

  // GET /proofcomm/documents/:doc_id - Get document details
  fastify.get<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { doc_id } = request.params;
    const doc = documentsStore.get(doc_id);

    if (!doc) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    return reply.send({
      doc_id: doc.docId,
      name: doc.name,
      document_path: doc.documentPath,
      document_hash: doc.documentHash,
      memory: doc.memory,
      config: doc.config,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
      route: buildDocumentRoute(doc.docId),
    });
  });

  // GET /proofcomm/documents/:doc_id/memory - Get document memory
  fastify.get<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id/memory', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { doc_id } = request.params;
    const doc = documentsStore.get(doc_id);

    if (!doc) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    return reply.send({
      doc_id: doc.docId,
      memory: doc.memory || {},
    });
  });

  // PUT /proofcomm/documents/:doc_id/memory - Update document memory
  fastify.put<{
    Params: { doc_id: string };
    Body: UpdateMemoryBody;
  }>('/proofcomm/documents/:doc_id/memory', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const auth = request.auth as AuthInfo;

    const { doc_id } = request.params;
    const { memory } = request.body;

    if (!documentsStore.exists(doc_id)) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    const success = documentsStore.updateMemory(doc_id, memory);

    if (!success) {
      return reply.code(500).send({
        error: {
          code: 'UPDATE_FAILED',
          message: 'Failed to update memory',
        },
      });
    }

    // Emit context updated event
    emitDocumentEvent(options.auditLogger, 'context_updated', {
      doc_target_id: doc_id,
    }, {
      requestId: request.requestId,
      traceId: request.headers['x-trace-id'] as string | undefined,
      clientId: auth.client_id,
    });

    const doc = documentsStore.get(doc_id);
    return reply.send({
      doc_id: doc_id,
      memory: doc?.memory || {},
    });
  });

  // DELETE /proofcomm/documents/:doc_id/memory - Clear document memory
  fastify.delete<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id/memory', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { doc_id } = request.params;

    if (!documentsStore.exists(doc_id)) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    const success = documentsStore.setMemory(doc_id, null);

    if (!success) {
      return reply.code(500).send({
        error: {
          code: 'UPDATE_FAILED',
          message: 'Failed to clear memory',
        },
      });
    }

    return reply.code(204).send();
  });

  // DELETE /proofcomm/documents/:doc_id - Remove document
  fastify.delete<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { doc_id } = request.params;

    // Remove from documents store
    const docRemoved = documentsStore.remove(doc_id);
    if (!docRemoved) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    // Also remove from targets store
    targetsStore.remove(doc_id);

    return reply.code(204).send();
  });

  // POST /proofcomm/documents/:doc_id/refresh - Refresh document hash
  fastify.post<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id/refresh', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const auth = request.auth as AuthInfo;

    const { doc_id } = request.params;
    const doc = documentsStore.get(doc_id);

    if (!doc) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    // Read document to get new hash
    let docContent;
    try {
      docContent = await readDocument(doc.documentPath);
    } catch (err) {
      if (err instanceof DocumentStoreError) {
        return reply.code(400).send({
          error: {
            code: err.code,
            message: err.message,
          },
        });
      }
      throw err;
    }

    const changed = doc.documentHash !== docContent.hash;

    if (changed) {
      documentsStore.updateHash(doc_id, docContent.hash);

      // Emit context updated event
      emitDocumentEvent(options.auditLogger, 'context_updated', {
        doc_target_id: doc_id,
        doc_path: doc.documentPath,
      }, {
        requestId: request.requestId,
        traceId: request.headers['x-trace-id'] as string | undefined,
        clientId: auth.client_id,
      });
    }

    return reply.send({
      doc_id: doc_id,
      document_hash: docContent.hash,
      previous_hash: doc.documentHash,
      changed,
    });
  });
}
