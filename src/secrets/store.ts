/**
 * SQLite-backed secret store (Phase 3.5)
 *
 * Stores encrypted secrets in ~/.proofscan/secrets.db
 * Uses platform-specific encryption providers (DPAPI on Windows).
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  ISecretStore,
  IEncryptionProvider,
  SecretMeta,
  SecretRecord,
  StoreSecretResult,
  ProviderType,
} from './types.js';
import { makeSecretRef } from './types.js';
import { getBestProvider, getProvider } from './providers/index.js';
import { getDefaultConfigDir } from '../utils/config-path.js';

/** Database schema version */
const SECRETS_DB_VERSION = 1;

/** Database schema */
const SECRETS_DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_secrets_provider ON secrets(provider);
CREATE INDEX IF NOT EXISTS idx_secrets_created ON secrets(created_at);
`;

/**
 * SQLite-backed secret store
 */
export class SqliteSecretStore implements ISecretStore {
  private db: Database.Database;
  private provider: IEncryptionProvider;
  private closed = false;

  constructor(configDir?: string, provider?: IEncryptionProvider) {
    const dir = configDir || getDefaultConfigDir();

    // Ensure directory exists
    mkdirSync(dir, { recursive: true });

    // Open database
    const dbPath = join(dir, 'secrets.db');
    this.db = new Database(dbPath);

    // Initialize schema
    this.initSchema();

    // Use provided provider or get best available
    this.provider = provider || getBestProvider();
  }

  private initSchema(): void {
    // Check version
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;

    if (currentVersion < SECRETS_DB_VERSION) {
      this.db.exec(SECRETS_DB_SCHEMA);
      this.db.pragma(`user_version = ${SECRETS_DB_VERSION}`);
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('SecretStore has been closed');
    }
  }

  async store(plaintext: string, meta?: SecretMeta): Promise<StoreSecretResult> {
    this.ensureOpen();

    // Generate unique ID
    const id = uuidv4();

    // Encrypt the plaintext
    const ciphertext = await this.provider.encrypt(plaintext);

    // Serialize metadata
    const metaJson = meta ? JSON.stringify(meta) : null;

    // Insert into database
    const stmt = this.db.prepare(`
      INSERT INTO secrets (id, provider, ciphertext, created_at, meta_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, this.provider.type, ciphertext, new Date().toISOString(), metaJson);

    return {
      id,
      reference: makeSecretRef(this.provider.type, id),
    };
  }

  async retrieve(id: string): Promise<string | null> {
    this.ensureOpen();

    const stmt = this.db.prepare(`
      SELECT provider, ciphertext FROM secrets WHERE id = ?
    `);

    const row = stmt.get(id) as { provider: ProviderType; ciphertext: string } | undefined;

    if (!row) {
      return null;
    }

    // Get the appropriate provider
    const provider = row.provider === this.provider.type
      ? this.provider
      : getProvider(row.provider);

    // Security: Check if provider is available on this platform
    if (!provider.isAvailable()) {
      throw new Error(
        `Secret was encrypted with '${row.provider}' which is not available on this platform. ` +
        `This secret can only be decrypted on a system where ${row.provider} is supported.`
      );
    }

    // Decrypt and return
    return provider.decrypt(row.ciphertext);
  }

  async exists(id: string): Promise<boolean> {
    this.ensureOpen();

    const stmt = this.db.prepare(`SELECT 1 FROM secrets WHERE id = ?`);
    return stmt.get(id) !== undefined;
  }

  async delete(id: string): Promise<boolean> {
    this.ensureOpen();

    const stmt = this.db.prepare(`DELETE FROM secrets WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async list(): Promise<string[]> {
    this.ensureOpen();

    const stmt = this.db.prepare(`SELECT id FROM secrets ORDER BY created_at DESC`);
    const rows = stmt.all() as { id: string }[];
    return rows.map(r => r.id);
  }

  async getMeta(id: string): Promise<SecretMeta | null> {
    this.ensureOpen();

    const stmt = this.db.prepare(`SELECT meta_json FROM secrets WHERE id = ?`);
    const row = stmt.get(id) as { meta_json: string | null } | undefined;

    if (!row || !row.meta_json) {
      return null;
    }

    try {
      return JSON.parse(row.meta_json) as SecretMeta;
    } catch {
      return null;
    }
  }

  /**
   * Get creation timestamp for a secret
   */
  async getCreatedAt(id: string): Promise<Date | null> {
    this.ensureOpen();

    const stmt = this.db.prepare(`SELECT created_at FROM secrets WHERE id = ?`);
    const row = stmt.get(id) as { created_at: string } | undefined;

    if (!row) {
      return null;
    }

    return new Date(row.created_at);
  }

  /**
   * Get the provider type in use
   */
  getProviderType(): ProviderType {
    return this.provider.type;
  }

  /**
   * Get count of stored secrets
   */
  count(): number {
    this.ensureOpen();

    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM secrets`);
    const row = stmt.get() as { count: number };
    return row.count;
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}

// Singleton instance
let secretStore: SqliteSecretStore | null = null;

/**
 * Get or create the global secret store
 */
export function getSecretStore(configDir?: string): SqliteSecretStore {
  if (!secretStore) {
    secretStore = new SqliteSecretStore(configDir);
  }
  return secretStore;
}

/**
 * Close the global secret store
 */
export function closeSecretStore(): void {
  if (secretStore) {
    secretStore.close();
    secretStore = null;
  }
}
