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
import { hasPermission, buildProofCommPermission } from './permissions.js';
import { DocumentsStore, type DocumentConfig } from '../db/documents-store.js';
import { SkillsStore } from '../db/skills-store.js';
import { SkillRegistry } from '../proofcomm/skill-registry.js';
import { TargetsStore } from '../db/targets-store.js';
import {
  validateDocumentPath,
  getDocumentName,
  readDocument,
  DocumentStoreError,
} from '../proofcomm/document/index.js';
import { buildDocumentRoute } from '../proofcomm/routing.js';
import { emitDocumentEvent, emitSkillEvent } from '../proofcomm/events.js';
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
 * Get authenticated user info with runtime type guard
 * Throws if auth is not present (should never happen after requireAuth preHandler)
 */
function getAuth(request: FastifyRequest): AuthInfo {
  const auth = request.auth as AuthInfo | undefined;
  if (!auth) {
    // This should never happen as requireAuth preHandler should have blocked it
    throw new Error('Authentication required but not present');
  }
  return auth;
}

/**
 * Register ProofComm routes on a Fastify instance
 */
export function registerProofCommRoutes(
  fastify: FastifyInstance,
  options: ProofCommProxyOptions
): void {
  const documentsStore = new DocumentsStore(options.configDir);
  const skillsStore = new SkillsStore(options.configDir);
  const skillRegistry = new SkillRegistry(skillsStore);
  const targetsStore = new TargetsStore(options.configDir);

  // POST /proofcomm/documents/register - Register a new document
  fastify.post<{
    Body: RegisterDocumentBody;
  }>('/proofcomm/documents/register', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['document_path'],
        properties: {
          document_path: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = getAuth(request);

    // Security: Refuse registration if allowedDocumentRoot is not configured
    // Without this constraint, any authenticated client can read arbitrary files
    if (!options.allowedDocumentRoot) {
      return reply.code(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Document registration is disabled: allowedDocumentRoot not configured',
        },
      });
    }

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
        // Map error codes to appropriate HTTP status
        const statusCode = err.code === 'FILE_NOT_FOUND' ? 404
          : err.code === 'TOO_LARGE' ? 413
          : 400;
        return reply.code(statusCode).send({
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

    // Atomically register in both targets and resident_documents tables.
    // Uses a SQLite transaction to ensure both inserts succeed or both fail.
    let doc;
    try {
      doc = documentsStore.addWithTarget(
        {
          name: docName,
          documentPath: document_path,
          documentHash: docContent.hash,
          config: docConfig,
        },
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
        docId
      );
    } catch (err) {
      // Handle UNIQUE constraint violation (concurrent registration of same path)
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({
          error: {
            code: 'CONFLICT',
            message: `Document already registered for path: ${document_path}`,
          },
        });
      }
      throw err;
    }

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
    schema: {
      body: {
        type: 'object',
        required: ['memory'],
        properties: {
          memory: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = getAuth(request);

    const { doc_id } = request.params;
    const { memory } = request.body;

    // Atomic update - no separate exists check to avoid TOCTOU race
    const success = documentsStore.updateMemory(doc_id, memory);

    if (!success) {
      // updateMemory returns false if document not found
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
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
    const auth = getAuth(request);
    const { doc_id } = request.params;

    // Atomic clear - no separate exists check to avoid TOCTOU race
    const success = documentsStore.setMemory(doc_id, null);

    if (!success) {
      // setMemory returns false if document not found
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    // Emit context updated event (memory cleared)
    emitDocumentEvent(options.auditLogger, 'context_updated', {
      doc_target_id: doc_id,
    }, {
      requestId: request.requestId,
      traceId: request.headers['x-trace-id'] as string | undefined,
      clientId: auth.client_id,
    });

    return reply.code(204).send();
  });

  // DELETE /proofcomm/documents/:doc_id - Remove document
  fastify.delete<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const auth = getAuth(request);
    const { doc_id } = request.params;

    // Get document info before deletion for audit event
    const doc = documentsStore.get(doc_id);
    if (!doc) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document not found: ${doc_id}`,
        },
      });
    }

    // Atomically remove from both documents and targets stores
    documentsStore.removeWithTarget(doc_id);

    // Emit document deactivated event
    emitDocumentEvent(options.auditLogger, 'deactivated', {
      doc_target_id: doc_id,
      doc_path: doc.documentPath,
    }, {
      requestId: request.requestId,
      traceId: request.headers['x-trace-id'] as string | undefined,
      clientId: auth.client_id,
    });

    return reply.code(204).send();
  });

  // POST /proofcomm/documents/:doc_id/refresh - Refresh document hash
  fastify.post<{
    Params: { doc_id: string };
  }>('/proofcomm/documents/:doc_id/refresh', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const auth = getAuth(request);

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

    // Re-validate path before reading (security: prevent symlink escape after registration)
    const pathValidation = validateDocumentPath(doc.documentPath, {
      allowedRoot: options.allowedDocumentRoot,
    });
    if (!pathValidation.valid) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_PATH',
          message: pathValidation.error || 'Document path is no longer valid',
        },
      });
    }

    // Read document to get new hash
    let docContent;
    try {
      docContent = await readDocument(doc.documentPath);
    } catch (err) {
      if (err instanceof DocumentStoreError) {
        // Map error codes to appropriate HTTP status
        const statusCode = err.code === 'FILE_NOT_FOUND' ? 404
          : err.code === 'TOO_LARGE' ? 413
          : 400;
        return reply.code(statusCode).send({
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

  // ==================== Skill Routes (Phase 9.2) ====================

  // GET /proofcomm/skills - List all cached skills
  fastify.get('/proofcomm/skills', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { agent_id } = request.query as { agent_id?: string };
    const skills = skillRegistry.list(agent_id);
    return reply.send({ skills, count: skills.length });
  });

  // GET /proofcomm/skills/search - Search skills
  fastify.get('/proofcomm/skills/search', {
    preHandler: requireAuth,
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 200 },
          tags: { type: 'string' },  // comma-separated
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const auth = getAuth(request);
    const { q, tags, limit } = request.query as {
      q: string;
      tags?: string;
      limit?: number;
    };

    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined;
    const results = skillRegistry.search(q, tagList, limit ?? 10);

    emitSkillEvent(options.auditLogger, 'search', {
      skill_name: q,
    }, {
      requestId: request.requestId,
      traceId: request.headers['x-trace-id'] as string | undefined,
      clientId: auth.client_id,
    });

    return reply.send({ results, count: results.length });
  });

  // POST /proofcomm/skills/refresh/:agent_id - Refresh skills from agent card
  fastify.post<{
    Params: { agent_id: string };
    Body: { agent_card: Record<string, unknown> };
  }>('/proofcomm/skills/refresh/:agent_id', {
    preHandler: requireAuth,
    schema: {
      params: {
        type: 'object',
        required: ['agent_id'],
        properties: {
          agent_id: { type: 'string', minLength: 1 },
        },
      },
      body: {
        type: 'object',
        required: ['agent_card'],
        properties: {
          agent_card: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const auth = getAuth(request);
    const { agent_id } = request.params;
    const { agent_card } = request.body;

    // Permission check: require write permission scoped to agent_id
    const requiredPerm = buildProofCommPermission('skills', 'write', agent_id);
    if (!hasPermission(auth.permissions, requiredPerm)) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Permission denied: ${requiredPerm}`,
        },
      });
    }

    // Security: Validate that agent_id corresponds to a registered target
    // to prevent cache poisoning with fake agent IDs
    const target = targetsStore.get(agent_id);
    if (!target) {
      return reply.code(404).send({
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent not registered: ${agent_id}`,
        },
      });
    }

    const count = skillRegistry.refreshFromAgentCard(agent_id, agent_card);

    // -1 means skills key was missing (no-op)
    if (count === -1) {
      return reply.code(200).send({
        agent_id,
        skills_cached: null,
        message: 'No skills key in agent card, cache unchanged',
      });
    }

    emitSkillEvent(options.auditLogger, 'refresh', {
      agent_id,
    }, {
      requestId: request.requestId,
      traceId: request.headers['x-trace-id'] as string | undefined,
      clientId: auth.client_id,
    });

    return reply.code(200).send({
      agent_id,
      skills_cached: count,
    });
  });

  // DELETE /proofcomm/skills/:agent_id - Clear all skills for an agent
  fastify.delete<{
    Params: { agent_id: string };
  }>('/proofcomm/skills/:agent_id', {
    preHandler: requireAuth,
    schema: {
      params: {
        type: 'object',
        required: ['agent_id'],
        properties: {
          agent_id: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const auth = getAuth(request);
    const { agent_id } = request.params;

    // Permission check: require write permission scoped to agent_id
    const requiredPerm = buildProofCommPermission('skills', 'write', agent_id);
    if (!hasPermission(auth.permissions, requiredPerm)) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Permission denied: ${requiredPerm}`,
        },
      });
    }

    // Validate agent exists (consistency with refresh endpoint)
    const target = targetsStore.get(agent_id);
    if (!target) {
      return reply.code(404).send({
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent not registered: ${agent_id}`,
        },
      });
    }

    const deleted = skillRegistry.clearAgent(agent_id);
    return reply.code(200).send({ agent_id, deleted });
  });

  // POST /proofcomm/skills/purge - Purge expired skills
  fastify.post('/proofcomm/skills/purge', {
    preHandler: requireAuth,
  }, async (_request, reply) => {
    const deleted = skillRegistry.purgeExpired();
    return reply.send({ deleted });
  });
}
