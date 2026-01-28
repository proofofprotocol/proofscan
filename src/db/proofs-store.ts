/**
 * Proofs database store - manages immutable proof records
 */

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { getProofsDb } from './connection.js';
import type { Proof } from './types.js';

export class ProofsStore {
  private configDir?: string;

  constructor(configDir?: string) {
    this.configDir = configDir;
  }

  private get db() {
    return getProofsDb(this.configDir);
  }

  /**
   * Create a new proof record
   */
  createProof(params: {
    targetId: string;
    /** @deprecated Use targetId instead */
    connectorId?: string;
    sessionId?: string;
    rpcId?: string;
    method?: string;
    payload: string | Buffer;
    hashAlgo?: string;
    inscriberType: string;
    inscriberRef: string;
    artifactUri?: string;
  }): Proof {
    // Support legacy connectorId for backward compatibility
    const connectorId = params.connectorId || params.targetId;

    const hashAlgo = params.hashAlgo || 'sha256';
    const payloadHash = createHash(hashAlgo)
      .update(typeof params.payload === 'string' ? params.payload : params.payload)
      .digest('hex');

    const proof: Proof = {
      proof_id: randomUUID(),
      connector_id: connectorId,
      session_id: params.sessionId || null,
      rpc_id: params.rpcId || null,
      method: params.method || null,
      payload_hash: payloadHash,
      hash_algo: hashAlgo,
      inscriber_type: params.inscriberType,
      inscriber_ref: params.inscriberRef,
      artifact_uri: params.artifactUri || null,
      created_at: new Date().toISOString(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO proofs (
        proof_id, connector_id, session_id, rpc_id, method,
        payload_hash, hash_algo, inscriber_type, inscriber_ref,
        artifact_uri, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      proof.proof_id,
      proof.connector_id,
      proof.session_id,
      proof.rpc_id,
      proof.method,
      proof.payload_hash,
      proof.hash_algo,
      proof.inscriber_type,
      proof.inscriber_ref,
      proof.artifact_uri,
      proof.created_at
    );

    return proof;
  }

  /**
   * Get proof by ID
   */
  getProof(proofId: string): Proof | null {
    const stmt = this.db.prepare(`SELECT * FROM proofs WHERE proof_id = ?`);
    return stmt.get(proofId) as Proof | null;
  }

  /**
   * Get proofs by connector
   */
  getProofsByConnector(connectorId: string, limit?: number): Proof[] {
    let sql = `SELECT * FROM proofs WHERE connector_id = ? ORDER BY created_at DESC`;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all(connectorId) as Proof[];
  }

  /**
   * Get proofs by session
   */
  getProofsBySession(sessionId: string): Proof[] {
    const stmt = this.db.prepare(`
      SELECT * FROM proofs WHERE session_id = ? ORDER BY created_at ASC
    `);
    return stmt.all(sessionId) as Proof[];
  }

  /**
   * Get all proofs
   */
  getAllProofs(limit?: number): Proof[] {
    let sql = `SELECT * FROM proofs ORDER BY created_at DESC`;
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    return stmt.all() as Proof[];
  }

  /**
   * Check if a session has associated proofs
   */
  hasProofsForSession(sessionId: string): boolean {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM proofs WHERE session_id = ?`);
    const result = stmt.get(sessionId) as { count: number };
    return result.count > 0;
  }

  /**
   * Get all session IDs that have proofs
   */
  getProtectedSessionIds(): string[] {
    const stmt = this.db.prepare(`SELECT DISTINCT session_id FROM proofs WHERE session_id IS NOT NULL`);
    const results = stmt.all() as Array<{ session_id: string }>;
    return results.map(r => r.session_id);
  }

  /**
   * Count total proofs
   */
  countProofs(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM proofs`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Update artifact URI (e.g., after IPFS upload)
   */
  updateArtifactUri(proofId: string, artifactUri: string): void {
    const stmt = this.db.prepare(`UPDATE proofs SET artifact_uri = ? WHERE proof_id = ?`);
    stmt.run(artifactUri, proofId);
  }
}
