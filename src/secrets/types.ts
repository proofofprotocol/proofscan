/**
 * Secret storage types and interfaces (Phase 3.5)
 *
 * Provides secure storage for API keys and sensitive configuration values.
 * Uses platform-specific encryption (Windows DPAPI or keychain on macOS).
 */

/**
 * Encryption provider type
 * - 'dpapi': Windows Data Protection API (CurrentUser scope)
 * - 'keychain': macOS Keychain (future)
 * - 'plain': No encryption (fallback for testing/unsupported platforms)
 */
export type ProviderType = 'dpapi' | 'keychain' | 'plain';

/**
 * A stored secret record
 */
export interface SecretRecord {
  /** Unique identifier (ULID or UUID) */
  id: string;
  /** Encryption provider used */
  provider: ProviderType;
  /** Base64-encoded encrypted data */
  ciphertext: string;
  /** ISO timestamp of creation */
  created_at: string;
  /** Optional JSON metadata (e.g., original key name hint) */
  meta_json?: string;
}

/**
 * Metadata for a secret
 */
export interface SecretMeta {
  /** Original key name (e.g., "OPENAI_API_KEY") */
  keyName?: string;
  /** Connector ID where secret is used */
  connectorId?: string;
}

/**
 * Result of storing a secret
 */
export interface StoreSecretResult {
  /** The generated secret ID */
  id: string;
  /** Reference string to use in config: "dpapi:<id>" */
  reference: string;
}

/**
 * Encryption provider interface
 */
export interface IEncryptionProvider {
  /** Provider type identifier */
  readonly type: ProviderType;

  /** Check if this provider is available on the current platform */
  isAvailable(): boolean;

  /**
   * Encrypt plaintext to ciphertext
   * @param plaintext - UTF-8 string to encrypt
   * @returns Base64-encoded ciphertext
   */
  encrypt(plaintext: string): Promise<string>;

  /**
   * Decrypt ciphertext to plaintext
   * @param ciphertext - Base64-encoded ciphertext
   * @returns UTF-8 plaintext string
   */
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Secret store interface
 */
export interface ISecretStore {
  /**
   * Store a secret value
   * @param plaintext - The secret value to store
   * @param meta - Optional metadata
   * @returns ID and reference string
   */
  store(plaintext: string, meta?: SecretMeta): Promise<StoreSecretResult>;

  /**
   * Retrieve a secret by ID
   * @param id - Secret identifier
   * @returns Decrypted plaintext or null if not found
   */
  retrieve(id: string): Promise<string | null>;

  /**
   * Check if a secret exists
   * @param id - Secret identifier
   */
  exists(id: string): Promise<boolean>;

  /**
   * Delete a secret by ID
   * @param id - Secret identifier
   * @returns true if deleted, false if not found
   */
  delete(id: string): Promise<boolean>;

  /**
   * List all secret IDs (not values)
   */
  list(): Promise<string[]>;

  /**
   * Get secret metadata (without decrypting)
   * @param id - Secret identifier
   */
  getMeta(id: string): Promise<SecretMeta | null>;

  /**
   * Close the store and release resources
   */
  close(): void;
}

/**
 * Secret reference pattern: "dpapi:<id>" or "keychain:<id>"
 */
export const SECRET_REF_PATTERN = /^(dpapi|keychain):([a-zA-Z0-9_-]+)$/;

/**
 * Parse a secret reference string
 * @param ref - Reference string like "dpapi:abc123"
 * @returns Parsed provider and ID, or null if invalid
 */
export function parseSecretRef(ref: string): { provider: ProviderType; id: string } | null {
  const match = ref.match(SECRET_REF_PATTERN);
  if (!match) return null;
  return {
    provider: match[1] as ProviderType,
    id: match[2],
  };
}

/**
 * Create a secret reference string
 * @param provider - Provider type
 * @param id - Secret ID
 */
export function makeSecretRef(provider: ProviderType, id: string): string {
  return `${provider}:${id}`;
}

/**
 * Check if a string is a secret reference
 */
export function isSecretRef(value: string): boolean {
  return SECRET_REF_PATTERN.test(value);
}
