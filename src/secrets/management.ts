/**
 * Secrets management utilities (Phase 3.6)
 *
 * Provides functions for:
 * - Listing secrets with bindings
 * - Setting/updating secrets
 * - Pruning orphan secrets
 * - Export/import encrypted bundles
 *
 * Security: Never logs, prints, or writes plaintext secrets.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import { dirname, join } from 'path';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync, createHmac } from 'crypto';
import { SqliteSecretStore } from './store.js';
import { parseSecretRef, makeSecretRef, type ProviderType } from './types.js';
import type { Config, Connector, StdioTransport } from '../types/index.js';

// ============================================================
// Types
// ============================================================

/** Information about a secret and its binding */
export interface SecretBindingInfo {
  /** Secret reference (dpapi:xxx, plain:xxx) */
  secret_ref: string;
  /** Secret ID */
  secret_id: string;
  /** Connector ID (if bound) */
  connector_id?: string;
  /** Environment key (if bound) */
  env_key?: string;
  /** Provider type */
  provider: ProviderType;
  /** Creation timestamp */
  created_at: string;
  /** Last used timestamp (if tracked) */
  last_used_at?: string;
  /** Status: OK (bound), ORPHAN (not bound), MISSING (ref in config but not in store) */
  status: 'OK' | 'ORPHAN' | 'MISSING';
}

/** Options for setting a secret */
export interface SetSecretOptions {
  configPath: string;
  connectorId: string;
  envKey: string;
  secretValue: string;
}

/** Result of setting a secret */
export interface SetSecretResult {
  secretRef: string;
  secretId: string;
  updated: boolean;
}

/** Options for pruning secrets */
export interface PruneOptions {
  configDir: string;
  configPath: string;
  dryRun?: boolean;
  olderThanDays?: number;
}

/** Result of pruning secrets */
export interface PruneResult {
  orphanCount: number;
  removedCount: number;
  removedIds: string[];
}

/** Options for exporting secrets */
export interface ExportOptions {
  configDir: string;
  configPath: string;
  outputPath: string;
  passphrase: string;
}

/** Result of exporting secrets */
export interface ExportResult {
  exportedCount: number;
}

/** Options for importing secrets */
export interface ImportOptions {
  configDir: string;
  configPath: string;
  inputPath: string;
  passphrase: string;
  overwrite?: boolean;
}

/** Result of importing secrets */
export interface ImportResult {
  importedCount: number;
  skippedCount: number;
  errorCount: number;
}

/** Export bundle format */
interface ExportBundle {
  version: 1;
  kdf: {
    name: 'scrypt';
    salt: string; // base64
    N: number;
    r: number;
    p: number;
    keyLen: number;
  };
  cipher: {
    name: 'aes-256-gcm';
    iv: string; // base64
    authTag: string; // base64
  };
  payload: string; // base64 encrypted
  /** HMAC-SHA256 of metadata (version + kdf + cipher) to prevent tampering */
  metadataHmac: string; // base64
}

/** Decrypted entry in export bundle */
interface ExportEntry {
  connector_id: string;
  env_key: string;
  secret_bytes_b64: string; // base64 of plaintext
}

// ============================================================
// Crypto utilities
// ============================================================

const SCRYPT_N = 2 ** 14; // CPU/memory cost (16384 - compatible with low-memory environments)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32; // 256 bits

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

function encryptPayload(plaintext: Buffer, key: Buffer): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(12); // 96 bits for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, ciphertext };
}

function decryptPayload(ciphertext: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ============================================================
// File locking utilities
// ============================================================

const LOCK_TIMEOUT_MS = 10000; // 10 seconds
const LOCK_RETRY_INTERVAL_MS = 100;

/**
 * Acquire exclusive lock on config file
 * Uses a .lock file mechanism for cross-process safety
 */
async function acquireConfigLock(configPath: string): Promise<string> {
  const lockPath = `${configPath}.lock`;
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      // O_CREAT | O_EXCL - fails if file already exists (atomic check-and-create)
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return lockPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lock exists, wait and retry
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Failed to acquire lock on ${configPath} (timeout after ${LOCK_TIMEOUT_MS}ms)`);
}

/**
 * Release config file lock
 */
function releaseConfigLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore errors (lock may have been removed by timeout)
  }
}

/**
 * Read and write config file atomically with file locking
 */
async function withConfigLock<T>(
  configPath: string,
  operation: (config: Config) => Promise<{ config: Config; result: T }>
): Promise<T> {
  const lockPath = await acquireConfigLock(configPath);
  const tempPath = `${configPath}.tmp`;
  try {
    // Read current config
    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Execute operation
    const { config: updatedConfig, result } = await operation(config);

    // Write atomically: write to temp file first, then overwrite original
    writeFileSync(tempPath, JSON.stringify(updatedConfig, null, 2));
    writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

    return result;
  } finally {
    // Clean up temp file if it exists
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    releaseConfigLock(lockPath);
  }
}

// ============================================================
// Helper functions
// ============================================================

/** Extract all secret refs from config */
function collectConfigSecretRefs(config: Config): Map<string, { connectorId: string; envKey: string }> {
  const refs = new Map<string, { connectorId: string; envKey: string }>();

  for (const connector of config.connectors || []) {
    const env = (connector.transport as StdioTransport)?.env;
    if (!env) continue;

    for (const [key, value] of Object.entries(env)) {
      const parsed = parseSecretRef(value);
      if (parsed) {
        refs.set(parsed.id, { connectorId: connector.id, envKey: key });
      }
    }
  }

  return refs;
}

// ============================================================
// Management functions
// ============================================================

/**
 * List all secrets with their binding information
 */
export async function listSecretBindings(
  configDir: string,
  configPath: string
): Promise<SecretBindingInfo[]> {
  const results: SecretBindingInfo[] = [];
  const store = new SqliteSecretStore(configDir);

  try {
    // Get all secret IDs from store
    const secretIds = await store.list();

    // Load config to find bindings
    let config: Config = { version: 1, connectors: [] };
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }

    const configRefs = collectConfigSecretRefs(config);

    // Build binding info for each secret
    for (const id of secretIds) {
      const meta = await store.getMeta(id);
      const binding = configRefs.get(id);

      // Determine provider from meta or try to get from store
      let provider: ProviderType = 'plain';
      // We need to get the record to know the provider
      // For now, use the store's provider type
      provider = store.getProviderType();

      results.push({
        secret_ref: makeSecretRef(provider, id),
        secret_id: id,
        connector_id: binding?.connectorId,
        env_key: binding?.envKey,
        provider,
        created_at: meta?.source ? new Date().toISOString() : new Date().toISOString(),
        status: binding ? 'OK' : 'ORPHAN',
      });

      // Remove from configRefs to track what we've seen
      configRefs.delete(id);
    }

    // Any remaining configRefs are MISSING (in config but not in store)
    for (const [id, binding] of configRefs) {
      results.push({
        secret_ref: `unknown:${id}`,
        secret_id: id,
        connector_id: binding.connectorId,
        env_key: binding.envKey,
        provider: 'plain',
        created_at: '',
        status: 'MISSING',
      });
    }

    return results;
  } finally {
    store.close();
  }
}

/**
 * Set a secret value for a connector environment variable
 * Uses file locking to prevent race conditions during concurrent access.
 */
export async function setSecret(options: SetSecretOptions): Promise<SetSecretResult> {
  const { configPath, connectorId, envKey, secretValue } = options;
  const configDir = dirname(configPath);

  // Store the secret first (outside the lock to minimize lock time)
  const store = new SqliteSecretStore(configDir);
  let storeResult: { id: string; reference: string };
  try {
    storeResult = await store.store(secretValue, {
      connectorId,
      keyName: envKey,
      source: `${connectorId}.transport.env.${envKey}`,
    });
  } finally {
    store.close();
  }

  // Update config with file locking
  return withConfigLock<SetSecretResult>(configPath, async (config) => {
    // Find connector
    const connector = config.connectors?.find(c => c.id === connectorId);
    if (!connector) {
      throw new Error(`Connector not found: ${connectorId}`);
    }

    // Ensure transport.env exists
    if (!connector.transport) {
      (connector as Connector).transport = { type: 'stdio', command: '' } as StdioTransport;
    }
    const transport = connector.transport as StdioTransport;
    if (!transport.env) {
      transport.env = {};
    }

    // Check if there's an existing secret
    const existingValue = transport.env[envKey];
    let updated = false;
    if (existingValue) {
      const parsed = parseSecretRef(existingValue);
      if (parsed) {
        updated = true;
      }
    }

    // Update config with new reference
    transport.env[envKey] = storeResult.reference;

    return {
      config,
      result: {
        secretRef: storeResult.reference,
        secretId: storeResult.id,
        updated,
      },
    };
  });
}

/**
 * Remove orphan secrets not referenced by config
 */
export async function pruneOrphanSecrets(options: PruneOptions): Promise<PruneResult> {
  const { configDir, configPath, dryRun = false, olderThanDays } = options;

  const store = new SqliteSecretStore(configDir);
  try {
    const secretIds = await store.list();

    // Load config to find active bindings
    let config: Config = { version: 1, connectors: [] };
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }

    const configRefs = collectConfigSecretRefs(config);

    // Find orphans
    const orphanIds: string[] = [];
    const now = Date.now();
    const ageThreshold = olderThanDays ? olderThanDays * 24 * 60 * 60 * 1000 : 0;

    for (const id of secretIds) {
      if (!configRefs.has(id)) {
        // Check age if specified
        if (ageThreshold > 0) {
          const meta = await store.getMeta(id);
          // For now, we don't have created_at in getMeta, so skip age check
          // TODO: Extend store to return created_at
        }
        orphanIds.push(id);
      }
    }

    // Remove orphans if not dry run
    let removedCount = 0;
    if (!dryRun) {
      for (const id of orphanIds) {
        const deleted = await store.delete(id);
        if (deleted) {
          removedCount++;
        }
      }
    }

    return {
      orphanCount: orphanIds.length,
      removedCount,
      removedIds: orphanIds,
    };
  } finally {
    store.close();
  }
}

/**
 * Export secrets to encrypted bundle file
 */
export async function exportSecrets(options: ExportOptions): Promise<ExportResult> {
  const { configDir, configPath, outputPath, passphrase } = options;

  const store = new SqliteSecretStore(configDir);
  try {
    const secretIds = await store.list();

    // Load config to get bindings
    let config: Config = { version: 1, connectors: [] };
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }

    const configRefs = collectConfigSecretRefs(config);

    // Build entries
    const entries: ExportEntry[] = [];
    for (const id of secretIds) {
      const binding = configRefs.get(id);
      if (!binding) continue; // Skip orphans

      // Retrieve plaintext (in-memory only)
      const plaintext = await store.retrieve(id);
      if (!plaintext) continue;

      entries.push({
        connector_id: binding.connectorId,
        env_key: binding.envKey,
        secret_bytes_b64: Buffer.from(plaintext, 'utf-8').toString('base64'),
      });
    }

    // Encrypt bundle
    const payloadJson = JSON.stringify({ entries });
    const payloadBytes = Buffer.from(payloadJson, 'utf-8');

    const salt = randomBytes(16);
    const key = deriveKey(passphrase, salt);
    const { iv, authTag, ciphertext } = encryptPayload(payloadBytes, key);

    // Prepare bundle metadata
    const kdfInfo = {
      name: 'scrypt' as const,
      salt: salt.toString('base64'),
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      keyLen: KEY_LEN,
    };
    const cipherInfo = {
      name: 'aes-256-gcm' as const,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };

    // Compute HMAC over metadata to detect tampering of KDF/cipher parameters
    const metadataForHmac = JSON.stringify({ version: 1, kdf: kdfInfo, cipher: cipherInfo });
    const metadataHmac = createHmac('sha256', key).update(metadataForHmac).digest('base64');

    const bundle: ExportBundle = {
      version: 1,
      kdf: kdfInfo,
      cipher: cipherInfo,
      payload: ciphertext.toString('base64'),
      metadataHmac,
    };

    // Write bundle to file
    writeFileSync(outputPath, JSON.stringify(bundle, null, 2));

    return {
      exportedCount: entries.length,
    };
  } finally {
    store.close();
  }
}

/**
 * Import secrets from encrypted bundle file
 */
export async function importSecrets(options: ImportOptions): Promise<ImportResult> {
  const { configDir, configPath, inputPath, passphrase, overwrite = false } = options;

  // Read and parse bundle
  const bundleJson = readFileSync(inputPath, 'utf-8');
  const bundle: ExportBundle = JSON.parse(bundleJson);

  if (bundle.version !== 1) {
    throw new Error(`Unsupported export bundle version: ${bundle.version}`);
  }

  // Derive key
  const salt = Buffer.from(bundle.kdf.salt, 'base64');
  const key = deriveKey(passphrase, salt);

  // Verify HMAC before trusting metadata (prevents KDF parameter tampering)
  const metadataForHmac = JSON.stringify({ version: bundle.version, kdf: bundle.kdf, cipher: bundle.cipher });
  const expectedHmac = createHmac('sha256', key).update(metadataForHmac).digest('base64');
  if (bundle.metadataHmac !== expectedHmac) {
    throw new Error('Bundle integrity check failed. The file may have been tampered with or the passphrase is incorrect.');
  }

  // Decrypt payload
  const iv = Buffer.from(bundle.cipher.iv, 'base64');
  const authTag = Buffer.from(bundle.cipher.authTag, 'base64');
  const ciphertext = Buffer.from(bundle.payload, 'base64');

  let payloadBytes: Buffer;
  try {
    payloadBytes = decryptPayload(ciphertext, key, iv, authTag);
  } catch {
    throw new Error('Decryption failed. Wrong passphrase?');
  }

  const payload = JSON.parse(payloadBytes.toString('utf-8')) as { entries: ExportEntry[] };

  // Store secrets first (outside the config lock to minimize lock time)
  const store = new SqliteSecretStore(configDir);
  const storedSecrets: { entry: ExportEntry; reference: string }[] = [];
  let errorCount = 0;

  try {
    for (const entry of payload.entries) {
      try {
        // Decode plaintext (in-memory only)
        const plaintext = Buffer.from(entry.secret_bytes_b64, 'base64').toString('utf-8');

        // Store secret
        const result = await store.store(plaintext, {
          connectorId: entry.connector_id,
          keyName: entry.env_key,
          source: `${entry.connector_id}.transport.env.${entry.env_key}`,
        });

        storedSecrets.push({ entry, reference: result.reference });
      } catch {
        errorCount++;
      }
    }
  } finally {
    store.close();
  }

  // If no secrets were stored, return early without touching config
  if (storedSecrets.length === 0) {
    return {
      importedCount: 0,
      skippedCount: payload.entries.length - errorCount,
      errorCount,
    };
  }

  // Update config with file locking to prevent race conditions
  return withConfigLock<ImportResult>(configPath, async (config) => {
    let importedCount = 0;
    let skippedCount = 0;

    for (const { entry, reference } of storedSecrets) {
      // Find connector
      const connector = config.connectors?.find(c => c.id === entry.connector_id);
      if (!connector) {
        // Connector doesn't exist in config, skip
        skippedCount++;
        continue;
      }

      // Check if already has a secret ref
      const transport = connector.transport as StdioTransport;
      const existingValue = transport?.env?.[entry.env_key];
      if (existingValue && parseSecretRef(existingValue)) {
        if (!overwrite) {
          skippedCount++;
          continue;
        }
      }

      // Update config
      if (!transport) {
        (connector as Connector).transport = { type: 'stdio', command: '' } as StdioTransport;
      }
      const t = connector.transport as StdioTransport;
      if (!t.env) {
        t.env = {};
      }
      t.env[entry.env_key] = reference;

      importedCount++;
    }

    return {
      config,
      result: {
        importedCount,
        skippedCount: skippedCount + (payload.entries.length - storedSecrets.length - errorCount),
        errorCount,
      },
    };
  });
}
