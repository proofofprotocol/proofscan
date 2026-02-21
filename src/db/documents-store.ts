/**
 * Documents database store - manages resident documents
 * Phase 9.0: ProofComm Resident Documents
 * Phase 9.1: Added atomic registration with transaction support
 *
 * Resident documents are documents that act as agents in the ProofComm system.
 * They can receive messages and respond based on their content and memory.
 *
 * Design note: doc_id == targets.id for unified identification
 * The targets table stores the document as type='agent', protocol='a2a'
 * with config.document_type='resident' to identify it as a resident document.
 */

import { ulid } from 'ulid';
import { getEventsDb } from './connection.js';
import type { ResidentDocument, TargetType, TargetProtocol } from './types.js';

/**
 * Document memory structure
 */
export interface DocumentMemory {
  /** Summary of previous conversations */
  conversationSummary?: string;
  /** Key facts or context extracted from conversations */
  facts?: string[];
  /** Custom memory fields */
  [key: string]: unknown;
}

/**
 * Document config structure
 */
export interface DocumentConfig {
  /** Schema version for forward compatibility */
  schemaVersion: number;
  /** Optional description of the document's role */
  description?: string;
  /** Custom config fields */
  [key: string]: unknown;
}

/**
 * Resident document interface with parsed JSON fields (for external use)
 */
export interface ResidentDocumentWithParsed {
  docId: string;
  name: string;
  documentPath: string;
  documentHash?: string;
  memory?: DocumentMemory;
  createdAt: string;
  updatedAt?: string;
  config?: DocumentConfig;
}

/**
 * Options for creating a new document
 */
export interface CreateDocumentOptions {
  /** Document name */
  name: string;
  /** Path to the document file */
  documentPath: string;
  /** Optional document hash (SHA-256) */
  documentHash?: string;
  /** Optional initial memory */
  memory?: DocumentMemory;
  /** Optional config */
  config?: DocumentConfig;
}

/**
 * Target registration info for atomic document registration
 */
export interface TargetRegistrationInfo {
  type: TargetType;
  protocol: TargetProtocol;
  name?: string;
  enabled: boolean;
  config: unknown;
}

export class DocumentsStore {
  private configDir?: string;

  constructor(configDir?: string) {
    this.configDir = configDir;
  }

  private get db() {
    return getEventsDb(this.configDir);
  }

  /**
   * Add a new resident document
   * @param options - Document creation options
   * @param overrideId - Optional explicit ID (for testing/migration)
   * @returns The created document with generated ID and timestamps
   */
  add(options: CreateDocumentOptions, overrideId?: string): ResidentDocumentWithParsed {
    const now = new Date().toISOString();
    const docId = overrideId || ulid();

    const record: ResidentDocument = {
      doc_id: docId,
      name: options.name,
      document_path: options.documentPath,
      document_hash: options.documentHash || null,
      memory_json: options.memory ? JSON.stringify(options.memory) : null,
      created_at: now,
      updated_at: now,
      config_json: options.config ? JSON.stringify(options.config) : null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO resident_documents (
        doc_id, name, document_path, document_hash,
        memory_json, created_at, updated_at, config_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.doc_id,
      record.name,
      record.document_path,
      record.document_hash,
      record.memory_json,
      record.created_at,
      record.updated_at,
      record.config_json
    );

    return this.toExternal(record);
  }

  /**
   * Atomically register a document with its target entry
   * Uses a SQLite transaction to ensure both tables are updated together.
   * If either insert fails, both are rolled back.
   *
   * @param docOptions - Document creation options
   * @param targetInfo - Target registration info
   * @param overrideId - Optional explicit ID (for testing)
   * @returns The created document
   * @throws Error if registration fails (transaction is rolled back)
   */
  addWithTarget(
    docOptions: CreateDocumentOptions,
    targetInfo: TargetRegistrationInfo,
    overrideId?: string
  ): ResidentDocumentWithParsed {
    const now = new Date().toISOString();
    const docId = overrideId || ulid();

    // Prepare statements outside transaction for better performance
    const insertTarget = this.db.prepare(`
      INSERT INTO targets (id, type, protocol, name, enabled, created_at, updated_at, config_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertDoc = this.db.prepare(`
      INSERT INTO resident_documents (
        doc_id, name, document_path, document_hash,
        memory_json, created_at, updated_at, config_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Create atomic transaction
    const registerAtomic = this.db.transaction(() => {
      // Insert target first
      insertTarget.run(
        docId,
        targetInfo.type,
        targetInfo.protocol,
        targetInfo.name || null,
        targetInfo.enabled ? 1 : 0,
        now,
        now,
        JSON.stringify(targetInfo.config)
      );

      // Insert document
      insertDoc.run(
        docId,
        docOptions.name,
        docOptions.documentPath,
        docOptions.documentHash || null,
        docOptions.memory ? JSON.stringify(docOptions.memory) : null,
        now,
        now,
        docOptions.config ? JSON.stringify(docOptions.config) : null
      );
    });

    // Execute transaction (automatically rolls back on error)
    registerAtomic();

    // Return the created document
    return {
      docId,
      name: docOptions.name,
      documentPath: docOptions.documentPath,
      documentHash: docOptions.documentHash,
      memory: docOptions.memory,
      createdAt: now,
      updatedAt: now,
      config: docOptions.config,
    };
  }

  /**
   * Get a document by ID
   * @param docId - Document ID
   * @returns The document with parsed JSON fields, or undefined if not found
   */
  get(docId: string): ResidentDocumentWithParsed | undefined {
    const stmt = this.db.prepare(`SELECT * FROM resident_documents WHERE doc_id = ?`);
    const row = stmt.get(docId) as ResidentDocument | undefined;
    if (!row) return undefined;
    return this.toExternal(row);
  }

  /**
   * Get a document by path
   * @param documentPath - Document file path
   * @returns The document with parsed JSON fields, or undefined if not found
   */
  getByPath(documentPath: string): ResidentDocumentWithParsed | undefined {
    const stmt = this.db.prepare(`SELECT * FROM resident_documents WHERE document_path = ?`);
    const row = stmt.get(documentPath) as ResidentDocument | undefined;
    if (!row) return undefined;
    return this.toExternal(row);
  }

  /**
   * List all documents
   * @returns Array of documents with parsed JSON fields
   */
  list(): ResidentDocumentWithParsed[] {
    const stmt = this.db.prepare(`SELECT * FROM resident_documents ORDER BY created_at DESC`);
    const rows = stmt.all() as ResidentDocument[];
    return rows.map(row => this.toExternal(row));
  }

  /**
   * Update a document's hash
   * @param docId - Document ID
   * @param documentHash - New hash value
   * @returns true if document was found and updated
   */
  updateHash(docId: string, documentHash: string): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE resident_documents SET document_hash = ?, updated_at = ? WHERE doc_id = ?
    `);
    const result = stmt.run(documentHash, now, docId);
    return result.changes > 0;
  }

  /**
   * Update a document's memory
   * Uses a transaction to prevent race conditions between read and write.
   *
   * @param docId - Document ID
   * @param memory - New memory object (will be merged with existing)
   * @returns true if document was found and updated
   */
  updateMemory(docId: string, memory: DocumentMemory): boolean {
    const now = new Date().toISOString();

    // Prepare statements
    const selectStmt = this.db.prepare(
      `SELECT memory_json FROM resident_documents WHERE doc_id = ?`
    );
    const updateStmt = this.db.prepare(
      `UPDATE resident_documents SET memory_json = ?, updated_at = ? WHERE doc_id = ?`
    );

    // Use transaction to prevent race conditions
    const updateAtomic = this.db.transaction(() => {
      const row = selectStmt.get(docId) as { memory_json: string | null } | undefined;
      if (!row) return false;

      const existingMemory: DocumentMemory = row.memory_json
        ? JSON.parse(row.memory_json)
        : {};

      const mergedMemory: DocumentMemory = {
        ...existingMemory,
        ...memory,
      };

      const result = updateStmt.run(JSON.stringify(mergedMemory), now, docId);
      return result.changes > 0;
    });

    return updateAtomic();
  }

  /**
   * Replace a document's memory entirely
   * @param docId - Document ID
   * @param memory - New memory object
   * @returns true if document was found and updated
   */
  setMemory(docId: string, memory: DocumentMemory | null): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE resident_documents SET memory_json = ?, updated_at = ? WHERE doc_id = ?
    `);
    const result = stmt.run(memory ? JSON.stringify(memory) : null, now, docId);
    return result.changes > 0;
  }

  /**
   * Update a document's config
   * @param docId - Document ID
   * @param config - New config object
   * @returns true if document was found and updated
   */
  updateConfig(docId: string, config: DocumentConfig): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE resident_documents SET config_json = ?, updated_at = ? WHERE doc_id = ?
    `);
    const result = stmt.run(JSON.stringify(config), now, docId);
    return result.changes > 0;
  }

  /**
   * Remove a document by ID (document only, not target)
   *
   * NOTE: This only removes from resident_documents table.
   * Use removeWithTarget() to remove both document and target atomically.
   *
   * @param docId - Document ID
   * @returns true if document was found and removed
   */
  remove(docId: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM resident_documents WHERE doc_id = ?`);
    const result = stmt.run(docId);
    return result.changes > 0;
  }

  /**
   * Atomically remove a document and its target entry
   * Uses a SQLite transaction to ensure both deletes succeed or both fail.
   *
   * @param docId - Document ID (same as target ID)
   * @returns true if document was found and removed
   */
  removeWithTarget(docId: string): boolean {
    const deleteDoc = this.db.prepare(
      `DELETE FROM resident_documents WHERE doc_id = ?`
    );
    const deleteTarget = this.db.prepare(
      `DELETE FROM targets WHERE id = ?`
    );

    let docRemoved = false;

    const removeAtomic = this.db.transaction(() => {
      const docResult = deleteDoc.run(docId);
      docRemoved = docResult.changes > 0;

      // Always try to remove target (cleanup orphans if any)
      deleteTarget.run(docId);
    });

    removeAtomic();
    return docRemoved;
  }

  /**
   * Check if a document exists
   * @param docId - Document ID
   * @returns true if document exists
   */
  exists(docId: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM resident_documents WHERE doc_id = ? LIMIT 1`);
    return stmt.get(docId) !== undefined;
  }

  /**
   * Count documents
   * @returns Total number of documents
   */
  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM resident_documents`);
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Convert internal record to external interface with parsed JSON
   */
  private toExternal(row: ResidentDocument): ResidentDocumentWithParsed {
    return {
      docId: row.doc_id,
      name: row.name,
      documentPath: row.document_path,
      documentHash: row.document_hash || undefined,
      memory: row.memory_json ? JSON.parse(row.memory_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at || undefined,
      config: row.config_json ? JSON.parse(row.config_json) : undefined,
    };
  }
}
